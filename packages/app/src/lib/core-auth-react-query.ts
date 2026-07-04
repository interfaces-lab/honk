import type { AuthSnapshot, CredentialKind, LoginInput } from "@honk/api/core/v1";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { getPrimaryCoreEnvironmentConnection } from "~/environments/core";

const CORE_AUTH_FLOW_POLL_INTERVAL_MS = 2_000;
const CORE_AUTH_STALE_TIME_MS = 5_000;

export const EMPTY_CORE_AUTH_SNAPSHOT: AuthSnapshot = {
  credentials: [],
  harnesses: [],
  flow: null,
};

export const coreAuthQueryKeys = {
  all: ["core-auth"] as const,
  snapshot: () => ["core-auth", "snapshot"] as const,
};

export const coreAuthMutationKeys = {
  login: () => ["core-auth", "mutation", "login"] as const,
  logout: () => ["core-auth", "mutation", "logout"] as const,
  cancelFlow: () => ["core-auth", "mutation", "cancel-flow"] as const,
};

async function readPrimaryCoreAuthClient() {
  return (await getPrimaryCoreEnvironmentConnection()).honk().auth;
}

export function setCoreAuthSnapshotQueryData(
  queryClient: QueryClient,
  snapshot: AuthSnapshot,
): void {
  queryClient.setQueryData(coreAuthQueryKeys.snapshot(), snapshot);
}

export function coreAuthSnapshotQueryOptions(input: { readonly enabled?: boolean } = {}) {
  return queryOptions({
    queryKey: coreAuthQueryKeys.snapshot(),
    queryFn: async () => (await readPrimaryCoreAuthClient()).get(),
    enabled: input.enabled ?? true,
    staleTime: CORE_AUTH_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (query) =>
      query.state.data?.flow === null || query.state.data === undefined
        ? false
        : CORE_AUTH_FLOW_POLL_INTERVAL_MS,
  });
}

export function coreAuthLoginMutationOptions(input: { readonly queryClient: QueryClient }) {
  return mutationOptions<AuthSnapshot, unknown, LoginInput>({
    mutationKey: coreAuthMutationKeys.login(),
    mutationFn: async (payload) => (await readPrimaryCoreAuthClient()).login(payload),
    onSuccess: (snapshot) => setCoreAuthSnapshotQueryData(input.queryClient, snapshot),
  });
}

export function coreAuthLogoutMutationOptions(input: { readonly queryClient: QueryClient }) {
  return mutationOptions<AuthSnapshot, unknown, { readonly kind: CredentialKind }>({
    mutationKey: coreAuthMutationKeys.logout(),
    mutationFn: async (payload) => (await readPrimaryCoreAuthClient()).logout(payload),
    onSuccess: (snapshot) => setCoreAuthSnapshotQueryData(input.queryClient, snapshot),
  });
}

export function coreAuthCancelFlowMutationOptions(input: { readonly queryClient: QueryClient }) {
  return mutationOptions<AuthSnapshot, unknown, void>({
    mutationKey: coreAuthMutationKeys.cancelFlow(),
    mutationFn: async () => (await readPrimaryCoreAuthClient()).cancelFlow(),
    onSuccess: (snapshot) => setCoreAuthSnapshotQueryData(input.queryClient, snapshot),
  });
}
