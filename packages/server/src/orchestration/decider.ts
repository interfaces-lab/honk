import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationThread,
  OrchestrationThreadEntry,
  ThreadEntryId,
} from "@multi/contracts";
import {
  formatThreadEntryPathIssue,
  resolveThreadEntryPath,
  threadEntryIdForMessageId,
} from "@multi/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
} from "./command-invariants.ts";

const nowIso = () => new Date().toISOString();
const defaultMetadata: Omit<OrchestrationEvent, "sequence" | "type" | "payload"> = {
  eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
  aggregateKind: "thread",
  aggregateId: "" as OrchestrationEvent["aggregateId"],
  occurredAt: nowIso(),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
};

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Omit<OrchestrationEvent, "sequence" | "type" | "payload"> {
  return {
    ...defaultMetadata,
    eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.commandId,
    metadata: input.metadata ?? {},
  };
}

function threadLabelEntryId(input: {
  readonly targetEntryId: ThreadEntryId;
  readonly commandId: string;
}): ThreadEntryId {
  return `label:${input.targetEntryId}:${input.commandId}` as ThreadEntryId;
}

function requireNavigableThreadEntryPath(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly thread: Pick<OrchestrationThread, "entries">;
  readonly entryId: ThreadEntryId;
}): Effect.Effect<readonly OrchestrationThreadEntry[], OrchestrationCommandInvariantError> {
  const path = resolveThreadEntryPath({
    entries: input.thread.entries,
    entryId: input.entryId,
  });
  if (path.ok) {
    return Effect.succeed(path.entries);
  }
  return Effect.fail(
    new OrchestrationCommandInvariantError({
      commandType: input.commandType,
      detail: formatThreadEntryPathIssue(path),
    }),
  );
}

function requireThreadTreeActionIdle(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly thread: Pick<OrchestrationThread, "activities" | "session">;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const status = input.thread.session?.status ?? null;
  if (status === "starting" || status === "running") {
    return Effect.fail(
      new OrchestrationCommandInvariantError({
        commandType: input.commandType,
        detail: "Cannot change the thread tree while a turn is running.",
      }),
    );
  }
  if (hasPendingApprovalOrUserInput(input.thread.activities)) {
    return Effect.fail(
      new OrchestrationCommandInvariantError({
        commandType: input.commandType,
        detail: "Cannot change the thread tree while approval or user input is pending.",
      }),
    );
  }
  return Effect.void;
}

function activityRequestId(activity: OrchestrationThread["activities"][number]): string | null {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.requestId === "string" ? payload.requestId : null;
}

function hasPendingApprovalOrUserInput(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
): boolean {
  const pendingApprovalRequestIds = new Set<string>();
  const pendingUserInputRequestIds = new Set<string>();
  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );

  for (const activity of ordered) {
    const requestId = activityRequestId(activity);
    if (requestId === null) {
      continue;
    }
    switch (activity.kind) {
      case "approval.requested":
        pendingApprovalRequestIds.add(requestId);
        break;
      case "approval.resolved":
      case "provider.approval.respond.failed":
        pendingApprovalRequestIds.delete(requestId);
        break;
      case "user-input.requested":
        pendingUserInputRequestIds.add(requestId);
        break;
      case "user-input.resolved":
      case "provider.user-input.respond.failed":
        pendingUserInputRequestIds.delete(requestId);
        break;
    }
  }

  return pendingApprovalRequestIds.size > 0 || pendingUserInputRequestIds.size > 0;
}

const lastPathEntry = (
  path: readonly OrchestrationThreadEntry[],
): OrchestrationThreadEntry | undefined => path[path.length - 1];

function requireUserMessageThreadEntry(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly thread: Pick<OrchestrationThread, "entries" | "messages">;
  readonly entryId: ThreadEntryId;
}): Effect.Effect<OrchestrationThreadEntry, OrchestrationCommandInvariantError> {
  return Effect.gen(function* () {
    const path = yield* requireNavigableThreadEntryPath({
      commandType: input.commandType,
      thread: input.thread,
      entryId: input.entryId,
    });
    const entry = lastPathEntry(path);
    if (!entry || entry.kind !== "message" || entry.messageId === null) {
      return yield* new OrchestrationCommandInvariantError({
        commandType: input.commandType,
        detail: `Thread entry '${input.entryId}' is not a user message entry.`,
      });
    }

    const message = input.thread.messages.find((candidate) => candidate.id === entry.messageId);
    if (!message || message.role !== "user") {
      return yield* new OrchestrationCommandInvariantError({
        commandType: input.commandType,
        detail: `Thread entry '${input.entryId}' is not backed by a user message.`,
      });
    }

    return entry;
  });
}

function requireStableAssistantEntryParent(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly thread: Pick<OrchestrationThread, "entries" | "messages">;
  readonly assistantEntryId: ThreadEntryId;
  readonly parentEntryId: ThreadEntryId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  return Effect.gen(function* () {
    yield* requireUserMessageThreadEntry({
      commandType: input.commandType,
      thread: input.thread,
      entryId: input.parentEntryId,
    });

    const existingEntry = input.thread.entries.find((entry) => entry.id === input.assistantEntryId);
    if (existingEntry && existingEntry.parentEntryId !== input.parentEntryId) {
      return yield* new OrchestrationCommandInvariantError({
        commandType: input.commandType,
        detail: `Assistant entry '${input.assistantEntryId}' already belongs to parent '${existingEntry.parentEntryId}'.`,
      });
    }
  });
}

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  Omit<OrchestrationEvent, "sequence"> | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
  OrchestrationCommandInvariantError
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });

      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          projectRoot: command.projectRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.projectRoot !== undefined ? { projectRoot: command.projectRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.deleted",
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      if (command.projectId !== null) {
        yield* requireProject({
          readModel,
          command,
          projectId: command.projectId,
        });
      }
      if (command.projectId === null && command.worktreePath !== null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Projectless threads cannot be created with a worktree path.",
        });
      }
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: thread.updatedAt,
        },
      };
    }

    case "thread.unarchive": {
      const thread = yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: thread.updatedAt,
        },
      };
    }

    case "thread.meta.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const bootstrapCreateThread = command.bootstrap?.createThread;
      if (bootstrapCreateThread !== undefined) {
        if (bootstrapCreateThread.projectId !== null) {
          yield* requireProject({
            readModel,
            command,
            projectId: bootstrapCreateThread.projectId,
          });
        }
        if (
          bootstrapCreateThread.projectId === null &&
          bootstrapCreateThread.worktreePath !== null
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Projectless threads cannot be bootstrapped with a worktree path.",
          });
        }
        if (
          bootstrapCreateThread.projectId === null &&
          command.bootstrap?.prepareWorktree !== undefined
        ) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Projectless threads cannot prepare a worktree.",
          });
        }
        yield* requireThreadAbsent({
          readModel,
          command,
          threadId: command.threadId,
        });
      }
      const targetThread =
        bootstrapCreateThread === undefined
          ? yield* requireThread({
              readModel,
              command,
              threadId: command.threadId,
            })
          : {
              id: command.threadId,
              projectId: bootstrapCreateThread.projectId,
              title: bootstrapCreateThread.title,
              modelSelection: bootstrapCreateThread.modelSelection,
              runtimeMode: bootstrapCreateThread.runtimeMode,
              interactionMode: bootstrapCreateThread.interactionMode,
              branch: bootstrapCreateThread.branch,
              worktreePath: bootstrapCreateThread.worktreePath,
              latestTurn: null,
              createdAt: bootstrapCreateThread.createdAt,
              updatedAt: bootstrapCreateThread.createdAt,
              archivedAt: null,
              deletedAt: null,
              messages: [],
              activeEntryId: null,
              entries: [],
              proposedPlans: [],
              activities: [],
              checkpoints: [],
              session: null,
            };
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      yield* requireThreadTreeActionIdle({ commandType: command.type, thread: targetThread });
      const parentEntryId =
        command.parentEntryId !== undefined ? command.parentEntryId : targetThread.activeEntryId;
      if (parentEntryId !== null) {
        yield* requireNavigableThreadEntryPath({
          commandType: command.type,
          thread: targetThread,
          entryId: parentEntryId,
        });
      }
      const threadCreatedEvent: Omit<OrchestrationEvent, "sequence"> | null =
        bootstrapCreateThread === undefined
          ? null
          : {
              ...withEventBase({
                aggregateKind: "thread",
                aggregateId: command.threadId,
                occurredAt: bootstrapCreateThread.createdAt,
                commandId: command.commandId,
              }),
              type: "thread.created",
              payload: {
                threadId: command.threadId,
                projectId: bootstrapCreateThread.projectId,
                title: bootstrapCreateThread.title,
                modelSelection: bootstrapCreateThread.modelSelection,
                runtimeMode: bootstrapCreateThread.runtimeMode,
                interactionMode: bootstrapCreateThread.interactionMode,
                branch: bootstrapCreateThread.branch,
                worktreePath: bootstrapCreateThread.worktreePath,
                createdAt: bootstrapCreateThread.createdAt,
                updatedAt: bootstrapCreateThread.createdAt,
              },
            };
      const userEntryId = threadEntryIdForMessageId(command.message.messageId);
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          entryId: userEntryId,
          parentEntryId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          userEntryId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      return threadCreatedEvent
        ? [threadCreatedEvent, userMessageEvent, turnStartRequestedEvent]
        : [userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.regenerate": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      yield* requireThreadTreeActionIdle({ commandType: command.type, thread });
      const userEntry = yield* requireUserMessageThreadEntry({
        commandType: command.type,
        thread,
        entryId: command.entryId,
      });
      const messageId = userEntry.messageId;
      if (messageId === null) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread entry '${command.entryId}' is not backed by a message.`,
        });
      }

      const treeNavigatedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.tree-navigated",
        payload: {
          threadId: command.threadId,
          entryId: command.entryId,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        causationEventId: treeNavigatedEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId,
          userEntryId: command.entryId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          createdAt: command.createdAt,
        },
      };
      return [treeNavigatedEvent, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.tree.navigate": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      yield* requireThreadTreeActionIdle({ commandType: command.type, thread });
      yield* requireNavigableThreadEntryPath({
        commandType: command.type,
        thread,
        entryId: command.entryId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.tree-navigated",
        payload: {
          threadId: command.threadId,
          entryId: command.entryId,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.tree.label.set": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      yield* requireNavigableThreadEntryPath({
        commandType: command.type,
        thread,
        entryId: command.targetEntryId,
      });
      const labelEntryId = threadLabelEntryId({
        targetEntryId: command.targetEntryId,
        commandId: command.commandId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.tree-label-set",
        payload: {
          threadId: command.threadId,
          entry: {
            id: labelEntryId,
            threadId: command.threadId,
            parentEntryId: command.targetEntryId,
            kind: "label",
            messageId: null,
            turnId: null,
            targetEntryId: command.targetEntryId,
            label: command.label,
            summary: null,
            createdAt: command.createdAt,
          },
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        }),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
    }

    case "thread.message.assistant.delta": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const assistantEntryId = threadEntryIdForMessageId(command.messageId);
      yield* requireStableAssistantEntryParent({
        commandType: command.type,
        thread,
        assistantEntryId,
        parentEntryId: command.parentEntryId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          entryId: assistantEntryId,
          parentEntryId: command.parentEntryId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const assistantEntryId = threadEntryIdForMessageId(command.messageId);
      yield* requireStableAssistantEntryParent({
        commandType: command.type,
        thread,
        assistantEntryId,
        parentEntryId: command.parentEntryId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          entryId: assistantEntryId,
          parentEntryId: command.parentEntryId,
          role: "assistant",
          text: "",
          turnId: command.turnId,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        }),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
