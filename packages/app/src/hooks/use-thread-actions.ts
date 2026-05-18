import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@multi/client-runtime";
import { type ScopedProjectRef, type ScopedThreadRef, ThreadId } from "@multi/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef } from "react";

import { getFallbackThreadIdAfterDelete } from "../lib/thread-sidebar";
import { useComposerDraftStore } from "../stores/chat-drafts";
import { useNewThreadHandler } from "./use-handle-new-thread";
import { ensureEnvironmentApi, readEnvironmentApi } from "../environment-api";
import { invalidateGitQueries } from "../lib/git-react-query";
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
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../thread-routes";
import {
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForThread,
} from "../worktree-cleanup";
import { toastManager } from "~/app/toast";
import { useSettings } from "./use-settings";

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

  const resolveThreadTarget = useCallback((target: ScopedThreadRef) => {
    const state = useStore.getState();
    const thread = selectThreadByRef(state, target);
    if (!thread) {
      return null;
    }
    return {
      thread,
      threadRef: target,
    };
  }, []);
  const getCurrentRouteTarget = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteTarget(currentRouteParams);
  }, [router]);
  const getCurrentRouteThreadRef = useCallback(() => {
    const target = getCurrentRouteTarget();
    return target?.kind === "server" ? target.threadRef : null;
  }, [getCurrentRouteTarget]);

  const commitRename = useCallback(
    async (target: ScopedThreadRef, newTitle: string, originalTitle: string) => {
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
    },
    [],
  );

  const archiveThread = useCallback(
    async (target: ScopedThreadRef) => {
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
    },
    [getCurrentRouteThreadRef, resolveThreadTarget, router],
  );

  const archiveThreads = useCallback(
    async (targets: readonly ScopedThreadRef[]) => {
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
      }

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
    },
    [getCurrentRouteThreadRef, router, sidebarThreadSortOrder],
  );

  const removeProjectFromSidebar = useCallback(
    async (target: ScopedProjectRef) => {
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
    },
    [getCurrentRouteTarget, router],
  );

  const unarchiveThread = useCallback(async (target: ScopedThreadRef) => {
    const api = readEnvironmentApi(target.environmentId);
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "thread.unarchive",
      commandId: newCommandId(),
      threadId: target.threadId,
    });
  }, []);

  const deleteThread = useCallback(
    async (target: ScopedThreadRef, opts: { deletedThreadKeys?: ReadonlySet<string> } = {}) => {
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
        await ensureEnvironmentApi(threadRef.environmentId).git.removeWorktree({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
        await invalidateGitQueries(queryClient, {
          environmentId: threadRef.environmentId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
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
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      getCurrentRouteThreadRef,
      router,
      queryClient,
      resolveThreadTarget,
      sidebarThreadSortOrder,
    ],
  );

  const confirmAndDeleteThread = useCallback(
    async (target: ScopedThreadRef) => {
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
    },
    [confirmThreadDelete, deleteThread, resolveThreadTarget],
  );

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
