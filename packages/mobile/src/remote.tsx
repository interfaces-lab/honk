import * as React from "react";
import * as SecureStore from "expo-secure-store";
import {
  createSidecarClient,
  probeOpenCodeConnection,
  type SidecarClient,
  type WatchStatus,
} from "@honk/opencode";
import { nativeEventStreamFactory } from "@honk/opencode/native";

import {
  RemoteContext,
  type ConnectRemoteInput,
  type RemoteContextValue,
  type RemoteStatus,
} from "./remote-context";
import { normalizeRemoteOrigin } from "./pairing";

const REMOTE_STORAGE_KEY = "honk.mobile.opencode.v1";

interface StoredRemote {
  readonly origin: string;
  readonly password: string;
  readonly defaultCwd: string;
}

interface PreparedRemote {
  readonly stored: StoredRemote;
  readonly client: SidecarClient;
}

type RemoteViewState = Pick<
  RemoteContextValue,
  "client" | "workspace" | "status" | "origin" | "defaultCwd" | "error" | "hasCredential"
>;

const initialViewState: RemoteViewState = {
  client: null,
  workspace: null,
  status: "restoring",
  origin: null,
  defaultCwd: "",
  error: null,
  hasCredential: false,
};

const reduceViewState = (
  state: RemoteViewState,
  patch: Partial<RemoteViewState>,
): RemoteViewState => ({ ...state, ...patch });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The Honk connection failed.";

const decodeStoredRemote = (raw: string): StoredRemote => {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The saved Honk connection is invalid.");
  }
  const origin = Reflect.get(value, "origin");
  const password = Reflect.get(value, "password");
  const defaultCwd = Reflect.get(value, "defaultCwd");
  if (
    typeof origin !== "string" ||
    typeof password !== "string" ||
    password.length === 0 ||
    typeof defaultCwd !== "string"
  ) {
    throw new Error("The saved Honk connection is incomplete.");
  }
  return { origin: normalizeRemoteOrigin(origin), password, defaultCwd };
};

const persistRemote = (stored: StoredRemote): Promise<void> =>
  SecureStore.setItemAsync(REMOTE_STORAGE_KEY, JSON.stringify(stored));

const statusFromWatch = (status: WatchStatus): RemoteStatus => status;

export function RemoteProvider({ children }: React.PropsWithChildren): React.ReactElement {
  const [view, dispatchView] = React.useReducer(reduceViewState, initialViewState);
  const storedRef = React.useRef<StoredRemote | null>(null);
  const preparedRef = React.useRef<PreparedRemote | null>(null);
  const generationRef = React.useRef(0);

  const closePrepared = React.useCallback(async (): Promise<void> => {
    const prepared = preparedRef.current;
    preparedRef.current = null;
    if (prepared !== null) await prepared.client.close();
  }, []);

  const prepare = React.useCallback(
    async (stored: StoredRemote): Promise<void> => {
      const generation = ++generationRef.current;
      await closePrepared();
      dispatchView({
        client: null,
        workspace: null,
        status: "connecting",
        error: null,
        origin: stored.origin,
        defaultCwd: stored.defaultCwd,
        hasCredential: true,
      });
      try {
        await probeOpenCodeConnection(stored);
        const nextClient = createSidecarClient(stored.origin, {
          password: stored.password,
          eventStreamFactory: nativeEventStreamFactory,
        });
        if (generation !== generationRef.current) {
          await nextClient.close();
          return;
        }
        preparedRef.current = { stored, client: nextClient };
        dispatchView({ client: nextClient });
      } catch (cause) {
        if (generation !== generationRef.current) return;
        dispatchView({ client: null, status: "failed", error: errorMessage(cause) });
      }
    },
    [closePrepared],
  );

  React.useEffect(() => {
    if (view.client === null) return;
    const generation = generationRef.current;
    const watch = view.client.workspace.watch({
      onChange: (workspace) => {
        if (generation === generationRef.current) dispatchView({ workspace });
      },
      onStatus: (status) => {
        if (generation === generationRef.current) dispatchView({ status: statusFromWatch(status) });
      },
    });
    return () => watch.close();
  }, [view.client]);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await SecureStore.getItemAsync(REMOTE_STORAGE_KEY);
        if (!active) return;
        if (raw === null) {
          dispatchView({ status: "disconnected", hasCredential: false });
          return;
        }
        const stored = decodeStoredRemote(raw);
        storedRef.current = stored;
        await prepare(stored);
      } catch (cause) {
        if (active) dispatchView({ status: "failed", error: errorMessage(cause) });
      }
    })();
    return () => {
      active = false;
      generationRef.current += 1;
      void closePrepared();
    };
  }, [closePrepared, prepare]);

  const connect = React.useCallback(
    async (input: ConnectRemoteInput): Promise<void> => {
      const stored: StoredRemote = {
        origin: normalizeRemoteOrigin(input.origin),
        password: input.password,
        defaultCwd: input.defaultCwd.trim(),
      };
      dispatchView({ status: "connecting", error: null });
      try {
        await probeOpenCodeConnection(stored);
        await persistRemote(stored);
        storedRef.current = stored;
        await prepare(stored);
      } catch (cause) {
        dispatchView({ status: "disconnected", error: errorMessage(cause) });
        throw cause;
      }
    },
    [prepare],
  );

  const retry = React.useCallback(async (): Promise<void> => {
    const stored = storedRef.current;
    if (stored !== null) await prepare(stored);
  }, [prepare]);

  const refreshWorkspace = React.useCallback(async (): Promise<void> => {
    const client = preparedRef.current?.client;
    if (client === undefined) return;
    dispatchView({ workspace: await client.workspace.snapshot() });
  }, []);

  const disconnect = React.useCallback(async (): Promise<void> => {
    generationRef.current += 1;
    await closePrepared();
    await SecureStore.deleteItemAsync(REMOTE_STORAGE_KEY);
    storedRef.current = null;
    dispatchView({
      client: null,
      workspace: null,
      origin: null,
      defaultCwd: "",
      error: null,
      status: "disconnected",
      hasCredential: false,
    });
  }, [closePrepared]);

  const setDefaultCwd = React.useCallback(async (cwd: string): Promise<void> => {
    const stored = storedRef.current;
    const defaultCwd = cwd.trim();
    dispatchView({ defaultCwd });
    if (stored === null) return;
    const next = { ...stored, defaultCwd };
    storedRef.current = next;
    if (preparedRef.current !== null)
      preparedRef.current = { ...preparedRef.current, stored: next };
    await persistRemote(next);
  }, []);

  const value: RemoteContextValue = {
    ...view,
    connect,
    retry,
    refreshWorkspace,
    disconnect,
    setDefaultCwd,
  };

  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>;
}
