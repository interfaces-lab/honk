import { createOpenCodeClient } from "./client";
import type { OpenCodeClient, OpenCodeClientOptions } from "./client";
import { createOpenCodeServer } from "./identity";
import type {
  OpenCodeServerDescriptor,
  OpenCodeServerInput,
  OpenCodeServerKey,
  OpenCodeSessionRef,
} from "./identity";

type OpenCodeRegistrySnapshot = {
  readonly servers: readonly OpenCodeServerDescriptor[];
};

type OpenCodeRegistry = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => OpenCodeRegistrySnapshot;
  readonly connect: (input: OpenCodeServerInput, options?: OpenCodeClientOptions) => OpenCodeClient;
  readonly register: (client: OpenCodeClient) => void;
  readonly get: (server: OpenCodeServerKey) => OpenCodeClient | null;
  readonly require: (server: OpenCodeServerKey) => OpenCodeClient;
  readonly forSession: (ref: OpenCodeSessionRef) => OpenCodeClient;
  readonly disconnect: (server: OpenCodeServerKey) => boolean;
  readonly close: () => void;
};

const EMPTY_REGISTRY_SNAPSHOT: OpenCodeRegistrySnapshot = Object.freeze({
  servers: Object.freeze([]),
});

function createOpenCodeRegistry(): OpenCodeRegistry {
  const clients = new Map<OpenCodeServerKey, OpenCodeClient>();
  const listeners = new Set<() => void>();
  let snapshot = EMPTY_REGISTRY_SNAPSHOT;

  function publish(): void {
    snapshot = Object.freeze({
      servers: Object.freeze([...clients.values()].map((client) => client.server)),
    });
    for (const listener of listeners) {
      listener();
    }
  }

  function register(client: OpenCodeClient): void {
    if (clients.has(client.server.key)) {
      throw new Error(`OpenCode server ${client.server.key} is already registered.`);
    }
    clients.set(client.server.key, client);
    publish();
  }

  function requireClient(server: OpenCodeServerKey): OpenCodeClient {
    const client = clients.get(server);
    if (client === undefined) {
      throw new Error(`OpenCode server ${server} is not connected.`);
    }
    return client;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    connect(input, options) {
      const client = createOpenCodeClient(createOpenCodeServer(input), options);
      register(client);
      return client;
    },
    register,
    get(server) {
      return clients.get(server) ?? null;
    },
    require: requireClient,
    forSession(ref) {
      return requireClient(ref.server);
    },
    disconnect(server) {
      const client = clients.get(server);
      if (client === undefined) {
        return false;
      }
      clients.delete(server);
      client.close();
      publish();
      return true;
    },
    close() {
      if (clients.size === 0) {
        return;
      }
      for (const client of clients.values()) {
        client.close();
      }
      clients.clear();
      publish();
    },
  };
}

export { createOpenCodeRegistry, EMPTY_REGISTRY_SNAPSHOT };
export type { OpenCodeRegistry, OpenCodeRegistrySnapshot };
