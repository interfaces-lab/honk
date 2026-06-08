import type { EnvironmentId, ScopedThreadRef } from "@multi/contracts";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import ChatView from "~/components/chat/view/chat-view";
import { useComposerDraftStore, DraftId } from "~/stores/chat-drafts";
import { selectThreadRouteLifecycleSurfaceByRef } from "~/stores/thread-selectors";
import {
  selectEnvironmentState,
  useStore,
} from "~/stores/thread-store";
import { writeLastChatRouteTarget } from "~/routes/-chat-route-persistence";
import { openThread } from "~/app/chat-navigation";
import {
  readNewThreadProjectDefaults,
  useNewThreadProjectDefaults,
} from "~/hooks/use-handle-new-thread";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { scopedProjectKey } from "~/lib/environment-scope";
import { DEFAULT_INTERACTION_MODE } from "~/types";

const routeApi = getRouteApi("/_chat/draft/$draftId");

function scopedThreadRefKey(threadRef: ScopedThreadRef): string {
  return `${threadRef.environmentId}:${threadRef.threadId}`;
}

export function createDraftRouteSession(draftId: DraftId): boolean {
  const store = useComposerDraftStore.getState();
  if (store.getDraftSession(draftId)) {
    return true;
  }

  const { defaultLogicalProjectKey, defaultProjectRef } = readNewThreadProjectDefaults();
  if (!defaultProjectRef) {
    const projectlessEnvironmentId = readProjectlessDraftEnvironmentId();
    if (!projectlessEnvironmentId) {
      return false;
    }
    const currentComposerDraft = store.getComposerDraft(draftId);
    store.setProjectlessDraftThreadId(projectlessEnvironmentId, draftId, {
      createdAt: new Date().toISOString(),
      interactionMode: currentComposerDraft?.interactionMode ?? DEFAULT_INTERACTION_MODE,
    });
    return true;
  }

  const currentComposerDraft = store.getComposerDraft(draftId);
  store.setLogicalProjectDraftThreadId(
    defaultLogicalProjectKey ?? scopedProjectKey(defaultProjectRef),
    defaultProjectRef,
    draftId,
    {
      createdAt: new Date().toISOString(),
      interactionMode: currentComposerDraft?.interactionMode ?? DEFAULT_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      envMode: "local",
    },
  );
  return true;
}

function readProjectlessDraftEnvironmentId(): EnvironmentId | null {
  const appState = useStore.getState();
  const activeEnvironmentId = appState.activeEnvironmentId;
  if (!activeEnvironmentId) {
    return null;
  }
  const environment = selectEnvironmentState(appState, activeEnvironmentId);
  return environment.snapshotSource === "server" && environment.projectIds.length === 0
    ? activeEnvironmentId
    : null;
}

export function DraftChatThreadRouteView() {
  const router = useRouter();
  const { draftId: rawDraftId } = routeApi.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const promotedThreadRef = draftSession?.promotedTo ?? null;
  const serverThreadLifecycle = useStore(
    useShallow((store) =>
      promotedThreadRef
        ? (selectThreadRouteLifecycleSurfaceByRef(store, promotedThreadRef) ?? null)
        : null,
    ),
  );
  const canonicalThreadRef =
    promotedThreadRef !== null &&
    serverThreadLifecycle?.hasRenderableUserStart === true
      ? promotedThreadRef
      : null;
  if (canonicalThreadRef) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CanonicalDraftThreadRouteSync
          key={`${draftId}:server:${scopedThreadRefKey(canonicalThreadRef)}`}
          canonicalThreadRef={canonicalThreadRef}
          router={router}
        />
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
    return (
      <DraftThreadRouteMaterializeSync
        key={`${draftId}:materialize`}
        draftId={draftId}
      />
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <DraftThreadRouteSync key={`${draftId}:draft`} draftId={draftId} />
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

function CanonicalDraftThreadRouteSync(props: {
  readonly canonicalThreadRef: ScopedThreadRef;
  readonly router: ReturnType<typeof useRouter>;
}) {
  useMountEffect(() => {
    writeLastChatRouteTarget({ kind: "server", threadRef: props.canonicalThreadRef });
    void openThread(props.router, props.canonicalThreadRef, { replace: true });
  });

  return null;
}

function DraftThreadRouteSync(props: { readonly draftId: DraftId }) {
  useMountEffect(() => {
    writeLastChatRouteTarget({ kind: "draft", draftId: props.draftId });
  });

  return null;
}

function DraftThreadRouteMaterializeSync(props: { readonly draftId: DraftId }) {
  const activeEnvironmentId = useStore((store) => store.activeEnvironmentId);
  const snapshotSource = useStore(
    (store) => selectEnvironmentState(store, activeEnvironmentId).snapshotSource,
  );
  const projectCount = useStore(
    (store) => selectEnvironmentState(store, activeEnvironmentId).projectIds.length,
  );
  const { defaultProjectRef } = useNewThreadProjectDefaults();
  const defaultProjectEnvironmentId = defaultProjectRef?.environmentId ?? null;
  const defaultProjectId = defaultProjectRef?.projectId ?? null;

  useLayoutSyncEffect(() => {
    createDraftRouteSession(props.draftId);
  }, [
    activeEnvironmentId,
    defaultProjectEnvironmentId,
    defaultProjectId,
    projectCount,
    props.draftId,
    snapshotSource,
  ]);

  return null;
}
