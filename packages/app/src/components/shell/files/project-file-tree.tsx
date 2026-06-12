"use client";

import {
  prepareFileTreeInput,
  type FileTreeDirectoryHandle,
  type FileTreeItemHandle,
  type GitStatus,
  type GitStatusEntry,
} from "@pierre/trees";
import type {
  EditorId,
  EnvironmentId,
  GitWorkingTreeFileStatus,
  ProjectEntry,
} from "@honk/contracts";
import { normalizePathSeparators as normalizeTreePath } from "@honk/shared/paths";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  forwardRef,
  type RefObject,
  type SetStateAction,
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { resolveAndPersistPreferredEditor } from "~/editor-preferences";
import { useGitStatus } from "~/lib/git-status-state";
import { ensureLocalApi } from "~/local-api";
import { formatProjectErrorDescription } from "~/lib/project-error-description";
import { projectListDirectoryQueryOptions } from "~/lib/project-react-query";
import { cn } from "~/lib/utils";
import { useEnvironmentApiReady } from "~/hooks/use-environment-api-ready";
import { useTheme } from "~/hooks/use-theme";
import { Tree, useTreeModel } from "../../tree";

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
  const separator = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return `${cwd.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/^[\\/]+/, "")}`;
}

function workingTreeFileStatusToTreesStatus(status: GitWorkingTreeFileStatus): GitStatus {
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

function toGitStatusEntries(status: ReturnType<typeof useGitStatus>["data"]): GitStatusEntry[] {
  if (!status?.workingTree.files.length) {
    return [];
  }

  return status.workingTree.files.map((file) => ({
    path: normalizeTreePath(file.path),
    status: workingTreeFileStatusToTreesStatus(file.status),
  }));
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

function openProjectFilePath(input: {
  relativePath: string;
  cwd: string | null;
  availableEditors: readonly EditorId[];
}): void {
  if (!input.cwd) return;

  const editor = resolveAndPersistPreferredEditor(input.availableEditors);
  if (!editor) {
    toast.error("No available editor found.");
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
};

export const ProjectFileTree = forwardRef<
  ProjectFileTreeHandle,
  {
    cwd: string | null;
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
  const environmentApiReady = useEnvironmentApiReady(props.environmentId);
  const isActive = props.active !== false;
  const canLoad = Boolean(props.cwd && props.environmentId);
  const canQuery = canLoad && environmentApiReady && isActive;
  const canRenderTree = Boolean(canLoad && isActive);

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
    setTreePaths([]);
    setLoadError(null);
  }, [props.cwd, props.environmentId]);

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

  const gitStatus = useGitStatus({
    environmentId: props.environmentId,
    cwd: props.cwd,
  });

  const externalSelectedPath = props.selectedPath ? normalizeTreePath(props.selectedPath) : null;
  const gitStatusEntries = toGitStatusEntries(gitStatus.data);

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
    }),
    [canQuery, props.cwd, props.environmentId, queryClient],
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
      <ProjectFileTreeGitStatusSync gitStatusEntries={gitStatusEntries} model={model} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {canRenderTree ? (
          <Tree
            model={model}
            resolvedTheme={resolvedTheme}
            renderContextMenu={(item, context) => (
              <div
                className="min-w-32 rounded-honk-control border border-honk-border/70 bg-honk-bubble-opaque p-1 font-honk text-body text-foreground shadow-honk-popup"
                data-file-tree-context-menu-root="true"
              >
                <button
                  type="button"
                  className="flex min-h-6 w-full items-center rounded-xs px-2 text-left text-muted-foreground hover:bg-honk-hover hover:text-foreground"
                  onClick={() => {
                    context.close();
                    openProjectFilePath({
                      relativePath: item.path,
                      cwd: props.cwd,
                      availableEditors: props.availableEditors,
                    });
                  }}
                >
                  Open in Editor
                </button>
              </div>
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
