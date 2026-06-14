"use client";

import {
  type ContextMenuItem,
  type ContextMenuOpenContext,
  prepareFileTreeInput,
  type FileTreeDirectoryHandle,
  type FileTreeItemHandle,
} from "@pierre/trees";
import type { EditorId, EnvironmentId, ProjectEntry } from "@honk/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@honk/honkkit/alert-dialog";
import { Button } from "@honk/honkkit/button";
import { normalizePathSeparators as normalizeTreePath } from "@honk/shared/paths";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  type CSSProperties,
  type Dispatch,
  forwardRef,
  type RefObject,
  type SetStateAction,
  useImperativeHandle,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { resolveAndPersistPreferredEditor } from "~/editor-preferences";
import { isElectronHost } from "~/env";
import { ensureLocalApi } from "~/local-api";
import { formatProjectErrorDescription } from "~/lib/project-error-description";
import {
  deleteProjectFile,
  invalidateProjectEntries,
  invalidateProjectFile,
  projectListDirectoryQueryOptions,
} from "~/lib/project-react-query";
import { markProjectModelClosed } from "~/lib/monaco/project-models";
import { cn } from "~/lib/utils";
import { useEnvironmentApiReady } from "~/hooks/use-environment-api-ready";
import { useTheme } from "~/hooks/use-theme";
import { workspaceEditorActions } from "~/stores/workspace-editor-store";
import { Tree, useTreeModel } from "../../tree";
import { resolveFileTreeContextMenuPosition } from "./project-file-tree-context-menu-position";

const DIRECTORY_PLACEHOLDER_FILE_NAME = "Loading...";
type ProjectTreeModel = ReturnType<typeof useTreeModel>["model"];

function projectEntryToTreePath(entry: ProjectEntry): string {
  const p = normalizeTreePath(entry.path);
  return entry.kind === "directory" ? `${p}/` : p;
}

function treeDirectoryPathToRelativeDir(path: string): string {
  return normalizeTreePath(path).replace(/\/+$/g, "");
}

function directoryPlaceholderPath(relativeDir: string): string {
  const normalizedDir = treeDirectoryPathToRelativeDir(relativeDir);
  return normalizedDir
    ? `${normalizedDir}/${DIRECTORY_PLACEHOLDER_FILE_NAME}`
    : DIRECTORY_PLACEHOLDER_FILE_NAME;
}

function isDirectoryPlaceholderPath(path: string): boolean {
  const normalizedPath = normalizeTreePath(path);
  return (
    normalizedPath === DIRECTORY_PLACEHOLDER_FILE_NAME ||
    normalizedPath.endsWith(`/${DIRECTORY_PLACEHOLDER_FILE_NAME}`)
  );
}

function isDirectoryHandle(item: FileTreeItemHandle | null): item is FileTreeDirectoryHandle {
  return item?.isDirectory() === true;
}

function entriesToTreePaths(
  entries: readonly ProjectEntry[],
  loadedDirectories: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    const treePath = projectEntryToTreePath(entry);
    paths.push(treePath);
    if (
      entry.kind === "directory" &&
      !loadedDirectories.has(treeDirectoryPathToRelativeDir(entry.path))
    ) {
      paths.push(directoryPlaceholderPath(entry.path));
    }
  }
  return paths;
}

function joinProjectPath(cwd: string, relativePath: string): string {
  const normalizedCwd = normalizeTreePath(cwd).replace(/\/+$/g, "");
  const normalizedRelativePath = normalizeTreePath(relativePath).replace(/^\/+/g, "");
  return `${normalizedCwd}/${normalizedRelativePath}`.replace(/([^:])\/{2,}/g, "$1/");
}

function projectFileName(relativePath: string): string {
  return relativePath.split(/[\\/]/).filter(Boolean).at(-1) ?? relativePath;
}

function codeEditorIds(availableEditors: readonly EditorId[]): EditorId[] {
  return availableEditors.filter((editorId) => editorId !== "file-manager");
}

function getExpandedDirectoryPaths(
  model: ProjectTreeModel,
  treePaths: readonly string[],
): string[] {
  return treePaths.filter((treePath) => {
    if (!treePath.endsWith("/")) {
      return false;
    }
    const item = model.getItem(treePath);
    if (!isDirectoryHandle(item)) {
      return false;
    }
    return item.isExpanded();
  });
}

export function openProjectFilePath(input: {
  relativePath: string;
  cwd: string | null;
  availableEditors: readonly EditorId[];
}): void {
  if (!input.cwd) return;

  const editor = resolveAndPersistPreferredEditor(codeEditorIds(input.availableEditors));
  if (!editor) {
    toast.error("No available code editor found.");
    return;
  }

  const targetPath = joinProjectPath(input.cwd, input.relativePath);
  try {
    void ensureLocalApi()
      .shell.openInEditor(targetPath, editor)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

function revealProjectFilePath(input: { relativePath: string; cwd: string | null }): void {
  if (
    !input.cwd ||
    typeof window === "undefined" ||
    typeof window.desktopBridge?.showItemInFolder !== "function"
  ) {
    return;
  }

  const targetPath = joinProjectPath(input.cwd, input.relativePath);
  void window.desktopBridge
    .showItemInFolder(targetPath)
    .then((revealed) => {
      if (!revealed) {
        toast.error("Could not reveal this file. It may have been moved or deleted.");
      }
    })
    .catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
}

const FILE_TREE_MENU_ITEM_CLASS =
  "flex min-h-6 w-full items-center rounded-xs px-2 text-left text-muted-foreground outline-hidden hover:bg-honk-hover hover:text-foreground focus-visible:bg-honk-hover focus-visible:text-foreground";

function fileTreeContextMenuPosition(
  anchorRect: ContextMenuOpenContext["anchorRect"],
  menuElement: HTMLElement | null,
): { left: number; top: number } {
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const menuRect = menuElement?.getBoundingClientRect();
  return resolveFileTreeContextMenuPosition({
    anchorRect,
    menuSize: {
      height: menuRect?.height ?? 0,
      width: menuRect?.width ?? 0,
    },
    viewport: {
      height: viewportHeight,
      width: viewportWidth,
    },
  });
}

/**
 * Context-menu surface for a file-tree row. Adds proper `menu`/`menuitem`
 * semantics and moves focus to the first item on open — the Pierre React-slot
 * menu path strips the native render hook, so it never auto-focuses itself.
 */
function FileTreeContextMenu(props: {
  item: ContextMenuItem;
  context: ContextMenuOpenContext;
  cwd: string | null;
  availableEditors: readonly EditorId[];
  canRevealInFinder: boolean;
  onRequestDelete: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(() =>
    fileTreeContextMenuPosition(props.context.anchorRect, null),
  );

  useLayoutEffect(() => {
    const nextPosition = fileTreeContextMenuPosition(
      props.context.anchorRect,
      containerRef.current,
    );
    setPosition((currentPosition) =>
      currentPosition.left === nextPosition.left && currentPosition.top === nextPosition.top
        ? currentPosition
        : nextPosition,
    );
  }, [
    props.context.anchorRect.bottom,
    props.context.anchorRect.height,
    props.context.anchorRect.left,
    props.context.anchorRect.top,
    props.context.anchorRect.width,
  ]);

  useEffect(() => {
    containerRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  const menuStyle: CSSProperties = {
    left: position.left,
    top: position.top,
  };

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label={`Actions for ${props.item.name}`}
      className="fixed z-(--z-index-workbench-menu) min-w-32 max-w-[calc(100vw-16px)] rounded-honk-control border border-honk-border/70 bg-honk-bubble-opaque p-1 font-honk text-honk-chrome text-foreground shadow-honk-sm"
      data-file-tree-context-menu-root="true"
      style={menuStyle}
    >
      <button
        type="button"
        role="menuitem"
        className={FILE_TREE_MENU_ITEM_CLASS}
        onClick={() => {
          props.context.close();
          openProjectFilePath({
            relativePath: props.item.path,
            cwd: props.cwd,
            availableEditors: props.availableEditors,
          });
        }}
      >
        Open in External Editor
      </button>
      {props.canRevealInFinder ? (
        <button
          type="button"
          role="menuitem"
          className={FILE_TREE_MENU_ITEM_CLASS}
          onClick={() => {
            props.context.close();
            revealProjectFilePath({ relativePath: props.item.path, cwd: props.cwd });
          }}
        >
          Open in Finder
        </button>
      ) : null}
      {props.item.kind === "file" ? (
        <>
          <div role="separator" className="my-1 h-px bg-honk-border/70" />
          <button
            type="button"
            role="menuitem"
            className="flex min-h-6 w-full items-center rounded-xs px-2 text-left text-destructive outline-hidden hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
            onClick={() => {
              props.context.close();
              props.onRequestDelete(props.item.path);
            }}
          >
            Delete
          </button>
        </>
      ) : null}
    </div>
  );
}

async function loadProjectDirectory(input: {
  active: boolean | undefined;
  cwd: string | null;
  environmentId: EnvironmentId | null;
  relativeDir: string;
  queryClient: QueryClient;
  loadedDirectoriesRef: RefObject<Set<string> | null>;
  loadingDirectoriesRef: RefObject<Set<string> | null>;
  mountedRef: RefObject<boolean>;
  setLoadError: Dispatch<SetStateAction<unknown>>;
  setTreePaths: Dispatch<SetStateAction<string[]>>;
}): Promise<void> {
  const cwd = input.cwd;
  const environmentId = input.environmentId;
  const normalizedRelativeDir = treeDirectoryPathToRelativeDir(input.relativeDir);
  if (!input.active || !cwd || !environmentId) {
    return;
  }
  if (!input.mountedRef.current) {
    return;
  }
  const loadedDirectories = input.loadedDirectoriesRef.current;
  const loadingDirectories = input.loadingDirectoriesRef.current;
  if (!loadedDirectories || !loadingDirectories) {
    return;
  }
  if (
    loadedDirectories.has(normalizedRelativeDir) ||
    loadingDirectories.has(normalizedRelativeDir)
  ) {
    return;
  }
  loadingDirectories.add(normalizedRelativeDir);
  try {
    const result = await input.queryClient.fetchQuery(
      projectListDirectoryQueryOptions({
        environmentId,
        cwd,
        relativeDir: normalizedRelativeDir,
      }),
    );
    if (!input.mountedRef.current) {
      return;
    }

    loadedDirectories.add(normalizedRelativeDir);
    input.setLoadError(null);
    input.setTreePaths((currentPaths) => {
      const nextPaths = new Set(
        currentPaths.filter((path) => path !== directoryPlaceholderPath(normalizedRelativeDir)),
      );
      for (const treePath of entriesToTreePaths(result.entries, loadedDirectories)) {
        nextPaths.add(treePath);
      }
      return [...nextPaths];
    });
  } catch (error) {
    if (input.mountedRef.current) {
      input.setLoadError(error);
    }
  } finally {
    loadingDirectories.delete(normalizedRelativeDir);
  }
}

export type ProjectFileTreeHandle = {
  refresh: () => void;
  revealPath: (relativePath: string) => void;
};

export const ProjectFileTree = forwardRef<
  ProjectFileTreeHandle,
  {
    cwd: string | null;
    workspaceKey: string | null;
    environmentId: EnvironmentId | null;
    availableEditors: readonly EditorId[];
    onOpenFile?: (relativePath: string) => void;
    onFilePathsChange?: (relativePaths: readonly string[]) => void;
    selectedPath?: string | null;
    className?: string;
    active?: boolean;
  }
>(function ProjectFileTree(props, ref) {
  const filePathSetRef = useRef<Set<string> | null>(null);
  if (filePathSetRef.current === null) {
    filePathSetRef.current = new Set();
  }
  const mountedRef = useRef(true);
  const loadedDirectoriesRef = useRef<Set<string> | null>(null);
  if (loadedDirectoriesRef.current === null) {
    loadedDirectoriesRef.current = new Set();
  }
  const loadingDirectoriesRef = useRef<Set<string> | null>(null);
  if (loadingDirectoriesRef.current === null) {
    loadingDirectoriesRef.current = new Set();
  }
  const lastOpenedPathRef = useRef<string | null>(null);
  const suppressSelectionOpenRef = useRef<string | null>(null);
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const [treePaths, setTreePaths] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const environmentApiReady = useEnvironmentApiReady(props.environmentId);
  const isActive = props.active !== false;
  const canLoad = Boolean(props.cwd && props.environmentId);
  const canQuery = canLoad && environmentApiReady && isActive;
  const canRenderTree = Boolean(canLoad && isActive);
  const canRevealInFinder =
    props.cwd !== null &&
    isElectronHost() &&
    typeof window !== "undefined" &&
    typeof window.desktopBridge?.showItemInFolder === "function";
  const pendingDeleteFileName = pendingDeletePath ? projectFileName(pendingDeletePath) : "file";
  const deletingPendingFile = pendingDeletePath !== null && deletingPath === pendingDeletePath;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    loadedDirectoriesRef.current?.clear();
    loadingDirectoriesRef.current?.clear();
    filePathSetRef.current?.clear();
    lastOpenedPathRef.current = null;
    suppressSelectionOpenRef.current = null;
    setPendingDeletePath(null);
    setDeletingPath(null);
    setTreePaths([]);
    setLoadError(null);
  }, [props.cwd, props.environmentId]);

  const confirmDeletePendingFile = async () => {
    const cwd = props.cwd;
    const environmentId = props.environmentId;
    const relativePath = pendingDeletePath;
    if (!cwd || !environmentId || !relativePath) {
      setPendingDeletePath(null);
      return;
    }

    setDeletingPath(relativePath);
    try {
      const result = await deleteProjectFile({
        environmentId,
        file: {
          cwd,
          relativePath,
        },
      });
      const deletedRelativePath = normalizeTreePath(result.relativePath);
      // Always dispose the deleted file's Monaco model — even a dirty,
      // currently-inactive one — so a later reopen can't resurrect stale
      // contents.
      markProjectModelClosed({ environmentId, cwd, relativePath: deletedRelativePath });
      // Prune the path from back/forward history (closes the editor if it was
      // active) so navigation and persisted state can't resurrect the gone file.
      workspaceEditorActions.removeFileFromHistory(props.workspaceKey, deletedRelativePath);
      await Promise.all([
        invalidateProjectFile(queryClient, {
          environmentId,
          cwd,
          relativePath: deletedRelativePath,
        }),
        invalidateProjectEntries(queryClient, {
          environmentId,
          cwd,
        }),
      ]);
      setTreePaths((currentPaths) =>
        currentPaths.filter((path) => normalizeTreePath(path) !== deletedRelativePath),
      );
      setPendingDeletePath(null);
    } catch (error) {
      toast.error(formatProjectErrorDescription(error, "Unable to delete file."));
    } finally {
      setDeletingPath(null);
    }
  };

  const { model } = useTreeModel({
    paths: [],
    initialExpansion: "closed",
    search: false,
    onSelectionChange: (selectedPaths) => {
      const raw = selectedPaths[0] ?? null;
      const selectedPath = raw ? normalizeTreePath(raw) : null;
      if (
        !selectedPath ||
        selectedPath === lastOpenedPathRef.current ||
        filePathSetRef.current?.has(selectedPath) !== true
      ) {
        return;
      }
      if (selectedPath === suppressSelectionOpenRef.current) {
        suppressSelectionOpenRef.current = null;
        lastOpenedPathRef.current = selectedPath;
        return;
      }
      lastOpenedPathRef.current = selectedPath;
      if (props.onOpenFile) {
        props.onOpenFile(selectedPath);
        return;
      }
      openProjectFilePath({
        relativePath: selectedPath,
        cwd: props.cwd,
        availableEditors: props.availableEditors,
      });
    },
  });

  const externalSelectedPath = props.selectedPath ? normalizeTreePath(props.selectedPath) : null;

  useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        loadedDirectoriesRef.current?.clear();
        loadingDirectoriesRef.current?.clear();
        setTreePaths([]);
        setLoadError(null);
        void loadProjectDirectory({
          active: canQuery,
          cwd: props.cwd,
          environmentId: props.environmentId,
          relativeDir: "",
          queryClient,
          loadedDirectoriesRef,
          loadingDirectoriesRef,
          mountedRef,
          setLoadError,
          setTreePaths,
        });
      },
      revealPath: (relativePath) => {
        const normalizedPath = normalizeTreePath(relativePath);
        const parentPaths: string[] = [];
        const segments = normalizedPath.split("/");
        for (let index = 1; index < segments.length; index += 1) {
          parentPaths.push(`${segments.slice(0, index).join("/")}/`);
        }
        for (const parentPath of parentPaths) {
          const item = model.getItem(parentPath);
          if (isDirectoryHandle(item)) {
            item.expand();
          }
        }
        const item = model.getItem(normalizedPath);
        if (!item) return;
        suppressSelectionOpenRef.current = normalizedPath;
        for (const selectedPath of model.getSelectedPaths()) {
          model.getItem(selectedPath)?.deselect();
        }
        item.select();
        model.focusPath(normalizedPath);
      },
    }),
    [canQuery, model, props.cwd, props.environmentId, queryClient],
  );

  return (
    <section
      className={cn(
        "project-file-tree flex min-h-0 min-h-36 shrink-0 flex-col overflow-hidden bg-(--honk-workbench-panel-background) text-honk-fg-primary",
        props.className,
      )}
    >
      <ProjectFileTreePathSetSync
        filePathSetRef={filePathSetRef}
        {...(props.onFilePathsChange ? { onFilePathsChange: props.onFilePathsChange } : {})}
        treePaths={treePaths}
      />
      <ProjectFileTreePathsSync model={model} treePaths={treePaths} />
      {canLoad ? (
        <ProjectFileTreeInitialLoadSync
          active={canQuery}
          cwd={props.cwd}
          environmentId={props.environmentId}
          queryClient={queryClient}
          loadedDirectoriesRef={loadedDirectoriesRef}
          loadingDirectoriesRef={loadingDirectoriesRef}
          mountedRef={mountedRef}
          setLoadError={setLoadError}
          setTreePaths={setTreePaths}
        />
      ) : null}
      {canLoad ? (
        <ProjectFileTreeExpandedDirectoryLoader
          active={canQuery}
          cwd={props.cwd}
          environmentId={props.environmentId}
          queryClient={queryClient}
          loadedDirectoriesRef={loadedDirectoriesRef}
          loadingDirectoriesRef={loadingDirectoriesRef}
          mountedRef={mountedRef}
          model={model}
          setLoadError={setLoadError}
          setTreePaths={setTreePaths}
          treePaths={treePaths}
        />
      ) : null}
      <ProjectFileTreeSelectionSync
        externalSelectedPath={externalSelectedPath}
        filePathSetRef={filePathSetRef}
        lastOpenedPathRef={lastOpenedPathRef}
        model={model}
        suppressSelectionOpenRef={suppressSelectionOpenRef}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {canRenderTree ? (
          <Tree
            model={model}
            resolvedTheme={resolvedTheme}
            renderContextMenu={(item, context) => (
              <FileTreeContextMenu
                item={item}
                context={context}
                cwd={props.cwd}
                availableEditors={props.availableEditors}
                canRevealInFinder={canRevealInFinder}
                onRequestDelete={setPendingDeletePath}
              />
            )}
          />
        ) : (
          <div className="px-3 py-2 text-detail text-muted-foreground/55">
            {canLoad ? "Open the file sidebar to browse files." : "Add a project to browse files."}
          </div>
        )}

        {loadError ? (
          <div className="whitespace-pre-wrap px-3 py-2 text-detail text-destructive/80">
            {formatProjectErrorDescription(loadError, "Unable to load files.")}
          </div>
        ) : null}
      </div>
      <AlertDialog
        open={pendingDeletePath !== null}
        onOpenChange={(open) => {
          if (!open && !deletingPendingFile) {
            setPendingDeletePath(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDeleteFileName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes "{pendingDeletePath ?? pendingDeleteFileName}" from the project. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={deletingPendingFile} />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={deletingPendingFile}
              onClick={() => {
                void confirmDeletePendingFile();
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
});

function ProjectFileTreePathSetSync({
  filePathSetRef,
  onFilePathsChange,
  treePaths,
}: {
  filePathSetRef: RefObject<Set<string> | null>;
  onFilePathsChange?: (relativePaths: readonly string[]) => void;
  treePaths: readonly string[];
}) {
  useEffect(() => {
    const filePathSet = filePathSetRef.current;
    if (!filePathSet) return;
    filePathSet.clear();
    const filePaths: string[] = [];
    for (const path of treePaths) {
      if (!path.endsWith("/") && !isDirectoryPlaceholderPath(path)) {
        const normalizedPath = normalizeTreePath(path);
        filePathSet.add(normalizedPath);
        filePaths.push(normalizedPath);
      }
    }
    onFilePathsChange?.(filePaths);
  }, [filePathSetRef, onFilePathsChange, treePaths]);

  return null;
}

function ProjectFileTreePathsSync({
  model,
  treePaths,
}: {
  model: ProjectTreeModel;
  treePaths: readonly string[];
}) {
  useEffect(() => {
    const expandedPaths = getExpandedDirectoryPaths(model, treePaths);
    model.resetPaths(treePaths, {
      initialExpandedPaths: expandedPaths,
      preparedInput: prepareFileTreeInput(treePaths),
    });
  }, [model, treePaths]);

  return null;
}

function ProjectFileTreeInitialLoadSync({
  active,
  cwd,
  environmentId,
  loadedDirectoriesRef,
  loadingDirectoriesRef,
  mountedRef,
  queryClient,
  setLoadError,
  setTreePaths,
}: {
  active: boolean | undefined;
  cwd: string | null;
  environmentId: EnvironmentId | null;
  loadedDirectoriesRef: RefObject<Set<string> | null>;
  loadingDirectoriesRef: RefObject<Set<string> | null>;
  mountedRef: RefObject<boolean>;
  queryClient: QueryClient;
  setLoadError: Dispatch<SetStateAction<unknown>>;
  setTreePaths: Dispatch<SetStateAction<string[]>>;
}) {
  useEffect(() => {
    void loadProjectDirectory({
      active,
      cwd,
      environmentId,
      relativeDir: "",
      queryClient,
      loadedDirectoriesRef,
      loadingDirectoriesRef,
      mountedRef,
      setLoadError,
      setTreePaths,
    });
  }, [
    active,
    cwd,
    environmentId,
    loadedDirectoriesRef,
    loadingDirectoriesRef,
    mountedRef,
    queryClient,
    setLoadError,
    setTreePaths,
  ]);

  return null;
}

function ProjectFileTreeExpandedDirectoryLoader({
  active,
  cwd,
  environmentId,
  loadedDirectoriesRef,
  loadingDirectoriesRef,
  mountedRef,
  model,
  queryClient,
  setLoadError,
  setTreePaths,
  treePaths,
}: {
  active: boolean | undefined;
  cwd: string | null;
  environmentId: EnvironmentId | null;
  loadedDirectoriesRef: RefObject<Set<string> | null>;
  loadingDirectoriesRef: RefObject<Set<string> | null>;
  mountedRef: RefObject<boolean>;
  model: ProjectTreeModel;
  queryClient: QueryClient;
  setLoadError: Dispatch<SetStateAction<unknown>>;
  setTreePaths: Dispatch<SetStateAction<string[]>>;
  treePaths: readonly string[];
}) {
  useEffect(() => {
    const loadExpandedDirectories = () => {
      for (const treePath of treePaths) {
        if (!treePath.endsWith("/")) {
          continue;
        }
        const item = model.getItem(treePath);
        if (isDirectoryHandle(item) && item.isExpanded()) {
          void loadProjectDirectory({
            active,
            cwd,
            environmentId,
            relativeDir: treeDirectoryPathToRelativeDir(treePath),
            queryClient,
            loadedDirectoriesRef,
            loadingDirectoriesRef,
            mountedRef,
            setLoadError,
            setTreePaths,
          });
        }
      }
    };

    loadExpandedDirectories();
    return model.subscribe(loadExpandedDirectories);
  }, [
    active,
    cwd,
    environmentId,
    loadedDirectoriesRef,
    loadingDirectoriesRef,
    model,
    mountedRef,
    queryClient,
    setLoadError,
    setTreePaths,
    treePaths,
  ]);

  return null;
}

function ProjectFileTreeSelectionSync({
  externalSelectedPath,
  filePathSetRef,
  lastOpenedPathRef,
  model,
  suppressSelectionOpenRef,
}: {
  externalSelectedPath: string | null;
  filePathSetRef: RefObject<Set<string> | null>;
  lastOpenedPathRef: RefObject<string | null>;
  model: ProjectTreeModel;
  suppressSelectionOpenRef: RefObject<string | null>;
}) {
  useEffect(() => {
    const filePathSet = filePathSetRef.current;
    if (!externalSelectedPath) {
      for (const selectedPath of model.getSelectedPaths()) {
        model.getItem(selectedPath)?.deselect();
      }
      lastOpenedPathRef.current = null;
      return;
    }
    if (
      filePathSet?.has(externalSelectedPath) !== true ||
      normalizeTreePath(model.getSelectedPaths()[0] ?? "") === externalSelectedPath
    ) {
      return;
    }
    const selectedItem = model.getItem(externalSelectedPath);
    if (!selectedItem) {
      return;
    }
    suppressSelectionOpenRef.current = externalSelectedPath;
    for (const selectedPath of model.getSelectedPaths()) {
      model.getItem(selectedPath)?.deselect();
    }
    selectedItem.select();
    model.focusPath(externalSelectedPath);
  }, [externalSelectedPath, filePathSetRef, lastOpenedPathRef, model, suppressSelectionOpenRef]);

  return null;
}
