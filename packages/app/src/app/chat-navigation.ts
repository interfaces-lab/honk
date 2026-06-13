import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@honk/contracts";
import {
  DraftId,
  isNewThreadDraftId,
  useComposerDraftStore,
  type DraftId as DraftIdType,
} from "~/stores/chat-drafts";
import type { AppRouter } from "~/router";
import { draftRouteParams, readChatRouteTarget, threadRouteParams } from "~/app/chat-route-state";
import { scopedThreadKey, scopeThreadRef } from "~/lib/environment-scope";
import { useThreadSendIntentStore } from "~/stores/thread-send-intent-store";

type ChatNavigationOptions = {
  readonly replace?: boolean;
};

type DraftNavigateOptions = {
  readonly to: "/draft/$draftId";
  readonly params: { readonly draftId: DraftIdType | string };
  readonly replace?: boolean;
};

type ThreadNavigateOptions = {
  readonly to: "/$environmentId/$threadId";
  readonly params: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  };
  readonly replace?: boolean;
};

type ChatIndexNavigateOptions = {
  readonly to: "/";
  readonly replace?: boolean;
};

type ChatNavigateOptions = DraftNavigateOptions | ThreadNavigateOptions | ChatIndexNavigateOptions;
type ChatNavigate = (options: ChatNavigateOptions) => unknown;

type ChatRouterNavigator = {
  readonly navigate: ChatNavigate;
  readonly state?: AppRouter["state"];
};
type ChatNavigator = ChatNavigate | ChatRouterNavigator;

function navigationOptions(options: ChatNavigationOptions): ChatNavigationOptions {
  return options.replace === undefined ? {} : { replace: options.replace };
}

function navigateWith(target: ChatNavigator, options: ChatNavigateOptions): unknown {
  return typeof target === "function" ? target(options) : target.navigate(options);
}

function readCurrentTarget(target: ChatNavigator) {
  if (typeof target === "function" || !target.state) {
    return null;
  }
  return readChatRouteTarget({ state: target.state });
}

function isCurrentChatIndex(target: ChatNavigator): boolean {
  if (typeof target === "function" || !target.state) {
    return false;
  }
  return (
    target.state?.location?.pathname === "/" &&
    readChatRouteTarget({ state: target.state }) === null
  );
}

export function openDraft(
  target: ChatNavigator,
  draftId: DraftIdType | string,
  options: ChatNavigationOptions = {},
): unknown {
  const targetDraftId = toDraftId(draftId);
  clearNewThreadDraftSendArtifacts(targetDraftId);
  const currentTarget = readCurrentTarget(target);
  if (currentTarget?.kind === "draft" && currentTarget.draftId === targetDraftId) {
    return undefined;
  }
  return navigateWith(target, {
    to: "/draft/$draftId",
    params: draftRouteParams(targetDraftId),
    ...navigationOptions(options),
  });
}

export function openThread(
  target: ChatNavigator,
  threadRef: ScopedThreadRef,
  options: ChatNavigationOptions = {},
): unknown {
  const currentTarget = readCurrentTarget(target);
  if (
    currentTarget?.kind === "server" &&
    currentTarget.threadRef.environmentId === threadRef.environmentId &&
    currentTarget.threadRef.threadId === threadRef.threadId
  ) {
    return undefined;
  }
  return navigateWith(target, {
    to: "/$environmentId/$threadId",
    params: threadRouteParams(threadRef),
    ...navigationOptions(options),
  });
}

export function openChatIndex(target: ChatNavigator, options: ChatNavigationOptions = {}): unknown {
  if (isCurrentChatIndex(target)) {
    return undefined;
  }
  return navigateWith(target, {
    to: "/",
    ...navigationOptions(options),
  });
}

export function prefetchDraftNavigation(router: AppRouter, draftId: DraftIdType | string): void {
  void router
    .preloadRoute({
      to: "/draft/$draftId",
      params: draftRouteParams(toDraftId(draftId)),
    })
    .catch(() => undefined);
}

export function prefetchThreadNavigation(input: {
  readonly router: AppRouter;
  readonly thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId };
}): void {
  void input.router
    .preloadRoute({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: input.thread.environmentId,
        threadId: input.thread.id,
      },
    })
    .catch(() => undefined);
}

export function clearNewThreadDraftSendArtifacts(draftId: DraftIdType | string): void {
  const targetDraftId = toDraftId(draftId);
  if (!isNewThreadDraftId(targetDraftId)) {
    return;
  }
  const draftSession = useComposerDraftStore.getState().getDraftSession(targetDraftId);
  if (!draftSession) {
    return;
  }
  useThreadSendIntentStore
    .getState()
    .clearLocalSendArtifactsForThread(
      scopedThreadKey(scopeThreadRef(draftSession.environmentId, draftSession.threadId)),
    );
}

function toDraftId(draftId: DraftIdType | string): DraftIdType {
  return typeof draftId === "string" ? DraftId.make(draftId) : draftId;
}
