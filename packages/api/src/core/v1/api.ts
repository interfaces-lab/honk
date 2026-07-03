import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { AuthSnapshot, LoginInput } from "./auth";
import {
  AttachmentId,
  EntryId,
  MessageId,
  ModelId,
  PlanId,
  ProjectId,
  QuestionId,
  SessionId,
  TerminalId,
  ThreadId,
  TurnId,
} from "./id";
import { CredentialKind, ModelCatalog, ThinkingLevel } from "./model";
import {
  IsoTimestamp,
  NonNegativeInt,
  strictDecode,
  TrimmedNonEmptyString,
  UnknownRecord,
} from "./primitives";
import { AdmissionReceipt, SendMessageInput } from "./send";
import { PairingIssue, Session, SessionAuth, SessionGrant, UnauthorizedError } from "./session";
import {
  ConnectTicket,
  CreateTerminalInput,
  Terminal,
  TerminalList,
  TerminalNotFoundError,
} from "./terminal";
import { QueuedMessage, ThreadDetail, ThreadSummary, ThreadWorktree } from "./thread";

export class ThreadNotFoundError extends Schema.TaggedErrorClass<ThreadNotFoundError>()(
  "ThreadNotFoundError",
  { threadId: ThreadId },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `Thread not found: ${this.threadId}`;
  }
}

export class TurnCheckpointNotFoundError extends Schema.TaggedErrorClass<TurnCheckpointNotFoundError>()(
  "TurnCheckpointNotFoundError",
  { threadId: ThreadId, turn: NonNegativeInt },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `Checkpoint not found in thread ${this.threadId} for turn ${this.turn}`;
  }
}

export class GitUnavailableError extends Schema.TaggedErrorClass<GitUnavailableError>()(
  "GitUnavailableError",
  { cwd: TrimmedNonEmptyString },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return `Git repository unavailable for ${this.cwd}`;
  }
}

export class GitOperationError extends Schema.TaggedErrorClass<GitOperationError>()(
  "GitOperationError",
  { operation: TrimmedNonEmptyString, cwd: TrimmedNonEmptyString, detail: Schema.String },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Git operation failed (${this.operation}) in ${this.cwd}: ${this.detail}`;
  }
}

/** Same thread id recreated with a different payload (create is idempotent on exact replay). */
export class ThreadConflictError extends Schema.TaggedErrorClass<ThreadConflictError>()(
  "ThreadConflictError",
  { threadId: ThreadId },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return `Thread ${this.threadId} already exists with a different configuration`;
  }
}

export class EntryNotFoundError extends Schema.TaggedErrorClass<EntryNotFoundError>()(
  "EntryNotFoundError",
  { threadId: ThreadId, entryId: EntryId },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `Entry not found in thread ${this.threadId}: ${this.entryId}`;
  }
}

/**
 * Creation named a (model, thinkingLevel) the Core cannot run — the reasons
 * render differently (stale catalog / not a Mode pair / a go-log-in CTA),
 * hence the closed literal. Enforcement lives here and only here:
 * availability is never pushed, so a stale picker discovers reality by this
 * rejection (fetch-only auth posture).
 */
export class ModelUnavailableError extends Schema.TaggedErrorClass<ModelUnavailableError>()(
  "ModelUnavailableError",
  {
    model: ModelId,
    reason: Schema.Literals(["unknown-model", "unsupported-thinking-level", "no-available-route"]),
  },
  { httpApiStatus: 422 },
) {
  override get message(): string {
    return `Model ${this.model} is unavailable: ${this.reason}`;
  }
}

/** A second OAuth login attempted while one is already in flight (the Core runs at most one). */
export class LoginFlowConflictError extends Schema.TaggedErrorClass<LoginFlowConflictError>()(
  "LoginFlowConflictError",
  { kind: CredentialKind },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return `A login flow for ${this.kind} is already pending`;
  }
}

export class ForbiddenError extends Schema.TaggedErrorClass<ForbiddenError>()(
  "ForbiddenError",
  {},
  { httpApiStatus: 403 },
) {
  override get message(): string {
    return "Session is not allowed to perform this action";
  }
}

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "SessionNotFoundError",
  { sessionId: SessionId },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `Session not found: ${this.sessionId}`;
  }
}

/** Same message id resubmitted with a different payload (ADR 0005). */
export class MessageConflictError extends Schema.TaggedErrorClass<MessageConflictError>()(
  "MessageConflictError",
  { threadId: ThreadId, messageId: MessageId },
  { httpApiStatus: 409 },
) {
  override get message(): string {
    return `Message ${this.messageId} was already admitted with a different payload`;
  }
}

export class QueuedMessageNotFoundError extends Schema.TaggedErrorClass<QueuedMessageNotFoundError>()(
  "QueuedMessageNotFoundError",
  { threadId: ThreadId, messageId: MessageId },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No queued message ${this.messageId} in thread ${this.threadId}`;
  }
}

export class AttachmentNotFoundError extends Schema.TaggedErrorClass<AttachmentNotFoundError>()(
  "AttachmentNotFoundError",
  { threadId: ThreadId, attachmentId: AttachmentId },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No attachment ${this.attachmentId} in thread ${this.threadId}`;
  }
}

export class QuestionNotFoundError extends Schema.TaggedErrorClass<QuestionNotFoundError>()(
  "QuestionNotFoundError",
  { threadId: ThreadId, questionId: QuestionId },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No pending question ${this.questionId} in thread ${this.threadId}`;
  }
}

export class PlanNotFoundError extends Schema.TaggedErrorClass<PlanNotFoundError>()(
  "PlanNotFoundError",
  { threadId: ThreadId, planId: PlanId },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No plan ${this.planId} in thread ${this.threadId}`;
  }
}

/**
 * beta.59 has no SSE schema: stream endpoints declare their content type
 * here and serve frames via handleRaw + HttpServerResponse.stream. Each SSE
 * `data:` field is one JSON-encoded ThreadStreamEvent / ThreadSummaryEvent;
 * the SDK owns frame parsing and decodes fail-closed. Protocol hygiene
 * (opencode's lessons): the server emits a comment heartbeat every 15s and a
 * terminal `event: goodbye` frame on clean shutdown, so clients distinguish
 * shutdown from network failure; derived clients call these endpoints with
 * responseMode "response-only".
 */
const EventStream = Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" }));

/**
 * `model` and `thinkingLevel` are pinned here forever — no update or per-send
 * override exists (ADR 0014). Omitting them takes the catalog's defaultModel
 * and the model's defaultThinkingLevel.
 */
export const CreateThreadInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  projectId: Schema.optional(ProjectId),
  title: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(ModelId),
  thinkingLevel: Schema.optional(ThinkingLevel),
  worktree: Schema.optional(Schema.NullOr(ThreadWorktree)),
  cwd: TrimmedNonEmptyString,
});
export type CreateThreadInput = typeof CreateThreadInput.Type;

export const UpdateThreadInput = Schema.Struct({
  title: Schema.optional(TrimmedNonEmptyString),
});
export type UpdateThreadInput = typeof UpdateThreadInput.Type;

/** The liveness/handshake surface: discovery probes hit this before attaching (ADR 0002). */
export const CoreHealth = Schema.Struct({
  pid: Schema.Int,
  version: TrimmedNonEmptyString,
  apiVersion: Schema.Literal("core/v1"),
  startedAt: IsoTimestamp,
});
export type CoreHealth = typeof CoreHealth.Type;
export const decodeCoreHealth = strictDecode(CoreHealth);

export const FileDiff = Schema.Struct({
  path: TrimmedNonEmptyString,
  before: Schema.NullOr(Schema.String),
  after: Schema.NullOr(Schema.String),
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type FileDiff = typeof FileDiff.Type;

const meta = HttpApiGroup.make("meta").add(
  HttpApiEndpoint.get("health", "/health", {
    success: CoreHealth,
  }),
);

const threads = HttpApiGroup.make("threads")
  .add(
    /**
     * Complete by design — the sidebar consumes the full non-archived list and
     * no product surface pages. Default excludes archived threads.
     */
    HttpApiEndpoint.get("list", "/threads", {
      query: { archived: Schema.optional(Schema.Boolean) },
      success: Schema.Struct({ threads: Schema.Array(ThreadSummary), seq: NonNegativeInt }),
    }),
    HttpApiEndpoint.get("watch", "/threads/watch", {
      query: { after: Schema.optional(NonNegativeInt) },
      success: EventStream,
    }),
    HttpApiEndpoint.post("create", "/threads", {
      payload: CreateThreadInput,
      success: ThreadSummary.pipe(HttpApiSchema.status(201)),
      error: [ThreadConflictError, ModelUnavailableError],
    }),
    HttpApiEndpoint.get("get", "/threads/:threadId", {
      params: { threadId: ThreadId },
      success: ThreadDetail,
      error: ThreadNotFoundError,
    }),
    HttpApiEndpoint.get("watchThread", "/threads/:threadId/watch", {
      params: { threadId: ThreadId },
      query: { after: Schema.optional(NonNegativeInt) },
      success: EventStream,
      error: ThreadNotFoundError,
    }),
    HttpApiEndpoint.patch("update", "/threads/:threadId", {
      params: { threadId: ThreadId },
      payload: UpdateThreadInput,
      success: ThreadSummary,
      error: ThreadNotFoundError,
    }),
    HttpApiEndpoint.post("archive", "/threads/:threadId/archive", {
      params: { threadId: ThreadId },
      success: ThreadSummary,
      error: ThreadNotFoundError,
    }),
    HttpApiEndpoint.post("unarchive", "/threads/:threadId/unarchive", {
      params: { threadId: ThreadId },
      success: ThreadSummary,
      error: ThreadNotFoundError,
    }),
    HttpApiEndpoint.delete("remove", "/threads/:threadId", {
      params: { threadId: ThreadId },
      error: ThreadNotFoundError,
    }),
    HttpApiEndpoint.post("navigate", "/threads/:threadId/tree/navigate", {
      params: { threadId: ThreadId },
      payload: Schema.Struct({ entryId: EntryId }),
      success: ThreadDetail,
      error: [ThreadNotFoundError, EntryNotFoundError],
    }),
  )
  .middleware(SessionAuth);

const checkpoints = HttpApiGroup.make("checkpoints")
  .add(
    HttpApiEndpoint.get("turnDiff", "/threads/:threadId/diff/turn/:turn", {
      params: { threadId: ThreadId, turn: NonNegativeInt },
      success: Schema.Struct({ files: Schema.Array(FileDiff) }),
      error: [
        ThreadNotFoundError,
        TurnCheckpointNotFoundError,
        GitUnavailableError,
        GitOperationError,
      ],
    }),
    HttpApiEndpoint.get("fullDiff", "/threads/:threadId/diff", {
      params: { threadId: ThreadId },
      success: Schema.Struct({ files: Schema.Array(FileDiff) }),
      error: [
        ThreadNotFoundError,
        TurnCheckpointNotFoundError,
        GitUnavailableError,
        GitOperationError,
      ],
    }),
    HttpApiEndpoint.post("revertTurn", "/threads/:threadId/revert/turn/:turn", {
      params: { threadId: ThreadId, turn: NonNegativeInt },
      success: Schema.Struct({}),
      error: [
        ThreadNotFoundError,
        TurnCheckpointNotFoundError,
        GitUnavailableError,
        GitOperationError,
      ],
    }),
    HttpApiEndpoint.post("initRepo", "/threads/:threadId/git/init", {
      params: { threadId: ThreadId },
      success: Schema.Struct({ initialized: Schema.Boolean }),
      error: [ThreadNotFoundError, GitOperationError],
    }),
  )
  .middleware(SessionAuth);

const messages = HttpApiGroup.make("messages")
  .add(
    HttpApiEndpoint.post("send", "/threads/:threadId/messages", {
      params: { threadId: ThreadId },
      payload: SendMessageInput,
      success: AdmissionReceipt.pipe(HttpApiSchema.status(202)),
      error: [ThreadNotFoundError, MessageConflictError, EntryNotFoundError],
    }),
    HttpApiEndpoint.post("interrupt", "/threads/:threadId/interrupt", {
      params: { threadId: ThreadId },
      payload: Schema.Struct({ turnId: Schema.optional(TurnId) }),
      success: Schema.Struct({ turnId: Schema.NullOr(TurnId) }),
      error: ThreadNotFoundError,
    }),
    HttpApiEndpoint.delete("cancelQueued", "/threads/:threadId/queue/:messageId", {
      params: { threadId: ThreadId, messageId: MessageId },
      success: QueuedMessage,
      error: [ThreadNotFoundError, QueuedMessageNotFoundError],
    }),
  )
  .middleware(SessionAuth);

/**
 * Attachment bytes, out-of-band from the Part stream (AttachmentRef.url is
 * the relative form of this endpoint, resolved against the Core origin).
 * The contract declares octet-stream; the handler serves the attachment's
 * real mimeType at runtime via handleRaw. Upload stays inline on send
 * (bounded 8 x 10MiB); upload-first can be added additively if ever needed.
 */
const attachments = HttpApiGroup.make("attachments")
  .add(
    HttpApiEndpoint.get("bytes", "/threads/:threadId/attachments/:attachmentId", {
      params: { threadId: ThreadId, attachmentId: AttachmentId },
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      error: [ThreadNotFoundError, AttachmentNotFoundError],
    }),
  )
  .middleware(SessionAuth);

/** The hardcoded three-model catalog (ADR 0016); fetch-only — availability is enforced at threads.create, never pushed. */
const models = HttpApiGroup.make("models")
  .add(
    HttpApiEndpoint.get("catalog", "/models", {
      success: ModelCatalog,
    }),
  )
  .middleware(SessionAuth);

/**
 * Reads are for every session; the mutation verbs are Core App capability
 * (desktop/CLI) — web sessions get 403. Every
 * mutation returns the whole snapshot: settings repaints from one shape.
 * Login-flow progress is fetch-only too — the POST response carries the
 * device code / verification URI inside snapshot.flow, and completion shows
 * up on the next GET (the flow clears to null).
 */
const auth = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("get", "/auth", {
      success: AuthSnapshot,
    }),
    HttpApiEndpoint.post("login", "/auth/login", {
      payload: LoginInput,
      success: AuthSnapshot,
      error: [LoginFlowConflictError, ForbiddenError],
    }),
    HttpApiEndpoint.post("logout", "/auth/logout", {
      payload: Schema.Struct({ kind: CredentialKind }),
      success: AuthSnapshot,
      error: ForbiddenError,
    }),
    /** Cancels the pending OAuth flow; idempotent — no flow is not an error. */
    HttpApiEndpoint.delete("cancelFlow", "/auth/flow", {
      success: AuthSnapshot,
      error: ForbiddenError,
    }),
  )
  .middleware(SessionAuth);

/** ADR 0007's surviving flows: answering questions and green-lighting plans — never permission gates. */
const interactions = HttpApiGroup.make("interactions")
  .add(
    HttpApiEndpoint.post("answerQuestion", "/threads/:threadId/questions/:questionId/answer", {
      params: { threadId: ThreadId, questionId: QuestionId },
      payload: Schema.Struct({ answers: UnknownRecord }),
      error: [ThreadNotFoundError, QuestionNotFoundError],
    }),
    HttpApiEndpoint.post("implementPlan", "/threads/:threadId/plans/:planId/implement", {
      params: { threadId: ThreadId, planId: PlanId },
      error: [ThreadNotFoundError, PlanNotFoundError],
    }),
  )
  .middleware(SessionAuth);

const terminals = HttpApiGroup.make("terminals")
  .add(
    HttpApiEndpoint.get("list", "/terminals", {
      success: TerminalList,
    }),
    HttpApiEndpoint.post("create", "/terminals", {
      payload: CreateTerminalInput,
      success: Terminal,
    }),
    HttpApiEndpoint.post("ticket", "/terminals/:terminalId/tickets", {
      params: { terminalId: TerminalId },
      success: ConnectTicket,
      error: TerminalNotFoundError,
    }),
    HttpApiEndpoint.delete("close", "/terminals/:terminalId", {
      params: { terminalId: TerminalId },
      error: TerminalNotFoundError,
    }),
    HttpApiEndpoint.post("restart", "/terminals/:terminalId/restart", {
      params: { terminalId: TerminalId },
      success: Terminal,
      error: TerminalNotFoundError,
    }),
  )
  .middleware(SessionAuth);

const sessions = HttpApiGroup.make("sessions")
  .add(
    HttpApiEndpoint.get("list", "/sessions", {
      success: Schema.Struct({ sessions: Schema.Array(Session) }),
      error: ForbiddenError,
    }),
    HttpApiEndpoint.delete("revoke", "/sessions/:sessionId", {
      params: { sessionId: SessionId },
      error: [ForbiddenError, SessionNotFoundError],
    }),
    HttpApiEndpoint.post("pair", "/sessions/pairings", {
      success: PairingIssue,
      error: ForbiddenError,
    }),
  )
  .middleware(SessionAuth);

const pairing = HttpApiGroup.make("pairing").add(
  HttpApiEndpoint.post("exchange", "/sessions/exchange", {
    payload: Schema.Struct({ token: TrimmedNonEmptyString }),
    success: SessionGrant,
    error: UnauthorizedError,
  }),
);

export const HonkApi = HttpApi.make("honk")
  .add(meta)
  .add(threads)
  .add(checkpoints)
  .add(messages)
  .add(attachments)
  .add(interactions)
  .add(models)
  .add(auth)
  .add(terminals)
  .add(sessions)
  .add(pairing)
  .prefix("/core/v1");
export type HonkApi = typeof HonkApi;
