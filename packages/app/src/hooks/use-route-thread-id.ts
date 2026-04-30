import { useParams } from "@tanstack/react-router";

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
  return useParams({
    strict: false,
    select: (params) => resolveRouteThreadId(params),
  });
}
