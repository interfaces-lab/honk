import type { FileDiffMetadata } from "@pierre/diffs";
import type { EnvironmentId, GitManagerServiceError, GitStatusResult } from "@multi/contracts";
import type { GitFileState } from "~/lib/ui-session-types";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { refreshGitStatus, useGitStatus } from "../lib/git-status-state";
import { gitPatchQueryOptions, gitQueryKeys } from "../lib/native-git-react-query";
import { readNativeGitApi } from "../lib/native-git-api";
import { useShellLayoutStore } from "../lib/shell-layout-store";
import { useLocalStorage } from "./use-local-storage";
import { useShellState } from "./use-shell-cwd";

const DiffStyle = Schema.Literals(["unified", "split"]);

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
  diffsByPath: Map<string, FileDiffMetadata | null>;
  patchesByPath: Map<string, string>;
  diffLoadingByPath: Set<string>;
  diffErrorByPath: Map<string, string>;
  expandedIds: Set<string>;
  toggleExpand: (id: string, open?: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  runCommit: (input: { message: string; push?: boolean }) => Promise<void>;
  runBranchCommit: (input: { message: string; push?: boolean }) => Promise<void>;
  runPush: () => Promise<void>;
}

interface GitStatusSnapshot {
  readonly data: GitStatusResult | null;
  readonly error: GitManagerServiceError | null;
  readonly isPending: boolean;
}

function clean(path: string): string {
  const raw = path.replace(/\\/g, "/");
  const win = /^[A-Za-z]:\//.test(raw) ? raw.slice(0, 2) : "";
  const abs = win.length > 0 || raw.startsWith("/");
  const body = (win ? raw.slice(2) : raw).split("/");
  const out: string[] = [];

  for (const seg of body) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }

  if (win) return out.length > 0 ? `${win}/${out.join("/")}` : `${win}/`;
  if (abs) return out.length > 0 ? `/${out.join("/")}` : "/";
  return out.join("/");
}

function join(base: string, path: string): string {
  const next = clean(path);
  if (next.startsWith("/") || /^[A-Za-z]:\//.test(next)) return next;
  return clean(`${clean(base)}/${next}`);
}

function rel(path: string, root: string): string | null {
  const file = clean(path);
  const base = clean(root).replace(/\/+$/, "");
  if (file === base) return "";
  if (!file.startsWith(`${base}/`)) return null;
  return file.slice(base.length + 1);
}

function pick(path: string, cwd: string, root: string | null): string | null {
  if (!root) return null;
  if (path.startsWith("~/")) return null;
  const file = path.startsWith("/") || /^[A-Za-z]:\//.test(path) ? clean(path) : join(cwd, path);
  return rel(file, root);
}

function hit(paths: string[], cwd: string, root: string | null, files: DiffRow[]): DiffRow | null {
  for (const path of paths) {
    const next = pick(path, cwd, root);
    if (next === null) continue;
    const file = files.find((row) => row.path === next || row.prevPath === next);
    if (file) return file;
  }
  return null;
}

function toRow(file: GitStatusResult["workingTree"]["files"][number]): DiffRow {
  return {
    id: file.path,
    path: file.path,
    prevPath: null,
    state: "modified",
    staged: false,
    unstaged: true,
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
      current.add === row.add &&
      current.del === row.del
    ) {
      continue;
    }
    drop.add(row.id);
  }

  return { ids, drop };
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

export function useEnvironmentGitPanel(environmentId?: EnvironmentId | null): GitPanelModel {
  const { cwd } = useShellState();
  const queryClient = useQueryClient();
  const status = useGitStatus({ environmentId: environmentId ?? null, cwd });
  const view = deriveGitPanelViewState({ cwd, status });
  const paths = useShellLayoutStore((state) => state.paths);

  const rows = useMemo(
    () => (view.kind === "changed" ? toRows(status.data) : []),
    [status.data, view.kind],
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const prevRows = useRef<DiffRow[]>([]);

  useEffect(() => {
    const previousRows = prevRows.current;
    const next = syncRows(previousRows, rows);
    prevRows.current = rows;

    setExpandedIds((current) => {
      let changed = false;
      const kept = new Set<string>();
      for (const id of current) {
        if (!next.ids.has(id)) {
          changed = true;
          continue;
        }
        kept.add(id);
      }
      return changed ? kept : current;
    });

    if (!cwd) {
      return;
    }

    const removed = new Set(previousRows.map((row) => row.id));
    for (const row of rows) {
      removed.delete(row.id);
    }

    for (const id of removed) {
      queryClient.removeQueries({
        queryKey: gitQueryKeys.patch(environmentId ?? null, cwd, id),
        exact: true,
      });
    }

    for (const id of next.drop) {
      void queryClient.invalidateQueries({
        queryKey: gitQueryKeys.patch(environmentId ?? null, cwd, id),
        exact: true,
      });
    }
  }, [cwd, environmentId, queryClient, rows]);

  const expandedPaths = useMemo(
    () => rows.filter((row) => expandedIds.has(row.id)).map((row) => row.path),
    [expandedIds, rows],
  );

  const patchQueries = useQueries({
    queries: expandedPaths.map((path) =>
      gitPatchQueryOptions({
        environmentId: environmentId ?? null,
        cwd,
        path,
        enabled: Boolean(cwd),
      }),
    ),
  });

  const diffsByPath = new Map<string, FileDiffMetadata | null>();
  const patchesByPath = new Map<string, string>();
  const diffLoadingByPath = new Set<string>();
  const diffErrorByPath = new Map<string, string>();

  for (const [index, path] of expandedPaths.entries()) {
    const query = patchQueries[index];
    if (!query) continue;

    if (query.data) {
      diffsByPath.set(path, query.data.diff);
      patchesByPath.set(path, query.data.patch);
    }

    if (!query.data && (query.isPending || query.fetchStatus === "fetching")) {
      diffLoadingByPath.add(path);
    }

    if (!query.data && query.error) {
      diffErrorByPath.set(
        path,
        query.error instanceof Error ? query.error.message : String(query.error),
      );
    }
  }

  const focusId = useMemo(() => {
    if (!cwd || rows.length === 0) {
      return null;
    }
    return hit(paths, cwd, cwd, rows)?.id ?? null;
  }, [cwd, paths, rows]);

  const refresh = useCallback(async () => {
    if (!cwd) {
      return;
    }

    const api = readNativeGitApi(environmentId);
    if (!api) {
      return;
    }

    await refreshGitStatus({ environmentId: environmentId ?? null, cwd }, api);
  }, [cwd, environmentId]);

  const init = useCallback(async () => {
    if (!cwd) {
      throw new Error("No workspace");
    }

    const api = readNativeGitApi(environmentId);
    if (!api) {
      throw new Error("Git API not available");
    }

    await api.init({ cwd });
    await refreshGitStatus({ environmentId: environmentId ?? null, cwd }, api);
  }, [cwd, environmentId]);

  const discard = useCallback(
    async (pathsToDiscard: string[]) => {
      if (!cwd) {
        throw new Error("No workspace");
      }

      if (pathsToDiscard.length === 0) {
        return;
      }

      const api = readNativeGitApi(environmentId);
      if (!api) {
        throw new Error("Git API not available");
      }

      await api.discardPaths({ cwd, paths: pathsToDiscard });
      await refreshGitStatus({ environmentId: environmentId ?? null, cwd }, api);
    },
    [cwd, environmentId],
  );

  const runCommit = useCallback(
    async (input: { message: string; push?: boolean }) => {
      if (!cwd) {
        throw new Error("No workspace");
      }

      const api = readNativeGitApi(environmentId);
      if (!api) {
        throw new Error("Git API not available");
      }

      await api.runStackedAction({
        cwd,
        action: input.push ? "commit_push" : "commit",
        commitMessage: input.message,
      });
      await refreshGitStatus({ environmentId: environmentId ?? null, cwd }, api);
    },
    [cwd, environmentId],
  );

  const runBranchCommit = useCallback(
    async (input: { message: string; push?: boolean }) => {
      if (!cwd) {
        throw new Error("No workspace");
      }

      const api = readNativeGitApi(environmentId);
      if (!api) {
        throw new Error("Git API not available");
      }

      await api.runStackedAction({
        cwd,
        action: input.push ? "commit_push" : "commit",
        commitMessage: input.message,
        featureBranch: true,
      });
      await refreshGitStatus({ environmentId: environmentId ?? null, cwd }, api);
    },
    [cwd, environmentId],
  );

  const runPush = useCallback(async () => {
    if (!cwd) {
      throw new Error("No workspace");
    }

    const api = readNativeGitApi(environmentId);
    if (!api) {
      throw new Error("Git API not available");
    }

    await api.runStackedAction({
      cwd,
      action: "push",
    });
    await refreshGitStatus({ environmentId: environmentId ?? null, cwd }, api);
  }, [cwd, environmentId]);

  return {
    cwd,
    view,
    count: rows.length,
    branch: status.data?.branch ?? null,
    rows,
    totalAdd: rows.reduce((sum, row) => sum + row.add, 0),
    totalDel: rows.reduce((sum, row) => sum + row.del, 0),
    focusId,
    diffsByPath,
    patchesByPath,
    diffLoadingByPath,
    diffErrorByPath,
    expandedIds,
    toggleExpand: (id, open) => {
      setExpandedIds((current) => {
        const next = new Set(current);
        const shouldOpen = open ?? !next.has(id);
        if (shouldOpen) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
    },
    expandAll: () => setExpandedIds(new Set(rows.map((row) => row.id))),
    collapseAll: () => setExpandedIds(new Set()),
    refresh,
    init,
    discard,
    runCommit,
    runBranchCommit,
    runPush,
  };
}
