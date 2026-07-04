import type { EnvironmentId } from "@honk/shared/environment";
import type {
  ProjectCreateDirectoryInput,
  ProjectDeleteFileInput,
  ProjectListDirectoryResult,
  ProjectRenamePathInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
} from "@honk/shared/project";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureEnvironmentApi } from "~/environment-api";

export const projectQueryKeys = {
  all: ["projects"] as const,
  searchEntries: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    query: string,
    limit: number,
  ) => ["projects", "search-entries", environmentId ?? null, cwd, query, limit] as const,
  listDirectory: (environmentId: EnvironmentId | null, cwd: string | null, relativeDir: string) =>
    ["projects", "list-directory", environmentId ?? null, cwd, relativeDir] as const,
  readFile: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    relativePath: string | null,
  ) => ["projects", "read-file", environmentId ?? null, cwd, relativePath] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const DEFAULT_LIST_DIRECTORY_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_LIST_DIRECTORY_RESULT: ProjectListDirectoryResult = {
  entries: [],
  truncated: false,
};
export function projectSearchEntriesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  query: string;
  enabled?: boolean;
  allowEmptyQuery?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  // Opt-in: the composer `@` menu wants the top-ranked default entries on an
  // empty query; other callers (e.g. the Files panel) keep search-only loading.
  const hasUsableQuery = (input.allowEmptyQuery ?? false) || input.query.length > 0;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.environmentId, input.cwd, input.query, limit),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Project entry search is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      hasUsableQuery,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) =>
      hasUsableQuery ? (previous ?? EMPTY_SEARCH_ENTRIES_RESULT) : EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function projectListDirectoryQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativeDir: string;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.listDirectory(input.environmentId, input.cwd, input.relativeDir),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Project directory entries are unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.listDirectory({
        cwd: input.cwd,
        relativeDir: input.relativeDir,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_LIST_DIRECTORY_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_LIST_DIRECTORY_RESULT,
  });
}

export function projectReadFileQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  relativePath: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.readFile(input.environmentId, input.cwd, input.relativePath),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId || !input.relativePath) {
        throw new Error("Project file preview is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.relativePath !== null,
    staleTime: 2_000,
  });
}

export function invalidateProjectFile(
  queryClient: QueryClient,
  input: {
    environmentId: EnvironmentId;
    cwd: string;
    relativePath: string;
  },
) {
  return queryClient.invalidateQueries({
    queryKey: projectQueryKeys.readFile(input.environmentId, input.cwd, input.relativePath),
  });
}

export async function invalidateProjectEntries(
  queryClient: QueryClient,
  input: {
    environmentId: EnvironmentId;
    cwd: string;
  },
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["projects", "list-directory", input.environmentId, input.cwd] as const,
    }),
    queryClient.invalidateQueries({
      queryKey: ["projects", "search-entries", input.environmentId, input.cwd] as const,
    }),
  ]);
}

export async function writeProjectFile(input: {
  environmentId: EnvironmentId;
  file: ProjectWriteFileInput;
}) {
  const api = ensureEnvironmentApi(input.environmentId);
  return api.projects.writeFile(input.file);
}

export async function deleteProjectFile(input: {
  environmentId: EnvironmentId;
  file: ProjectDeleteFileInput;
}) {
  const api = ensureEnvironmentApi(input.environmentId);
  return api.projects.deleteFile(input.file);
}

export async function createProjectDirectory(input: {
  environmentId: EnvironmentId;
  directory: ProjectCreateDirectoryInput;
}) {
  const api = ensureEnvironmentApi(input.environmentId);
  return api.projects.createDirectory(input.directory);
}

export async function renameProjectPath(input: {
  environmentId: EnvironmentId;
  paths: ProjectRenamePathInput;
}) {
  const api = ensureEnvironmentApi(input.environmentId);
  return api.projects.renamePath(input.paths);
}
