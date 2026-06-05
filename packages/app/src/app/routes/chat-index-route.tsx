import type { EnvironmentId } from "@multi/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  ensureProjectEmptyStateDraftSession,
  ensureProjectlessEmptyStateDraftSession,
  useComposerDraftStore,
} from "~/stores/chat-drafts";
import { useStore } from "~/stores/thread-store";
import {
  selectEnvironmentSnapshotSource,
  type EnvironmentSnapshotSource,
} from "~/stores/thread-store";
import { openDraft, openThread } from "~/app/chat-navigation";
import { readLastChatRouteTarget } from "~/app/routes/chat-route-persistence";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";
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
      key={`${activeEnvironmentId}:${snapshotSource}`}
      activeEnvironmentId={activeEnvironmentId}
      snapshotSource={snapshotSource}
    />
  );
}

function ChatIndexAgentPanel(props: {
  readonly activeEnvironmentId: EnvironmentId;
  readonly snapshotSource: EnvironmentSnapshotSource;
}) {
  const navigate = useNavigate();
  const [initialRouteTarget] = useState(() => readLastChatRouteTarget());
  const { defaultLogicalProjectKey, defaultProjectRef } = useHandleNewThread();

  const shouldRestoreServerThread =
    initialRouteTarget?.kind === "server" &&
    props.snapshotSource === "server" &&
    initialRouteTarget.threadRef.environmentId === props.activeEnvironmentId;
  const draftIdToRestore =
    initialRouteTarget?.kind === "draft" ? initialRouteTarget.draftId : null;

  useEffect(() => {
    if (!shouldRestoreServerThread) {
      return;
    }
    void openThread(navigate, initialRouteTarget.threadRef, { replace: true });
  }, [initialRouteTarget, navigate, shouldRestoreServerThread]);

  useEffect(() => {
    if (shouldRestoreServerThread) {
      return;
    }
    if (draftIdToRestore) {
      const restoredDraftSession = useComposerDraftStore.getState().getDraftSession(draftIdToRestore);
      const canRestoreDraft =
        restoredDraftSession !== null &&
        (defaultProjectRef === null
          ? restoredDraftSession.projectId === null
          : isSourceForWorkspaceProjectRef({
              projectRef: defaultProjectRef,
              source: restoredDraftSession,
            }));
      if (canRestoreDraft) {
        void openDraft(navigate, draftIdToRestore, { replace: true });
        return;
      }
    }
    const draftSession = defaultProjectRef
      ? ensureProjectEmptyStateDraftSession(defaultProjectRef, {
          logicalProjectKey: defaultLogicalProjectKey,
        })
      : ensureProjectlessEmptyStateDraftSession(props.activeEnvironmentId);
    void openDraft(navigate, draftSession.draftId, { replace: true });
  }, [
    defaultLogicalProjectKey,
    defaultProjectRef,
    draftIdToRestore,
    navigate,
    props.activeEnvironmentId,
    shouldRestoreServerThread,
  ]);

  return null;
}
