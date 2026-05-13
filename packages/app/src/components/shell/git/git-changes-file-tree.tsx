"use client";

import { prepareFileTreeInput } from "@pierre/trees";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";
import { useEffect, useMemo, useRef } from "react";

import type { DiffRow } from "~/hooks/use-environment-git";
import type { GitFileState } from "~/lib/ui-session-types";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/use-theme";
import { normalizeTreePath, Tree, useTreeModel } from "../../tree";

function gitFileStateToTreesStatus(state: GitFileState): GitStatus {
  switch (state) {
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
    case "copied":
      return "renamed";
    case "conflict":
    case "modified":
    default:
      return "modified";
  }
}

function diffRowsToGitStatusEntries(rows: readonly DiffRow[]): GitStatusEntry[] {
  return rows.map((row) => ({
    path: normalizeTreePath(row.path),
    status: gitFileStateToTreesStatus(row.state),
  }));
}

/**
 * Pierre {@link @pierre/trees} file tree for working-tree changes only (canonical `/` paths).
 */
export function GitChangesFileTree(props: {
  rows: readonly DiffRow[];
  selectedId: string | null;
  onSelect: (row: DiffRow) => void;
  title?: string;
  className?: string;
}) {
  const filePathSetRef = useRef<ReadonlySet<string>>(new Set());
  const pathToRowRef = useRef(new Map<string, DiffRow>());
  const onSelectRef = useRef(props.onSelect);
  const lastOpenedPathRef = useRef<string | null>(null);
  const suppressSelectionOpenRef = useRef<string | null>(null);
  const { resolvedTheme } = useTheme();

  onSelectRef.current = props.onSelect;

  const sortedRows = useMemo(
    () => props.rows.toSorted((a, b) => a.path.localeCompare(b.path)),
    [props.rows],
  );

  const treePaths = useMemo(
    () => sortedRows.map((row) => normalizeTreePath(row.path)),
    [sortedRows],
  );

  const preparedInput = useMemo(() => prepareFileTreeInput(treePaths), [treePaths]);

  const pathSet = useMemo(() => new Set(treePaths), [treePaths]);

  const pathToRow = useMemo(() => {
    const next = new Map<string, DiffRow>();
    for (const row of sortedRows) {
      next.set(normalizeTreePath(row.path), row);
    }
    return next;
  }, [sortedRows]);

  const gitStatusEntries = useMemo(() => diffRowsToGitStatusEntries(sortedRows), [sortedRows]);

  const selectedPath =
    props.selectedId !== null
      ? (sortedRows.find((row) => row.id === props.selectedId)?.path ?? null)
      : null;
  const selectedKey = selectedPath !== null ? normalizeTreePath(selectedPath) : null;

  const { model } = useTreeModel({
    paths: [],
    fileTreeSearchMode: "collapse-non-matches",
    initialExpansion: "open",
    search: true,
    searchBlurBehavior: "retain",
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths[0] ?? null;
      if (!path || path === lastOpenedPathRef.current || !filePathSetRef.current.has(path)) {
        return;
      }
      if (path === suppressSelectionOpenRef.current) {
        suppressSelectionOpenRef.current = null;
        lastOpenedPathRef.current = path;
        return;
      }
      lastOpenedPathRef.current = path;
      const row = pathToRowRef.current.get(path);
      if (row) {
        onSelectRef.current(row);
      }
    },
  });

  useEffect(() => {
    filePathSetRef.current = pathSet;
  }, [pathSet]);

  useEffect(() => {
    pathToRowRef.current = pathToRow;
  }, [pathToRow]);

  useEffect(() => {
    model.resetPaths(treePaths, { preparedInput });
  }, [model, preparedInput, treePaths]);

  useEffect(() => {
    model.setGitStatus(gitStatusEntries);
  }, [gitStatusEntries, model]);

  useEffect(() => {
    if (!selectedKey) {
      for (const path of model.getSelectedPaths()) {
        model.getItem(path)?.deselect();
      }
      lastOpenedPathRef.current = null;
      return;
    }
    if (!pathSet.has(selectedKey) || model.getSelectedPaths()[0] === selectedKey) {
      return;
    }
    const selectedItem = model.getItem(selectedKey);
    if (!selectedItem) {
      return;
    }
    suppressSelectionOpenRef.current = selectedKey;
    for (const path of model.getSelectedPaths()) {
      model.getItem(path)?.deselect();
    }
    selectedItem.select();
    model.focusPath(selectedKey);
  }, [pathSet, model, selectedKey]);

  return (
    <section
      className={cn(
        "git-changes-file-tree project-file-tree flex min-h-0 min-h-36 shrink-0 flex-col overflow-hidden bg-multi-bg-quinary text-multi-fg-primary",
        props.className,
      )}
    >
      <div className="multi-workbench-panel-title-row gap-2">
        <span className="min-w-0 shrink-0 truncate text-body/[16px] font-medium text-foreground/85">
          {props.title ?? "Changed files"}
        </span>
        <span className="min-w-0 flex-1" />
        <span className="tabular-nums shrink-0 text-muted-foreground/45 text-detail/[13px]">
          {props.rows.length > 0 ? String(props.rows.length) : ""}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Tree model={model} resolvedTheme={resolvedTheme} />
      </div>
    </section>
  );
}
