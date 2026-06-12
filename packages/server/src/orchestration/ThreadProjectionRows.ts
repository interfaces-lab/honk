import {
  ChatAttachment,
  IsoDateTime,
  MessageId,
  ModelSelection,
  NonNegativeInt,
  OrchestrationMessageRichText,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  ThreadId,
  TurnId,
} from "@honk/contracts";
import { Schema, Struct } from "effect";

import { ProjectionState } from "../persistence/ProjectionState.service.ts";
import { ProjectionThreadActivity } from "../persistence/ProjectionThreadActivities.service.ts";
import { ProjectionThreadEntry } from "../persistence/ProjectionThreadEntries.service.ts";
import { ProjectionThreadMessage } from "../persistence/ProjectionThreadMessages.service.ts";
import { ProjectionThreadProposedPlan } from "../persistence/ProjectionThreadProposedPlans.service.ts";
import { ProjectionThreadSession } from "../persistence/ProjectionThreadSessions.service.ts";
import { ProjectionThread } from "../persistence/ProjectionThreads.service.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";

export const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
export const decodeShellSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);
export const decodeThread = Schema.decodeUnknownEffect(OrchestrationThread);
export const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
    richText: Schema.NullOr(Schema.fromJsonString(OrchestrationMessageRichText)),
  }),
);
export const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan;
export const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);
export const ProjectionThreadEntryDbRowSchema = ProjectionThreadEntry;
export const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
export const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
export const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
export const ProjectionStateDbRowSchema = ProjectionState;
export const ProjectionCountsRowSchema = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});
export const ThreadIdLookupInput = Schema.Struct({
  threadId: ThreadId,
});
export const ProjectionThreadIdLookupRowSchema = Schema.Struct({
  threadId: ThreadId,
});
export const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.threads,
  ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
  ORCHESTRATION_PROJECTOR_NAMES.threadEntries,
  ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
  ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
] as const;
