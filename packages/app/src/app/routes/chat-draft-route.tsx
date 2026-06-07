import type { ScopedThreadRef } from "@multi/contracts";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import ChatView from "~/components/chat/view/chat-view";
import { resolveRenderableDraftCanonicalThreadRef } from "~/components/chat/view/thread-lifecycle";
import { useComposerDraftStore, DraftId } from "~/stores/chat-drafts";
import {
  createThreadSelectorAcrossEnvironments,
  createThreadSelectorByRef,
} from "~/stores/thread-selectors";
import { useStore } from "~/stores/thread-store";
import {
  clearLastChatRouteTarget,
  writeLastChatRouteTarget,
} from "~/app/routes/chat-route-persistence";
import { openChatIndex, openThread } from "~/app/chat-navigation";
import { useMountEffect } from "~/hooks/use-mount-effect";

const routeApi = getRouteApi("/_chat/draft/$draftId");

function scopedThreadRefKey(threadRef: ScopedThreadRef): string {
  return `${threadRef.environmentId}:${threadRef.threadId}`;
}

export function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = routeApi.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const promotedThreadRef = draftSession?.promotedTo ?? null;
  const serverThreadSelector = useMemo(
    () =>
      promotedThreadRef
        ? createThreadSelectorByRef(promotedThreadRef)
        : createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
    [draftSession?.threadId, promotedThreadRef?.environmentId, promotedThreadRef?.threadId],
  );
  const serverThread = useStore(serverThreadSelector);
  const canonicalThreadRef = resolveRenderableDraftCanonicalThreadRef({
    promotedTo: draftSession?.promotedTo,
    serverThread,
  });
  if (canonicalThreadRef) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CanonicalDraftThreadRouteSync
          key={`${draftId}:server:${scopedThreadRefKey(canonicalThreadRef)}`}
          canonicalThreadRef={canonicalThreadRef}
          navigate={navigate}
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
      <MissingDraftThreadRouteSync
        key={`${draftId}:missing`}
        draftId={draftId}
        navigate={navigate}
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
  readonly navigate: ReturnType<typeof useNavigate>;
}) {
  useMountEffect(() => {
    writeLastChatRouteTarget({ kind: "server", threadRef: props.canonicalThreadRef });
    void openThread(props.navigate, props.canonicalThreadRef, { replace: true });
  });

  return null;
}

function DraftThreadRouteSync(props: { readonly draftId: DraftId }) {
  useMountEffect(() => {
    writeLastChatRouteTarget({ kind: "draft", draftId: props.draftId });
  });

  return null;
}

function MissingDraftThreadRouteSync(props: {
  readonly draftId: DraftId;
  readonly navigate: ReturnType<typeof useNavigate>;
}) {
  useMountEffect(() => {
    clearLastChatRouteTarget({ kind: "draft", draftId: props.draftId });
    void openChatIndex(props.navigate, { replace: true });
  });

  return null;
}
