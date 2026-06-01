/**
 * ProviderAdapterRegistryLive - In-memory provider adapter lookup layer.
 *
 * Binds provider instance ids to the single adapter for their provider driver.
 * Built-in provider instances use the same slug as their driver (`codex`,
 * `claudeAgent`, `cursor`), while custom instances are resolved through their
 * configured driver.
 *
 * @module ProviderAdapterRegistryLive
 */
import { Effect, Layer, PubSub, Stream } from "effect";
import {
  DEFAULT_SERVER_SETTINGS,
  defaultInstanceIdForDriver,
  isProviderDriverKind,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@multi/contracts";

import { ProviderUnsupportedError, type ProviderAdapterError } from "./Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.service.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "./ProviderAdapterRegistry.service.ts";
import { ClaudeAdapter } from "./ClaudeAdapter.service.ts";
import { CodexAdapter } from "./CodexAdapter.service.ts";
import { CursorAdapter } from "./CursorAdapter.service.ts";
import { createBuiltInAdapterList } from "./builtInProviderCatalog.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { resolveProviderEnabled } from "./provider-settings.ts";

export interface ProviderAdapterRegistryLiveOptions {
  readonly adapters?: ReadonlyArray<ProviderAdapterShape<ProviderAdapterError>>;
}

const makeProviderAdapterRegistry = Effect.fn("makeProviderAdapterRegistry")(function* (
  options?: ProviderAdapterRegistryLiveOptions,
) {
  const serverSettings = yield* ServerSettingsService;
  const adapters =
    options?.adapters !== undefined
      ? options.adapters
      : createBuiltInAdapterList({
          codex: yield* CodexAdapter,
          claudeAgent: yield* ClaudeAdapter,
          cursor: yield* CursorAdapter,
        });
  const byProvider = new Map(
    adapters.map((adapter) => [ProviderDriverKind.make(adapter.provider), adapter] as const),
  );

  const getSettingsOrDefault = serverSettings.getSettings.pipe(
    Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
  );

  const getProviderInstanceConfig = (instanceId: ProviderInstanceId) =>
    getSettingsOrDefault.pipe(
      Effect.map(
        (settings) => settings.providerInstances[instanceId] as ProviderInstanceConfig | undefined,
      ),
    );

  const resolveDriverForInstance = (instanceId: ProviderInstanceId) =>
    getProviderInstanceConfig(instanceId).pipe(
      Effect.flatMap((instanceConfig) => {
        if (instanceConfig) {
          return Effect.succeed(instanceConfig.driver);
        }
        if (isProviderDriverKind(instanceId)) {
          return Effect.succeed(instanceId);
        }
        return Effect.fail(new ProviderUnsupportedError({ provider: instanceId }));
      }),
    );

  const getByDriver = (driver: ProviderDriverKind) => {
    const adapter = byProvider.get(driver);
    if (!adapter) {
      return Effect.fail(new ProviderUnsupportedError({ provider: driver }));
    }
    return Effect.succeed(adapter);
  };

  const getByInstance: ProviderAdapterRegistryShape["getByInstance"] = (instanceId) =>
    resolveDriverForInstance(instanceId).pipe(Effect.flatMap(getByDriver));

  const getInstanceInfo: ProviderAdapterRegistryShape["getInstanceInfo"] = (instanceId) =>
    Effect.gen(function* () {
      const settings = yield* getSettingsOrDefault;
      const instanceConfig = yield* getProviderInstanceConfig(instanceId);
      const driverKind = yield* resolveDriverForInstance(instanceId);
      yield* getByDriver(driverKind);
      return {
        instanceId,
        driverKind,
        displayName: instanceConfig?.displayName,
        accentColor: instanceConfig?.accentColor,
        enabled: resolveProviderEnabled({ settings, driver: driverKind, instanceId }),
      };
    });

  const listInstances: ProviderAdapterRegistryShape["listInstances"] = () =>
    getSettingsOrDefault.pipe(
      Effect.map((settings) => {
        const instanceIds = new Set<ProviderInstanceId>();
        for (const provider of byProvider.keys()) {
          instanceIds.add(defaultInstanceIdForDriver(provider));
        }
        for (const [instanceId, config] of Object.entries(settings.providerInstances)) {
          if (config && byProvider.has(config.driver)) {
            instanceIds.add(ProviderInstanceId.make(instanceId));
          }
        }
        return Array.from(instanceIds);
      }),
    );

  const changesPubSub = yield* Effect.acquireRelease(PubSub.unbounded<void>(), PubSub.shutdown);
  yield* Stream.runForEach(serverSettings.streamChanges, () =>
    PubSub.publish(changesPubSub, undefined),
  ).pipe(Effect.forkScoped);

  return {
    getByInstance,
    getInstanceInfo,
    listInstances,
    streamChanges: Stream.fromPubSub(changesPubSub),
    subscribeChanges: PubSub.subscribe(changesPubSub),
  } satisfies ProviderAdapterRegistryShape;
});

export function makeProviderAdapterRegistryLive(options?: ProviderAdapterRegistryLiveOptions) {
  return Layer.effect(ProviderAdapterRegistry, makeProviderAdapterRegistry(options));
}

export const ProviderAdapterRegistryLive = makeProviderAdapterRegistryLive();
