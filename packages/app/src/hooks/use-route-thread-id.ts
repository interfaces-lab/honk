import { useRouteTarget } from "~/app/routes/thread-route-targets";

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
  const routeTarget = useRouteTarget();
  return routeTarget?.kind === "server" ? routeTarget.threadRef.threadId : null;
}
