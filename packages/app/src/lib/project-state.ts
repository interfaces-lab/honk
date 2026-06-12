import { DEFAULT_PROJECTLESS_CWD, EnvironmentId, ProjectId } from "@honk/contracts";

export const PROJECT_KEY = "honk:project-cwd";
export const SELECTED_PROJECT_KEY = "honk:selected-project";
export const SHELL_LAYOUT_CHANGED_EVENT = "honk:shell-layout-changed";

export interface StoredProjectSelection {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
}

let cachedSelectionRaw: string | null | undefined;
let cachedSelection: StoredProjectSelection | null = null;

export function resolveProjectlessCwd(serverCwd: string | null | undefined): string {
  return serverCwd ?? DEFAULT_PROJECTLESS_CWD;
}

function parseStoredProjectSelection(raw: string | null): StoredProjectSelection | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const environmentId = "environmentId" in value ? value.environmentId : undefined;
    const projectId = "projectId" in value ? value.projectId : undefined;
    const cwd = "cwd" in value ? value.cwd : undefined;
    if (
      typeof environmentId !== "string" ||
      environmentId.length === 0 ||
      typeof projectId !== "string" ||
      projectId.length === 0 ||
      typeof cwd !== "string" ||
      cwd.trim().length === 0
    ) {
      return null;
    }
    return {
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      cwd,
    };
  } catch {
    return null;
  }
}

export function readStoredProjectSelection(): StoredProjectSelection | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SELECTED_PROJECT_KEY);
  if (raw === cachedSelectionRaw) return cachedSelection;
  cachedSelectionRaw = raw;
  cachedSelection = parseStoredProjectSelection(raw);
  return cachedSelection;
}

export function readStoredProjectCwd(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PROJECT_KEY)?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function subscribeStoredProjectSelection(listener: () => void): () => void {
  window.addEventListener(SHELL_LAYOUT_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener(SHELL_LAYOUT_CHANGED_EVENT, listener);
  };
}

export function writeStoredProjectSelection(selection: StoredProjectSelection): void {
  if (typeof window === "undefined") return;
  const currentSelection = readStoredProjectSelection();
  const currentCwd = window.localStorage.getItem(PROJECT_KEY);
  if (
    currentSelection?.environmentId === selection.environmentId &&
    currentSelection.projectId === selection.projectId &&
    currentSelection.cwd === selection.cwd &&
    currentCwd === selection.cwd
  ) {
    return;
  }
  window.localStorage.setItem(
    SELECTED_PROJECT_KEY,
    JSON.stringify({
      environmentId: selection.environmentId,
      projectId: selection.projectId,
      cwd: selection.cwd,
    }),
  );
  window.localStorage.setItem(PROJECT_KEY, selection.cwd);
  cachedSelectionRaw = undefined;
  window.dispatchEvent(new CustomEvent(SHELL_LAYOUT_CHANGED_EVENT));
}
