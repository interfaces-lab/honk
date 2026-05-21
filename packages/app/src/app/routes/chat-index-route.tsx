import type { EnvironmentId } from "@multi/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useComposerDraftStore } from "~/stores/chat-drafts";
import { useStore } from "~/stores/thread-store";
import {
  selectEnvironmentSnapshotSource,
  type EnvironmentSnapshotSource,
} from "~/stores/thread-store";
import { newDraftId, newThreadId } from "~/lib/utils";
import { readLastChatRouteTarget } from "~/app/routes/chat-route-persistence";
import { buildDraftThreadRouteParams } from "~/app/routes/thread-route-targets";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";
import { useMountEffect } from "~/hooks/use-mount-effect";

export function ChatIndexRouteView() {
  const navigate = useNavigate();
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const snapshotSource = useStore((state) =>
    selectEnvironmentSnapshotSource(state, activeEnvironmentId),
  );

  if (!activeEnvironmentId || snapshotSource === "none") {
    return null;
  }

  return (
    <ChatIndexRouteSync
      key={`${activeEnvironmentId}:${snapshotSource}`}
      activeEnvironmentId={activeEnvironmentId}
      navigate={navigate}
      snapshotSource={snapshotSource}
    />
  );
}

function ChatIndexRouteSync(props: {
  readonly activeEnvironmentId: EnvironmentId;
  readonly navigate: ReturnType<typeof useNavigate>;
  readonly snapshotSource: EnvironmentSnapshotSource;
}) {
  const getProjectlessDraftSession = useComposerDraftStore(
    (store) => store.getProjectlessDraftSession,
  );
  const setProjectlessDraftThreadId = useComposerDraftStore(
    (store) => store.setProjectlessDraftThreadId,
  );
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);

  useMountEffect(() => {
    const lastChatRouteTarget = readLastChatRouteTarget();
    if (lastChatRouteTarget?.kind === "draft") {
      void props.navigate({
        to: "/draft/$draftId",
        params: { draftId: lastChatRouteTarget.draftId },
        replace: true,
      });
      return;
    }
    if (lastChatRouteTarget?.kind === "server") {
      void props.navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: lastChatRouteTarget.threadRef.environmentId,
          threadId: lastChatRouteTarget.threadRef.threadId,
        },
        replace: true,
      });
      return;
    }

    if (props.snapshotSource !== "server") {
      return;
    }

    const existingDraft = getProjectlessDraftSession(props.activeEnvironmentId);
    const draftId = existingDraft?.draftId ?? newDraftId();
    if (!existingDraft) {
      setProjectlessDraftThreadId(props.activeEnvironmentId, draftId, {
        threadId: newThreadId(),
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
      });
      applyStickyState(draftId);
    }
    void props.navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(draftId),
      replace: true,
    });
  });

  return null;
}
