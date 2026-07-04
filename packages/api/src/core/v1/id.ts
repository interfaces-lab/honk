import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./primitives";

/**
 * Every identity on the wire is a branded, trimmed, non-empty string, defined
 * here so any module can reference any id without import cycles. Absence
 * discipline (applies to every schema in core/v1): server-emitted facts that
 * can be empty are `Schema.NullOr` (the key is always present); client
 * inputs and sparse open sites are `Schema.optional`.
 */
export const makeId = <const Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const ThreadId = makeId("ThreadId");
export type ThreadId = typeof ThreadId.Type;

export const ProjectId = makeId("ProjectId");
export type ProjectId = typeof ProjectId.Type;

export const EntryId = makeId("EntryId");
export type EntryId = typeof EntryId.Type;

export const MessageId = makeId("MessageId");
export type MessageId = typeof MessageId.Type;

export const TurnId = makeId("TurnId");
export type TurnId = typeof TurnId.Type;

export const PartId = makeId("PartId");
export type PartId = typeof PartId.Type;

export const CallId = makeId("CallId");
export type CallId = typeof CallId.Type;

export const PlanId = makeId("PlanId");
export type PlanId = typeof PlanId.Type;

export const QuestionId = makeId("QuestionId");
export type QuestionId = typeof QuestionId.Type;

export const AttachmentId = makeId("AttachmentId");
export type AttachmentId = typeof AttachmentId.Type;

export const SessionId = makeId("SessionId");
export type SessionId = typeof SessionId.Type;

export const TerminalId = makeId("TerminalId");
export type TerminalId = typeof TerminalId.Type;

/** Format: "<provider>/<model>", e.g. "anthropic/claude-opus-4-8". */
export const ModelId = makeId("ModelId");
export type ModelId = typeof ModelId.Type;
