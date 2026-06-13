import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./base-schemas";
import { FilesystemPreviewSyntax } from "./filesystem";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_LIST_DIRECTORY_PATH_MAX_LENGTH = 512;
const PROJECT_READ_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_DELETE_FILE_PATH_MAX_LENGTH = 512;

export const DEFAULT_PROJECTLESS_CWD = "~/Documents";

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  // Empty query is valid: the project index returns its top-ranked default
  // entries (used by the composer `@` menu's default file list). The backend
  // `scoreEntry` handles the empty case; only the wire contract gated it out.
  query: Schema.String.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativeDir: Schema.String.check(Schema.isMaxLength(PROJECT_LIST_DIRECTORY_PATH_MAX_LENGTH)),
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectListDirectoryResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export class ProjectListDirectoryError extends Schema.TaggedErrorClass<ProjectListDirectoryError>()(
  "ProjectListDirectoryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.String,
  sizeBytes: NonNegativeInt,
  mtimeMs: Schema.Number,
  readBytes: NonNegativeInt,
  truncated: Schema.Boolean,
  syntax: FilesystemPreviewSyntax,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
  expectedMtimeMs: Schema.optional(Schema.Number),
  expectedSizeBytes: Schema.optional(NonNegativeInt),
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  mtimeMs: Schema.Number,
  sizeBytes: NonNegativeInt,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ProjectWriteConflictError extends Schema.TaggedErrorClass<ProjectWriteConflictError>()(
  "ProjectWriteConflictError",
  {
    relativePath: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
  },
) {}

export const ProjectDeleteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_DELETE_FILE_PATH_MAX_LENGTH),
  ),
});
export type ProjectDeleteFileInput = typeof ProjectDeleteFileInput.Type;

export const ProjectDeleteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectDeleteFileResult = typeof ProjectDeleteFileResult.Type;

export class ProjectDeleteFileError extends Schema.TaggedErrorClass<ProjectDeleteFileError>()(
  "ProjectDeleteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
