import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import ChatView from "~/components/chat/view/chat-view";
import { threadHasStarted } from "~/components/chat/view/chat-view.logic";
import { useComposerDraftStore, DraftId } from "~/composer-draft-store";
import { createThreadSelectorAcrossEnvironments } from "~/store-selectors";
import { useStore } from "~/store";
import { clearLastChatRouteTarget, writeLastChatRouteTarget } from "~/chat-route-persistence";
import { buildThreadRouteParams } from "~/thread-routes";
import { traceBrowserEvent } from "~/observability/browserDebug";

const routeApi = getRouteApi("/_chat/draft/$draftId");

export function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = routeApi.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted
          ? draftSession.promotedTo
          : null
        : serverThread
          ? {
              environmentId: serverThread.environmentId,
              threadId: serverThread.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted],
  );

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    writeLastChatRouteTarget({ kind: "server", threadRef: canonicalThreadRef });
    traceBrowserEvent("route.draft.promoted.navigate", {
      draftId,
      environmentId: canonicalThreadRef.environmentId,
      threadId: canonicalThreadRef.threadId,
    });
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, draftId, navigate]);

  useEffect(() => {
    if (canonicalThreadRef) {
      return;
    }
    if (draftSession) {
      writeLastChatRouteTarget({ kind: "draft", draftId });
      return;
    }
    clearLastChatRouteTarget({ kind: "draft", draftId });
    traceBrowserEvent("route.draft.missing.navigate-home", { draftId }, "warn");
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftId, draftSession, navigate]);

  if (canonicalThreadRef) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          reserveTitleBarControlInset={false}
          routeKind="server"
        />
      </div>
    );
  }

  if (!draftSession) {
    traceBrowserEvent("route.draft.empty.no-draft-session", { draftId }, "warn");
    return null;
  }

  traceBrowserEvent("route.draft.render-chat-view", {
    draftId,
    environmentId: draftSession.environmentId,
    threadId: draftSession.threadId,
  });

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatView
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        reserveTitleBarControlInset={false}
        routeKind="draft"
      />
    </div>
  );
}
