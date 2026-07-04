import type { EnvironmentId } from "@honk/shared/environment";
import type { OrchestrationShellSnapshot } from "@honk/shared/orchestration";
import { connect, type ConnectOptions, type HonkClient } from "@honk/sdk";
import { getKnownEnvironmentHttpBaseUrl, type KnownEnvironment } from "~/lib/environment-scope";

import { resolveAuthenticatedServerBearerToken } from "../primary/auth";
import {
  createCoreAuxClient,
  resolveCoreAuxEndpoint,
  type CoreAuxClient,
  type CoreAuxEndpoint,
  type CoreAuxProjectEvent,
} from "./aux";

export interface CoreEnvironmentConnection {
  readonly environmentId: EnvironmentId;
  readonly knownEnvironment: KnownEnvironment;
  readonly honk: () => HonkClient;
  readonly aux: () => CoreAuxClient | null;
  readonly auxEndpoint: () => CoreAuxEndpoint | null;
  readonly listProjects: () => Promise<OrchestrationShellSnapshot["projects"]>;
  readonly subscribeProjectEvents: (listener: (event: CoreAuxProjectEvent) => void) => () => void;
  readonly ensureBootstrapped: () => Promise<void>;
  readonly isBootstrapped: () => boolean;
  readonly subscribeBootstrap: (listener: () => void) => () => void;
  readonly subscribeReconnect: (listener: () => void) => () => void;
  readonly markBootstrapped: () => void;
  readonly resetBootstrap: () => void;
  readonly reconnect: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

interface CoreEnvironmentConnectionInput {
  readonly knownEnvironment: KnownEnvironment;
  readonly connectOptions?: ConnectOptions;
  readonly discoverHome?: string;
}

function createBootstrapGate() {
  let bootstrapped = false;
  const listeners = new Set<() => void>();
  let resolve: (() => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;
  let promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    wait: () => promise,
    isReady: () => bootstrapped,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolve: () => {
      if (bootstrapped) {
        return;
      }
      bootstrapped = true;
      resolve?.();
      resolve = null;
      reject = null;
      emit();
    },
    reject: (error: unknown) => {
      bootstrapped = false;
      reject?.(error);
      resolve = null;
      reject = null;
      emit();
    },
    reset: () => {
      bootstrapped = false;
      promise = new Promise<void>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
      });
      emit();
    },
  };
}

async function resolveCoreConnectOptions(
  input: CoreEnvironmentConnectionInput,
): Promise<ConnectOptions> {
  if (input.connectOptions) {
    return input.connectOptions;
  }

  if (typeof window === "undefined") {
    return input.discoverHome
      ? { discover: { home: input.discoverHome } }
      : { discover: {} };
  }

  const origin = getKnownEnvironmentHttpBaseUrl(input.knownEnvironment);
  if (!origin) {
    throw new Error(
      `Unable to resolve HTTP URL for ${input.knownEnvironment.label}.`,
    );
  }

  const bearer = await resolveAuthenticatedServerBearerToken();
  if (!bearer) {
    throw new Error("Unable to resolve an authenticated core bearer token.");
  }

  return { origin, bearer };
}

export async function createCoreEnvironmentConnection(
  input: CoreEnvironmentConnectionInput,
): Promise<CoreEnvironmentConnection> {
  const environmentId = input.knownEnvironment.environmentId;
  if (!environmentId) {
    throw new Error(
      `Known environment ${input.knownEnvironment.label} is missing its environmentId.`,
    );
  }

  let client = await connect(await resolveCoreConnectOptions(input));
  let auxClient = createCoreAuxClient(await resolveCoreAuxEndpoint());
  const bootstrapGate = createBootstrapGate();
  const reconnectListeners = new Set<() => void>();
  const projectEventListeners = new Set<(event: CoreAuxProjectEvent) => void>();
  let projectStreamUnsubscribe: (() => void) | null = null;

  const emitReconnect = () => {
    for (const listener of reconnectListeners) {
      listener();
    }
  };

  const emitProjectEvent = (event: CoreAuxProjectEvent) => {
    for (const listener of projectEventListeners) {
      listener(event);
    }
  };

  const subscribeProjectStream = () => {
    projectStreamUnsubscribe?.();
    projectStreamUnsubscribe = auxClient?.subscribeProjects(emitProjectEvent) ?? null;
  };

  subscribeProjectStream();

  return {
    environmentId,
    knownEnvironment: input.knownEnvironment,
    honk: () => client,
    aux: () => auxClient,
    auxEndpoint: () => auxClient?.endpoint ?? null,
    listProjects: () => auxClient?.listProjects() ?? Promise.resolve([]),
    subscribeProjectEvents: (listener) => {
      projectEventListeners.add(listener);
      return () => {
        projectEventListeners.delete(listener);
      };
    },
    ensureBootstrapped: () => bootstrapGate.wait(),
    isBootstrapped: () => bootstrapGate.isReady(),
    subscribeBootstrap: (listener) => bootstrapGate.subscribe(listener),
    subscribeReconnect: (listener) => {
      reconnectListeners.add(listener);
      return () => {
        reconnectListeners.delete(listener);
      };
    },
    markBootstrapped: () => bootstrapGate.resolve(),
    resetBootstrap: () => bootstrapGate.reset(),
    reconnect: async () => {
      bootstrapGate.reset();
      const previousClient = client;
      const previousAuxClient = auxClient;
      try {
        client = await connect(await resolveCoreConnectOptions(input));
        auxClient = createCoreAuxClient(await resolveCoreAuxEndpoint());
        subscribeProjectStream();
        await previousClient.close();
        previousAuxClient?.dispose();
        emitReconnect();
      } catch (error) {
        bootstrapGate.reject(error);
        throw error;
      }
    },
    dispose: async () => {
      reconnectListeners.clear();
      projectEventListeners.clear();
      projectStreamUnsubscribe?.();
      projectStreamUnsubscribe = null;
      bootstrapGate.reset();
      auxClient?.dispose();
      await client.close();
    },
  };
}
