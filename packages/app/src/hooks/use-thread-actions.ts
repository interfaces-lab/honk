import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "~/lib/environment-scope";
import { type ScopedProjectRef, type ScopedThreadRef, ThreadId } from "@multi/contracts";
import type { SidebarThreadSortOrder } from "@multi/contracts/settings";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef } from "react";

import { useComposerDraftStore } from "../stores/chat-drafts";
import { useNewThreadHandler } from "./use-handle-new-thread";
import { readEnvironmentApi } from "../environment-api";
import { invalidateGitQueries } from "../lib/git-react-query";
import { ensureEnvironmentGitApi } from "../lib/environment-git-api";
import { sortThreads, type ThreadSortInput } from "../lib/thread-sort";
import { newCommandId } from "../lib/utils";
import { readLocalApi } from "../local-api";
import {
  selectProjectByRef,
  selectProjectsAcrossEnvironments,
  selectThreadByRef,
  selectThreadsForEnvironment,
  useStore,
} from "../stores/thread-store";
import { useTerminalStateStore } from "../terminal-state-store";
import {
  buildThreadRouteParams,
  resolveThreadRouteTarget,
} from "~/app/routes/thread-route-targets";
import {
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForThread,
} from "../git/worktree-cleanup";
import { toastManager } from "~/app/toast";
import { formatSchemaBackedTransportErrorDescription } from "~/rpc/transport-error";
import { useSettings } from "./use-settings";
import type { Thread } from "../types";

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

async function unarchiveThread(target: ScopedThreadRef): Promise<void> {
  const api = readEnvironmentApi(target.environmentId);
  if (!api) return;
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
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const router = useRouter();
  const { handleNewThread } = useNewThreadHandler();
  // Keep a ref so archiveThread can call handleNewThread without appearing in
  // its dependency array — handleNewThread is inherently unstable (depends on
  // the projects list) and would otherwise cascade new references into every
  // sidebar row via archiveThread → attemptArchiveThread.
  const handleNewThreadRef = useRef(handleNewThread);
  handleNewThreadRef.current = handleNewThread;
  const queryClient = useQueryClient();

  const getCurrentRouteTarget = () => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteTarget(currentRouteParams);
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

  const archiveThread = async (target: ScopedThreadRef) => {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) return;
      const resolved = resolveThreadTarget(target);
      if (!resolved) return;
      const { thread, threadRef } = resolved;

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
          await router.navigate({ to: "/", replace: true });
          return;
        }
        await handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId));
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

      const currentRouteThreadRef = getCurrentRouteThreadRef();
      const currentRouteThreadKey = currentRouteThreadRef
        ? scopedThreadKey(currentRouteThreadRef)
        : null;
      const shouldNavigateToFallback =
        currentRouteThreadKey !== null && targetByKey.has(currentRouteThreadKey);
      const currentThread = currentRouteThreadRef
        ? selectThreadByRef(state, currentRouteThreadRef)
        : undefined;
      const fallbackProjectRef =
        shouldNavigateToFallback && currentThread?.projectId !== null && currentThread !== undefined
          ? scopeProjectRef(currentThread.environmentId, currentThread.projectId)
          : null;
      const archivedIds =
        shouldNavigateToFallback && currentRouteThreadRef
          ? new Set<ThreadId>(
              archiveTargets.flatMap((target) =>
                target.environmentId === currentRouteThreadRef.environmentId
                  ? [target.threadId]
                  : [],
              ),
            )
          : undefined;
      const fallbackThreadId =
        shouldNavigateToFallback && currentRouteThreadRef && archivedIds
          ? getFallbackThreadIdAfterDelete({
              threads: selectThreadsForEnvironment(
                state,
                currentRouteThreadRef.environmentId,
              ).filter((thread) => thread.archivedAt === null),
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
        await router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(fallbackThreadRef),
          replace: true,
        });
        return;
      }

      if (fallbackProjectRef) {
        await handleNewThreadRef.current(fallbackProjectRef);
        return;
      }

      await router.navigate({ to: "/", replace: true });
  };

  const removeProjectFromSidebar = async (target: ScopedProjectRef) => {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) return;

      const state = useStore.getState();
      const routeTarget = getCurrentRouteTarget();
      const shouldNavigateToFallback =
        routeTarget?.kind === "server"
          ? (() => {
              const thread = selectThreadByRef(state, routeTarget.threadRef);
              return (
                thread?.environmentId === target.environmentId &&
                thread.projectId === target.projectId
              );
            })()
          : routeTarget?.kind === "draft"
            ? (() => {
                const draft = useComposerDraftStore.getState().getDraftSession(routeTarget.draftId);
                return (
                  draft?.environmentId === target.environmentId &&
                  draft.projectId === target.projectId
                );
              })()
            : false;
      const fallbackProject = selectProjectsAcrossEnvironments(state).find(
        (project) =>
          project.environmentId !== target.environmentId || project.id !== target.projectId,
      );

      await api.orchestration.dispatchCommand({
        type: "project.delete",
        commandId: newCommandId(),
        projectId: target.projectId,
      });

      if (!shouldNavigateToFallback) {
        return;
      }

      if (fallbackProject) {
        await handleNewThreadRef.current(
          scopeProjectRef(fallbackProject.environmentId, fallbackProject.id),
        );
        return;
      }

      await router.navigate({ to: "/", replace: true });
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
      const threadProject =
        thread.projectId === null
          ? undefined
          : selectProjectByRef(state, {
              environmentId: threadRef.environmentId,
              projectId: thread.projectId,
            });
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
      if (thread.projectId !== null) {
        clearProjectDraftThreadById(
          scopeProjectRef(threadRef.environmentId, thread.projectId),
          threadRef,
        );
      }
      clearTerminalState(threadRef);

      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          const fallbackThread = selectThreadByRef(
            useStore.getState(),
            scopeThreadRef(threadRef.environmentId, fallbackThreadId),
          );
          if (fallbackThread) {
            await router.navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(
                scopeThreadRef(fallbackThread.environmentId, fallbackThread.id),
              ),
              replace: true,
            });
          } else {
            await router.navigate({ to: "/", replace: true });
          }
        } else {
          await router.navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return;
      }

      try {
        await ensureEnvironmentGitApi(threadRef.environmentId).removeWorktree({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
        await invalidateGitQueries(queryClient, {
          environmentId: threadRef.environmentId,
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
    archiveThread,
    archiveThreads,
    unarchiveThread,
    deleteThread,
    confirmAndDeleteThread,
    removeProjectFromSidebar,
  };
}
