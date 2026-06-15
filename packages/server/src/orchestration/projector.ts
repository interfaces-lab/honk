import type {
  OrchestrationEvent,
  OrchestrationLatestTurn,
  OrchestrationReadModel,
  ThreadId,
} from "@honk/contracts";
import {
  OrchestrationMessage,
  OrchestrationSession,
  OrchestrationThread,
  repairThreadEntryTree,
  resolveLeafIdAfterThreadMessage,
} from "@honk/contracts";
import { Effect, Schema } from "effect";

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from "./Errors.ts";
import {
  MessageSentPayloadSchema,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
  ThreadActivityAppendedPayload,
  ThreadArchivedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMetaUpdatedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadUnarchivedPayload,
  ThreadSessionSetPayload,
  ThreadTreeLeafMovedPayload,
} from "./Schemas.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;

function settledLatestTurnForRunningSession(
  latestTurn: OrchestrationLatestTurn,
): OrchestrationLatestTurn | null {
  if (
    latestTurn.state === "completed" ||
    latestTurn.state === "interrupted" ||
    latestTurn.state === "error"
  ) {
    return latestTurn;
  }
  if (latestTurn.completedAt !== null) {
    return {
      ...latestTurn,
      state: "completed",
    };
  }
  return null;
}

function latestTurnAfterAssistantMessage(
  thread: OrchestrationThread,
  payload: {
    readonly role: OrchestrationMessage["role"];
    readonly turnId: OrchestrationMessage["turnId"];
    readonly messageId: OrchestrationMessage["id"];
    readonly streaming: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
): OrchestrationLatestTurn | null {
  if (payload.role !== "assistant" || payload.turnId === null) {
    return thread.latestTurn;
  }

  const previous = thread.latestTurn?.turnId === payload.turnId ? thread.latestTurn : null;
  if (
    thread.latestTurn !== null &&
    thread.latestTurn.turnId !== payload.turnId &&
    (payload.createdAt < thread.latestTurn.requestedAt ||
      (payload.createdAt === thread.latestTurn.requestedAt &&
        payload.turnId < thread.latestTurn.turnId))
  ) {
    return thread.latestTurn;
  }

  return {
    turnId: payload.turnId,
    state: payload.streaming
      ? (previous?.state ?? "running")
      : previous?.state === "interrupted"
        ? "interrupted"
        : previous?.state === "error"
          ? "error"
          : "completed",
    requestedAt: previous?.requestedAt ?? payload.createdAt,
    startedAt: previous?.startedAt ?? payload.createdAt,
    completedAt: payload.streaming
      ? (previous?.completedAt ?? null)
      : (previous?.completedAt ?? payload.updatedAt),
    assistantMessageId: payload.messageId,
    ...(previous?.sourceProposedPlan ? { sourceProposedPlan: previous.sourceProposedPlan } : {}),
  };
}

function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

function decodeForEvent<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value),
    catch: (error) => toProjectorDecodeError(`${eventType}:${field}`)(error as Schema.SchemaError),
  });
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            projectRoot: payload.projectRoot,
            defaultModelSelection: payload.defaultModelSelection,
            scripts: payload.scripts,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };

          return {
            ...nextBase,
            projects: existing
              ? nextBase.projects.map((entry) =>
                  entry.id === payload.projectId ? nextProject : entry,
                )
              : [...nextBase.projects, nextProject],
          };
        }),
      );

    case "project.meta-updated":
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  ...(payload.title !== undefined ? { title: payload.title } : {}),
                  ...(payload.projectRoot !== undefined
                    ? { projectRoot: payload.projectRoot }
                    : {}),
                  ...(payload.defaultModelSelection !== undefined
                    ? { defaultModelSelection: payload.defaultModelSelection }
                    : {}),
                  ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                  updatedAt: payload.updatedAt,
                }
              : project,
          ),
        })),
      );

    case "project.deleted":
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : project,
          ),
        })),
      );

    case "thread.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread: OrchestrationThread = yield* decodeForEvent(
          OrchestrationThread,
          {
            id: payload.threadId,
            projectId: payload.projectId,
            title: payload.title,
            modelSelection: payload.modelSelection,
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            latestTurn: null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            archivedAt: null,
            deletedAt: null,
            messages: [],
            leafId: null,
            entries: [],
            activities: [],
            session: null,
          },
          event.type,
          "thread",
        );
        const existing = nextBase.threads.find((entry) => entry.id === thread.id);
        return {
          ...nextBase,
          threads: existing
            ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
            : [...nextBase.threads, thread],
        };
      });

    case "thread.deleted":
      return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "thread.archived":
      return decodeForEvent(ThreadArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: payload.archivedAt,
          }),
        })),
      );

    case "thread.unarchived":
      return decodeForEvent(ThreadUnarchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: null,
          }),
        })),
      );

    case "thread.meta-updated":
      return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.modelSelection !== undefined
              ? { modelSelection: payload.modelSelection }
              : {}),
            ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.runtime-mode-set":
      return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            runtimeMode: payload.runtimeMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.interaction-mode-set":
      return decodeForEvent(
        ThreadInteractionModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            interactionMode: payload.interactionMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.message-sent":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          MessageSentPayloadSchema,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.richText !== undefined ? { richText: payload.richText } : {}),
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        const existingMessage = thread.messages.find((entry) => entry.id === message.id);
        const messages = (
          existingMessage
            ? thread.messages.map((entry) =>
                entry.id === message.id
                  ? {
                      ...entry,
                      text: message.text.length > 0 ? message.text : entry.text,
                      ...(message.richText !== undefined ? { richText: message.richText } : {}),
                      streaming: message.streaming,
                      updatedAt: message.updatedAt,
                      turnId: message.turnId,
                      ...(message.attachments !== undefined
                        ? { attachments: message.attachments }
                        : {}),
                    }
                  : entry,
              )
            : [...thread.messages, message]
        ).slice(-2_000);
        const entryId = payload.entryId;
        const threadEntries = thread.entries;
        const existingEntry = threadEntries.find((entry) => entry.id === entryId);
        const nextEntry = {
          id: entryId,
          threadId: payload.threadId,
          parentEntryId: existingEntry?.parentEntryId ?? payload.parentEntryId,
          kind: "message" as const,
          messageId: payload.messageId,
          turnId: payload.turnId,
          createdAt: existingEntry?.createdAt ?? payload.createdAt,
        };
        const entries = existingEntry
          ? threadEntries.map((entry) => (entry.id === entryId ? nextEntry : entry))
          : [...threadEntries, nextEntry];
        const repairedTree = repairThreadEntryTree({
          entries,
          leafId: resolveLeafIdAfterThreadMessage({
            leafId: thread.leafId,
            entryId,
            parentEntryId: payload.parentEntryId,
            role: payload.role,
          }),
        });

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            messages,
            latestTurn: latestTurnAfterAssistantMessage(thread, payload),
            leafId: repairedTree.leafId,
            entries: [...repairedTree.entries],
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.tree-leaf-moved":
      return decodeForEvent(ThreadTreeLeafMovedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            leafId: payload.leafId,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadSessionSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          payload.session,
          event.type,
          "session",
        );
        const settledLatestTurn =
          session.activeTurnId !== null && thread.latestTurn?.turnId === session.activeTurnId
            ? settledLatestTurnForRunningSession(thread.latestTurn)
            : null;

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session,
            latestTurn:
              session.status === "running" && session.activeTurnId !== null
                ? (settledLatestTurn ?? {
                    turnId: session.activeTurnId,
                    state: "running",
                    requestedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.requestedAt
                        : session.updatedAt,
                    startedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? (thread.latestTurn.startedAt ?? session.updatedAt)
                        : session.updatedAt,
                    completedAt: null,
                    assistantMessageId:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.assistantMessageId
                        : null,
                  })
                : thread.latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.proposed-plan-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadProposedPlanUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
          payload.proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-200);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            proposedPlans,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.activity-appended":
      return decodeForEvent(
        ThreadActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const activities = [
            ...thread.activities.filter((entry) => entry.id !== payload.activity.id),
            payload.activity,
          ]
            .toSorted(compareThreadActivities)
            .slice(-500);
          const threadPatch: ThreadPatch = payload.activity.kind.startsWith("subagent.")
            ? { activities }
            : { activities, updatedAt: event.occurredAt };

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, threadPatch),
          };
        }),
      );

    default:
      return Effect.succeed(nextBase);
  }
}
