"use client";

import type { EditorId, EnvironmentId } from "@multi/contracts";
import {
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconBarsThree,
} from "central-icons";
import { useRef, useState } from "react";

import { shellPanelsActions, useSecondaryRail } from "~/stores/shell-panels-store";
import { ProjectFileTree, type ProjectFileTreeHandle } from "./project-file-tree";
import { WorkbenchIconButton } from "@multi/ui/workbench-button";
import { useRightWorkbenchPanelRuntime } from "../shell/app";
import { RightWorkbenchLayout } from "../shell/right-workbench-layout";
import { EmptyFilePreview } from "./empty-file-preview";
import { ModeButton, NavButton } from "./project-files-panel-buttons";
import { SourcePreview } from "./source-preview";

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
  const runtime = useRightWorkbenchPanelRuntime();
  const { open: fileRailOpen } = useSecondaryRail(props.cwd, "files");
  const isFilesPanelActive = runtime.open && runtime.activeTab === "files";
  const selectedPath = history.index >= 0 ? (history.paths[history.index] ?? null) : null;
  const canGoBack = history.index > 0;
  const canGoForward = history.index >= 0 && history.index < history.paths.length - 1;

  const openPreviewPath = (relativePath: string) => {
    setHistory((current) => pushPreviewHistory(current, relativePath));
  };

  const navigatePreviewHistory = (delta: -1 | 1) => {
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
  };

  const tree = (
    <ProjectFileTree
      ref={fileTreeRef}
      cwd={props.cwd}
      environmentId={props.environmentId}
      availableEditors={props.availableEditors}
      onOpenFile={openPreviewPath}
      selectedPath={selectedPath}
      active={isFilesPanelActive}
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
