"use client";

import type { EditorId, EnvironmentId } from "@multi/contracts";
import type { FileContents } from "@pierre/diffs";
import { File, type FileOptions } from "@pierre/diffs/react";
import {
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconBarsThree,
  IconFiles,
} from "central-icons";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { formatProjectErrorDescription } from "~/lib/project-error-description";
import { projectReadFileQueryOptions } from "~/lib/project-react-query";
import { resolveDiffThemeName, WORKBENCH_CODE_UNSAFE_CSS } from "~/lib/diff-rendering";
import { useTheme } from "~/hooks/use-theme";
import { shellPanelsActions, useActiveTab, useSecondaryRail } from "~/stores/shell-panels-store";
import { ProjectFileTree, type ProjectFileTreeHandle } from "./project-file-tree";
import { WorkbenchIconButton } from "../shell/workbench-icon-button";
import { RightWorkbenchLayout } from "../shell/right-workbench-layout";

type PreviewHistory = {
  readonly index: number;
  readonly paths: readonly string[];
};

const EMPTY_PREVIEW_HISTORY: PreviewHistory = {
  index: -1,
  paths: [],
};
const MAX_PREVIEW_HISTORY = 50;
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

function ModeButton(props: {
  active?: boolean;
  label: string;
  onClick?: () => void;
  children: ReactNode;
  chrome?: "tool" | "sub" | "panel";
}) {
  return (
    <WorkbenchIconButton
      aria-label={props.label}
      {...(props.active === undefined
        ? {}
        : { active: props.active, "aria-pressed": props.active })}
      {...(props.chrome === undefined ? {} : { chrome: props.chrome })}
      {...(props.onClick === undefined ? {} : { onClick: props.onClick })}
    >
      {props.children}
    </WorkbenchIconButton>
  );
}

function NavButton(props: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  chrome?: "tool" | "sub" | "panel";
}) {
  return (
    <WorkbenchIconButton
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      {...(props.chrome === undefined ? {} : { chrome: props.chrome })}
    >
      {props.children}
    </WorkbenchIconButton>
  );
}

function EmptyFilePreview(props: { onOpenFile: () => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-4 py-8 text-center">
      <button
        type="button"
        onClick={props.onOpenFile}
        className="flex h-7 items-center gap-1.5 rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary px-2.5 text-body font-medium text-multi-fg-primary hover:bg-multi-bg-quaternary"
      >
        <IconFiles className="size-4" />
        Open File
      </button>
    </div>
  );
}

function SourcePreview(props: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  selectedPath: string | null;
  wordWrap: boolean;
  active: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: props.cwd,
      environmentId: props.environmentId,
      relativePath: props.selectedPath,
      enabled: props.active && Boolean(props.cwd && props.environmentId && props.selectedPath),
    }),
  );
  const fileOptions = useMemo<FileOptions<undefined>>(
    () => ({
      disableFileHeader: true,
      enableLineSelection: true,
      overflow: props.wordWrap ? "wrap" : "scroll",
      preferredHighlighter: "shiki-js",
      theme: resolveDiffThemeName(resolvedTheme),
      themeType: resolvedTheme,
      unsafeCSS: WORKBENCH_CODE_UNSAFE_CSS,
    }),
    [props.wordWrap, resolvedTheme],
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
        <div className="space-y-2 bg-background p-3">
          <div className="h-3 w-11/12 animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-3 w-7/12 animate-pulse rounded bg-muted-foreground/10" />
          <div className="h-3 w-10/12 animate-pulse rounded bg-muted-foreground/10" />
        </div>
      </div>
    );
  }

  if (fileQuery.isError || !fileQuery.data) {
    const errorDescription = formatProjectErrorDescription(
      fileQuery.error,
      "The file could not be read.",
    );
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
        <div className="text-body font-medium text-destructive/85">Unable to preview file</div>
        <div className="max-w-72 whitespace-pre-wrap text-detail text-muted-foreground/55">
          {errorDescription}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {fileQuery.data.truncated ? (
        <div className="shrink-0 border-b border-multi-border/30 px-3 py-1.5 text-detail text-muted-foreground/60">
          Showing the first 1 MB of this file.
        </div>
      ) : null}
      {fileContents ? (
        <div className="project-file-preview min-h-0 flex-1 overflow-hidden bg-background text-body text-foreground">
          <File
            key={`${fileQuery.data.relativePath}:${props.wordWrap ? "wrap" : "scroll"}:${resolvedTheme}`}
            file={fileContents}
            options={fileOptions}
            className="project-file-preview-code min-h-0 h-full overflow-auto"
          />
        </div>
      ) : null}
    </div>
  );
}

export function ProjectFilesPanel(props: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
}) {
  return (
    <ProjectFilesPanelContent
      key={`${props.environmentId ?? "none"}:${props.cwd ?? "none"}`}
      {...props}
    />
  );
}

function ProjectFilesPanelContent(props: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
}) {
  const [history, setHistory] = useState<PreviewHistory>(EMPTY_PREVIEW_HISTORY);
  const fileTreeRef = useRef<ProjectFileTreeHandle | null>(null);
  const activeTab = useActiveTab();
  const { open: fileRailOpen } = useSecondaryRail(props.cwd, "files");
  const isFilesPanelActive = activeTab === "files";
  const isFileTreeActive = isFilesPanelActive && fileRailOpen;
  const selectedPath = history.index >= 0 ? (history.paths[history.index] ?? null) : null;
  const canGoBack = history.index > 0;
  const canGoForward = history.index >= 0 && history.index < history.paths.length - 1;

  const openPreviewPath = useCallback((relativePath: string) => {
    setHistory((current) => pushPreviewHistory(current, relativePath));
  }, []);

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

  const tree = (
    <ProjectFileTree
      ref={fileTreeRef}
      cwd={props.cwd}
      environmentId={props.environmentId}
      availableEditors={props.availableEditors}
      onOpenFile={openPreviewPath}
      selectedPath={selectedPath}
      active={isFileTreeActive}
      className="min-h-36 flex-1 border-b-0 bg-[color-mix(in_srgb,var(--multi-bg-elevated)_78%,transparent)]"
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      <div className="multi-workbench-panel-title-row gap-(--multi-workbench-chrome-action-gap)">
        <ModeButton
          active={fileRailOpen}
          chrome="panel"
          label={fileRailOpen ? "Hide file sidebar" : "Browse Files"}
          onClick={() => {
            if (fileRailOpen) {
              shellPanelsActions.setSecondaryRailOpen(props.cwd, "files", false);
              return;
            }
            shellPanelsActions.setSecondaryRailOpen(props.cwd, "files", true);
          }}
        >
          <IconBarsThree className="size-[15px]" aria-hidden />
        </ModeButton>
        <WorkbenchIconButton
          aria-label="Refresh files"
          chrome="panel"
          onClick={() => fileTreeRef.current?.refresh()}
        >
          <IconChevronRightMedium className="size-4" />
        </WorkbenchIconButton>
        <NavButton
          disabled={!canGoBack}
          chrome="panel"
          label="Back"
          onClick={() => navigatePreviewHistory(-1)}
        >
          <IconChevronLeftMedium className="size-4" />
        </NavButton>
        <NavButton
          chrome="panel"
          disabled={!canGoForward}
          label="Forward"
          onClick={() => navigatePreviewHistory(1)}
        >
          <IconChevronRightMedium className="size-4" />
        </NavButton>
        <div className="min-w-0 flex-1" />
      </div>

      <RightWorkbenchLayout cwd={props.cwd} tab="files" rail={tree}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--multi-workbench-editor-surface-background)">
          <div className="flex min-h-0 flex-1 flex-col">
            {selectedPath ? (
              <SourcePreview
                cwd={props.cwd}
                environmentId={props.environmentId}
                selectedPath={selectedPath}
                wordWrap
                active={isFilesPanelActive}
              />
            ) : (
              <EmptyFilePreview
                onOpenFile={() => {
                  shellPanelsActions.setSecondaryRailOpen(props.cwd, "files", true);
                }}
              />
            )}
          </div>
        </div>
      </RightWorkbenchLayout>
    </div>
  );
}
