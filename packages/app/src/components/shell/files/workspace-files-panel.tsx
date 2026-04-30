"use client";

import type { EditorId, EnvironmentId } from "@multi/contracts";
import type { FileContents } from "@pierre/diffs";
import { File, type FileOptions } from "@pierre/diffs/react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBarsThree,
  IconFileBend,
  IconLinebreak,
  IconMagnifyingGlass,
} from "central-icons";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { projectReadFileQueryOptions } from "~/lib/project-react-query";
import { cn } from "~/lib/utils";
import { VsFileIcon } from "~/lib/vscode-file-icon";
import { WorkspaceFileTree } from "./workspace-file-tree";

type FilePaneMode = "browse" | "search";
type PreviewHistory = {
  readonly index: number;
  readonly paths: readonly string[];
};

const EMPTY_PREVIEW_HISTORY: PreviewHistory = {
  index: -1,
  paths: [],
};
const MAX_PREVIEW_HISTORY = 50;
const PIERRE_FILE_UNSAFE_CSS = `
  [data-file-wrapper] {
    --diffs-code-background: #ffffff;
    --diffs-code-font-size: 12px;
    --diffs-code-line-height: 18px;
  }

  [data-line] {
    min-height: 18px;
  }

  [data-line]:hover {
    background: rgb(0 0 0 / 0.035);
  }
`;

function pushPreviewHistory(current: PreviewHistory, relativePath: string): PreviewHistory {
  if (current.paths[current.index] === relativePath) {
    return current;
  }
  const nextPaths = [...current.paths.slice(0, current.index + 1), relativePath];
  const trimmedPaths = nextPaths.slice(-MAX_PREVIEW_HISTORY);
  return {
    index: trimmedPaths.length - 1,
    paths: trimmedPaths,
  };
}

function removePreviewHistoryPath(
  current: PreviewHistory,
  relativePath: string,
  fallbackPath: string | null,
): PreviewHistory {
  const nextHistoryPaths = current.paths.filter((path) => path !== relativePath);
  if (fallbackPath === null && nextHistoryPaths.length === 0) {
    return EMPTY_PREVIEW_HISTORY;
  }
  if (fallbackPath !== null) {
    return pushPreviewHistory(
      {
        index: nextHistoryPaths.length - 1,
        paths: nextHistoryPaths,
      },
      fallbackPath,
    );
  }
  if (nextHistoryPaths.length === current.paths.length) {
    return current;
  }
  const activePath = current.paths[current.index];
  const activeIndex = activePath ? nextHistoryPaths.indexOf(activePath) : -1;
  return {
    index: activeIndex >= 0 ? activeIndex : Math.min(current.index, nextHistoryPaths.length - 1),
    paths: nextHistoryPaths,
  };
}

function ModeButton(props: {
  active?: boolean;
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
      onClick={props.onClick}
      className={cn(
        "flex size-6 items-center justify-center rounded-multi-control text-muted-foreground/70 transition-colors hover:bg-multi-hover hover:text-foreground [&_svg]:block",
        props.active && "bg-multi-active/60 text-foreground",
      )}
    >
      {props.children}
    </button>
  );
}

function NavButton(props: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex size-6 items-center justify-center rounded-multi-control text-muted-foreground/65 transition-colors hover:bg-multi-hover hover:text-foreground disabled:text-muted-foreground/25 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/25 [&_svg]:block"
    >
      {props.children}
    </button>
  );
}

function basename(path: string): string {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex < 0 ? path : path.slice(slashIndex + 1);
}

function EmptyFilePreview(props: { onOpenFile: () => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-4 py-8 text-center">
      <button
        type="button"
        onClick={props.onOpenFile}
        className="flex h-7 items-center gap-1.5 rounded-multi-control border border-multi-border/60 bg-multi-active/35 px-2.5 text-[12px]/[16px] font-medium text-foreground/80 hover:bg-multi-hover hover:text-foreground"
      >
        <IconFileBend className="size-3.5" />
        Open File
      </button>
    </div>
  );
}

function PreviewTabs(props: {
  activePath: string | null;
  openPaths: readonly string[];
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}) {
  if (props.openPaths.length === 0) {
    return null;
  }

  return (
    <div className="group/tabbar flex h-9 shrink-0 items-center gap-1 border-b border-black/10 bg-white px-2 pt-1">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {props.openPaths.map((path) => {
          const isActive = path === props.activePath;
          return (
            <div
              key={path}
              className={cn(
                "group relative isolate flex h-7 max-w-[200px] items-center overflow-hidden rounded-sm text-xs font-medium transition-colors",
                isActive
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-transparent text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900",
              )}
            >
              <button
                type="button"
                aria-current={isActive ? "page" : undefined}
                title={path}
                onClick={() => props.onActivate(path)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left"
              >
                <VsFileIcon path={path} className="size-3.5" />
                <span className="min-w-0 truncate">{basename(path)}</span>
              </button>
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l to-transparent opacity-0 transition-opacity group-hover:opacity-100",
                  isActive ? "from-zinc-100 via-zinc-100" : "from-zinc-200 via-zinc-200",
                )}
              />
              <button
                type="button"
                aria-label={`Close ${basename(path)}`}
                title={`Close ${basename(path)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClose(path);
                }}
                className={cn(
                  "absolute right-1 z-10 flex size-4 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100",
                  isActive
                    ? "bg-zinc-200 text-zinc-500 hover:text-zinc-900"
                    : "bg-zinc-100 text-zinc-500 hover:text-zinc-900",
                )}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourcePreview(props: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  selectedPath: string | null;
  wordWrap: boolean;
}) {
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: props.cwd,
      environmentId: props.environmentId,
      relativePath: props.selectedPath,
      enabled: Boolean(props.cwd && props.environmentId && props.selectedPath),
    }),
  );
  const fileOptions = useMemo<FileOptions<undefined>>(
    () => ({
      disableFileHeader: true,
      enableLineSelection: true,
      overflow: props.wordWrap ? "wrap" : "scroll",
      preferredHighlighter: "shiki-js",
      theme: "pierre-light",
      themeType: "light",
      unsafeCSS: PIERRE_FILE_UNSAFE_CSS,
    }),
    [props.wordWrap],
  );
  const fileContents = useMemo<FileContents | undefined>(() => {
    if (!fileQuery.data) {
      return undefined;
    }
    return {
      name: fileQuery.data.relativePath,
      contents: fileQuery.data.contents,
      lang: fileQuery.data.syntax.languageId as NonNullable<FileContents["lang"]>,
      cacheKey: `${fileQuery.data.relativePath}:${fileQuery.data.sizeBytes}:${fileQuery.data.contents.length}`,
    };
  }, [fileQuery.data]);

  if (!props.selectedPath) {
    return <EmptyFilePreview onOpenFile={() => undefined} />;
  }

  if (fileQuery.isPending) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="space-y-2 bg-white p-3">
          <div className="h-3 w-11/12 animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-3 w-7/12 animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-3 w-10/12 animate-pulse rounded bg-muted-foreground/10" />
        </div>
      </div>
    );
  }

  if (fileQuery.isError || !fileQuery.data) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
        <div className="text-[12px]/[16px] font-medium text-destructive/85">
          Unable to preview file
        </div>
        <div className="max-w-72 text-[11px]/[14px] text-muted-foreground/55">
          {fileQuery.error instanceof Error
            ? fileQuery.error.message
            : "The file could not be read."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {fileQuery.data.truncated ? (
        <div className="shrink-0 border-b border-multi-border/30 px-3 py-1.5 text-[11px]/[14px] text-muted-foreground/60">
          Showing the first 1 MB of this file.
        </div>
      ) : null}
      {fileContents ? (
        <div className="workspace-file-preview min-h-0 flex-1 overflow-hidden bg-white text-[12px]/[18px] text-zinc-900">
          <File
            key={`${fileQuery.data.relativePath}:${props.wordWrap ? "wrap" : "scroll"}`}
            file={fileContents}
            options={fileOptions}
            className="workspace-file-preview-code min-h-0 h-full overflow-auto"
          />
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceFilesPanel(props: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
}) {
  const [mode, setMode] = useState<FilePaneMode>("browse");
  const [wordWrap, setWordWrap] = useState(true);
  const [openPaths, setOpenPaths] = useState<readonly string[]>([]);
  const [history, setHistory] = useState<PreviewHistory>(EMPTY_PREVIEW_HISTORY);
  const selectedPath = history.index >= 0 ? (history.paths[history.index] ?? null) : null;
  const canGoBack = history.index > 0;
  const canGoForward = history.index >= 0 && history.index < history.paths.length - 1;

  const activatePreviewPath = useCallback((relativePath: string) => {
    setHistory((current) => pushPreviewHistory(current, relativePath));
  }, []);

  const openPreviewPath = useCallback(
    (relativePath: string) => {
      setOpenPaths((current) => {
        if (current.includes(relativePath)) {
          return current;
        }
        return [...current, relativePath];
      });
      activatePreviewPath(relativePath);
    },
    [activatePreviewPath],
  );

  const closePreviewPath = useCallback(
    (relativePath: string) => {
      setOpenPaths((current) => {
        const closedIndex = current.indexOf(relativePath);
        if (closedIndex < 0) {
          return current;
        }
        const nextPaths = current.filter((path) => path !== relativePath);
        if (selectedPath === relativePath) {
          const nextActivePath = nextPaths[Math.max(0, closedIndex - 1)] ?? nextPaths[0] ?? null;
          setHistory((current) => removePreviewHistoryPath(current, relativePath, nextActivePath));
        } else {
          setHistory((current) => removePreviewHistoryPath(current, relativePath, null));
        }
        return nextPaths;
      });
    },
    [selectedPath],
  );

  const navigatePreviewHistory = useCallback((delta: -1 | 1) => {
    setHistory((current) => {
      const nextIndex = current.index + delta;
      if (nextIndex < 0 || nextIndex >= current.paths.length) {
        return current;
      }
      return {
        ...current,
        index: nextIndex,
      };
    });
  }, []);

  useEffect(() => {
    setHistory(EMPTY_PREVIEW_HISTORY);
    setOpenPaths([]);
  }, [props.cwd, props.environmentId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-multi-border/35 px-2">
        <ModeButton
          active={mode === "browse"}
          label="Browse Files"
          onClick={() => setMode("browse")}
        >
          <IconBarsThree className="size-3.5" />
        </ModeButton>
        <ModeButton
          active={mode === "search"}
          label="Search Files"
          onClick={() => setMode("search")}
        >
          <IconMagnifyingGlass className="size-3.5" />
        </ModeButton>
        <NavButton disabled={!canGoBack} label="Back" onClick={() => navigatePreviewHistory(-1)}>
          <IconArrowLeft className="size-3.5" />
        </NavButton>
        <NavButton
          disabled={!canGoForward}
          label="Forward"
          onClick={() => navigatePreviewHistory(1)}
        >
          <IconArrowRight className="size-3.5" />
        </NavButton>
        <div className="min-w-0 flex-1" />
        <ModeButton
          active={wordWrap}
          label={wordWrap ? "Disable Word Wrap" : "Enable Word Wrap"}
          onClick={() => setWordWrap((current) => !current)}
        >
          <IconLinebreak className="size-3.5" />
        </ModeButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <WorkspaceFileTree
          cwd={props.cwd}
          environmentId={props.environmentId}
          availableEditors={props.availableEditors}
          onOpenFile={openPreviewPath}
          searchOpen={mode === "search"}
          selectedPath={selectedPath}
          className="min-h-0 w-[220px] shrink-0 border-r border-b-0 border-multi-border/35"
        />
        {selectedPath ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
            <PreviewTabs
              activePath={selectedPath}
              openPaths={openPaths}
              onActivate={activatePreviewPath}
              onClose={closePreviewPath}
            />
            <SourcePreview
              cwd={props.cwd}
              environmentId={props.environmentId}
              selectedPath={selectedPath}
              wordWrap={wordWrap}
            />
          </div>
        ) : (
          <EmptyFilePreview onOpenFile={() => setMode("search")} />
        )}
      </div>
    </div>
  );
}
