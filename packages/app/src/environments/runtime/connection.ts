import type {
  EnvironmentId,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  ServerConfig,
  ServerLifecycleWelcomePayload,
  TerminalEvent,
} from "@multi/contracts";
import type { KnownEnvironment } from "~/lib/environment-scope";

import type { WsRpcClient } from "~/rpc/ws-rpc-client";

export interface EnvironmentConnection {
  readonly environmentId: EnvironmentId;
  readonly knownEnvironment: KnownEnvironment;
  readonly client: WsRpcClient;
  readonly ensureBootstrapped: () => Promise<void>;
  readonly isBootstrapped: () => boolean;
  readonly subscribeBootstrap: (listener: () => void) => () => void;
  readonly reconnect: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

interface OrchestrationHandlers {
  readonly applyShellEvent: (
    event: OrchestrationShellStreamEvent,
    environmentId: EnvironmentId,
  ) => void;
  readonly syncShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  readonly applyTerminalEvent: (event: TerminalEvent, environmentId: EnvironmentId) => void;
}

interface EnvironmentConnectionInput extends OrchestrationHandlers {
  readonly knownEnvironment: KnownEnvironment;
  readonly client: WsRpcClient;
  readonly refreshMetadata?: () => Promise<void>;
  readonly onConfigSnapshot?: (config: ServerConfig) => void;
  readonly onWelcome?: (payload: ServerLifecycleWelcomePayload) => void;
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

export function createEnvironmentConnection(
  input: EnvironmentConnectionInput,
): EnvironmentConnection {
  const environmentId = input.knownEnvironment.environmentId;

  if (!environmentId) {
    throw new Error(
      `Known environment ${input.knownEnvironment.label} is missing its environmentId.`,
    );
  }

  let disposed = false;
  const bootstrapGate = createBootstrapGate();

  const observeEnvironmentIdentity = (nextEnvironmentId: EnvironmentId, source: string) => {
    if (environmentId !== nextEnvironmentId) {
      throw new Error(
        `Environment connection ${environmentId} changed identity to ${nextEnvironmentId} via ${source}.`,
      );
    }
  };

  const unsubLifecycle = input.client.server.subscribeLifecycle(
    (event: Parameters<Parameters<WsRpcClient["server"]["subscribeLifecycle"]>[0]>[0]) => {
      if (event.type !== "welcome") {
        return;
      }
      observeEnvironmentIdentity(
        event.payload.environment.environmentId,
        "server lifecycle welcome",
      );
      input.onWelcome?.(event.payload);
    },
  );

  const unsubConfig = input.client.server.subscribeConfig(
    (event: Parameters<Parameters<WsRpcClient["server"]["subscribeConfig"]>[0]>[0]) => {
      if (event.type !== "snapshot") {
        return;
      }
      observeEnvironmentIdentity(event.config.environment.environmentId, "server config snapshot");
      input.onConfigSnapshot?.(event.config);
    },
  );

  const unsubShell = input.client.orchestration.subscribeShell(
    (item: Parameters<Parameters<WsRpcClient["orchestration"]["subscribeShell"]>[0]>[0]) => {
      if (item.kind === "snapshot") {
        input.syncShellSnapshot(item.snapshot, environmentId);
        bootstrapGate.resolve();
        return;
      }
      input.applyShellEvent(item, environmentId);
    },
    {
      onResubscribe: () => {
        if (disposed) {
          return;
        }
        bootstrapGate.reset();
      },
    },
  );

  const unsubTerminalEvent = input.client.terminal.onEvent(
    (event: Parameters<Parameters<WsRpcClient["terminal"]["onEvent"]>[0]>[0]) => {
      input.applyTerminalEvent(event, environmentId);
    },
  );

  const cleanup = () => {
    disposed = true;
    unsubShell();
    unsubTerminalEvent();
    unsubLifecycle();
    unsubConfig();
  };

  return {
    environmentId,
    knownEnvironment: input.knownEnvironment,
    client: input.client,
    ensureBootstrapped: () => bootstrapGate.wait(),
    isBootstrapped: () => bootstrapGate.isReady(),
    subscribeBootstrap: (listener) => bootstrapGate.subscribe(listener),
    reconnect: async () => {
      bootstrapGate.reset();
      try {
        await input.client.reconnect();
        await input.refreshMetadata?.();
        await bootstrapGate.wait();
      } catch (error) {
        bootstrapGate.reject(error);
        throw error;
      }
    },
    dispose: async () => {
      cleanup();
      await input.client.dispose();
    },
  };
}
