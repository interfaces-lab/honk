import { EnvironmentId, ProjectId, type ScopedProjectRef } from "@honk/contracts";
import { useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";

import { findProjectByPath } from "~/lib/project-paths";
import {
  readStoredProjectCwd,
  readStoredProjectSelection,
  subscribeStoredProjectSelection,
  type StoredProjectSelection,
} from "~/lib/project-state";
import { scopeProjectRef } from "~/lib/environment-scope";
import { getServerConfig, useServerConfig } from "~/rpc/server-state";
import {
  deriveLogicalProjectKey,
  derivePhysicalProjectKeyFromPath,
} from "~/stores/project-identity";
import { type AppState, selectProjectsAcrossEnvironments, useStore } from "~/stores/thread-store";
import { useUiStateStore } from "~/stores/ui-state-store";
import type { Project } from "~/types";

export interface SelectedWorkspaceProject {
  readonly projectCwd: string | null;
  readonly projectEnvironmentId: ScopedProjectRef["environmentId"] | null;
  readonly projectRef: ScopedProjectRef | null;
  readonly logicalProjectKey: string | null;
}

interface WorkspaceProjectCandidate {
  readonly environmentId: ScopedProjectRef["environmentId"];
  readonly id: ScopedProjectRef["projectId"];
  readonly cwd: string;
  readonly orderKey: string;
  readonly logicalProjectKey: string;
}

function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
}): TItem[] {
  const { getId, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const itemsById = new Map(items.map((item) => [getId(item), item] as const));
  const preferredIdSet = new Set(preferredIds);
  const emittedPreferredIds = new Set<TId>();
  const ordered = preferredIds.flatMap((id) => {
    if (emittedPreferredIds.has(id)) {
      return [];
    }
    const item = itemsById.get(id);
    if (!item) {
      return [];
    }
    emittedPreferredIds.add(id);
    return [item];
  });
  const remaining = items.filter((item) => !preferredIdSet.has(getId(item)));
  return [...ordered, ...remaining];
}

function workspaceProjectCandidateKey(
  input: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity">,
): string {
  return JSON.stringify([input.environmentId, input.id, input.cwd, deriveLogicalProjectKey(input)]);
}

function workspaceProjectCandidateFromKey(key: string): WorkspaceProjectCandidate | null {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 4) {
      return null;
    }
    const [environmentId, projectId, cwd, logicalProjectKey] = value;
    if (
      typeof environmentId !== "string" ||
      environmentId.length === 0 ||
      typeof projectId !== "string" ||
      projectId.length === 0 ||
      typeof cwd !== "string" ||
      cwd.length === 0 ||
      typeof logicalProjectKey !== "string" ||
      logicalProjectKey.length === 0
    ) {
      return null;
    }
    return {
      environmentId: EnvironmentId.make(environmentId),
      id: ProjectId.make(projectId),
      cwd,
      orderKey: derivePhysicalProjectKeyFromPath(environmentId, cwd),
      logicalProjectKey,
    };
  } catch {
    return null;
  }
}

function workspaceProjectCandidatesFromKeys(
  candidateKeys: readonly string[],
): WorkspaceProjectCandidate[] {
  return candidateKeys.flatMap((key) => {
    const candidate = workspaceProjectCandidateFromKey(key);
    return candidate ? [candidate] : [];
  });
}

function selectWorkspaceProjectCandidateKeys(store: AppState): string[] {
  return selectProjectsAcrossEnvironments(store).map(workspaceProjectCandidateKey);
}

function resolveSelectedWorkspaceProject(input: {
  readonly projectOrder: readonly string[];
  readonly projects: readonly WorkspaceProjectCandidate[];
  readonly serverCwd: string | null | undefined;
  readonly storedProjectSelection: StoredProjectSelection | null;
}): SelectedWorkspaceProject {
  const orderedProjects = orderItemsByPreferredIds({
    items: input.projects,
    preferredIds: input.projectOrder,
    getId: (project) => project.orderKey,
  });
  const selectedProject = input.storedProjectSelection
    ? orderedProjects.find(
        (project) =>
          project.environmentId === input.storedProjectSelection?.environmentId &&
          project.id === input.storedProjectSelection.projectId,
      )
    : undefined;
  const selectedProjectByLastKnownCwd =
    input.storedProjectSelection && !selectedProject
      ? findProjectByPath(orderedProjects, input.storedProjectSelection.cwd)
      : undefined;
  const cwdOnlyStoredProjectCwd = input.storedProjectSelection ? null : readStoredProjectCwd();
  const project = input.storedProjectSelection
    ? (selectedProject ?? selectedProjectByLastKnownCwd ?? null)
    : ((cwdOnlyStoredProjectCwd
        ? findProjectByPath(orderedProjects, cwdOnlyStoredProjectCwd)
        : undefined) ??
      (input.serverCwd ? findProjectByPath(orderedProjects, input.serverCwd) : undefined) ??
      orderedProjects[0] ??
      null);
  const projectRef = project
    ? scopeProjectRef(project.environmentId, project.id)
    : input.storedProjectSelection
      ? scopeProjectRef(
          input.storedProjectSelection.environmentId,
          input.storedProjectSelection.projectId,
        )
      : null;
  const projectCwd =
    project?.cwd ??
    input.storedProjectSelection?.cwd ??
    cwdOnlyStoredProjectCwd ??
    input.serverCwd ??
    null;
  const projectEnvironmentId =
    project?.environmentId ?? input.storedProjectSelection?.environmentId ?? null;
  const logicalProjectKey = project
    ? project.logicalProjectKey
    : input.storedProjectSelection
      ? derivePhysicalProjectKeyFromPath(
          input.storedProjectSelection.environmentId,
          input.storedProjectSelection.cwd,
        )
      : null;

  return {
    projectCwd,
    projectEnvironmentId,
    projectRef,
    logicalProjectKey,
  };
}

export function readSelectedWorkspaceProject(): SelectedWorkspaceProject {
  return resolveSelectedWorkspaceProject({
    projectOrder: useUiStateStore.getState().projectOrder,
    projects: workspaceProjectCandidatesFromKeys(
      selectWorkspaceProjectCandidateKeys(useStore.getState()),
    ),
    serverCwd: getServerConfig()?.cwd,
    storedProjectSelection: readStoredProjectSelection(),
  });
}

export function useSelectedWorkspaceProject(): SelectedWorkspaceProject {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const projectCandidateKeys = useStore(useShallow(selectWorkspaceProjectCandidateKeys));
  const projects = workspaceProjectCandidatesFromKeys(projectCandidateKeys);
  const serverConfig = useServerConfig();
  const storedProjectSelection = useSyncExternalStore(
    subscribeStoredProjectSelection,
    readStoredProjectSelection,
    () => null,
  );

  return resolveSelectedWorkspaceProject({
    projectOrder,
    projects,
    serverCwd: serverConfig?.cwd,
    storedProjectSelection,
  });
}
