import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { NoActiveThreadState } from "~/components/no-active-thread-state";
import { useComposerDraftStore } from "~/composer-draft-store";
import { useStore } from "~/store";
import { selectEnvironmentState } from "~/store";
import { newDraftId, newThreadId } from "~/lib/utils";
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

  return <NoActiveThreadState />;
}
