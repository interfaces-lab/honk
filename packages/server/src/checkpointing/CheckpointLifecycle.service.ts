import type { OrchestrationEvent, ProviderRuntimeEvent, ThreadId, TurnId } from "@multi/contracts";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

export class CheckpointLifecycleError extends Schema.TaggedErrorClass<CheckpointLifecycleError>()(
  "CheckpointLifecycleError",
  {
    message: Schema.String,
  },
) {}

export interface CheckpointLifecycleShape {
  readonly turnIdFromRuntime: (value: string | undefined) => TurnId | null;
  readonly appendCaptureFailureActivity: (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly detail: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, CheckpointLifecycleError>;
  readonly appendRevertFailureActivity: (input: {
    readonly threadId: ThreadId;
    readonly turnCount: number;
    readonly detail: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, CheckpointLifecycleError>;
  readonly ensurePreTurnBaselineFromRuntimeStart: (
    event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>,
  ) => Effect.Effect<void, CheckpointLifecycleError>;
  readonly ensurePreTurnBaselineFromDomainStart: (
    event: Extract<
      OrchestrationEvent,
      { type: "thread.turn-start-requested" | "thread.message-sent" }
    >,
  ) => Effect.Effect<void, CheckpointLifecycleError>;
  readonly captureCompletedTurn: (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) => Effect.Effect<void, CheckpointLifecycleError>;
  readonly capturePlaceholderCheckpoint: (
    event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>,
  ) => Effect.Effect<void, CheckpointLifecycleError>;
  readonly revertToCheckpoint: (
    event: Extract<OrchestrationEvent, { type: "thread.checkpoint-revert-requested" }>,
  ) => Effect.Effect<void, CheckpointLifecycleError>;
  readonly refreshLocalGitStatusFromTurnCompletion: (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) => Effect.Effect<void>;
}

export class CheckpointLifecycle extends Context.Service<
  CheckpointLifecycle,
  CheckpointLifecycleShape
>()("multi/checkpointing/CheckpointLifecycle.service") {}
