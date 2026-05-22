"use client";

import type {
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
  GitStatus,
  GitStatusEntry,
} from "@pierre/trees";
import type {
  EditorId,
  EnvironmentId,
  GitWorkingTreeFileStatus,
  ProjectEntry,
} from "@multi/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  forwardRef,
  type RefObject,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { resolveAndPersistPreferredEditor } from "~/editor/preferences";
import { useGitStatus } from "~/lib/git-status-state";
import { ensureNativeApi } from "~/lib/native-runtime-api";
import { formatProjectErrorDescription } from "~/lib/project-error-description";
import { projectListDirectoryQueryOptions } from "~/lib/project-react-query";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/use-theme";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { normalizeTreePath, Tree, useTreeModel } from "../../tree";

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
  return normalizeTreePath(path).endsWith(`/${DIRECTORY_PLACEHOLDER_FILE_NAME}`);
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

function createProjectFileTreeContextKey(input: {
  active: boolean | undefined;
  cwd: string | null;
  environmentId: EnvironmentId | null;
}): string {
  return JSON.stringify([input.active === true, input.cwd, input.environmentId]);
}

function createGitStatusKey(gitStatusEntries: readonly GitStatusEntry[]): string {
  return gitStatusEntries.map((entry) => `${entry.path}:${entry.status}`).join("\0");
}

function useValueIdentityVersion<TValue>(value: TValue): number {
  const valueRef = useRef(value);
  const versionRef = useRef(0);
  if (valueRef.current !== value) {
    valueRef.current = value;
    versionRef.current += 1;
  }
  return versionRef.current;
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
    selectedPath?: string | null;
    className?: string;
    active?: boolean;
  }
>(function ProjectFileTree(props, ref) {
  const filePathSetRef = useRef<ReadonlySet<string>>(new Set());
  const availableEditorsRef = useRef(props.availableEditors);
  const cwdRef = useRef(props.cwd);
  const onOpenFileRef = useRef(props.onOpenFile);
  const loadContextRef = useRef({
    cwd: props.cwd,
    environmentId: props.environmentId,
  });
  const loadedDirectoriesRef = useRef<Set<string>>(new Set());
  const loadingDirectoriesRef = useRef<Set<string>>(new Set());
  const lastOpenedPathRef = useRef<string | null>(null);
  const suppressSelectionOpenRef = useRef<string | null>(null);
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const [treePaths, setTreePaths] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [, setLoadRevision] = useState(0);

  availableEditorsRef.current = props.availableEditors;
  cwdRef.current = props.cwd;
  onOpenFileRef.current = props.onOpenFile;
  loadContextRef.current = {
    cwd: props.cwd,
    environmentId: props.environmentId,
  };

  const openPath = useCallback((relativePath: string) => {
    const cwd = cwdRef.current;
    if (!cwd) return;

    const editor = resolveAndPersistPreferredEditor(availableEditorsRef.current);
    if (!editor) {
      toast.error("No available editor found.");
      return;
    }

    const targetPath = joinProjectPath(cwd, relativePath);
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

  const loadDirectory = useCallback(
    async (relativeDir: string) => {
      const cwd = props.cwd;
      const environmentId = props.environmentId;
      const normalizedRelativeDir = treeDirectoryPathToRelativeDir(relativeDir);
      if (!props.active || !cwd || !environmentId) {
        return;
      }
      if (
        loadedDirectoriesRef.current.has(normalizedRelativeDir) ||
        loadingDirectoriesRef.current.has(normalizedRelativeDir)
      ) {
        return;
      }

      loadingDirectoriesRef.current.add(normalizedRelativeDir);
      setLoadRevision((revision) => revision + 1);
      try {
        const result = await queryClient.fetchQuery(
          projectListDirectoryQueryOptions({
            environmentId,
            cwd,
            relativeDir: normalizedRelativeDir,
          }),
        );
        if (
          loadContextRef.current.cwd !== cwd ||
          loadContextRef.current.environmentId !== environmentId
        ) {
          return;
        }

        loadedDirectoriesRef.current.add(normalizedRelativeDir);
        setLoadError(null);
        setTreePaths((currentPaths) => {
          const nextPaths = new Set(
            currentPaths.filter((path) => path !== directoryPlaceholderPath(normalizedRelativeDir)),
          );
          for (const treePath of entriesToTreePaths(result.entries, loadedDirectoriesRef.current)) {
            nextPaths.add(treePath);
          }
          return [...nextPaths];
        });
      } catch (error) {
        if (
          loadContextRef.current.cwd === cwd &&
          loadContextRef.current.environmentId === environmentId
        ) {
          setLoadError(error);
        }
      } finally {
        loadingDirectoriesRef.current.delete(normalizedRelativeDir);
        setLoadRevision((revision) => revision + 1);
      }
    },
    [props.active, props.cwd, props.environmentId, queryClient],
  );
  const gitStatus = useGitStatus({
    environmentId: props.environmentId,
    cwd: props.cwd,
  });

  const filePathSet = useMemo(
    () =>
      new Set(
        treePaths
          .filter((path) => !path.endsWith("/") && !isDirectoryPlaceholderPath(path))
          .map((path) => normalizeTreePath(path)),
      ),
    [treePaths],
  );
  const treePathsKey = useMemo(() => treePaths.join("\0"), [treePaths]);
  const gitStatusEntries = useMemo(() => toGitStatusEntries(gitStatus.data), [gitStatus.data]);
  const gitStatusKey = useMemo(() => createGitStatusKey(gitStatusEntries), [gitStatusEntries]);
  const externalSelectedPath = props.selectedPath ? normalizeTreePath(props.selectedPath) : null;
  const projectFileTreeContextKey = createProjectFileTreeContextKey({
    active: props.active,
    cwd: props.cwd,
    environmentId: props.environmentId,
  });
  const loadDirectoryVersion = useValueIdentityVersion(loadDirectory);

  filePathSetRef.current = filePathSet;

  const refreshFiles = useCallback(() => {
    loadedDirectoriesRef.current = new Set();
    loadingDirectoriesRef.current = new Set();
    setTreePaths([]);
    setLoadError(null);
    setLoadRevision((revision) => revision + 1);
    void loadDirectory("");
  }, [loadDirectory]);

  useImperativeHandle(
    ref,
    () => ({
      refresh: refreshFiles,
    }),
    [refreshFiles],
  );

  return (
    <section
      className={cn(
        "project-file-tree flex min-h-0 min-h-36 shrink-0 flex-col overflow-hidden bg-multi-bg-quinary text-multi-fg-primary",
        props.className,
      )}
    >
      <ProjectFileTreePathsSync key={`paths:${treePathsKey}`} model={model} treePaths={treePaths} />
      <ProjectFileTreeInitialLoadSync
        key={`initial:${projectFileTreeContextKey}:${loadDirectoryVersion}`}
        active={props.active}
        cwd={props.cwd}
        environmentId={props.environmentId}
        loadDirectory={loadDirectory}
      />
      <ProjectFileTreeExpandedDirectoryLoader
        key={`expanded:${projectFileTreeContextKey}:${loadDirectoryVersion}:${treePathsKey}`}
        active={props.active}
        cwd={props.cwd}
        environmentId={props.environmentId}
        loadDirectory={loadDirectory}
        model={model}
        treePaths={treePaths}
      />
      <ProjectFileTreeSelectionSync
        key={`selection:${treePathsKey}:${externalSelectedPath ?? ""}`}
        externalSelectedPath={externalSelectedPath}
        filePathSet={filePathSet}
        lastOpenedPathRef={lastOpenedPathRef}
        model={model}
        suppressSelectionOpenRef={suppressSelectionOpenRef}
      />
      <ProjectFileTreeGitStatusSync
        key={`git:${gitStatusKey}`}
        gitStatusEntries={gitStatusEntries}
        model={model}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {props.cwd && props.environmentId ? (
          <Tree
            model={model}
            resolvedTheme={resolvedTheme}
            renderContextMenu={(item, context) => (
              <div
                className="min-w-32 rounded-multi-control border border-multi-border/70 bg-multi-bubble-opaque p-1 font-multi text-body text-foreground shadow-multi-popup"
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
          <div className="px-3 py-2 text-detail text-muted-foreground/55">
            Add a project to browse files.
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

function ProjectFileTreePathsSync({
  model,
  treePaths,
}: {
  model: ProjectTreeModel;
  treePaths: readonly string[];
}) {
  useMountEffect(() => {
    const expandedPaths = getExpandedDirectoryPaths(model, treePaths);
    model.resetPaths(treePaths, { initialExpandedPaths: expandedPaths });
  });

  return null;
}

function ProjectFileTreeInitialLoadSync({
  active,
  cwd,
  environmentId,
  loadDirectory,
}: {
  active: boolean | undefined;
  cwd: string | null;
  environmentId: EnvironmentId | null;
  loadDirectory: (relativeDir: string) => Promise<void>;
}) {
  useMountEffect(() => {
    if (!active || !cwd || !environmentId) {
      return;
    }
    void loadDirectory("");
  });

  return null;
}

function ProjectFileTreeExpandedDirectoryLoader({
  active,
  cwd,
  environmentId,
  loadDirectory,
  model,
  treePaths,
}: {
  active: boolean | undefined;
  cwd: string | null;
  environmentId: EnvironmentId | null;
  loadDirectory: (relativeDir: string) => Promise<void>;
  model: ProjectTreeModel;
  treePaths: readonly string[];
}) {
  useMountEffect(() => {
    return model.subscribe(() => {
      if (!active || !cwd || !environmentId) {
        return;
      }
      for (const treePath of treePaths) {
        if (!treePath.endsWith("/")) {
          continue;
        }
        const item = model.getItem(treePath);
        if (isDirectoryHandle(item) && item.isExpanded()) {
          void loadDirectory(treeDirectoryPathToRelativeDir(treePath));
        }
      }
    });
  });

  return null;
}

function ProjectFileTreeSelectionSync({
  externalSelectedPath,
  filePathSet,
  lastOpenedPathRef,
  model,
  suppressSelectionOpenRef,
}: {
  externalSelectedPath: string | null;
  filePathSet: ReadonlySet<string>;
  lastOpenedPathRef: RefObject<string | null>;
  model: ProjectTreeModel;
  suppressSelectionOpenRef: RefObject<string | null>;
}) {
  useMountEffect(() => {
    if (!externalSelectedPath) {
      for (const selectedPath of model.getSelectedPaths()) {
        model.getItem(selectedPath)?.deselect();
      }
      lastOpenedPathRef.current = null;
      return;
    }
    if (
      !filePathSet.has(externalSelectedPath) ||
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
  });

  return null;
}

function ProjectFileTreeGitStatusSync({
  gitStatusEntries,
  model,
}: {
  gitStatusEntries: readonly GitStatusEntry[];
  model: ProjectTreeModel;
}) {
  useMountEffect(() => {
    model.setGitStatus(gitStatusEntries);
  });

  return null;
}
