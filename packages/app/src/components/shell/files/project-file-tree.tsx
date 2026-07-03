"use client";

import type { FileTreeRenameEvent, GitStatus, GitStatusEntry } from "@pierre/trees";
import {
  type ContextMenuItem,
  type ContextMenuOpenContext,
  prepareFileTreeInput,
  type FileTreeDirectoryHandle,
  type FileTreeItemHandle,
} from "@pierre/trees";
import type { EditorId } from "@honk/shared/editor";
import type { EnvironmentId } from "@honk/shared/environment";
import type { GitStatusResult, GitWorkingTreeFileStatus } from "@honk/shared/git";
import type { ProjectEntry } from "@honk/shared/project";
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
import { honkMenuStyles } from "@honk/honkkit/menu";
import { normalizePathSeparators as normalizeTreePath } from "@honk/shared/paths";
import * as stylex from "@stylexjs/stylex";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  type CSSProperties,
  type Dispatch,
  forwardRef,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { resolveAndPersistPreferredEditor } from "~/editor-preferences";
import { isElectronHost } from "~/env";
import { ensureLocalApi } from "~/local-api";
import { formatProjectErrorDescription } from "~/lib/project-error-description";
import {
  createProjectDirectory,
  deleteProjectFile,
  invalidateProjectEntries,
  invalidateProjectFile,
  projectListDirectoryQueryOptions,
  renameProjectPath,
  writeProjectFile,
} from "~/lib/project-react-query";
import { markProjectModelClosed } from "~/lib/monaco/project-models";
import { cn } from "~/lib/utils";
import { useEnvironmentApiReady } from "~/hooks/use-environment-api-ready";
import { useGitStatus } from "~/lib/git-status-state";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { useTheme } from "~/hooks/use-theme";
import { workspaceEditorActions } from "~/stores/workspace-editor-store";
import { workbenchTabPersistenceActions } from "~/stores/workbench-tab-store";
import { Tree, useTreeModel } from "../../tree";
import { resolveFileTreeContextMenuPosition } from "./project-file-tree-context-menu-position";
import {
  parentDirectoryFromContextItem,
  relativePathFromContextItem,
  renameFileTreePaths,
  treePathForNewFile,
  treePathForNewFolder,
  uniqueSiblingName,
} from "./project-file-tree-paths";

const DIRECTORY_PLACEHOLDER_FILE_NAME = "Loading...";
type ProjectTreeModel = ReturnType<typeof useTreeModel>["model"];
type PendingDeleteEntry = {
  kind: "directory" | "file";
  path: string;
};

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

function canDeleteTreeItem(
  item: ContextMenuItem,
  filePathSet: ReadonlySet<string> | null,
): boolean {
  const normalizedPath = normalizeTreePath(item.path);
  if (isDirectoryPlaceholderPath(normalizedPath)) {
    return false;
  }
  return item.kind === "directory" || filePathSet?.has(normalizedPath) === true;
}

function isTreePathInsideDeletedEntry(treePath: string, deletedEntry: PendingDeleteEntry): boolean {
  const normalizedTreePath = normalizeTreePath(treePath);
  const normalizedDeletedPath = normalizeTreePath(deletedEntry.path).replace(/\/+$/g, "");
  if (deletedEntry.kind === "file") {
    return normalizedTreePath === normalizedDeletedPath;
  }
  return (
    normalizedTreePath === `${normalizedDeletedPath}/` ||
    normalizedTreePath.startsWith(`${normalizedDeletedPath}/`)
  );
}

function filePathsForDeletedEntry(
  filePathSet: ReadonlySet<string> | null,
  deletedEntry: PendingDeleteEntry,
): string[] {
  const normalizedDeletedPath = normalizeTreePath(deletedEntry.path).replace(/\/+$/g, "");
  if (deletedEntry.kind === "file") {
    return [normalizedDeletedPath];
  }
  if (!filePathSet) {
    return [];
  }
  return [...filePathSet].filter((path) =>
    normalizeTreePath(path).startsWith(`${normalizedDeletedPath}/`),
  );
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

function gitWorkingTreeStatusToTreeStatus(status: GitWorkingTreeFileStatus): GitStatus {
  switch (status) {
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
    case "conflict":
    case "modified":
    default:
      return "modified";
  }
}

function gitStatusToTreeEntries(status: GitStatusResult | null): GitStatusEntry[] {
  if (!status?.isRepo) {
    return [];
  }
  return status.workingTree.files.map((file) => ({
    path: normalizeTreePath(file.path),
    status: gitWorkingTreeStatusToTreeStatus(file.status),
  }));
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

function normalizeRevealTreePath(relativePath: string): string {
  const normalizedPath = normalizeTreePath(relativePath);
  return normalizedPath.endsWith("/")
    ? `${normalizedPath.replace(/\/+$/g, "")}/`
    : normalizedPath.replace(/\/+$/g, "");
}

function revealParentDirectoryPaths(treePath: string): string[] {
  const directoryTarget = treePath.endsWith("/");
  const trimmedPath = treePath.replace(/\/+$/g, "");
  if (!trimmedPath) {
    return [];
  }
  const segments = trimmedPath.split("/").filter(Boolean);
  const directorySegmentCount = directoryTarget ? segments.length : segments.length - 1;
  const paths: string[] = [];
  for (let index = 1; index <= directorySegmentCount; index += 1) {
    paths.push(`${segments.slice(0, index).join("/")}/`);
  }
  return paths;
}

function revealProjectTreePath(input: {
  model: ProjectTreeModel;
  relativePath: string;
  suppressSelectionOpenRef: RefObject<string | null>;
}): boolean {
  const treePath = normalizeRevealTreePath(input.relativePath);
  for (const parentPath of revealParentDirectoryPaths(treePath)) {
    const item = input.model.getItem(parentPath);
    if (isDirectoryHandle(item)) {
      item.expand();
    }
  }

  const item = input.model.getItem(treePath);
  if (!item) {
    return false;
  }

  input.suppressSelectionOpenRef.current = treePath;
  for (const selectedPath of input.model.getSelectedPaths()) {
    input.model.getItem(selectedPath)?.deselect();
  }
  item.select();
  input.model.focusPath(treePath);
  return true;
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

type PendingCompositionEntry = {
  kind: "directory" | "file";
  path: string;
};

const FILE_TREE_MENU_ITEM_CLASS =
  "honk-menu__item flex min-h-6 text-left";

const FILE_TREE_CONTEXT_MENU_SEPARATOR_CLASS = "honk-menu__separator";

async function copyPathToClipboard(path: string, successTitle: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    toast.error("Unable to copy path", {
      description: "This browser cannot write to the clipboard.",
    });
    return;
  }
  await navigator.clipboard.writeText(path);
  toast.success(successTitle);
}

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
  canDeleteEntry: boolean;
  canRevealInFinder: boolean;
  canCreateEntry: boolean;
  canRenameEntry: boolean;
  onRequestDelete: (entry: PendingDeleteEntry) => void;
  onRequestNewFile: (item: ContextMenuItem) => void;
  onRequestNewFolder: (item: ContextMenuItem) => void;
  onRequestRename: (item: ContextMenuItem) => void;
  onCopyAbsolutePath: (item: ContextMenuItem) => void;
  onCopyRelativePath: (item: ContextMenuItem) => void;
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

  useLayoutEffect(() => {
    containerRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  const menuStyle: CSSProperties = {
    left: position.left,
    top: position.top,
  };
  const surfaceProps = stylex.props(honkMenuStyles.surface);

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label={`Actions for ${props.item.name}`}
      className={cn(
        surfaceProps.className,
        "honk-menu honk-menu__surface honk-menu__viewport fixed! z-(--z-index-workbench-menu) max-w-[calc(100vw-16px)]",
      )}
      data-file-tree-context-menu-root="true"
      style={{ ...surfaceProps.style, ...menuStyle }}
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
        <>
          <div role="separator" className={FILE_TREE_CONTEXT_MENU_SEPARATOR_CLASS} />
          <button
            type="button"
            role="menuitem"
            className={FILE_TREE_MENU_ITEM_CLASS}
            onClick={() => {
              props.context.close();
              revealProjectFilePath({ relativePath: props.item.path, cwd: props.cwd });
            }}
          >
            Reveal in Finder
          </button>
        </>
      ) : null}
      {props.canCreateEntry ? (
        <>
          <div role="separator" className={FILE_TREE_CONTEXT_MENU_SEPARATOR_CLASS} />
          <button
            type="button"
            role="menuitem"
            className={FILE_TREE_MENU_ITEM_CLASS}
            onClick={() => {
              props.context.close({ restoreFocus: false });
              props.onRequestNewFile(props.item);
            }}
          >
            New File
          </button>
          <button
            type="button"
            role="menuitem"
            className={FILE_TREE_MENU_ITEM_CLASS}
            onClick={() => {
              props.context.close({ restoreFocus: false });
              props.onRequestNewFolder(props.item);
            }}
          >
            New Folder
          </button>
        </>
      ) : null}
      <div role="separator" className={FILE_TREE_CONTEXT_MENU_SEPARATOR_CLASS} />
      <button
        type="button"
        role="menuitem"
        className={FILE_TREE_MENU_ITEM_CLASS}
        onClick={() => {
          props.context.close();
          props.onCopyAbsolutePath(props.item);
        }}
      >
        Copy Path
      </button>
      <button
        type="button"
        role="menuitem"
        className={FILE_TREE_MENU_ITEM_CLASS}
        onClick={() => {
          props.context.close();
          props.onCopyRelativePath(props.item);
        }}
      >
        Copy Relative Path
      </button>
      {props.canRenameEntry || props.canDeleteEntry ? (
        <>
          <div role="separator" className={FILE_TREE_CONTEXT_MENU_SEPARATOR_CLASS} />
          {props.canRenameEntry ? (
            <button
              type="button"
              role="menuitem"
              className={FILE_TREE_MENU_ITEM_CLASS}
              onClick={() => {
                props.context.close({ restoreFocus: false });
                props.onRequestRename(props.item);
              }}
            >
              Rename
            </button>
          ) : null}
          {props.canDeleteEntry ? (
            <button
              type="button"
              role="menuitem"
              className="flex min-h-6 w-full items-center rounded-xs px-2 text-left text-destructive outline-hidden hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
              onClick={() => {
                props.context.close();
                props.onRequestDelete({ kind: props.item.kind, path: props.item.path });
              }}
            >
              Delete
            </button>
          ) : null}
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
  createFile: () => void;
  createFolder: () => void;
  refresh: () => void;
  revealPath: (relativePath: string) => void;
  selectPath: (relativePath: string | null) => void;
};

function syncProjectFileTreeSelection(input: {
  externalSelectedPath: string | null;
  filePathSetRef: RefObject<Set<string> | null>;
  lastOpenedPathRef: RefObject<string | null>;
  model: ProjectTreeModel;
  suppressSelectionOpenRef: RefObject<string | null>;
}): void {
  const filePathSet = input.filePathSetRef.current;
  if (!input.externalSelectedPath) {
    for (const selectedPath of input.model.getSelectedPaths()) {
      input.model.getItem(selectedPath)?.deselect();
    }
    input.lastOpenedPathRef.current = null;
    return;
  }
  if (
    filePathSet?.has(input.externalSelectedPath) !== true ||
    normalizeTreePath(input.model.getSelectedPaths()[0] ?? "") === input.externalSelectedPath
  ) {
    return;
  }
  const selectedItem = input.model.getItem(input.externalSelectedPath);
  if (!selectedItem) {
    return;
  }
  input.suppressSelectionOpenRef.current = input.externalSelectedPath;
  for (const selectedPath of input.model.getSelectedPaths()) {
    input.model.getItem(selectedPath)?.deselect();
  }
  selectedItem.select();
}

function filePathFromTreeMouseEvent(event: ReactMouseEvent<HTMLElement>): string | null {
  for (const target of event.nativeEvent.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    if (
      target.dataset.type === "item" &&
      target.dataset.itemType === "file" &&
      target.dataset.itemPath
    ) {
      return normalizeTreePath(target.dataset.itemPath);
    }
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) return null;
  const itemElement = target.closest<HTMLElement>(
    '[data-type="item"][data-item-type="file"][data-item-path]',
  );
  return itemElement?.dataset.itemPath ? normalizeTreePath(itemElement.dataset.itemPath) : null;
}

function selectedParentDirectory(input: {
  filePathSet: ReadonlySet<string> | null;
  model: ProjectTreeModel;
}): string {
  const selectedPath = input.model.getSelectedPaths()[0];
  if (!selectedPath) {
    return "";
  }

  const normalizedPath = normalizeTreePath(selectedPath);
  const selectedItem = input.model.getItem(normalizedPath);
  if (isDirectoryHandle(selectedItem)) {
    return treeDirectoryPathToRelativeDir(normalizedPath);
  }

  if (input.filePathSet?.has(normalizedPath) === true) {
    return normalizedPath.split("/").slice(0, -1).join("/");
  }

  return "";
}

const ProjectFileTreeComponent = forwardRef<
  ProjectFileTreeHandle,
  {
    cwd: string | null;
    workspaceKey: string | null;
    environmentId: EnvironmentId | null;
    availableEditors: readonly EditorId[];
    onPreviewFile?: (relativePath: string) => void;
    onOpenFile?: (relativePath: string) => void;
    onFilePathsChange?: (relativePaths: readonly string[]) => void;
    searchQuery?: string | null;
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
  const externalSelectedPathRef = useRef<string | null>(null);
  const lastOpenedPathRef = useRef<string | null>(null);
  const suppressSelectionOpenRef = useRef<string | null>(null);
  const pendingCompositionRef = useRef<Map<string, PendingCompositionEntry>>(new Map());
  const pendingRenamePathRef = useRef<string | null>(null);
  const pendingRevealPathRef = useRef<string | null>(null);
  const pendingExpandedPathsRef = useRef<string[]>([]);
  const treePathsRef = useRef<string[]>([]);
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const [treePaths, setTreePaths] = useState<string[]>([]);
  treePathsRef.current = treePaths;
  const [loadError, setLoadError] = useState<unknown>(null);
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<PendingDeleteEntry | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const environmentApiReady = useEnvironmentApiReady(props.environmentId);
  const isActive = props.active !== false;
  const canLoad = Boolean(props.cwd && props.environmentId);
  const canQuery = canLoad && environmentApiReady && isActive;
  const canRenderTree = Boolean(canLoad && isActive);
  const gitStatus = useGitStatus({
    environmentId: props.environmentId,
    cwd: props.cwd,
  });
  // oxlint-disable-next-line react-doctor/react-compiler-no-manual-memoization -- effect dep identity for tree git status sync
  const gitStatusEntries = useMemo(() => gitStatusToTreeEntries(gitStatus.data), [gitStatus.data]);
  const canRevealInFinder =
    props.cwd !== null &&
    isElectronHost() &&
    typeof window !== "undefined" &&
    typeof window.desktopBridge?.showItemInFolder === "function";
  const pendingDeletePath = pendingDeleteEntry?.path ?? null;
  const pendingDeleteKind = pendingDeleteEntry?.kind ?? "file";
  const pendingDeleteLabel = pendingDeleteKind === "directory" ? "folder" : "file";
  const pendingDeleteFileName = pendingDeletePath
    ? projectFileName(pendingDeletePath)
    : pendingDeleteLabel;
  const pendingDeleteDescriptionPath = pendingDeletePath ?? pendingDeleteFileName;
  const pendingDeleteDescription =
    pendingDeleteKind === "directory"
      ? `This removes "${pendingDeleteDescriptionPath}" and all of its contents from the project. This action cannot be undone.`
      : `This removes "${pendingDeleteDescriptionPath}" from the project. This action cannot be undone.`;
  const deletingPendingEntry = pendingDeletePath !== null && deletingPath === pendingDeletePath;

  useMountEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  });

  const confirmDeletePendingEntry = async () => {
    const cwd = props.cwd;
    const environmentId = props.environmentId;
    const relativePath = pendingDeletePath;
    if (!cwd || !environmentId || !relativePath) {
      setPendingDeleteEntry(null);
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
      const deletedEntry: PendingDeleteEntry = {
        kind: pendingDeleteKind,
        path: normalizeTreePath(result.relativePath),
      };
      const deletedFilePaths = filePathsForDeletedEntry(filePathSetRef.current, deletedEntry);
      // Always dispose deleted files' Monaco models — even dirty,
      // currently-inactive ones — so a later reopen can't resurrect stale
      // contents.
      for (const deletedFilePath of deletedFilePaths) {
        markProjectModelClosed({ environmentId, cwd, relativePath: deletedFilePath });
      }
      // Prune the path from back/forward history (closes the editor if it was
      // active) so navigation and persisted state can't resurrect gone files.
      if (deletedEntry.kind === "directory") {
        workspaceEditorActions.removeDirectoryFromHistory(props.workspaceKey, deletedEntry.path);
      } else {
        workspaceEditorActions.removeFileFromHistory(props.workspaceKey, deletedEntry.path);
      }
      await Promise.all([
        ...deletedFilePaths.map((relativePath) =>
          invalidateProjectFile(queryClient, {
            environmentId,
            cwd,
            relativePath,
          }),
        ),
        invalidateProjectEntries(queryClient, {
          environmentId,
          cwd,
        }),
      ]);
      setTreePaths((currentPaths) =>
        currentPaths.filter((path) => !isTreePathInsideDeletedEntry(path, deletedEntry)),
      );
      setPendingDeleteEntry(null);
    } catch (error) {
      toast.error(formatProjectErrorDescription(error, `Unable to delete ${pendingDeleteLabel}.`));
    } finally {
      setDeletingPath(null);
    }
  };

  const handleTreeRename = async (event: FileTreeRenameEvent) => {
    const cwd = props.cwd;
    const environmentId = props.environmentId;
    if (!cwd || !environmentId) {
      return;
    }

    const sourceTreePath = normalizeTreePath(event.sourcePath);
    const destinationBasename = projectFileName(
      normalizeTreePath(event.destinationPath).replace(/\/+$/g, ""),
    );
    const renameResult = renameFileTreePaths({
      files: treePathsRef.current,
      path: sourceTreePath,
      isFolder: event.isFolder,
      nextBasename: destinationBasename,
    });
    if ("error" in renameResult) {
      toast.error(renameResult.error);
      return;
    }

    const sourceRelativePath = renameResult.sourcePath;
    const destinationRelativePath = renameResult.destinationPath;
    if (sourceRelativePath === destinationRelativePath) {
      pendingCompositionRef.current.delete(sourceTreePath);
      return;
    }

    const pendingComposition = pendingCompositionRef.current.get(sourceTreePath);
    try {
      if (pendingComposition?.kind === "file") {
        await writeProjectFile({
          environmentId,
          file: {
            cwd,
            relativePath: destinationRelativePath,
            contents: "",
          },
        });
      } else if (pendingComposition?.kind === "directory") {
        await createProjectDirectory({
          environmentId,
          directory: {
            cwd,
            relativePath: destinationRelativePath,
          },
        });
      } else {
        await renameProjectPath({
          environmentId,
          paths: {
            cwd,
            fromRelativePath: sourceRelativePath,
            toRelativePath: destinationRelativePath,
          },
        });
        if (!event.isFolder) {
          markProjectModelClosed({ environmentId, cwd, relativePath: sourceRelativePath });
        }
        workspaceEditorActions.renameFileInHistory(
          props.workspaceKey,
          sourceRelativePath,
          destinationRelativePath,
          event.isFolder,
        );
        workbenchTabPersistenceActions.renameFilePath(
          props.workspaceKey,
          sourceRelativePath,
          destinationRelativePath,
        );
      }

      pendingCompositionRef.current.delete(sourceTreePath);
      await invalidateProjectEntries(queryClient, { environmentId, cwd });
      setTreePaths(renameResult.nextFiles);
      if (pendingComposition?.kind === "file") {
        props.onOpenFile?.(destinationRelativePath);
      }
    } catch (error) {
      toast.error(
        formatProjectErrorDescription(
          error,
          pendingComposition
            ? "Unable to create project entry."
            : "Unable to rename project entry.",
        ),
      );
      if (pendingComposition) {
        pendingCompositionRef.current.delete(sourceTreePath);
        setTreePaths((currentPaths) =>
          currentPaths.filter((path) => normalizeTreePath(path) !== sourceTreePath),
        );
      }
    }
  };

  const handleTreeRenameRef = useRef(handleTreeRename);
  handleTreeRenameRef.current = handleTreeRename;

  const startNewFileInDirectory = (relativeDir: string) => {
    const parentDir = treeDirectoryPathToRelativeDir(relativeDir);
    const fileName = uniqueSiblingName({
      parentDir,
      baseName: "Untitled",
      treePaths: treePathsRef.current,
      isDirectory: false,
    });
    const nextPath = treePathForNewFile(parentDir, fileName);
    pendingCompositionRef.current.set(nextPath, { kind: "file", path: nextPath });
    pendingRenamePathRef.current = nextPath;
    if (parentDir) {
      pendingExpandedPathsRef.current = [`${normalizeTreePath(parentDir)}/`];
    }
    setTreePaths((currentPaths) => {
      const nextPaths = new Set(currentPaths);
      if (parentDir) {
        nextPaths.add(`${normalizeTreePath(parentDir)}/`);
      }
      nextPaths.add(nextPath);
      return [...nextPaths];
    });
  };

  const startNewFolderInDirectory = (relativeDir: string) => {
    const parentDir = treeDirectoryPathToRelativeDir(relativeDir);
    const folderName = uniqueSiblingName({
      parentDir,
      baseName: "New Folder",
      treePaths: treePathsRef.current,
      isDirectory: true,
    });
    const nextPath = treePathForNewFolder(parentDir, folderName);
    pendingCompositionRef.current.set(nextPath, { kind: "directory", path: nextPath });
    pendingRenamePathRef.current = nextPath;
    if (parentDir) {
      pendingExpandedPathsRef.current = [`${normalizeTreePath(parentDir)}/`];
    }
    setTreePaths((currentPaths) => {
      const nextPaths = new Set(currentPaths);
      if (parentDir) {
        nextPaths.add(`${normalizeTreePath(parentDir)}/`);
      }
      nextPaths.add(nextPath);
      return [...nextPaths];
    });
  };

  const startNewFile = (item: ContextMenuItem) => {
    startNewFileInDirectory(parentDirectoryFromContextItem(item));
  };

  const startNewFolder = (item: ContextMenuItem) => {
    startNewFolderInDirectory(parentDirectoryFromContextItem(item));
  };

  const copyAbsolutePath = (item: ContextMenuItem) => {
    if (!props.cwd) return;
    const relativePath = relativePathFromContextItem(item);
    void copyPathToClipboard(joinProjectPath(props.cwd, relativePath), "Copied path").catch(
      (error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Unable to copy path.");
      },
    );
  };

  const copyRelativePath = (item: ContextMenuItem) => {
    const relativePath = relativePathFromContextItem(item);
    void copyPathToClipboard(relativePath, "Copied relative path").catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Unable to copy path.");
    });
  };

  const { model } = useTreeModel({
    paths: [],
    fileTreeSearchMode: "hide-non-matches",
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
      if (props.onPreviewFile) {
        props.onPreviewFile(selectedPath);
        return;
      }
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
    renaming: {
      canRename: (item) => !isDirectoryPlaceholderPath(normalizeTreePath(item.path)),
      onRename: (event) => {
        void handleTreeRenameRef.current(event);
      },
      onError: (message) => {
        toast.error(message);
      },
    },
  });

  const requestRename = (item: ContextMenuItem) => {
    model.startRenaming(item.path);
  };

  useMountEffect(() => {
    return model.onMutation("remove", (event) => {
      const removedPath = normalizeTreePath(event.path);
      pendingCompositionRef.current.delete(removedPath);
      setTreePaths((currentPaths) =>
        currentPaths.filter((path) => normalizeTreePath(path) !== removedPath),
      );
    });
  });

  const openFileFromDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const relativePath = filePathFromTreeMouseEvent(event);
    if (!relativePath || filePathSetRef.current?.has(relativePath) !== true) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    lastOpenedPathRef.current = relativePath;
    if (props.onOpenFile) {
      props.onOpenFile(relativePath);
      return;
    }
    openProjectFilePath({
      relativePath,
      cwd: props.cwd,
      availableEditors: props.availableEditors,
    });
  };

  const selectPath = (relativePath: string | null) => {
    const externalSelectedPath = relativePath ? normalizeTreePath(relativePath) : null;
    externalSelectedPathRef.current = externalSelectedPath;
    syncProjectFileTreeSelection({
      externalSelectedPath,
      filePathSetRef,
      lastOpenedPathRef,
      model,
      suppressSelectionOpenRef,
    });
  };

  const syncStoredSelectedPath = () => {
    selectPath(externalSelectedPathRef.current);
  };

  const revealPath = (relativePath: string) => {
    pendingRevealPathRef.current = relativePath;
    if (revealProjectTreePath({ model, relativePath, suppressSelectionOpenRef })) {
      pendingRevealPathRef.current = null;
    }
  };

  const revealPendingPath = () => {
    const pendingRevealPath = pendingRevealPathRef.current;
    if (!pendingRevealPath) {
      return;
    }
    if (
      revealProjectTreePath({ model, relativePath: pendingRevealPath, suppressSelectionOpenRef })
    ) {
      pendingRevealPathRef.current = null;
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      createFile: () => {
        if (!canQuery) {
          return;
        }
        startNewFileInDirectory(
          selectedParentDirectory({
            filePathSet: filePathSetRef.current,
            model,
          }),
        );
      },
      createFolder: () => {
        if (!canQuery) {
          return;
        }
        startNewFolderInDirectory(
          selectedParentDirectory({
            filePathSet: filePathSetRef.current,
            model,
          }),
        );
      },
      selectPath,
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
      revealPath,
    }),
    [
      canQuery,
      model,
      props.cwd,
      props.environmentId,
      queryClient,
      revealPath,
      selectPath,
      startNewFileInDirectory,
      startNewFolderInDirectory,
    ],
  );

  return (
    <section
      className={cn(
        "project-file-tree flex min-h-0 flex-1 flex-col overflow-hidden bg-(--honk-workbench-panel-background) text-honk-fg-primary",
        props.className,
      )}
    >
      <ProjectFileTreePathSetSync
        filePathSetRef={filePathSetRef}
        {...(props.onFilePathsChange ? { onFilePathsChange: props.onFilePathsChange } : {})}
        treePaths={treePaths}
      />
      <ProjectFileTreePathsSync
        model={model}
        onPathsSynced={syncStoredSelectedPath}
        onRevealPendingPath={revealPendingPath}
        pendingExpandedPathsRef={pendingExpandedPathsRef}
        pendingRenamePathRef={pendingRenamePathRef}
        treePaths={treePaths}
      />
      <ProjectFileTreeGitStatusSync gitStatusEntries={gitStatusEntries} model={model} />
      <ProjectFileTreeSearchSync model={model} query={props.searchQuery} />
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
      <div className="min-h-0 flex-1 overflow-hidden">
        {canRenderTree ? (
          <Tree
            model={model}
            onDoubleClick={openFileFromDoubleClick}
            resolvedTheme={resolvedTheme}
            renderContextMenu={(item, context) => (
              <FileTreeContextMenu
                item={item}
                context={context}
                cwd={props.cwd}
                availableEditors={props.availableEditors}
                canDeleteEntry={canDeleteTreeItem(item, filePathSetRef.current)}
                canRevealInFinder={canRevealInFinder}
                canCreateEntry={
                  canQuery && !isDirectoryPlaceholderPath(normalizeTreePath(item.path))
                }
                canRenameEntry={canDeleteTreeItem(item, filePathSetRef.current)}
                onRequestDelete={setPendingDeleteEntry}
                onRequestNewFile={startNewFile}
                onRequestNewFolder={startNewFolder}
                onRequestRename={requestRename}
                onCopyAbsolutePath={copyAbsolutePath}
                onCopyRelativePath={copyRelativePath}
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
          if (!open && !deletingPendingEntry) {
            setPendingDeleteEntry(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDeleteLabel} "{pendingDeleteFileName}"?
            </AlertDialogTitle>
            <AlertDialogDescription>{pendingDeleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={deletingPendingEntry} />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={deletingPendingEntry}
              onClick={() => {
                void confirmDeletePendingEntry();
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

export const ProjectFileTree = ProjectFileTreeComponent;

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
  onPathsSynced,
  onRevealPendingPath,
  pendingExpandedPathsRef,
  pendingRenamePathRef,
  treePaths,
}: {
  model: ProjectTreeModel;
  onPathsSynced: () => void;
  onRevealPendingPath: () => void;
  pendingExpandedPathsRef: RefObject<string[]>;
  pendingRenamePathRef: RefObject<string | null>;
  treePaths: readonly string[];
}) {
  const onPathsSyncedRef = useRef(onPathsSynced);
  const onRevealPendingPathRef = useRef(onRevealPendingPath);
  onPathsSyncedRef.current = onPathsSynced;
  onRevealPendingPathRef.current = onRevealPendingPath;

  useEffect(() => {
    const expandedPaths = [
      ...getExpandedDirectoryPaths(model, treePaths),
      ...(pendingExpandedPathsRef.current ?? []),
    ];
    pendingExpandedPathsRef.current = [];
    model.resetPaths(treePaths, {
      initialExpandedPaths: expandedPaths,
      preparedInput: prepareFileTreeInput(treePaths),
    });
    onPathsSyncedRef.current();
    onRevealPendingPathRef.current();
    const pendingRenamePath = pendingRenamePathRef.current;
    if (pendingRenamePath) {
      pendingRenamePathRef.current = null;
      model.startRenaming(pendingRenamePath, { removeIfCanceled: true });
    }
  }, [model, pendingExpandedPathsRef, pendingRenamePathRef, treePaths]);

  return null;
}

function ProjectFileTreeGitStatusSync({
  gitStatusEntries,
  model,
}: {
  gitStatusEntries: readonly GitStatusEntry[];
  model: ProjectTreeModel;
}) {
  useEffect(() => {
    model.setGitStatus(gitStatusEntries);
  }, [gitStatusEntries, model]);

  return null;
}

function ProjectFileTreeSearchSync({
  model,
  query,
}: {
  model: ProjectTreeModel;
  query: string | null | undefined;
}) {
  useEffect(() => {
    const searchQuery = query?.trim() ?? "";
    if (!searchQuery) {
      model.closeSearch();
      return;
    }

    if (model.isSearchOpen()) {
      model.setSearch(searchQuery);
      return;
    }
    model.openSearch(searchQuery);
  }, [model, query]);

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
