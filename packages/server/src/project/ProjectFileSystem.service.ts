/**
 * ProjectFileSystem - Effect service contract for project file mutations.
 *
 * Owns project-root-relative file write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module ProjectFileSystem
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";

import type {
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@multi/contracts";
import { ProjectPathOutsideRootError } from "./ProjectPaths.service.ts";

export class ProjectFileSystemError extends Schema.TaggedErrorClass<ProjectFileSystemError>()(
  "ProjectFileSystemError",
  {
    cwd: Schema.String,
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * ProjectFileSystemShape - Service API for project-relative file operations.
 */
export interface ProjectFileSystemShape {
  /**
   * Read a UTF-8 text file relative to the project root.
   *
   * Rejects paths that escape the project root and refuses binary-looking
   * files. Large files are truncated for preview.
   */
  readonly readFile: (
    input: ProjectReadFileInput,
  ) => Effect.Effect<ProjectReadFileResult, ProjectFileSystemError | ProjectPathOutsideRootError>;

  /**
   * Write a file relative to the project root.
   *
   * Creates parent directories as needed and rejects paths that escape the
   * project root.
   */
  readonly writeFile: (
    input: ProjectWriteFileInput,
  ) => Effect.Effect<ProjectWriteFileResult, ProjectFileSystemError | ProjectPathOutsideRootError>;
}

/**
 * ProjectFileSystem - Service tag for project file operations.
 */
export class ProjectFileSystem extends Context.Service<ProjectFileSystem, ProjectFileSystemShape>()(
  "multi/project/ProjectFileSystem.service",
) {}
