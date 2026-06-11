import { useMatch } from "@tanstack/react-router";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@multi/contracts";

import { scopeThreadRef } from "~/lib/environment-scope";
import type { AppRouter } from "~/router";
import { DraftId, type DraftId as DraftIdType } from "~/stores/chat-drafts";

export type ChatRouteTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      kind: "draft";
      draftId: DraftIdType;
    };

type ChatRouteParams = Partial<
  Record<"environmentId" | "threadId" | "draftId", string | undefined>
>;

export function threadRouteParams(ref: ScopedThreadRef): {
  environmentId: EnvironmentId;
  threadId: ThreadId;
} {
  return {
    environmentId: ref.environmentId,
    threadId: ref.threadId,
  };
}

export function draftRouteParams(draftId: DraftIdType): {
  draftId: DraftIdType;
} {
  return { draftId };
}

export function threadRefFromRouteParams(
  params: Partial<Record<"environmentId" | "threadId", string | undefined>>,
): ScopedThreadRef | null {
  if (!params.environmentId || !params.threadId) {
    return null;
  }

  return scopeThreadRef(EnvironmentId.make(params.environmentId), ThreadId.make(params.threadId));
}

export function chatRouteTargetFromParams(params: ChatRouteParams): ChatRouteTarget | null {
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

export function readChatRouteTarget(router: Pick<AppRouter, "state">): ChatRouteTarget | null {
  const params = (router.state.matches.at(-1)?.params ?? {}) as ChatRouteParams;
  return chatRouteTargetFromParams(params);
}

export function useChatRouteTarget(): ChatRouteTarget | null {
  const threadMatch = useMatch({
    from: "/_chat/$environmentId/$threadId",
    shouldThrow: false,
  });
  const draftMatch = useMatch({
    from: "/_chat/draft/$draftId",
    shouldThrow: false,
  });

  if (threadMatch) {
    return { kind: "server", threadRef: threadMatch.params };
  }
  return draftMatch ? { kind: "draft", draftId: draftMatch.params.draftId } : null;
}

export function sidebarSelectionIdForChatRoute(target: ChatRouteTarget | null): string | null {
  if (!target) {
    return null;
  }
  return target.kind === "draft" ? target.draftId : target.threadRef.threadId;
}
