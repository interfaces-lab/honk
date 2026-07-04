import { Schema } from "effect";
import { EntryId, MessageId, ModelId, PartId, ProjectId, ThreadId, TurnId } from "./id";
import { ThinkingLevel } from "./model";
import { AttachmentRef, Message, Part } from "./part";
import { InteractionMode } from "./send";
import { IsoTimestamp, NonNegativeInt, strictDecode, TrimmedNonEmptyString } from "./primitives";

export const ThreadStatus = Schema.Literals(["idle", "running", "failed"]);
export type ThreadStatus = typeof ThreadStatus.Type;

/** How a turn ends — the only settled outcomes (Interrupt settles as "aborted", ADR 0005). */
export const TurnSettledState = Schema.Literals(["completed", "aborted", "failed"]);
export type TurnSettledState = typeof TurnSettledState.Type;

export const ThreadWorktree = Schema.Struct({
  branch: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
});
export type ThreadWorktree = typeof ThreadWorktree.Type;

/**
 * The sidebar-grade projection (see CONTEXT.md, ADR 0008): title, status,
 * small metadata. Emits only on real changes, never on Part traffic.
 */
export const ThreadSummary = Schema.Struct({
  id: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  title: TrimmedNonEmptyString,
  status: ThreadStatus,
  needsAttention: Schema.Boolean,
  /** Pinned at creation — a Thread's model and thinking level never change (ADR 0014). */
  model: ModelId,
  thinkingLevel: ThinkingLevel,
  latestUserMessageAt: Schema.NullOr(IsoTimestamp),
  archivedAt: Schema.NullOr(IsoTimestamp),
  worktree: Schema.optional(Schema.NullOr(ThreadWorktree)),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type ThreadSummary = typeof ThreadSummary.Type;

/**
 * One node of the branching tree. Edit/resend creates a SIBLING (same
 * parentId) and moves the leaf; nothing is ever truncated.
 */
export const ThreadEntry = Schema.Struct({
  id: EntryId,
  parentId: Schema.NullOr(EntryId),
  messageId: Schema.NullOr(MessageId),
  turnId: Schema.NullOr(TurnId),
  createdAt: IsoTimestamp,
});
export type ThreadEntry = typeof ThreadEntry.Type;

export const QueuedMessage = Schema.Struct({
  messageId: MessageId,
  text: Schema.String,
  attachments: Schema.Array(AttachmentRef),
  /** Queued input delivers under the mode it was sent with, not the mode du jour. */
  interactionMode: InteractionMode,
  createdAt: IsoTimestamp,
});
export type QueuedMessage = typeof QueuedMessage.Type;

/**
 * What this Thread's pinned Harness can honor (ADR 0015: capabilities are
 * per-thread data, stable for the thread's life). `steer: false` (Cursor —
 * ACP has no mid-turn injection) hides the Steer affordance; a steer sent
 * anyway downgrades to queue and the AdmissionReceipt's disposition says so.
 * Force send (Interrupt) exists on every Harness.
 */
export const ThreadCapabilities = Schema.Struct({
  steer: Schema.Boolean,
});
export type ThreadCapabilities = typeof ThreadCapabilities.Type;

/**
 * The subscribe snapshot: paint everything from here, then apply stream
 * events with seq > this seq. `entries` is the FULL branching tree;
 * `messages` and `parts` cover only the active path (leaf to root), in
 * render order — switching branches renavigates via the tree endpoint.
 */
export const ThreadDetail = Schema.Struct({
  summary: ThreadSummary,
  cwd: TrimmedNonEmptyString,
  capabilities: ThreadCapabilities,
  entries: Schema.Array(ThreadEntry),
  leafId: Schema.NullOr(EntryId),
  messages: Schema.Array(Message),
  parts: Schema.Array(Part),
  queue: Schema.Array(QueuedMessage),
  seq: NonNegativeInt,
});
export type ThreadDetail = typeof ThreadDetail.Type;

const StreamBase = { seq: NonNegativeInt } as const;

/**
 * The per-thread live stream. Clients drop events with seq <= the snapshot
 * high-water mark, so application is idempotent across reconnects.
 * part.delta names its target field explicitly so the SDK reducer is total:
 * "text" appends to text/reasoning parts, "output" to the display output of
 * tool parts, "markdown" to plan parts.
 */
export const ThreadStreamEvent = Schema.TaggedUnion({
  "part.created": { ...StreamBase, part: Part },
  "part.delta": {
    ...StreamBase,
    partId: PartId,
    field: Schema.Literals(["text", "output", "markdown"]),
    delta: Schema.String,
  },
  "part.updated": { ...StreamBase, part: Part },
  "part.completed": { ...StreamBase, partId: PartId },
  "part.removed": { ...StreamBase, partId: PartId },
  "message.created": { ...StreamBase, message: Message, entry: ThreadEntry },
  "message.updated": { ...StreamBase, message: Message },
  "turn.started": { ...StreamBase, turnId: TurnId },
  "turn.settled": {
    ...StreamBase,
    turnId: TurnId,
    state: TurnSettledState,
    error: Schema.optional(Schema.String),
  },
  "queue.updated": { ...StreamBase, queue: Schema.Array(QueuedMessage) },
  "thread.updated": { ...StreamBase, summary: ThreadSummary },
  "tree.moved": { ...StreamBase, leafId: Schema.NullOr(EntryId) },
});
export type ThreadStreamEvent = typeof ThreadStreamEvent.Type;

/**
 * The workspace stream: summaries only, no Part traffic (ADR 0008). `seq` is
 * a workspace-scoped sequence; the thread list returns its high-water mark
 * and the watch endpoint resumes with ?after, same discipline as threads.
 */
export const ThreadSummaryEvent = Schema.TaggedUnion({
  "thread.updated": { seq: NonNegativeInt, summary: ThreadSummary },
  "thread.removed": { seq: NonNegativeInt, threadId: ThreadId },
});
export type ThreadSummaryEvent = typeof ThreadSummaryEvent.Type;

export const decodeThreadDetail = strictDecode(ThreadDetail);
export const decodeThreadStreamEvent = strictDecode(ThreadStreamEvent);
export const decodeThreadSummaryEvent = strictDecode(ThreadSummaryEvent);
