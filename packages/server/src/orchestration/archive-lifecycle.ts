import {
  CommandId,
  type DispatchResult,
  EventId,
  type OrchestrationCommand,
  type OrchestrationDispatchCommandError,
  type OrchestrationThreadActivity,
} from "@honk/contracts";
import * as EffectLogger from "@honk/shared/effect-logger";
import { Cause, Effect, Option } from "effect";

import { TerminalManager } from "../terminal/Manager.service";
import { ThreadProjection } from "./ThreadProjection.service";

type ThreadArchiveCommand = Extract<OrchestrationCommand, { readonly type: "thread.archive" }>;
type ArchiveLifecycleDispatch = (
  command: OrchestrationCommand,
) => Effect.Effect<DispatchResult, OrchestrationDispatchCommandError>;

interface DispatchThreadArchiveLifecycleInput {
  readonly archiveCommand: ThreadArchiveCommand;
  readonly dispatch: ArchiveLifecycleDispatch;
}

const elog = EffectLogger.create({ service: "orchestration.archive-lifecycle" });

const causeDetail = (cause: Cause.Cause<unknown>): string => Cause.pretty(cause).trim();

const appendCleanupFailureActivity = (
  input: DispatchThreadArchiveLifecycleInput & {
    readonly kind: "runtime.session.stop.failed" | "runtime.warning";
    readonly summary: string;
    readonly detail: string;
  },
) =>
  Effect.gen(function* () {
    const createdAt = new Date().toISOString();
    const activityBase = {
      id: EventId.make(`archive-cleanup:${input.archiveCommand.commandId}:${input.kind}`),
      tone: "error",
      summary: input.summary,
      turnId: null,
      createdAt,
    } as const;
    const activity: OrchestrationThreadActivity =
      input.kind === "runtime.session.stop.failed"
        ? {
            ...activityBase,
            kind: "runtime.session.stop.failed",
            payload: {
              detail: input.detail,
            },
          }
        : {
            ...activityBase,
            kind: "runtime.warning",
            payload: {
              message: input.summary,
              detail: input.detail,
            },
          };

    yield* input.dispatch({
      type: "thread.activity.append",
      commandId: CommandId.make(
        `archive-cleanup-activity:${input.archiveCommand.commandId}:${input.kind}`,
      ),
      threadId: input.archiveCommand.threadId,
      activity,
      createdAt,
    }).pipe(
      Effect.catchCause((cause) =>
        elog.warn("failed to append archive cleanup failure activity", {
          threadId: input.archiveCommand.threadId,
          activityKind: input.kind,
          cause: causeDetail(cause),
        }),
      ),
    );
  });

export const dispatchThreadArchiveLifecycle = (input: DispatchThreadArchiveLifecycleInput) =>
  Effect.gen(function* () {
    const threadProjection = yield* ThreadProjection;
    const terminalManager = yield* TerminalManager;

    const shouldStopSessionAfterArchive = yield* threadProjection
      .getThreadShellById(input.archiveCommand.threadId)
      .pipe(
        Effect.map(
          Option.match({
            onNone: () => false,
            onSome: (thread) => thread.session !== null && thread.session.status !== "stopped",
          }),
        ),
        Effect.catch(() => Effect.succeed(false)),
      );

    const result = yield* input.dispatch(input.archiveCommand);

    if (shouldStopSessionAfterArchive) {
      yield* input.dispatch({
        type: "thread.session.stop",
        commandId: CommandId.make(`session-stop-for-archive:${input.archiveCommand.commandId}`),
        threadId: input.archiveCommand.threadId,
        createdAt: new Date().toISOString(),
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const detail = causeDetail(cause);
            yield* elog.warn("failed to stop runtime session during archive", {
              threadId: input.archiveCommand.threadId,
              cause: detail,
            });
            yield* appendCleanupFailureActivity({
              ...input,
              kind: "runtime.session.stop.failed",
              summary: "Failed to stop runtime session while archiving.",
              detail,
            });
          }),
        ),
      );
    }

    yield* terminalManager.close({ threadId: input.archiveCommand.threadId }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const detail = causeDetail(cause);
          yield* elog.warn("failed to close thread terminals after archive", {
            threadId: input.archiveCommand.threadId,
            cause: detail,
          });
          yield* appendCleanupFailureActivity({
            ...input,
            kind: "runtime.warning",
            summary: "Failed to close thread terminals while archiving.",
            detail,
          });
        }),
      ),
    );

    return result;
  });
