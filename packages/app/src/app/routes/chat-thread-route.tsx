import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import ChatView from "~/components/chat/view/chat-view";
import { threadHasStarted } from "~/components/chat/view/thread-lifecycle";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "~/stores/chat-drafts";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "~/stores/thread-store";
import { createThreadSelectorByRef } from "~/stores/thread-selectors";
import {
  clearLastChatRouteTarget,
  writeLastChatRouteTarget,
} from "~/app/routes/chat-route-persistence";
import { resolveThreadRouteRef } from "~/app/routes/thread-route-targets";
import { useMountEffect } from "~/hooks/use-mount-effect";

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

function threadRouteRefKey(threadRef: ThreadRouteRef): string {
  return `${threadRef.environmentId}:${threadRef.threadId}`;
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

  if (!threadRef) {
    throw new Error("Thread route rendered without thread route params.");
  }

  const threadRouteKey = threadRouteRefKey(threadRef);

  if (!bootstrapComplete) {
    return (
      <ChatThreadRouteSync
        key={`${threadRouteKey}:bootstrap:false`}
        bootstrapComplete={bootstrapComplete}
        environmentHasAnyThreads={environmentHasAnyThreads}
        navigate={navigate}
        routeThreadExists={routeThreadExists}
        threadRef={threadRef}
      />
    );
  }

  if (!routeThreadExists) {
    return (
      <ChatThreadRouteSync
        key={`${threadRouteKey}:missing:${environmentHasAnyThreads ? "any" : "empty"}`}
        bootstrapComplete={bootstrapComplete}
        environmentHasAnyThreads={environmentHasAnyThreads}
        navigate={navigate}
        routeThreadExists={routeThreadExists}
        threadRef={threadRef}
      />
    );
  }

  return (
    <>
      <ChatThreadRouteSync
        key={`${threadRouteKey}:exists`}
        bootstrapComplete={bootstrapComplete}
        environmentHasAnyThreads={environmentHasAnyThreads}
        navigate={navigate}
        routeThreadExists={routeThreadExists}
        threadRef={threadRef}
      />
      {serverThreadStarted && draftThread?.promotedTo ? (
        <PromotedDraftFinalizer key={`${threadRouteKey}:promoted`} threadRef={threadRef} />
      ) : null}
      <ChatThreadMainPanel threadRef={threadRef} />
    </>
  );
}

function ChatThreadRouteSync(props: {
  readonly bootstrapComplete: boolean;
  readonly environmentHasAnyThreads: boolean;
  readonly navigate: ReturnType<typeof useNavigate>;
  readonly routeThreadExists: boolean;
  readonly threadRef: ThreadRouteRef;
}) {
  useMountEffect(() => {
    if (!props.bootstrapComplete) {
      return;
    }

    if (props.routeThreadExists) {
      writeLastChatRouteTarget({ kind: "server", threadRef: props.threadRef });
      return;
    }

    if (props.environmentHasAnyThreads) {
      clearLastChatRouteTarget({ kind: "server", threadRef: props.threadRef });
      void props.navigate({ to: "/", replace: true });
      return;
    }

    clearLastChatRouteTarget({ kind: "server", threadRef: props.threadRef });
    void props.navigate({ to: "/", replace: true });
  });

  return null;
}

function PromotedDraftFinalizer(props: { readonly threadRef: ThreadRouteRef }) {
  useMountEffect(() => {
    finalizePromotedDraftThreadByRef(props.threadRef);
  });

  return null;
}
