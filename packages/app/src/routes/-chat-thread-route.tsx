import { getRouteApi, useRouter } from "@tanstack/react-router";
import { Spinner } from "@multi/multikit/spinner";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import ChatView from "~/components/chat/view/chat-view";
import { type DraftPromotionRouteTarget } from "~/components/chat/view/thread-lifecycle";
import {
  DraftId,
  finalizePromotedDraftThreadByRef,
  useComposerDraftStore,
  type DraftThreadState,
} from "~/stores/chat-drafts";
import {
  selectEnvironmentSnapshotSource,
  selectEnvironmentState,
  selectThreadExistsByRef,
  useStore,
  type EnvironmentSnapshotSource,
} from "~/stores/thread-store";
import { selectThreadRouteLifecycleSurfaceByRef } from "~/stores/thread-selectors";
import {
  clearLastChatRouteTarget,
  writeLastChatRouteTarget,
} from "~/routes/-chat-route-persistence";
import { openChatIndex } from "~/app/chat-navigation";
import { resolveThreadRouteRef } from "~/routes/-thread-route-targets";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { DESKTOP_RUNTIME_ENVIRONMENT_ID, scopedThreadKey } from "~/lib/environment-scope";
import { usePendingThreadSendStore } from "~/stores/pending-thread-send-store";

const routeApi = getRouteApi("/_chat/$environmentId/$threadId");
type ThreadRouteRef = NonNullable<ReturnType<typeof resolveThreadRouteRef>>;

function ChatThreadMainPanel(props: {
  readonly draftThread: DraftThreadState | null;
  readonly routeTarget: DraftPromotionRouteTarget | null;
  readonly threadRef: ThreadRouteRef;
}) {
  const draftRouteTarget = props.routeTarget?.kind === "draft" ? props.routeTarget : null;
  const draftThread = draftRouteTarget ? props.draftThread : null;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {draftRouteTarget && draftThread ? (
        <ChatView
          draftId={draftRouteTarget.draftId}
          environmentId={draftThread.environmentId}
          threadId={draftThread.threadId}
          reserveTitleBarControlInset={false}
          routeKind="draft"
        />
      ) : (
        <ChatView
          environmentId={props.threadRef.environmentId}
          threadId={props.threadRef.threadId}
          reserveTitleBarControlInset={false}
          routeKind="server"
        />
      )}
    </div>
  );
}

function threadRouteRefKey(threadRef: ThreadRouteRef): string {
  return `${threadRef.environmentId}:${threadRef.threadId}`;
}

function isDesktopRuntimeThreadRoute(threadRef: ThreadRouteRef): boolean {
  return threadRef.environmentId === DESKTOP_RUNTIME_ENVIRONMENT_ID;
}

function threadRefsEqual(
  left: ThreadRouteRef | null | undefined,
  right: ThreadRouteRef | null | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.environmentId === right.environmentId &&
      left.threadId === right.threadId,
  );
}

function findDraftRouteMatch(
  draftThreadsByThreadKey: Record<string, DraftThreadState>,
  threadRef: ThreadRouteRef | null,
): { readonly draftRouteId: DraftId | null; readonly draftThread: DraftThreadState | null } {
  if (!threadRef) {
    return { draftRouteId: null, draftThread: null };
  }
  for (const [draftId, draftThread] of Object.entries(draftThreadsByThreadKey)) {
    if (
      threadRefsEqual(draftThread.promotedTo, threadRef) ||
      (draftThread.environmentId === threadRef.environmentId &&
        draftThread.threadId === threadRef.threadId)
    ) {
      return {
        draftRouteId: DraftId.make(draftId),
        draftThread,
      };
    }
  }
  return { draftRouteId: null, draftThread: null };
}

export function ChatThreadRouteView() {
  const routeParams = routeApi.useParams();
  const threadRef = resolveThreadRouteRef(routeParams);
  const router = useRouter();
  const snapshotSource = useStore((store) =>
    selectEnvironmentSnapshotSource(store, threadRef?.environmentId ?? null),
  );
  const serverThreadLifecycle = useStore(
    useShallow((store) => selectThreadRouteLifecycleSurfaceByRef(store, threadRef) ?? null),
  );
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftRouteMatch = useComposerDraftStore(
    useShallow((store) => findDraftRouteMatch(store.draftThreadsByThreadKey, threadRef)),
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftRouteMatch.draftThread !== null;
  const serverThreadRenderable = serverThreadLifecycle?.hasRenderableUserStart ?? false;
  const routeTarget: DraftPromotionRouteTarget | null =
    threadRef === null
      ? null
      : draftRouteMatch.draftRouteId !== null && !serverThreadRenderable
        ? { kind: "draft", draftId: draftRouteMatch.draftRouteId }
        : { kind: "server", threadRef };
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const desktopRuntimeRoute = threadRef ? isDesktopRuntimeThreadRoute(threadRef) : false;
  const hasRenderableSnapshot = snapshotSource !== "none" || desktopRuntimeRoute;

  if (!threadRef) {
    throw new Error("Thread route rendered without thread route params.");
  }

  const threadRouteKey = threadRouteRefKey(threadRef);

  if (!hasRenderableSnapshot) {
    return (
      <>
        <ChatThreadRouteSync
          key={`${threadRouteKey}:source:${snapshotSource}`}
          environmentHasAnyThreads={environmentHasAnyThreads}
          router={router}
          routeThreadExists={routeThreadExists}
          routePersistenceTarget={routeTarget}
          snapshotSource={snapshotSource}
          threadRef={threadRef}
        />
        <ChatThreadRouteLoadingPanel />
      </>
    );
  }

  if (!routeThreadExists) {
    return (
      <>
        <ChatThreadRouteSync
          key={`${threadRouteKey}:missing:${snapshotSource}:${
            environmentHasAnyThreads ? "any" : "empty"
          }`}
          environmentHasAnyThreads={environmentHasAnyThreads}
          router={router}
          routeThreadExists={routeThreadExists}
          routePersistenceTarget={routeTarget}
          snapshotSource={snapshotSource}
          threadRef={threadRef}
        />
        <ChatThreadRouteLoadingPanel />
      </>
    );
  }

  return (
    <>
      <ChatThreadRouteSync
        key={`${threadRouteKey}:exists:${snapshotSource}`}
        environmentHasAnyThreads={environmentHasAnyThreads}
        router={router}
        routeThreadExists={routeThreadExists}
        routePersistenceTarget={routeTarget}
        snapshotSource={snapshotSource}
        threadRef={threadRef}
      />
      {snapshotSource === "server" &&
      serverThreadRenderable &&
      draftRouteMatch.draftThread?.promotedTo ? (
        <PromotedDraftFinalizer key={`${threadRouteKey}:promoted`} threadRef={threadRef} />
      ) : null}
      <ChatThreadMainPanel
        draftThread={draftRouteMatch.draftThread}
        routeTarget={routeTarget}
        threadRef={threadRef}
      />
    </>
  );
}

function ChatThreadRouteLoadingPanel() {
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
      aria-busy="true"
    >
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}

function ChatThreadRouteSync(props: {
  readonly environmentHasAnyThreads: boolean;
  readonly router: ReturnType<typeof useRouter>;
  readonly routeThreadExists: boolean;
  readonly routePersistenceTarget: DraftPromotionRouteTarget | null;
  readonly snapshotSource: EnvironmentSnapshotSource;
  readonly threadRef: ThreadRouteRef;
}) {
  const routePersistenceTarget = props.routePersistenceTarget;
  const routePersistenceTargetKey =
    routePersistenceTarget?.kind === "draft"
      ? `draft:${routePersistenceTarget.draftId}`
      : routePersistenceTarget?.kind === "server"
        ? `server:${routePersistenceTarget.threadRef.environmentId}:${routePersistenceTarget.threadRef.threadId}`
        : "none";

  useEffect(() => {
    const desktopRuntimeRoute = isDesktopRuntimeThreadRoute(props.threadRef);
    if (props.snapshotSource === "none" && !desktopRuntimeRoute) {
      return;
    }

    if (props.routeThreadExists && props.routePersistenceTarget) {
      writeLastChatRouteTarget(props.routePersistenceTarget);
      return;
    }

    if (props.snapshotSource !== "server" && !desktopRuntimeRoute) {
      return;
    }

    if (props.environmentHasAnyThreads) {
      clearLastChatRouteTarget({ kind: "server", threadRef: props.threadRef });
      void openChatIndex(props.router, { replace: true });
      return;
    }

    clearLastChatRouteTarget({ kind: "server", threadRef: props.threadRef });
    void openChatIndex(props.router, { replace: true });
  }, [
    props.environmentHasAnyThreads,
    props.routeThreadExists,
    props.router,
    props.snapshotSource,
    props.threadRef.environmentId,
    props.threadRef.threadId,
    routePersistenceTargetKey,
  ]);

  return null;
}

function PromotedDraftFinalizer(props: { readonly threadRef: ThreadRouteRef }) {
  useMountEffect(() => {
    const finalizedDraftRefs = finalizePromotedDraftThreadByRef(props.threadRef);
    const pendingThreadSendStore = usePendingThreadSendStore.getState();
    for (const draftThreadRef of finalizedDraftRefs) {
      pendingThreadSendStore.clearLocalSendArtifactsForThread(scopedThreadKey(draftThreadRef));
    }
  });

  return null;
}
