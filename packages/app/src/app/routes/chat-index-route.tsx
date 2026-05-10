import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useComposerDraftStore } from "~/composer-draft-store";
import { useStore } from "~/store";
import { selectEnvironmentState } from "~/store";
import { newDraftId, newThreadId } from "~/lib/utils";
import { readLastChatRouteTarget } from "~/chat-route-persistence";
import { buildDraftThreadRouteParams } from "~/thread-routes";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";

export function ChatIndexRouteView() {
  const navigate = useNavigate();
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const bootstrapComplete = useStore(
    (state) => selectEnvironmentState(state, activeEnvironmentId).bootstrapComplete,
  );
  const getProjectlessDraftSession = useComposerDraftStore(
    (store) => store.getProjectlessDraftSession,
  );
  const setProjectlessDraftThreadId = useComposerDraftStore(
    (store) => store.setProjectlessDraftThreadId,
  );

  useEffect(() => {
    if (!activeEnvironmentId || !bootstrapComplete) {
      return;
    }
    const lastChatRouteTarget = readLastChatRouteTarget();
    if (lastChatRouteTarget?.kind === "draft") {
      void navigate({
        to: "/draft/$draftId",
        params: { draftId: lastChatRouteTarget.draftId },
        replace: true,
      });
      return;
    }
    if (lastChatRouteTarget?.kind === "server") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: lastChatRouteTarget.threadRef.environmentId,
          threadId: lastChatRouteTarget.threadRef.threadId,
        },
        replace: true,
      });
      return;
    }

    const existingDraft = getProjectlessDraftSession(activeEnvironmentId);
    const draftId = existingDraft?.draftId ?? newDraftId();
    if (!existingDraft) {
      setProjectlessDraftThreadId(activeEnvironmentId, draftId, {
        threadId: newThreadId(),
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
      });
    }
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(draftId),
      replace: true,
    });
  }, [
    activeEnvironmentId,
    bootstrapComplete,
    getProjectlessDraftSession,
    navigate,
    setProjectlessDraftThreadId,
  ]);

  return null;
}
