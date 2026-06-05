import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@multi/contracts";
import { DraftId, type DraftId as DraftIdType } from "~/stores/chat-drafts";
import type { AppRouter } from "~/router";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "~/app/routes/thread-route-targets";

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

type ChatNavigator = ChatNavigate | { readonly navigate: ChatNavigate };

function navigationOptions(options: ChatNavigationOptions): ChatNavigationOptions {
  return options.replace === undefined ? {} : { replace: options.replace };
}

function navigateWith(target: ChatNavigator, options: ChatNavigateOptions): unknown {
  return typeof target === "function" ? target(options) : target.navigate(options);
}

export function openDraft(
  target: ChatNavigator,
  draftId: DraftIdType | string,
  options: ChatNavigationOptions = {},
): unknown {
  return navigateWith(target, {
    to: "/draft/$draftId",
    params: buildDraftThreadRouteParams(toDraftId(draftId)),
    ...navigationOptions(options),
  });
}

export function openThread(
  target: ChatNavigator,
  threadRef: ScopedThreadRef,
  options: ChatNavigationOptions = {},
): unknown {
  return navigateWith(target, {
    to: "/$environmentId/$threadId",
    params: buildThreadRouteParams(threadRef),
    ...navigationOptions(options),
  });
}

export function openChatIndex(
  target: ChatNavigator,
  options: ChatNavigationOptions = {},
): unknown {
  return navigateWith(target, {
    to: "/",
    ...navigationOptions(options),
  });
}

export function prefetchDraftNavigation(router: AppRouter, draftId: DraftIdType | string): void {
  void router
    .preloadRoute({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(toDraftId(draftId)),
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

function toDraftId(draftId: DraftIdType | string): DraftIdType {
  return typeof draftId === "string" ? DraftId.make(draftId) : draftId;
}
