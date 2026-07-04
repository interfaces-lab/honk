import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
	type AccountInfo,
	type CanUseTool,
	type McpServerConfig,
	type OnUserDialog,
	type Options as ClaudeQueryOptions,
	type Query,
	type SDKMessage,
	type SDKUserMessage,
	createSdkMcpServer,
	getSessionMessages,
	query,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import { Effect, Exit } from "effect";
import { z } from "zod/v4";
import {
	type HarnessStatus,
	type InteractionMode,
	type Part,
	type PartId,
	type SubagentRun,
	type ToolDisplay,
	type ToolState,
	type UnknownRecord,
	CallId,
	PlanId,
	QuestionId,
} from "@honk/api/core/v1";
import type { Harness, PromptImage, TurnContext } from "./harness";

export interface ClaudeHarnessOptions {
	/** HONK_HOME/harness/claude-code — debug logs ONLY (ADR 0018). */
	readonly claudeDir: string;
}

type ToolPart = Extract<Part, { readonly _tag: "tool" }>;
type StepPart = Extract<Part, { readonly _tag: "step" }>;
type NoticePart = Extract<Part, { readonly _tag: "notice" }>;
type QuestionPart = Extract<Part, { readonly _tag: "question" }>;

/**
 * Per-turn projection state. Claude streams ONE assistant message at a time,
 * so content blocks key by index alone, reset at every message_start — the
 * projection never depends on stream_event.uuid, whose per-frame semantics
 * the SDK leaves unspecified. `currentStep` is the in-flight model call; the
 * complete assistant SDKMessage attaches usage to it and closes it.
 */
interface ProjectionState {
	readonly open: Set<PartId>;
	readonly streams: Map<number, PartId>;
	readonly tools: Map<string, ToolTracker>;
	/** taskId → the Task tool_use that owns it (null = free-standing task step). */
	readonly taskOwners: Map<string, string | null>;
	readonly taskSteps: Map<string, StepPart>;
	readonly taskRuns: Map<string, SubagentRun>;
	currentStep: StepPart | null;
	retryNotice: NoticePart | null;
	lastSessionId: string | null;
	lastAssistantUuid: string | null;
	resultError: { readonly subtype: string; readonly errors: ReadonlyArray<string> } | null;
}

interface ToolTracker {
	readonly partId: PartId;
	readonly callId: string;
	readonly toolName: string;
	readonly input: UnknownRecord;
	readonly startedAt: string;
	display: ToolDisplay;
}

const DEFAULT_DEBUG_LOG_LINES = 100;
const MAX_DEBUG_LOG_LINES = 2_000;

const ASK_TOOLS = ["Read", "Grep", "Glob", "AskUserQuestion"];
const DEBUG_TOOLS = ["Read", "Grep", "Glob", "Bash", "Edit", "MultiEdit", "Write", "AskUserQuestion"];

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
		"Only read-only tools are enabled in this mode: Read, Grep, Glob, and AskUserQuestion.",
		"Answer directly when the existing context is enough; inspect with read-only tools only when needed for accuracy.",
		"Do not be eager to implement. If the user asks how something works, explain it rather than changing it.",
		"Cite important code references with line ranges in the form startLine:endLine:filepath.",
		"Use AskUserQuestion only when blocked on a user decision or missing requirement, not for trivia you can infer or inspect.",
		"If edits are required, tell the user to switch to Build or Plan mode instead of attempting the change.",
	].join("\n"),
	plan: undefined,
	debug: [
		"## Honk Interaction Mode: Debug",
		"Systematically diagnose and fix bugs using runtime evidence.",
		"Start by identifying reproduction steps, expected behavior, actual behavior, and the smallest relevant code paths.",
		"Use debug_logs with action:path to get the log file path before running instrumented or reproduction commands, append command output to that file, then use debug_logs with action:read to inspect the latest traces.",
		"Use debug_logs with action:clear before a fresh reproduction when previous logs would pollute the diagnosis.",
		"Prefer narrow diagnostic commands and explain the evidence before editing.",
		"When the cause is clear, make the smallest fix and verify it. If temporary instrumentation was added, remove it before finishing.",
	].join("\n"),
};

const now = (): string => new Date().toISOString();

const debugLogPath = (claudeDir: string, cwd: string): string =>
	join(
		claudeDir,
		"honk-debug-logs",
		createHash("sha256").update(cwd).digest("hex").slice(0, 16),
		"debug.log",
	);

const textContent = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let text = "";
	const blockTypes: Array<string> = [];
	for (const item of content) {
		if (typeof item !== "object" || item === null || !("type" in item)) {
			blockTypes.push("[unknown]");
			continue;
		}
		blockTypes.push(typeof item.type === "string" ? `[${item.type}]` : "[unknown]");
		if (item.type !== "text") continue;
		if ("text" in item && typeof item.text === "string") text += item.text;
	}
	return text === "" && blockTypes.length > 0 ? blockTypes.join("\n") : text;
};

const closePart = (ctx: TurnContext, open: Set<PartId>, partId: PartId): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (!open.has(partId)) return;
		open.delete(partId);
		yield* ctx.completePart(partId);
	});

const recordContinuity = (ctx: TurnContext, state: ProjectionState): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (state.lastSessionId !== null && state.lastSessionId !== ctx.sessionRef) {
			yield* ctx.setSessionRef(state.lastSessionId);
		}
		if (state.lastSessionId !== null && state.lastAssistantUuid !== null) {
			yield* ctx.setTurnLeaf(`${state.lastSessionId}/${state.lastAssistantUuid}`);
		}
	});

const makeDebugMcpServer = (claudeDir: string, cwd: string): McpServerConfig =>
	createSdkMcpServer({
		name: "honk_debug",
		version: "1.0.0",
		tools: [
			tool(
				"debug_logs",
				"Get the current debug log file path, read recent debug log lines, or clear the debug log before a fresh reproduction.",
				{
					action: z.enum(["path", "read", "clear"]).describe("Debug log operation."),
					lines: z
						.number()
						.optional()
						.describe("Maximum number of trailing log lines to return for read. Defaults to 100."),
				},
				async (args) => {
					const logFilePath = debugLogPath(claudeDir, cwd);
					await mkdir(dirname(logFilePath), { recursive: true });
					await writeFile(logFilePath, "", { flag: "a" });

					if (args.action === "clear") {
						await writeFile(logFilePath, "");
						return {
							content: [{ type: "text", text: `Cleared debug log at ${logFilePath}.` }],
						};
					}
					if (args.action === "path") {
						return {
							content: [{ type: "text", text: `Debug log path: ${logFilePath}` }],
						};
					}

					const requested =
						args.lines === undefined || !Number.isFinite(args.lines)
							? DEFAULT_DEBUG_LOG_LINES
							: args.lines;
					const lineCount = Math.max(1, Math.min(MAX_DEBUG_LOG_LINES, Math.floor(requested)));
					const content = await readFile(logFilePath, "utf8");
					const allLines = content === "" ? [] : content.replace(/\n$/, "").split(/\r?\n/);
					const lines = allLines.slice(-lineCount);
					return {
						content: [
							{
								type: "text",
								text:
									lines.length === 0
										? `Debug log is empty at ${logFilePath}.`
										: `Read ${lines.length} of ${allLines.length} debug log lines from ${logFilePath}.\n\n${lines.join("\n")}`,
							},
						],
					};
				},
			),
		],
	});

const claudeEnv = (): Record<string, string | undefined> => {
	const env: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (key === "CLAUDE_CONFIG_DIR") continue;
		if (
			key === "PATH" ||
			key === "HOME" ||
			key === "USER" ||
			key === "SHELL" ||
			key === "TMPDIR" ||
			key === "LANG" ||
			key.startsWith("LC_") ||
			key.startsWith("CLAUDE_") ||
			key.startsWith("ANTHROPIC_")
		) {
			env[key] = value;
		}
	}
	return env;
};

async function* claudePrompt(ctx: TurnContext): AsyncGenerator<SDKUserMessage> {
	const content: Exclude<SDKUserMessage["message"]["content"], string> = [];
	if (ctx.userText !== "") {
		content.push({ type: "text", text: ctx.userText });
	}
	for (const image of ctx.images) {
		if (
			image.mimeType !== "image/jpeg" &&
			image.mimeType !== "image/png" &&
			image.mimeType !== "image/gif" &&
			image.mimeType !== "image/webp"
		) {
			continue;
		}
		content.push({
			type: "image",
			source: { type: "base64", media_type: image.mimeType, data: image.base64 },
		});
	}
	yield {
		type: "user",
		message: { role: "user", content: content.length === 0 ? "" : content },
		parent_tool_use_id: null,
	};
}

/**
 * Leaf-tip check decides plain-resume vs sibling fork; an UNREADABLE session
 * means fresh start (pi's self-healing rule) — resuming a session the CLI
 * cannot load would brick the Thread with a defect every turn, and the fresh
 * session's continuity recording replaces the ref.
 */
const resolveResume = async (
	resumeLeaf: string | null,
	cwd: string,
): Promise<{ readonly resume?: string; readonly resumeSessionAt?: string; readonly forkSession?: boolean }> => {
	if (resumeLeaf === null) return {};
	const slash = resumeLeaf.indexOf("/");
	if (slash <= 0 || slash >= resumeLeaf.length - 1) return {};
	const sessionId = resumeLeaf.slice(0, slash);
	const uuid = resumeLeaf.slice(slash + 1);
	try {
		const messages = await getSessionMessages(sessionId, { dir: cwd });
		let matchedIndex = -1;
		for (const [index, message] of messages.entries()) {
			if (message.uuid === uuid) matchedIndex = index;
		}
		if (matchedIndex === -1) {
			return {};
		}
		if (matchedIndex === messages.length - 1) {
			return { resume: sessionId };
		}
		// Resuming at a non-tip point WITHOUT forking risks destructive
		// truncation of the abandoned tail — always fork off-tip.
		return { resume: sessionId, resumeSessionAt: uuid, forkSession: true };
	} catch {
		return {};
	}
};

const emitNotice = (
	ctx: TurnContext,
	state: ProjectionState,
	severity: NoticePart["severity"],
	name: string,
	message: string,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		const part: NoticePart = {
			_tag: "notice",
			id: ctx.newPartId(),
			messageId: ctx.assistantMessageId,
			turnId: ctx.turnId,
			origin: "claude-code",
			state: "active",
			severity,
			name,
			message,
		};
		state.open.add(part.id);
		yield* ctx.createPart(part);
		yield* closePart(ctx, state.open, part.id);
	});

/** One step per model call: message_start opens it, the complete assistant message settles usage and closes it. */
const openStep = (
	ctx: TurnContext,
	state: ProjectionState,
	model: string | undefined,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (state.currentStep !== null) return;
		const part: StepPart = {
			_tag: "step",
			id: ctx.newPartId(),
			messageId: ctx.assistantMessageId,
			turnId: ctx.turnId,
			origin: "claude-code",
			state: "active",
			...(model === undefined ? {} : { model }),
		};
		state.currentStep = part;
		state.open.add(part.id);
		yield* ctx.createPart(part);
	});

const settleStep = (
	ctx: TurnContext,
	state: ProjectionState,
	usage:
		| {
				readonly inputTokens?: number;
				readonly outputTokens?: number;
				readonly cacheReadTokens?: number;
				readonly cacheWriteTokens?: number;
				readonly totalTokens?: number;
		  }
		| undefined,
	model: string | undefined,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* openStep(ctx, state, model);
		const part = state.currentStep;
		state.currentStep = null;
		if (part === null) return;
		yield* ctx.updatePart({
			...part,
			...(model === undefined ? {} : { model }),
			...(usage === undefined ? {} : { usage }),
		});
		yield* closePart(ctx, state.open, part.id);
	});

const projectQuestion = (
	ctx: TurnContext,
	state: ProjectionState,
	request: Parameters<OnUserDialog>[0],
	options: Parameters<OnUserDialog>[1],
): Promise<Awaited<ReturnType<OnUserDialog>>> =>
	(async () => {
		if (request.dialogKind !== "askUserQuestion") return { behavior: "cancelled" };
		const rawQuestions =
			"questions" in request.payload && Array.isArray(request.payload.questions)
				? request.payload.questions
				: [];
		const questions: Array<QuestionPart["questions"][number]> = [];
		const resultQuestions: Array<{
			question: string;
			header: string;
			options: Array<{ label: string; description: string; preview?: string }>;
			multiSelect: boolean;
		}> = [];
		for (const rawQuestion of rawQuestions) {
			if (typeof rawQuestion !== "object" || rawQuestion === null) continue;
			const text =
				"question" in rawQuestion && typeof rawQuestion.question === "string"
					? rawQuestion.question
					: "";
			const header =
				"header" in rawQuestion && typeof rawQuestion.header === "string" ? rawQuestion.header : "";
			const rawOptions = "options" in rawQuestion ? rawQuestion.options : undefined;
			const optionsForPart: Array<{ label: string; description?: string }> = [];
			const optionsForResult: Array<{ label: string; description: string; preview?: string }> = [];
			if (Array.isArray(rawOptions)) {
				for (const rawOption of rawOptions) {
					if (typeof rawOption !== "object" || rawOption === null) continue;
					const label =
						"label" in rawOption && typeof rawOption.label === "string" ? rawOption.label : "";
					if (label === "") continue;
					const description =
						"description" in rawOption && typeof rawOption.description === "string"
							? rawOption.description
							: "";
					const preview =
						"preview" in rawOption && typeof rawOption.preview === "string"
							? rawOption.preview
							: undefined;
					optionsForPart.push({
						label,
						...(description === "" ? {} : { description }),
					});
					optionsForResult.push({
						label,
						description,
						...(preview === undefined ? {} : { preview }),
					});
				}
			}
			if (text === "" || optionsForPart.length < 2) continue;
			const multiSelect =
				"multiSelect" in rawQuestion && rawQuestion.multiSelect === true ? true : undefined;
			questions.push({
				id: QuestionId.make(`q_${randomUUID()}`),
				text,
				...(header === "" ? {} : { header }),
				options: optionsForPart,
				...(multiSelect === undefined ? {} : { multiSelect }),
			});
			resultQuestions.push({
				question: text,
				header,
				options: optionsForResult,
				multiSelect: multiSelect === true,
			});
		}
		if (questions.length === 0) return { behavior: "cancelled" };

		const questionId = QuestionId.make(`q_${randomUUID()}`);
		const title = questions[0]?.header ?? questions[0]?.text ?? "Question";
		const part: QuestionPart = {
			_tag: "question",
			id: ctx.newPartId(),
			messageId: ctx.assistantMessageId,
			turnId: ctx.turnId,
			origin: "claude-code",
			state: "active",
			questionId,
			title,
			status: "pending",
			questions,
		};
		state.open.add(part.id);
		await Effect.runPromise(ctx.createPart(part));
		try {
			const answers = await Effect.runPromise(ctx.awaitAnswer(questionId), { signal: options.signal });
			const resultAnswers: Record<string, string> = {};
			for (const question of questions) {
				const values = answers[String(question.id)];
				// Canonical shape is an array of labels; a bare string is tolerated.
				const labels = Array.isArray(values)
					? values.filter((value): value is string => typeof value === "string" && value !== "")
					: typeof values === "string" && values !== ""
						? [values]
						: [];
				if (labels.length > 0) resultAnswers[question.text] = labels.join(", ");
			}
			return {
				behavior: "completed",
				result: {
					questions: resultQuestions,
					answers: resultAnswers,
				},
			};
		} catch {
			return { behavior: "cancelled" };
		} finally {
			state.open.delete(part.id);
			await Effect.runPromise(ctx.completePart(part.id));
		}
	})();

const mapTaskStatus = (status: string): SubagentRun["status"] => {
	switch (status) {
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "stopped":
		case "killed":
			return "aborted";
		case "pending":
			return "queued";
		default:
			return "running";
	}
};

const updateTaskRun = (
	ctx: TurnContext,
	state: ProjectionState,
	taskId: string,
	label: string,
	status: SubagentRun["status"],
	prompt: string | undefined,
	finalText: string | undefined,
	errorMessage: string | undefined,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		// task_updated carries no tool_use_id: ownership was pinned at task_started.
		const toolUseId = state.taskOwners.get(taskId) ?? null;
		if (toolUseId === null) {
			const existing = state.taskSteps.get(taskId);
			const metadata: UnknownRecord = {
				taskId,
				label,
				status,
				...(prompt === undefined ? {} : { prompt }),
				...(finalText === undefined ? {} : { finalText }),
				...(errorMessage === undefined ? {} : { errorMessage }),
			};
			if (existing === undefined) {
				const part: StepPart = {
					_tag: "step",
					id: ctx.newPartId(),
					messageId: ctx.assistantMessageId,
					turnId: ctx.turnId,
					origin: "claude-code",
					state: "active",
					metadata,
				};
				state.taskSteps.set(taskId, part);
				state.open.add(part.id);
				yield* ctx.createPart(part);
				if (status === "completed" || status === "failed" || status === "aborted") {
					yield* closePart(ctx, state.open, part.id);
				}
				return;
			}
			const updated: StepPart = { ...existing, metadata };
			state.taskSteps.set(taskId, updated);
			yield* ctx.updatePart(updated);
			if (status === "completed" || status === "failed" || status === "aborted") {
				yield* closePart(ctx, state.open, existing.id);
			}
			return;
		}

		const tracker = state.tools.get(toolUseId);
		if (tracker === undefined || tracker.display._tag !== "subagent") return;
		const previous = state.taskRuns.get(taskId);
		const run: SubagentRun = {
			id: taskId,
			label: label === "" ? previous?.label ?? taskId : label,
			status,
			...(prompt === undefined ? (previous?.prompt === undefined ? {} : { prompt: previous.prompt }) : { prompt }),
			...(finalText === undefined
				? previous?.finalText === undefined
					? {}
					: { finalText: previous.finalText }
				: { finalText }),
			...(errorMessage === undefined
				? previous?.errorMessage === undefined
					? {}
					: { errorMessage: previous.errorMessage }
				: { errorMessage }),
		};
		state.taskRuns.set(taskId, run);
		const runs = tracker.display.runs.filter((candidate) => candidate.id !== taskId);
		const display: ToolDisplay = { ...tracker.display, runs: [...runs, run] };
		tracker.display = display;
		yield* ctx.updatePart({
			_tag: "tool",
			id: tracker.partId,
			messageId: ctx.assistantMessageId,
			turnId: ctx.turnId,
			origin: "claude-code",
			state: "active",
			callId: CallId.make(tracker.callId),
			tool: tracker.toolName,
			toolState: { _tag: "running", input: tracker.input, startedAt: tracker.startedAt },
			display,
		});
	});

const projectMessage = (ctx: TurnContext, state: ProjectionState, message: SDKMessage): Effect.Effect<boolean> =>
	Effect.gen(function* () {
		if ("session_id" in message) state.lastSessionId = message.session_id;

		switch (message.type) {
			case "stream_event": {
				if (message.parent_tool_use_id !== null) return false;
				const event = message.event;
				switch (event.type) {
					case "message_start": {
						// A new model call: any streams left open by a dropped stop
						// event must not swallow the new message's deltas.
						for (const partId of state.streams.values()) {
							yield* closePart(ctx, state.open, partId);
						}
						state.streams.clear();
						yield* openStep(ctx, state, event.message.model);
						return false;
					}
					case "content_block_start": {
						yield* openStep(ctx, state, undefined);
						if (event.content_block.type !== "text" && event.content_block.type !== "thinking") {
							return false;
						}
						const part: Part = {
							_tag: event.content_block.type === "text" ? "text" : "reasoning",
							id: ctx.newPartId(),
							messageId: ctx.assistantMessageId,
							turnId: ctx.turnId,
							origin: "claude-code",
							state: "active",
							text: "",
						};
						state.streams.set(event.index, part.id);
						state.open.add(part.id);
						yield* ctx.createPart(part);
						return false;
					}
					case "content_block_delta": {
						const partId = state.streams.get(event.index);
						if (partId === undefined) return false;
						if (event.delta.type === "text_delta") {
							yield* ctx.appendDelta(partId, "text", event.delta.text);
							return false;
						}
						if (event.delta.type === "thinking_delta") {
							yield* ctx.appendDelta(partId, "text", event.delta.thinking);
							return false;
						}
						return false;
					}
					case "content_block_stop": {
						const partId = state.streams.get(event.index);
						if (partId === undefined) return false;
						state.streams.delete(event.index);
						yield* closePart(ctx, state.open, partId);
						return false;
					}
					default:
						return false;
				}
			}
			case "assistant": {
				if (message.parent_tool_use_id !== null) return false;
				// The ONLY source of the continuity leaf: resumeSessionAt is
				// documented for assistant message uuids, never stream frames.
				state.lastAssistantUuid = String(message.uuid);
				for (const block of message.message.content) {
					if (block.type !== "tool_use") continue;
					const input: Record<string, unknown> = {};
					if (typeof block.input === "object" && block.input !== null && !Array.isArray(block.input)) {
						for (const [key, value] of Object.entries(block.input)) input[key] = value;
					} else if (block.input !== undefined) {
						input.value = block.input;
					}

					let display: ToolDisplay;
					switch (block.name) {
						case "Bash": {
							const command = typeof input.command === "string" ? input.command : "";
							display = { _tag: "bash", command };
							break;
						}
						case "Read": {
							const path =
								typeof input.file_path === "string"
									? input.file_path
									: typeof input.path === "string"
										? input.path
										: "";
							const startLine =
								typeof input.offset === "number" && Number.isInteger(input.offset) && input.offset >= 0
									? input.offset
									: undefined;
							const limit =
								typeof input.limit === "number" && Number.isInteger(input.limit) && input.limit > 0
									? input.limit
									: undefined;
							display = {
								_tag: "read",
								path,
								...(startLine === undefined ? {} : { startLine }),
								...(startLine === undefined || limit === undefined
									? {}
									: { endLine: startLine + limit - 1 }),
							};
							break;
						}
						case "Grep": {
							const query = typeof input.pattern === "string" ? input.pattern : "";
							const path = typeof input.path === "string" ? input.path : undefined;
							display = { _tag: "grep", query, ...(path === undefined ? {} : { path }) };
							break;
						}
						case "Glob": {
							const query = typeof input.pattern === "string" ? input.pattern : "";
							const path = typeof input.path === "string" ? input.path : undefined;
							display = { _tag: "find", query, ...(path === undefined ? {} : { path }) };
							break;
						}
						case "Edit":
						case "MultiEdit": {
							const path =
								typeof input.file_path === "string"
									? input.file_path
									: typeof input.path === "string"
										? input.path
										: "";
							display = { _tag: "edit", files: [{ path, change: "update" }] };
							break;
						}
						case "Write": {
							const path =
								typeof input.file_path === "string"
									? input.file_path
									: typeof input.path === "string"
										? input.path
										: "";
							display = { _tag: "edit", files: [{ path, change: "create" }] };
							break;
						}
						case "NotebookEdit": {
							const path =
								typeof input.notebook_path === "string"
									? input.notebook_path
									: typeof input.file_path === "string"
										? input.file_path
										: "";
							const change = input.edit_mode === "delete" ? "delete" : input.edit_mode === "insert" ? "create" : "update";
							display = { _tag: "edit", files: [{ path, change }] };
							break;
						}
						case "WebFetch": {
							const url = typeof input.url === "string" ? input.url : undefined;
							display = { _tag: "web", kind: "fetch", ...(url === undefined ? {} : { url }) };
							break;
						}
						case "WebSearch": {
							const query = typeof input.query === "string" ? input.query : undefined;
							display = { _tag: "web", kind: "search", ...(query === undefined ? {} : { query }) };
							break;
						}
						case "Task": {
							display = { _tag: "subagent", mode: "single", runs: [] };
							break;
						}
						default: {
							if (block.name.startsWith("mcp__")) {
								const parts = block.name.split("__");
								const server = parts[1] ?? "";
								const toolName = parts[2];
								display = { _tag: "mcp", server, ...(toolName === undefined ? {} : { toolName }) };
							} else {
								display = { _tag: "generic" };
							}
							break;
						}
					}

					const startedAt = now();
					const part: ToolPart = {
						_tag: "tool",
						id: ctx.newPartId(),
						messageId: ctx.assistantMessageId,
						turnId: ctx.turnId,
						origin: "claude-code",
						state: "active",
						callId: CallId.make(block.id),
						tool: block.name,
						toolState: { _tag: "running", input, startedAt },
						display,
					};
					state.tools.set(block.id, {
						partId: part.id,
						callId: block.id,
						toolName: block.name,
						input,
						startedAt,
						display,
					});
					state.open.add(part.id);
					yield* ctx.createPart(part);
				}
				const usage = message.message.usage;
				const inputTokens = usage.input_tokens;
				const outputTokens = usage.output_tokens;
				const cacheReadTokens = usage.cache_read_input_tokens ?? undefined;
				const cacheWriteTokens = usage.cache_creation_input_tokens ?? undefined;
				yield* settleStep(
					ctx,
					state,
					{
						inputTokens,
						outputTokens,
						...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
						...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
						totalTokens: inputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
					},
					String(message.message.model),
				);
				return false;
			}
			case "user": {
				if (message.parent_tool_use_id !== null) return false;
				const content = message.message.content;
				if (!Array.isArray(content)) return false;
				for (const block of content) {
					if (typeof block !== "object" || block === null || !("type" in block) || block.type !== "tool_result") {
						continue;
					}
					const toolUseId =
						"tool_use_id" in block && typeof block.tool_use_id === "string" ? block.tool_use_id : "";
					if (toolUseId === "") continue;
					const tracker = state.tools.get(toolUseId);
					if (tracker === undefined) continue;
					state.tools.delete(toolUseId);
					const rawContent = "content" in block ? block.content : undefined;
					const output = rawContent === undefined ? "" : textContent(rawContent);
					const finishedAt = now();
					const toolState: ToolState =
						"is_error" in block && block.is_error === true
							? {
									_tag: "error",
									input: tracker.input,
									error: output === "" ? "tool failed" : output,
									startedAt: tracker.startedAt,
									finishedAt,
								}
							: {
									_tag: "completed",
									input: tracker.input,
									output,
									title: tracker.toolName,
									startedAt: tracker.startedAt,
									finishedAt,
								};
					let display = tracker.display;
					switch (display._tag) {
						case "bash":
						case "read":
						case "grep":
						case "find":
						case "mcp":
						case "generic":
							display = { ...display, output };
							break;
						default:
							break;
					}
					yield* ctx.updatePart({
						_tag: "tool",
						id: tracker.partId,
						messageId: ctx.assistantMessageId,
						turnId: ctx.turnId,
						origin: "claude-code",
						state: "active",
						callId: CallId.make(tracker.callId),
						tool: tracker.toolName,
						toolState,
						display,
					});
					yield* closePart(ctx, state.open, tracker.partId);
					if (tracker.toolName === "ExitPlanMode") {
						// The plan rides the OUTPUT side of the contract
						// (ExitPlanModeOutput.plan, sometimes serialized as JSON text);
						// the raw text and the tool_use input are fallbacks.
						let markdown = "";
						const trimmed = output.trim();
						if (trimmed.startsWith("{")) {
							try {
								const parsed: unknown = JSON.parse(trimmed);
								if (typeof parsed === "object" && parsed !== null && "plan" in parsed && typeof parsed.plan === "string") {
									markdown = parsed.plan;
								}
							} catch {
								// Not JSON after all — the raw text fallback below applies.
							}
						}
						if (markdown === "") markdown = output;
						if (markdown === "") {
							markdown =
								typeof tracker.input.plan === "string"
									? tracker.input.plan
									: typeof tracker.input.markdown === "string"
										? tracker.input.markdown
										: "";
						}
						const plan: Part = {
							_tag: "plan",
							id: ctx.newPartId(),
							messageId: ctx.assistantMessageId,
							turnId: ctx.turnId,
							origin: "claude-code",
							state: "active",
							planId: PlanId.make(`plan_${randomUUID()}`),
							markdown,
							implementedAt: null,
						};
						state.open.add(plan.id);
						yield* ctx.createPart(plan);
						yield* closePart(ctx, state.open, plan.id);
					}
				}
				return false;
			}
			case "tool_progress": {
				const tracker = state.tools.get(message.tool_use_id);
				if (tracker === undefined) return false;
				yield* ctx.updatePart({
					_tag: "tool",
					id: tracker.partId,
					messageId: ctx.assistantMessageId,
					turnId: ctx.turnId,
					origin: "claude-code",
					state: "active",
					callId: CallId.make(tracker.callId),
					tool: tracker.toolName,
					toolState: {
						_tag: "running",
						input: tracker.input,
						startedAt: tracker.startedAt,
						title: `${message.tool_name} running ${Math.max(0, Math.floor(message.elapsed_time_seconds))}s`,
					},
					display: tracker.display,
				});
				return false;
			}
			case "system": {
				switch (message.subtype) {
					case "compact_boundary": {
						const part: Part = {
							_tag: "compaction",
							id: ctx.newPartId(),
							messageId: ctx.assistantMessageId,
							turnId: ctx.turnId,
							origin: "claude-code",
							state: "active",
							summary: "",
							tokensBefore: message.compact_metadata.pre_tokens,
							metadata: { trigger: message.compact_metadata.trigger },
						};
						state.open.add(part.id);
						yield* ctx.createPart(part);
						yield* closePart(ctx, state.open, part.id);
						return false;
					}
					case "api_retry": {
						const text = `Retry ${message.attempt}/${message.max_retries} after ${message.retry_delay_ms}ms: ${message.error}`;
						if (state.retryNotice === null) {
							const part: NoticePart = {
								_tag: "notice",
								id: ctx.newPartId(),
								messageId: ctx.assistantMessageId,
								turnId: ctx.turnId,
								origin: "claude-code",
								state: "active",
								severity: "warning",
								name: "api-retry",
								message: text,
							};
							state.retryNotice = part;
							state.open.add(part.id);
							yield* ctx.createPart(part);
							return false;
						}
						state.retryNotice = { ...state.retryNotice, message: text };
						yield* ctx.updatePart(state.retryNotice);
						return false;
					}
					case "permission_denied":
						yield* emitNotice(ctx, state, "error", "permission-denied", message.message);
						return false;
					case "notification":
						yield* emitNotice(ctx, state, "warning", message.key, message.text);
						return false;
					case "model_refusal_fallback":
					case "model_refusal_no_fallback":
						yield* emitNotice(ctx, state, "error", "refusal", message.content);
						return false;
					case "session_state_changed":
						return message.state === "idle";
					case "informational":
					case "local_command_output":
						return false;
					case "task_started":
						state.taskOwners.set(message.task_id, message.tool_use_id ?? null);
						yield* updateTaskRun(
							ctx,
							state,
							message.task_id,
							message.description,
							"running",
							message.prompt,
							undefined,
							undefined,
						);
						return false;
					case "task_progress":
						yield* updateTaskRun(
							ctx,
							state,
							message.task_id,
							message.summary ?? message.description,
							"running",
							undefined,
							undefined,
							undefined,
						);
						return false;
					case "task_updated": {
						const status = message.patch.status === undefined ? "running" : mapTaskStatus(message.patch.status);
						yield* updateTaskRun(
							ctx,
							state,
							message.task_id,
							message.patch.description ?? "",
							status,
							undefined,
							undefined,
							message.patch.error,
						);
						return false;
					}
					case "task_notification":
						yield* updateTaskRun(
							ctx,
							state,
							message.task_id,
							message.summary,
							mapTaskStatus(message.status),
							undefined,
							message.summary,
							message.status === "failed" ? message.summary : undefined,
						);
						return false;
					default:
						return false;
				}
			}
			case "rate_limit_event": {
				if (message.rate_limit_info.status === "rejected") {
					const reset =
						message.rate_limit_info.resetsAt === undefined
							? ""
							: ` Resets at ${new Date(message.rate_limit_info.resetsAt).toISOString()}.`;
					yield* emitNotice(ctx, state, "warning", "rate-limit", `Claude rate limit reached.${reset}`);
				}
				return false;
			}
			case "result":
				if (message.subtype !== "success") {
					state.resultError = { subtype: message.subtype, errors: [...message.errors] };
				} else if (message.is_error === true) {
					state.resultError = {
						subtype: message.subtype,
						errors: message.result === "" ? [] : [message.result],
					};
				}
				return true;
			case "auth_status":
			case "prompt_suggestion":
			case "tool_use_summary":
				return false;
			default:
				return false;
		}
	});

/**
 * Post-interrupt flush: whatever the CLI still emits (aborted result, tail
 * events) projects before the sweep closes open parts. Bounded as a whole —
 * a hung iterator is abandoned and close() in the epilogue kills it.
 */
const drainQuery = (ctx: TurnContext, state: ProjectionState, runtime: Query): Effect.Effect<void> =>
	Effect.gen(function* () {
		for (;;) {
			const next = yield* Effect.tryPromise(() => runtime.next());
			if (next.done) break;
			const finished = yield* projectMessage(ctx, state, next.value);
			if (finished) break;
		}
	}).pipe(Effect.timeout("2 seconds"), Effect.exit, Effect.asVoid);

const makeOptions = (
	options: ClaudeHarnessOptions,
	ctx: TurnContext,
	resumeOptions: Awaited<ReturnType<typeof resolveResume>>,
	state: ProjectionState,
): ClaudeQueryOptions => {
	const modelText = String(ctx.model);
	const slash = modelText.indexOf("/");
	const model = slash > 0 && slash < modelText.length - 1 ? modelText.slice(slash + 1) : modelText;
	const canUseTool: CanUseTool = async (_toolName, _input, permissionOptions) => ({
		behavior: "allow",
		toolUseID: permissionOptions.toolUseID,
		decisionClassification: "user_permanent",
		...(permissionOptions.suggestions === undefined
			? {}
			: { updatedPermissions: permissionOptions.suggestions }),
	});
	const onUserDialog: OnUserDialog = (request, dialogOptions) =>
		projectQuestion(ctx, state, request, dialogOptions);
	const queryOptions: ClaudeQueryOptions = {
		cwd: ctx.cwd,
		model,
		settingSources: ["project"],
		includePartialMessages: true,
		env: claudeEnv(),
		permissionMode: ctx.interactionMode === "plan" ? "plan" : "default",
		canUseTool,
		onUserDialog,
		supportedDialogKinds: ["askUserQuestion"],
		...resumeOptions,
	};
	if (ctx.thinkingLevel === "off") {
		queryOptions.thinking = { type: "disabled" };
	} else {
		queryOptions.effort = ctx.thinkingLevel;
	}
	const guidance = MODE_GUIDANCE[ctx.interactionMode];
	if (guidance !== undefined) {
		queryOptions.systemPrompt = { type: "preset", preset: "claude_code", append: guidance };
	}
	if (ctx.interactionMode === "ask") {
		queryOptions.tools = [...ASK_TOOLS];
	}
	if (ctx.interactionMode === "debug") {
		queryOptions.tools = [...DEBUG_TOOLS];
		queryOptions.mcpServers = { honk_debug: makeDebugMcpServer(options.claudeDir, ctx.cwd) };
		queryOptions.toolAliases = { debug_logs: "mcp__honk_debug__debug_logs" };
	}
	return queryOptions;
};

export const makeClaudeHarness = (options: ClaudeHarnessOptions): Harness => ({
	capabilities: { steer: false },
	runTurn: (ctx) =>
		Effect.gen(function* () {
			const state: ProjectionState = {
				open: new Set(),
				streams: new Map(),
				tools: new Map(),
				taskOwners: new Map(),
				taskSteps: new Map(),
				taskRuns: new Map(),
				currentStep: null,
				retryNotice: null,
				lastSessionId: null,
				lastAssistantUuid: null,
				resultError: null,
			};
			const resumeOptions = yield* Effect.tryPromise(() => resolveResume(ctx.resumeLeaf, ctx.cwd)).pipe(
				Effect.orDie,
			);
			const runtime = query({
				prompt: claudePrompt(ctx),
				options: makeOptions(options, ctx, resumeOptions, state),
			});

			const finishTurn = (exit: Exit.Exit<void, never>) =>
				Effect.gen(function* () {
					if (!Exit.isSuccess(exit)) {
						yield* Effect.tryPromise(() => runtime.interrupt()).pipe(Effect.timeout("2 seconds"), Effect.exit);
						yield* drainQuery(ctx, state, runtime);
					}
					for (const partId of [...state.open]) {
						yield* closePart(ctx, state.open, partId);
					}
					yield* recordContinuity(ctx, state);
				});

			yield* Effect.gen(function* () {
				for (;;) {
					const next = yield* Effect.tryPromise(() => runtime.next());
					if (next.done) break;
					const drainTail = next.value.type === "result";
					const finished = yield* projectMessage(ctx, state, next.value);
					if (finished) {
						if (drainTail) yield* drainQuery(ctx, state, runtime);
						break;
					}
				}
			}).pipe(
				Effect.orDie,
				Effect.onExit(finishTurn),
				Effect.ensuring(
					Effect.sync(() => {
						runtime.close();
					}),
				),
			);
			if (state.resultError !== null) {
				const detail = state.resultError.errors.length === 0 ? "" : `: ${state.resultError.errors.join("; ")}`;
				yield* Effect.die(new Error(`Claude Code result ${state.resultError.subtype}${detail}`));
			}
		}),
});

const titleCase = (value: string): string =>
	value
		.split(/[-_\s]+/)
		.filter((part) => part !== "")
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
		.join(" ");

const accountDetail = (account: AccountInfo): string | null => {
	if (account.apiProvider === "firstParty" && account.subscriptionType !== undefined) {
		return `Claude ${titleCase(account.subscriptionType)} Subscription`;
	}
	if (account.apiProvider === "bedrock") return "Claude Bedrock Provider";
	if (account.apiProvider === "vertex") return "Claude Vertex Provider";
	if (account.apiProvider === "foundry") return "Claude Foundry Provider";
	if (account.apiProvider === "anthropicAws") return "Claude Anthropic AWS Provider";
	if (account.apiProvider === "mantle") return "Claude Mantle Provider";
	if (account.apiProvider === "gateway") return "Claude Gateway Provider";
	if (account.apiKeySource !== undefined && account.apiKeySource !== "oauth") return "Claude API Key";
	return null;
};

async function* emptyPrompt(): AsyncGenerator<SDKUserMessage> {
	return;
}

export const claudeCodeProbe = async (): Promise<HarnessStatus> => {
	let runtime: Query | null = null;
	try {
		runtime = query({
			prompt: emptyPrompt(),
			options: {
				settingSources: [],
				persistSession: false,
				env: claudeEnv(),
				tools: [],
			},
		});
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const account = await Promise.race([
			runtime.accountInfo(),
			new Promise<"timeout">((resolve) => {
				timeoutId = setTimeout(() => {
					resolve("timeout");
				}, 10_000);
			}),
		]).finally(() => {
			if (timeoutId !== null) clearTimeout(timeoutId);
		});
		if (account === "timeout") return { harness: "claude-code", available: false, detail: null };
		const detail = accountDetail(account);
		return { harness: "claude-code", available: detail !== null, detail };
	} catch {
		return { harness: "claude-code", available: false, detail: null };
	} finally {
		if (runtime !== null) runtime.close();
	}
};
