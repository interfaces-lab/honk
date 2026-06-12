"use client";

import { prepareFileTreeInput } from "@pierre/trees";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";
import { normalizePathSeparators as normalizeTreePath } from "@honk/shared/paths";
import { type RefObject, useEffect, useMemo, useRef } from "react";

import type { DiffRow } from "~/hooks/use-environment-git";
import type { GitFileState } from "~/lib/ui-session-types";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/use-theme";
import { Tree, useTreeModel } from "../../tree";

type GitChangesTreeModel = ReturnType<typeof useTreeModel>["model"];
type GitChangesPreparedInput = ReturnType<typeof prepareFileTreeInput>;

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
  active?: boolean;
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
    const rowsByPath = new Map<string, DiffRow>();
    for (const row of sortedRows) {
      rowsByPath.set(normalizeTreePath(row.path), row);
    }
    return rowsByPath;
  }, [sortedRows]);
  const gitStatusEntries = useMemo(() => diffRowsToGitStatusEntries(sortedRows), [sortedRows]);
  const isActive = props.active !== false;

  const selectedPath =
    props.selectedId !== null
      ? (sortedRows.find((row) => row.id === props.selectedId)?.path ?? null)
      : null;
  const selectedKey = selectedPath !== null ? normalizeTreePath(selectedPath) : null;

  const { model } = useTreeModel({
    paths: treePaths,
    preparedInput,
    gitStatus: gitStatusEntries,
    initialExpansion: "open",
    initialSelectedPaths: selectedKey !== null && pathSet.has(selectedKey) ? [selectedKey] : [],
    search: false,
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

  filePathSetRef.current = pathSet;
  pathToRowRef.current = pathToRow;

  return (
    <section
      className={cn(
        "git-changes-file-tree project-file-tree flex min-h-0 min-h-36 shrink-0 flex-col overflow-hidden bg-(--honk-workbench-panel-background) text-honk-fg-primary",
        props.className,
      )}
    >
      <GitChangesTreePathsSync model={model} preparedInput={preparedInput} treePaths={treePaths} />
      <GitChangesTreeGitStatusSync gitStatusEntries={gitStatusEntries} model={model} />
      <GitChangesTreeSelectionSync
        lastOpenedPathRef={lastOpenedPathRef}
        model={model}
        pathSet={pathSet}
        selectedKey={selectedKey}
        suppressSelectionOpenRef={suppressSelectionOpenRef}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {isActive ? <Tree model={model} resolvedTheme={resolvedTheme} /> : null}
      </div>
    </section>
  );
}

function GitChangesTreePathsSync({
  model,
  preparedInput,
  treePaths,
}: {
  model: GitChangesTreeModel;
  preparedInput: GitChangesPreparedInput;
  treePaths: readonly string[];
}) {
  useEffect(() => {
    model.resetPaths(treePaths, { preparedInput });
  }, [model, preparedInput, treePaths]);

  return null;
}

function GitChangesTreeGitStatusSync({
  gitStatusEntries,
  model,
}: {
  gitStatusEntries: readonly GitStatusEntry[];
  model: GitChangesTreeModel;
}) {
  useEffect(() => {
    model.setGitStatus(gitStatusEntries);
  }, [gitStatusEntries, model]);

  return null;
}

function GitChangesTreeSelectionSync({
  lastOpenedPathRef,
  model,
  pathSet,
  selectedKey,
  suppressSelectionOpenRef,
}: {
  lastOpenedPathRef: RefObject<string | null>;
  model: GitChangesTreeModel;
  pathSet: ReadonlySet<string>;
  selectedKey: string | null;
  suppressSelectionOpenRef: RefObject<string | null>;
}) {
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
  }, [lastOpenedPathRef, model, pathSet, selectedKey, suppressSelectionOpenRef]);

  return null;
}
