import { Schema } from "effect";
import { ThreadId } from "./id";
import { IsoTimestamp, NonNegativeInt, strictDecode, UnknownRecord } from "./primitives";

/**
 * Tool lifecycle. `input` and `completed.output` are sanctioned open sites:
 * tool arguments and raw results are harness-defined; everything renderable
 * lives in the typed ToolDisplay instead. `completed.startedAt` is carried
 * forward from running so duration is derivable for every tool.
 */
export const ToolState = Schema.TaggedUnion({
	pending: { input: UnknownRecord },
	running: { input: UnknownRecord, title: Schema.optional(Schema.String), startedAt: IsoTimestamp },
	completed: {
		input: UnknownRecord,
		output: Schema.Unknown,
		title: Schema.String,
		startedAt: Schema.optional(IsoTimestamp),
		finishedAt: IsoTimestamp,
	},
	error: {
		input: UnknownRecord,
		error: Schema.String,
		startedAt: Schema.optional(IsoTimestamp),
		finishedAt: IsoTimestamp,
	},
});
export type ToolState = typeof ToolState.Type;

export const SubagentRunStatus = Schema.Literals(["queued", "running", "completed", "failed", "aborted"]);
export type SubagentRunStatus = typeof SubagentRunStatus.Type;

export const SubagentRun = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	status: SubagentRunStatus,
	subagentThreadId: Schema.optional(ThreadId),
	model: Schema.optional(Schema.String),
	agentId: Schema.optional(Schema.String),
	nickname: Schema.optional(Schema.String),
	role: Schema.optional(Schema.String),
	prompt: Schema.optional(Schema.String),
	finalText: Schema.optional(Schema.String),
	errorMessage: Schema.optional(Schema.String),
});
export type SubagentRun = typeof SubagentRun.Type;

export const SubagentActivityKind = Schema.Literals([
	"subagent.thread.started",
	"subagent.thread.state.changed",
	"subagent.item.started",
	"subagent.item.updated",
	"subagent.item.completed",
]);
export type SubagentActivityKind = typeof SubagentActivityKind.Type;

export const SubagentActivity = Schema.Struct({
	id: Schema.String,
	/** Scopes the activity to its SubagentRun.id so clients group without guessing. */
	runId: Schema.String,
	kind: SubagentActivityKind,
	tone: Schema.Literals(["info", "tool", "error"]),
	summary: Schema.String,
	subagentThreadId: Schema.optional(ThreadId),
	itemType: Schema.optional(Schema.String),
	itemId: Schema.optional(Schema.String),
	status: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	detail: Schema.optional(Schema.String),
	/** Opaque passthrough — carried verbatim, rendered opaquely, never key-guessed. */
	data: Schema.optional(Schema.Unknown),
	seq: NonNegativeInt,
	createdAt: IsoTimestamp,
});
export type SubagentActivity = typeof SubagentActivity.Type;

/**
 * Closed, typed per-tool view. Rendering needs zero heuristics: every arm
 * maps 1:1 onto a honkkit tool-call surface. Preview-vs-result is carried by
 * ToolState (running/completed), never duplicated here; result-only fields
 * are optional so a running tool can be displayed honestly.
 */
export const ToolDisplay = Schema.TaggedUnion({
	bash: {
		command: Schema.String,
		output: Schema.optional(Schema.String),
		exitCode: Schema.optional(Schema.Number),
		durationMs: Schema.optional(NonNegativeInt),
		truncated: Schema.optional(Schema.Boolean),
		fullOutputPath: Schema.optional(Schema.String),
	},
	read: {
		path: Schema.String,
		startLine: Schema.optional(NonNegativeInt),
		endLine: Schema.optional(NonNegativeInt),
		output: Schema.optional(Schema.String),
		truncated: Schema.optional(Schema.Boolean),
	},
	grep: {
		query: Schema.String,
		path: Schema.optional(Schema.String),
		output: Schema.optional(Schema.String),
		matchedFiles: Schema.optional(Schema.Array(Schema.String)),
		totalMatched: Schema.optional(NonNegativeInt),
		totalIndexedFiles: Schema.optional(NonNegativeInt),
		truncated: Schema.optional(Schema.Boolean),
	},
	find: {
		query: Schema.String,
		path: Schema.optional(Schema.String),
		output: Schema.optional(Schema.String),
		totalMatched: Schema.optional(NonNegativeInt),
		hasMore: Schema.optional(Schema.Boolean),
		truncated: Schema.optional(Schema.Boolean),
	},
	/** Multi-file by design: one entry per touched file; a delete carries no diff. */
	edit: {
		diff: Schema.optional(Schema.String),
		files: Schema.Array(
			Schema.Struct({
				path: Schema.String,
				change: Schema.optional(Schema.Literals(["update", "create", "delete"])),
				additions: Schema.optional(NonNegativeInt),
				deletions: Schema.optional(NonNegativeInt),
			}),
		),
	},
	mcp: {
		server: Schema.String,
		toolName: Schema.optional(Schema.String),
		output: Schema.optional(Schema.String),
	},
	subagent: {
		mode: Schema.Literals(["single", "parallel", "chain"]),
		runs: Schema.Array(SubagentRun),
		activities: Schema.optional(Schema.Array(SubagentActivity)),
	},
	web: {
		kind: Schema.Literals(["search", "fetch"]),
		query: Schema.optional(Schema.String),
		url: Schema.optional(Schema.String),
	},
	image: { path: Schema.optional(Schema.String) },
	diagnostic: {
		severity: Schema.Literals(["info", "warning", "error"]),
		message: Schema.String,
	},
	/** Unstructured-text fallback with no tool identity. */
	raw: { text: Schema.String },
	/** Known tool identity (Part.tool), unknown shape. */
	generic: { output: Schema.optional(Schema.String) },
});
export type ToolDisplay = typeof ToolDisplay.Type;

/**
 * Annotations attached to one call alongside its primary display — the
 * "diff plus a per-file failure note" case. The card is always the single
 * ToolDisplay; these render as annotation lines inside it. A tool whose
 * entire output is a diagnostic uses the diagnostic display arm instead.
 */
export const ToolDiagnostic = Schema.Struct({
	severity: Schema.Literals(["info", "warning", "error"]),
	message: Schema.String,
});
export type ToolDiagnostic = typeof ToolDiagnostic.Type;

export const decodeToolState = strictDecode(ToolState);
export const decodeToolDisplay = strictDecode(ToolDisplay);
