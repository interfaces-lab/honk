"use client";

import type { EditorId, EnvironmentId } from "@multi/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "@multi/multikit/command";
import {
  IconBarsThree,
  IconChevronLeftMedium,
  IconChevronRightMedium,
} from "central-icons";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  shellPanelsActions,
  useHasSecondaryRailState,
  useSecondaryRail,
} from "~/stores/shell-panels-store";
import { ProjectFileTree, type ProjectFileTreeHandle } from "./project-file-tree";
import { useRightWorkbenchPanelRuntime } from "../shell/app";
import { RightWorkbenchLayout } from "../shell/right-workbench-layout";
import { EmptyFilePreview } from "./empty-file-preview";
import { ModeButton, NavButton } from "./project-files-panel-buttons";
import { SourcePreview } from "./source-preview";
import { FileTreeFileIcon, FileTreeIconSprite } from "../../tree";
import { projectSearchEntriesQueryOptions } from "~/lib/project-react-query";

type PreviewHistory = {
  readonly index: number;
  readonly paths: readonly string[];
};

const EMPTY_PREVIEW_HISTORY: PreviewHistory = {
  index: -1,
  paths: [],
};
const MAX_PREVIEW_HISTORY = 50;
const MAX_OPEN_FILE_RESULTS = 100;

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

function filterOpenFilePaths(paths: readonly string[], query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
  const sortedPaths = [...paths].toSorted((left, right) => left.localeCompare(right));
  if (!normalizedQuery) {
    return sortedPaths.slice(0, MAX_OPEN_FILE_RESULTS);
  }

  return sortedPaths
    .filter((path) => path.trim().toLowerCase().replace(/\s+/g, " ").includes(normalizedQuery))
    .slice(0, MAX_OPEN_FILE_RESULTS);
}

export function ProjectFilesPanel(props: {
  cwd: string | null;
  workspaceKey: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
}) {
  return <ProjectFilesPanelContent key={props.workspaceKey ?? "none"} {...props} />;
}

function ProjectFilesPanelContent(props: {
  cwd: string | null;
  workspaceKey: string | null;
  environmentId: EnvironmentId | null;
  availableEditors: readonly EditorId[];
}) {
  const [history, setHistory] = useState<PreviewHistory>(EMPTY_PREVIEW_HISTORY);
  const [loadedFilePaths, setLoadedFilePaths] = useState<readonly string[]>([]);
  const [openFileDialogOpen, setOpenFileDialogOpen] = useState(false);
  const fileTreeRef = useRef<ProjectFileTreeHandle | null>(null);
  const runtime = useRightWorkbenchPanelRuntime();
  const isFilesPanelActive = runtime.open && runtime.activeTab === "files";
  const fileRail = useSecondaryRail(props.workspaceKey, "files");
  const fileRailInitialized = useHasSecondaryRailState(props.workspaceKey, "files");
  const fileRailOpen = isFilesPanelActive && (fileRailInitialized ? fileRail.open : true);
  const selectedPath = history.index >= 0 ? (history.paths[history.index] ?? null) : null;
  const canGoBack = history.index > 0;
  const canGoForward = history.index >= 0 && history.index < history.paths.length - 1;

  useEffect(() => {
    if (!isFilesPanelActive || fileRailInitialized) {
      return;
    }
    shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", true);
  }, [fileRailInitialized, isFilesPanelActive, props.workspaceKey]);

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
      onFilePathsChange={setLoadedFilePaths}
      selectedPath={selectedPath}
      active={fileRailOpen || openFileDialogOpen}
      className="min-h-36 flex-1 border-b-0 bg-(--multi-workbench-panel-background)"
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      <div className="multi-workbench-panel-title-row gap-(--multi-workbench-chrome-action-gap)">
        <ModeButton
          active={fileRailOpen}
          chrome="panel"
          label={fileRailOpen ? "Hide file tree" : "Show file tree"}
          onClick={() => {
            shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", !fileRailOpen);
          }}
        >
          <IconBarsThree className="size-[15px]" aria-hidden />
        </ModeButton>
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

      <RightWorkbenchLayout
        workspaceKey={props.workspaceKey}
        tab="files"
        railOpen={fileRailOpen}
        rail={tree}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--multi-workbench-editor-surface-background)">
          <div className="flex min-h-0 flex-1 flex-col">
            {selectedPath ? (
              <SourcePreview
                cwd={props.cwd}
                environmentId={props.environmentId}
                selectedPath={selectedPath}
                wordWrap
              />
            ) : (
              <EmptyFilePreview
                onOpenFile={() => {
                  setOpenFileDialogOpen(true);
                }}
              />
            )}
          </div>
        </div>
      </RightWorkbenchLayout>
      <OpenFileCommandDialog
        cwd={props.cwd}
        environmentId={props.environmentId}
        filePaths={loadedFilePaths}
        open={openFileDialogOpen}
        onOpenChange={setOpenFileDialogOpen}
        onOpenFile={openPreviewPath}
      />
    </div>
  );
}

function OpenFileCommandDialog(props: {
  cwd: string | null;
  environmentId: EnvironmentId | null;
  filePaths: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (relativePath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchQuery = deferredQuery.trim();
  const projectEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      query: searchQuery,
      enabled: props.open && searchQuery.length > 0,
      limit: MAX_OPEN_FILE_RESULTS,
    }),
  );
  const searchedFilePaths = useMemo(
    () =>
      (projectEntriesQuery.data?.entries ?? [])
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.path),
    [projectEntriesQuery.data?.entries],
  );
  const filteredFilePaths = useMemo(
    () =>
      searchQuery.length > 0
        ? searchedFilePaths
        : filterOpenFilePaths(props.filePaths, deferredQuery),
    [deferredQuery, props.filePaths, searchQuery.length, searchedFilePaths],
  );
  const isSearching = searchQuery.length > 0 && projectEntriesQuery.isFetching;

  useEffect(() => {
    if (!props.open) {
      setQuery("");
    }
  }, [props.open]);

  function openFile(relativePath: string): void {
    props.onOpenChange(false);
    props.onOpenFile(relativePath);
  }

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup
        aria-label="Open file"
        className="max-h-[min(23rem,calc(100vh-2rem))] overflow-hidden p-0 transition-none! duration-0!"
      >
        <FileTreeIconSprite />
        <Command
          aria-label="Open file"
          autoHighlight="always"
          mode="none"
          onValueChange={setQuery}
          value={query}
        >
          <CommandInput placeholder="Search files..." />
          <CommandPanel className="max-h-[min(21rem,64vh)]">
            {filteredFilePaths.length > 0 ? (
              <CommandList>
                <CommandGroup items={filteredFilePaths} key="files">
                  <CommandGroupLabel>Files</CommandGroupLabel>
                  <CommandCollection>
                    {(relativePath) => (
                      <CommandItem
                        className="min-h-6 cursor-pointer gap-1.5 px-2 py-0.5"
                        key={relativePath}
                        value={relativePath}
                        onMouseDown={(event) => {
                          event.preventDefault();
                        }}
                        onClick={() => {
                          openFile(relativePath);
                        }}
                      >
                        <FileTreeFileIcon
                          path={relativePath}
                          className="size-3.5 text-multi-icon-tertiary"
                        />
                        <span className="min-w-0 flex-1 truncate text-body text-multi-fg-primary">
                          {relativePath}
                        </span>
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              </CommandList>
            ) : (
              <div className="py-8 text-center text-body text-muted-foreground">
                {isSearching || (searchQuery.length === 0 && props.filePaths.length === 0) ? (
                  "Loading files..."
                ) : (
                  "No matching files."
                )}
              </div>
            )}
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
