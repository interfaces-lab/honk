"use client";

import { prepareFileTreeInput } from "@pierre/trees";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";
import { type MutableRefObject, useMemo, useRef } from "react";

import type { DiffRow } from "~/hooks/use-environment-git";
import type { GitFileState } from "~/lib/ui-session-types";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/use-theme";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { normalizeTreePath, Tree, useTreeModel } from "../../tree";

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
  const treePathsKey = useMemo(() => treePaths.join("\0"), [treePaths]);

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
  const gitStatusKey = useMemo(
    () => gitStatusEntries.map((entry) => `${entry.path}:${entry.status}`).join("\0"),
    [gitStatusEntries],
  );

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
        "git-changes-file-tree project-file-tree flex min-h-0 min-h-36 shrink-0 flex-col overflow-hidden bg-multi-bg-quinary text-multi-fg-primary",
        props.className,
      )}
    >
      <GitChangesTreePathsSync
        key={treePathsKey}
        model={model}
        preparedInput={preparedInput}
        treePaths={treePaths}
      />
      <GitChangesTreeGitStatusSync
        key={gitStatusKey}
        gitStatusEntries={gitStatusEntries}
        model={model}
      />
      <GitChangesTreeSelectionSync
        key={`${treePathsKey}:${selectedKey ?? ""}`}
        lastOpenedPathRef={lastOpenedPathRef}
        model={model}
        pathSet={pathSet}
        selectedKey={selectedKey}
        suppressSelectionOpenRef={suppressSelectionOpenRef}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <Tree model={model} resolvedTheme={resolvedTheme} />
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
  useMountEffect(() => {
    model.resetPaths(treePaths, { preparedInput });
  });

  return null;
}

function GitChangesTreeGitStatusSync({
  gitStatusEntries,
  model,
}: {
  gitStatusEntries: readonly GitStatusEntry[];
  model: GitChangesTreeModel;
}) {
  useMountEffect(() => {
    model.setGitStatus(gitStatusEntries);
  });

  return null;
}

function GitChangesTreeSelectionSync({
  lastOpenedPathRef,
  model,
  pathSet,
  selectedKey,
  suppressSelectionOpenRef,
}: {
  lastOpenedPathRef: MutableRefObject<string | null>;
  model: GitChangesTreeModel;
  pathSet: ReadonlySet<string>;
  selectedKey: string | null;
  suppressSelectionOpenRef: MutableRefObject<string | null>;
}) {
  useMountEffect(() => {
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
  });

  return null;
}
