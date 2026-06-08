import {
  type EnvironmentId,
  type GitFilePatchResult,
  type GitManagerServiceError,
  type GitStatusResult,
  type GitWorkingTreeFileStatus,
} from "@multi/contracts";
import type { GitFileState } from "~/lib/ui-session-types";
import { type QueryClient, useQueries, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { readEnvironmentGitApi, type EnvironmentGitApi } from "../lib/environment-git-api";
import { refreshGitStatus, useGitStatus } from "../lib/git-status-state";
import {
  gitPatchQueryOptions,
  gitQueryKeys,
  invalidateGitPatchQueries,
} from "../lib/environment-git-react-query";
import { useLocalStorage } from "./use-local-storage";

const DiffStyle = Schema.Literals(["unified", "split"]);
const MAX_ACTIVE_GIT_PATCH_QUERIES = 80;

export function useDiffStylePreference() {
  return useLocalStorage<"unified" | "split", "unified" | "split">(
    "multi:git-diff-style",
    "unified",
    DiffStyle,
  );
}

export interface DiffRow {
  id: string;
  path: string;
  prevPath: string | null;
  state: GitFileState;
  staged: boolean;
  unstaged: boolean;
  add: number;
  del: number;
}

export type GitPanelViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "no-repo" }
  | { kind: "clean" }
  | { kind: "changed" };

export interface GitPanelModel {
  cwd: string | null;
  view: GitPanelViewState;
  count: number;
  branch: string | null;
  rows: DiffRow[];
  totalAdd: number;
  totalDel: number;
  focusId: string | null;
  patchesByPath: Map<string, GitFilePatchResult>;
  diffLoadingByPath: Set<string>;
  diffErrorByPath: Map<string, string>;
  expandedIds: Set<string>;
  activeDiffIds: Set<string>;
  lifecycleSync: ReactNode;
  requestDiff: (id: string) => void;
  toggleExpand: (id: string, open?: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
}

interface GitStatusSnapshot {
  readonly data: GitStatusResult | null;
  readonly error: GitManagerServiceError | null;
  readonly isPending: boolean;
}

function workingTreeStatusToGitFileState(status: GitWorkingTreeFileStatus): GitFileState {
  switch (status) {
    case "added":
      return "added";
    case "deleted":
      return "deleted";
    case "ignored":
      return "ignored";
    case "renamed":
      return "renamed";
    case "untracked":
      return "untracked";
    case "conflict":
      return "conflict";
    case "modified":
    default:
      return "modified";
  }
}

function toRow(file: GitStatusResult["workingTree"]["files"][number]): DiffRow {
  return {
    id: file.path,
    path: file.path,
    prevPath: file.prevPath ?? null,
    state: workingTreeStatusToGitFileState(file.status),
    staged: file.staged ?? false,
    unstaged: file.unstaged ?? true,
    add: file.insertions,
    del: file.deletions,
  };
}

function toRows(status: GitStatusResult | null): DiffRow[] {
  if (!status) return [];
  return status.workingTree.files.map(toRow);
}

function areDiffRowsEqual(left: DiffRow, right: DiffRow): boolean {
  return (
    left.path === right.path &&
    left.prevPath === right.prevPath &&
    left.state === right.state &&
    left.staged === right.staged &&
    left.unstaged === right.unstaged &&
    left.add === right.add &&
    left.del === right.del
  );
}

function toRowsWithReuse(status: GitStatusResult | null, previousRows: readonly DiffRow[]): DiffRow[] {
  const nextRows = toRows(status);
  if (nextRows.length === 0 || previousRows.length === 0) {
    return nextRows;
  }

  const previousById = new Map(previousRows.map((row) => [row.id, row]));
  let reusedAny = false;
  const reusedRows = nextRows.map((row) => {
    const previous = previousById.get(row.id);
    if (!previous || !areDiffRowsEqual(previous, row)) {
      return row;
    }
    reusedAny = true;
    return previous;
  });

  return reusedAny ? reusedRows : nextRows;
}

function getGitErrorMessage(error: GitManagerServiceError | null): string {
  if (!error) {
    return "Unable to load Git status.";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const detail = "detail" in error ? (error.detail as string | undefined) : undefined;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail;
    }
  }

  return "Unable to load Git status.";
}

export function syncRows(prev: DiffRow[], next: DiffRow[]) {
  const rows = new Map(prev.map((row) => [row.id, row]));
  const ids = new Set<string>();
  const drop = new Set<string>();

  for (const row of next) {
    ids.add(row.id);
    const current = rows.get(row.id);
    if (!current) continue;
    if (areDiffRowsEqual(current, row)) {
      continue;
    }
    drop.add(row.id);
  }

  return { ids, drop };
}

function pruneSetToIds(current: Set<string>, validIds: ReadonlySet<string>): Set<string> {
  let changed = false;
  const next = new Set<string>();
  for (const id of current) {
    if (validIds.has(id)) {
      next.add(id);
    } else {
      changed = true;
    }
  }
  return changed ? next : current;
}

function EnvironmentGitPanelRowsSync({
  cwd,
  environmentId,
  queryClient,
  rows,
}: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  queryClient: QueryClient;
  rows: DiffRow[];
}) {
  const prevRows = useRef<DiffRow[]>([]);

  useEffect(() => {
    const previousRows = prevRows.current;
    const next = syncRows(previousRows, rows);
    prevRows.current = rows;

    if (!cwd) {
      return;
    }

    const removed = new Set(previousRows.map((row) => row.id));
    for (const row of rows) {
      removed.delete(row.id);
    }

    for (const id of removed) {
      queryClient.removeQueries({
        queryKey: gitQueryKeys.patch(environmentId, cwd, id),
      });
    }

    for (const id of next.drop) {
      void queryClient.invalidateQueries({
        queryKey: gitQueryKeys.patch(environmentId, cwd, id),
      });
    }
  }, [cwd, environmentId, queryClient, rows]);

  return null;
}

export async function revalidateGitPanelPatches(input: {
  environmentId: EnvironmentId | null;
  cwd: string;
  api: Pick<EnvironmentGitApi, "refreshStatus">;
  queryClient: QueryClient;
}): Promise<void> {
  const target = { environmentId: input.environmentId, cwd: input.cwd };
  await refreshGitStatus(target, input.api, { force: true });
  await invalidateGitPatchQueries(input.queryClient, target);
}

export function deriveGitPanelViewState(input: {
  cwd: string | null;
  status: GitStatusSnapshot;
}): GitPanelViewState {
  if (input.cwd === null) {
    return { kind: "idle" };
  }

  if (input.status.error) {
    return { kind: "error", message: getGitErrorMessage(input.status.error) };
  }

  if (!input.status.data) {
    return input.status.isPending ? { kind: "loading" } : { kind: "idle" };
  }

  if (!input.status.data.isRepo) {
    return { kind: "no-repo" };
  }

  if (
    !input.status.data.hasWorkingTreeChanges ||
    input.status.data.workingTree.files.length === 0
  ) {
    return { kind: "clean" };
  }

  return { kind: "changed" };
}

export function useEnvironmentGitPanel(
  environmentId: EnvironmentId | null,
  cwd: string | null,
  options?: { enabled?: boolean },
): GitPanelModel {
  const enabled = options?.enabled ?? true;
  const queryClient = useQueryClient();
  const gitApi = enabled && cwd ? readEnvironmentGitApi(environmentId) : null;
  const status = useGitStatus({
    environmentId: environmentId ?? null,
    cwd: enabled ? cwd : null,
  });
  const view = deriveGitPanelViewState({
    cwd: enabled ? cwd : null,
    status,
  });
  useEffect(() => {
    if (!enabled || !cwd || !gitApi || !environmentId) {
      return;
    }
    void refreshGitStatus({ environmentId, cwd }, gitApi, { force: true })
      .catch(() => undefined);
  }, [cwd, enabled, environmentId, gitApi]);
  const rowReuseRef = useRef<DiffRow[]>([]);

  const nextRows =
    view.kind === "changed" ? toRowsWithReuse(status.data, rowReuseRef.current) : [];
  rowReuseRef.current = nextRows;
  const rows = nextRows;

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [requestedDiffIds, setRequestedDiffIds] = useState<Set<string>>(() => new Set());
  const [activeDiffIds, setActiveDiffIds] = useState<Set<string>>(() => new Set());
  const gitPanelRowsSync = createElement(EnvironmentGitPanelRowsSync, {
    key: [cwd ?? "", environmentId ?? ""].join("\0"),
    cwd: enabled ? cwd : null,
    environmentId: environmentId ?? null,
    queryClient,
    rows,
  });

  const rowIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);

  useEffect(() => {
    setCollapsedIds((current) => pruneSetToIds(current, rowIds));
    setRequestedDiffIds((current) => pruneSetToIds(current, rowIds));
    setActiveDiffIds((current) => pruneSetToIds(current, rowIds));
  }, [rowIds]);

  const expandedIds = new Set(
    rows.filter((row) => !collapsedIds.has(row.id)).map((row) => row.id),
  );

  const activeDiffRows = rows.filter((row) => activeDiffIds.has(row.id));

  const patchQueries = useQueries({
    queries: activeDiffRows.map((row) =>
      gitPatchQueryOptions({
        environmentId: environmentId ?? null,
        cwd,
        path: row.path,
        prevPath: row.prevPath,
        state: row.state,
        enabled: Boolean(cwd && environmentId),
      }),
    ),
  });

  const patchesByPath = new Map<string, GitFilePatchResult>();
  const diffLoadingByPath = new Set<string>();
  const diffErrorByPath = new Map<string, string>();

  if (cwd) {
    for (const row of rows) {
      if (!requestedDiffIds.has(row.id)) {
        continue;
      }
      const cachedPatch = queryClient.getQueryData<GitFilePatchResult>(
        gitQueryKeys.patch(environmentId ?? null, cwd, row.path, row.state, row.prevPath),
      );
      if (cachedPatch) {
        patchesByPath.set(row.path, cachedPatch);
      }
    }
  }

  for (const [index, row] of activeDiffRows.entries()) {
    const query = patchQueries[index];
    if (!query) continue;

    const isFetching = query.isPending || query.fetchStatus === "fetching";
    const isRetryingEmptyPatch = query.data?.kind === "empty" && isFetching;

    if (query.data && !isRetryingEmptyPatch) {
      patchesByPath.set(row.path, query.data);
    }

    if ((!query.data || isRetryingEmptyPatch) && isFetching) {
      diffLoadingByPath.add(row.path);
    }

    if (!query.data && query.error) {
      diffErrorByPath.set(
        row.path,
        query.error instanceof Error ? query.error.message : String(query.error),
      );
    }
  }

  const focusId = null;

  const revalidate = async () => {
    if (!enabled || !cwd) {
      return;
    }

    if (!gitApi) {
      return;
    }

    await revalidateGitPanelPatches({
      environmentId: environmentId ?? null,
      cwd,
      api: gitApi,
      queryClient,
    });
  };

  const refresh = async () => {
    await revalidate();
  };

  const init = async () => {
    if (!cwd) {
      throw new Error("No project");
    }

    if (!gitApi) {
      throw new Error("Git API not available");
    }

    await gitApi.init({ cwd });
    await revalidate();
  };

  const discard = async (pathsToDiscard: string[]) => {
    if (!cwd) {
      throw new Error("No project");
    }

    if (pathsToDiscard.length === 0) {
      return;
    }

    if (!gitApi) {
      throw new Error("Git API not available");
    }

    await gitApi.discardPaths({ cwd, paths: pathsToDiscard });
    await revalidate();
  };

  const requestDiff = (id: string) => {
    if (!rowIds.has(id)) return;

    setRequestedDiffIds((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });

    setActiveDiffIds((current) => {
      const next = new Set(current);
      next.delete(id);
      next.add(id);

      for (const activeId of next) {
        if (next.size <= MAX_ACTIVE_GIT_PATCH_QUERIES) break;
        if (activeId === id) continue;
        next.delete(activeId);
      }

      return next;
    });
  };

  const toggleExpand = (id: string, open?: boolean) => {
    const shouldRequest = open ?? collapsedIds.has(id);
    if (shouldRequest) {
      requestDiff(id);
    }

    setCollapsedIds((current) => {
      const next = new Set(current);
      const shouldOpen = open ?? next.has(id);
      if (shouldOpen) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => setCollapsedIds(new Set());
  const collapseAll = () => {
    setCollapsedIds(new Set(rows.map((row) => row.id)));
  };
  const totalAdd = rows.reduce((sum, row) => sum + row.add, 0);
  const totalDel = rows.reduce((sum, row) => sum + row.del, 0);

  return {
    cwd,
    view,
    count: rows.length,
    branch: status.data?.branch ?? null,
    rows,
    totalAdd,
    totalDel,
    focusId,
    patchesByPath,
    diffLoadingByPath,
    diffErrorByPath,
    expandedIds,
    activeDiffIds,
    lifecycleSync: gitPanelRowsSync,
    requestDiff,
    toggleExpand,
    expandAll,
    collapseAll,
    refresh,
    init,
    discard,
  };
}
