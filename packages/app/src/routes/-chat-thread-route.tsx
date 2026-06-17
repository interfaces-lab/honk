import { getRouteApi, useRouter } from "@tanstack/react-router";
import { Spinner } from "@honk/honkkit/spinner";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { ChatPaneTilingSurface } from "~/components/chat/view/chat-pane-tiling-surface";
import { chatPaneTilingActions } from "~/components/chat/view/chat-pane-tiling-store";
import {
  finalizePromotedDraftThreadByRef,
  listPromotedDraftIdsByRef,
  useComposerDraftStore,
} from "~/stores/chat-drafts";
import {
  selectEnvironmentSnapshotSource,
  selectEnvironmentState,
  selectThreadExistsByRef,
  useStore,
  type EnvironmentSnapshotSource,
} from "~/stores/thread-store";
import {
  createThreadSelectorByRef,
  selectThreadRouteLifecycleSurfaceByRef,
} from "~/stores/thread-selectors";
import {
  clearLastChatRouteTarget,
  writeLastChatRouteTarget,
} from "~/routes/-chat-route-persistence";
import { openChatIndex } from "~/app/chat-navigation";
import { threadRefFromRouteParams, type ChatRouteTarget } from "~/app/chat-route-state";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { DESKTOP_RUNTIME_ENVIRONMENT_ID, scopedThreadKey } from "~/lib/environment-scope";
import { useThreadSendIntentStore } from "~/stores/thread-send-intent-store";

const routeApi = getRouteApi("/_chat/$environmentId/$threadId");
type ThreadRouteRef = NonNullable<ReturnType<typeof threadRefFromRouteParams>>;

function ChatThreadMainPanel(props: { readonly threadRef: ThreadRouteRef }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatPaneTilingSurface
        environmentId={props.threadRef.environmentId}
        threadId={props.threadRef.threadId}
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
  const threadRef = threadRefFromRouteParams(routeParams);
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
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeTarget: ChatRouteTarget | null =
    threadRef === null ? null : { kind: "server", threadRef };
  const routeThreadExists = threadExists;
  const promotedDraftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThread(threadRef) : null,
  );
  const shouldFinalizePromotedDraft =
    snapshotSource === "server" &&
    promotedDraftThread?.promotedTo != null &&
    (serverThreadLifecycle?.hasRenderableUserStart ?? false);
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
      {shouldFinalizePromotedDraft ? (
        <PromotedDraftFinalizer key={`${threadRouteKey}:promoted`} threadRef={threadRef} />
      ) : null}
      <ChatThreadMainPanel threadRef={threadRef} />
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
  readonly routePersistenceTarget: ChatRouteTarget | null;
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
    const promotedDraftIds = listPromotedDraftIdsByRef(props.threadRef);
    for (const draftId of promotedDraftIds) {
      chatPaneTilingActions.promoteDraftTilesets(draftId, props.threadRef);
    }
    const finalizedDraftRefs = finalizePromotedDraftThreadByRef(props.threadRef);
    const threadSendIntentStore = useThreadSendIntentStore.getState();
    for (const draftThreadRef of finalizedDraftRefs) {
      threadSendIntentStore.clearLocalSendArtifactsForThread(scopedThreadKey(draftThreadRef));
    }
  });

  return null;
}
