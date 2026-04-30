import type { QueryClient } from "@tanstack/react-query";

import type { AppRouter } from "~/router";
import { projectListEntriesQueryOptions } from "~/lib/project-react-query";
import type { Project, Thread } from "~/types";
import type { DraftId } from "~/composer-draft-store";

const THREAD_SWITCH_PROJECT_PREFETCH_LIMIT = 512;
const THREAD_SWITCH_PROJECT_PREFETCH_STALE_MS = 30_000;

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
  queryClient: QueryClient;
  thread: Thread;
  project: Project | undefined;
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

  const cwd = input.thread.worktreePath ?? input.project?.cwd ?? null;
  if (!cwd) {
    return;
  }

  void input.queryClient
    .prefetchQuery(
      projectListEntriesQueryOptions({
        environmentId: input.thread.environmentId,
        cwd,
        limit: THREAD_SWITCH_PROJECT_PREFETCH_LIMIT,
        staleTime: THREAD_SWITCH_PROJECT_PREFETCH_STALE_MS,
      }),
    )
    .catch(() => undefined);
}
