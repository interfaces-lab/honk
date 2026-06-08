import { scopeThreadRef } from "~/lib/environment-scope";
import { EnvironmentId, ThreadId } from "@multi/contracts";
import type { ScopedThreadRef } from "@multi/contracts";
import { DraftId, type DraftId as DraftIdType } from "~/stores/chat-drafts";
import { useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";

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

export function resolveThreadRouteTarget(
  params: ThreadRouteParams,
): ThreadRouteTarget | null {
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

export function getCurrentRouteTarget(input: {
  readonly state: {
    readonly matches: ReadonlyArray<{
      readonly params: unknown;
    }>;
  };
}): ThreadRouteTarget | null {
  return resolveThreadRouteTarget((input.state.matches.at(-1)?.params ?? {}) as ThreadRouteParams);
}

export function useRouteTarget(): ThreadRouteTarget | null {
  const params = useRouterState({
    select: (state: { readonly matches: ReadonlyArray<{ readonly params: unknown }> }) =>
      state.matches.at(-1)?.params as ThreadRouteParams | undefined,
    structuralSharing: true,
  });
  return useMemo(() => resolveThreadRouteTarget(params ?? {}), [params]);
}
