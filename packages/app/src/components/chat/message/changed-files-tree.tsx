import { type TurnId } from "@multi/contracts";
import { prepareFileTreeInput } from "@pierre/trees";
import type { FileTreeRowDecoration, FileTreeRowDecorationRenderer } from "@pierre/trees";
import { memo, useEffect, useMemo, useRef } from "react";

import { type TurnDiffFileChange } from "../../../types";
import { normalizeTreePath, Tree, useTreeModel } from "../../tree";

function readFileStatDecoration(file: TurnDiffFileChange): FileTreeRowDecoration | null {
  if (typeof file.additions !== "number" || typeof file.deletions !== "number") {
    return null;
  }
  if (file.additions === 0 && file.deletions === 0) {
    return null;
  }
  const text = `+${file.additions}/-${file.deletions}`;
  return { text, title: text };
}

function getEstimatedTreeHeight(fileCount: number): number {
  return Math.min(Math.max(fileCount * 22, 28), 320);
}

function collectDirectoryPaths(paths: readonly string[]): string[] {
  const directoryPaths = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/").filter((segment) => segment.length > 0);
    for (let index = 1; index < segments.length; index += 1) {
      directoryPaths.add(segments.slice(0, index).join("/"));
    }
  }
  return [...directoryPaths];
}

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const { files, allDirectoriesExpanded, onOpenTurnDiff, resolvedTheme, turnId } = props;
  const filePathSetRef = useRef<ReadonlySet<string>>(new Set());
  const onOpenTurnDiffRef = useRef(onOpenTurnDiff);
  const rowDecorationsByPathRef = useRef<ReadonlyMap<string, FileTreeRowDecoration>>(new Map());
  const turnIdRef = useRef(turnId);
  const lastOpenedPathRef = useRef<string | null>(null);

  onOpenTurnDiffRef.current = onOpenTurnDiff;
  turnIdRef.current = turnId;

  const treePaths = useMemo(
    () => files.map((file) => normalizeTreePath(file.path)).filter((path) => path.length > 0),
    [files],
  );

  const preparedInput = useMemo(() => prepareFileTreeInput(treePaths), [treePaths]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(treePaths), [treePaths]);
  const filePathSet = useMemo(() => new Set(treePaths), [treePaths]);
  const rowDecorationsByPath = useMemo(() => {
    const decorations = new Map<string, FileTreeRowDecoration>();
    for (const file of files) {
      const path = normalizeTreePath(file.path);
      const decoration = readFileStatDecoration(file);
      if (decoration) {
        decorations.set(path, decoration);
      }
    }
    return decorations;
  }, [files]);
  const renderRowDecoration = useMemo<FileTreeRowDecorationRenderer>(
    () =>
      ({ row }) =>
        row.kind === "file" ? (rowDecorationsByPathRef.current.get(row.path) ?? null) : null,
    [],
  );

  const { model } = useTreeModel({
    paths: [],
    initialExpansion: allDirectoriesExpanded ? "open" : "closed",
    renderRowDecoration,
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths[0] ?? null;
      if (!path || path === lastOpenedPathRef.current || !filePathSetRef.current.has(path)) {
        return;
      }
      lastOpenedPathRef.current = path;
      onOpenTurnDiffRef.current(turnIdRef.current, path);
    },
  });

  useEffect(() => {
    filePathSetRef.current = filePathSet;
  }, [filePathSet]);

  useEffect(() => {
    rowDecorationsByPathRef.current = rowDecorationsByPath;
  }, [rowDecorationsByPath]);

  useEffect(() => {
    lastOpenedPathRef.current = null;
  }, [turnId, treePaths]);

  useEffect(() => {
    model.resetPaths(treePaths, {
      preparedInput,
      initialExpandedPaths: allDirectoriesExpanded ? directoryPaths : [],
    });
  }, [allDirectoriesExpanded, directoryPaths, model, preparedInput, treePaths]);

  return (
    <div
      className="min-h-0 overflow-hidden"
      style={{ height: getEstimatedTreeHeight(treePaths.length) }}
    >
      <Tree model={model} resolvedTheme={resolvedTheme} />
    </div>
  );
});
