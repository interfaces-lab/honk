import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import ChatView from "~/components/chat/view/chat-view";
import { threadHasStarted } from "~/components/chat/view/thread-lifecycle";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "~/stores/chat-drafts";
import {
  selectEnvironmentSnapshotSource,
  selectEnvironmentState,
  selectThreadExistsByRef,
  useStore,
  type EnvironmentSnapshotSource,
} from "~/stores/thread-store";
import { createThreadSelectorByRef } from "~/stores/thread-selectors";
import {
  clearLastChatRouteTarget,
  writeLastChatRouteTarget,
} from "~/app/routes/chat-route-persistence";
import { resolveThreadRouteRef } from "~/app/routes/thread-route-targets";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "~/lib/environment-scope";

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

function isDesktopRuntimeThreadRoute(threadRef: ThreadRouteRef): boolean {
  return threadRef.environmentId === DESKTOP_RUNTIME_ENVIRONMENT_ID;
}

export function ChatThreadRouteView() {
  const routeParams = routeApi.useParams();
  const threadRef = resolveThreadRouteRef(routeParams);
  const navigate = useNavigate();
  const snapshotSource = useStore((store) =>
    selectEnvironmentSnapshotSource(store, threadRef?.environmentId ?? null),
  );
  const serverThreadSelector = useMemo(
    () => createThreadSelectorByRef(threadRef),
    [threadRef?.environmentId, threadRef?.threadId],
  );
  const serverThread = useStore(serverThreadSelector);
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
  const desktopRuntimeRoute = threadRef ? isDesktopRuntimeThreadRoute(threadRef) : false;
  const hasRenderableSnapshot = snapshotSource !== "none" || desktopRuntimeRoute;

  if (!threadRef) {
    throw new Error("Thread route rendered without thread route params.");
  }

  const threadRouteKey = threadRouteRefKey(threadRef);

  if (!hasRenderableSnapshot) {
    return (
      <ChatThreadRouteSync
        key={`${threadRouteKey}:source:${snapshotSource}`}
        environmentHasAnyThreads={environmentHasAnyThreads}
        navigate={navigate}
        routeThreadExists={routeThreadExists}
        snapshotSource={snapshotSource}
        threadRef={threadRef}
      />
    );
  }

  if (!routeThreadExists) {
    return (
      <ChatThreadRouteSync
        key={`${threadRouteKey}:missing:${snapshotSource}:${
          environmentHasAnyThreads ? "any" : "empty"
        }`}
        environmentHasAnyThreads={environmentHasAnyThreads}
        navigate={navigate}
        routeThreadExists={routeThreadExists}
        snapshotSource={snapshotSource}
        threadRef={threadRef}
      />
    );
  }

  return (
    <>
      <ChatThreadRouteSync
        key={`${threadRouteKey}:exists:${snapshotSource}`}
        environmentHasAnyThreads={environmentHasAnyThreads}
        navigate={navigate}
        routeThreadExists={routeThreadExists}
        snapshotSource={snapshotSource}
        threadRef={threadRef}
      />
      {snapshotSource === "server" && serverThreadStarted && draftThread?.promotedTo ? (
        <PromotedDraftFinalizer key={`${threadRouteKey}:promoted`} threadRef={threadRef} />
      ) : null}
      <ChatThreadMainPanel threadRef={threadRef} />
    </>
  );
}

function ChatThreadRouteSync(props: {
  readonly environmentHasAnyThreads: boolean;
  readonly navigate: ReturnType<typeof useNavigate>;
  readonly routeThreadExists: boolean;
  readonly snapshotSource: EnvironmentSnapshotSource;
  readonly threadRef: ThreadRouteRef;
}) {
  useMountEffect(() => {
    const desktopRuntimeRoute = isDesktopRuntimeThreadRoute(props.threadRef);
    if (props.snapshotSource === "none" && !desktopRuntimeRoute) {
      return;
    }

    if (props.routeThreadExists) {
      writeLastChatRouteTarget({ kind: "server", threadRef: props.threadRef });
      return;
    }

    if (props.snapshotSource !== "server" && !desktopRuntimeRoute) {
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
