import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Queue, Semaphore } from "effect";
import {
  type AdmissionReceipt,
  type AttachmentRef,
  type CreateThreadInput,
  type Disposition,
  type InteractionMode,
  type Message,
  type Part,
  type ProviderId,
  type QueuedMessage,
  type SendMessageInput,
  type ThreadDetail,
  type ThreadEntry,
  type ThreadStreamEvent,
  type ThreadSummary,
  type ThreadSummaryEvent,
  type TurnSettledState,
  type UpdateThreadInput,
  AttachmentId,
  AttachmentNotFoundError,
  EntryId,
  EntryNotFoundError,
  MessageConflictError,
  MessageId,
  ModelUnavailableError,
  PartId,
  PlanId,
  PlanNotFoundError,
  QuestionId,
  QuestionNotFoundError,
  QueuedMessageNotFoundError,
  ThreadConflictError,
  ThreadId,
  ThreadNotFoundError,
  TurnId,
  NonNegativeInt,
  TrimmedNonEmptyString,
} from "@honk/api/core/v1";
import type { CoreAuth } from "./auth";
import { catalogEntry, resolveModelPin } from "./catalog";
import type { CheckpointCapture, Checkpoints } from "./checkpoint";
import type { Harness, PromptImage, SteeredInput } from "./harness";
import type { CoreHome } from "./home";
import { type CoreBuses, makeCoreBuses } from "./stream";
import { CoreStore } from "./store";

const now = (): string => new Date().toISOString();
const newId = <A>(make: (value: string) => A, prefix: string): A =>
  make(`${prefix}_${randomUUID()}`);

/** Key-order-independent hash: the same logical payload must never conflict with itself (ADR 0005). */
const canonicalHash = (value: unknown): string => {
  const canonical = JSON.stringify(value, (_key, val: unknown) =>
    val !== null && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : val,
  );
  return createHash("sha256")
    .update(canonical ?? "null")
    .digest("hex");
};

const parseDataUrl = (dataUrl: string): { mimeType: string; base64: string } | null => {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  return { mimeType: match[1], base64: match[2] };
};

/** Folds a part.delta into the durable part so replay always equals snapshot. */
const foldDelta = (
  part: Part,
  field: "text" | "output" | "markdown",
  delta: string,
): Part | null => {
  if (field === "text" && (part._tag === "text" || part._tag === "reasoning")) {
    return { ...part, text: part.text + delta };
  }
  if (field === "markdown" && part._tag === "plan") {
    return { ...part, markdown: part.markdown + delta };
  }
  if (field === "output" && part._tag === "tool") {
    const display = part.display;
    if (display._tag === "raw") {
      return { ...part, display: { ...display, text: display.text + delta } };
    }
    if (
      display._tag === "bash" ||
      display._tag === "read" ||
      display._tag === "grep" ||
      display._tag === "find" ||
      display._tag === "mcp" ||
      display._tag === "generic"
    ) {
      return { ...part, display: { ...display, output: (display.output ?? "") + delta } };
    }
  }
  return null;
};

interface EventAppender {
  readonly thread: (build: (seq: number) => ThreadStreamEvent) => void;
  readonly workspace: (build: (seq: number) => ThreadSummaryEvent) => void;
}

interface TurnRecord {
  readonly turnId: TurnId;
  readonly interactionMode: InteractionMode;
  /** The turn's Steer mailbox (grill 2026-07-02): admit offers, the Harness takes, settlement clears the remainder. */
  readonly steered: Queue.Queue<SteeredInput>;
  /**
   * This turn's per-thread ordinal (ADR 0020): the count of turns started on
   * the thread, == the count of assistant messages, so it survives a Core
   * restart without a bookkeeping column and never collides across branches.
   * The checkpoint ref for the turn is refs/honk/checkpoints/<thread>/turn/<ordinal>.
   */
  readonly ordinal: number;
  fiber: Fiber.Fiber<void, never> | null;
}

interface SupersedeRecord {
  readonly turnId: TurnId;
  readonly text: string;
  readonly images: ReadonlyArray<PromptImage>;
  readonly parentEntryId: EntryId;
  readonly interactionMode: InteractionMode;
}

type StartTurnLocked = (
  threadId: ThreadId,
  turnId: TurnId,
  userText: string,
  images: ReadonlyArray<PromptImage>,
  parentEntryId: EntryId | null,
  interactionMode: InteractionMode,
) => Effect.Effect<void>;

type SettleTurn = (
  threadId: ThreadId,
  turnId: TurnId,
  state: TurnSettledState,
  errorText?: string,
  captured?: CheckpointCapture | null,
) => Effect.Effect<void>;

type PromoteQueuedLocked = (threadId: ThreadId) => Effect.Effect<void>;

export interface Core {
  readonly store: CoreStore;
  readonly buses: CoreBuses;
  readonly auth: CoreAuth;
  readonly checkpoints: Checkpoints;
  readonly startedAt: string;
  /** Effective per-provider availability: the auth route AND a landed harness arm (grill 2026-07-02) — what the catalog serves and create enforces. */
  readonly availability: () => Record<ProviderId, boolean>;
  readonly recover: () => Effect.Effect<void>;
  readonly createThread: (
    input: CreateThreadInput,
  ) => Effect.Effect<ThreadSummary, ThreadConflictError | ModelUnavailableError>;
  readonly listThreads: (archived: boolean) => { threads: Array<ThreadSummary>; seq: number };
  readonly getDetail: (threadId: ThreadId) => Effect.Effect<ThreadDetail, ThreadNotFoundError>;
  readonly updateThread: (
    threadId: ThreadId,
    input: UpdateThreadInput,
  ) => Effect.Effect<ThreadSummary, ThreadNotFoundError>;
  readonly archiveThread: (threadId: ThreadId) => Effect.Effect<ThreadSummary, ThreadNotFoundError>;
  readonly unarchiveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<ThreadSummary, ThreadNotFoundError>;
  readonly removeThread: (threadId: ThreadId) => Effect.Effect<void, ThreadNotFoundError>;
  readonly navigate: (
    threadId: ThreadId,
    entryId: EntryId,
  ) => Effect.Effect<ThreadDetail, ThreadNotFoundError | EntryNotFoundError>;
  readonly admit: (
    threadId: ThreadId,
    input: SendMessageInput,
  ) => Effect.Effect<
    AdmissionReceipt,
    ThreadNotFoundError | MessageConflictError | EntryNotFoundError
  >;
  readonly interrupt: (
    threadId: ThreadId,
    turnId?: TurnId,
  ) => Effect.Effect<{ turnId: TurnId | null }, ThreadNotFoundError>;
  readonly cancelQueued: (
    threadId: ThreadId,
    messageId: MessageId,
  ) => Effect.Effect<QueuedMessage, ThreadNotFoundError | QueuedMessageNotFoundError>;
  readonly answerQuestion: (
    threadId: ThreadId,
    questionId: QuestionId,
    answers: Record<string, unknown>,
  ) => Effect.Effect<void, ThreadNotFoundError | QuestionNotFoundError>;
  readonly implementPlan: (
    threadId: ThreadId,
    planId: PlanId,
  ) => Effect.Effect<void, ThreadNotFoundError | PlanNotFoundError>;
  readonly attachmentBytes: (
    threadId: ThreadId,
    attachmentId: AttachmentId,
  ) => Effect.Effect<
    { bytes: Uint8Array; mimeType: string; name: string },
    ThreadNotFoundError | AttachmentNotFoundError
  >;
  readonly dispose: () => Effect.Effect<void>;
}

/**
 * The Core aggregate: every domain operation the API serves. Two locks make
 * the concurrency story:
 *
 * - `commitLock` serializes mint-seq + persist + publish as one atomic unit,
 *   so bus subscribers can never observe seqs out of order (fibers preempt
 *   between sync ops; publish-after-commit without the lock demonstrably
 *   drops events at the subscriber's monotonic guard).
 * - `stateLock` serializes every turn-state transition (admit decision +
 *   durable consequence, settle, interrupt, queue promotion), so exactly one
 *   turn runs per thread, queued input can neither strand nor jump the
 *   queue, and interrupts never hit the wrong turn. Fiber.interrupt is
 *   always awaited OUTSIDE the lock (settlement takes the lock itself);
 *   interrupt-with-message hands its successor over via a supersede record
 *   that settlement consumes.
 *
 * Both lock BODIES run uninterruptible: domain operations execute on HTTP
 * request fibers that die on client disconnect, and a torn transition (a
 * receipt without its turn, a dequeue without its promotion, a persist
 * without its publish) wedges the thread durably. Interruption can only land
 * while WAITING for a permit — an aborted wait leaves no partial state.
 * Fiber interruption of turn runners is signalled on detached fibers for the
 * same reason: delivery must not depend on the requester staying connected.
 *
 * Turns dispatch by the pinned model's Provider into the harness map
 * (ADR 0016: one Harness per Provider); threads.create is the enforcement
 * point (ModelUnavailableError), so a turn without an arm is a defect, not a
 * flow. Queued messages get NO tree entry at admission — the entry is created
 * at promotion time, following the then-current leaf unless the send pinned
 * an explicit branch point (edit/resend admitted while busy must still
 * branch). Turn execution runs on detached fibers; crash recovery sweeps
 * running threads to an aborted settlement at boot (ADR 0005). One Thread,
 * one model, one Harness (ADR 0014).
 */
export const makeCore = (
  home: CoreHome,
  auth: CoreAuth,
  harnesses: Partial<Record<ProviderId, Harness>>,
  checkpoints: Checkpoints,
): Core => {
  const store = new CoreStore(home.dbPath);
  const buses = makeCoreBuses();
  const commitLock = Semaphore.makeUnsafe(1);
  const stateLock = Semaphore.makeUnsafe(1);
  const fibers = new Map<string, TurnRecord>();
  const supersede = new Map<string, SupersedeRecord>();
  /** Keyed `${threadId}:${questionId}` — a turn suspended on awaitAnswer; answerQuestion resolves it. */
  const answerWaiters = new Map<string, Deferred.Deferred<Record<string, unknown>>>();
  const startedAt = now();
  /** Once true, no new turn may start — settlement of the survivors still commits. */
  let disposed = false;

  const withState = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    stateLock.withPermit(Effect.uninterruptible(effect));

  const withIdAnnotations = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    entries: ReadonlyArray<readonly [string, unknown | undefined]>,
  ): Effect.Effect<A, E, R> => {
    const annotations: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      if (value !== undefined) annotations[key] = value;
    }
    return Effect.annotateLogs(effect, annotations);
  };

  const checkpointVoid = <E, R>(
    effect: Effect.Effect<void, E, R>,
    message: string,
    entries: ReadonlyArray<readonly [string, unknown | undefined]>,
  ): Effect.Effect<void, never, R> =>
    withIdAnnotations(effect, entries).pipe(
      Effect.catchCause((cause) => Effect.logWarning(message, Cause.pretty(cause))),
    );

  const checkpointNullable = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    message: string,
    entries: ReadonlyArray<readonly [string, unknown | undefined]>,
  ): Effect.Effect<A | null, never, R> =>
    withIdAnnotations(effect, entries).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(message, Cause.pretty(cause)).pipe(Effect.as(null)),
      ),
    );

  /** The auth route AND a landed adapter: an unbuilt harness arm is exactly as unavailable as a missing credential. */
  const availability = (): Record<ProviderId, boolean> => {
    const routes = auth.availability();
    return {
      anthropic: routes.anthropic && harnesses.anthropic !== undefined,
      "openai-codex": routes["openai-codex"] && harnesses["openai-codex"] !== undefined,
      cursor: routes.cursor && harnesses.cursor !== undefined,
    };
  };

  /** Mint + persist + publish, atomically with respect to every other commit AND to interruption. */
  const commit = <A>(
    threadId: string | null,
    body: (append: EventAppender) => A,
  ): Effect.Effect<A> =>
    commitLock.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const result = store.transaction(() => {
            const thread: Array<{ seq: number; encoded: string }> = [];
            const workspace: Array<{ seq: number; encoded: string }> = [];
            const value = body({
              thread: (build) => {
                if (threadId === null) throw new Error("thread event without threadId");
                thread.push(store.appendThreadEvent(threadId, build));
              },
              workspace: (build) => {
                workspace.push(store.appendWorkspaceEvent(build));
              },
            });
            return { value, thread, workspace };
          });
          if (threadId !== null) {
            for (const envelope of result.thread) {
              yield* buses.publishThread(threadId, envelope);
            }
          }
          for (const envelope of result.workspace) {
            yield* buses.publishWorkspace(envelope);
          }
          return result.value;
        }),
      ),
    );

  const requireThread = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const thread = store.getThread(String(threadId));
      if (Option.isNone(thread)) {
        return yield* Effect.fail(new ThreadNotFoundError({ threadId }));
      }
      return thread.value;
    });

  const emitSummary = (append: EventAppender, summary: ThreadSummary): void => {
    append.thread((seq) => ({ _tag: "thread.updated", seq, summary }));
    append.workspace((seq) => ({ _tag: "thread.updated", seq, summary }));
  };

  /**
   * Every body is a no-op once the thread row is gone: a zombie turn racing
   * removeThread must not re-mint seqs over an emptied event table, re-insert
   * orphan part rows, or lazily resurrect the closed thread bus.
   */
  const partEffects = (threadId: ThreadId) => {
    const tid = String(threadId);
    return {
      createPart: (part: Part) =>
        commit(tid, (append) => {
          if (Option.isNone(store.getThread(tid))) return;
          store.upsertPart(tid, part);
          append.thread((seq) => ({ _tag: "part.created", seq, part }));
        }),
      appendDelta: (partId: PartId, field: "text" | "output" | "markdown", delta: string) =>
        commit(tid, (append) => {
          if (Option.isNone(store.getThread(tid))) return;
          const part = store.getPart(tid, String(partId));
          if (Option.isSome(part)) {
            const folded = foldDelta(part.value, field, delta);
            if (folded !== null) store.upsertPart(tid, folded);
          }
          append.thread((seq) => ({ _tag: "part.delta", seq, partId, field, delta }));
        }),
      updatePart: (part: Part) =>
        commit(tid, (append) => {
          if (Option.isNone(store.getThread(tid))) return;
          store.upsertPart(tid, part);
          append.thread((seq) => ({ _tag: "part.updated", seq, part }));
        }),
      completePart: (partId: PartId) =>
        commit(tid, (append) => {
          if (Option.isNone(store.getThread(tid))) return;
          const part = store.getPart(tid, String(partId));
          if (Option.isSome(part)) {
            store.upsertPart(tid, { ...part.value, state: "complete" });
          }
          append.thread((seq) => ({ _tag: "part.completed", seq, partId }));
        }),
      awaitAnswer: (questionId: QuestionId) =>
        Effect.gen(function* () {
          const key = `${tid}:${String(questionId)}`;
          const waiter = yield* Deferred.make<Record<string, unknown>>();
          answerWaiters.set(key, waiter);
          // Interruption (the turn dying) sweeps the waiter; the harness
          // epilogue closes the part, and answerQuestion rejects non-active
          // questions — a dead question is expired, never silently "answered".
          return yield* Deferred.await(waiter).pipe(
            Effect.ensuring(Effect.sync(() => answerWaiters.delete(key))),
          );
        }),
    };
  };

  /** Image-typed attachments only (grill 2026-07-02): bytes come back out of the store as base64 for the model context. */
  const imagesForRefs = (
    threadId: string,
    refs: ReadonlyArray<AttachmentRef>,
  ): Array<PromptImage> => {
    const images: Array<PromptImage> = [];
    for (const ref of refs) {
      if (!ref.mimeType.startsWith("image/")) continue;
      const attachment = store.getAttachment(threadId, String(ref.id));
      if (Option.isNone(attachment)) continue;
      images.push({
        mimeType: ref.mimeType,
        base64: readFileSync(attachment.value.path).toString("base64"),
      });
    }
    return images;
  };

  /**
   * Must be called while holding stateLock. Emits turn.started before the
   * assistant row. The TurnContext carries everything the pinned Harness
   * needs to continue its own session: the opaque session ref, and the
   * harness leaf recorded at the nearest mapped ancestor of this turn's
   * branch point (how edit/resend becomes a sibling branch inside the
   * harness's own session tree, never an appended follow-up).
   */
  const startTurnLocked: StartTurnLocked = Effect.fn("Core.startTurn")(
    function* (
      threadId: ThreadId,
      turnId: TurnId,
      userText: string,
      images: ReadonlyArray<PromptImage>,
      parentEntryId: EntryId | null,
      interactionMode: InteractionMode,
    ) {
      if (disposed) return;
      const tid = String(threadId);
      const thread = store.getThread(tid);
      if (Option.isNone(thread)) return;
      const cwd = thread.value.cwd;
      const assistantMessageId = newId(MessageId.make, "msg");
      const timestamp = now();
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: "assistant",
        turnId,
        attachments: [],
        error: null,
        createdAt: timestamp,
      };
      const assistantEntry: ThreadEntry = {
        id: newId(EntryId.make, "entry"),
        parentId: parentEntryId,
        messageId: assistantMessageId,
        turnId,
        createdAt: timestamp,
      };
      const summary: ThreadSummary = {
        ...thread.value.summary,
        status: "running",
        updatedAt: timestamp,
      };
      yield* commit(tid, (append) => {
        store.upsertMessage(tid, assistantMessage);
        store.appendEntry(tid, assistantEntry);
        store.updateThread(summary, String(assistantEntry.id));
        append.thread((seq) => ({ _tag: "turn.started", seq, turnId }));
        append.thread((seq) => ({
          _tag: "message.created",
          seq,
          message: assistantMessage,
          entry: assistantEntry,
        }));
        append.thread((seq) => ({ _tag: "tree.moved", seq, leafId: assistantEntry.id }));
        emitSummary(append, summary);
      });
      // This turn's ordinal (ADR 0020): assistant messages == turns started,
      // and the current turn's assistant message was just committed above, so
      // the count IS this turn's 1-based ordinal — durable across restart, no
      // bookkeeping column. Git checkpointing runs OFF the state lock, on the
      // detached runner fiber below (a git subprocess must never execute inside
      // the uninterruptible core-wide stateLock).
      const ordinal = store
        .listMessages(tid)
        .filter((message) => message.role === "assistant").length;

      // Nearest mapped ancestor of the branch point: where the harness's
      // own session tree must resume for this turn's context to be right.
      const byId = new Map(store.listEntries(tid).map((entry) => [String(entry.id), entry]));
      let resumeLeaf: string | null = null;
      for (
        let cursor = parentEntryId === null ? null : String(parentEntryId);
        cursor !== null;
        cursor = (() => {
          const parent = byId.get(cursor)?.parentId ?? null;
          return parent === null ? null : String(parent);
        })()
      ) {
        const leaf = store.getHarnessLeaf(tid, cursor);
        if (leaf !== null) {
          resumeLeaf = leaf;
          break;
        }
      }

      const steered = yield* Queue.unbounded<SteeredInput>();
      const record: TurnRecord = { turnId, interactionMode, steered, ordinal, fiber: null };
      fibers.set(tid, record);

      const entry = catalogEntry(thread.value.summary.model);
      const harness = entry === undefined ? undefined : harnesses[entry.provider];
      yield* Effect.logInfo("turn started", {
        threadId: String(threadId),
        turnId: String(turnId),
        provider: entry?.provider ?? null,
        mode: interactionMode,
      });
      const turn =
        harness === undefined
          ? Effect.die(
              new Error(`no harness arm for pinned model ${String(thread.value.summary.model)}`),
            )
          : harness.runTurn({
              threadId,
              turnId,
              assistantMessageId,
              userText,
              images,
              cwd: thread.value.cwd,
              model: thread.value.summary.model,
              thinkingLevel: thread.value.summary.thinkingLevel,
              interactionMode,
              steered,
              sessionRef: thread.value.harnessSession,
              setSessionRef: (ref) => Effect.sync(() => store.setThreadHarnessSession(tid, ref)),
              resumeLeaf,
              setTurnLeaf: (leaf) =>
                Effect.sync(() => store.putHarnessLeaf(tid, String(assistantEntry.id), leaf)),
              // Fresh reads at call time — the thunk may run after later commits.
              transcript: () =>
                Effect.sync(() => {
                  const chain = new Map(
                    store.listEntries(tid).map((item) => [String(item.id), item]),
                  );
                  const partsByMessage = new Map<string, Array<Part>>();
                  for (const part of store.listParts(tid)) {
                    const key = String(part.messageId);
                    const parts = partsByMessage.get(key);
                    if (parts === undefined) {
                      partsByMessage.set(key, [part]);
                    } else {
                      parts.push(part);
                    }
                  }
                  const roles = new Map(
                    store.listMessages(tid).map((item) => [String(item.id), item.role]),
                  );
                  const displayOutputText = (
                    part: Extract<Part, { readonly _tag: "tool" }>,
                  ): string | null => {
                    const display = part.display;
                    switch (display._tag) {
                      case "bash":
                      case "read":
                      case "grep":
                      case "find":
                      case "mcp":
                      case "generic": {
                        const output = display.output?.trim() ?? "";
                        return output === "" ? null : output;
                      }
                      case "raw": {
                        const text = display.text.trim();
                        return text === "" ? null : text;
                      }
                      default:
                        return null;
                    }
                  };
                  const toolOutputText = (
                    part: Extract<Part, { readonly _tag: "tool" }>,
                  ): string | null => {
                    const displayText = displayOutputText(part);
                    if (displayText !== null) return displayText;
                    if (
                      part.toolState._tag === "completed" &&
                      typeof part.toolState.output === "string"
                    ) {
                      const output = part.toolState.output.trim();
                      return output === "" ? null : output;
                    }
                    if (part.toolState._tag === "error") {
                      const error = part.toolState.error.trim();
                      return error === "" ? null : error;
                    }
                    return null;
                  };
                  const lines: Array<{
                    readonly role: "user" | "assistant" | "tool";
                    readonly text: string;
                  }> = [];
                  for (
                    let cursor = parentEntryId === null ? null : String(parentEntryId);
                    cursor !== null;
                    cursor = (() => {
                      const parent = chain.get(cursor)?.parentId ?? null;
                      return parent === null ? null : String(parent);
                    })()
                  ) {
                    const messageId = chain.get(cursor)?.messageId;
                    if (messageId == null) continue;
                    const role = roles.get(String(messageId));
                    if (role === undefined) continue;
                    const parts = partsByMessage.get(String(messageId)) ?? [];
                    if (role === "user") {
                      let body = "";
                      for (const part of parts) {
                        if (part._tag === "text") body += part.text;
                      }
                      if (body !== "") lines.unshift({ role, text: body });
                      continue;
                    }
                    const assistantLines: Array<string> = [];
                    const toolLines: Array<{
                      readonly role: "tool";
                      readonly text: string;
                    }> = [];
                    for (const part of parts) {
                      if (part._tag === "text" && part.text !== "") {
                        assistantLines.push(part.text);
                      } else if (part._tag === "tool") {
                        assistantLines.push(`[tool call: ${part.tool}]`);
                        if (
                          part.toolState._tag === "completed" ||
                          part.toolState._tag === "error"
                        ) {
                          const output = toolOutputText(part);
                          if (output !== null) {
                            toolLines.push({
                              role: "tool",
                              text: `Tool result (${part.tool}):\n${output}`,
                            });
                          }
                        }
                      }
                    }
                    const messageLines: Array<{
                      readonly role: "assistant" | "tool";
                      readonly text: string;
                    }> = [];
                    if (assistantLines.length > 0) {
                      messageLines.push({ role, text: assistantLines.join("\n") });
                    }
                    messageLines.push(...toolLines);
                    lines.unshift(...messageLines);
                  }
                  return lines;
                }),
              ...partEffects(threadId),
              newPartId: () => newId(PartId.make, "part"),
            });
      // The whole turn — baseline, harness, capture, settle — runs on ONE
      // detached fiber that never holds the state lock (ADR 0020): the git
      // subprocesses execute here, off-lock, so they can never stall the
      // core-wide turn machinery. Baseline (idempotent; captures turn/0 once
      // per thread) runs before the harness can touch the tree; capture runs
      // the instant the harness exits, before settlement can start a successor
      // turn that would dirty the tree. All checkpointing is fail-open.
      const runner: Effect.Effect<void> = checkpointVoid(
        checkpoints.baseline(threadId, cwd),
        "checkpoint baseline failed",
        [
          ["threadId", tid],
          ["cwd", cwd],
        ],
      ).pipe(
        Effect.andThen(turn),
        Effect.onExit((exit) => {
          const state = Exit.isSuccess(exit)
            ? ("completed" as const)
            : Exit.hasInterrupts(exit)
              ? ("aborted" as const)
              : ("failed" as const);
          const errorText =
            state === "failed" && Exit.isFailure(exit)
              ? Cause.pretty(exit.cause).slice(0, 2000)
              : undefined;
          return Effect.gen(function* () {
            const captured = yield* checkpointNullable(
              checkpoints.capture(threadId, cwd, record.ordinal),
              "checkpoint capture failed",
              [
                ["threadId", tid],
                ["turnId", String(turnId)],
                ["turn", record.ordinal],
                ["cwd", cwd],
              ],
            );
            yield* settleTurn(threadId, turnId, state, errorText, captured).pipe(
              Effect.catchCause((cause) => Effect.logError("turn settlement failed", cause)),
            );
          });
        }),
        Effect.catchCause((cause) => Effect.logError("turn runner defect", cause)),
      );
      record.fiber = yield* Effect.forkDetach(runner);
    },
    (effect, threadId, turnId) =>
      withIdAnnotations(effect, [
        ["threadId", String(threadId)],
        ["turnId", String(turnId)],
      ]),
  );

  /**
   * Promote the oldest queued message. Dequeue, entry append, leaf move, and
   * queue.updated are ONE transaction — a crash can never eat a message
   * between them. The entry parents the then-current leaf unless the send
   * pinned an explicit branch point at admission.
   */
  const promoteQueuedLocked: PromoteQueuedLocked = Effect.fn("Core.promoteQueued")(
    function* (threadId: ThreadId) {
      if (disposed) return;
      const tid = String(threadId);
      const promoted = yield* commit(tid, (append) => {
        const thread = store.getThread(tid);
        if (Option.isNone(thread)) return null;
        const next = store.shiftQueued(tid);
        if (Option.isNone(next)) return null;
        const timestamp = now();
        const parentId = next.value.parent.explicit
          ? next.value.parent.entryId
          : thread.value.leafId;
        const entry: ThreadEntry = {
          id: newId(EntryId.make, "entry"),
          parentId: parentId === null ? null : EntryId.make(parentId),
          messageId: next.value.item.messageId,
          turnId: null,
          createdAt: timestamp,
        };
        const message = store
          .listMessages(tid)
          .find((candidate) => String(candidate.id) === String(next.value.item.messageId));
        store.appendEntry(tid, entry);
        store.updateThread({ ...thread.value.summary, updatedAt: timestamp }, String(entry.id));
        if (message !== undefined) {
          append.thread((seq) => ({ _tag: "message.created", seq, message, entry }));
        }
        append.thread((seq) => ({ _tag: "tree.moved", seq, leafId: entry.id }));
        append.thread((seq) => ({ _tag: "queue.updated", seq, queue: store.listQueued(tid) }));
        return { item: next.value.item, entryId: entry.id };
      });
      if (promoted === null) return;
      yield* startTurnLocked(
        threadId,
        newId(TurnId.make, "turn"),
        promoted.item.text,
        imagesForRefs(tid, promoted.item.attachments),
        promoted.entryId,
        promoted.item.interactionMode,
      );
    },
    (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
  );

  /**
   * Settlement, serialized under stateLock. Successor priority: a supersede
   * record (interrupt-with-message) wins; then, on completed turns only,
   * leftover Steered input runs as its own turn; then the queue head.
   * Aborted (bare interrupt) and failed turns start nothing — interrupt
   * pauses the queue; the next admission drains it in order.
   */
  const settleTurn: SettleTurn = Effect.fn("Core.settleTurn")(
    function* (
      threadId: ThreadId,
      turnId: TurnId,
      state: TurnSettledState,
      errorText?: string,
      captured?: CheckpointCapture | null,
    ) {
      yield* Effect.logInfo("turn settled", { turnId: String(turnId), state });
      yield* withState(
        Effect.gen(function* () {
          const tid = String(threadId);
          const record = fibers.get(tid);
          const isCurrent = record !== undefined && String(record.turnId) === String(turnId);
          const settledMode = isCurrent ? record.interactionMode : "agent";
          const leftovers = isCurrent ? yield* Queue.clear(record.steered) : [];
          if (isCurrent) fibers.delete(tid);
          const thread = store.getThread(tid);
          if (Option.isNone(thread)) return;
          const summary: ThreadSummary = {
            ...thread.value.summary,
            status: state === "failed" ? "failed" : "idle",
            updatedAt: now(),
          };
          yield* commit(tid, (append) => {
            store.updateThread(summary, thread.value.leafId);
            append.thread((seq) => ({
              _tag: "turn.settled",
              seq,
              turnId,
              state,
              ...(errorText === undefined ? {} : { error: errorText }),
            }));
            emitSummary(append, summary);
          });
          // The git capture already ran off-lock in the runner's onExit; here
          // we only persist its result as one patch Part (a fast commit). Null
          // means no repo, no change, or a fail-open git error — no patch.
          if (captured !== null && captured !== undefined) {
            const assistantMessage = store
              .listMessages(tid)
              .find(
                (message) =>
                  message.role === "assistant" && String(message.turnId) === String(turnId),
              );
            if (assistantMessage !== undefined) {
              const patch: Part = {
                _tag: "patch",
                id: newId(PartId.make, "part"),
                messageId: assistantMessage.id,
                turnId,
                origin: "honk",
                state: "complete",
                turn: NonNegativeInt.make(captured.turn),
                ref: TrimmedNonEmptyString.make(captured.ref),
                files: captured.files,
              };
              yield* commit(tid, (append) => {
                if (Option.isNone(store.getThread(tid))) return;
                store.upsertPart(tid, patch);
                append.thread((seq) => ({ _tag: "part.created", seq, part: patch }));
              });
            }
          }

          const handoff = supersede.get(tid);
          if (handoff !== undefined) {
            supersede.delete(tid);
            yield* startTurnLocked(
              threadId,
              handoff.turnId,
              handoff.text,
              handoff.images,
              handoff.parentEntryId,
              handoff.interactionMode,
            );
            return;
          }
          if (state !== "completed") return;
          if (leftovers.length > 0) {
            const refreshed = store.getThread(tid);
            const leafId = Option.isSome(refreshed) ? refreshed.value.leafId : null;
            // Leftover Steer joined the settled turn's work, so it inherits that turn's mode.
            yield* startTurnLocked(
              threadId,
              newId(TurnId.make, "turn"),
              leftovers.map((item) => item.text).join("\n"),
              leftovers.flatMap((item) => item.images),
              leafId === null ? null : EntryId.make(leafId),
              settledMode,
            );
            return;
          }
          yield* promoteQueuedLocked(threadId);
        }),
      );
    },
    (effect, threadId, turnId) =>
      withIdAnnotations(effect, [
        ["threadId", String(threadId)],
        ["turnId", String(turnId)],
      ]),
  );

  const getDetail = Effect.fn("Core.getDetail")(
    function* (threadId: ThreadId) {
      const thread = yield* requireThread(threadId);
      const entries = store.listEntries(String(threadId));
      const byId = new Map(entries.map((entry) => [String(entry.id), entry]));
      const path: Array<ThreadEntry> = [];
      let cursor = thread.leafId;
      while (cursor !== null) {
        const entry = byId.get(cursor);
        if (entry === undefined) break;
        path.push(entry);
        cursor = entry.parentId === null ? null : String(entry.parentId);
      }
      path.reverse();
      const messageRows = store.listMessages(String(threadId));
      const messagesById = new Map(messageRows.map((message) => [String(message.id), message]));
      const messages = path.flatMap((entry) => {
        if (entry.messageId === null) return [];
        const message = messagesById.get(String(entry.messageId));
        return message === undefined ? [] : [message];
      });
      const partsByMessage = new Map<string, Array<Part>>();
      for (const part of store.listParts(String(threadId))) {
        const existing = partsByMessage.get(String(part.messageId));
        if (existing === undefined) partsByMessage.set(String(part.messageId), [part]);
        else existing.push(part);
      }
      const parts = messages.flatMap((message) => partsByMessage.get(String(message.id)) ?? []);
      const entry = catalogEntry(thread.summary.model);
      const harness = entry === undefined ? undefined : harnesses[entry.provider];
      return {
        summary: thread.summary,
        cwd: thread.cwd,
        // The pinned Harness's own declaration (grill 2026-07-02, round 2);
        // a missing arm can only mean pre-cutover data — advertise nothing.
        capabilities: harness?.capabilities ?? { steer: false },
        entries,
        leafId: thread.leafId === null ? null : EntryId.make(thread.leafId),
        messages,
        parts,
        queue: store.listQueued(String(threadId)),
        seq: store.threadEventHighWater(String(threadId)),
      };
    },
    (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
  );

  const mutateSummary = (
    threadId: ThreadId,
    mutate: (summary: ThreadSummary) => ThreadSummary,
  ): Effect.Effect<ThreadSummary, ThreadNotFoundError> =>
    withState(
      Effect.gen(function* () {
        const thread = yield* requireThread(threadId);
        const summary = mutate({ ...thread.summary, updatedAt: now() });
        return yield* commit(String(threadId), (append) => {
          store.updateThread(summary, thread.leafId);
          emitSummary(append, summary);
          return summary;
        });
      }),
    );

  const storeAttachments = (
    threadId: string,
    input: SendMessageInput,
  ): { refs: Array<AttachmentRef>; images: Array<PromptImage> } => {
    const refs: Array<AttachmentRef> = [];
    const images: Array<PromptImage> = [];
    for (const upload of input.attachments ?? []) {
      const parsed = parseDataUrl(upload.dataUrl);
      if (parsed === null) continue;
      const bytes = Buffer.from(parsed.base64, "base64");
      const id = newId(AttachmentId.make, "att");
      const dir = join(home.attachmentsDir, threadId);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, String(id));
      writeFileSync(path, bytes);
      store.putAttachment({
        id: String(id),
        threadId,
        name: upload.name,
        mimeType: upload.mimeType,
        sizeBytes: bytes.length,
        path,
      });
      refs.push({
        id,
        name: upload.name,
        mimeType: upload.mimeType,
        sizeBytes: bytes.length,
        url: `/core/v1/threads/${threadId}/attachments/${String(id)}`,
      });
      if (upload.mimeType.startsWith("image/")) {
        images.push({ mimeType: upload.mimeType, base64: parsed.base64 });
      }
    }
    return { refs, images };
  };

  return {
    store,
    buses,
    auth,
    checkpoints,
    startedAt,
    availability,

    /** ADR 0005 boot sweep: turns killed by a crash settle as aborted, never resume ambiguously. */
    recover: Effect.fn("Core.recover")(function* () {
      yield* withState(
        Effect.gen(function* () {
          for (const summary of store.listRunningThreads()) {
            const tid = String(summary.id);
            const unsettled = store.lastUnsettledTurnId(tid);
            const turnId =
              unsettled === null ? newId(TurnId.make, "turn_recovered") : TurnId.make(unsettled);
            const thread = store.getThread(tid);
            if (Option.isNone(thread)) continue;
            const idle: ThreadSummary = { ...summary, status: "idle", updatedAt: now() };
            yield* commit(tid, (append) => {
              store.updateThread(idle, thread.value.leafId);
              append.thread((seq) => ({
                _tag: "turn.settled",
                seq,
                turnId,
                state: "aborted",
                error: "core restarted while the turn was running",
              }));
              emitSummary(append, idle);
            });
          }
        }),
      );
    }),

    /** Serialized like every other creation-order-sensitive transition: racing duplicate creates must resolve to replay-or-conflict, never a constraint defect. */
    createThread: Effect.fn("Core.createThread")(
      function* (input: CreateThreadInput) {
        return yield* withState(
          Effect.gen(function* () {
            const threadId = input.threadId ?? newId(ThreadId.make, "thread");
            const hash = canonicalHash(input);
            const existing = store.getThread(String(threadId));
            // Idempotent replay wins over validation: the same create must keep
            // returning its summary even after auth state drifted underneath.
            if (Option.isSome(existing)) {
              if (existing.value.createHash === hash) return existing.value.summary;
              return yield* Effect.fail(new ThreadConflictError({ threadId }));
            }
            const pin = resolveModelPin(availability(), {
              ...(input.model === undefined ? {} : { model: input.model }),
              ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
            });
            if (pin instanceof ModelUnavailableError) {
              return yield* Effect.fail(pin);
            }
            const timestamp = now();
            const summary: ThreadSummary = {
              id: threadId,
              projectId: input.projectId ?? null,
              title: input.title ?? "New thread",
              status: "idle",
              needsAttention: false,
              model: pin.model,
              thinkingLevel: pin.thinkingLevel,
              latestUserMessageAt: null,
              archivedAt: null,
              worktree: input.worktree ?? null,
              createdAt: timestamp,
              updatedAt: timestamp,
            };
            return yield* commit(null, (append) => {
              store.insertThread(summary, input.cwd, hash);
              append.workspace((seq) => ({ _tag: "thread.updated", seq, summary }));
              return summary;
            });
          }),
        );
      },
      (effect, input) =>
        withIdAnnotations(effect, [
          ["threadId", input.threadId === undefined ? undefined : String(input.threadId)],
        ]),
    ),

    listThreads: (archived) => ({
      threads: store.listThreads(archived),
      seq: store.workspaceEventHighWater(),
    }),

    getDetail,

    updateThread: Effect.fn("Core.updateThread")(
      function* (threadId: ThreadId, input: UpdateThreadInput) {
        return yield* mutateSummary(threadId, (summary) => ({
          ...summary,
          title: input.title ?? summary.title,
        }));
      },
      (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
    ),

    archiveThread: Effect.fn("Core.archiveThread")(
      function* (threadId: ThreadId) {
        return yield* mutateSummary(threadId, (summary) => ({ ...summary, archivedAt: now() }));
      },
      (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
    ),

    unarchiveThread: Effect.fn("Core.unarchiveThread")(
      function* (threadId: ThreadId) {
        return yield* mutateSummary(threadId, (summary) => ({ ...summary, archivedAt: null }));
      },
      (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
    ),

    removeThread: Effect.fn("Core.removeThread")(
      function* (threadId: ThreadId) {
        const tid = String(threadId);
        const removed = yield* withState(
          Effect.gen(function* () {
            const thread = yield* requireThread(threadId);
            const record = fibers.get(tid);
            fibers.delete(tid);
            supersede.delete(tid);
            if (record !== undefined && record.fiber !== null) {
              // Detached: the zombie must stop even if THIS request dies now.
              // Its writes are already no-ops (partEffects guard) once the
              // rows below are gone.
              yield* Effect.forkDetach(Fiber.interrupt(record.fiber));
            }
            yield* commit(null, (append) => {
              store.deleteThread(tid);
              append.workspace((seq) => ({ _tag: "thread.removed", seq, threadId }));
            });
            rmSync(join(home.attachmentsDir, tid), { recursive: true, force: true });
            yield* buses.closeThread(tid);
            return {
              fiber: record?.fiber ?? null,
              harnessSession: thread.harnessSession,
              cwd: thread.cwd,
            };
          }),
        );
        yield* checkpointVoid(
          checkpoints.pruneThread(threadId, removed.cwd),
          "checkpoint prune failed",
          [
            ["threadId", String(threadId)],
            ["cwd", removed.cwd],
          ],
        );
        if (removed.fiber !== null) {
          yield* Fiber.join(removed.fiber).pipe(Effect.exit);
        }
        // After the fiber is dead: the harness session ref is opaque, but
        // pi's is a JSONL path in our own harness space — a removed Thread
        // must not orphan it (deleting earlier would let the dying turn
        // recreate the file).
        if (
          removed.harnessSession !== null &&
          removed.harnessSession.startsWith(home.piDir + sep)
        ) {
          rmSync(removed.harnessSession, { force: true });
        }
      },
      (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
    ),

    navigate: Effect.fn("Core.navigate")(
      function* (threadId: ThreadId, entryId: EntryId) {
        yield* withState(
          Effect.gen(function* () {
            const thread = yield* requireThread(threadId);
            const entries = store.listEntries(String(threadId));
            if (!entries.some((entry) => String(entry.id) === String(entryId))) {
              return yield* Effect.fail(new EntryNotFoundError({ threadId, entryId }));
            }
            const summary = { ...thread.summary, updatedAt: now() };
            yield* commit(String(threadId), (append) => {
              store.updateThread(summary, String(entryId));
              append.thread((seq) => ({ _tag: "tree.moved", seq, leafId: entryId }));
              emitSummary(append, summary);
            });
          }),
        );
        return yield* getDetail(threadId);
      },
      (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
    ),

    admit: Effect.fn("Core.admit")(
      function* (threadId: ThreadId, input: SendMessageInput) {
        const tid = String(threadId);
        const outcome = yield* withState(
          Effect.gen(function* () {
            const thread = yield* requireThread(threadId);
            const payloadHash = canonicalHash(input);
            const existing = store.getAdmission(tid, String(input.messageId));
            if (Option.isSome(existing)) {
              if (existing.value.payloadHash === payloadHash) {
                return { kind: "replay" as const, receipt: existing.value.receipt };
              }
              return yield* Effect.fail(
                new MessageConflictError({ threadId, messageId: input.messageId }),
              );
            }
            const entries = store.listEntries(tid);
            let parentId: string | null;
            if (input.parentEntryId === undefined) {
              parentId = thread.leafId;
            } else if (input.parentEntryId === null) {
              parentId = null;
            } else {
              const wanted = String(input.parentEntryId);
              if (!entries.some((entry) => String(entry.id) === wanted)) {
                return yield* Effect.fail(
                  new EntryNotFoundError({ threadId, entryId: input.parentEntryId }),
                );
              }
              parentId = wanted;
            }

            const running = fibers.has(tid) || supersede.has(tid);
            const backlog = store.queuedCount(tid) > 0;
            // A steer the pinned Harness cannot honor downgrades to queue at
            // admission — the receipt's disposition tells the client (the
            // ThreadCapabilities contract; Claude only queues, ACP has no
            // mid-turn injection).
            const pinnedEntry = catalogEntry(thread.summary.model);
            const canSteer =
              (pinnedEntry === undefined ? undefined : harnesses[pinnedEntry.provider])
                ?.capabilities.steer === true;
            const requested = input.delivery ?? "queue";
            const delivery = requested === "steer" && !canSteer ? "queue" : requested;
            const disposition: Disposition = running
              ? delivery === "steer"
                ? "steered"
                : delivery === "interrupt"
                  ? "interrupted"
                  : "queued"
              : backlog
                ? "queued"
                : "started";

            const timestamp = now();
            const stored = storeAttachments(tid, input);
            const message: Message = {
              id: input.messageId,
              role: "user",
              turnId: null,
              attachments: stored.refs,
              error: null,
              createdAt: timestamp,
            };
            const summary: ThreadSummary = {
              ...thread.summary,
              latestUserMessageAt: timestamp,
              updatedAt: timestamp,
            };
            const interactionMode = input.interactionMode ?? "agent";
            const queuedItem: QueuedMessage = {
              messageId: input.messageId,
              text: input.text,
              attachments: stored.refs,
              interactionMode,
              createdAt: timestamp,
            };
            const turnId =
              disposition === "started" || disposition === "interrupted"
                ? newId(TurnId.make, "turn")
                : disposition === "steered"
                  ? (fibers.get(tid)?.turnId ?? null)
                  : null;

            // A pending supersede record being replaced is a turn that was
            // promised (its receipt carries the turnId) but never ran: it
            // settles as instantly-aborted on the wire, and its input folds
            // into the successor so nothing the user typed goes missing.
            const replaced = disposition === "interrupted" ? supersede.get(tid) : undefined;

            // Queued messages get NO entry here — promotion creates it, at
            // the then-current leaf unless this send pinned a branch point.
            const entry: ThreadEntry | null =
              disposition === "queued"
                ? null
                : {
                    id: newId(EntryId.make, "entry"),
                    parentId: parentId === null ? null : EntryId.make(parentId),
                    messageId: input.messageId,
                    turnId: null,
                    createdAt: timestamp,
                  };

            // The Message row holds row-level facts only; the text IS a Part
            // (part.ts: "the wire carries raw text only" — prompt-token chips
            // are client rendering, ADR 0013). Queued messages' parts stay off
            // the active path until promotion appends their entry.
            const userTextPart: Part = {
              _tag: "text",
              id: newId(PartId.make, "part"),
              messageId: input.messageId,
              turnId: null,
              origin: "honk",
              state: "complete",
              text: input.text,
            };
            const receipt: AdmissionReceipt = yield* commit(tid, (append) => {
              if (replaced !== undefined) {
                append.thread((seq) => ({ _tag: "turn.started", seq, turnId: replaced.turnId }));
                append.thread((seq) => ({
                  _tag: "turn.settled",
                  seq,
                  turnId: replaced.turnId,
                  state: "aborted",
                  error: "superseded by a newer force send",
                }));
              }
              store.upsertMessage(tid, message);
              store.upsertPart(tid, userTextPart);
              append.thread((seq) => ({ _tag: "part.created", seq, part: userTextPart }));
              let seqOfAdmission = 0;
              if (entry !== null) {
                store.appendEntry(tid, entry);
                store.updateThread(summary, String(entry.id));
                append.thread((seq) => {
                  seqOfAdmission = seq;
                  return { _tag: "message.created", seq, message, entry };
                });
                append.thread((seq) => ({ _tag: "tree.moved", seq, leafId: entry.id }));
              } else {
                store.updateThread(summary, thread.leafId);
                store.putQueued(tid, queuedItem, {
                  explicit: input.parentEntryId !== undefined,
                  entryId: parentId,
                });
                append.thread((seq) => {
                  seqOfAdmission = seq;
                  return { _tag: "queue.updated", seq, queue: store.listQueued(tid) };
                });
              }
              emitSummary(append, summary);
              const built: AdmissionReceipt = {
                threadId,
                messageId: input.messageId,
                turnId,
                disposition,
                seq: seqOfAdmission,
              };
              store.putAdmission(tid, String(input.messageId), payloadHash, built);
              return built;
            });

            if (disposition === "started" && entry !== null && turnId !== null) {
              yield* startTurnLocked(
                threadId,
                turnId,
                input.text,
                stored.images,
                entry.id,
                interactionMode,
              );
            } else if (disposition === "steered") {
              const record = fibers.get(tid);
              // No record = the supersede window; the message is durable in
              // the thread either way, and a dying turn's mailbox was never
              // going to reach the model (same as legacy).
              if (record !== undefined) {
                yield* Queue.offer(record.steered, { text: input.text, images: stored.images });
              }
            } else if (disposition === "interrupted" && entry !== null && turnId !== null) {
              supersede.set(tid, {
                turnId,
                text: replaced === undefined ? input.text : `${replaced.text}\n${input.text}`,
                images:
                  replaced === undefined ? stored.images : [...replaced.images, ...stored.images],
                parentEntryId: entry.id,
                interactionMode,
              });
              const target = fibers.get(tid)?.fiber ?? null;
              if (target !== null) {
                // Detached: the running turn must stop even if this request dies now.
                yield* Effect.forkDetach(Fiber.interrupt(target));
              }
              return { kind: "interrupt" as const, receipt, fiber: target };
            } else if (disposition === "queued" && !running) {
              yield* promoteQueuedLocked(threadId);
            }
            return { kind: "done" as const, receipt };
          }),
        );
        if (outcome.kind === "interrupt" && outcome.fiber !== null) {
          yield* Fiber.join(outcome.fiber).pipe(Effect.exit);
        }
        return outcome.receipt;
      },
      (effect, threadId, input) =>
        withIdAnnotations(effect, [
          ["threadId", String(threadId)],
          ["messageId", String(input.messageId)],
        ]),
    ),

    interrupt: Effect.fn("Core.interrupt")(
      function* (threadId: ThreadId, turnId?: TurnId) {
        const tid = String(threadId);
        const target = yield* withState(
          Effect.gen(function* () {
            yield* requireThread(threadId);
            const record = fibers.get(tid);
            if (record === undefined || record.fiber === null) return null;
            if (turnId !== undefined && String(turnId) !== String(record.turnId)) return null;
            // Detached: delivery must not depend on this request surviving.
            yield* Effect.forkDetach(Fiber.interrupt(record.fiber));
            return { fiber: record.fiber, turnId: record.turnId };
          }),
        );
        if (target === null) return { turnId: null };
        yield* Fiber.join(target.fiber).pipe(Effect.exit);
        return { turnId: target.turnId };
      },
      (effect, threadId, turnId) =>
        withIdAnnotations(effect, [
          ["threadId", String(threadId)],
          ["turnId", turnId === undefined ? undefined : String(turnId)],
        ]),
    ),

    cancelQueued: Effect.fn("Core.cancelQueued")(
      function* (threadId: ThreadId, messageId: MessageId) {
        return yield* withState(
          Effect.gen(function* () {
            const tid = String(threadId);
            yield* requireThread(threadId);
            const removed = store.removeQueued(tid, String(messageId));
            if (Option.isNone(removed)) {
              return yield* Effect.fail(new QueuedMessageNotFoundError({ threadId, messageId }));
            }
            yield* commit(tid, (append) => {
              store.deleteMessage(tid, String(messageId));
              append.thread((seq) => ({
                _tag: "queue.updated",
                seq,
                queue: store.listQueued(tid),
              }));
            });
            return removed.value;
          }),
        );
      },
      (effect, threadId, messageId) =>
        withIdAnnotations(effect, [
          ["threadId", String(threadId)],
          ["messageId", String(messageId)],
        ]),
    ),

    answerQuestion: Effect.fn("Core.answerQuestion")(
      function* (threadId: ThreadId, questionId: QuestionId, answers: Record<string, unknown>) {
        yield* withState(
          Effect.gen(function* () {
            yield* requireThread(threadId);
            // state "active" is required: a question whose turn died was closed
            // by the harness epilogue (complete + still pending = expired), and
            // answering it would report success no model would ever see.
            const part = store
              .listParts(String(threadId))
              .find(
                (candidate) =>
                  candidate._tag === "question" &&
                  String(candidate.questionId) === String(questionId) &&
                  candidate.status === "pending" &&
                  candidate.state === "active",
              );
            if (part === undefined || part._tag !== "question") {
              return yield* Effect.fail(new QuestionNotFoundError({ threadId, questionId }));
            }
            const answered: Part = { ...part, status: "answered", answers, state: "complete" };
            yield* commit(String(threadId), (append) => {
              store.upsertPart(String(threadId), answered);
              append.thread((seq) => ({ _tag: "part.updated", seq, part: answered }));
            });
            const waiter = answerWaiters.get(`${String(threadId)}:${String(questionId)}`);
            if (waiter !== undefined) yield* Deferred.succeed(waiter, answers);
          }),
        );
      },
      (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
    ),

    implementPlan: Effect.fn("Core.implementPlan")(
      function* (threadId: ThreadId, planId: PlanId) {
        yield* requireThread(threadId);
        const part = store
          .listParts(String(threadId))
          .find(
            (candidate) => candidate._tag === "plan" && String(candidate.planId) === String(planId),
          );
        if (part === undefined || part._tag !== "plan") {
          return yield* Effect.fail(new PlanNotFoundError({ threadId, planId }));
        }
        const implemented: Part = { ...part, implementedAt: now() };
        yield* commit(String(threadId), (append) => {
          store.upsertPart(String(threadId), implemented);
          append.thread((seq) => ({ _tag: "part.updated", seq, part: implemented }));
        });
      },
      (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
    ),

    attachmentBytes: Effect.fn("Core.attachmentBytes")(
      function* (threadId: ThreadId, attachmentId: AttachmentId) {
        yield* requireThread(threadId);
        const attachment = store.getAttachment(String(threadId), String(attachmentId));
        if (Option.isNone(attachment)) {
          return yield* Effect.fail(new AttachmentNotFoundError({ threadId, attachmentId }));
        }
        const bytes = readFileSync(attachment.value.path);
        return { bytes, mimeType: attachment.value.mimeType, name: attachment.value.name };
      },
      (effect, threadId) => withIdAnnotations(effect, [["threadId", String(threadId)]]),
    ),

    /**
     * Two phases: mark disposed and snapshot under the lock (no successor
     * can start after this), then interrupt and AWAIT every turn outside it
     * (settlement needs the lock and the open store), and only then close.
     */
    dispose: Effect.fn("Core.dispose")(function* () {
      const records = yield* withState(
        Effect.sync(() => {
          disposed = true;
          const list = [...fibers.values()];
          fibers.clear();
          supersede.clear();
          return list;
        }),
      );
      for (const record of records) {
        if (record.fiber !== null) yield* Fiber.interrupt(record.fiber);
      }
      yield* auth.dispose();
      yield* buses.dispose();
      store.close();
    }),
  };
};
