import {
  DESKTOP_RUNTIME_ENVIRONMENT_ID,
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "~/lib/environment-scope";
import { type ScopedProjectRef, type ScopedThreadRef, ThreadId } from "@honk/contracts";
import type { SidebarThreadSortOrder } from "@honk/contracts/settings";
import { createAgentModelPolicy } from "@honk/shared/agent-model-policy";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { useComposerDraftStore } from "../stores/chat-drafts";
import { useNewThreadHandler } from "./use-handle-new-thread";
import { readEnvironmentApi } from "../environment-api";
import { invalidateGitQueries } from "../lib/git-react-query";
import { ensureEnvironmentGitApi } from "../lib/environment-git-api";
import { sortThreads, type ThreadSortInput } from "../lib/thread-sort";
import { newCommandId, newThreadId } from "../lib/utils";
import { readHonkRuntimeApi } from "~/lib/honk-runtime-api";
import { readLocalApi } from "../local-api";
import { useAgentRuntimeStore } from "../stores/agent-runtime-store";
import {
  selectProjectsAcrossEnvironments,
  selectThreadByRef,
  selectThreadsForEnvironment,
  useStore,
} from "../stores/thread-store";
import { openChatIndex, openThread } from "~/app/chat-navigation";
import { useRouteTarget } from "~/routes/-thread-route-targets";
import {
  PROJECT_KEY,
  SELECTED_PROJECT_KEY,
  SHELL_LAYOUT_CHANGED_EVENT,
  readStoredProjectSelection,
  writeStoredProjectSelection,
} from "~/lib/project-state";
import {
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForThread,
} from "../git/worktree-cleanup";
import { toastManager } from "~/app/toast";
import { formatSchemaBackedTransportErrorDescription } from "~/rpc/transport-error";
import { useSettings } from "./use-settings";
import { hasActiveOrchestrationTurn } from "~/session-logic";
import type { Thread } from "../types";
import { findWorkspaceProjectForSource, isSourceForWorkspaceProject } from "~/lib/workspace-target";

function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreads(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}

type ArchiveToastItem = {
  threadRef: ScopedThreadRef;
  title: string | null;
};

type ArchiveToastId = ReturnType<typeof toastManager.add>;

const archiveToastBatchWindowMs = 2_000;
let archiveToastId: ArchiveToastId | null = null;
let archiveToastItems: ArchiveToastItem[] = [];
let archiveToastTimer: ReturnType<typeof setTimeout> | null = null;

function formatArchiveToastTitle(items: readonly ArchiveToastItem[]): string {
  if (items.length === 1) {
    const title = items[0]?.title?.trim();
    return title ? `Archived "${title}"` : "Archived agent";
  }
  return `Archived ${items.length} threads`;
}

function resetArchiveToastBatch(): void {
  archiveToastId = null;
  archiveToastItems = [];
  if (archiveToastTimer) {
    clearTimeout(archiveToastTimer);
    archiveToastTimer = null;
  }
}

function enqueueArchiveUndoToast(
  items: readonly ArchiveToastItem[],
  undoArchiveThreads: (targets: readonly ScopedThreadRef[]) => void,
): void {
  if (items.length === 0) {
    return;
  }

  const itemByKey = new Map(
    archiveToastItems.map((item) => [scopedThreadKey(item.threadRef), item] as const),
  );
  for (const item of items) {
    itemByKey.set(scopedThreadKey(item.threadRef), item);
  }
  archiveToastItems = [...itemByKey.values()];
  const toastItems = [...archiveToastItems];
  const undoTargets = toastItems.map((item) => item.threadRef);
  const toastPayload = {
    type: "success" as const,
    title: formatArchiveToastTitle(toastItems),
    actionProps: {
      children: toastItems.length === 1 ? "Undo" : "Undo all",
      onClick: () => {
        if (archiveToastId) {
          toastManager.close(archiveToastId);
        }
        resetArchiveToastBatch();
        undoArchiveThreads(undoTargets);
      },
    },
    data: {
      dismissAfterVisibleMs: 8_000,
    },
  };

  if (archiveToastId) {
    toastManager.update(archiveToastId, toastPayload);
  } else {
    archiveToastId = toastManager.add(toastPayload);
  }

  if (archiveToastTimer) {
    clearTimeout(archiveToastTimer);
  }
  archiveToastTimer = setTimeout(resetArchiveToastBatch, archiveToastBatchWindowMs);
}

function resolveThreadTarget(target: ScopedThreadRef) {
  const state = useStore.getState();
  const thread = selectThreadByRef(state, target);
  if (!thread) {
    return null;
  }
  return {
    thread,
    threadRef: target,
  };
}

async function commitRename(
  target: ScopedThreadRef,
  newTitle: string,
  originalTitle: string,
): Promise<void> {
  const trimmed = newTitle.trim();
  if (trimmed.length === 0) {
    throw new Error("Thread title cannot be empty");
  }
  if (trimmed === originalTitle) {
    return;
  }

  const api = readEnvironmentApi(target.environmentId);
  if (!api) {
    return;
  }

  await api.orchestration.dispatchCommand({
    type: "thread.meta.update",
    commandId: newCommandId(),
    threadId: target.threadId,
    title: trimmed,
  });
}

function threadHasOngoingWork(thread: Pick<Thread, "latestTurn" | "session">): boolean {
  return hasActiveOrchestrationTurn(thread.latestTurn, thread.session);
}

interface ArchiveWarningPrompt {
  title: string;
  description: string;
}

export type ArchiveWarningDialogController = ArchiveWarningPrompt & {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

function formatArchiveWarningThreadTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled agent";
}

function getArchiveWarningPrompt(threadTitles: readonly string[]): ArchiveWarningPrompt | null {
  if (threadTitles.length === 0) {
    return null;
  }
  if (threadTitles.length === 1) {
    return {
      title: `Archive "${formatArchiveWarningThreadTitle(threadTitles[0] ?? "")}"?`,
      description: "This agent still has tasks running. Archiving force-stops them.",
    };
  }
  return {
    title: `Archive ${threadTitles.length} threads?`,
    description: `${threadTitles.length} threads still have tasks running. Archiving force-stops them.`,
  };
}

async function stopThreadWork(target: ScopedThreadRef, thread: Pick<Thread, "session">) {
  try {
    await readHonkRuntimeApi().abort({ threadId: target.threadId });
  } catch {
    // The runtime host may be unavailable or the thread may not be runtime-owned.
  }
  if (!thread.session || thread.session.status === "closed") {
    return;
  }
  const api = readEnvironmentApi(target.environmentId);
  if (!api) {
    return;
  }
  await api.orchestration
    .dispatchCommand({
      type: "thread.session.stop",
      commandId: newCommandId(),
      threadId: target.threadId,
      createdAt: new Date().toISOString(),
    })
    .catch(() => undefined);
}

async function unarchiveThread(target: ScopedThreadRef): Promise<void> {
  const api = readEnvironmentApi(target.environmentId);
  if (!api) return;
  const resolved = resolveThreadTarget(target);
  if (!resolved || resolved.thread.archivedAt === null) return;

  await api.orchestration.dispatchCommand({
    type: "thread.unarchive",
    commandId: newCommandId(),
    threadId: target.threadId,
  });
}

export function useThreadActions() {
  const sidebarThreadSortOrder = useSettings((settings) => settings.sidebarThreadSortOrder);
  const confirmThreadDelete = useSettings((settings) => settings.confirmThreadDelete);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const markLocalRuntimeThread = useAgentRuntimeStore((store) => store.markLocalRuntimeThread);
  const clearLocalRuntimeThread = useAgentRuntimeStore((store) => store.clearLocalRuntimeThread);
  const router = useRouter();
  const routeTarget = useRouteTarget();
  const { handleNewThread } = useNewThreadHandler();
  // Keep a ref so archiveThread can call handleNewThread without appearing in
  // its dependency array — handleNewThread is inherently unstable (depends on
  // the projects list) and would otherwise cascade new references into every
  // sidebar row via archiveThread → attemptArchiveThread.
  const handleNewThreadRef = useRef(handleNewThread);
  const routeTargetRef = useRef(routeTarget);
  handleNewThreadRef.current = handleNewThread;
  routeTargetRef.current = routeTarget;
  const queryClient = useQueryClient();
  const [archiveWarningPrompt, setArchiveWarningPrompt] = useState<ArchiveWarningPrompt | null>(
    null,
  );
  const archiveWarningResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const completeArchiveWarning = (confirmed: boolean) => {
    const resolve = archiveWarningResolveRef.current;
    archiveWarningResolveRef.current = null;
    setArchiveWarningPrompt(null);
    resolve?.(confirmed);
  };

  const requestArchiveWarningConfirmation = (threadTitles: readonly string[]): Promise<boolean> => {
    const prompt = getArchiveWarningPrompt(threadTitles);
    if (!prompt) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      archiveWarningResolveRef.current?.(false);
      archiveWarningResolveRef.current = resolve;
      setArchiveWarningPrompt(prompt);
    });
  };

  const confirmArchiveWarning = () => {
    completeArchiveWarning(true);
  };

  const handleArchiveWarningOpenChange = (open: boolean) => {
    if (!open) {
      completeArchiveWarning(false);
    }
  };

  const archiveWarningDialog: ArchiveWarningDialogController | null = !archiveWarningPrompt
    ? null
    : {
        ...archiveWarningPrompt,
        onConfirm: confirmArchiveWarning,
        onOpenChange: handleArchiveWarningOpenChange,
      };

  const getCurrentRouteTarget = () => {
    return routeTargetRef.current;
  };
  const getCurrentRouteThreadRef = () => {
    const target = getCurrentRouteTarget();
    return target?.kind === "server" ? target.threadRef : null;
  };

  const undoArchiveThreads = (targets: readonly ScopedThreadRef[]) => {
    for (const target of targets) {
      void unarchiveThread(target).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Failed to restore archived agent",
          description: formatSchemaBackedTransportErrorDescription(error, "An error occurred."),
        });
      });
    }
  };

  const cloneThread = async (target: ScopedThreadRef, cwd: string): Promise<void> => {
    if (target.environmentId !== DESKTOP_RUNTIME_ENVIRONMENT_ID) {
      throw new Error("Fork chat is only available for local Pi runtime threads.");
    }

    const resolved = resolveThreadTarget(target);
    if (!resolved) {
      throw new Error("Thread is unavailable.");
    }

    const runtimeApi = readHonkRuntimeApi();
    const targetThreadId = newThreadId();
    const preferences = await runtimeApi.getPreferences();
    const policy = createAgentModelPolicy({
      preferences,
      interactionMode: resolved.thread.interactionMode,
      modelSelection: resolved.thread.modelSelection,
    });

    markLocalRuntimeThread(targetThreadId);
    try {
      await runtimeApi.cloneThread({
        sourceThreadId: target.threadId,
        targetThreadId,
        cwd,
        policy,
      });
    } catch (error) {
      clearLocalRuntimeThread(targetThreadId);
      throw error;
    }

    await openThread(router, scopeThreadRef(DESKTOP_RUNTIME_ENVIRONMENT_ID, targetThreadId));
  };

  const archiveThread = async (target: ScopedThreadRef) => {
    const api = readEnvironmentApi(target.environmentId);
    if (!api) return;
    const resolved = resolveThreadTarget(target);
    if (!resolved) return;
    const { thread, threadRef } = resolved;

    if (threadHasOngoingWork(thread)) {
      const confirmed = await requestArchiveWarningConfirmation([thread.title]);
      if (!confirmed) return;
    }
    await stopThreadWork(threadRef, thread);

    await api.orchestration.dispatchCommand({
      type: "thread.archive",
      commandId: newCommandId(),
      threadId: threadRef.threadId,
    });
    enqueueArchiveUndoToast([{ threadRef, title: thread.title }], undoArchiveThreads);
    const currentRouteThreadRef = getCurrentRouteThreadRef();

    if (
      currentRouteThreadRef?.threadId === threadRef.threadId &&
      currentRouteThreadRef.environmentId === threadRef.environmentId
    ) {
      if (thread.projectId === null) {
        await openChatIndex(router, { replace: true });
        return;
      }
      const workspaceProject = findWorkspaceProjectForSource(
        selectProjectsAcrossEnvironments(useStore.getState()),
        thread,
      );
      if (!workspaceProject) {
        await openChatIndex(router, { replace: true });
        return;
      }
      await handleNewThreadRef.current(
        scopeProjectRef(workspaceProject.environmentId, workspaceProject.id),
      );
    }
  };

  const archiveThreads = async (targets: readonly ScopedThreadRef[]) => {
    const state = useStore.getState();
    const targetByKey = new Map<string, ScopedThreadRef>();
    for (const target of targets) {
      const thread = selectThreadByRef(state, target);
      if (!thread || thread.archivedAt !== null) {
        continue;
      }
      targetByKey.set(scopedThreadKey(target), target);
    }
    const archiveTargets = [...targetByKey.values()];
    if (archiveTargets.length === 0) {
      return;
    }

    const targetsWithOngoingWork = archiveTargets.flatMap((target) => {
      const thread = selectThreadByRef(state, target);
      return thread && threadHasOngoingWork(thread) ? [{ target, thread }] : [];
    });
    if (targetsWithOngoingWork.length > 0) {
      const confirmed = await requestArchiveWarningConfirmation(
        targetsWithOngoingWork.map(({ thread }) => thread.title),
      );
      if (!confirmed) {
        return;
      }
    }
    for (const target of archiveTargets) {
      const thread = selectThreadByRef(state, target);
      if (thread) {
        await stopThreadWork(target, thread);
      }
    }

    const currentRouteThreadRef = getCurrentRouteThreadRef();
    const currentRouteThreadKey = currentRouteThreadRef
      ? scopedThreadKey(currentRouteThreadRef)
      : null;
    const shouldNavigateToFallback =
      currentRouteThreadKey !== null && targetByKey.has(currentRouteThreadKey);
    const currentThread = currentRouteThreadRef
      ? selectThreadByRef(state, currentRouteThreadRef)
      : undefined;
    const projects = selectProjectsAcrossEnvironments(state);
    const currentWorkspaceProject = currentThread
      ? findWorkspaceProjectForSource(projects, currentThread)
      : null;
    const fallbackProjectRef =
      shouldNavigateToFallback && currentWorkspaceProject
        ? scopeProjectRef(currentWorkspaceProject.environmentId, currentWorkspaceProject.id)
        : null;
    const archivedIds =
      shouldNavigateToFallback && currentRouteThreadRef
        ? new Set<ThreadId>(
            archiveTargets.flatMap((target) =>
              target.environmentId === currentRouteThreadRef.environmentId ? [target.threadId] : [],
            ),
          )
        : undefined;
    const fallbackThreadId =
      shouldNavigateToFallback && currentRouteThreadRef && archivedIds
        ? getFallbackThreadIdAfterDelete({
            threads: selectThreadsForEnvironment(state, currentRouteThreadRef.environmentId).filter(
              (thread) => thread.archivedAt === null,
            ),
            deletedThreadId: currentRouteThreadRef.threadId,
            deletedThreadIds: archivedIds,
            sortOrder: sidebarThreadSortOrder,
          })
        : null;
    const fallbackThreadRef =
      fallbackThreadId && currentRouteThreadRef
        ? scopeThreadRef(currentRouteThreadRef.environmentId, fallbackThreadId)
        : null;

    const archivedToastItems: ArchiveToastItem[] = [];
    for (const target of archiveTargets) {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) {
        continue;
      }
      await api.orchestration.dispatchCommand({
        type: "thread.archive",
        commandId: newCommandId(),
        threadId: target.threadId,
      });
      const thread = selectThreadByRef(state, target);
      archivedToastItems.push({
        threadRef: target,
        title: thread?.title ?? null,
      });
    }
    enqueueArchiveUndoToast(archivedToastItems, undoArchiveThreads);

    if (!shouldNavigateToFallback) {
      return;
    }

    if (fallbackThreadRef) {
      await openThread(router, fallbackThreadRef, { replace: true });
      return;
    }

    if (fallbackProjectRef) {
      await handleNewThreadRef.current(fallbackProjectRef);
      return;
    }

    await openChatIndex(router, { replace: true });
  };

  const removeProjectFromSidebar = async (target: ScopedProjectRef) => {
    const api = readEnvironmentApi(target.environmentId);
    if (!api) return;

    const state = useStore.getState();
    const projects = selectProjectsAcrossEnvironments(state);
    const routeTarget = getCurrentRouteTarget();
    const shouldNavigateToFallback =
      routeTarget?.kind === "server"
        ? (() => {
            const thread = selectThreadByRef(state, routeTarget.threadRef);
            return isSourceForWorkspaceProject({ project: target, projects, source: thread });
          })()
        : routeTarget?.kind === "draft"
          ? (() => {
              const draft = useComposerDraftStore.getState().getDraftSession(routeTarget.draftId);
              return isSourceForWorkspaceProject({ project: target, projects, source: draft });
            })()
          : false;
    const fallbackProject = projects.find(
      (project) =>
        project.environmentId !== target.environmentId || project.id !== target.projectId,
    );

    await api.orchestration.dispatchCommand({
      type: "project.delete",
      commandId: newCommandId(),
      projectId: target.projectId,
    });

    const currentSelection = readStoredProjectSelection();
    if (
      currentSelection?.environmentId === target.environmentId &&
      currentSelection.projectId === target.projectId
    ) {
      if (fallbackProject) {
        writeStoredProjectSelection({
          environmentId: fallbackProject.environmentId,
          projectId: fallbackProject.id,
          cwd: fallbackProject.cwd,
        });
      } else if (typeof window !== "undefined") {
        window.localStorage.removeItem(SELECTED_PROJECT_KEY);
        if (window.localStorage.getItem(PROJECT_KEY) === currentSelection.cwd) {
          window.localStorage.removeItem(PROJECT_KEY);
        }
        window.dispatchEvent(new CustomEvent(SHELL_LAYOUT_CHANGED_EVENT));
      }
    }

    if (!shouldNavigateToFallback) {
      return;
    }

    if (fallbackProject) {
      await handleNewThreadRef.current(
        scopeProjectRef(fallbackProject.environmentId, fallbackProject.id),
      );
      return;
    }

    await openChatIndex(router, { replace: true });
  };

  const deleteThread = async (
    target: ScopedThreadRef,
    opts: { deletedThreadKeys?: ReadonlySet<string> } = {},
  ) => {
    const api = readEnvironmentApi(target.environmentId);
    if (!api) return;
    const resolved = resolveThreadTarget(target);
    if (!resolved) return;
    const { thread, threadRef } = resolved;
    const state = useStore.getState();
    const threads = selectThreadsForEnvironment(state, threadRef.environmentId);
    const projects = selectProjectsAcrossEnvironments(state);
    const threadProject = findWorkspaceProjectForSource(projects, thread) ?? undefined;
    const deletedIds =
      opts.deletedThreadKeys && opts.deletedThreadKeys.size > 0
        ? new Set<ThreadId>(
            [...opts.deletedThreadKeys].flatMap((threadKey) => {
              const ref = parseScopedThreadKey(threadKey);
              return ref && ref.environmentId === threadRef.environmentId ? [ref.threadId] : [];
            }),
          )
        : undefined;
    const survivingThreads =
      deletedIds && deletedIds.size > 0
        ? threads.filter((entry) => entry.id === threadRef.threadId || !deletedIds.has(entry.id))
        : threads;
    const orphanedWorktreePath = getOrphanedWorktreePathForThread(
      survivingThreads,
      threadRef.threadId,
    );
    const displayWorktreePath = orphanedWorktreePath
      ? formatWorktreePathForDisplay(orphanedWorktreePath)
      : null;
    const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
    const localApi = readLocalApi();
    const shouldDeleteWorktree =
      canDeleteWorktree &&
      localApi &&
      (await localApi.dialogs.confirm(
        [
          "This thread is the only one linked to this worktree:",
          displayWorktreePath ?? orphanedWorktreePath,
          "",
          "Delete the worktree too?",
        ].join("\n"),
      ));

    if (thread.session && thread.session.status !== "closed") {
      await api.orchestration
        .dispatchCommand({
          type: "thread.session.stop",
          commandId: newCommandId(),
          threadId: threadRef.threadId,
          createdAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }

    try {
      await api.terminal.close({ threadId: threadRef.threadId, deleteHistory: true });
    } catch {
      // Terminal may already be closed.
    }

    const deletedThreadIds = deletedIds ?? new Set<ThreadId>();
    const currentRouteThreadRef = getCurrentRouteThreadRef();
    const shouldNavigateToFallback =
      currentRouteThreadRef?.threadId === threadRef.threadId &&
      currentRouteThreadRef.environmentId === threadRef.environmentId;
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads,
      deletedThreadId: threadRef.threadId,
      deletedThreadIds,
      sortOrder: sidebarThreadSortOrder,
    });
    await api.orchestration.dispatchCommand({
      type: "thread.delete",
      commandId: newCommandId(),
      threadId: threadRef.threadId,
    });
    clearComposerDraftForThread(threadRef);
    if (threadProject) {
      clearProjectDraftThreadById(
        scopeProjectRef(threadProject.environmentId, threadProject.id),
        threadRef,
      );
    }
    if (shouldNavigateToFallback) {
      if (fallbackThreadId) {
        const fallbackThread = selectThreadByRef(
          useStore.getState(),
          scopeThreadRef(threadRef.environmentId, fallbackThreadId),
        );
        if (fallbackThread) {
          await openThread(
            router,
            scopeThreadRef(fallbackThread.environmentId, fallbackThread.id),
            { replace: true },
          );
          return;
        }
      }

      if (threadProject) {
        await handleNewThreadRef.current(
          scopeProjectRef(threadProject.environmentId, threadProject.id),
        );
        return;
      }

      await openChatIndex(router, { replace: true });
    }

    if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
      return;
    }

    try {
      await ensureEnvironmentGitApi(threadProject.environmentId).removeWorktree({
        cwd: threadProject.cwd,
        path: orphanedWorktreePath,
        force: true,
      });
      await invalidateGitQueries(queryClient, {
        environmentId: threadProject.environmentId,
      });
    } catch (error) {
      const message = formatSchemaBackedTransportErrorDescription(
        error,
        "Unknown error removing worktree.",
      );
      console.error("Failed to remove orphaned worktree after thread deletion", {
        threadId: threadRef.threadId,
        projectCwd: threadProject.cwd,
        worktreePath: orphanedWorktreePath,
        error,
      });
      toastManager.add({
        type: "error",
        title: "Thread deleted, but worktree removal failed",
        description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
      });
    }
  };

  const confirmAndDeleteThread = async (target: ScopedThreadRef) => {
    const api = readEnvironmentApi(target.environmentId);
    if (!api) return;
    const localApi = readLocalApi();
    const resolved = resolveThreadTarget(target);
    if (!resolved) return;
    const { thread } = resolved;

    if (confirmThreadDelete && localApi) {
      const confirmed = await localApi.dialogs.confirm(
        [
          `Delete thread "${thread.title}"?`,
          "This permanently clears conversation history for this thread.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }
    }

    await deleteThread(target);
  };

  return {
    commitRename,
    cloneThread,
    archiveThread,
    archiveThreads,
    unarchiveThread,
    deleteThread,
    confirmAndDeleteThread,
    removeProjectFromSidebar,
    archiveWarningDialog,
  };
}
