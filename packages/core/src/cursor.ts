import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { Effect, Exit } from "effect";
import {
	type HarnessStatus,
	type InteractionMode,
	type Part,
	type PartId,
	type Question,
	type ToolDisplay,
	type ToolState,
	type UnknownRecord,
	CallId,
	PlanId,
	QuestionId,
} from "@honk/api/core/v1";
import type { Harness, PromptImage, TranscriptEntry, TurnContext } from "./harness";

export interface CursorHarnessOptions {
	/** HONK_HOME/harness/cursor — the child's isolated HOME (ADR 0016). */
	readonly cursorDir: string;
	/** Reads the stored cursor key at spawn time (reject-on-use). */
	readonly apiKey: () => string | null;
}

type JsonRpcId = string | number;
type StreamTag = "text" | "reasoning";
type ToolPart = Extract<Part, { readonly _tag: "tool" }>;
type PlanPart = Extract<Part, { readonly _tag: "plan" }>;
type QuestionPart = Extract<Part, { readonly _tag: "question" }>;

interface AcpTextBlock {
	readonly type: "text";
	readonly text: string;
}

interface AcpImageBlock {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
}

type AcpContentBlock = AcpTextBlock | AcpImageBlock;

interface JsonRpcPendingRequest {
	readonly method: string;
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout> | null;
	readonly removeAbortListener: (() => void) | null;
}

interface JsonRpcChildOptions {
	readonly command: string;
	readonly args: ReadonlyArray<string>;
	readonly cwd: string;
	readonly env: Record<string, string>;
	readonly onNotification: (method: string, params: unknown) => void;
	readonly onRequest: (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;
}

interface ProjectionState {
	readonly open: Set<PartId>;
	readonly rawToolUpdates: Map<string, Record<string, unknown>>;
	readonly tools: Map<string, ToolTracker>;
	readonly closedTools: Set<string>;
	stream: { readonly tag: StreamTag; readonly partId: PartId } | null;
	plan: PlanPart | null;
	sessionId: string | null;
}

interface ToolTracker {
	readonly partId: PartId;
	callId: string;
	tool: string;
	input: UnknownRecord;
	startedAt: string;
	display: ToolDisplay;
}

const CURSOR_REQUEST_TIMEOUT_MS = 30_000;
const CLIENT_VERSION = "0.0.1";

const now = (): string => new Date().toISOString();

const stringifyUnknown = (value: unknown): string => {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
};

const textFromAcpContentArray = (items: ReadonlyArray<unknown>): string => {
	const chunks: Array<string> = [];
	for (const item of items) {
		if (
			typeof item === "object" &&
			item !== null &&
			"type" in item &&
			item.type === "content" &&
			"content" in item &&
			typeof item.content === "object" &&
			item.content !== null &&
			"type" in item.content &&
			item.content.type === "text" &&
			"text" in item.content &&
			typeof item.content.text === "string" &&
			item.content.text.trim() !== ""
		) {
			chunks.push(item.content.text.trim());
		}
	}
	return chunks.join("\n");
};

class JsonRpcResponseError extends Error {
	readonly code: number;
	readonly data: unknown;

	constructor(code: number, message: string, data?: unknown) {
		super(message);
		this.code = code;
		this.data = data;
	}
}

class CursorAcpChild {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly lines: ReadlineInterface;
	private readonly pending = new Map<JsonRpcId, JsonRpcPendingRequest>();
	private readonly stderrChunks: Array<string> = [];
	private readonly abortController = new AbortController();
	private nextId = 1;
	private closed = false;
	private exited = false;
	private failure: Error | null = null;
	private killTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly options: JsonRpcChildOptions) {
		this.child = spawn(options.command, [...options.args], {
			cwd: options.cwd,
			env: options.env,
			shell: process.platform === "win32",
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.lines = createInterface({ input: this.child.stdout });
		this.lines.on("line", (line) => {
			this.handleLine(line);
		});
		this.child.stderr.on("data", (chunk: Buffer | string) => {
			this.appendStderr(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
		});
		this.child.stdin.on("error", (error) => {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		});
		this.child.on("error", (error) => {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		});
		this.child.on("exit", (code, signal) => {
			this.exited = true;
			this.clearKillTimer();
			const detail = `Cursor ACP process exited (code=${String(code)}, signal=${String(signal)})`;
			const stderr = this.stderrText();
			const error = new Error(stderr === "" ? detail : `${detail}: ${stderr}`);
			if (this.failure === null) this.failure = error;
			this.rejectAll(this.failure);
			this.abortController.abort();
		});
	}

	get signal(): AbortSignal {
		return this.abortController.signal;
	}

	request(
		method: string,
		params: unknown,
		timeoutMs: number | null = CURSOR_REQUEST_TIMEOUT_MS,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("Cursor ACP process is already closed."));
		if (this.failure !== null) return Promise.reject(this.failure);
		if (signal?.aborted === true) {
			return Promise.reject(new Error(`Cursor ACP request aborted: ${method}`));
		}

		const id = this.nextId++;
		return new Promise<unknown>((resolve, reject) => {
			const timeout =
				timeoutMs === null
					? null
					: setTimeout(() => {
							const pending = this.pending.get(id);
							if (pending !== undefined) {
								this.pending.delete(id);
								if (pending.removeAbortListener !== null) pending.removeAbortListener();
							}
							reject(new Error(`Cursor ACP request timed out: ${method}`));
						}, timeoutMs);
			timeout?.unref?.();

			const onAbort = () => {
				const pending = this.pending.get(id);
				if (pending !== undefined) {
					this.pending.delete(id);
					if (pending.timeout !== null) clearTimeout(pending.timeout);
					if (pending.removeAbortListener !== null) pending.removeAbortListener();
				}
				reject(new Error(`Cursor ACP request aborted: ${method}`));
			};
			if (signal !== undefined) signal.addEventListener("abort", onAbort, { once: true });
			const removeAbortListener =
				signal === undefined ? null : () => signal.removeEventListener("abort", onAbort);

			this.pending.set(id, { method, resolve, reject, timeout, removeAbortListener });
			try {
				this.write({ jsonrpc: "2.0", id, method, params });
			} catch (error) {
				this.pending.delete(id);
				if (timeout !== null) clearTimeout(timeout);
				if (removeAbortListener !== null) removeAbortListener();
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	notify(method: string, params: unknown): void {
		if (this.closed || this.failure !== null) return;
		try {
			this.write({ jsonrpc: "2.0", method, params });
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	fail(error: Error): void {
		if (this.failure === null) this.failure = error;
		this.abortController.abort();
		this.rejectAll(error);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.abortController.abort();
		this.rejectAll(new Error("Cursor ACP process closed."));
		this.lines.close();
		this.child.stdin.end();
		if (!this.exited) {
			this.child.kill("SIGTERM");
			this.killTimer = setTimeout(() => {
				if (!this.exited) this.child.kill("SIGKILL");
			}, 2_000);
			this.killTimer.unref?.();
		}
	}

	dispose(): void {
		this.close();
		this.lines.removeAllListeners();
		this.child.stdout.removeAllListeners();
		this.child.stderr.removeAllListeners();
		this.child.removeAllListeners("error");
		this.child.removeAllListeners("exit");
		if (this.exited) {
			this.clearKillTimer();
		} else {
			this.child.once("exit", () => {
				this.exited = true;
				this.clearKillTimer();
			});
		}
	}

	stderrText(): string {
		return this.stderrChunks.join("").trim().slice(-4000);
	}

	private appendStderr(chunk: string): void {
		if (chunk === "") return;
		this.stderrChunks.push(chunk);
		while (this.stderrChunks.join("").length > 8000 && this.stderrChunks.length > 1) {
			this.stderrChunks.shift();
		}
	}

	private clearKillTimer(): void {
		if (this.killTimer !== null) {
			clearTimeout(this.killTimer);
			this.killTimer = null;
		}
	}

	private write(message: Record<string, unknown>): void {
		if (this.closed || this.exited || !this.child.stdin.writable) return;
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private handleLine(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			this.fail(new Error("Cursor ACP sent a non-object JSON-RPC message."));
			return;
		}

		const method = "method" in parsed && typeof parsed.method === "string" ? parsed.method : null;
		const id =
			"id" in parsed && (typeof parsed.id === "string" || typeof parsed.id === "number")
				? parsed.id
				: undefined;
		const params = "params" in parsed ? parsed.params : undefined;

		if (method !== null && id !== undefined) {
			void this.handleRequest(id, method, params);
			return;
		}
		if (method !== null) {
			this.options.onNotification(method, params);
			return;
		}
		if (id !== undefined && ("result" in parsed || "error" in parsed)) {
			this.handleResponse(id, parsed);
		}
	}

	private handleResponse(id: JsonRpcId, message: object): void {
		const pending = this.pending.get(id);
		if (pending === undefined) return;
		this.pending.delete(id);
		if (pending.timeout !== null) clearTimeout(pending.timeout);
		if (pending.removeAbortListener !== null) pending.removeAbortListener();
		if ("error" in message && message.error !== undefined) {
			pending.reject(this.responseError(message.error, pending.method));
			return;
		}
		pending.resolve("result" in message ? message.result : undefined);
	}

	private async handleRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
		try {
			const result = await this.options.onRequest(method, params, this.signal);
			this.write({ jsonrpc: "2.0", id, result });
		} catch (error) {
			const responseError =
				error instanceof JsonRpcResponseError
					? error
					: new JsonRpcResponseError(-32603, error instanceof Error ? error.message : String(error));
			this.write({
				jsonrpc: "2.0",
				id,
				error: {
					code: responseError.code,
					message: responseError.message,
					...(responseError.data === undefined ? {} : { data: responseError.data }),
				},
			});
		}
	}

	private rejectAll(error: Error): void {
		for (const [id, pending] of this.pending) {
			this.pending.delete(id);
			if (pending.timeout !== null) clearTimeout(pending.timeout);
			if (pending.removeAbortListener !== null) pending.removeAbortListener();
			pending.reject(error);
		}
	}

	private responseError(rawError: unknown, method: string): Error {
		let message = "";
		if (
			typeof rawError === "object" &&
			rawError !== null &&
			"message" in rawError &&
			typeof rawError.message === "string" &&
			rawError.message.trim() !== ""
		) {
			message = rawError.message;
		}
		if (message === "") {
			message = typeof rawError === "string" ? rawError : stringifyUnknown(rawError);
		}
		return new Error(`Cursor ACP ${method} failed: ${message}`);
	}
}

// cursor-agent keeps its config under ~/.cursor and its login in the macOS
// keychain — BOTH resolved from HOME. Overriding HOME to an isolated dir (the
// old ADR 0016 posture) severs keychain access ("a keychain cannot be found to
// store cursor-user"), and cursor-agent exposes no config-dir env var to
// isolate config alone. So we follow t3code: never override HOME — delegate to
// the user's real cursor auth (same posture as delegated Claude Code auth),
// with CURSOR_API_KEY offered as the credential when present.
const cursorEnv = (apiKey: string | null): Record<string, string> => {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value !== "string") continue;
		if (key === "PATH" || key === "TMPDIR" || key === "LANG" || key.startsWith("LC_")) {
			env[key] = value;
		}
	}
	env.HOME = homedir();
	if (apiKey !== null) env.CURSOR_API_KEY = apiKey;
	return env;
};

const modelSlug = (model: string): string => {
	const prefix = "cursor/";
	return model.startsWith(prefix) ? model.slice(prefix.length) : model;
};

const MODE_GUIDANCE: Record<InteractionMode, string | undefined> = {
	agent: undefined,
	multitask: undefined,
	ask: [
		"## Honk Interaction Mode: Ask",
		"Explore the codebase and answer the user's question without making changes.",
		"",
		"=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===",
		"You are STRICTLY PROHIBITED from:",
		"- Creating new files, editing existing files, deleting files, renaming files, or moving files.",
		"- Applying patches, writing commits, changing configuration, installing packages, or updating lockfiles.",
		"- Running shell commands or browser automation that modify files, processes, network state, credentials, or external systems.",
		"- Using subagents, MCP mutation tools, edit/write/apply_patch tools, or any tool outside the read-only profile.",
		"",
		"Use read-only exploration only when needed for accuracy; do not attempt writes, edits, patches, or other mutations.",
		"Answer directly when the existing context is enough; inspect with read-only tools only when needed for accuracy.",
		"Do not be eager to implement. If the user asks how something works, explain it rather than changing it.",
		"Cite important code references with line ranges in the form startLine:endLine:filepath.",
		"Use ask_question only when blocked on a user decision or missing requirement, not for trivia you can infer or inspect.",
		"If edits are required, tell the user to switch to Build or Plan mode instead of attempting the change.",
	].join("\n"),
	plan: [
		"## Honk Interaction Mode: Plan",
		"Produce a concrete implementation plan through Honk's plan review surface.",
		"Research the codebase to find relevant files and review relevant docs before planning.",
		"Ask clarifying questions when requirements are ambiguous or the plan depends on missing decisions.",
		"If the user gives feedback while still in plan mode, keep iterating the plan rather than starting implementation.",
		"Use the create_plan tool as the final action once the plan is ready for review.",
		"When refining a previous plan, call create_plan again with the updated complete plan.",
		"The create_plan payload should include a short name, an overview, and the complete Markdown plan.",
		"The Markdown plan should include diagnosis, implementation steps with file paths or code references, verification, risks, and non-goals.",
		"Stop after creating the plan so the user can review, edit, or approve it before implementation.",
		"Do not change files, run mutating shell commands, create commits, or execute the plan.",
	].join("\n"),
	debug: [
		"## Honk Interaction Mode: Debug",
		"Systematically diagnose and fix bugs using runtime evidence.",
		"Start by identifying reproduction steps, expected behavior, actual behavior, and the smallest relevant code paths.",
		"Use read-only exploration and narrow reproduction commands to gather runtime evidence before editing.",
		"Keep diagnostic context focused and avoid stale evidence from previous reproductions.",
		"Prefer narrow diagnostic commands and explain the evidence before editing.",
		"When the cause is clear, make the smallest fix and verify it. If temporary instrumentation was added, remove it before finishing.",
	].join("\n"),
};

const buildTranscriptText = (
	transcript: ReadonlyArray<TranscriptEntry>,
	fallbackUserText: string,
): string => {
	const sections: Array<string> = [];
	for (const entry of transcript) {
		const text = entry.text.trim();
		if (text === "") continue;
		if (entry.role === "tool") {
			sections.push(text);
		} else {
			sections.push(`${entry.role === "user" ? "User" : "Assistant"}:\n${text}`);
		}
	}
	if (sections.length === 0) return fallbackUserText;
	return sections.join("\n\n").trim();
};

const promptText = (
	mode: InteractionMode,
	transcript: ReadonlyArray<TranscriptEntry>,
	userText: string,
): string => {
	const body = buildTranscriptText(transcript, userText);
	const guidance = MODE_GUIDANCE[mode];
	if (guidance === undefined) return body;
	if (body.trim() === "") return guidance;
	return `${guidance}\n\n${body}`;
};

const promptBlocks = (text: string, images: ReadonlyArray<PromptImage>): Array<AcpContentBlock> => {
	const blocks: Array<AcpContentBlock> = [{ type: "text", text }];
	for (const image of images) {
		blocks.push({ type: "image", data: image.base64, mimeType: image.mimeType });
	}
	return blocks;
};

const closePart = (ctx: TurnContext, open: Set<PartId>, partId: PartId): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (!open.has(partId)) return;
		open.delete(partId);
		yield* ctx.completePart(partId);
	});

const closeStream = (ctx: TurnContext, state: ProjectionState): Effect.Effect<void> =>
	Effect.gen(function* () {
		const stream = state.stream;
		if (stream === null) return;
		state.stream = null;
		yield* closePart(ctx, state.open, stream.partId);
	});

const appendStreamChunk = (
	ctx: TurnContext,
	state: ProjectionState,
	tag: StreamTag,
	delta: string,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (delta === "") return;
		if (state.stream !== null && state.stream.tag !== tag) {
			yield* closeStream(ctx, state);
		}
		if (state.stream === null) {
			const part: Part = {
				_tag: tag,
				id: ctx.newPartId(),
				messageId: ctx.assistantMessageId,
				turnId: ctx.turnId,
				origin: "cursor",
				state: "active",
				text: "",
			};
			state.stream = { tag, partId: part.id };
			state.open.add(part.id);
			yield* ctx.createPart(part);
		}
		yield* ctx.appendDelta(state.stream.partId, "text", delta);
	});

const updatePlan = (
	ctx: TurnContext,
	state: ProjectionState,
	markdown: string,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (markdown.trim() === "") return;
		yield* closeStream(ctx, state);
		if (state.plan === null) {
			const part: PlanPart = {
				_tag: "plan",
				id: ctx.newPartId(),
				messageId: ctx.assistantMessageId,
				turnId: ctx.turnId,
				origin: "cursor",
				state: "active",
				planId: PlanId.make(`plan_${randomUUID()}`),
				markdown,
				implementedAt: null,
			};
			state.plan = part;
			state.open.add(part.id);
			yield* ctx.createPart(part);
			return;
		}
		const updated: PlanPart = { ...state.plan, markdown };
		state.plan = updated;
		yield* ctx.updatePart(updated);
	});

const normalizeCommandValue = (value: unknown): string | undefined => {
	if (typeof value === "string" && value.trim() !== "") return value.trim();
	if (!Array.isArray(value)) return undefined;
	const parts: Array<string> = [];
	for (const part of value) {
		if (typeof part === "string" && part.trim() !== "") parts.push(part.trim());
	}
	return parts.length === 0 ? undefined : parts.join(" ");
};

const commandFromExecutableArgs = (rawInput: object): string | undefined => {
	const executable =
		"executable" in rawInput ? normalizeCommandValue(rawInput.executable) : undefined;
	const args = "args" in rawInput ? normalizeCommandValue(rawInput.args) : undefined;
	if (executable !== undefined && args !== undefined) return `${executable} ${args}`;
	return executable;
};

const extractCommandFromTitle = (title: string | undefined): string | undefined => {
	if (title === undefined) return undefined;
	const match = /`([^`]+)`/.exec(title);
	const command = match?.[1]?.trim();
	return command === undefined || command === "" ? undefined : command;
};

const inputFromRawInput = (rawInput: unknown): UnknownRecord => {
	const input: Record<string, unknown> = {};
	if (typeof rawInput === "object" && rawInput !== null && !Array.isArray(rawInput)) {
		for (const [key, value] of Object.entries(rawInput)) input[key] = value;
	} else if (rawInput !== undefined) {
		input.value = rawInput;
	}
	return input;
};

const displayFromCursorTool = (
	kind: string,
	title: string | undefined,
	rawInput: unknown,
): ToolDisplay => {
	if (kind === "execute") {
		let command: string | undefined;
		if (typeof rawInput === "object" && rawInput !== null && !Array.isArray(rawInput)) {
			command =
				("command" in rawInput ? normalizeCommandValue(rawInput.command) : undefined) ??
				commandFromExecutableArgs(rawInput) ??
				extractCommandFromTitle(title);
		} else {
			command = extractCommandFromTitle(title);
		}
		return { _tag: "bash", command: command ?? "" };
	}
	if (kind === "read") {
		const path =
			typeof rawInput === "object" &&
			rawInput !== null &&
			!Array.isArray(rawInput) &&
			"path" in rawInput &&
			typeof rawInput.path === "string"
				? rawInput.path
				: "";
		return { _tag: "read", path };
	}
	if (kind === "search") {
		let query = "";
		if (typeof rawInput === "object" && rawInput !== null && !Array.isArray(rawInput)) {
			if ("query" in rawInput && typeof rawInput.query === "string") query = rawInput.query;
			else if ("pattern" in rawInput && typeof rawInput.pattern === "string") query = rawInput.pattern;
		}
		return { _tag: "grep", query };
	}
	if (kind === "fetch") {
		const url =
			typeof rawInput === "object" &&
			rawInput !== null &&
			!Array.isArray(rawInput) &&
			"url" in rawInput &&
			typeof rawInput.url === "string"
				? rawInput.url
				: undefined;
		return { _tag: "web", kind: "fetch", ...(url === undefined ? {} : { url }) };
	}
	if (kind === "edit") {
		const path =
			typeof rawInput === "object" &&
			rawInput !== null &&
			!Array.isArray(rawInput) &&
			"path" in rawInput &&
			typeof rawInput.path === "string"
				? rawInput.path
				: undefined;
		return {
			_tag: "edit",
			files: path === undefined ? [] : [{ path, change: "update" }],
		};
	}
	return { _tag: "generic" };
};

const displayWithOutput = (display: ToolDisplay, output: string): ToolDisplay => {
	switch (display._tag) {
		case "bash":
		case "read":
		case "grep":
		case "find":
		case "mcp":
		case "generic":
			return { ...display, output };
		default:
			return display;
	}
};

const projectToolUpdate = (
	ctx: TurnContext,
	state: ProjectionState,
	update: object,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* closeStream(ctx, state);

		const toolCallId =
			"toolCallId" in update && typeof update.toolCallId === "string" && update.toolCallId.trim() !== ""
				? update.toolCallId
				: null;
		if (toolCallId === null || state.closedTools.has(toolCallId)) return;

		const previous = state.rawToolUpdates.get(toolCallId);
		const merged: Record<string, unknown> = {};
		if (previous !== undefined) {
			for (const [key, value] of Object.entries(previous)) merged[key] = value;
		}
		for (const [key, value] of Object.entries(update)) merged[key] = value;
		state.rawToolUpdates.set(toolCallId, merged);

		const kind =
			typeof merged.kind === "string" && merged.kind.trim() !== "" ? merged.kind : "cursor";
		const title =
			typeof merged.title === "string" && merged.title.trim() !== "" ? merged.title : undefined;
		const rawInput = merged.rawInput;
		const input = inputFromRawInput(rawInput);
		const display = displayFromCursorTool(kind, title, rawInput);
		const startedAt = now();

		let tracker = state.tools.get(toolCallId);
		if (tracker === undefined) {
			const part: ToolPart = {
				_tag: "tool",
				id: ctx.newPartId(),
				messageId: ctx.assistantMessageId,
				turnId: ctx.turnId,
				origin: "cursor",
				state: "active",
				callId: CallId.make(toolCallId),
				tool: kind,
				toolState: { _tag: "running", input, startedAt },
				display,
			};
			tracker = {
				partId: part.id,
				callId: toolCallId,
				tool: kind,
				input,
				startedAt,
				display,
			};
			state.tools.set(toolCallId, tracker);
			state.open.add(part.id);
			yield* ctx.createPart(part);
		} else {
			tracker.tool = kind;
			tracker.input = input;
			tracker.display = display;
			yield* ctx.updatePart({
				_tag: "tool",
				id: tracker.partId,
				messageId: ctx.assistantMessageId,
				turnId: ctx.turnId,
				origin: "cursor",
				state: "active",
				callId: CallId.make(tracker.callId),
				tool: tracker.tool,
				toolState: { _tag: "running", input: tracker.input, startedAt: tracker.startedAt },
				display: tracker.display,
			});
		}

		const status = merged.status;
		if (status !== "completed" && status !== "failed") return;

		const outputSource = merged.rawOutput ?? merged.output ?? merged.content;
		let outputText = "";
		if (typeof outputSource === "string" && outputSource.trim() !== "") {
			outputText = outputSource.trim();
		}
		if (outputText === "" && Array.isArray(outputSource)) {
			outputText = textFromAcpContentArray(outputSource);
		}
		if (
			outputText === "" &&
			typeof outputSource === "object" &&
			outputSource !== null &&
			!Array.isArray(outputSource)
		) {
			if ("stdout" in outputSource && typeof outputSource.stdout === "string" && outputSource.stdout.trim() !== "") {
				outputText = outputSource.stdout.trim();
			} else if ("stderr" in outputSource && typeof outputSource.stderr === "string" && outputSource.stderr.trim() !== "") {
				outputText = outputSource.stderr.trim();
			} else if ("output" in outputSource && typeof outputSource.output === "string" && outputSource.output.trim() !== "") {
				outputText = outputSource.output.trim();
			} else if ("text" in outputSource && typeof outputSource.text === "string" && outputSource.text.trim() !== "") {
				outputText = outputSource.text.trim();
			} else if ("message" in outputSource && typeof outputSource.message === "string" && outputSource.message.trim() !== "") {
				outputText = outputSource.message.trim();
			} else if ("summary" in outputSource && typeof outputSource.summary === "string" && outputSource.summary.trim() !== "") {
				outputText = outputSource.summary.trim();
			} else if ("content" in outputSource && typeof outputSource.content === "string" && outputSource.content.trim() !== "") {
				outputText = outputSource.content.trim();
			}
			if (outputText === "" && "content" in outputSource && Array.isArray(outputSource.content)) {
				outputText = textFromAcpContentArray(outputSource.content);
			}
			if (
				outputText === "" &&
				"error" in outputSource &&
				typeof outputSource.error === "string" &&
				outputSource.error.trim() !== ""
			) {
				outputText = outputSource.error.trim();
			}
		}
		const finishedAt = now();
		const toolState: ToolState =
			status === "failed"
				? {
						_tag: "error",
						input: tracker.input,
						error: outputText === "" ? "Cursor tool failed" : outputText,
						startedAt: tracker.startedAt,
						finishedAt,
					}
				: {
						_tag: "completed",
						input: tracker.input,
						output: outputText,
						title: tracker.tool,
						startedAt: tracker.startedAt,
						finishedAt,
					};
		yield* ctx.updatePart({
			_tag: "tool",
			id: tracker.partId,
			messageId: ctx.assistantMessageId,
			turnId: ctx.turnId,
			origin: "cursor",
			state: "active",
			callId: CallId.make(tracker.callId),
			tool: tracker.tool,
			toolState,
			display: displayWithOutput(tracker.display, outputText),
		});
		state.tools.delete(toolCallId);
		state.closedTools.add(toolCallId);
		yield* closePart(ctx, state.open, tracker.partId);
	});

const markdownFromPlanUpdate = (update: object): string | null => {
	if (!("entries" in update) || !Array.isArray(update.entries)) return null;
	const lines: Array<string> = [];
	for (const entry of update.entries) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
		const content = "content" in entry && typeof entry.content === "string" ? entry.content : "";
		if (content === "") continue;
		const status = "status" in entry && typeof entry.status === "string" ? entry.status : "pending";
		lines.push(`- [${status === "completed" ? "x" : " "}] ${content}`);
	}
	return lines.length === 0 ? null : lines.join("\n");
};

const markdownFromTodos = (params: unknown): string | null => {
	if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
	if (!("todos" in params) || !Array.isArray(params.todos)) return null;
	const lines: Array<string> = [];
	for (const todo of params.todos) {
		if (typeof todo !== "object" || todo === null || Array.isArray(todo)) continue;
		const content =
			"content" in todo && typeof todo.content === "string"
				? todo.content
				: "title" in todo && typeof todo.title === "string"
					? todo.title
					: "";
		if (content === "") continue;
		const status = "status" in todo && typeof todo.status === "string" ? todo.status : "pending";
		lines.push(`- [${status === "completed" ? "x" : " "}] ${content}`);
	}
	return lines.length === 0 ? null : lines.join("\n");
};

const projectSessionUpdate = (
	ctx: TurnContext,
	state: ProjectionState,
	params: unknown,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (typeof params !== "object" || params === null || Array.isArray(params)) return;
		if (!("update" in params)) return;
		const update = params.update;
		if (typeof update !== "object" || update === null || Array.isArray(update)) return;
		const sessionUpdate =
			"sessionUpdate" in update && typeof update.sessionUpdate === "string"
				? update.sessionUpdate
				: "";
		if (sessionUpdate === "agent_message_chunk" || sessionUpdate === "agent_thought_chunk") {
			const content = "content" in update ? update.content : undefined;
			if (
				typeof content === "object" &&
				content !== null &&
				"type" in content &&
				content.type === "text" &&
				"text" in content &&
				typeof content.text === "string"
			) {
				yield* appendStreamChunk(
					ctx,
					state,
					sessionUpdate === "agent_message_chunk" ? "text" : "reasoning",
					content.text,
				);
			}
			return;
		}

		yield* closeStream(ctx, state);
		if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") {
			yield* projectToolUpdate(ctx, state, update);
			return;
		}
		if (sessionUpdate === "plan") {
			const markdown = markdownFromPlanUpdate(update);
			if (markdown !== null) yield* updatePlan(ctx, state, markdown);
		}
	});

const parseCursorQuestions = (params: unknown): {
	readonly title: string;
	readonly questions: Array<Question>;
} => {
	const questions: Array<Question> = [];
	let title = "";
	const collectQuestion = (rawQuestion: unknown) => {
		if (typeof rawQuestion !== "object" || rawQuestion === null || Array.isArray(rawQuestion)) return;
		const text =
			"question" in rawQuestion && typeof rawQuestion.question === "string" && rawQuestion.question.trim() !== ""
				? rawQuestion.question
				: "prompt" in rawQuestion && typeof rawQuestion.prompt === "string" && rawQuestion.prompt.trim() !== ""
					? rawQuestion.prompt
					: "title" in rawQuestion && typeof rawQuestion.title === "string" && rawQuestion.title.trim() !== ""
						? rawQuestion.title
						: "";
		if (text === "") return;
		const options: Array<{ label: string; description?: string }> = [];
		if ("options" in rawQuestion && Array.isArray(rawQuestion.options)) {
			for (const rawOption of rawQuestion.options) {
				if (typeof rawOption !== "object" || rawOption === null || Array.isArray(rawOption)) continue;
				const label =
					"label" in rawOption && typeof rawOption.label === "string" && rawOption.label.trim() !== ""
						? rawOption.label
						: "text" in rawOption && typeof rawOption.text === "string" && rawOption.text.trim() !== ""
							? rawOption.text
							: "title" in rawOption && typeof rawOption.title === "string" && rawOption.title.trim() !== ""
								? rawOption.title
								: "";
				if (label === "") continue;
				const description =
					"description" in rawOption && typeof rawOption.description === "string"
						? rawOption.description
						: undefined;
				options.push({ label, ...(description === undefined ? {} : { description }) });
			}
		}
		questions.push({
			id: QuestionId.make(`q_${randomUUID()}`),
			text,
			options:
				options.length === 0
					? [{ label: "Continue" }, { label: "Stop" }]
					: options,
		});
	};

	if (typeof params === "object" && params !== null && !Array.isArray(params)) {
		if ("title" in params && typeof params.title === "string" && params.title.trim() !== "") {
			title = params.title;
		}
		if ("questions" in params && Array.isArray(params.questions)) {
			for (const rawQuestion of params.questions) collectQuestion(rawQuestion);
		} else {
			collectQuestion(params);
		}
	}

	if (questions.length === 0) {
		const raw = stringifyUnknown(params);
		questions.push({
			id: QuestionId.make(`q_${randomUUID()}`),
			text: raw === "" ? "Cursor requested input." : raw,
			options: [{ label: "Continue" }, { label: "Stop" }],
		});
	}
	return { title: title === "" ? questions[0]?.text ?? "Cursor Question" : title, questions };
};

const handleAskQuestion = async (
	ctx: TurnContext,
	state: ProjectionState,
	params: unknown,
	signal: AbortSignal,
): Promise<unknown> => {
	await Effect.runPromise(closeStream(ctx, state));
	const parsed = parseCursorQuestions(params);
	const questionId = QuestionId.make(`q_${randomUUID()}`);
	const part: QuestionPart = {
		_tag: "question",
		id: ctx.newPartId(),
		messageId: ctx.assistantMessageId,
		turnId: ctx.turnId,
		origin: "cursor",
		state: "active",
		questionId,
		title: parsed.title,
		status: "pending",
		questions: parsed.questions,
	};
	state.open.add(part.id);
	await Effect.runPromise(ctx.createPart(part));
	try {
		const answers = await Effect.runPromise(ctx.awaitAnswer(questionId), { signal });
		const selected: Array<string> = [];
		for (const question of parsed.questions) {
			const value = answers[String(question.id)];
			if (Array.isArray(value)) {
				for (const item of value) {
					if (typeof item === "string" && item !== "") selected.push(item);
				}
			} else if (typeof value === "string" && value !== "") {
				selected.push(value);
			}
		}
		return { answers: selected };
	} catch {
		return { answers: [] };
	} finally {
		if (state.open.delete(part.id)) {
			await Effect.runPromise(ctx.completePart(part.id));
		}
	}
};

const selectPermissionOption = (params: unknown): string => {
	if (typeof params !== "object" || params === null || Array.isArray(params)) return "allow-once";
	if (!("options" in params) || !Array.isArray(params.options)) return "allow-once";
	let firstOption: string | null = null;
	let allowAlways: string | null = null;
	for (const option of params.options) {
		if (typeof option !== "object" || option === null || Array.isArray(option)) continue;
		const optionId =
			"optionId" in option && typeof option.optionId === "string" && option.optionId !== ""
				? option.optionId
				: null;
		if (optionId === null) continue;
		if (firstOption === null) firstOption = optionId;
		if ("kind" in option && option.kind === "allow_once") return optionId;
		if ("kind" in option && option.kind === "allow_always" && allowAlways === null) {
			allowAlways = optionId;
		}
	}
	return allowAlways ?? firstOption ?? "allow-once";
};

const handleCursorRequest = async (
	ctx: TurnContext,
	state: ProjectionState,
	method: string,
	params: unknown,
	signal: AbortSignal,
	waitForProjection: () => Promise<void>,
): Promise<unknown> => {
	await waitForProjection();
	if (method === "session/request_permission") {
		return {
			outcome: signal.aborted
				? { outcome: "cancelled" }
				: { outcome: "selected", optionId: selectPermissionOption(params) },
		};
	}
	if (method === "cursor/ask_question") {
		return await handleAskQuestion(ctx, state, params, signal);
	}
	if (method === "cursor/create_plan") {
		if (
			typeof params === "object" &&
			params !== null &&
			!Array.isArray(params) &&
			"plan" in params &&
			typeof params.plan === "string" &&
			params.plan.trim() !== ""
		) {
			await Effect.runPromise(updatePlan(ctx, state, params.plan));
		}
		return { accepted: true };
	}
	throw new JsonRpcResponseError(-32601, `Unsupported Cursor ACP request: ${method}`);
};

const recordContinuity = (ctx: TurnContext, state: ProjectionState): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (state.sessionId === null) return;
		if (ctx.sessionRef !== state.sessionId) {
			yield* ctx.setSessionRef(state.sessionId);
		}
		yield* ctx.setTurnLeaf(state.sessionId);
	});

const closeOpenParts = (ctx: TurnContext, state: ProjectionState): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* closeStream(ctx, state);
		for (const partId of [...state.open]) {
			yield* closePart(ctx, state.open, partId);
		}
	});

const initializeParams = () => ({
	protocolVersion: 1,
	clientCapabilities: {
		fs: { readTextFile: false, writeTextFile: false },
		terminal: false,
		_meta: { parameterizedModelPicker: true },
	},
	clientInfo: { name: "honk", version: CLIENT_VERSION },
});

const readStopReason = (response: unknown): string | null => {
	if (typeof response !== "object" || response === null || Array.isArray(response)) return null;
	return "stopReason" in response && typeof response.stopReason === "string" ? response.stopReason : null;
};

const readInitializeDetail = (response: unknown): string | null => {
	let name: string | null = null;
	let version: string | null = null;
	const readNested = (value: unknown) => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return;
		if ("name" in value && typeof value.name === "string" && value.name.trim() !== "") {
			name = value.name;
		}
		if ("version" in value && typeof value.version === "string" && value.version.trim() !== "") {
			version = value.version;
		}
	};
	if (typeof response === "object" && response !== null && !Array.isArray(response)) {
		if ("name" in response && typeof response.name === "string" && response.name.trim() !== "") {
			name = response.name;
		}
		if ("version" in response && typeof response.version === "string" && response.version.trim() !== "") {
			version = response.version;
		}
		if ("agent" in response) readNested(response.agent);
		if ("agentInfo" in response) readNested(response.agentInfo);
		if ("serverInfo" in response) readNested(response.serverInfo);
	}
	if (name !== null && version !== null) return `${name} ${version}`;
	return version ?? name;
};

export const makeCursorHarness = (options: CursorHarnessOptions): Harness => ({
	capabilities: { steer: false },
	runTurn: (ctx) =>
		Effect.gen(function* () {
			const apiKey = options.apiKey();
			if (apiKey === null) {
				return yield* Effect.die(new Error("Cursor API key is unavailable at use time."));
			}
			yield* Effect.tryPromise(() => mkdir(options.cursorDir, { recursive: true })).pipe(Effect.orDie);

			const state: ProjectionState = {
				open: new Set(),
				rawToolUpdates: new Map(),
				tools: new Map(),
				closedTools: new Set(),
				stream: null,
				plan: null,
				sessionId: null,
			};

			let rpc: CursorAcpChild | null = null;
			let projectionError: Error | null = null;
			let projectionTail: Promise<void> = Promise.resolve();
			let stopped = false;
			const waitForProjection = async () => {
				await projectionTail;
				if (projectionError !== null) throw projectionError;
			};
			const enqueueProjection = (effect: Effect.Effect<void>): void => {
				if (stopped) return;
				const running = projectionTail.then(async () => {
					if (projectionError !== null) throw projectionError;
					await Effect.runPromise(effect);
				});
				projectionTail = running.catch((error: unknown) => {
					const failure = error instanceof Error ? error : new Error(String(error));
					if (projectionError === null) projectionError = failure;
					rpc?.fail(failure);
				});
			};

			const child = new CursorAcpChild({
				command: "agent",
				args: ["--model", modelSlug(String(ctx.model)), "acp"],
				cwd: ctx.cwd,
				env: cursorEnv(apiKey),
				onNotification: (method, params) => {
					if (method === "session/update") {
						enqueueProjection(projectSessionUpdate(ctx, state, params));
					}
					if (method === "cursor/update_todos") {
						const markdown = markdownFromTodos(params);
						if (markdown !== null) enqueueProjection(updatePlan(ctx, state, markdown));
					}
				},
				onRequest: (method, params, signal) =>
					handleCursorRequest(ctx, state, method, params, signal, waitForProjection),
			});
			rpc = child;

			const finishTurn = (exit: Exit.Exit<void, never>) =>
				Effect.gen(function* () {
					stopped = true;
					if (!Exit.isSuccess(exit) && state.sessionId !== null) {
						child.notify("session/cancel", { sessionId: state.sessionId });
						child.close();
					}
					yield* Effect.tryPromise(waitForProjection).pipe(Effect.exit);
					yield* closeOpenParts(ctx, state);
					yield* recordContinuity(ctx, state);
				});

			yield* Effect.gen(function* () {
				yield* Effect.tryPromise((signal) =>
					child.request("initialize", initializeParams(), CURSOR_REQUEST_TIMEOUT_MS, signal),
				).pipe(Effect.orDie);
				yield* Effect.tryPromise((signal) =>
					child.request("authenticate", { methodId: "cursor_login" }, CURSOR_REQUEST_TIMEOUT_MS, signal),
				).pipe(Effect.orDie);
				const sessionResponse = yield* Effect.tryPromise((signal) =>
					child.request(
						"session/new",
						{ cwd: ctx.cwd, mcpServers: [] },
						CURSOR_REQUEST_TIMEOUT_MS,
						signal,
					),
				).pipe(Effect.orDie);
				if (
					typeof sessionResponse !== "object" ||
					sessionResponse === null ||
					Array.isArray(sessionResponse) ||
					!("sessionId" in sessionResponse) ||
					typeof sessionResponse.sessionId !== "string" ||
					sessionResponse.sessionId.trim() === ""
				) {
					return yield* Effect.die(new Error("Cursor ACP session/new did not return a session id."));
				}
				state.sessionId = sessionResponse.sessionId;

				const transcript = yield* ctx.transcript();
				const response = yield* Effect.tryPromise((signal) =>
					child.request(
						"session/prompt",
						{
							sessionId: sessionResponse.sessionId,
							prompt: promptBlocks(promptText(ctx.interactionMode, transcript, ctx.userText), ctx.images),
						},
						null,
						signal,
					),
				).pipe(Effect.orDie);
				yield* Effect.tryPromise(waitForProjection).pipe(Effect.orDie);
				if (readStopReason(response) === "cancelled") return yield* Effect.interrupt;
			}).pipe(
				Effect.onExit(finishTurn),
				Effect.ensuring(
					Effect.sync(() => {
						child.dispose();
					}),
				),
			);
		}),
});

export const cursorProbe = async (): Promise<HarnessStatus> => {
	let child: CursorAcpChild | null = null;
	let timeout: ReturnType<typeof setTimeout> | null = null;
	try {
		child = new CursorAcpChild({
			command: "agent",
			args: ["acp"],
			cwd: process.cwd(),
			env: cursorEnv(null),
			onNotification: () => {},
			onRequest: async () => {
				throw new JsonRpcResponseError(-32601, "Cursor probe does not support incoming requests.");
			},
		});
		const initialized = await Promise.race([
			child.request("initialize", initializeParams(), null),
			new Promise<"timeout">((resolve) => {
				timeout = setTimeout(() => {
					resolve("timeout");
				}, 10_000);
			}),
		]);
		if (timeout !== null) clearTimeout(timeout);
		timeout = null;
		if (initialized === "timeout") {
			child.close();
			return { harness: "cursor", available: false, detail: null };
		}
		const detail = readInitializeDetail(initialized);
		child.close();
		return { harness: "cursor", available: true, detail };
	} catch {
		if (child !== null) child.close();
		return { harness: "cursor", available: false, detail: null };
	} finally {
		if (timeout !== null) clearTimeout(timeout);
		if (child !== null) child.dispose();
	}
};
