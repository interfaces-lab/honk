// Pure state fold for the chat surface. Every timing rule lives here so the
// strict tests need no DOM and no network: the controller only feeds events in
// and renders state out.
//
// The thread projection is native: Pi entries in, view rows out. No opencode
// shapes, no fabricated authors — a Pi value the transcript cannot express
// honestly becomes a notice row, not an invented message. Git receipts come
// from `session.changes` and attach to the turn that earned them.

import type { Git } from "@honk/core";
import { Tools } from "@honk/core";
import type { Session } from "@honk/core/session";
import type { ConversationDensity } from "@honk/shared/conversation-density";

export type ChatStatus = "connecting" | "ready" | "running" | "disconnected" | "failed";
type MessageUpdateEvent = Extract<Session.AgentHarnessEvent, { readonly type: "message_update" }>;
export type StreamingAssistantMessage = Extract<
  MessageUpdateEvent["message"],
  { readonly role: "assistant" }
>;

export interface ChatState {
  readonly status: ChatStatus;
  readonly sessionId: Session.SessionId | null;
  readonly entries: readonly Session.SessionTreeEntry[];
  // Per-turn git change receipts, from the watch's authoritative state.
  readonly turns: Session.ChangesOutput["turns"];
  // Pi's live assistant message while a run streams. Authoritative entries
  // arrive in state frames.
  readonly streamingMessage: StreamingAssistantMessage | null;
  readonly error: string | null;
}

export type ChatEvent =
  | { readonly type: "attached"; readonly sessionId: Session.SessionId }
  // An advisory Pi event from the session watch: streaming and liveness.
  | { readonly type: "event"; readonly event: Session.AgentHarnessEvent }
  // An authoritative state frame from the session watch.
  | {
      readonly type: "state";
      readonly entries: readonly Session.SessionTreeEntry[];
      readonly status: Session.RunStatus;
      readonly turns: Session.ChangesOutput["turns"];
    }
  | { readonly type: "prompted" }
  | { readonly type: "stream_ended" }
  | { readonly type: "failed"; readonly message: string };

export const initialState: ChatState = {
  status: "connecting",
  sessionId: null,
  entries: [],
  turns: [],
  streamingMessage: null,
  error: null,
};

interface TextBlocksMessage {
  readonly content: string | readonly { readonly type: string; readonly text?: string }[];
}

const textOfMessage = (message: TextBlocksMessage): string =>
  typeof message.content === "string"
    ? message.content
    : message.content
        .filter(
          (part): part is { type: "text"; text: string } =>
            part.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("\n");

export const reduce = (state: ChatState, event: ChatEvent): ChatState => {
  switch (event.type) {
    case "attached":
      return { ...state, sessionId: event.sessionId };
    case "event": {
      const piEvent = event.event;
      switch (piEvent.type) {
        case "agent_start":
          return { ...state, status: "running", streamingMessage: null };
        case "message_update":
          if (piEvent.message.role !== "assistant") return state;
          return { ...state, streamingMessage: piEvent.message };
        case "message_end":
          return piEvent.message.role === "assistant"
            ? { ...state, streamingMessage: null }
            : state;
        case "settled":
          return { ...state, status: "ready", streamingMessage: null };
        default:
          return state;
      }
    }
    case "prompted":
      return { ...state, status: "running" };
    case "state":
      return {
        ...state,
        entries: event.entries,
        turns: event.turns,
        // The authoritative read wins over local guesses about the run.
        status: event.status === "running" ? "running" : "ready",
      };
    case "stream_ended":
      return { ...state, status: "disconnected" };
    case "failed":
      return { ...state, status: "failed", error: event.message };
  }
};

// ---------------------------------------------------------------------------
// Thread projection
// ---------------------------------------------------------------------------

type PiMessage = Extract<Session.SessionTreeEntry, { readonly type: "message" }>["message"];
type PiToolResult = Extract<PiMessage, { readonly role: "toolResult" }>;

const toolResultText = (result: PiToolResult): string =>
  result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();

const formatArgs = (args: unknown): string => {
  try {
    return JSON.stringify(args, null, 2) ?? "";
  } catch {
    return String(args);
  }
};

const noticeOf = (entry: Session.SessionTreeEntry): string | null => {
  switch (entry.type) {
    case "model_change":
      return `Model: ${entry.provider}/${entry.modelId}`;
    case "thinking_level_change":
      return `Thinking level: ${entry.thinkingLevel}`;
    case "custom":
      if (entry.customType === "honk.workspace_change") {
        const directory = (entry.data as { directory?: string } | undefined)?.directory;
        return directory === undefined ? "Moved to another workspace" : `Moved to ${directory}`;
      }
      if (entry.customType === "honk.revert") return "Workspace reverted to an earlier turn";
      return null;
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// Turn grammar (spec/conversation.md §1): turns → segments → steps.
//
// A segment is a run of tool work opened by the assistant text block that
// preceded it; the turn's final text block is its summary. Nothing here is
// stored — the grammar is a pure read of Pi's block order.
// ---------------------------------------------------------------------------

/**
 * A step may group and roll up only when it just looks (spec §4). The split
 * is core's `Tools.writesOf` — the same classifier the checkpoint attribution
 * gate uses — so there is exactly one list. Unknown tools classify opaque and
 * therefore never group: erring toward visible.
 */
const isReadShaped = (name: string, args: unknown): boolean =>
  Tools.writesOf(name, args).kind === "none";

export interface TurnStep {
  /** Pi's tool call id: stable across streaming and commit. */
  readonly key: string;
  readonly name: string;
  readonly args: string;
  /** The most human string in the arguments — a path or a command. */
  readonly detail: string | null;
  readonly state: "running" | "ok" | "error";
  readonly output: string;
  readonly readShaped: boolean;
}

export interface TurnSegment {
  readonly id: string;
  /** The assistant text block that opened this segment, or null. */
  readonly headline: string | null;
  readonly steps: readonly TurnStep[];
}

export interface TurnView {
  /** The user entry id: the turn's identity for overrides and receipts. */
  readonly id: string;
  readonly userText: string;
  readonly segments: readonly TurnSegment[];
  /** The turn's final text block; survives collapse to L0. */
  readonly summary: string | null;
  /** The user entry's timestamp: the live turn ticks its clock from here. */
  readonly startedAt: string;
  /** First to last committed entry, or null while nothing has committed. */
  readonly durationMs: number | null;
  /** How the turn ended. A stopped or failed turn still collapses; only the label tells. */
  readonly outcome: "done" | "stopped" | "failed";
  /** What this turn edited — the change receipt shown when the turn settles. */
  readonly files: readonly Git.FileChange[];
  /** The failing model request's message, when outcome is failed. */
  readonly error: string | null;
}

/** The most human string in a tool's arguments, shared by rows and the ticker. */
export const stepDetail = (args: unknown): string | null => {
  if (typeof args !== "object" || args === null) return null;
  const record = args as Record<string, unknown>;
  const candidate = record.path ?? record.file ?? record.command;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
};

/**
 * Folds committed entries — and, when a run streams, the live assistant
 * message — into the turn grammar. The streaming message is not an entry yet,
 * so its blocks fold into the open turn through the same per-block rules: its
 * trailing text is the turn's summary-so-far, streamed outside the preview
 * window until the next block decides what it was (spec §5).
 */
export const turnViews = (
  entries: readonly Session.SessionTreeEntry[],
  streamingMessage: StreamingAssistantMessage | null = null,
  changes: Session.ChangesOutput["turns"] = [],
): readonly TurnView[] => {
  const toolResults = new Map<string, PiToolResult>();
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "toolResult") {
      toolResults.set(entry.message.toolCallId, entry.message);
    }
  }
  // The receipt keys on the turn's settling entry — whatever kind it is.
  const receiptByEntry = new Map(
    changes.filter((turn) => turn.files.length > 0).map((turn) => [turn.entryId, turn.files]),
  );

  const turns: TurnView[] = [];
  let turn: {
    id: string;
    userText: string;
    segments: TurnSegment[];
    startedAt: string;
    lastAt: string;
    outcome: TurnView["outcome"];
    files: readonly Git.FileChange[];
    error: string | null;
  } | null = null;
  let segment: { id: string; headline: string | null; steps: TurnStep[] } | null = null;
  // Assistant text is pending until the next block decides what it was: a
  // tool call makes it a headline, the end of the turn makes it the summary.
  let pendingText: string | null = null;

  const closeSegment = () => {
    if (segment !== null && turn !== null) turn.segments.push(segment);
    segment = null;
  };
  const closeTurn = () => {
    closeSegment();
    if (turn !== null) {
      const started = Date.parse(turn.startedAt);
      const ended = Date.parse(turn.lastAt);
      turns.push({
        id: turn.id,
        userText: turn.userText,
        segments: turn.segments,
        summary: pendingText,
        startedAt: turn.startedAt,
        durationMs:
          Number.isFinite(started) && Number.isFinite(ended) && ended > started
            ? ended - started
            : null,
        outcome: turn.outcome,
        files: turn.files,
        error: turn.error,
      });
    }
    turn = null;
    pendingText = null;
  };

  // One block walk shared by committed messages and the streaming one. The
  // sourceId keys segments; the running count keeps sibling segment ids apart.
  const foldAssistantBlocks = (
    blocks: StreamingAssistantMessage["content"],
    sourceId: string,
  ) => {
    if (turn === null) return;
    for (const block of blocks) {
      if (block.type === "text") {
        closeSegment();
        pendingText = pendingText === null ? block.text : `${pendingText}\n\n${block.text}`;
      } else if (block.type === "toolCall") {
        if (pendingText !== null || segment === null) {
          closeSegment();
          segment = {
            id: `${sourceId}:${String(turn.segments.length)}`,
            headline: pendingText,
            steps: [],
          };
          pendingText = null;
        }
        const result = toolResults.get(block.id);
        segment.steps.push({
          key: block.id,
          name: block.name,
          args: formatArgs(block.arguments),
          detail: stepDetail(block.arguments),
          state: result === undefined ? "running" : result.isError ? "error" : "ok",
          output: result === undefined ? "" : toolResultText(result),
          readShaped: isReadShaped(block.name, block.arguments),
        });
      }
      // thinking blocks are L3 detail; the grammar skips them.
    }
  };

  for (const entry of entries) {
    if (entry.type !== "message") {
      const files = receiptByEntry.get(entry.id);
      if (files !== undefined && turn !== null) turn.files = files;
      continue;
    }
    const { message } = entry;

    if (message.role === "user") {
      closeTurn();
      turn = {
        id: entry.id,
        userText: textOfMessage(message),
        segments: [],
        startedAt: entry.timestamp,
        lastAt: entry.timestamp,
        outcome: "done",
        files: [],
        error: null,
      };
      continue;
    }
    if (turn === null) continue;
    turn.lastAt = entry.timestamp;
    const files = receiptByEntry.get(entry.id);
    if (files !== undefined) turn.files = files;
    if (message.role !== "assistant") continue;

    // The last assistant verdict wins: a retried turn that finishes cleanly
    // is done, a turn whose final message aborted or errored says so.
    if (message.stopReason === "aborted") {
      turn.outcome = "stopped";
      turn.error = null;
    } else if (message.stopReason === "error") {
      turn.outcome = "failed";
      turn.error = message.errorMessage ?? "The model request failed.";
    } else {
      turn.outcome = "done";
      turn.error = null;
    }

    foldAssistantBlocks(message.content, entry.id);
  }

  if (streamingMessage !== null && turn !== null) {
    foldAssistantBlocks(streamingMessage.content, `live:${String(streamingMessage.timestamp)}`);
  }

  closeTurn();
  return turns;
};

// ---------------------------------------------------------------------------
// Segment rows (spec §4): how a segment's steps read at L1.
// ---------------------------------------------------------------------------

export type SegmentRow =
  | { readonly kind: "step"; readonly step: TurnStep }
  // A run of consecutive read-shaped steps at the group minimum. Edits and
  // shell commands never disappear into a group.
  | { readonly kind: "group"; readonly steps: readonly TurnStep[] };

export const segmentRows = (steps: readonly TurnStep[]): readonly SegmentRow[] => {
  const rows: SegmentRow[] = [];
  let reads: TurnStep[] = [];
  const flush = () => {
    if (reads.length >= GROUP_MIN) rows.push({ kind: "group", steps: reads });
    else for (const step of reads) rows.push({ kind: "step", step });
    reads = [];
  };
  for (const step of steps) {
    if (step.readShaped) {
      reads.push(step);
    } else {
      flush();
      rows.push({ kind: "step", step });
    }
  }
  flush();
  return rows;
};

// ---------------------------------------------------------------------------
// Disclosure (spec §2–§3): which layer a turn renders at.
// ---------------------------------------------------------------------------

/**
 * L0 collapsed ("Worked for…" + summary) · L1 work groups + preview window ·
 * L2 full transcript. L3 (tool arguments and output) is per-row open state,
 * not a turn layer — no density auto-opens it.
 */
export type DisclosureLayer = 0 | 1 | 2;

/**
 * The whole density reconciliation: a click override wins for its turn, the
 * setting supplies the default per phase. Densities are the three app-wide
 * values from `@honk/shared/conversation-density` — Compact collapses settled
 * turns, Balanced keeps groups visible, Detailed shows every row.
 */
export const effectiveLayer = (
  override: DisclosureLayer | null,
  density: ConversationDensity,
  phase: "running" | "settled",
): DisclosureLayer => {
  if (override !== null) return override;
  switch (density) {
    case "detailed":
      return 2;
    case "compact-ungrouped":
      return 1;
    case "compact-all-grouped":
      return phase === "running" ? 1 : 0;
  }
};

// ---------------------------------------------------------------------------
// The ticker (spec §5): what the preview window shows right now.
// ---------------------------------------------------------------------------

export type TickerState =
  | { readonly kind: "idle" }
  | { readonly kind: "planning" }
  | { readonly kind: "writing" }
  | { readonly kind: "step"; readonly name: string; readonly detail: string | null }
  | { readonly kind: "rollup"; readonly count: number };

/** Minimum consecutive read-shaped calls before work rolls up (spec §4). */
export const GROUP_MIN = 2;

/**
 * Derives the live label from the streaming message's newest block. Before
 * any block streams — and while thinking streams — the agent is planning; a
 * streaming text block means prose is being written, which the surface
 * streams outside the window as ordinary markdown while the window holds its
 * last label (spec §5); a tool call names itself.
 */
export const tickerOf = (state: ChatState): TickerState => {
  if (state.status !== "running") return { kind: "idle" };
  const content = state.streamingMessage?.content ?? [];
  const last = content.at(-1);
  if (last === undefined) return { kind: "planning" };
  if (last.type === "toolCall") {
    // The trailing run of read-shaped calls rolls up once it crosses the
    // group minimum (spec §6) — a text block or a writing tool breaks it.
    let reads = 0;
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const block = content[index];
      if (block?.type !== "toolCall" || !isReadShaped(block.name, block.arguments)) break;
      reads += 1;
    }
    if (reads >= GROUP_MIN) return { kind: "rollup", count: reads };
    return { kind: "step", name: last.name, detail: stepDetail(last.arguments) };
  }
  if (last.type === "text") return { kind: "writing" };
  return { kind: "planning" };
};

/**
 * The transcript's row sequence: turns in the grammar above, with the
 * non-message entries the grammar skips — compaction dividers and context
 * notices — interleaved in document order.
 *
 * A `honk.git_action` marker pairs with the user message that follows it
 * (spec/conversation.md §8): the turn renders as one action chip. A marker
 * with no turn after it means the action never started, and that failure
 * renders itself.
 */
export type ConversationItem =
  | {
      readonly kind: "turn";
      readonly turn: TurnView;
      /** The Git action this turn ran, when a marker precedes it. */
      readonly gitAction: string | null;
    }
  | { readonly kind: "git_action_failed"; readonly id: string; readonly action: string }
  | { readonly kind: "notice"; readonly id: string; readonly text: string }
  | {
      readonly kind: "compaction";
      readonly id: string;
      readonly summary: string;
      readonly tokensBefore: number;
    };

const gitActionOf = (entry: Session.SessionTreeEntry): string | null => {
  if (entry.type !== "custom" || entry.customType !== "honk.git_action") return null;
  const action = (entry.data as { action?: unknown } | undefined)?.action;
  return typeof action === "string" ? action : null;
};

export const conversationItems = (
  entries: readonly Session.SessionTreeEntry[],
  streamingMessage: StreamingAssistantMessage | null,
  changes: Session.ChangesOutput["turns"] = [],
): readonly ConversationItem[] => {
  const turnById = new Map(
    turnViews(entries, streamingMessage, changes).map((turn) => [turn.id, turn]),
  );

  const items: ConversationItem[] = [];
  let pendingAction: { readonly id: string; readonly action: string } | null = null;
  const flushUnstartedAction = () => {
    if (pendingAction !== null) {
      items.push({ kind: "git_action_failed", id: pendingAction.id, action: pendingAction.action });
      pendingAction = null;
    }
  };

  for (const entry of entries) {
    if (entry.type === "message") {
      // A turn renders at its user entry; the rest of its messages fold in.
      const turn = turnById.get(entry.id);
      if (turn !== undefined) {
        items.push({ kind: "turn", turn, gitAction: pendingAction?.action ?? null });
        pendingAction = null;
      }
      continue;
    }
    const action = gitActionOf(entry);
    if (action !== null) {
      flushUnstartedAction();
      pendingAction = { id: entry.id, action };
    } else if (entry.type === "compaction") {
      items.push({
        kind: "compaction",
        id: entry.id,
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
      });
    } else {
      const notice = noticeOf(entry);
      if (notice !== null) items.push({ kind: "notice", id: entry.id, text: notice });
    }
  }
  flushUnstartedAction();
  return items;
};
