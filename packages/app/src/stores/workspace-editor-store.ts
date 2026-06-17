import { Option, Schema } from "effect";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type WorkspacePanelFullscreenTarget = "none" | "right-workbench";
export type WorkspaceEditorPlacement = "right-panel" | "center";

const DEFAULT_WORKSPACE_KEY = "default";
const WORKSPACE_EDITOR_STORAGE_KEY = "honk.workspaceEditor.v1";
const WORKSPACE_EDITOR_WORD_WRAP_STORAGE_KEY = "honk.workspaceEditor.wordWrap.v1";
const MAX_EDITOR_HISTORY = 50;

export type WorkspaceEditorHistory = {
  readonly index: number;
  readonly paths: readonly string[];
};

export interface WorkspaceEditorFileState {
  readonly activePath: string | null;
  readonly previewPath: string | null;
  readonly history: WorkspaceEditorHistory;
  readonly placement: WorkspaceEditorPlacement;
}

type PersistedWorkspaceEditorFileState = Omit<WorkspaceEditorFileState, "previewPath">;

const EMPTY_EDITOR_HISTORY: WorkspaceEditorHistory = Object.freeze({
  index: -1,
  paths: [],
});

const DEFAULT_EDITOR_FILE_STATE: WorkspaceEditorFileState = Object.freeze({
  activePath: null,
  previewPath: null,
  history: EMPTY_EDITOR_HISTORY,
  placement: "right-panel",
});

const PersistedWorkspaceEditorHistorySchema = Schema.Struct({
  index: Schema.Number,
  paths: Schema.Array(Schema.String),
});
const PersistedWorkspaceEditorFileStateSchema = Schema.Struct({
  activePath: Schema.NullOr(Schema.String),
  history: PersistedWorkspaceEditorHistorySchema,
  placement: Schema.optional(Schema.Literals(["right-panel", "center"])),
});
const decodePersistedWorkspaceEditorFileStateOption = Schema.decodeUnknownOption(
  PersistedWorkspaceEditorFileStateSchema,
);

interface WorkspaceEditorStoreState {
  fullscreenByWorkspaceKey: Record<string, WorkspacePanelFullscreenTarget>;
  fileStateByWorkspaceKey: Record<string, WorkspaceEditorFileState>;
  // Editor-wide preference (not per-file/per-workspace), like Cursor's word wrap.
  wordWrap: boolean;
  enterFullscreen: (workspaceKey: string | null, target: WorkspacePanelFullscreenTarget) => void;
  exitFullscreen: (workspaceKey: string | null) => void;
  toggleFullscreen: (workspaceKey: string | null, target: WorkspacePanelFullscreenTarget) => void;
  previewFile: (workspaceKey: string | null, path: string) => void;
  clearFilePreview: (workspaceKey: string | null) => void;
  openFile: (workspaceKey: string | null, path: string) => void;
  openFileInCenter: (workspaceKey: string | null, path: string) => void;
  setEditorPlacement: (workspaceKey: string | null, placement: WorkspaceEditorPlacement) => void;
  navigateFileHistory: (workspaceKey: string | null, delta: -1 | 1) => void;
  closeEditor: (workspaceKey: string | null) => void;
  removeDirectoryFromHistory: (workspaceKey: string | null, directoryPath: string) => void;
  removeFileFromHistory: (workspaceKey: string | null, path: string) => void;
  setWordWrap: (wordWrap: boolean) => void;
}

function resolveWorkspaceEditorKey(workspaceKey: string | null): string {
  const trimmed = workspaceKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_WORKSPACE_KEY;
}

function normalizeHistory(history: WorkspaceEditorHistory): WorkspaceEditorHistory {
  const paths = history.paths.filter((path) => path.trim().length > 0).slice(-MAX_EDITOR_HISTORY);
  if (paths.length === 0) {
    return EMPTY_EDITOR_HISTORY;
  }
  return {
    index: Math.min(paths.length - 1, Math.max(0, Math.trunc(history.index))),
    paths,
  };
}

function normalizeEditorDirectoryPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/g, "");
}

function isEditorPathInsideDirectory(path: string, directoryPath: string): boolean {
  const normalizedDirectoryPath = normalizeEditorDirectoryPath(directoryPath);
  return normalizeEditorDirectoryPath(path).startsWith(`${normalizedDirectoryPath}/`);
}

function pushEditorHistory(
  current: WorkspaceEditorHistory,
  relativePath: string,
): WorkspaceEditorHistory {
  if (current.paths[current.index] === relativePath) {
    return current;
  }
  const nextPaths = [...current.paths.slice(0, current.index + 1), relativePath];
  const trimmedPaths = nextPaths.slice(-MAX_EDITOR_HISTORY);
  return {
    index: trimmedPaths.length - 1,
    paths: trimmedPaths,
  };
}

function fileStateFromHistory(history: WorkspaceEditorHistory): WorkspaceEditorFileState {
  const normalizedHistory = normalizeHistory(history);
  return {
    activePath:
      normalizedHistory.index >= 0
        ? (normalizedHistory.paths[normalizedHistory.index] ?? null)
        : null,
    previewPath: null,
    history: normalizedHistory,
    placement: "right-panel",
  };
}

function readPersistedWorkspaceEditors(): Record<string, WorkspaceEditorFileState> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(WORKSPACE_EDITOR_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, WorkspaceEditorFileState> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const decoded = Option.getOrElse(
        decodePersistedWorkspaceEditorFileStateOption(value),
        () => null,
      );
      if (!decoded) continue;
      const history = normalizeHistory(decoded.history);
      const activePath =
        decoded.activePath === null
          ? null
          : decoded.activePath && history.paths.includes(decoded.activePath)
            ? decoded.activePath
            : history.index >= 0
              ? (history.paths[history.index] ?? null)
              : null;
      result[key] = {
        activePath,
        previewPath: null,
        history,
        placement: decoded.placement ?? "right-panel",
      };
    }
    return result;
  } catch {
    return {};
  }
}

function persistWorkspaceEditors(data: Record<string, WorkspaceEditorFileState>): void {
  if (typeof window === "undefined") return;
  const persisted: Record<string, PersistedWorkspaceEditorFileState> = {};
  for (const [key, value] of Object.entries(data)) {
    persisted[key] = {
      activePath: value.activePath,
      history: value.history,
      placement: value.placement,
    };
  }
  window.localStorage.setItem(WORKSPACE_EDITOR_STORAGE_KEY, JSON.stringify(persisted));
}

function readPersistedWordWrap(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WORKSPACE_EDITOR_WORD_WRAP_STORAGE_KEY) === "true";
}

function persistWordWrap(wordWrap: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WORKSPACE_EDITOR_WORD_WRAP_STORAGE_KEY, wordWrap ? "true" : "false");
}

function readFileState(
  states: Record<string, WorkspaceEditorFileState>,
  workspaceKey: string | null,
): WorkspaceEditorFileState {
  return states[resolveWorkspaceEditorKey(workspaceKey)] ?? DEFAULT_EDITOR_FILE_STATE;
}

const INITIAL_WORKSPACE_EDITORS = readPersistedWorkspaceEditors();

const useWorkspaceEditorStore = create<WorkspaceEditorStoreState>((set) => ({
  fullscreenByWorkspaceKey: {},
  fileStateByWorkspaceKey: INITIAL_WORKSPACE_EDITORS,
  wordWrap: readPersistedWordWrap(),
  enterFullscreen: (workspaceKey, target) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => ({
      fullscreenByWorkspaceKey: {
        ...state.fullscreenByWorkspaceKey,
        [resolvedKey]: target,
      },
    }));
  },
  exitFullscreen: (workspaceKey) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => ({
      fullscreenByWorkspaceKey: {
        ...state.fullscreenByWorkspaceKey,
        [resolvedKey]: "none",
      },
    }));
  },
  toggleFullscreen: (workspaceKey, target) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => ({
      fullscreenByWorkspaceKey: {
        ...state.fullscreenByWorkspaceKey,
        [resolvedKey]: state.fullscreenByWorkspaceKey[resolvedKey] === target ? "none" : target,
      },
    }));
  },
  previewFile: (workspaceKey, path) => {
    if (path.trim().length === 0) return;
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => {
      const current = readFileState(state.fileStateByWorkspaceKey, workspaceKey);
      const nextPreviewPath = current.activePath === path ? null : path;
      if (current.previewPath === nextPreviewPath && current.placement === "right-panel") {
        return state;
      }
      return {
        fileStateByWorkspaceKey: {
          ...state.fileStateByWorkspaceKey,
          [resolvedKey]: {
            ...current,
            previewPath: nextPreviewPath,
            placement: "right-panel",
          },
        },
      };
    });
  },
  clearFilePreview: (workspaceKey) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => {
      const current = readFileState(state.fileStateByWorkspaceKey, workspaceKey);
      if (current.previewPath === null) {
        return state;
      }
      return {
        fileStateByWorkspaceKey: {
          ...state.fileStateByWorkspaceKey,
          [resolvedKey]: {
            ...current,
            previewPath: null,
          },
        },
      };
    });
  },
  openFile: (workspaceKey, path) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => {
      const current = readFileState(state.fileStateByWorkspaceKey, workspaceKey);
      const history = pushEditorHistory(current.history, path);
      const next: WorkspaceEditorFileState = {
        ...current,
        activePath: path,
        previewPath: null,
        history,
      };
      const fileStateByWorkspaceKey = {
        ...state.fileStateByWorkspaceKey,
        [resolvedKey]: next,
      };
      persistWorkspaceEditors(fileStateByWorkspaceKey);
      return { fileStateByWorkspaceKey };
    });
  },
  openFileInCenter: (workspaceKey, path) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => {
      const current = readFileState(state.fileStateByWorkspaceKey, workspaceKey);
      const history = pushEditorHistory(current.history, path);
      const next: WorkspaceEditorFileState = {
        ...current,
        activePath: path,
        previewPath: null,
        history,
        placement: "center",
      };
      const fileStateByWorkspaceKey = {
        ...state.fileStateByWorkspaceKey,
        [resolvedKey]: next,
      };
      persistWorkspaceEditors(fileStateByWorkspaceKey);
      return { fileStateByWorkspaceKey };
    });
  },
  setEditorPlacement: (workspaceKey, placement) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => {
      const current = readFileState(state.fileStateByWorkspaceKey, workspaceKey);
      if (current.placement === placement) {
        return state;
      }
      const next: WorkspaceEditorFileState = {
        ...current,
        placement,
      };
      const fileStateByWorkspaceKey = {
        ...state.fileStateByWorkspaceKey,
        [resolvedKey]: next,
      };
      persistWorkspaceEditors(fileStateByWorkspaceKey);
      return { fileStateByWorkspaceKey };
    });
  },
  navigateFileHistory: (workspaceKey, delta) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => {
      const current = readFileState(state.fileStateByWorkspaceKey, workspaceKey);
      const nextIndex = current.history.index + delta;
      if (nextIndex < 0 || nextIndex >= current.history.paths.length) {
        return state;
      }
      const next: WorkspaceEditorFileState = {
        ...current,
        activePath: current.history.paths[nextIndex] ?? null,
        previewPath: null,
        history: {
          ...current.history,
          index: nextIndex,
        },
      };
      const fileStateByWorkspaceKey = {
        ...state.fileStateByWorkspaceKey,
        [resolvedKey]: next,
      };
      persistWorkspaceEditors(fileStateByWorkspaceKey);
      return { fileStateByWorkspaceKey };
    });
  },
  closeEditor: (workspaceKey) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => {
      const current = readFileState(state.fileStateByWorkspaceKey, workspaceKey);
      if (current.previewPath !== null) {
        return {
          fileStateByWorkspaceKey: {
            ...state.fileStateByWorkspaceKey,
            [resolvedKey]: {
              ...current,
              previewPath: null,
            },
          },
        };
      }
      if (current.activePath === null) {
        return state;
      }
      const next: WorkspaceEditorFileState = {
        ...current,
        activePath: null,
      };
      const fileStateByWorkspaceKey = {
        ...state.fileStateByWorkspaceKey,
        [resolvedKey]: next,
      };
      persistWorkspaceEditors(fileStateByWorkspaceKey);
      return { fileStateByWorkspaceKey };
    });
  },
  // Drop all paths in a directory from back/forward history (e.g. after folder
  // delete) so navigation can't resurrect files that no longer exist, and stale
  // paths don't persist across reloads. If the active file was inside the
  // directory, the editor closes.
  removeDirectoryFromHistory: (workspaceKey, directoryPath) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => {
      const current = readFileState(state.fileStateByWorkspaceKey, workspaceKey);
      const activePathDeleted =
        current.activePath !== null &&
        isEditorPathInsideDirectory(current.activePath, directoryPath);
      const nextPreviewPath =
        current.previewPath !== null &&
        isEditorPathInsideDirectory(current.previewPath, directoryPath)
          ? null
          : current.previewPath;
      const remainingPaths = current.history.paths.filter(
        (entry) => !isEditorPathInsideDirectory(entry, directoryPath),
      );
      if (
        remainingPaths.length === current.history.paths.length &&
        !activePathDeleted &&
        nextPreviewPath === current.previewPath
      ) {
        return state;
      }
      const nextActivePath = activePathDeleted ? null : current.activePath;
      const next: WorkspaceEditorFileState =
        remainingPaths.length === 0
          ? {
              ...current,
              activePath: nextActivePath,
              previewPath: nextPreviewPath,
              history: EMPTY_EDITOR_HISTORY,
            }
          : {
              ...current,
              activePath: nextActivePath,
              previewPath: nextPreviewPath,
              history: {
                paths: remainingPaths,
                index:
                  nextActivePath !== null && remainingPaths.includes(nextActivePath)
                    ? remainingPaths.indexOf(nextActivePath)
                    : Math.min(current.history.index, remainingPaths.length - 1),
              },
            };
      const fileStateByWorkspaceKey = {
        ...state.fileStateByWorkspaceKey,
        [resolvedKey]: next,
      };
      persistWorkspaceEditors(fileStateByWorkspaceKey);
      return { fileStateByWorkspaceKey };
    });
  },
  // Drop a path from back/forward history (e.g. after delete) so navigation
  // can't resurrect a file that no longer exists, and the stale path doesn't
  // persist across reloads. If it was the active file, the editor closes.
  removeFileFromHistory: (workspaceKey, path) => {
    const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
    set((state) => {
      const current = readFileState(state.fileStateByWorkspaceKey, workspaceKey);
      const nextPreviewPath = current.previewPath === path ? null : current.previewPath;
      if (
        !current.history.paths.includes(path) &&
        current.activePath !== path &&
        current.previewPath !== path
      ) {
        return state;
      }
      if (!current.history.paths.includes(path) && current.activePath !== path) {
        return {
          fileStateByWorkspaceKey: {
            ...state.fileStateByWorkspaceKey,
            [resolvedKey]: {
              ...current,
              previewPath: nextPreviewPath,
            },
          },
        };
      }
      const remainingPaths = current.history.paths.filter((entry) => entry !== path);
      const nextActivePath = current.activePath === path ? null : current.activePath;
      const next: WorkspaceEditorFileState =
        remainingPaths.length === 0
          ? {
              ...current,
              activePath: nextActivePath,
              previewPath: nextPreviewPath,
              history: EMPTY_EDITOR_HISTORY,
            }
          : {
              ...current,
              activePath: nextActivePath,
              previewPath: nextPreviewPath,
              history: {
                paths: remainingPaths,
                index:
                  nextActivePath !== null && remainingPaths.includes(nextActivePath)
                    ? remainingPaths.indexOf(nextActivePath)
                    : Math.min(current.history.index, remainingPaths.length - 1),
              },
            };
      const fileStateByWorkspaceKey = {
        ...state.fileStateByWorkspaceKey,
        [resolvedKey]: next,
      };
      persistWorkspaceEditors(fileStateByWorkspaceKey);
      return { fileStateByWorkspaceKey };
    });
  },
  setWordWrap: (wordWrap) => {
    set((state) => {
      if (state.wordWrap === wordWrap) {
        return state;
      }
      persistWordWrap(wordWrap);
      return { wordWrap };
    });
  },
}));

export function useWorkspaceFullscreenTarget(
  workspaceKey: string | null,
): WorkspacePanelFullscreenTarget {
  const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
  return useWorkspaceEditorStore((state) => state.fullscreenByWorkspaceKey[resolvedKey] ?? "none");
}

/** Non-reactive read for event handlers that must not subscribe to the store. */
export function getWorkspaceFullscreenTarget(
  workspaceKey: string | null,
): WorkspacePanelFullscreenTarget {
  const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
  return useWorkspaceEditorStore.getState().fullscreenByWorkspaceKey[resolvedKey] ?? "none";
}

export function subscribeWorkspaceEditor(onStoreChange: () => void): () => void {
  return useWorkspaceEditorStore.subscribe(onStoreChange);
}

export const workspaceEditorActions = {
  enterFullscreen: (workspaceKey: string | null, target: WorkspacePanelFullscreenTarget): void =>
    useWorkspaceEditorStore.getState().enterFullscreen(workspaceKey, target),
  exitFullscreen: (workspaceKey: string | null): void =>
    useWorkspaceEditorStore.getState().exitFullscreen(workspaceKey),
  toggleFullscreen: (workspaceKey: string | null, target: WorkspacePanelFullscreenTarget): void =>
    useWorkspaceEditorStore.getState().toggleFullscreen(workspaceKey, target),
  previewFile: (workspaceKey: string | null, path: string): void =>
    useWorkspaceEditorStore.getState().previewFile(workspaceKey, path),
  clearFilePreview: (workspaceKey: string | null): void =>
    useWorkspaceEditorStore.getState().clearFilePreview(workspaceKey),
  openFile: (workspaceKey: string | null, path: string): void =>
    useWorkspaceEditorStore.getState().openFile(workspaceKey, path),
  openFileInCenter: (workspaceKey: string | null, path: string): void =>
    useWorkspaceEditorStore.getState().openFileInCenter(workspaceKey, path),
  setEditorPlacement: (workspaceKey: string | null, placement: WorkspaceEditorPlacement): void =>
    useWorkspaceEditorStore.getState().setEditorPlacement(workspaceKey, placement),
  navigateFileHistory: (workspaceKey: string | null, delta: -1 | 1): void =>
    useWorkspaceEditorStore.getState().navigateFileHistory(workspaceKey, delta),
  closeEditor: (workspaceKey: string | null): void =>
    useWorkspaceEditorStore.getState().closeEditor(workspaceKey),
  removeDirectoryFromHistory: (workspaceKey: string | null, directoryPath: string): void =>
    useWorkspaceEditorStore.getState().removeDirectoryFromHistory(workspaceKey, directoryPath),
  removeFileFromHistory: (workspaceKey: string | null, path: string): void =>
    useWorkspaceEditorStore.getState().removeFileFromHistory(workspaceKey, path),
  setWordWrap: (wordWrap: boolean): void =>
    useWorkspaceEditorStore.getState().setWordWrap(wordWrap),
  toggleWordWrap: (): void => {
    const state = useWorkspaceEditorStore.getState();
    state.setWordWrap(!state.wordWrap);
  },
} as const;

export function useEditorWordWrap(): boolean {
  return useWorkspaceEditorStore((state) => state.wordWrap);
}

export function useWorkspaceEditorFileState(workspaceKey: string | null): {
  readonly activePath: string | null;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly placement: WorkspaceEditorPlacement;
} {
  const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
  // useShallow: the selector builds a fresh object, which would otherwise make
  // every store snapshot look changed and re-render in a loop.
  return useWorkspaceEditorStore(
    useShallow((state) => {
      const fileState = state.fileStateByWorkspaceKey[resolvedKey] ?? DEFAULT_EDITOR_FILE_STATE;
      return {
        activePath: fileState.activePath,
        placement: fileState.placement,
        canGoBack: fileState.history.index > 0,
        canGoForward:
          fileState.history.index >= 0 &&
          fileState.history.index < fileState.history.paths.length - 1,
      };
    }),
  );
}

export function useWorkspaceEditorPreviewPath(workspaceKey: string | null): string | null {
  const resolvedKey = resolveWorkspaceEditorKey(workspaceKey);
  return useWorkspaceEditorStore(
    (state) =>
      (state.fileStateByWorkspaceKey[resolvedKey] ?? DEFAULT_EDITOR_FILE_STATE).previewPath,
  );
}
