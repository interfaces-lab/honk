import type { EnvironmentId, ScopedProjectRef } from "@multi/contracts";
import { useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import ChatView from "~/components/chat/view/chat-view";
import {
  DraftId,
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
import { openDraft } from "~/app/chat-navigation";
import { readLastChatRouteTarget } from "~/routes/-chat-route-persistence";
import {
  readSelectedWorkspaceProject,
  useSelectedWorkspaceProject,
} from "~/lib/selected-workspace-project";
import { newThreadId } from "~/lib/utils";
import { DEFAULT_INTERACTION_MODE } from "~/types";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { scopedProjectKey, scopeProjectRef } from "~/lib/environment-scope";
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
  const { logicalProjectKey, projectRef: selectedProjectRef } = useSelectedWorkspaceProject();
  const environmentProjectCount = useStore(
    (state) => selectEnvironmentState(state, props.activeEnvironmentId).projectIds.length,
  );
  const indexSelectedProjectRef = useMemo(
    () =>
      selectedProjectRef?.environmentId && selectedProjectRef.projectId
        ? scopeProjectRef(selectedProjectRef.environmentId, selectedProjectRef.projectId)
        : null,
    [selectedProjectRef?.environmentId, selectedProjectRef?.projectId],
  );

  const draftIdToRestore = initialRouteTarget?.kind === "draft" ? initialRouteTarget.draftId : null;

  useLayoutSyncEffect(() => {
    if (draftIdToRestore) {
      const restoredDraftSession = useComposerDraftStore
        .getState()
        .getDraftSession(draftIdToRestore);
      const canRestoreDraft = canRestoreChatIndexDraftSession({
        draftSession: restoredDraftSession,
        selectedProjectRef: indexSelectedProjectRef,
      });
      if (canRestoreDraft && restoredDraftSession) {
        setNextDraftRenderState(draftIdToRestore, restoredDraftSession, setDraftRenderState);
        void openDraft(router, draftIdToRestore, { replace: true });
        return;
      }
    }
    const canCreateProjectlessDraft =
      indexSelectedProjectRef === null &&
      props.snapshotSource === "server" &&
      environmentProjectCount === 0;
    if (indexSelectedProjectRef === null && !canCreateProjectlessDraft) {
      setDraftRenderState((current) => (current?.projectId === null ? null : current));
      return;
    }
    const draftStore = useComposerDraftStore.getState();
    if (indexSelectedProjectRef) {
      const unsentDraft =
        (logicalProjectKey
          ? draftStore.getDraftSessionByLogicalProjectKey(logicalProjectKey)
          : null) ?? draftStore.getDraftSessionByProjectRef(indexSelectedProjectRef);
      if (unsentDraft && unsentDraft.promotedTo == null) {
        setNextDraftRenderState(unsentDraft.draftId, unsentDraft, setDraftRenderState);
        void openDraft(router, unsentDraft.draftId, { replace: true });
        return;
      }
      const draftId = DraftId.make(
        `new-thread-draft:project:${indexSelectedProjectRef.environmentId}:${indexSelectedProjectRef.projectId}`,
      );
      draftStore.setLogicalProjectDraftThreadId(
        logicalProjectKey ?? scopedProjectKey(indexSelectedProjectRef),
        indexSelectedProjectRef,
        draftId,
        {
          threadId: newThreadId(),
          createdAt: new Date().toISOString(),
          interactionMode: DEFAULT_INTERACTION_MODE,
          envMode: "local",
        },
      );
      draftStore.clearComposerContent(draftId);
      const draftSession = draftStore.getDraftSession(draftId);
      if (!draftSession) {
        return;
      }
      setNextDraftRenderState(draftId, draftSession, setDraftRenderState);
      void openDraft(router, draftId, { replace: true });
      return;
    }
    const projectlessDraft = draftStore.getProjectlessDraftSession(props.activeEnvironmentId);
    if (projectlessDraft && projectlessDraft.promotedTo == null) {
      setNextDraftRenderState(projectlessDraft.draftId, projectlessDraft, setDraftRenderState);
      void openDraft(router, projectlessDraft.draftId, { replace: true });
      return;
    }
    const projectlessDraftId = DraftId.make(
      `new-thread-draft:projectless:${props.activeEnvironmentId}`,
    );
    draftStore.setProjectlessDraftThreadId(props.activeEnvironmentId, projectlessDraftId, {
      threadId: newThreadId(),
      createdAt: new Date().toISOString(),
      interactionMode: DEFAULT_INTERACTION_MODE,
    });
    draftStore.clearComposerContent(projectlessDraftId);
    const projectlessDraftSession = draftStore.getDraftSession(projectlessDraftId);
    if (!projectlessDraftSession) {
      return;
    }
    setNextDraftRenderState(projectlessDraftId, projectlessDraftSession, setDraftRenderState);
    void openDraft(router, projectlessDraftId, { replace: true });
  }, [
    logicalProjectKey,
    draftIdToRestore,
    environmentProjectCount,
    indexSelectedProjectRef,
    props.activeEnvironmentId,
    props.snapshotSource,
    router,
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

  const { logicalProjectKey, projectRef: selectedProjectRef } = readSelectedWorkspaceProject();
  const initialRouteTarget = readLastChatRouteTarget();
  if (initialRouteTarget?.kind === "draft") {
    const restoredDraftSession = useComposerDraftStore
      .getState()
      .getDraftSession(initialRouteTarget.draftId);
    if (
      canRestoreChatIndexDraftSession({
        draftSession: restoredDraftSession,
        selectedProjectRef,
      })
    ) {
      return;
    }
  }

  const environment = selectEnvironmentState(state, activeEnvironmentId);
  const canCreateProjectlessDraft =
    selectedProjectRef === null &&
    environment.snapshotSource === "server" &&
    environment.projectIds.length === 0;
  if (selectedProjectRef === null && !canCreateProjectlessDraft) {
    return;
  }

  const draftStore = useComposerDraftStore.getState();
  if (selectedProjectRef) {
    const unsentDraft =
      (logicalProjectKey
        ? draftStore.getDraftSessionByLogicalProjectKey(logicalProjectKey)
        : null) ?? draftStore.getDraftSessionByProjectRef(selectedProjectRef);
    if (unsentDraft && unsentDraft.promotedTo == null) {
      return;
    }
    const draftId = DraftId.make(
      `new-thread-draft:project:${selectedProjectRef.environmentId}:${selectedProjectRef.projectId}`,
    );
    draftStore.setLogicalProjectDraftThreadId(
      logicalProjectKey ?? scopedProjectKey(selectedProjectRef),
      selectedProjectRef,
      draftId,
      {
        threadId: newThreadId(),
        createdAt: new Date().toISOString(),
        interactionMode: DEFAULT_INTERACTION_MODE,
        envMode: "local",
      },
    );
    draftStore.clearComposerContent(draftId);
    return;
  }

  const projectlessDraft = draftStore.getProjectlessDraftSession(activeEnvironmentId);
  if (projectlessDraft && projectlessDraft.promotedTo == null) {
    return;
  }
  const projectlessDraftId = DraftId.make(`new-thread-draft:projectless:${activeEnvironmentId}`);
  draftStore.setProjectlessDraftThreadId(activeEnvironmentId, projectlessDraftId, {
    threadId: newThreadId(),
    createdAt: new Date().toISOString(),
    interactionMode: DEFAULT_INTERACTION_MODE,
  });
  draftStore.clearComposerContent(projectlessDraftId);
}

function readChatIndexDraftRenderState(
  activeEnvironmentId: EnvironmentId,
): ChatIndexDraftRenderState | null {
  const { logicalProjectKey, projectRef: selectedProjectRef } = readSelectedWorkspaceProject();
  const draftStore = useComposerDraftStore.getState();
  const initialRouteTarget = readLastChatRouteTarget();

  if (initialRouteTarget?.kind === "draft") {
    const restoredDraftSession = draftStore.getDraftSession(initialRouteTarget.draftId);
    if (
      canRestoreChatIndexDraftSession({
        draftSession: restoredDraftSession,
        selectedProjectRef,
      }) &&
      restoredDraftSession
    ) {
      return toChatIndexDraftRenderState(initialRouteTarget.draftId, restoredDraftSession);
    }
  }

  if (selectedProjectRef) {
    const draftSession =
      (logicalProjectKey
        ? draftStore.getDraftSessionByLogicalProjectKey(logicalProjectKey)
        : null) ?? draftStore.getDraftSessionByProjectRef(selectedProjectRef);
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
  readonly selectedProjectRef: ScopedProjectRef | null;
}): boolean {
  if (input.draftSession === null || input.draftSession.promotedTo != null) {
    return false;
  }
  return input.selectedProjectRef === null
    ? input.draftSession.projectId === null
    : isSourceForWorkspaceProjectRef({
        projectRef: input.selectedProjectRef,
        source: input.draftSession,
      });
}
