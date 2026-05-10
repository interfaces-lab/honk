import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import ChatView from "~/components/chat-view";
import { threadHasStarted } from "~/components/chat-view.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "~/composer-draft-store";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "~/store";
import { createThreadSelectorByRef } from "~/store-selectors";
import {
  clearLastChatRouteTarget,
  writeLastChatRouteTarget,
} from "~/chat-route-persistence";
import { resolveThreadRouteRef } from "~/thread-routes";
import { traceBrowserEvent } from "~/observability/browserDebug";

const routeApi = getRouteApi("/_chat/$environmentId/$threadId");
type ThreadRouteRef = NonNullable<ReturnType<typeof resolveThreadRouteRef>>;

function ChatThreadMainPanel(props: { threadRef: ThreadRouteRef }) {
  const { threadRef } = props;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatView
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        reserveTitleBarControlInset={false}
        routeKind="server"
      />
    </div>
  );
}

export function ChatThreadRouteView() {
  const threadRef = routeApi.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const navigate = useNavigate();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (routeThreadExists) {
      writeLastChatRouteTarget({ kind: "server", threadRef });
      return;
    }

    if (environmentHasAnyThreads) {
      traceBrowserEvent(
        "route.thread.missing.navigate-home",
        {
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
          bootstrapComplete,
          threadExists,
          draftThreadExists,
          environmentHasAnyThreads,
        },
        "warn",
      );
      clearLastChatRouteTarget({ kind: "server", threadRef });
      void navigate({ to: "/", replace: true });
      return;
    }

    clearLastChatRouteTarget({ kind: "server", threadRef });
    void navigate({ to: "/", replace: true });
  }, [
    bootstrapComplete,
    draftThreadExists,
    environmentHasAnyThreads,
    navigate,
    routeThreadExists,
    threadExists,
    threadRef,
  ]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete) {
    traceBrowserEvent("route.thread.empty.waiting-bootstrap", {
      hasThreadRef: Boolean(threadRef),
      bootstrapComplete,
    });
    return null;
  }

  if (!routeThreadExists) {
    traceBrowserEvent(
      "route.thread.empty.missing-thread",
      {
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
        threadExists,
        draftThreadExists,
      },
      "warn",
    );
    return null;
  }

  return <ChatThreadMainPanel threadRef={threadRef} />;
}
