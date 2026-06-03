import { scopeThreadRef } from "~/lib/environment-scope";
import { EnvironmentId, ThreadId } from "@multi/contracts";
import type { ScopedThreadRef } from "@multi/contracts";
import { DraftId, type DraftId as DraftIdType } from "~/stores/chat-drafts";

export type ThreadRouteTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      kind: "draft";
      draftId: DraftIdType;
    };

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
  params: Partial<Record<"environmentId" | "threadId" | "draftId", string | undefined>>,
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
