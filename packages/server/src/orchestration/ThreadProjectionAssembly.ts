import type {
  OrchestrationLatestTurn,
  OrchestrationSession,
  OrchestrationProject,
  OrchestrationProjectShell,
} from "@honk/contracts";
import type { Schema } from "effect";

import {
  ProjectionLatestTurnDbRowSchema,
  ProjectionStateDbRowSchema,
  ProjectionThreadSessionDbRowSchema,
  REQUIRED_SNAPSHOT_PROJECTORS,
} from "./ThreadProjectionRows.ts";
import { ProjectionProjectDbRowSchema } from "./ProjectProjectionRows.ts";

export function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

export function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): number {
  if (stateRows.length === 0) {
    return 0;
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      return 0;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0;
}

export function mapLatestTurn(
  row: Schema.Schema.Type<typeof ProjectionLatestTurnDbRowSchema>,
): OrchestrationLatestTurn {
  const state =
    row.state === "error"
      ? "error"
      : row.state === "interrupted"
        ? "interrupted"
        : row.state === "completed" || row.completedAt !== null
          ? "completed"
          : "running";
  return {
    turnId: row.turnId,
    state,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    assistantMessageId: row.assistantMessageId,
    ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
      ? {
          sourceProposedPlan: {
            threadId: row.sourceProposedPlanThreadId,
            planId: row.sourceProposedPlanId,
          },
        }
      : {}),
  };
}

export function mapSessionRow(
  row: Schema.Schema.Type<typeof ProjectionThreadSessionDbRowSchema>,
): OrchestrationSession {
  return {
    threadId: row.threadId,
    status: row.status,
    runtimeMode: row.runtimeMode,
    activeTurnId: row.activeTurnId,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

export function mapProjectShellRow(
  row: Schema.Schema.Type<typeof ProjectionProjectDbRowSchema>,
  repositoryIdentity: OrchestrationProject["repositoryIdentity"],
): OrchestrationProjectShell {
  return {
    id: row.projectId,
    title: row.title,
    projectRoot: row.projectRoot,
    repositoryIdentity,
    defaultModelSelection: row.defaultModelSelection,
    scripts: row.scripts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
