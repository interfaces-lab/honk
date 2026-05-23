/**
 * ProjectionThreadEntryRepository - Projection repository interface for thread tree entries.
 *
 * Owns persistence operations for the normalized thread tree read model.
 *
 * @module ProjectionThreadEntryRepository
 */
import {
  IsoDateTime,
  MessageId,
  OrchestrationThreadEntryKind,
  ThreadEntryId,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "./Errors.ts";

export const ProjectionThreadEntry = Schema.Struct({
  entryId: ThreadEntryId,
  threadId: ThreadId,
  parentEntryId: Schema.NullOr(ThreadEntryId),
  kind: OrchestrationThreadEntryKind,
  messageId: Schema.NullOr(MessageId),
  turnId: Schema.NullOr(TurnId),
  targetEntryId: Schema.NullOr(ThreadEntryId),
  label: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
});
export type ProjectionThreadEntry = typeof ProjectionThreadEntry.Type;

export const GetProjectionThreadEntryInput = Schema.Struct({
  entryId: ThreadEntryId,
});
export type GetProjectionThreadEntryInput = typeof GetProjectionThreadEntryInput.Type;

export const ListProjectionThreadEntriesInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadEntriesInput = typeof ListProjectionThreadEntriesInput.Type;

export const DeleteProjectionThreadEntriesInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadEntriesInput = typeof DeleteProjectionThreadEntriesInput.Type;

export interface ProjectionThreadEntryRepositoryShape {
  readonly upsert: (entry: ProjectionThreadEntry) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getByEntryId: (
    input: GetProjectionThreadEntryInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadEntry>, ProjectionRepositoryError>;

  readonly listByThreadId: (
    input: ListProjectionThreadEntriesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadEntry>, ProjectionRepositoryError>;

  readonly deleteByThreadId: (
    input: DeleteProjectionThreadEntriesInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadEntryRepository extends Context.Service<
  ProjectionThreadEntryRepository,
  ProjectionThreadEntryRepositoryShape
>()("multi/persistence/ProjectionThreadEntries.service/ProjectionThreadEntryRepository") {}
