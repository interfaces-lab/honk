import { Schema } from "effect";
import { TrimmedNonEmptyString as SharedTrimmedNonEmptyString } from "@honk/shared/base-schemas";

export {
  AccountId,
  AuthProviderId,
  ModelId,
  NonNegativeInt,
  PortSchema,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "@honk/shared/base-schemas";
export { EnvironmentId } from "@honk/shared/environment";

export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

/**
 * Construct a branded identifier. Enforces non-empty trimmed strings
 */
const makeEntityId = <Brand extends string>(brand: Brand) => {
  return SharedTrimmedNonEmptyString.pipe(Schema.brand(brand));
};

export const CommandId = makeEntityId("CommandId");
export type CommandId = typeof CommandId.Type;
export const EventId = makeEntityId("EventId");
export type EventId = typeof EventId.Type;
export const MessageId = makeEntityId("MessageId");
export type MessageId = typeof MessageId.Type;
export const ThreadEntryId = makeEntityId("ThreadEntryId");
export type ThreadEntryId = typeof ThreadEntryId.Type;
export const TurnId = makeEntityId("TurnId");
export type TurnId = typeof TurnId.Type;
export const AuthSessionId = makeEntityId("AuthSessionId");
export type AuthSessionId = typeof AuthSessionId.Type;
export const RuntimeSessionId = makeEntityId("RuntimeSessionId");
export type RuntimeSessionId = typeof RuntimeSessionId.Type;
export const RuntimeItemId = makeEntityId("RuntimeItemId");
export type RuntimeItemId = typeof RuntimeItemId.Type;
export const RuntimeRequestId = makeEntityId("RuntimeRequestId");
export type RuntimeRequestId = typeof RuntimeRequestId.Type;
export const RuntimeTaskId = makeEntityId("RuntimeTaskId");
export type RuntimeTaskId = typeof RuntimeTaskId.Type;
export const ApprovalRequestId = makeEntityId("ApprovalRequestId");
export type ApprovalRequestId = typeof ApprovalRequestId.Type;
