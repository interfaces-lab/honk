"use client";

import type { EditorId, EnvironmentId } from "@honk/contracts";
import { normalizeSearchQuery } from "@honk/shared/search-ranking";
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
} from "@honk/honkkit/command";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  shellPanelsActions,
  useHasSecondaryRailState,
  useSecondaryRail,
} from "~/stores/shell-panels-store";
import {
  ProjectFileTree,
  openProjectFilePath,
  type ProjectFileTreeHandle,
} from "./project-file-tree";
import { useRightWorkbenchPanelRuntime } from "../shell/app";
import { RightWorkbenchLayout } from "../shell/right-workbench-layout";
import { EmptyFilePreview } from "./empty-file-preview";
import { FileTreeFileIcon, FileTreeIconSprite } from "../../tree";
import {
  projectReadFileQueryOptions,
  projectSearchEntriesQueryOptions,
} from "~/lib/project-react-query";
import {
  useWorkspaceEditorFileState,
  useWorkspaceEditorPreviewPath,
  workspaceEditorActions,
} from "~/stores/workspace-editor-store";
import { workbenchTabPersistenceActions } from "~/stores/workbench-tab-store";
import { markProjectModelClosed } from "~/lib/monaco/project-models";
import {
  ProjectFileEditorShell,
  type ProjectFileEditorShellHandle,
} from "./project-file-editor-shell";
import { ProjectEditorToolbar } from "./project-editor-toolbar";

const MAX_OPEN_FILE_RESULTS = 100;

function filterOpenFilePaths(paths: readonly string[], query: string): string[] {
  const normalizedQuery = normalizeSearchQuery(query);
  const sortedPaths = [...paths].toSorted((left, right) => left.localeCompare(right));
  if (!normalizedQuery) {
    return sortedPaths.slice(0, MAX_OPEN_FILE_RESULTS);
  }

  return sortedPaths
    .filter((path) => normalizeSearchQuery(path).includes(normalizedQuery))
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
  const [loadedFilePaths, setLoadedFilePaths] = useState<readonly string[]>([]);
  const [openFileDialogOpen, setOpenFileDialogOpen] = useState(false);
  const [dirtyByPath, setDirtyByPath] = useState<Record<string, boolean>>({});
  const fileTreeRef = useRef<ProjectFileTreeHandle | null>(null);
  const editorShellRef = useRef<ProjectFileEditorShellHandle | null>(null);
  const queryClient = useQueryClient();
  const runtime = useRightWorkbenchPanelRuntime();
  const isFilesPanelActive = runtime.open && runtime.activeTab === "files";
  const fileRail = useSecondaryRail(props.workspaceKey, "files");
  const fileRailInitialized = useHasSecondaryRailState(props.workspaceKey, "files");
  const fileRailOpen = isFilesPanelActive && (fileRailInitialized ? fileRail.open : true);
  const editorState = useWorkspaceEditorFileState(props.workspaceKey);
  const selectedPath = editorState.activePath;
  const previewPath = useWorkspaceEditorPreviewPath(props.workspaceKey);
  const visiblePath = previewPath ?? selectedPath;
  const centerEditorActive =
    editorState.placement === "center" && selectedPath !== null && previewPath === null;
  const visiblePathDirty = visiblePath ? (dirtyByPath[visiblePath] ?? false) : false;
  const treeActive = fileRailOpen || openFileDialogOpen;
  // The toolbar is a static second nav: it stays above the tree and viewer even
  // with no file open. When the editor lives in the center surface this panel
  // owns no file, so the toolbar's file-specific controls go inert.
  const panelFilePath = centerEditorActive ? null : visiblePath;
  const panelFileDirty = panelFilePath !== null && visiblePathDirty;

  useEffect(() => {
    if (!isFilesPanelActive || fileRailInitialized) {
      return;
    }
    shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", true);
  }, [fileRailInitialized, isFilesPanelActive, props.workspaceKey]);

  const prefetchEditorPath = useCallback(
    (relativePath: string) => {
      if (!props.cwd || !props.environmentId) return;
      void queryClient.prefetchQuery(
        projectReadFileQueryOptions({
          cwd: props.cwd,
          environmentId: props.environmentId,
          relativePath,
        }),
      );
    },
    [props.cwd, props.environmentId, queryClient],
  );

  const previewEditorPath = useCallback(
    (relativePath: string) => {
      prefetchEditorPath(relativePath);
      workbenchTabPersistenceActions.previewFile(props.workspaceKey, relativePath);
    },
    [prefetchEditorPath, props.workspaceKey],
  );

  const openEditorTabPath = useCallback(
    (relativePath: string) => {
      prefetchEditorPath(relativePath);
      workbenchTabPersistenceActions.createFile(props.workspaceKey, relativePath);
    },
    [prefetchEditorPath, props.workspaceKey],
  );

  const navigateEditorHistory = useCallback(
    (delta: -1 | 1) => {
      workspaceEditorActions.navigateFileHistory(props.workspaceKey, delta);
    },
    [props.workspaceKey],
  );

  useEffect(() => {
    fileTreeRef.current?.selectPath(visiblePath);
  }, [visiblePath]);

  const tree = useMemo(
    () => (
      <ProjectFileTree
        key={`${props.environmentId ?? "none"}:${props.cwd ?? "none"}`}
        ref={fileTreeRef}
        cwd={props.cwd}
        workspaceKey={props.workspaceKey}
        environmentId={props.environmentId}
        availableEditors={props.availableEditors}
        onPreviewFile={previewEditorPath}
        onOpenFile={openEditorTabPath}
        onFilePathsChange={setLoadedFilePaths}
        active={treeActive}
        className="min-h-36 flex-1 border-b-0 bg-(--honk-workbench-panel-background)"
      />
    ),
    [
      props.cwd,
      props.workspaceKey,
      props.environmentId,
      props.availableEditors,
      previewEditorPath,
      openEditorTabPath,
      treeActive,
    ],
  );

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      <ProjectEditorToolbar
        workspaceKey={props.workspaceKey}
        cwd={props.cwd}
        relativePath={panelFilePath}
        availableEditors={props.availableEditors}
        fileRailOpen={fileRailOpen}
        dirty={panelFileDirty}
        canGoBack={editorState.canGoBack}
        canGoForward={editorState.canGoForward}
        placement={editorState.placement}
        onToggleFileTree={() => {
          shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", !fileRailOpen);
        }}
        onOpenFile={() => {
          setOpenFileDialogOpen(true);
        }}
        onBack={() => navigateEditorHistory(-1)}
        onForward={() => navigateEditorHistory(1)}
        onSave={() => editorShellRef.current?.save()}
        onClose={() => {
          if (previewPath !== null && panelFilePath === previewPath) {
            if (props.cwd && props.environmentId) {
              markProjectModelClosed({
                environmentId: props.environmentId,
                cwd: props.cwd,
                relativePath: previewPath,
              });
            }
            workbenchTabPersistenceActions.closeTab(props.workspaceKey, runtime.activeTabId);
            return;
          }
          if (panelFilePath && props.cwd && props.environmentId) {
            markProjectModelClosed({
              environmentId: props.environmentId,
              cwd: props.cwd,
              relativePath: panelFilePath,
            });
          }
          workspaceEditorActions.closeEditor(props.workspaceKey);
        }}
        onRevealInFileTree={() => {
          if (!panelFilePath) return;
          shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", true);
          fileTreeRef.current?.revealPath(panelFilePath);
        }}
        onOpenExternalEditor={() => {
          if (!panelFilePath) return;
          openProjectFilePath({
            relativePath: panelFilePath,
            cwd: props.cwd,
            availableEditors: props.availableEditors,
          });
        }}
      />
      <RightWorkbenchLayout
        workspaceKey={props.workspaceKey}
        tab="files"
        railOpen={fileRailOpen}
        rail={tree}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--honk-workbench-editor-surface-background)">
          <div className="flex min-h-0 flex-1 flex-col">
            {selectedPath && centerEditorActive ? (
              <EmptyFilePreview
                label="Return editor to panel"
                onOpenFile={() => {
                  workspaceEditorActions.setEditorPlacement(props.workspaceKey, "right-panel");
                }}
              />
            ) : visiblePath ? (
              <ProjectFileEditorShell
                ref={editorShellRef}
                cwd={props.cwd}
                environmentId={props.environmentId}
                relativePath={visiblePath}
                onDirtyChange={(dirty) => {
                  if (!visiblePath) return;
                  setDirtyByPath((current) => ({ ...current, [visiblePath]: dirty }));
                  if (dirty && previewPath === visiblePath) {
                    openEditorTabPath(visiblePath);
                  }
                }}
                onAddSelectionToChat={() => {
                  workspaceEditorActions.setEditorPlacement(props.workspaceKey, "right-panel");
                }}
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
        onOpenFile={openEditorTabPath}
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
                          className="size-3.5 text-honk-icon-tertiary"
                        />
                        <span className="min-w-0 flex-1 truncate text-body text-honk-fg-primary">
                          {relativePath}
                        </span>
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              </CommandList>
            ) : (
              <div className="py-8 text-center text-body text-muted-foreground">
                {isSearching || (searchQuery.length === 0 && props.filePaths.length === 0)
                  ? "Loading files..."
                  : "No matching files."}
              </div>
            )}
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
