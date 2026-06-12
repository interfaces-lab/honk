import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { DesktopUpdateState } from "@honk/contracts";
import { useMountEffect } from "~/hooks/use-mount-effect";

export const desktopUpdateQueryKeys = {
  all: ["desktop", "update"] as const,
  state: () => ["desktop", "update", "state"] as const,
};

export const setDesktopUpdateStateQueryData = (
  queryClient: QueryClient,
  state: DesktopUpdateState | null,
) => queryClient.setQueryData(desktopUpdateQueryKeys.state(), state);

export function desktopUpdateStateQueryOptions() {
  return queryOptions({
    queryKey: desktopUpdateQueryKeys.state(),
    queryFn: async () => {
      const bridge = window.desktopBridge;
      if (!bridge || typeof bridge.getUpdateState !== "function") return null;
      return bridge.getUpdateState();
    },
    staleTime: Infinity,
    refetchOnMount: "always",
  });
}

export function useDesktopUpdateState() {
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  const query = useQuery(desktopUpdateStateQueryOptions());
  queryClientRef.current = queryClient;

  useMountEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.onUpdateState !== "function") return;

    return bridge.onUpdateState((nextState) => {
      setDesktopUpdateStateQueryData(queryClientRef.current, nextState);
    });
  });

  return query;
}
