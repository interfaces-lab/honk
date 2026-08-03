import type {
  ManagedEnvironmentId,
  ManagedEnvironmentStatus,
  ManagedEnvironmentSummary,
} from "@honk/shared/managed-remote-access";

export type ManagedEnvironmentDiscoveryRow =
  | {
      readonly availability: "checking";
      readonly environment: ManagedEnvironmentSummary;
      readonly error: null;
    }
  | {
      readonly availability: ManagedEnvironmentStatus;
      readonly environment: ManagedEnvironmentSummary;
      readonly error: null;
    }
  | {
      readonly availability: "error";
      readonly environment: ManagedEnvironmentSummary;
      readonly error: ManagedEnvironmentDiscoveryError;
    };

export interface ManagedEnvironmentDiscoveryState {
  readonly environments: ReadonlyMap<ManagedEnvironmentId, ManagedEnvironmentDiscoveryRow>;
  readonly refreshing: boolean;
  readonly offline: boolean;
  readonly error: ManagedEnvironmentDiscoveryError | null;
}

export interface ManagedEnvironmentDiscovery<Account> {
  readonly getState: () => ManagedEnvironmentDiscoveryState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: () => Promise<void>;
  /** Every replacement invalidates in-flight work because account credentials are opaque here. */
  readonly setAccount: (account: Account | null) => Promise<void>;
  readonly setNetworkStatus: (status: "online" | "offline") => Promise<void>;
}

export class ManagedEnvironmentDiscoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ManagedEnvironmentDiscoveryError";
  }
}

export const EMPTY_MANAGED_ENVIRONMENT_DISCOVERY_STATE: ManagedEnvironmentDiscoveryState =
  Object.freeze({
    environments: new Map(),
    refreshing: false,
    offline: false,
    error: null,
  });

interface ManagedEnvironmentDiscoveryRuntime<Account> {
  account: Account | null;
  accountGeneration: number;
  refreshGeneration: number;
  controller: AbortController | null;
  hasRefreshed: boolean;
  networkStatus: "online" | "offline";
  state: ManagedEnvironmentDiscoveryState;
}

export function createManagedEnvironmentDiscovery<Account>(input: {
  readonly list: (input: {
    readonly account: Account;
    readonly signal: AbortSignal;
  }) => Promise<readonly ManagedEnvironmentSummary[]>;
  readonly resolveStatus: (input: {
    readonly account: Account;
    readonly environment: ManagedEnvironmentSummary;
    readonly signal: AbortSignal;
  }) => Promise<ManagedEnvironmentStatus>;
}): ManagedEnvironmentDiscovery<Account> {
  const runtime: ManagedEnvironmentDiscoveryRuntime<Account> = {
    account: null,
    accountGeneration: 0,
    refreshGeneration: 0,
    controller: null,
    hasRefreshed: false,
    networkStatus: "online",
    state: EMPTY_MANAGED_ENVIRONMENT_DISCOVERY_STATE,
  };
  const listeners = new Set<() => void>();

  const publish = (state: ManagedEnvironmentDiscoveryState): void => {
    runtime.state = Object.freeze(state);
    for (const listener of listeners) listener();
  };

  const abortRefresh = (): void => {
    runtime.refreshGeneration += 1;
    runtime.controller?.abort();
    runtime.controller = null;
  };

  const refresh = async (): Promise<void> => {
    runtime.hasRefreshed = true;
    abortRefresh();
    const account = runtime.account;
    const accountGeneration = runtime.accountGeneration;
    const refreshGeneration = runtime.refreshGeneration;
    if (account === null) {
      publish({
        environments: new Map(),
        refreshing: false,
        offline: runtime.networkStatus === "offline",
        error: null,
      });
      return;
    }
    if (runtime.networkStatus === "offline") {
      publish({ ...runtime.state, refreshing: false, offline: true });
      return;
    }

    const controller = new AbortController();
    runtime.controller = controller;
    publish({ ...runtime.state, refreshing: true, offline: false, error: null });

    const environments = await Promise.resolve()
      .then(() => input.list({ account, signal: controller.signal }))
      .then(
        (listed) => listed,
        (cause: unknown) => {
          if (!isCurrent(runtime, accountGeneration, refreshGeneration)) return null;
          runtime.controller = null;
          publish({
            ...runtime.state,
            refreshing: false,
            error: new ManagedEnvironmentDiscoveryError(
              "Honk could not refresh your linked computers.",
              { cause },
            ),
          });
          return null;
        },
      );
    if (environments === null || !isCurrent(runtime, accountGeneration, refreshGeneration)) {
      return;
    }

    publish({
      environments: new Map(
        environments.map((environment) => [
          environment.environmentId,
          Object.freeze({
            environment,
            availability: "checking",
            error: null,
          }) satisfies ManagedEnvironmentDiscoveryRow,
        ]),
      ),
      refreshing: true,
      offline: false,
      error: null,
    });

    await Promise.all(
      environments.map(async (environment) => {
        const status = await Promise.resolve()
          .then(() => input.resolveStatus({ account, environment, signal: controller.signal }))
          .then(
            (resolved) => resolved,
            (cause: unknown) => {
              if (!isCurrent(runtime, accountGeneration, refreshGeneration)) return null;
              updateEnvironment(
                runtime,
                publish,
                environment.environmentId,
                Object.freeze({
                  environment,
                  availability: "error",
                  error: new ManagedEnvironmentDiscoveryError(
                    "Honk could not check this linked computer.",
                    { cause },
                  ),
                }),
              );
              return null;
            },
          );
        if (status === null || !isCurrent(runtime, accountGeneration, refreshGeneration)) {
          return;
        }
        updateEnvironment(
          runtime,
          publish,
          environment.environmentId,
          Object.freeze({ environment, availability: status, error: null }),
        );
      }),
    );
    if (!isCurrent(runtime, accountGeneration, refreshGeneration)) return;
    runtime.controller = null;
    publish({ ...runtime.state, refreshing: false });
  };

  return {
    getState: () => runtime.state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    setAccount: (account) => {
      runtime.accountGeneration += 1;
      runtime.account = account;
      abortRefresh();
      publish({
        environments: new Map(),
        refreshing: false,
        offline: runtime.networkStatus === "offline",
        error: null,
      });
      return account === null ? Promise.resolve() : refresh();
    },
    setNetworkStatus: (status) => {
      if (runtime.networkStatus === status) return Promise.resolve();
      runtime.networkStatus = status;
      if (status === "offline") {
        abortRefresh();
        publish({ ...runtime.state, refreshing: false, offline: true });
        return Promise.resolve();
      }
      publish({ ...runtime.state, offline: false });
      if (runtime.account === null || !runtime.hasRefreshed) return Promise.resolve();
      return refresh();
    },
  };
}

function isCurrent<Account>(
  runtime: ManagedEnvironmentDiscoveryRuntime<Account>,
  accountGeneration: number,
  refreshGeneration: number,
): boolean {
  return (
    runtime.accountGeneration === accountGeneration &&
    runtime.refreshGeneration === refreshGeneration
  );
}

function updateEnvironment<Account>(
  runtime: ManagedEnvironmentDiscoveryRuntime<Account>,
  publish: (state: ManagedEnvironmentDiscoveryState) => void,
  environmentId: ManagedEnvironmentId,
  row: ManagedEnvironmentDiscoveryRow,
): void {
  if (!runtime.state.environments.has(environmentId)) return;
  publish({
    ...runtime.state,
    environments: new Map(runtime.state.environments).set(environmentId, row),
  });
}
