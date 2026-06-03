import type { EnvironmentId, GitFilePatchResult } from "@multi/contracts";
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import type { GitFileState } from "~/lib/ui-session-types";
import { ensureEnvironmentGitApi } from "~/lib/environment-git-api";

const GIT_PATCH_CACHE_GC_TIME_MS = 2 * 60 * 1000;

export const gitQueryKeys = {
  patchesForCwd: (environmentId: EnvironmentId | null, cwd: string) =>
    ["git", "patch", environmentId ?? null, cwd] as const,
  patch: (
    environmentId: EnvironmentId | null,
    cwd: string,
    path: string,
    state?: GitFileState,
    prevPath?: string | null,
  ) =>
    state
      ? (["git", "patch", environmentId ?? null, cwd, path, state, prevPath ?? null] as const)
      : (["git", "patch", environmentId ?? null, cwd, path] as const),
};

export function invalidateGitPatchQueries(
  queryClient: QueryClient,
  input: {
    environmentId: EnvironmentId | null;
    cwd: string;
  },
) {
  return queryClient.invalidateQueries({
    queryKey: gitQueryKeys.patchesForCwd(input.environmentId, input.cwd),
  });
}

export function gitPatchQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  path: string;
  prevPath?: string | null;
  state: GitFileState;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: gitQueryKeys.patch(
      input.environmentId,
      input.cwd ?? "",
      input.path,
      input.state,
      input.prevPath,
    ),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Git patch API not available");
      }
      const result = await ensureEnvironmentGitApi(input.environmentId).getFilePatch({
        cwd: input.cwd,
        path: input.path,
        ...(input.prevPath ? { prevPath: input.prevPath } : {}),
      });
      return result satisfies GitFilePatchResult;
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: 0,
    gcTime: GIT_PATCH_CACHE_GC_TIME_MS,
  });
}
