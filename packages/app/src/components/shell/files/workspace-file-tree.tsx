"use client";

import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import type { EditorId, EnvironmentId, ProjectEntry } from "@multi/contracts";
import { useQuery } from "@tanstack/react-query";
import { IconArrowRotateClockwise } from "central-icons";
import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { toast } from "sonner";

import { resolveAndPersistPreferredEditor } from "~/editor-preferences";
import { useGitStatus } from "~/lib/git-status-state";
import { ensureNativeApi } from "~/lib/native-runtime-api";
import { projectListEntriesQueryOptions } from "~/lib/project-react-query";
import { cn } from "~/lib/utils";

type TreeHostStyle = CSSProperties & Record<`--${string}`, string | number>;

const EMPTY_PROJECT_ENTRIES: readonly ProjectEntry[] = [];

const TREE_HOST_STYLE: TreeHostStyle = {
  colorScheme: "light",
  "--trees-font-family-override": "var(--multi-font-ui)",
  "--trees-font-size-override": "12px",
  "--trees-font-weight-regular-override": 400,
  "--trees-font-weight-semibold-override": 500,
  "--trees-fg-override": "#18181b",
  "--trees-fg-muted-override": "#71717a",
  "--trees-bg-override": "transparent",
  "--trees-bg-muted-override": "#f4f4f5",
  "--trees-input-bg-override": "#ffffff",
  "--trees-search-bg-override": "#ffffff",
  "--trees-search-fg-override": "#18181b",
  "--trees-selected-bg-override": "#e4e4e7",
  "--trees-selected-fg-override": "#18181b",
  "--trees-border-color-override": "transparent",
  "--trees-border-radius-override": "4px",
  "--trees-focus-ring-color-override": "#a1a1aa",
  "--trees-focus-ring-width-override": "1px",
  "--trees-focus-ring-offset-override": "-1px",
  "--trees-indent-guide-bg-override": "#e4e4e7",
  "--trees-scrollbar-thumb-override": "#d4d4d8",
  "--trees-item-margin-x-override": "8px",
  "--trees-item-padding-x-override": "4px",
  "--trees-level-gap-override": "12px",
  "--trees-gap-override": "4px",
  "--trees-icon-width-override": "14px",
  "--trees-git-modified-color-override": "var(--vscode-terminal-ansiBlue)",
  "--trees-git-added-color-override": "var(--cursor-green)",
  "--trees-git-deleted-color-override": "var(--cursor-red)",
  "--trees-git-untracked-color-override": "var(--cursor-orange)",
  "--trees-git-renamed-color-override": "var(--cursor-purple)",
};

const TREE_UNSAFE_CSS = `
  button[data-type='item'] {
    letter-spacing: 0;
  }

  [data-type='search-input'] {
    height: 24px;
    line-height: 16px;
  }
`;

function basename(path: string | null): string {
  if (!path) return "Workspace";
  const clean = path.replace(/[\\/]+$/, "");
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return index === -1 ? clean : clean.slice(index + 1);
}

function toTreePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function joinWorkspacePath(cwd: string, relativePath: string): string {
  const separator = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return `${cwd.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/^[\\/]+/, "")}`;
}

function formatEntryCount(count: number, truncated: boolean): string {
  if (count === 0) return "";
  if (count >= 1000) {
    const rounded = count >= 10_000 ? Math.round(count / 1000) : Math.round(count / 100) / 10;
    return `${rounded}k${truncated ? "+" : ""}`;
  }
  return `${count}${truncated ? "+" : ""}`;
}

function toGitStatusEntries(status: ReturnType<typeof useGitStatus>["data"]): GitStatusEntry[] {
  if (!status?.workingTree.files.length) {
    return [];
  }

  return status.workingTree.files.map((file) => ({
    path: file.path,
    status: "modified",
  }));
}

export function WorkspaceFileTree(props: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
  onOpenFile?: (relativePath: string) => void;
  searchOpen?: boolean;
  selectedPath?: string | null;
  title?: string;
  className?: string;
}) {
  const filePathSetRef = useRef<ReadonlySet<string>>(new Set());
  const availableEditorsRef = useRef(props.availableEditors);
  const cwdRef = useRef(props.cwd);
  const onOpenFileRef = useRef(props.onOpenFile);
  const lastOpenedPathRef = useRef<string | null>(null);
  const suppressSelectionOpenRef = useRef<string | null>(null);

  availableEditorsRef.current = props.availableEditors;
  cwdRef.current = props.cwd;
  onOpenFileRef.current = props.onOpenFile;

  const openPath = useCallback((relativePath: string) => {
    const cwd = cwdRef.current;
    if (!cwd) return;

    const editor = resolveAndPersistPreferredEditor(availableEditorsRef.current);
    if (!editor) {
      toast.error("No available editor found.");
      return;
    }

    const targetPath = joinWorkspacePath(cwd, relativePath);
    try {
      void ensureNativeApi()
        .shell.openInEditor(targetPath, editor)
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error)),
        );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const { model } = useFileTree({
    paths: [],
    density: 0.78,
    itemHeight: 22,
    flattenEmptyDirectories: true,
    fileTreeSearchMode: "collapse-non-matches",
    initialExpansion: 1,
    icons: "complete",
    search: true,
    searchBlurBehavior: "retain",
    unsafeCSS: TREE_UNSAFE_CSS,
    onSelectionChange: (selectedPaths) => {
      const selectedPath = selectedPaths[0] ?? null;
      if (
        !selectedPath ||
        selectedPath === lastOpenedPathRef.current ||
        !filePathSetRef.current.has(selectedPath)
      ) {
        return;
      }
      if (selectedPath === suppressSelectionOpenRef.current) {
        suppressSelectionOpenRef.current = null;
        lastOpenedPathRef.current = selectedPath;
        return;
      }
      lastOpenedPathRef.current = selectedPath;
      const onOpenFile = onOpenFileRef.current;
      if (onOpenFile) {
        onOpenFile(selectedPath);
        return;
      }
      openPath(selectedPath);
    },
  });

  const entriesQuery = useQuery(
    projectListEntriesQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      enabled: Boolean(props.environmentId && props.cwd),
    }),
  );
  const gitStatus = useGitStatus({ environmentId: props.environmentId, cwd: props.cwd });

  const entries = entriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;
  const truncated = entriesQuery.data?.truncated ?? false;
  const treePaths = useMemo(() => entries.map(toTreePath), [entries]);
  const topLevelExpandedPaths = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === "directory" && !entry.path.includes("/"))
        .map((entry) => entry.path),
    [entries],
  );
  const filePathSet = useMemo(
    () => new Set(entries.filter((entry) => entry.kind === "file").map((entry) => entry.path)),
    [entries],
  );
  const gitStatusEntries = useMemo(() => toGitStatusEntries(gitStatus.data), [gitStatus.data]);

  useEffect(() => {
    filePathSetRef.current = filePathSet;
  }, [filePathSet]);

  useEffect(() => {
    model.resetPaths(treePaths, { initialExpandedPaths: topLevelExpandedPaths });
  }, [model, topLevelExpandedPaths, treePaths]);

  useEffect(() => {
    if (!props.selectedPath) {
      for (const selectedPath of model.getSelectedPaths()) {
        model.getItem(selectedPath)?.deselect();
      }
      lastOpenedPathRef.current = null;
      return;
    }
    if (
      !filePathSet.has(props.selectedPath) ||
      model.getSelectedPaths()[0] === props.selectedPath
    ) {
      return;
    }
    const selectedItem = model.getItem(props.selectedPath);
    if (!selectedItem) {
      return;
    }
    suppressSelectionOpenRef.current = props.selectedPath;
    for (const selectedPath of model.getSelectedPaths()) {
      model.getItem(selectedPath)?.deselect();
    }
    selectedItem.select();
    model.focusPath(props.selectedPath);
  }, [filePathSet, model, props.selectedPath]);

  useEffect(() => {
    model.setGitStatus(gitStatusEntries);
  }, [gitStatusEntries, model]);

  useEffect(() => {
    if (props.searchOpen) {
      model.openSearch();
      return;
    }
    model.closeSearch();
  }, [model, props.searchOpen]);

  return (
    <section
      className={cn(
        "workspace-file-tree flex min-h-36 shrink-0 flex-col border-b border-black/10 bg-[#f8f8f8] text-zinc-900",
        props.className,
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        <span className="min-w-0 shrink-0 truncate text-[13px]/[18px] font-medium text-foreground/85">
          {props.title ?? basename(props.cwd)}
        </span>
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 tabular-nums text-muted-foreground/45">
          {formatEntryCount(entries.length, truncated)}
        </span>
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center rounded-multi-control text-muted-foreground/55 hover:bg-multi-hover hover:text-foreground"
          aria-label="Refresh files"
          onClick={() => {
            void entriesQuery.refetch();
          }}
        >
          <IconArrowRotateClockwise
            className={cn("size-3.5", entriesQuery.isFetching && "animate-spin")}
          />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {props.cwd && props.environmentId ? (
          <PierreFileTree
            model={model}
            className="block h-full w-full"
            style={TREE_HOST_STYLE}
            renderContextMenu={(item, context) => (
              <div
                className="min-w-32 rounded-multi-control border border-multi-border/70 bg-multi-bubble-opaque p-1 font-multi text-[12px]/[16px] text-foreground shadow-multi-popup"
                data-file-tree-context-menu-root="true"
              >
                <button
                  type="button"
                  className="flex min-h-6 w-full items-center rounded-sm px-2 text-left text-muted-foreground hover:bg-multi-hover hover:text-foreground"
                  onClick={() => {
                    context.close();
                    openPath(item.path);
                  }}
                >
                  Open in Editor
                </button>
              </div>
            )}
          />
        ) : (
          <div className="px-3 py-2 text-[11px]/[14px] text-muted-foreground/55">
            Open a workspace to browse files.
          </div>
        )}

        {entriesQuery.isError ? (
          <div className="px-3 py-2 text-[11px]/[14px] text-destructive/80">
            Unable to load files.
          </div>
        ) : null}
      </div>
    </section>
  );
}
