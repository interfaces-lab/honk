import { Schema } from "effect";
import { AttachmentId, CallId, MessageId, PartId, PlanId, QuestionId, TurnId } from "./id";
import {
  IsoTimestamp,
  NonNegativeInt,
  strictDecode,
  TokenUsage,
  TrimmedNonEmptyString,
  UnknownRecord,
} from "./primitives";
import { ToolDiagnostic, ToolDisplay, ToolState } from "./tool";

/**
 * Who authored a Part: the Core itself ("honk"), one of the three Harnesses,
 * or an Extension (ADR 0015 — no built-in adapter emits it).
 */
export const PartOrigin = Schema.Literals(["honk", "pi", "claude-code", "cursor", "extension"]);
export type PartOrigin = typeof PartOrigin.Type;

/**
 * Attachment bytes live out-of-band behind the attachments endpoint; the
 * wire carries a reference plus a resolvable url, never inline data.
 */
export const AttachmentRef = Schema.Struct({
  id: AttachmentId,
  name: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  url: Schema.NullOr(Schema.String),
});
export type AttachmentRef = typeof AttachmentRef.Type;

export const Question = Schema.Struct({
  id: QuestionId,
  text: TrimmedNonEmptyString,
  header: Schema.optional(Schema.String),
  options: Schema.Array(
    Schema.Struct({
      label: TrimmedNonEmptyString,
      description: Schema.optional(Schema.String),
    }),
  ),
  multiSelect: Schema.optional(Schema.Boolean),
});
export type Question = typeof Question.Type;

/**
 * Part lifecycle, self-describing from any snapshot: "active" means still
 * mutating (streaming text, a running tool, an unanswered question);
 * "complete" is final. The part.completed stream event is exactly the
 * transition of this field.
 */
export const PartState = Schema.Literals(["active", "complete"]);
export type PartState = typeof PartState.Type;

const PartBase = {
  id: PartId,
  messageId: MessageId,
  turnId: Schema.NullOr(TurnId),
  origin: PartOrigin,
  state: PartState,
  metadata: Schema.optional(UnknownRecord),
} as const;

export const PatchFileSummary = Schema.Struct({
  path: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type PatchFileSummary = typeof PatchFileSummary.Type;

/**
 * The render-ready atom of a conversation (see CONTEXT.md). Closed union:
 * decoding is fail-closed, and the only open arm is `custom` (the Extension
 * boundary). Arm tags are camelCase nouns; stream-event tags are
 * dot-namespaced — the one deliberate two-scope naming rule on this wire.
 */
export const Part = Schema.TaggedUnion({
  text: { ...PartBase, text: Schema.String },
  reasoning: { ...PartBase, text: Schema.String },
  tool: {
    ...PartBase,
    callId: CallId,
    tool: TrimmedNonEmptyString,
    toolState: ToolState,
    display: ToolDisplay,
    diagnostics: Schema.optional(Schema.Array(ToolDiagnostic)),
  },
  file: { ...PartBase, attachment: AttachmentRef },
  image: { ...PartBase, attachment: AttachmentRef },
  plan: {
    ...PartBase,
    planId: PlanId,
    markdown: Schema.String,
    summary: Schema.optional(Schema.String),
    implementedAt: Schema.NullOr(IsoTimestamp),
  },
  /** The agent asking the user — a product flow, never a permission gate (ADR 0007). */
  question: {
    ...PartBase,
    questionId: QuestionId,
    title: TrimmedNonEmptyString,
    status: Schema.Literals(["pending", "answered"]),
    questions: Schema.Array(Question),
    answers: Schema.optional(UnknownRecord),
  },
  /** One model call span; updates in place so clients group work under it. */
  step: {
    ...PartBase,
    model: Schema.optional(TrimmedNonEmptyString),
    usage: Schema.optional(TokenUsage),
  },
  patch: {
    ...PartBase,
    turn: NonNegativeInt,
    ref: TrimmedNonEmptyString,
    files: Schema.Array(PatchFileSummary),
  },
  compaction: {
    ...PartBase,
    summary: Schema.String,
    tokensBefore: Schema.optional(NonNegativeInt),
  },
  branchSummary: { ...PartBase, summary: Schema.String },
  notice: {
    ...PartBase,
    severity: Schema.Literals(["warning", "error"]),
    name: Schema.String,
    message: Schema.String,
  },
  /** The one open Extension boundary: payload validated by the Extension's own registered schema. */
  custom: { ...PartBase, extensionTag: TrimmedNonEmptyString, payload: UnknownRecord },
});
export type Part = typeof Part.Type;

/**
 * The message row. Parts carry `messageId` and arrive in order; the message
 * itself holds only row-level facts. There is no rich-document field: the
 * wire carries raw text only, and composer chips are a client-side rendering
 * of the Prompt Token grammar embedded in that text (ADR 0013).
 */
export const Message = Schema.Struct({
  id: MessageId,
  role: Schema.Literals(["user", "assistant"]),
  turnId: Schema.NullOr(TurnId),
  attachments: Schema.Array(AttachmentRef),
  error: Schema.NullOr(Schema.String),
  createdAt: IsoTimestamp,
});
export type Message = typeof Message.Type;

export const decodePart = strictDecode(Part);
export const decodeMessage = strictDecode(Message);
