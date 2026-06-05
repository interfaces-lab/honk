import { scopedProjectKey, scopeProjectRef } from "~/lib/environment-scope";
import type { ScopedProjectRef } from "@multi/contracts";
import { useRouter } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../stores/chat-drafts";
import { newDraftId, newThreadId } from "../lib/utils";
import { findProjectByPath } from "../lib/project-paths";
import {
  deriveLogicalProjectKey,
  derivePhysicalProjectKeyFromPath,
  getProjectOrderKey,
} from "../stores/project-identity";
import { useServerConfig } from "../rpc/server-state";
import { selectProjectsAcrossEnvironments, useStore } from "../stores/thread-store";
import { createThreadSelectorByRef } from "../stores/thread-selectors";
import { getCurrentRouteTarget, useRouteTarget } from "~/app/routes/thread-route-targets";
import { openDraft } from "~/app/chat-navigation";
import { useUiStateStore } from "../stores/ui-state-store";
import {
  readStoredProjectCwd,
  readStoredProjectSelection,
  subscribeStoredProjectSelection,
} from "../lib/project-state";

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

function useNewThreadState() {
  const router = useRouter();

  return (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      reuseExistingDraft?: boolean;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      logicalProjectKey?: string | null;
    },
  ): Promise<void> => {
    const {
      getDraftSessionByLogicalProjectKey,
      getDraftSessionByProjectRef,
      getDraftSession,
      getDraftThread,
      setDraftThreadContext,
      setLogicalProjectDraftThreadId,
    } = useComposerDraftStore.getState();
    const currentRouteTarget = getCurrentRouteTarget(router);
    const projects = selectProjectsAcrossEnvironments(useStore.getState());
    const project = projects.find(
      (candidate) =>
        candidate.id === projectRef.projectId &&
        candidate.environmentId === projectRef.environmentId,
    );
    const explicitLogicalProjectKey = options?.logicalProjectKey?.trim() || null;
    const logicalProjectKey =
      explicitLogicalProjectKey ??
      (project ? deriveLogicalProjectKey(project) : scopedProjectKey(projectRef));
    const hasBranchOption = options?.branch !== undefined;
    const hasWorktreePathOption = options?.worktreePath !== undefined;
    const hasEnvModeOption = options?.envMode !== undefined;
    const reuseExistingDraft = options?.reuseExistingDraft !== false;
    const storedDraftThread =
      getDraftSessionByLogicalProjectKey(logicalProjectKey) ??
      getDraftSessionByProjectRef(projectRef);
    const latestActiveDraftThread: DraftThreadState | null = currentRouteTarget
      ? currentRouteTarget.kind === "server"
        ? getDraftThread(currentRouteTarget.threadRef)
        : getDraftSession(currentRouteTarget.draftId)
      : null;
    if (reuseExistingDraft && storedDraftThread) {
      return (async () => {
        if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
          setDraftThreadContext(storedDraftThread.draftId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, storedDraftThread.draftId, {
          threadId: storedDraftThread.threadId,
        });
        if (
          currentRouteTarget?.kind === "draft" &&
          currentRouteTarget.draftId === storedDraftThread.draftId
        ) {
          return;
        }
        await openDraft(router, storedDraftThread.draftId);
      })();
    }

    if (
      reuseExistingDraft &&
      latestActiveDraftThread &&
      currentRouteTarget?.kind === "draft" &&
      latestActiveDraftThread.logicalProjectKey === logicalProjectKey &&
      latestActiveDraftThread.promotedTo == null
    ) {
      if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
        setDraftThreadContext(currentRouteTarget.draftId, {
          ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
          ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
          ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
        });
      }
      setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, currentRouteTarget.draftId, {
        threadId: latestActiveDraftThread.threadId,
        createdAt: latestActiveDraftThread.createdAt,
        interactionMode: latestActiveDraftThread.interactionMode,
        ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
        ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
        ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
      });
      return Promise.resolve();
    }

    const draftId = newDraftId();
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    return (async () => {
      setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
        threadId,
        createdAt,
        branch: options?.branch ?? null,
        worktreePath: options?.worktreePath ?? null,
        envMode: options?.envMode ?? "local",
      });

      await openDraft(router, draftId);
    })();
  };
}

export function useNewThreadHandler() {
  const handleNewThread = useNewThreadState();

  return {
    handleNewThread,
  };
}

export function useHandleNewThread() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const routeTarget = useRouteTarget();
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeThreadSelector = useMemo(
    () => createThreadSelectorByRef(routeThreadRef),
    [routeThreadRef?.environmentId, routeThreadRef?.threadId],
  );
  const activeThread = useStore(activeThreadSelector);
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const activeDraftThread = useComposerDraftStore(() =>
    routeTarget
      ? routeTarget.kind === "server"
        ? getDraftThread(routeTarget.threadRef)
        : useComposerDraftStore.getState().getDraftSession(routeTarget.draftId)
      : null,
  );
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const serverConfig = useServerConfig();
  const storedProjectSelection = useSyncExternalStore(
    subscribeStoredProjectSelection,
    readStoredProjectSelection,
    () => null,
  );
  const orderedProjects = orderItemsByPreferredIds({
    items: projects,
    preferredIds: projectOrder,
    getId: getProjectOrderKey,
  });
  const selectedProject = storedProjectSelection
    ? orderedProjects.find(
        (project) =>
          project.environmentId === storedProjectSelection.environmentId &&
          project.id === storedProjectSelection.projectId,
      )
    : undefined;
  const selectedProjectByLastKnownCwd =
    storedProjectSelection && !selectedProject
      ? findProjectByPath(orderedProjects, storedProjectSelection.cwd)
      : undefined;
  const legacyStoredProjectCwd = storedProjectSelection ? null : readStoredProjectCwd();
  const defaultProject = storedProjectSelection
    ? (selectedProject ?? selectedProjectByLastKnownCwd ?? null)
    : ((legacyStoredProjectCwd
        ? findProjectByPath(orderedProjects, legacyStoredProjectCwd)
        : undefined) ??
      (serverConfig?.cwd ? findProjectByPath(orderedProjects, serverConfig.cwd) : undefined) ??
      orderedProjects[0] ??
      null);
  const defaultProjectRef =
    defaultProject
      ? scopeProjectRef(defaultProject.environmentId, defaultProject.id)
      : storedProjectSelection
        ? scopeProjectRef(storedProjectSelection.environmentId, storedProjectSelection.projectId)
        : null;
  const defaultProjectCwd =
    defaultProject?.cwd ??
    storedProjectSelection?.cwd ??
    legacyStoredProjectCwd ??
    serverConfig?.cwd ??
    null;
  const defaultProjectEnvironmentId =
    defaultProject?.environmentId ?? storedProjectSelection?.environmentId ?? null;
  const defaultLogicalProjectKey =
    defaultProject
      ? deriveLogicalProjectKey(defaultProject)
      : storedProjectSelection
        ? derivePhysicalProjectKeyFromPath(
            storedProjectSelection.environmentId,
            storedProjectSelection.cwd,
          )
        : null;
  const handleNewThread = useNewThreadState();

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
