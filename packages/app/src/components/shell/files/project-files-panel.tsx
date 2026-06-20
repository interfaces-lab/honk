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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@honk/honkkit/input-group";
import { WorkbenchIconButton } from "@honk/honkkit/workbench-button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  IconArrowRotateClockwise,
  IconCrossSmall,
  IconFileEdit,
  IconFolderAddRight,
  IconMagnifyingGlass,
} from "central-icons";

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
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
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
  const treeActive = fileRailOpen || openFileDialogOpen || fileSearchOpen;
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

  useEffect(() => {
    if (fileRailOpen || !fileSearchOpen) {
      return;
    }
    setFileSearchOpen(false);
    setFileSearchQuery("");
  }, [fileRailOpen, fileSearchOpen]);

  const openFileRail = () => {
    shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", true);
  };

  const clearFileSearch = () => {
    setFileSearchOpen(false);
    setFileSearchQuery("");
  };

  const toggleFileSearch = () => {
    const nextOpen = !fileSearchOpen;
    if (nextOpen) {
      openFileRail();
    } else {
      setFileSearchQuery("");
    }
    setFileSearchOpen(nextOpen);
  };

  const createProjectFile = () => {
    openFileRail();
    clearFileSearch();
    window.requestAnimationFrame(() => fileTreeRef.current?.createFile());
  };

  const createProjectFolder = () => {
    openFileRail();
    clearFileSearch();
    window.requestAnimationFrame(() => fileTreeRef.current?.createFolder());
  };

  const prefetchEditorPath = (relativePath: string) => {
    if (!props.cwd || !props.environmentId) return;
    void queryClient.prefetchQuery(
      projectReadFileQueryOptions({
        cwd: props.cwd,
        environmentId: props.environmentId,
        relativePath,
      }),
    );
  };

  const previewEditorPath = (relativePath: string) => {
    prefetchEditorPath(relativePath);
    workbenchTabPersistenceActions.previewFile(props.workspaceKey, relativePath);
  };

  const openEditorTabPath = (relativePath: string) => {
    prefetchEditorPath(relativePath);
    workbenchTabPersistenceActions.createFile(props.workspaceKey, relativePath);
  };

  const navigateBreadcrumbPath = (target: { kind: "directory" | "file"; path: string }) => {
    if (target.kind === "file") {
      openEditorTabPath(target.path);
    }
    shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", true);
    fileTreeRef.current?.revealPath(target.kind === "directory" ? `${target.path}/` : target.path);
  };

  const navigateEditorHistory = (delta: -1 | 1) => {
    workspaceEditorActions.navigateFileHistory(props.workspaceKey, delta);
  };

  useEffect(() => {
    fileTreeRef.current?.selectPath(visiblePath);
  }, [visiblePath]);

  const tree = (
    <ProjectFileRailChrome
      canCreate={Boolean(props.cwd && props.environmentId)}
      cwd={props.cwd}
      searchOpen={fileSearchOpen}
      searchQuery={fileSearchQuery}
      onNewFile={createProjectFile}
      onNewFolder={createProjectFolder}
      onRefresh={() => fileTreeRef.current?.refresh()}
      onSearchOpenChange={(open) => {
        setFileSearchOpen(open);
        if (open) {
          openFileRail();
        } else {
          setFileSearchQuery("");
        }
      }}
      onSearchQueryChange={setFileSearchQuery}
    >
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
        searchQuery={fileSearchOpen ? fileSearchQuery : null}
        className="h-full min-h-0 flex-1 border-b-0 bg-(--honk-workbench-panel-background)"
      />
    </ProjectFileRailChrome>
  );

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      <ProjectEditorToolbar
        workspaceKey={props.workspaceKey}
        cwd={props.cwd}
        relativePath={panelFilePath}
        availableEditors={props.availableEditors}
        fileRailOpen={fileRailOpen}
        fileSearchOpen={fileSearchOpen}
        dirty={panelFileDirty}
        canGoBack={editorState.canGoBack}
        canGoForward={editorState.canGoForward}
        placement={editorState.placement}
        onToggleFileTree={() => {
          shellPanelsActions.setSecondaryRailOpen(props.workspaceKey, "files", !fileRailOpen);
        }}
        onToggleFileSearch={toggleFileSearch}
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
        onBreadcrumbNavigate={navigateBreadcrumbPath}
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

function projectLabelFromCwd(cwd: string | null): string {
  if (!cwd) {
    return "Files";
  }
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
}

function ProjectFileRailChrome(props: {
  canCreate: boolean;
  children: ReactNode;
  cwd: string | null;
  searchOpen: boolean;
  searchQuery: string;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onSearchOpenChange: (open: boolean) => void;
  onSearchQueryChange: (query: string) => void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (props.searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [props.searchOpen]);

  const onSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    props.onSearchQueryChange(event.currentTarget.value);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    if (props.searchQuery) {
      props.onSearchQueryChange("");
      return;
    }
    props.onSearchOpenChange(false);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--honk-workbench-panel-background) text-[12px] leading-4 text-honk-fg-secondary">
      <div className="group/file-rail flex h-7 shrink-0 items-center gap-1 px-2">
        <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-honk-fg-tertiary">
          {projectLabelFromCwd(props.cwd)}
        </span>
        <div className="pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 motion-reduce:transition-none group-focus-within/file-rail:pointer-events-auto group-focus-within/file-rail:opacity-100 group-hover/file-rail:pointer-events-auto group-hover/file-rail:opacity-100">
          <WorkbenchIconButton
            aria-label="New file"
            chrome="panel"
            className="size-5 min-h-5 min-w-5 max-h-5 px-0 text-honk-icon-tertiary"
            disabled={!props.canCreate}
            onClick={props.onNewFile}
          >
            <IconFileEdit className="size-3.5 shrink-0" aria-hidden />
          </WorkbenchIconButton>
          <WorkbenchIconButton
            aria-label="New folder"
            chrome="panel"
            className="size-5 min-h-5 min-w-5 max-h-5 px-0 text-honk-icon-tertiary"
            disabled={!props.canCreate}
            onClick={props.onNewFolder}
          >
            <IconFolderAddRight className="size-3.5 shrink-0" aria-hidden />
          </WorkbenchIconButton>
          <WorkbenchIconButton
            aria-label="Refresh files"
            chrome="panel"
            className="size-5 min-h-5 min-w-5 max-h-5 px-0 text-honk-icon-tertiary"
            disabled={!props.cwd}
            onClick={props.onRefresh}
          >
            <IconArrowRotateClockwise className="size-3.5 shrink-0" aria-hidden />
          </WorkbenchIconButton>
        </div>
      </div>
      {props.searchOpen ? (
        <div className="shrink-0 px-2 pb-1">
          <InputGroup
            size="sm"
            className="min-h-6 rounded-[6px] border-honk-stroke-secondary bg-transparent"
          >
            <InputGroupAddon className="px-1.5 pr-1 [&_svg]:size-3.5">
              <IconMagnifyingGlass className="size-3.5 shrink-0" aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchInputRef}
              aria-label="Search files"
              autoComplete="off"
              className="px-0 text-[12px] leading-4"
              data-1p-ignore=""
              data-lpignore="true"
              onChange={onSearchChange}
              onKeyDown={onSearchKeyDown}
              placeholder="Search"
              spellCheck={false}
              type="search"
              value={props.searchQuery}
            />
            {props.searchQuery ? (
              <InputGroupButton
                type="button"
                aria-label="Clear file search"
                className="me-0.5 size-5 shrink-0 rounded-honk-control text-honk-icon-tertiary hover:bg-honk-bg-quaternary hover:text-honk-icon-primary"
                onClick={() => props.onSearchQueryChange("")}
              >
                <IconCrossSmall className="size-3" aria-hidden />
              </InputGroupButton>
            ) : null}
          </InputGroup>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{props.children}</div>
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
  const searchedFilePaths = (projectEntriesQuery.data?.entries ?? [])
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path);
  const filteredFilePaths =
    searchQuery.length > 0
      ? searchedFilePaths
      : filterOpenFilePaths(props.filePaths, deferredQuery);
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
