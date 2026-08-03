import Constants from "expo-constants";
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactElement,
} from "react";

import {
  createManagedAccountSessionStore,
  type ManagedAccountSession,
  type ManagedAccountSessionStore,
} from "./managed-account-session";
import {
  EMPTY_MANAGED_ENVIRONMENT_DISCOVERY_STATE,
  type ManagedEnvironmentDiscovery,
  type ManagedEnvironmentDiscoveryState,
} from "./managed-environment-discovery";
import { createManagedRelayClient } from "./managed-relay-client";
import { createManagedRelayDiscovery } from "./managed-relay-discovery";
import { resolveManagedRemoteConfig, type ManagedRemoteConfig } from "./managed-remote-config";

export interface ManagedRemoteContextValue {
  readonly configured: boolean;
  readonly accountId: string | null;
  readonly discovery: ManagedEnvironmentDiscoveryState;
  readonly refresh: () => Promise<void>;
}

export const managedAccountSessions: ManagedAccountSessionStore =
  createManagedAccountSessionStore();

const ManagedRemoteContext = createContext<ManagedRemoteContextValue | null>(null);
const subscribeUnconfigured = (): (() => void) => () => undefined;
const getUnconfiguredState = (): ManagedEnvironmentDiscoveryState =>
  EMPTY_MANAGED_ENVIRONMENT_DISCOVERY_STATE;

export function ManagedRemoteProvider(
  props: PropsWithChildren<{ readonly configuration?: ManagedRemoteConfig | null }>,
): ReactElement {
  // Public app configuration is immutable for the lifetime of a native process. The optional prop
  // exists only to inject that initial value in tests or alternate app shells.
  const [configuration] = useState(() =>
    props.configuration === undefined
      ? resolveManagedRemoteConfig(Constants.expoConfig?.extra)
      : props.configuration,
  );
  const session = useSyncExternalStore(
    managedAccountSessions.subscribe,
    managedAccountSessions.getSnapshot,
    managedAccountSessions.getSnapshot,
  );
  const [discovery] = useState<ManagedEnvironmentDiscovery<ManagedAccountSession> | null>(() =>
    configuration === null ? null : managedDiscovery(configuration),
  );
  const state = useSyncExternalStore(
    discovery?.subscribe ?? subscribeUnconfigured,
    discovery?.getState ?? getUnconfiguredState,
    discovery?.getState ?? getUnconfiguredState,
  );

  useEffect(() => {
    if (discovery === null) return;
    void discovery.setAccount(session);
    return () => {
      void discovery.setAccount(null);
    };
  }, [discovery, session]);

  useEffect(() => {
    if (discovery === null) return;
    let active = true;
    const update = (network: NetworkState): void => {
      if (!active) return;
      void discovery.setNetworkStatus(network.isConnected === false ? "offline" : "online");
    };
    void getNetworkStateAsync().then(update, () => undefined);
    const subscription = addNetworkStateListener(update);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [discovery]);

  return (
    <ManagedRemoteContext
      value={{
        configured: discovery !== null,
        accountId: session?.accountId ?? null,
        discovery: state,
        refresh: discovery?.refresh ?? (() => Promise.resolve()),
      }}
    >
      {props.children}
    </ManagedRemoteContext>
  );
}

export function useManagedRemote(): ManagedRemoteContextValue {
  const value = useContext(ManagedRemoteContext);
  if (value === null) throw new Error("useManagedRemote must be used inside ManagedRemoteProvider");
  return value;
}

function managedDiscovery(
  configuration: ManagedRemoteConfig,
): ManagedEnvironmentDiscovery<ManagedAccountSession> {
  const relay = createManagedRelayClient<ManagedAccountSession>({
    relayOrigin: configuration.relayOrigin,
    readAccountToken: ({ session }) => session.readAccessToken(),
  });
  const discovery = createManagedRelayDiscovery({
    client: relay,
    relayZone: configuration.relayZone,
  });
  void discovery.setNetworkStatus("offline");
  return discovery;
}
