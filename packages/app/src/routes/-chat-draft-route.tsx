import type { EnvironmentId, ScopedThreadRef } from "@honk/contracts";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { Spinner } from "@honk/honkkit/spinner";
import { useShallow } from "zustand/react/shallow";
import { ChatPaneTilingSurface } from "~/components/chat/view/chat-pane-tiling-surface";
import { chatPaneTilingActions } from "~/components/chat/view/chat-pane-tiling-store";
import { useComposerDraftStore, DraftId } from "~/stores/chat-drafts";
import { selectThreadRouteLifecycleSurfaceByRef } from "~/stores/thread-selectors";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "~/stores/thread-store";
import { writeLastChatRouteTarget } from "~/routes/-chat-route-persistence";
import { openThread } from "~/app/chat-navigation";
import {
  readSelectedWorkspaceProject,
  useSelectedWorkspaceProject,
} from "~/lib/selected-workspace-project";
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

  const { logicalProjectKey, projectRef: selectedProjectRef } = readSelectedWorkspaceProject();
  if (!selectedProjectRef) {
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
    logicalProjectKey ?? scopedProjectKey(selectedProjectRef),
    selectedProjectRef,
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
    promotedThreadRef !== null && serverThreadLifecycle?.hasRenderableUserStart === true
      ? promotedThreadRef
      : null;
  const canonicalThreadExists = useStore((store) =>
    canonicalThreadRef ? selectThreadExistsByRef(store, canonicalThreadRef) : false,
  );
  if (canonicalThreadRef) {
    if (!canonicalThreadExists) {
      return (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <CanonicalDraftThreadRouteSync
            key={`${draftId}:server:${scopedThreadRefKey(canonicalThreadRef)}:loading`}
            canonicalThreadRef={canonicalThreadRef}
            draftId={draftId}
            router={router}
          />
          <ChatThreadRouteLoadingPanel />
        </div>
      );
    }

    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CanonicalDraftThreadRouteSync
          key={`${draftId}:server:${scopedThreadRefKey(canonicalThreadRef)}`}
          canonicalThreadRef={canonicalThreadRef}
          draftId={draftId}
          router={router}
        />
        <ChatPaneTilingSurface
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          reserveTitleBarControlInset={false}
          routeKind="server"
        />
      </div>
    );
  }

  if (!draftSession) {
    return <DraftThreadRouteMaterializeSync key={`${draftId}:materialize`} draftId={draftId} />;
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <DraftThreadRouteSync key={`${draftId}:draft`} draftId={draftId} />
      <ChatPaneTilingSurface
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        reserveTitleBarControlInset={false}
        routeKind="draft"
      />
    </div>
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

function CanonicalDraftThreadRouteSync(props: {
  readonly canonicalThreadRef: ScopedThreadRef;
  readonly draftId: DraftId;
  readonly router: ReturnType<typeof useRouter>;
}) {
  useMountEffect(() => {
    chatPaneTilingActions.promoteDraftTilesets(props.draftId, props.canonicalThreadRef);
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
  const { projectRef: selectedProjectRef } = useSelectedWorkspaceProject();
  const selectedProjectEnvironmentId = selectedProjectRef?.environmentId ?? null;
  const selectedProjectId = selectedProjectRef?.projectId ?? null;

  useLayoutSyncEffect(() => {
    createDraftRouteSession(props.draftId);
  }, [
    activeEnvironmentId,
    selectedProjectEnvironmentId,
    selectedProjectId,
    projectCount,
    props.draftId,
    snapshotSource,
  ]);

  return null;
}
