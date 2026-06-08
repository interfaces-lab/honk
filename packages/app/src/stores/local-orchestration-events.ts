import {
  EventId,
  threadEntryIdForMessageId,
  type AgentInteractionMode,
  type ChatAttachment,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationMessageRichText,
  type ProjectId,
  type RuntimeMode,
  type SourceProposedPlanReference,
  type ThreadEntryId,
  type ThreadId,
} from "@multi/contracts";

import { DEFAULT_RUNTIME_MODE } from "~/types";
import { randomUUID } from "~/lib/utils";
import { useStore } from "./thread-store";

type LocalEventBase = Pick<
  OrchestrationEvent,
  | "sequence"
  | "eventId"
  | "aggregateKind"
  | "aggregateId"
  | "occurredAt"
  | "commandId"
  | "causationEventId"
  | "correlationId"
  | "metadata"
>;

function localEventBase(input: {
  readonly aggregateKind: LocalEventBase["aggregateKind"];
  readonly aggregateId: LocalEventBase["aggregateId"];
  readonly occurredAt: string;
}): LocalEventBase {
  return {
    sequence: 0,
    eventId: EventId.make(`local:${randomUUID()}`),
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
  };
}

export function applyLocalProjectCreated(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly projectRoot: string;
  readonly defaultModelSelection: ModelSelection | null;
  readonly createdAt: string;
}): void {
  const event = {
    ...localEventBase({
      aggregateKind: "project",
      aggregateId: input.projectId,
      occurredAt: input.createdAt,
    }),
    type: "project.created",
    payload: {
      projectId: input.projectId,
      title: input.title,
      projectRoot: input.projectRoot,
      repositoryIdentity: null,
      defaultModelSelection: input.defaultModelSelection,
      scripts: [],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  } satisfies OrchestrationEvent;
  useStore.getState().applyOrchestrationEvent(event, input.environmentId);
}

export function applyLocalThreadCreated(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | null;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode: AgentInteractionMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly createdAt: string;
}): void {
  const event = {
    ...localEventBase({
      aggregateKind: "thread",
      aggregateId: input.threadId,
      occurredAt: input.createdAt,
    }),
    type: "thread.created",
    payload: {
      threadId: input.threadId,
      projectId: input.projectId,
      title: input.title,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      interactionMode: input.interactionMode,
      branch: input.branch,
      worktreePath: input.worktreePath,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  } satisfies OrchestrationEvent;
  useStore.getState().applyOrchestrationEvent(event, input.environmentId);
}

export function applyLocalThreadTurnStartRequested(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly message: {
    readonly messageId: MessageId;
    readonly text: string;
    readonly richText?: OrchestrationMessageRichText;
    readonly attachments: readonly ChatAttachment[];
  };
  readonly modelSelection?: ModelSelection;
  readonly titleSeed?: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: AgentInteractionMode;
  readonly parentEntryId: ThreadEntryId | null;
  readonly sourceProposedPlan?: SourceProposedPlanReference;
  readonly createdAt: string;
}): void {
  const userEntryId = threadEntryIdForMessageId(input.message.messageId);
  const messageSentEvent = {
    ...localEventBase({
      aggregateKind: "thread",
      aggregateId: input.threadId,
      occurredAt: input.createdAt,
    }),
    type: "thread.message-sent",
    payload: {
      threadId: input.threadId,
      messageId: input.message.messageId,
      entryId: userEntryId,
      parentEntryId: input.parentEntryId,
      role: "user",
      text: input.message.text,
      ...(input.message.richText !== undefined ? { richText: input.message.richText } : {}),
      attachments: [...input.message.attachments],
      turnId: null,
      streaming: false,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
  } satisfies OrchestrationEvent;
  const turnStartRequestedEvent = {
    ...localEventBase({
      aggregateKind: "thread",
      aggregateId: input.threadId,
      occurredAt: input.createdAt,
    }),
    causationEventId: messageSentEvent.eventId,
    type: "thread.turn-start-requested",
    payload: {
      threadId: input.threadId,
      messageId: input.message.messageId,
      userEntryId,
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      ...(input.titleSeed !== undefined ? { titleSeed: input.titleSeed } : {}),
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      ...(input.sourceProposedPlan !== undefined
        ? { sourceProposedPlan: input.sourceProposedPlan }
        : {}),
      createdAt: input.createdAt,
    },
  } satisfies OrchestrationEvent;

  useStore
    .getState()
    .applyOrchestrationEvents([messageSentEvent, turnStartRequestedEvent], input.environmentId);
}
