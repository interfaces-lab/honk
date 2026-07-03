import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	type AuthStorage,
	type ExtensionFactory,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Cause, Effect, Exit, Fiber, Queue } from "effect";
import {
	type InteractionMode,
	type Part,
	type PartId,
	type ToolDisplay,
	type ToolState,
	type UnknownRecord,
	CallId,
	PlanId,
	QuestionId,
} from "@honk/api/core/v1";
import type { Harness, PromptImage, TurnContext } from "./harness";

export interface PiHarnessOptions {
	/** HONK_HOME/harness/pi — the hermetic config space (ADR 0017). */
	readonly piDir: string;
	/** THE shared AuthStorage instance from the auth domain (ADR 0016). */
	readonly storage: AuthStorage;
}

type ToolPart = Extract<Part, { readonly _tag: "tool" }>;
type StepPart = Extract<Part, { readonly _tag: "step" }>;
type CompactionPart = Extract<Part, { readonly _tag: "compaction" }>;
type NoticePart = Extract<Part, { readonly _tag: "notice" }>;
type QuestionPart = Extract<Part, { readonly _tag: "question" }>;

/**
 * Per-turn projection state. `open` is the abort sweep: every Part still
 * active lives here so an interrupted turn can close them all — a Part must
 * never be left streaming forever. The tool tracker snapshots start-time
 * facts; the final display derives from snapshot + result, never from a
 * mutated shadow (the Core's foldDelta already accumulates durable output).
 */
interface ProjectionState {
	readonly open: Set<PartId>;
	/** contentIndex → the open text/reasoning part it streams into. */
	readonly streams: Map<number, PartId>;
	readonly tools: Map<string, ToolTracker>;
	step: StepPart | null;
	compaction: CompactionPart | null;
	retryNotice: NoticePart | null;
}

interface ToolTracker {
	readonly partId: PartId;
	readonly toolName: string;
	readonly input: UnknownRecord;
	readonly startedAt: string;
	readonly display: ToolDisplay;
	/**
	 * The last streamed output SNAPSHOT. pi emits truncateTail windows (2000
	 * lines / 50KB), so once a long command's window starts sliding, snapshots
	 * stop being extensions of each other — extension appends as a delta,
	 * anything else replaces the part wholesale.
	 */
	lastOutput: string;
}

const MODE_TOOLS: Record<InteractionMode, ReadonlyArray<string>> = {
	agent: ["read", "bash", "edit", "write", "ask_question"],
	ask: ["read", "grep", "find", "ls", "ask_question"],
	plan: ["read", "grep", "find", "ls", "bash", "ask_question", "create_plan"],
	debug: ["read", "grep", "find", "ls", "bash", "edit", "write", "ask_question", "debug_logs"],
	// Background subagents defer to the subagent round; until then multitask IS agent.
	multitask: ["read", "bash", "edit", "write", "ask_question"],
};

const PI_IDENTITY =
	"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
const HONK_IDENTITY =
	"You are Honk, an AI coding assistant. You help users by reading files, executing commands, editing code, and writing new files.";
const HONK_ASK_IDENTITY =
	"You are Honk, an AI coding assistant. You help users understand their codebase by reading and searching. In Ask mode, you do not modify files or run mutating commands.";
const CODEX_TOOL_USE_NUDGE =
	"Codex tool-use note: use the available shell, stdin, apply_patch, image, and web tools directly when they fit. Inspect files with shell commands and edit text files with apply_patch patches instead of ad hoc shell rewrites. When the latest user message starts with `Goal:`, treat the remainder as the active durable objective: keep working until it is complete or genuinely blocked, and make final completion or blocker status explicit.";

const MODE_GUIDANCE: Record<InteractionMode, string | undefined> = {
	agent: undefined,
	// The legacy multitask coordinator text instructs subagent tool calls; injecting
	// it without the subagent tool registered would drive the model into unknown-tool
	// errors, so multitask carries no guidance until the subagent round.
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
		"Only read-only tools are enabled in this mode: read, grep, find, ls, and ask_question.",
		"Answer directly when the existing context is enough; inspect with read-only tools only when needed for accuracy.",
		"Do not be eager to implement. If the user asks how something works, explain it rather than changing it.",
		"Cite important code references with line ranges in the form startLine:endLine:filepath.",
		"Use ask_question only when blocked on a user decision or missing requirement, not for trivia you can infer or inspect.",
		"If edits are required, tell the user to switch to Build or Plan mode instead of attempting the change.",
	].join("\n"),
	plan: [
		"## Honk Interaction Mode: Plan",
		"Produce a concrete implementation plan through Honk's built-in Pi planning surface.",
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
		"Use debug_logs with action:path to get the log file path before running instrumented or reproduction commands, append command output to that file, then use debug_logs with action:read to inspect the latest traces.",
		"Use debug_logs with action:clear before a fresh reproduction when previous logs would pollute the diagnosis.",
		"Prefer narrow diagnostic commands and explain the evidence before editing.",
		"When the cause is clear, make the smallest fix and verify it. If temporary instrumentation was added, remove it before finishing.",
	].join("\n"),
};

const DEFAULT_DEBUG_LOG_LINES = 100;
const MAX_DEBUG_LOG_LINES = 2_000;

const now = (): string => new Date().toISOString();

const piImages = (images: ReadonlyArray<PromptImage>) =>
	images.map((image) => ({ type: "image" as const, data: image.base64, mimeType: image.mimeType }));

/** The concatenated text items of a pi content array — the untyped edge of AgentToolResult. */
const textContent = (content: unknown): string => {
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const item of content) {
		if (typeof item === "object" && item !== null && "type" in item && item.type === "text") {
			if ("text" in item && typeof item.text === "string") text += item.text;
		}
	}
	return text;
};

/**
 * The mode posture (docs/interaction-modes.md): swap pi's identity for
 * honk's (ask gets the read-only identity), append the mode guidance, and
 * append the codex nudge for agent/debug only — the legacy suppression rule.
 */
const honkPosture = (mode: InteractionMode): ExtensionFactory => (pi) => {
	pi.on("before_agent_start", (event) => {
		const identity = mode === "ask" ? HONK_ASK_IDENTITY : HONK_IDENTITY;
		const swapped = event.systemPrompt.includes(PI_IDENTITY)
			? event.systemPrompt.replace(PI_IDENTITY, identity)
			: `${identity}\n\n${event.systemPrompt}`;
		const guidance = MODE_GUIDANCE[mode];
		const posture = guidance === undefined ? swapped : `${swapped}\n\n${guidance}`;
		return {
			systemPrompt:
				mode === "agent" || mode === "debug" ? `${posture}\n\n${CODEX_TOOL_USE_NUDGE}` : posture,
		};
	});
};

const debugLogPath = (piDir: string, cwd: string): string =>
	join(piDir, "honk-debug-logs", createHash("sha256").update(cwd).digest("hex").slice(0, 16), "debug.log");

/**
 * The honk-internal custom tools (ADR 0007's surviving flows). They run in
 * pi's Promise-land, so ctx effects bridge via Effect.runPromise — with the
 * tool's AbortSignal wired through, session.abort() cleanly cancels a turn
 * suspended on ask_question.
 */
const makeCustomTools = (ctx: TurnContext, piDir: string, open: Set<PartId>) => [
	defineTool({
		name: "ask_question",
		label: "Ask Question",
		description:
			"Ask the user one or more multiple-choice questions. Each question must provide at least two options. The UI adds an Other option automatically for custom answers.",
		promptSnippet: "Ask the user one or more multiple-choice questions and wait for answers.",
		promptGuidelines: [
			"Use ask_question only when the user's answer is required to proceed.",
			"ask_question is always multiple choice: each question needs at least two options.",
			"Each ask_question option needs a clear label.",
			"Do not add an Other option yourself; the UI always provides Other for custom answers.",
			"Use allow_multiple: true only when the user may pick more than one option.",
		],
		parameters: {
			type: "object",
			required: ["questions"],
			additionalProperties: false,
			properties: {
				title: { type: "string", description: "Short title for the question group." },
				questions: {
					type: "array",
					minItems: 1,
					description: "One or more multiple-choice questions to ask the user.",
					items: {
						type: "object",
						required: ["id", "prompt", "options"],
						additionalProperties: false,
						properties: {
							id: { type: "string", minLength: 1, description: "Stable identifier for this question." },
							prompt: { type: "string", minLength: 1, description: "The question to show the user." },
							options: {
								type: "array",
								minItems: 2,
								description: "At least two choices. The UI adds Other automatically; do not include it.",
								items: {
									type: "object",
									required: ["label"],
									additionalProperties: false,
									properties: {
										label: { type: "string", minLength: 1, description: "Choice label shown to the user." },
										description: { type: "string", description: "Short explanation of this choice." },
									},
								},
							},
							allow_multiple: {
								type: "boolean",
								description: "Allow selecting more than one option. Defaults to false.",
							},
						},
					},
				},
			},
		},
		async execute(_toolCallId, params, signal) {
			const raw: unknown = params;
			const rawQuestions =
				typeof raw === "object" && raw !== null && "questions" in raw ? raw.questions : undefined;
			if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
				throw new Error("ask_question requires at least one question");
			}

			const questions: Array<QuestionPart["questions"][number]> = [];
			for (const rawQuestion of rawQuestions) {
				if (typeof rawQuestion !== "object" || rawQuestion === null) continue;
				const id = "id" in rawQuestion && typeof rawQuestion.id === "string" ? rawQuestion.id : "";
				const prompt =
					"prompt" in rawQuestion && typeof rawQuestion.prompt === "string" ? rawQuestion.prompt : "";
				if (id === "" || prompt === "") continue;
				const rawOptions = "options" in rawQuestion ? rawQuestion.options : undefined;
				const options: Array<{ label: string; description?: string }> = [];
				if (Array.isArray(rawOptions)) {
					for (const rawOption of rawOptions) {
						if (typeof rawOption !== "object" || rawOption === null) continue;
						const label =
							"label" in rawOption && typeof rawOption.label === "string" ? rawOption.label : "";
						if (label === "") continue;
						const description =
							"description" in rawOption && typeof rawOption.description === "string"
								? rawOption.description
								: undefined;
						options.push({ label, ...(description === undefined ? {} : { description }) });
					}
				}
				const multiSelect =
					"allow_multiple" in rawQuestion && rawQuestion.allow_multiple === true ? true : undefined;
				questions.push({
					id: QuestionId.make(id),
					text: prompt,
					options,
					...(multiSelect === undefined ? {} : { multiSelect }),
				});
			}
			if (questions.length === 0) {
				throw new Error("ask_question requires questions with an id, a prompt, and labeled options");
			}

			const title =
				typeof raw === "object" && raw !== null && "title" in raw && typeof raw.title === "string" && raw.title.trim() !== ""
					? raw.title
					: questions[0]?.text ?? "Question";
			const questionId = QuestionId.make(`q_${randomUUID()}`);
			const part: QuestionPart = {
				_tag: "question",
				id: ctx.newPartId(),
				messageId: ctx.assistantMessageId,
				turnId: ctx.turnId,
				origin: "pi",
				state: "active",
				questionId,
				title,
				status: "pending",
				questions,
			};
			open.add(part.id);
			await Effect.runPromise(ctx.createPart(part));

			try {
				// The Core resolves this from interactions.answerQuestion; the part
				// itself is updated to answered there — this side only formats the
				// model-visible result. Canonical answers shape (Core-defined):
				// Record<questionId, ReadonlyArray<string>> of selected labels,
				// freeform text riding as one more string.
				const answers = await Effect.runPromise(
					ctx.awaitAnswer(questionId),
					signal === undefined ? undefined : { signal },
				);
				const sections: Array<string> = [];
				for (const question of questions) {
					const values = answers[String(question.id)];
					// Canonical shape is an array of labels; a bare string is tolerated.
					const labels = Array.isArray(values)
						? values.filter((value): value is string => typeof value === "string" && value !== "")
						: typeof values === "string" && values !== ""
							? [values]
							: [];
					if (labels.length > 0) sections.push(`${question.text}\n${labels.join(", ")}`);
				}
				return {
					content: [
						{
							type: "text" as const,
							text: sections.length === 0 ? "User did not provide an answer." : sections.join("\n\n"),
						},
					],
					details: { questionId: String(questionId), title, answers },
				};
			} finally {
				open.delete(part.id);
				await Effect.runPromise(ctx.completePart(part.id));
			}
		},
	}),
	defineTool({
		name: "create_plan",
		label: "Create Plan",
		description:
			"Create a proposed implementation plan for Honk's plan review UI. This is the final action for plan mode.",
		promptSnippet: "Create a proposed implementation plan for review.",
		promptGuidelines: [
			"Use create_plan as the final action in plan mode once the plan is ready for review.",
			"When the user provides feedback in plan mode, refine the existing plan and call create_plan again with the updated complete plan.",
			"Before calling create_plan, inspect the relevant code and ask clarifying questions if requirements are ambiguous.",
			"Do not modify files, run mutating commands, create commits, or implement the plan before calling create_plan.",
			"Put the complete Markdown plan in the plan field; include concrete files, implementation steps, verification, risks, and non-goals.",
		],
		parameters: {
			type: "object",
			required: ["plan"],
			additionalProperties: false,
			properties: {
				name: { type: "string", description: "Short human-readable plan name." },
				overview: { type: "string", description: "Brief summary of the plan." },
				plan: {
					type: "string",
					minLength: 1,
					description:
						"Complete Markdown plan body. Include diagnosis, implementation steps, verification, risks, and non-goals where relevant.",
				},
			},
		},
		async execute(_toolCallId, params) {
			const raw: unknown = params;
			const plan =
				typeof raw === "object" && raw !== null && "plan" in raw && typeof raw.plan === "string"
					? raw.plan
					: "";
			if (plan.trim() === "") {
				throw new Error("create_plan requires a non-empty plan");
			}
			const name =
				typeof raw === "object" && raw !== null && "name" in raw && typeof raw.name === "string" && raw.name.trim() !== ""
					? raw.name
					: undefined;
			const overview =
				typeof raw === "object" && raw !== null && "overview" in raw && typeof raw.overview === "string"
					? raw.overview
					: undefined;
			const part: Part = {
				_tag: "plan",
				id: ctx.newPartId(),
				messageId: ctx.assistantMessageId,
				turnId: ctx.turnId,
				origin: "pi",
				state: "active",
				planId: PlanId.make(`plan_${randomUUID()}`),
				markdown: plan,
				implementedAt: null,
				...(overview === undefined ? {} : { summary: overview }),
			};
			await Effect.runPromise(ctx.createPart(part));
			await Effect.runPromise(ctx.completePart(part.id));
			// terminate ends the turn once this tool batch finalizes (pi agent-loop
			// stops only when EVERY finalized result in the batch terminates).
			return {
				content: [{ type: "text" as const, text: `Created plan${name === undefined ? "" : ` "${name}"`}.` }],
				details: { name, overview },
				terminate: true,
			};
		},
	}),
	defineTool({
		name: "debug_logs",
		label: "Debug Logs",
		description:
			"Get the current debug log file path, read recent debug log lines, or clear the debug log before a fresh reproduction.",
		promptSnippet: "Use debug_logs to get, read, or clear the debug log file for runtime traces.",
		promptGuidelines: [
			"Use debug_logs with action:path before running instrumented or reproduction commands so their output can be appended to the returned log file.",
			"Use debug_logs with action:clear before a fresh reproduction when stale logs would confuse the diagnosis.",
			"Use debug_logs with action:read after reproduction commands to inspect the latest captured traces.",
		],
		parameters: {
			type: "object",
			required: ["action"],
			additionalProperties: false,
			properties: {
				action: { enum: ["path", "read", "clear"], description: "Debug log operation." },
				lines: {
					type: "number",
					description: "Maximum number of trailing log lines to return for read. Defaults to 100.",
				},
			},
		},
		async execute(_toolCallId, params) {
			const raw: unknown = params;
			const action =
				typeof raw === "object" &&
				raw !== null &&
				"action" in raw &&
				(raw.action === "path" || raw.action === "read" || raw.action === "clear")
					? raw.action
					: "read";
			const logFilePath = debugLogPath(piDir, ctx.cwd);
			await mkdir(dirname(logFilePath), { recursive: true });
			await writeFile(logFilePath, "", { flag: "a" });

			if (action === "clear") {
				await writeFile(logFilePath, "");
				return {
					content: [{ type: "text" as const, text: `Cleared debug log at ${logFilePath}.` }],
					details: { action, logFilePath, lines: [] as Array<string>, totalCount: 0 },
				};
			}
			if (action === "path") {
				return {
					content: [{ type: "text" as const, text: `Debug log path: ${logFilePath}` }],
					details: { action, logFilePath, lines: [] as Array<string>, totalCount: 0 },
				};
			}

			const requested =
				typeof raw === "object" && raw !== null && "lines" in raw && typeof raw.lines === "number" && Number.isFinite(raw.lines)
					? raw.lines
					: DEFAULT_DEBUG_LOG_LINES;
			const lineCount = Math.max(1, Math.min(MAX_DEBUG_LOG_LINES, Math.floor(requested)));
			const content = await readFile(logFilePath, "utf8");
			const allLines = content === "" ? [] : content.replace(/\n$/, "").split(/\r?\n/);
			const lines = allLines.slice(-lineCount);
			return {
				content: [
					{
						type: "text" as const,
						text:
							lines.length === 0
								? `Debug log is empty at ${logFilePath}.`
								: `Read ${lines.length} of ${allLines.length} debug log lines from ${logFilePath}.`,
					},
				],
				details: { action, logFilePath, lines, totalCount: allLines.length },
			};
		},
	}),
];

/** Close a tracked part exactly once; the settle/abort sweep uses the same path. */
const closePart = (ctx: TurnContext, open: Set<PartId>, partId: PartId): Effect.Effect<void> =>
	Effect.gen(function* () {
		if (!open.has(partId)) return;
		open.delete(partId);
		yield* ctx.completePart(partId);
	});

/**
 * Session continuity (grill 2026-07-02): the ref is the JSONL path, the leaf
 * is where pi's tree ended up — recorded against this turn's entry so a
 * future branch resumes exactly here. New session files are BUFFERED until
 * the first assistant message, so an unflushed file must not be recorded. A
 * ref that CHANGED (open-failure fallback rebuilt the session) is recorded
 * too — the Core invalidates the dead session's leaves on replacement.
 */
const recordContinuity = (ctx: TurnContext, sessionManager: SessionManager): Effect.Effect<void> =>
	Effect.gen(function* () {
		const sessionFile = sessionManager.getSessionFile();
		if (sessionFile === undefined || !existsSync(sessionFile)) return;
		if (ctx.sessionRef !== sessionFile) {
			yield* ctx.setSessionRef(sessionFile);
		}
		const leaf = sessionManager.getLeafId();
		if (leaf !== null) {
			yield* ctx.setTurnLeaf(leaf);
		}
	});

const projectEvent = (
	ctx: TurnContext,
	state: ProjectionState,
	event: AgentSessionEvent,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		switch (event.type) {
			case "message_update": {
				const streamed = event.assistantMessageEvent;
				switch (streamed.type) {
					case "text_start":
					case "thinking_start": {
						const part: Part = {
							_tag: streamed.type === "text_start" ? "text" : "reasoning",
							id: ctx.newPartId(),
							messageId: ctx.assistantMessageId,
							turnId: ctx.turnId,
							origin: "pi",
							state: "active",
							text: "",
						};
						state.streams.set(streamed.contentIndex, part.id);
						state.open.add(part.id);
						yield* ctx.createPart(part);
						return;
					}
					case "text_delta":
					case "thinking_delta": {
						const partId = state.streams.get(streamed.contentIndex);
						if (partId === undefined) return;
						yield* ctx.appendDelta(partId, "text", streamed.delta);
						return;
					}
					case "text_end":
					case "thinking_end": {
						const partId = state.streams.get(streamed.contentIndex);
						if (partId === undefined) return;
						state.streams.delete(streamed.contentIndex);
						yield* closePart(ctx, state.open, partId);
						return;
					}
					default:
						return;
				}
			}
			case "tool_execution_start": {
				// ask_question and create_plan ARE their question/plan Parts — a
				// second generic tool card for the same interaction is noise.
				if (event.toolName === "ask_question" || event.toolName === "create_plan") return;
				const args: unknown = event.args;
				const input: Record<string, unknown> = {};
				if (typeof args === "object" && args !== null && !Array.isArray(args)) {
					for (const [key, value] of Object.entries(args)) input[key] = value;
				} else if (args !== undefined) {
					input["value"] = args;
				}
				const command = typeof input["command"] === "string" ? input["command"] : "";
				const path = typeof input["path"] === "string" ? input["path"] : "";
				const pattern = typeof input["pattern"] === "string" ? input["pattern"] : "";
				const offset =
					typeof input["offset"] === "number" && Number.isInteger(input["offset"]) && input["offset"] >= 0
						? input["offset"]
						: undefined;
				const limit =
					typeof input["limit"] === "number" && Number.isInteger(input["limit"]) && input["limit"] > 0
						? input["limit"]
						: undefined;

				let display: ToolDisplay;
				switch (event.toolName) {
					case "bash":
						display = { _tag: "bash", command };
						break;
					case "read": {
						const startLine = offset ?? (limit === undefined ? undefined : 1);
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
					case "grep":
						display = { _tag: "grep", query: pattern, ...(path === "" ? {} : { path }) };
						break;
					case "find":
						display = { _tag: "find", query: pattern, ...(path === "" ? {} : { path }) };
						break;
					case "edit":
						display = { _tag: "edit", files: [{ path, change: "update" }] };
						break;
					case "write":
						// A write IS a file mutation — same card as edit.
						display = { _tag: "edit", files: [{ path, change: "create" }] };
						break;
					default:
						display = { _tag: "generic" };
						break;
				}

				const startedAt = now();
				const part: ToolPart = {
					_tag: "tool",
					id: ctx.newPartId(),
					messageId: ctx.assistantMessageId,
					turnId: ctx.turnId,
					origin: "pi",
					state: "active",
					callId: CallId.make(event.toolCallId),
					tool: event.toolName,
					toolState: { _tag: "running", input, startedAt },
					display,
				};
				state.tools.set(event.toolCallId, {
					partId: part.id,
					toolName: event.toolName,
					input,
					startedAt,
					display,
					lastOutput: "",
				});
				state.open.add(part.id);
				yield* ctx.createPart(part);
				return;
			}
			case "tool_execution_update": {
				const tracker = state.tools.get(event.toolCallId);
				if (tracker === undefined) return;
				const partial: unknown = event.partialResult;
				const snapshot =
					typeof partial === "object" && partial !== null && "content" in partial
						? textContent(partial.content)
						: "";
				if (snapshot === tracker.lastOutput) return;
				if (snapshot.startsWith(tracker.lastOutput)) {
					const suffix = snapshot.slice(tracker.lastOutput.length);
					tracker.lastOutput = snapshot;
					yield* ctx.appendDelta(tracker.partId, "output", suffix);
					return;
				}
				// The window slid: the accumulated durable output no longer matches
				// what pi shows — replace the part wholesale instead of appending.
				tracker.lastOutput = snapshot;
				let display = tracker.display;
				switch (display._tag) {
					case "bash":
					case "read":
					case "grep":
					case "find":
					case "generic":
						display = { ...display, output: snapshot };
						break;
					default:
						break;
				}
				yield* ctx.updatePart({
					_tag: "tool",
					id: tracker.partId,
					messageId: ctx.assistantMessageId,
					turnId: ctx.turnId,
					origin: "pi",
					state: "active",
					callId: CallId.make(event.toolCallId),
					tool: tracker.toolName,
					toolState: { _tag: "running", input: tracker.input, startedAt: tracker.startedAt },
					display,
				});
				return;
			}
			case "tool_execution_end": {
				const tracker = state.tools.get(event.toolCallId);
				if (tracker === undefined) return;
				state.tools.delete(event.toolCallId);

				const result: unknown = event.result;
				const outputText =
					typeof result === "object" && result !== null && "content" in result
						? textContent(result.content)
						: "";
				const details =
					typeof result === "object" && result !== null && "details" in result ? result.details : undefined;
				// pi wraps truncation facts one level down: details.truncation.truncated.
				const truncation =
					typeof details === "object" && details !== null && "truncation" in details
						? details.truncation
						: undefined;
				const truncated =
					typeof truncation === "object" &&
					truncation !== null &&
					"truncated" in truncation &&
					typeof truncation.truncated === "boolean"
						? truncation.truncated
						: undefined;

				let display = tracker.display;
				switch (display._tag) {
					case "bash": {
						const fullOutputPath =
							typeof details === "object" &&
							details !== null &&
							"fullOutputPath" in details &&
							typeof details.fullOutputPath === "string"
								? details.fullOutputPath
								: undefined;
						display = {
							...display,
							output: outputText,
							...(truncated === undefined ? {} : { truncated }),
							...(fullOutputPath === undefined ? {} : { fullOutputPath }),
						};
						break;
					}
					case "read":
					case "grep":
					case "find":
						display = {
							...display,
							output: outputText,
							...(truncated === undefined ? {} : { truncated }),
						};
						break;
					case "edit": {
						const diff =
							typeof details === "object" && details !== null && "diff" in details && typeof details.diff === "string"
								? details.diff
								: undefined;
						display = { ...display, ...(diff === undefined ? {} : { diff }) };
						break;
					}
					case "generic":
						display = { ...display, output: outputText };
						break;
					default:
						break;
				}

				const finishedAt = now();
				const toolState: ToolState = event.isError
					? {
							_tag: "error",
							input: tracker.input,
							error: outputText === "" ? "tool failed" : outputText,
							startedAt: tracker.startedAt,
							finishedAt,
						}
					: {
							_tag: "completed",
							input: tracker.input,
							output: details ?? outputText,
							title: tracker.toolName,
							startedAt: tracker.startedAt,
							finishedAt,
						};
				yield* ctx.updatePart({
					_tag: "tool",
					id: tracker.partId,
					messageId: ctx.assistantMessageId,
					turnId: ctx.turnId,
					origin: "pi",
					state: "active",
					callId: CallId.make(event.toolCallId),
					tool: tracker.toolName,
					toolState,
					display,
				});
				yield* closePart(ctx, state.open, tracker.partId);
				return;
			}
			case "turn_start": {
				const part: StepPart = {
					_tag: "step",
					id: ctx.newPartId(),
					messageId: ctx.assistantMessageId,
					turnId: ctx.turnId,
					origin: "pi",
					state: "active",
					model: String(ctx.model),
				};
				state.step = part;
				state.open.add(part.id);
				yield* ctx.createPart(part);
				return;
			}
			case "turn_end": {
				const part = state.step;
				if (part === null) return;
				state.step = null;
				if (event.message.role === "assistant") {
					yield* ctx.updatePart({
						...part,
						usage: {
							inputTokens: event.message.usage.input,
							outputTokens: event.message.usage.output,
							cacheReadTokens: event.message.usage.cacheRead,
							cacheWriteTokens: event.message.usage.cacheWrite,
							totalTokens: event.message.usage.totalTokens,
						},
					});
				}
				yield* closePart(ctx, state.open, part.id);
				return;
			}
			case "compaction_start": {
				const part: CompactionPart = {
					_tag: "compaction",
					id: ctx.newPartId(),
					messageId: ctx.assistantMessageId,
					turnId: ctx.turnId,
					origin: "pi",
					state: "active",
					summary: "",
					metadata: { reason: event.reason },
				};
				state.compaction = part;
				state.open.add(part.id);
				yield* ctx.createPart(part);
				return;
			}
			case "compaction_end": {
				// Overflow failures can emit an UNPAIRED end — represent it anyway.
				let part = state.compaction;
				if (part === null) {
					part = {
						_tag: "compaction",
						id: ctx.newPartId(),
						messageId: ctx.assistantMessageId,
						turnId: ctx.turnId,
						origin: "pi",
						state: "active",
						summary: "",
						metadata: { reason: event.reason },
					};
					state.open.add(part.id);
					yield* ctx.createPart(part);
				}
				state.compaction = null;
				// An aborted/failed compaction must not render as a successful empty
				// one — the failure facts ride metadata.
				const failed = event.aborted || event.errorMessage !== undefined;
				yield* ctx.updatePart({
					...part,
					...(event.result === undefined
						? {}
						: { summary: event.result.summary, tokensBefore: event.result.tokensBefore }),
					...(failed
						? {
								metadata: {
									...part.metadata,
									aborted: event.aborted,
									...(event.errorMessage === undefined ? {} : { error: event.errorMessage }),
								},
							}
						: {}),
				});
				yield* closePart(ctx, state.open, part.id);
				return;
			}
			case "auto_retry_start": {
				// The retried LLM call replays its message from scratch: any block
				// still streaming belongs to the failed attempt and must close now,
				// or the replay's reused contentIndexes would append into it.
				for (const partId of state.streams.values()) {
					yield* closePart(ctx, state.open, partId);
				}
				state.streams.clear();
				const message = `Retry ${event.attempt}/${event.maxAttempts} after ${event.delayMs}ms: ${event.errorMessage}`;
				if (state.retryNotice === null) {
					const part: NoticePart = {
						_tag: "notice",
						id: ctx.newPartId(),
						messageId: ctx.assistantMessageId,
						turnId: ctx.turnId,
						origin: "pi",
						state: "active",
						severity: "warning",
						name: "auto-retry",
						message,
					};
					state.retryNotice = part;
					state.open.add(part.id);
					yield* ctx.createPart(part);
					return;
				}
				state.retryNotice = { ...state.retryNotice, message };
				yield* ctx.updatePart(state.retryNotice);
				return;
			}
			case "auto_retry_end": {
				const part = state.retryNotice;
				if (part === null) return;
				state.retryNotice = null;
				if (!event.success) {
					yield* ctx.updatePart({
						...part,
						severity: "error",
						message: event.finalError ?? part.message,
					});
				}
				yield* closePart(ctx, state.open, part.id);
				return;
			}
			default:
				return;
		}
	});

/**
 * The pi Harness (native, in-process — ADR 0006/0017). Lazy per-turn
 * AgentSession over one JSONL per Thread under HONK_HOME/harness/pi; the
 * session tree branches at the Core-computed resume leaf so an edit/resend is
 * a sibling branch, never an appended follow-up. One long-lived ModelRegistry
 * rides the shared AuthStorage, so codex OAuth refresh flows through the same
 * object the auth domain serves.
 */
export const makePiHarness = (options: PiHarnessOptions): Harness => {
	const modelRegistry = ModelRegistry.create(options.storage, join(options.piDir, "models.json"));

	return {
		capabilities: { steer: true },
		runTurn: (ctx) =>
			Effect.gen(function* () {
				const modelText = String(ctx.model);
				const slash = modelText.indexOf("/");
				const model =
					slash > 0 && slash < modelText.length - 1
						? modelRegistry.find(modelText.slice(0, slash), modelText.slice(slash + 1))
						: undefined;
				if (model === undefined) {
					// Creation validated against the catalog; an unmapped model here is a defect.
					return yield* Effect.die(new Error(`pi model not found: ${modelText}`));
				}

				const sessionDir = join(options.piDir, "sessions");
				// A stale ref cannot brick the Thread: open() itself creates a fresh
				// session for a missing/corrupt file (source-verified), the getEntry
				// guard below drops leaves the file doesn't know, and recordContinuity
				// replaces a changed ref.
				const sessionManager =
					ctx.sessionRef === null
						? SessionManager.create(ctx.cwd, sessionDir)
						: SessionManager.open(ctx.sessionRef, sessionDir);
				// pi never persists the leaf pointer — open() leaves it on the LAST
				// entry — so reconcile to the Core's mapped ancestor every turn.
				// A null target is both "re-edit of the first message" and "leaf not
				// in this session" (post-fallback): either way, restart from the root.
				const resumeLeaf =
					ctx.resumeLeaf !== null && sessionManager.getEntry(ctx.resumeLeaf) !== undefined
						? ctx.resumeLeaf
						: null;
				if (resumeLeaf !== sessionManager.getLeafId()) {
					if (resumeLeaf === null) sessionManager.resetLeaf();
					else sessionManager.branch(resumeLeaf);
				}

				const state: ProjectionState = {
					open: new Set(),
					streams: new Map(),
					tools: new Map(),
					step: null,
					compaction: null,
					retryNotice: null,
				};

				const settingsManager = SettingsManager.create(ctx.cwd, options.piDir);
				const resourceLoader = new DefaultResourceLoader({
					cwd: ctx.cwd,
					agentDir: options.piDir,
					settingsManager,
					extensionFactories: [honkPosture(ctx.interactionMode)],
				});
				yield* Effect.tryPromise(() => resourceLoader.reload()).pipe(Effect.orDie);

				const created = yield* Effect.tryPromise(() =>
					createAgentSession({
						cwd: ctx.cwd,
						agentDir: options.piDir,
						authStorage: options.storage,
						modelRegistry,
						model,
						thinkingLevel: ctx.thinkingLevel,
						tools: [...MODE_TOOLS[ctx.interactionMode]],
						customTools: makeCustomTools(ctx, options.piDir, state.open),
						resourceLoader,
						sessionManager,
						settingsManager,
					}),
				).pipe(Effect.orDie);
				const session: AgentSession = created.session;

				const events = yield* Queue.unbounded<AgentSessionEvent, Cause.Done>();
				const unsubscribe = session.subscribe((event) => {
					Queue.offerUnsafe(events, event);
				});
				const projection = yield* Effect.forkChild(
					Queue.take(events).pipe(
						Effect.flatMap((event) => projectEvent(ctx, state, event)),
						Effect.forever,
						Effect.catch((done) => (Cause.isDone(done) ? Effect.void : Effect.die(done))),
					),
				);
				// Dies with the turn (forkChild); interrupted explicitly in the
				// epilogue so late Steer stays in the mailbox for the Core's settle
				// drain. steer() rejects by contract (extension commands) — a
				// rejected item surfaces as a notice and must never kill delivery
				// for the rest of the turn.
				const steering = yield* Effect.forkChild(
					Effect.gen(function* () {
						for (;;) {
							const item = yield* Queue.take(ctx.steered);
							const delivered = yield* Effect.tryPromise(() =>
								session.steer(item.text, piImages(item.images)),
							).pipe(Effect.exit);
							if (Exit.isFailure(delivered)) {
								const noticeId = ctx.newPartId();
								yield* ctx.createPart({
									_tag: "notice",
									id: noticeId,
									messageId: ctx.assistantMessageId,
									turnId: ctx.turnId,
									origin: "pi",
									state: "active",
									severity: "warning",
									name: "steer-rejected",
									message: Cause.pretty(delivered.cause).slice(0, 500),
								});
								yield* ctx.completePart(noticeId);
							}
						}
					}),
				);

				// The epilogue rides onExit so EVERY end — success, interruption,
				// and defects like an auth-preflight throw — closes open Parts and
				// records continuity; onExit finalizers run interruption-masked.
				// Order matters: steering stops FIRST (a steer delivered after abort
				// would fuel pi's between-run continuation into a ghost run), then
				// abort waits for pi to go idle so the drain sees the aborted
				// assistant message's events too. A projection defect re-raises
				// AFTER the sweep — a half-projected turn must settle failed, never
				// silently completed.
				yield* Effect.tryPromise(() =>
					session.prompt(
						ctx.userText,
						ctx.images.length === 0 ? {} : { images: piImages(ctx.images) },
					),
				).pipe(
					Effect.orDie,
					Effect.onExit((exit) =>
						Effect.gen(function* () {
							yield* Fiber.interrupt(steering).pipe(Effect.exit);
							if (!Exit.isSuccess(exit)) {
								yield* Effect.tryPromise(() => session.abort()).pipe(Effect.exit);
							}
							yield* Queue.end(events);
							const projected = yield* Fiber.join(projection).pipe(Effect.exit);
							for (const partId of [...state.open]) {
								yield* closePart(ctx, state.open, partId);
							}
							yield* recordContinuity(ctx, sessionManager);
							yield* Exit.match(projected, {
								onSuccess: () => Effect.void,
								onFailure: (cause) =>
									Cause.hasInterrupts(cause) ? Effect.void : Effect.failCause(cause),
							});
						}),
					),
					Effect.ensuring(
						Effect.sync(() => {
							unsubscribe();
							session.dispose();
						}),
					),
				);
			}),
	};
};
