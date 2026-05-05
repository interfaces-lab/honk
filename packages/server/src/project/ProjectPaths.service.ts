/**
 * ProjectPaths - Effect service contract for project path handling.
 *
 * Owns normalization and validation of project roots plus safe resolution of
 * project-root-relative paths.
 *
 * @module ProjectPaths
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";

export class ProjectRootNotExistsError extends Schema.TaggedErrorClass<ProjectRootNotExistsError>()(
  "ProjectRootNotExistsError",
  {
    projectRoot: Schema.String,
    normalizedProjectRoot: Schema.String,
  },
) {
  override get message(): string {
    return `Project root does not exist: ${this.normalizedProjectRoot}`;
  }
}

export class ProjectRootCreateFailedError extends Schema.TaggedErrorClass<ProjectRootCreateFailedError>()(
  "ProjectRootCreateFailedError",
  {
    projectRoot: Schema.String,
    normalizedProjectRoot: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to create project root: ${this.normalizedProjectRoot}`;
  }
}

export class ProjectRootNotDirectoryError extends Schema.TaggedErrorClass<ProjectRootNotDirectoryError>()(
  "ProjectRootNotDirectoryError",
  {
    projectRoot: Schema.String,
    normalizedProjectRoot: Schema.String,
  },
) {
  override get message(): string {
    return `Project root is not a directory: ${this.normalizedProjectRoot}`;
  }
}

export class ProjectPathOutsideRootError extends Schema.TaggedErrorClass<ProjectPathOutsideRootError>()(
  "ProjectPathOutsideRootError",
  {
    projectRoot: Schema.String,
    relativePath: Schema.String,
  },
) {
  override get message(): string {
    return `Project file path must be relative to the project root: ${this.relativePath}`;
  }
}

export const ProjectPathsError = Schema.Union([
  ProjectRootNotExistsError,
  ProjectRootCreateFailedError,
  ProjectRootNotDirectoryError,
  ProjectPathOutsideRootError,
]);
export type ProjectPathsError = typeof ProjectPathsError.Type;

/**
 * ProjectPathsShape - Service API for project path normalization and guards.
 */
export interface ProjectPathsShape {
  /**
   * Normalize a user-provided project root and verify it exists as a directory.
   */
  readonly normalizeProjectRoot: (
    projectRoot: string,
    options?: { readonly createIfMissing?: boolean },
  ) => Effect.Effect<
    string,
    ProjectRootNotExistsError | ProjectRootCreateFailedError | ProjectRootNotDirectoryError
  >;

  /**
   * Resolve a relative path within a validated project root.
   *
   * Rejects absolute paths and traversal attempts outside the project root.
   */
  readonly resolveRelativePathWithinRoot: (input: {
    projectRoot: string;
    relativePath: string;
  }) => Effect.Effect<{ absolutePath: string; relativePath: string }, ProjectPathOutsideRootError>;
}

/**
 * ProjectPaths - Service tag for project path normalization and resolution.
 */
export class ProjectPaths extends Context.Service<ProjectPaths, ProjectPathsShape>()(
  "multi/project/ProjectPaths.service",
) {}
