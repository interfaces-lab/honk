import type { EnvironmentId } from "@multi/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import ChatView from "~/components/chat/view/chat-view";
import {
  ensureProjectEmptyStateDraftSession,
  ensureProjectlessEmptyStateDraftSession,
} from "~/stores/chat-drafts";
import { useStore } from "~/stores/thread-store";
import {
  selectEnvironmentSnapshotSource,
  type EnvironmentSnapshotSource,
} from "~/stores/thread-store";
import { readLastChatRouteTarget } from "~/app/routes/chat-route-persistence";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";

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
  const { defaultProjectRef } = useHandleNewThread();

  const shouldRestoreServerThread =
    initialRouteTarget?.kind === "server" &&
    props.snapshotSource === "server" &&
    initialRouteTarget.threadRef.environmentId === props.activeEnvironmentId;

  useEffect(() => {
    if (!shouldRestoreServerThread) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: initialRouteTarget.threadRef.environmentId,
        threadId: initialRouteTarget.threadRef.threadId,
      },
      replace: true,
    });
  }, [initialRouteTarget, navigate, shouldRestoreServerThread]);

  if (shouldRestoreServerThread) {
    return null;
  }

  const draftSession = defaultProjectRef
    ? ensureProjectEmptyStateDraftSession(defaultProjectRef)
    : ensureProjectlessEmptyStateDraftSession(props.activeEnvironmentId);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatView
        draftId={draftSession.draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        reserveTitleBarControlInset={false}
        routeKind="draft"
      />
    </div>
  );
}
