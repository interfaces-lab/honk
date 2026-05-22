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
  useCallback,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";

import { readNativeGitApi, type NativeGitApi } from "../lib/native-git-api";
import { refreshGitStatus, useGitStatus } from "../lib/git-status-state";
import {
  gitPatchQueryOptions,
  gitQueryKeys,
  invalidateGitPatchQueries,
} from "../lib/native-git-react-query";
import { useLocalStorage } from "./use-local-storage";
import { useMountEffect } from "./use-mount-effect";
import { useShellState } from "./use-shell-cwd";

const DiffStyle = Schema.Literals(["unified", "split"]);
const MAX_ACTIVE_GIT_PATCH_QUERIES = 80;
const GIT_PANEL_FOCUS_REFRESH_DEBOUNCE_MS = 500;

function useValueIdentityVersion<TValue>(value: TValue): number {
  const valueRef = useRef(value);
  const versionRef = useRef(0);
  if (valueRef.current !== value) {
    valueRef.current = value;
    versionRef.current += 1;
  }
  return versionRef.current;
}

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
    if (
      current.path === row.path &&
      current.prevPath === row.prevPath &&
      current.state === row.state &&
      current.staged === row.staged &&
      current.unstaged === row.unstaged &&
      current.add === row.add &&
      current.del === row.del
    ) {
      continue;
    }
    drop.add(row.id);
  }

  return { ids, drop };
}

function EnvironmentGitPanelRowsSync({
  cwd,
  environmentId,
  prevRows,
  queryClient,
  rows,
}: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  prevRows: RefObject<DiffRow[]>;
  queryClient: QueryClient;
  rows: DiffRow[];
}) {
  useMountEffect(() => {
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
  });

  return null;
}

export async function revalidateGitPanelPatches(input: {
  environmentId: EnvironmentId | null;
  cwd: string;
  api: Pick<NativeGitApi, "refreshStatus">;
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
  environmentId?: EnvironmentId | null,
  cwdOverride?: string | null,
): GitPanelModel {
  const shell = useShellState(cwdOverride == null);
  const cwd = cwdOverride ?? shell.cwd;
  const queryClient = useQueryClient();
  const status = useGitStatus({ environmentId: environmentId ?? null, cwd });
  const view = deriveGitPanelViewState({ cwd, status });

  const rows = useMemo(
    () => (view.kind === "changed" ? toRows(status.data) : []),
    [status.data, view.kind],
  );

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [requestedDiffIds, setRequestedDiffIds] = useState<Set<string>>(() => new Set());
  const prevRows = useRef<DiffRow[]>([]);
  const rowsVersion = useValueIdentityVersion(rows);
  const queryClientVersion = useValueIdentityVersion(queryClient);
  const gitPanelRowsSync = createElement(EnvironmentGitPanelRowsSync, {
    key: [cwd ?? "", environmentId ?? "", queryClientVersion, rowsVersion].join("\0"),
    cwd,
    environmentId: environmentId ?? null,
    prevRows,
    queryClient,
    rows,
  });

  const rowIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);

  const expandedIds = useMemo(
    () => new Set(rows.filter((row) => !collapsedIds.has(row.id)).map((row) => row.id)),
    [collapsedIds, rows],
  );

  const requestedDiffRows = useMemo(
    () => rows.filter((row) => requestedDiffIds.has(row.id)),
    [requestedDiffIds, rows],
  );

  const patchQueries = useQueries({
    queries: requestedDiffRows.map((row) =>
      gitPatchQueryOptions({
        environmentId: environmentId ?? null,
        cwd,
        path: row.path,
        prevPath: row.prevPath,
        state: row.state,
        enabled: Boolean(cwd),
      }),
    ),
  });

  const patchesByPath = new Map<string, GitFilePatchResult>();
  const diffLoadingByPath = new Set<string>();
  const diffErrorByPath = new Map<string, string>();

  for (const [index, row] of requestedDiffRows.entries()) {
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

  const revalidate = useCallback(async () => {
    if (!cwd) {
      return;
    }

    const api = readNativeGitApi(environmentId);
    if (!api) {
      return;
    }

    await revalidateGitPanelPatches({
      environmentId: environmentId ?? null,
      cwd,
      api,
      queryClient,
    });
  }, [cwd, environmentId, queryClient]);

  const refresh = useCallback(async () => {
    await revalidate();
  }, [revalidate]);

  const cwdRef = useRef(cwd);
  const revalidateRef = useRef(revalidate);
  cwdRef.current = cwd;
  revalidateRef.current = revalidate;

  useMountEffect(() => {
    let refreshTimeout: number | null = null;
    const scheduleRevalidation = () => {
      if (!cwdRef.current) {
        return;
      }
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        void revalidateRef.current().catch(() => undefined);
      }, GIT_PANEL_FOCUS_REFRESH_DEBOUNCE_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleRevalidation();
      }
    };

    window.addEventListener("focus", scheduleRevalidation);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      window.removeEventListener("focus", scheduleRevalidation);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  });

  const init = useCallback(async () => {
    if (!cwd) {
      throw new Error("No project");
    }

    const api = readNativeGitApi(environmentId);
    if (!api) {
      throw new Error("Git API not available");
    }

    await api.init({ cwd });
    await revalidate();
  }, [cwd, environmentId, revalidate]);

  const discard = useCallback(
    async (pathsToDiscard: string[]) => {
      if (!cwd) {
        throw new Error("No project");
      }

      if (pathsToDiscard.length === 0) {
        return;
      }

      const api = readNativeGitApi(environmentId);
      if (!api) {
        throw new Error("Git API not available");
      }

      await api.discardPaths({ cwd, paths: pathsToDiscard });
      await revalidate();
    },
    [cwd, environmentId, revalidate],
  );

  const requestDiff = useCallback(
    (id: string) => {
      if (!rowIds.has(id)) return;

      setRequestedDiffIds((current) => {
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
    },
    [rowIds],
  );

  const toggleExpand = useCallback(
    (id: string, open?: boolean) => {
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
    },
    [collapsedIds, requestDiff],
  );

  return {
    cwd,
    view,
    count: rows.length,
    branch: status.data?.branch ?? null,
    rows,
    totalAdd: rows.reduce((sum, row) => sum + row.add, 0),
    totalDel: rows.reduce((sum, row) => sum + row.del, 0),
    focusId,
    patchesByPath,
    diffLoadingByPath,
    diffErrorByPath,
    expandedIds,
    lifecycleSync: gitPanelRowsSync,
    requestDiff,
    toggleExpand,
    expandAll: () => setCollapsedIds(new Set()),
    collapseAll: () => setCollapsedIds(new Set(rows.map((row) => row.id))),
    refresh,
    init,
    discard,
  };
}
