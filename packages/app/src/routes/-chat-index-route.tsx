import type { EnvironmentId, ScopedProjectRef } from "@multi/contracts";
import { useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import ChatView from "~/components/chat/view/chat-view";
import {
  ensureProjectNewThreadDraftSession,
  ensureProjectlessNewThreadDraftSession,
  useComposerDraftStore,
  type ProjectDraftSession,
  type DraftThreadState,
} from "~/stores/chat-drafts";
import { useStore } from "~/stores/thread-store";
import {
  selectEnvironmentState,
  selectEnvironmentSnapshotSource,
  type EnvironmentSnapshotSource,
} from "~/stores/thread-store";
import { openDraft, openThread } from "~/app/chat-navigation";
import { readLastChatRouteTarget } from "~/routes/-chat-route-persistence";
import {
  readNewThreadProjectDefaults,
  useNewThreadProjectDefaults,
} from "~/hooks/use-handle-new-thread";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { scopeProjectRef } from "~/lib/environment-scope";
import { isSourceForWorkspaceProjectRef } from "~/lib/workspace-target";

export function ChatIndexRouteView() {
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const snapshotSource = useStore((state) =>
    selectEnvironmentSnapshotSource(state, activeEnvironmentId),
  );
  const canUseEnvironment = activeEnvironmentId !== null;

  if (!canUseEnvironment) {
    return null;
  }

  return (
    <ChatIndexAgentPanel
      key={activeEnvironmentId}
      activeEnvironmentId={activeEnvironmentId}
      snapshotSource={snapshotSource}
    />
  );
}

function ChatIndexAgentPanel(props: {
  readonly activeEnvironmentId: EnvironmentId;
  readonly snapshotSource: EnvironmentSnapshotSource;
}) {
  const router = useRouter();
  const [initialRouteTarget] = useState(() => readLastChatRouteTarget());
  const [draftRenderState, setDraftRenderState] = useState<ChatIndexDraftRenderState | null>(() =>
    readChatIndexDraftRenderState(props.activeEnvironmentId),
  );
  const { defaultLogicalProjectKey, defaultProjectRef } = useNewThreadProjectDefaults();
  const environmentProjectCount = useStore(
    (state) => selectEnvironmentState(state, props.activeEnvironmentId).projectIds.length,
  );
  const defaultProjectEnvironmentId = defaultProjectRef?.environmentId ?? null;
  const defaultProjectId = defaultProjectRef?.projectId ?? null;
  const indexDefaultProjectRef = useMemo(
    () =>
      defaultProjectEnvironmentId !== null && defaultProjectId !== null
        ? scopeProjectRef(defaultProjectEnvironmentId, defaultProjectId)
        : null,
    [defaultProjectEnvironmentId, defaultProjectId],
  );

  const serverThreadRefToRestore =
    initialRouteTarget?.kind === "server" &&
    initialRouteTarget.threadRef.environmentId === props.activeEnvironmentId
      ? initialRouteTarget.threadRef
      : null;
  const draftIdToRestore =
    initialRouteTarget?.kind === "draft" ? initialRouteTarget.draftId : null;

  useLayoutSyncEffect(() => {
    if (serverThreadRefToRestore) {
      if (props.snapshotSource !== "server") {
        return;
      }
      void openThread(router, serverThreadRefToRestore, { replace: true });
      return;
    }

    if (draftIdToRestore) {
      const restoredDraftSession = useComposerDraftStore
        .getState()
        .getDraftSession(draftIdToRestore);
      const canRestoreDraft = canRestoreChatIndexDraftSession({
        draftSession: restoredDraftSession,
        defaultProjectRef: indexDefaultProjectRef,
      });
      if (canRestoreDraft && restoredDraftSession) {
        setNextDraftRenderState(draftIdToRestore, restoredDraftSession, setDraftRenderState);
        void openDraft(router, draftIdToRestore, { replace: true });
        return;
      }
    }
    const canCreateProjectlessDraft =
      indexDefaultProjectRef === null &&
      props.snapshotSource === "server" &&
      environmentProjectCount === 0;
    if (indexDefaultProjectRef === null && !canCreateProjectlessDraft) {
      setDraftRenderState((current) => (current?.projectId === null ? null : current));
      return;
    }
    const draftSession = indexDefaultProjectRef
      ? ensureProjectNewThreadDraftSession(indexDefaultProjectRef, {
          logicalProjectKey: defaultLogicalProjectKey,
        })
      : ensureProjectlessNewThreadDraftSession(props.activeEnvironmentId);
    setNextDraftRenderState(draftSession.draftId, draftSession, setDraftRenderState);
    void openDraft(router, draftSession.draftId, { replace: true });
  }, [
    defaultLogicalProjectKey,
    draftIdToRestore,
    environmentProjectCount,
    indexDefaultProjectRef,
    props.activeEnvironmentId,
    props.snapshotSource,
    router,
    serverThreadRefToRestore,
  ]);

  if (!draftRenderState) {
    return null;
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatView
        draftId={draftRenderState.draftId}
        environmentId={draftRenderState.environmentId}
        threadId={draftRenderState.threadId}
        reserveTitleBarControlInset={false}
        routeKind="draft"
      />
    </div>
  );
}

interface ChatIndexDraftRenderState extends DraftThreadState {
  readonly draftId: ProjectDraftSession["draftId"];
}

export function prepareChatIndexRouteDraft(): void {
  const state = useStore.getState();
  const activeEnvironmentId = state.activeEnvironmentId;
  if (activeEnvironmentId === null) {
    return;
  }

  const initialRouteTarget = readLastChatRouteTarget();
  if (
    initialRouteTarget?.kind === "server" &&
    initialRouteTarget.threadRef.environmentId === activeEnvironmentId
  ) {
    return;
  }

  const { defaultLogicalProjectKey, defaultProjectRef } = readNewThreadProjectDefaults();
  if (initialRouteTarget?.kind === "draft") {
    const restoredDraftSession = useComposerDraftStore
      .getState()
      .getDraftSession(initialRouteTarget.draftId);
    if (
      canRestoreChatIndexDraftSession({
        draftSession: restoredDraftSession,
        defaultProjectRef,
      })
    ) {
      return;
    }
  }

  const environment = selectEnvironmentState(state, activeEnvironmentId);
  const canCreateProjectlessDraft =
    defaultProjectRef === null &&
    environment.snapshotSource === "server" &&
    environment.projectIds.length === 0;
  if (defaultProjectRef === null && !canCreateProjectlessDraft) {
    return;
  }

  if (defaultProjectRef) {
    ensureProjectNewThreadDraftSession(defaultProjectRef, {
      logicalProjectKey: defaultLogicalProjectKey,
    });
    return;
  }

  ensureProjectlessNewThreadDraftSession(activeEnvironmentId);
}

function readChatIndexDraftRenderState(
  activeEnvironmentId: EnvironmentId,
): ChatIndexDraftRenderState | null {
  const { defaultProjectRef } = readNewThreadProjectDefaults();
  const draftStore = useComposerDraftStore.getState();
  const initialRouteTarget = readLastChatRouteTarget();
  if (
    initialRouteTarget?.kind === "server" &&
    initialRouteTarget.threadRef.environmentId === activeEnvironmentId
  ) {
    return null;
  }

  if (initialRouteTarget?.kind === "draft") {
    const restoredDraftSession = draftStore.getDraftSession(initialRouteTarget.draftId);
    if (
      canRestoreChatIndexDraftSession({
        draftSession: restoredDraftSession,
        defaultProjectRef,
      }) &&
      restoredDraftSession
    ) {
      return toChatIndexDraftRenderState(initialRouteTarget.draftId, restoredDraftSession);
    }
  }

  if (defaultProjectRef) {
    const draftSession = draftStore.getDraftSessionByProjectRef(defaultProjectRef);
    return draftSession ? toChatIndexDraftRenderState(draftSession.draftId, draftSession) : null;
  }

  const projectlessDraftSession = draftStore.getProjectlessDraftSession(activeEnvironmentId);
  return projectlessDraftSession
    ? toChatIndexDraftRenderState(projectlessDraftSession.draftId, projectlessDraftSession)
    : null;
}

function toChatIndexDraftRenderState(
  draftId: ProjectDraftSession["draftId"],
  draftSession: DraftThreadState,
): ChatIndexDraftRenderState {
  return {
    draftId,
    ...draftSession,
  };
}

function chatIndexDraftRenderStatesEqual(
  left: ChatIndexDraftRenderState | null,
  right: ChatIndexDraftRenderState,
): left is ChatIndexDraftRenderState {
  return (
    left !== null &&
    left.draftId === right.draftId &&
    left.threadId === right.threadId &&
    left.environmentId === right.environmentId &&
    left.projectId === right.projectId &&
    left.logicalProjectKey === right.logicalProjectKey &&
    left.createdAt === right.createdAt &&
    left.interactionMode === right.interactionMode &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.envMode === right.envMode &&
    left.promotedTo?.environmentId === right.promotedTo?.environmentId &&
    left.promotedTo?.threadId === right.promotedTo?.threadId
  );
}

function setNextDraftRenderState(
  draftId: ProjectDraftSession["draftId"],
  draftSession: DraftThreadState,
  setDraftRenderState: (
    update: (current: ChatIndexDraftRenderState | null) => ChatIndexDraftRenderState,
  ) => void,
): void {
  const nextRenderState = toChatIndexDraftRenderState(draftId, draftSession);
  setDraftRenderState((current) =>
    chatIndexDraftRenderStatesEqual(current, nextRenderState) ? current : nextRenderState,
  );
}

export function canRestoreChatIndexDraftSession(input: {
  readonly draftSession: DraftThreadState | null;
  readonly defaultProjectRef: ScopedProjectRef | null;
}): boolean {
  if (input.draftSession === null || input.draftSession.promotedTo != null) {
    return false;
  }
  return input.defaultProjectRef === null
    ? input.draftSession.projectId === null
    : isSourceForWorkspaceProjectRef({
        projectRef: input.defaultProjectRef,
        source: input.draftSession,
      });
}
