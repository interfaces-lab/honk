/**
 * ThreadProjection - Read-model snapshot query service interface.
 *
 * Exposes the current orchestration thread projection for read-only API
 * access.
 *
 * @module ThreadProjection
 */
import type {
  OrchestrationProject,
  OrchestrationProjectShell,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
} from "@honk/contracts";
import { Context } from "effect";
import type { Option } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";

export interface ThreadProjectionCounts {
  readonly projectCount: number;
  readonly threadCount: number;
}

/**
 * ThreadProjectionShape - Service API for read-model snapshots.
 */
export interface ThreadProjectionShape {
  /**
   * Read the latest orchestration thread projection.
   *
   * Rehydrates from projection tables and derives snapshot sequence from
   * projector cursor state.
   */
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;

  /**
   * Read the latest orchestration shell snapshot.
   *
   * Returns only projects and thread shell summaries so clients can bootstrap
   * lightweight navigation state without hydrating every thread body.
   */
  readonly getShellSnapshot: () => Effect.Effect<
    OrchestrationShellSnapshot,
    ProjectionRepositoryError
  >;

  /**
   * Read aggregate projection counts without hydrating the full read model.
   */
  readonly getCounts: () => Effect.Effect<ThreadProjectionCounts, ProjectionRepositoryError>;

  /**
   * Read the active project for an exact project root match.
   */
  readonly getActiveProjectByProjectRoot: (
    projectRoot: string,
  ) => Effect.Effect<Option.Option<OrchestrationProject>, ProjectionRepositoryError>;

  /**
   * Read a single active project shell row by id.
   */
  readonly getProjectShellById: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectionRepositoryError>;

  /**
   * Read the earliest active thread for a project.
   */
  readonly getFirstActiveThreadIdByProjectId: (
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<ThreadId>, ProjectionRepositoryError>;

  /**
   * Read a single active thread shell row by id.
   */
  readonly getThreadShellById: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThreadShell>, ProjectionRepositoryError>;

  /**
   * Read a single active thread detail snapshot by id.
   */
  readonly getThreadDetailById: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThread>, ProjectionRepositoryError>;
}

/**
 * ThreadProjection - Service tag for thread projection queries.
 */
export class ThreadProjection extends Context.Service<ThreadProjection, ThreadProjectionShape>()(
  "honk/orchestration/ThreadProjection.service",
) {}
