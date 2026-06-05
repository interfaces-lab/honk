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

type ThreadRouteTargetSnapshot =
  | {
      kind: "server";
      environmentId: string;
      threadId: string;
    }
  | {
      kind: "draft";
      draftId: string;
    };

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function paramsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function resolveRouteTargetSnapshotFromMatches(
  matches: ReadonlyArray<{ readonly params: unknown }>,
): ThreadRouteTargetSnapshot | null {
  const params = paramsRecord(matches[matches.length - 1]?.params);
  const environmentId = stringParam(params.environmentId);
  const threadId = stringParam(params.threadId);
  if (environmentId && threadId) {
    return { kind: "server", environmentId, threadId };
  }
  const draftId = stringParam(params.draftId);
  return draftId ? { kind: "draft", draftId } : null;
}

function hydrateRouteTarget(snapshot: ThreadRouteTargetSnapshot | null): ThreadRouteTarget | null {
  if (!snapshot) {
    return null;
  }

  if (snapshot.kind === "server") {
    return {
      kind: "server",
      threadRef: scopeThreadRef(
        EnvironmentId.make(snapshot.environmentId),
        ThreadId.make(snapshot.threadId),
      ),
    };
  }

  return {
    kind: "draft",
    draftId: DraftId.make(snapshot.draftId),
  };
}

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
  return hydrateRouteTarget(resolveRouteTargetSnapshotFromMatches(input.state.matches));
}

export function useRouteTarget(): ThreadRouteTarget | null {
  const snapshot = useRouterState({
    select: (state: { readonly matches: ReadonlyArray<{ readonly params: unknown }> }) =>
      resolveRouteTargetSnapshotFromMatches(state.matches),
  });
  return useMemo(() => hydrateRouteTarget(snapshot), [snapshot]);
}
