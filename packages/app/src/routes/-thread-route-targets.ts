import { scopeThreadRef } from "~/lib/environment-scope";
import { EnvironmentId } from "@honk/shared/environment";
import { ThreadId } from "@honk/shared/base-schemas";
import type { ScopedThreadRef } from "@honk/shared/environment";
import {
  DraftId,
  draftIdFromNewThreadDraftThreadId,
  draftThreadStateFromNewThreadDraftThreadRef,
  isNewThreadDraftThreadId,
  useComposerDraftStore,
  type DraftId as DraftIdType,
  type DraftThreadState,
} from "~/stores/chat-drafts";
import { useRouterState } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import {
  resolveDraftPromotionRouteTarget,
  threadHasRenderableUserStart,
} from "~/components/chat/view/thread-lifecycle";
import { createThreadSelectorByRef } from "~/stores/thread-selectors";
import { useStore } from "~/stores/thread-store";

/**
 * Route-target glossary:
 * - Pre-thread URL: server-shaped `/$environmentId/$threadId` with synthetic `new-thread-draft:thread:…` id.
 * - Draft route: `/draft/$draftId`.
 * - draftIdForRoute: draft id from the store match or derived from a pre-thread URL.
 * - Promotion: draft session linked to a server thread via `promotedTo`.
 */

export type ThreadRouteTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      kind: "draft";
      draftId: DraftIdType;
    };

type ThreadRouteParams = Partial<
  Record<"environmentId" | "threadId" | "draftId", string | undefined>
>;

export function buildThreadRouteParams(ref: ScopedThreadRef): {
  environmentId: EnvironmentId;
  threadId: ThreadId;
} {
  return {
    environmentId: ref.environmentId,
    threadId: ref.threadId,
  };
}

export function buildDraftThreadRouteParams(draftId: DraftIdType): {
  draftId: DraftIdType;
} {
  return { draftId };
}

export function resolveThreadRouteRef(
  params: Partial<Record<"environmentId" | "threadId", string | undefined>>,
): ScopedThreadRef | null {
  if (!params.environmentId || !params.threadId) {
    return null;
  }

  return scopeThreadRef(EnvironmentId.make(params.environmentId), ThreadId.make(params.threadId));
}

export function resolveThreadRouteTarget(params: ThreadRouteParams): ThreadRouteTarget | null {
  if (params.environmentId && params.threadId) {
    return {
      kind: "server",
      threadRef: scopeThreadRef(
        EnvironmentId.make(params.environmentId),
        ThreadId.make(params.threadId),
      ),
    };
  }

  if (!params.draftId) {
    return null;
  }

  return {
    kind: "draft",
    draftId: DraftId.make(params.draftId),
  };
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveThreadRouteTargetFromPathname(pathname: string): ThreadRouteTarget | null {
  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const routeSegments = segments[0] === "_chat" ? segments.slice(1) : segments;

  if (routeSegments[0] === "draft" && routeSegments[1]) {
    return {
      kind: "draft",
      draftId: DraftId.make(decodePathSegment(routeSegments[1])),
    };
  }

  if (routeSegments[0] && routeSegments[1]) {
    return {
      kind: "server",
      threadRef: scopeThreadRef(
        EnvironmentId.make(decodePathSegment(routeSegments[0])),
        ThreadId.make(decodePathSegment(routeSegments[1])),
      ),
    };
  }

  return null;
}

function threadRefsEqual(
  left: ScopedThreadRef | null | undefined,
  right: ScopedThreadRef | null | undefined,
): boolean {
  return Boolean(
    left && right && left.environmentId === right.environmentId && left.threadId === right.threadId,
  );
}

export function resolveDraftSessionForThreadRef(input: {
  readonly draftIdForRoute: DraftIdType | null;
  readonly matchedDraftThread: DraftThreadState | null;
  readonly threadRef: ScopedThreadRef | null;
}): DraftThreadState | null {
  if (!input.draftIdForRoute || !input.threadRef) {
    return null;
  }
  if (input.matchedDraftThread) {
    return input.matchedDraftThread;
  }
  const storedDraftThread = useComposerDraftStore.getState().getDraftSession(input.draftIdForRoute);
  if (storedDraftThread) {
    return storedDraftThread;
  }
  return draftThreadStateFromNewThreadDraftThreadRef(input.threadRef);
}

export function resolveDraftIdForRoute(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly draftRouteId: DraftIdType | null;
}): DraftIdType | null {
  if (input.draftRouteId !== null) {
    return input.draftRouteId;
  }
  if (!input.threadRef || !isNewThreadDraftThreadId(input.threadRef.threadId)) {
    return null;
  }
  return draftIdFromNewThreadDraftThreadId(input.threadRef.threadId);
}

export function findDraftRouteMatch(
  draftThreadsByThreadKey: Record<string, DraftThreadState>,
  threadRef: ScopedThreadRef | null,
): { readonly draftRouteId: DraftIdType | null; readonly draftThread: DraftThreadState | null } {
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

export function resolveSidebarSelectionId(routeTarget: ThreadRouteTarget | null): string | null {
  if (!routeTarget) {
    return null;
  }
  return routeTarget.kind === "draft" ? routeTarget.draftId : routeTarget.threadRef.threadId;
}

export function resolveThreadCopyId(threadRef: ScopedThreadRef): string {
  const draftSession = useComposerDraftStore.getState().getDraftSessionByRef(threadRef);
  if (draftSession?.promotedTo) {
    return draftSession.promotedTo.threadId;
  }
  return threadRef.threadId;
}

export function resolvePreThreadServerRouteTarget(input: {
  readonly baseTarget: Extract<ThreadRouteTarget, { kind: "server" }>;
  readonly draftRouteId: DraftIdType | null;
  readonly serverThread: ReturnType<ReturnType<typeof createThreadSelectorByRef>> | undefined;
}): ThreadRouteTarget {
  const draftIdForRoute = resolveDraftIdForRoute({
    threadRef: input.baseTarget.threadRef,
    draftRouteId: input.draftRouteId,
  });
  const serverThreadRenderable = threadHasRenderableUserStart(input.serverThread);
  if (draftIdForRoute !== null && !serverThreadRenderable) {
    return { kind: "draft", draftId: draftIdForRoute };
  }
  return (
    resolveDraftPromotionRouteTarget({
      draftRouteId: draftIdForRoute,
      serverThread: input.serverThread ?? null,
      serverThreadRef: input.baseTarget.threadRef,
    }) ?? input.baseTarget
  );
}

export function useRouteTarget(): ThreadRouteTarget | null {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const baseTarget = resolveThreadRouteTargetFromPathname(pathname);
  const serverThreadRef = baseTarget?.kind === "server" ? baseTarget.threadRef : null;
  const serverThreadSelector = createThreadSelectorByRef(serverThreadRef);
  const serverThread = useStore(serverThreadSelector);
  const draftRouteMatch = useComposerDraftStore(
    useShallow((store) => {
      if (!serverThreadRef) {
        return { draftRouteId: null, draftThread: null };
      }
      return findDraftRouteMatch(store.draftThreadsByThreadKey, serverThreadRef);
    }),
  );
  if (!baseTarget) {
    return null;
  }
  if (baseTarget.kind !== "server") {
    return baseTarget;
  }
  return resolvePreThreadServerRouteTarget({
    baseTarget,
    draftRouteId: draftRouteMatch.draftRouteId,
    serverThread,
  });
}
