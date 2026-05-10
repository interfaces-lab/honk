import type { AppRouter } from "~/router";
import type { EnvironmentId, ThreadId } from "@multi/contracts";
import type { DraftId } from "~/composer-draft-store";

export function prefetchDraftNavigation(router: AppRouter, draftId: DraftId | string): void {
  void router
    .preloadRoute({
      to: "/draft/$draftId",
      params: { draftId },
    })
    .catch(() => undefined);
}

export function prefetchThreadNavigation(input: {
  router: AppRouter;
  thread: { environmentId: EnvironmentId; id: ThreadId };
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
