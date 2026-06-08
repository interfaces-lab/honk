import { scopedProjectKey, scopeProjectRef } from "~/lib/environment-scope";
import { EnvironmentId, ProjectId, type ScopedProjectRef } from "@multi/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type DraftThreadEnvMode,
  type DraftId,
  type DraftThreadState,
  ensureProjectNewThreadDraftSession,
  useComposerDraftStore,
} from "../stores/chat-drafts";
import { findProjectByPath } from "../lib/project-paths";
import {
  deriveLogicalProjectKey,
  derivePhysicalProjectKeyFromPath,
} from "../stores/project-identity";
import { getServerConfig, useServerConfig } from "../rpc/server-state";
import { type AppState, selectProjectsAcrossEnvironments, useStore } from "../stores/thread-store";
import { selectThreadWorkspaceSurfaceByRef } from "../stores/thread-selectors";
import {
  getCurrentRouteTarget,
  type ThreadRouteTarget,
  useRouteTarget,
} from "~/routes/-thread-route-targets";
import { clearNewThreadDraftSendArtifacts, openDraft } from "~/app/chat-navigation";
import type { AppRouter } from "~/router";
import { useUiStateStore } from "../stores/ui-state-store";
import {
  readStoredProjectCwd,
  readStoredProjectSelection,
  subscribeStoredProjectSelection,
  type StoredProjectSelection,
} from "../lib/project-state";
import { DEFAULT_INTERACTION_MODE, type Project } from "../types";

interface NewThreadProjectCandidate {
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

function newThreadProjectCandidateKey(
  input: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity">,
): string {
  return JSON.stringify([
    input.environmentId,
    input.id,
    input.cwd,
    deriveLogicalProjectKey(input),
  ]);
}

function newThreadProjectCandidateFromKey(key: string): NewThreadProjectCandidate | null {
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

function selectNewThreadProjectCandidateKeys(store: AppState): string[] {
  return selectProjectsAcrossEnvironments(store).map(newThreadProjectCandidateKey);
}

interface DraftContextOptions {
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly envMode?: DraftThreadEnvMode;
}

function draftContextPatch(options: DraftContextOptions | undefined): DraftContextOptions {
  return {
    ...(options?.branch !== undefined ? { branch: options.branch ?? null } : {}),
    ...(options?.worktreePath !== undefined
      ? { worktreePath: options.worktreePath ?? null }
      : {}),
    ...(options?.envMode !== undefined ? { envMode: options.envMode } : {}),
  };
}

function draftContextAlreadyMatches(
  draftThread: Pick<DraftThreadState, "branch" | "worktreePath" | "envMode">,
  options: DraftContextOptions | undefined,
): boolean {
  return (
    (options?.branch === undefined || draftThread.branch === (options.branch ?? null)) &&
    (options?.worktreePath === undefined ||
      draftThread.worktreePath === (options.worktreePath ?? null)) &&
    (options?.envMode === undefined || draftThread.envMode === options.envMode)
  );
}

function shouldKeepCurrentDraftRoute(input: {
  readonly currentRouteTarget: ThreadRouteTarget | null;
  readonly projectRef: ScopedProjectRef;
  readonly targetDraftId: DraftId;
  readonly targetDraftThread: Pick<
    DraftThreadState,
    "environmentId" | "projectId" | "branch" | "worktreePath" | "envMode"
  >;
  readonly options: DraftContextOptions | undefined;
}): boolean {
  return (
    input.currentRouteTarget?.kind === "draft" &&
    input.currentRouteTarget.draftId === input.targetDraftId &&
    input.targetDraftThread.environmentId === input.projectRef.environmentId &&
    input.targetDraftThread.projectId === input.projectRef.projectId &&
    draftContextAlreadyMatches(input.targetDraftThread, input.options)
  );
}

export interface NewThreadActionOptions {
  readonly branch?: string | null;
  readonly reuseExistingDraft?: boolean;
  readonly worktreePath?: string | null;
  readonly envMode?: DraftThreadEnvMode;
  readonly logicalProjectKey?: string | null;
}

export async function openNewThreadWithRouter(
  router: AppRouter,
  projectRef: ScopedProjectRef,
  options?: NewThreadActionOptions,
): Promise<void> {
  const {
    getDraftSessionByLogicalProjectKey,
    getDraftSessionByProjectRef,
    getDraftSession,
    getDraftThread,
    getComposerDraft,
    setLogicalProjectDraftThreadId,
  } = useComposerDraftStore.getState();
  const currentRouteTarget = getCurrentRouteTarget(router);
  const projects = selectProjectsAcrossEnvironments(useStore.getState());
  const project = projects.find(
    (candidate) =>
      candidate.id === projectRef.projectId && candidate.environmentId === projectRef.environmentId,
  );
  const explicitLogicalProjectKey = options?.logicalProjectKey?.trim() || null;
  const logicalProjectKey =
    explicitLogicalProjectKey ??
    (project ? deriveLogicalProjectKey(project) : scopedProjectKey(projectRef));
  const reuseExistingDraft = options?.reuseExistingDraft !== false;
  const storedDraftThread =
    getDraftSessionByLogicalProjectKey(logicalProjectKey) ??
    getDraftSessionByProjectRef(projectRef);
  const latestActiveDraftThread: DraftThreadState | null = currentRouteTarget
    ? currentRouteTarget.kind === "server"
      ? getDraftThread(currentRouteTarget.threadRef)
      : getDraftSession(currentRouteTarget.draftId)
    : null;
  const currentComposerDraft =
    currentRouteTarget?.kind === "draft" ? getComposerDraft(currentRouteTarget.draftId) : null;

  if (currentRouteTarget?.kind === "draft" && latestActiveDraftThread?.promotedTo == null) {
    if (latestActiveDraftThread) {
      if (
        shouldKeepCurrentDraftRoute({
          currentRouteTarget,
          projectRef,
          targetDraftId: currentRouteTarget.draftId,
          targetDraftThread: latestActiveDraftThread,
          options,
        })
      ) {
        clearNewThreadDraftSendArtifacts(currentRouteTarget.draftId);
        return;
      }

      setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, currentRouteTarget.draftId, {
        threadId: latestActiveDraftThread.threadId,
        createdAt: latestActiveDraftThread.createdAt,
        interactionMode: latestActiveDraftThread.interactionMode,
        ...draftContextPatch(options),
      });
      clearNewThreadDraftSendArtifacts(currentRouteTarget.draftId);
      return;
    }

    setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, currentRouteTarget.draftId, {
      createdAt: new Date().toISOString(),
      interactionMode: currentComposerDraft?.interactionMode ?? DEFAULT_INTERACTION_MODE,
      branch: options?.branch ?? null,
      worktreePath: options?.worktreePath ?? null,
      envMode: options?.envMode ?? "local",
    });
    clearNewThreadDraftSendArtifacts(currentRouteTarget.draftId);
    return;
  }

  const openProjectDraft = async (): Promise<void> => {
    const draftSession = ensureProjectNewThreadDraftSession(projectRef, {
      logicalProjectKey,
    });
    setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftSession.draftId, {
      threadId: draftSession.threadId,
      createdAt: draftSession.createdAt,
      interactionMode: draftSession.interactionMode,
      branch: options?.branch ?? null,
      worktreePath: options?.worktreePath ?? null,
      envMode: options?.envMode ?? "local",
    });
    await openDraft(router, draftSession.draftId);
  };

  if (!reuseExistingDraft) {
    return openProjectDraft();
  }

  if (storedDraftThread) {
    if (
      shouldKeepCurrentDraftRoute({
        currentRouteTarget,
        projectRef,
        targetDraftId: storedDraftThread.draftId,
        targetDraftThread: storedDraftThread,
        options,
      })
    ) {
      clearNewThreadDraftSendArtifacts(storedDraftThread.draftId);
      return;
    }

    setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, storedDraftThread.draftId, {
      threadId: storedDraftThread.threadId,
      ...draftContextPatch(options),
    });
    if (
      currentRouteTarget?.kind === "draft" &&
      currentRouteTarget.draftId === storedDraftThread.draftId
    ) {
      clearNewThreadDraftSendArtifacts(storedDraftThread.draftId);
      return;
    }
    await openDraft(router, storedDraftThread.draftId);
    return;
  }

  return openProjectDraft();
}

function useNewThreadAction() {
  const router = useRouter();

  return useCallback(
    (projectRef: ScopedProjectRef, options?: NewThreadActionOptions) =>
      openNewThreadWithRouter(router, projectRef, options),
    [router],
  );
}

export function useNewThreadHandler() {
  const handleNewThread = useNewThreadAction();

  return {
    handleNewThread,
  };
}

export interface NewThreadProjectDefaults {
  readonly defaultProjectCwd: string | null;
  readonly defaultProjectEnvironmentId: ScopedProjectRef["environmentId"] | null;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly defaultLogicalProjectKey: string | null;
}

function newThreadProjectCandidatesFromKeys(
  candidateKeys: readonly string[],
): NewThreadProjectCandidate[] {
  return candidateKeys.flatMap((key) => {
    const candidate = newThreadProjectCandidateFromKey(key);
    return candidate ? [candidate] : [];
  });
}

function resolveNewThreadProjectDefaults(input: {
  readonly projectOrder: readonly string[];
  readonly projects: readonly NewThreadProjectCandidate[];
  readonly serverCwd: string | null | undefined;
  readonly storedProjectSelection: StoredProjectSelection | null;
}): NewThreadProjectDefaults {
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
  const legacyStoredProjectCwd = input.storedProjectSelection ? null : readStoredProjectCwd();
  const defaultProject = input.storedProjectSelection
    ? (selectedProject ?? selectedProjectByLastKnownCwd ?? null)
    : ((legacyStoredProjectCwd
        ? findProjectByPath(orderedProjects, legacyStoredProjectCwd)
        : undefined) ??
      (input.serverCwd ? findProjectByPath(orderedProjects, input.serverCwd) : undefined) ??
      orderedProjects[0] ??
      null);
  const defaultProjectRef =
    defaultProject
      ? scopeProjectRef(defaultProject.environmentId, defaultProject.id)
      : input.storedProjectSelection
        ? scopeProjectRef(
            input.storedProjectSelection.environmentId,
            input.storedProjectSelection.projectId,
          )
        : null;
  const defaultProjectCwd =
    defaultProject?.cwd ??
    input.storedProjectSelection?.cwd ??
    legacyStoredProjectCwd ??
    input.serverCwd ??
    null;
  const defaultProjectEnvironmentId =
    defaultProject?.environmentId ?? input.storedProjectSelection?.environmentId ?? null;
  const defaultLogicalProjectKey =
    defaultProject
      ? defaultProject.logicalProjectKey
      : input.storedProjectSelection
        ? derivePhysicalProjectKeyFromPath(
            input.storedProjectSelection.environmentId,
            input.storedProjectSelection.cwd,
          )
        : null;

  return {
    defaultProjectCwd,
    defaultProjectEnvironmentId,
    defaultProjectRef,
    defaultLogicalProjectKey,
  };
}

export function readNewThreadProjectDefaults(): NewThreadProjectDefaults {
  return resolveNewThreadProjectDefaults({
    projectOrder: useUiStateStore.getState().projectOrder,
    projects: newThreadProjectCandidatesFromKeys(
      selectNewThreadProjectCandidateKeys(useStore.getState()),
    ),
    serverCwd: getServerConfig()?.cwd,
    storedProjectSelection: readStoredProjectSelection(),
  });
}

export function useNewThreadProjectDefaults(): NewThreadProjectDefaults {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const projectCandidateKeys = useStore(useShallow(selectNewThreadProjectCandidateKeys));
  const projects = useMemo(
    () => newThreadProjectCandidatesFromKeys(projectCandidateKeys),
    [projectCandidateKeys],
  );
  const serverConfig = useServerConfig();
  const storedProjectSelection = useSyncExternalStore(
    subscribeStoredProjectSelection,
    readStoredProjectSelection,
    () => null,
  );

  return useMemo(
    () =>
      resolveNewThreadProjectDefaults({
        projectOrder,
        projects,
        serverCwd: serverConfig?.cwd,
        storedProjectSelection,
      }),
    [
      projectOrder,
      projects,
      serverConfig?.cwd,
      storedProjectSelection?.cwd,
      storedProjectSelection?.environmentId,
      storedProjectSelection?.projectId,
    ],
  );
}

export function useHandleNewThread() {
  const {
    defaultProjectCwd,
    defaultProjectEnvironmentId,
    defaultProjectRef,
    defaultLogicalProjectKey,
  } = useNewThreadProjectDefaults();
  const routeTarget = useRouteTarget();
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeThread = useStore(
    useShallow((store) => selectThreadWorkspaceSurfaceByRef(store, routeThreadRef) ?? null),
  );
  const activeDraftThread = useComposerDraftStore((store) =>
    routeTarget
      ? routeTarget.kind === "server"
        ? store.getDraftThread(routeTarget.threadRef)
        : store.getDraftSession(routeTarget.draftId)
      : null,
  );
  const handleNewThread = useNewThreadAction();

  return {
    activeDraftThread,
    activeThread,
    defaultProjectCwd,
    defaultProjectEnvironmentId,
    defaultProjectRef,
    defaultLogicalProjectKey,
    handleNewThread,
    routeThreadRef,
  };
}
