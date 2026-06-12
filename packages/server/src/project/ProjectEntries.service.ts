/**
 * ProjectEntries - Effect service contract for cached project entry search.
 *
 * Owns indexed project entry search plus cache invalidation for project
 * roots when the underlying filesystem changes.
 *
 * @module ProjectEntries
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";

import type {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
} from "@honk/contracts";
import type { ProjectRootNormalizeError } from "./ProjectPaths.service.ts";

export class ProjectEntriesError extends Schema.TaggedErrorClass<ProjectEntriesError>()(
  "ProjectEntriesError",
  {
    cwd: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ProjectEntriesBrowseError extends Schema.TaggedErrorClass<ProjectEntriesBrowseError>()(
  "ProjectEntriesBrowseError",
  {
    cwd: Schema.optional(Schema.String),
    partialPath: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * ProjectEntriesShape - Service API for project entry search and cache
 * invalidation.
 */
export interface ProjectEntriesShape {
  /**
   * Browse matching directories for the provided partial path.
   */
  readonly browse: (
    input: FilesystemBrowseInput,
  ) => Effect.Effect<FilesystemBrowseResult, ProjectEntriesBrowseError>;

  /**
   * Search indexed project entries for files and directories matching the
   * provided query.
   */
  readonly search: (
    input: ProjectSearchEntriesInput,
  ) => Effect.Effect<ProjectSearchEntriesResult, ProjectEntriesError | ProjectRootNormalizeError>;

  /**
   * List immediate children for explorer/file-tree presentation.
   */
  readonly listDirectory: (
    input: ProjectListDirectoryInput,
  ) => Effect.Effect<ProjectListDirectoryResult, ProjectEntriesError | ProjectRootNormalizeError>;

  /**
   * Drop any cached project entries for the given project root.
   */
  readonly invalidate: (cwd: string) => Effect.Effect<void>;
}

/**
 * ProjectEntries - Service tag for cached project entry search.
 */
export class ProjectEntries extends Context.Service<ProjectEntries, ProjectEntriesShape>()(
  "honk/project/ProjectEntries.service",
) {}
