import { useChatRouteTarget } from "~/app/chat-route-state";

export function resolveRouteThreadId(params: { threadId?: string | null } | null | undefined) {
  if (!params?.threadId) {
    return null;
  }

  const id = params.threadId.trim();
  if (id.length === 0) {
    return null;
  }

  return id;
}

export function useRouteThreadId() {
  const routeTarget = useChatRouteTarget();
  return routeTarget?.kind === "server" ? routeTarget.threadRef.threadId : null;
}
