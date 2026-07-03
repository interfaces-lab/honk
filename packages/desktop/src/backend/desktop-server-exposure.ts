import * as NodeOS from "node:os";
import type {
  DesktopServerExposureMode,
  DesktopServerExposureState,
} from "@honk/shared/desktop-api";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from "../settings/desktop-app-settings";
import * as DesktopConfig from "../app/desktop-config";
import * as DesktopAppSettingsService from "../settings/desktop-app-settings";

export const DESKTOP_LOOPBACK_HOST = "127.0.0.1";
const DESKTOP_LAN_BIND_HOST = "0.0.0.0";

export interface DesktopNetworkInterfaceInfo {
  readonly address: string;
  readonly family: string | number;
  readonly internal: boolean;
  readonly netmask?: string;
  readonly mac?: string;
  readonly cidr?: string | null;
  readonly scopeid?: number;
}

export type DesktopNetworkInterfaces = Readonly<
  Record<string, readonly DesktopNetworkInterfaceInfo[] | undefined>
>;

interface ResolvedDesktopServerExposure {
  readonly mode: DesktopServerExposureMode;
  readonly bindHost: string;
  readonly localHttpUrl: string;
  readonly localWsUrl: string;
  readonly endpointUrl: string | null;
  readonly advertisedHost: string | null;
}

const isUsableLanIpv4Address = (address: string): boolean =>
  !address.startsWith("127.") && !address.startsWith("169.254.");

const resolveLanAdvertisedHost = (
  networkInterfaces: DesktopNetworkInterfaces,
  explicitHost: string | undefined,
): string | null => {
  const normalizedExplicitHost = explicitHost?.trim();
  if (normalizedExplicitHost) {
    return normalizedExplicitHost;
  }

  for (const interfaceAddresses of Object.values(networkInterfaces)) {
    if (!interfaceAddresses) continue;

    for (const address of interfaceAddresses) {
      if (address.internal) continue;
      if (address.family !== "IPv4") continue;
      if (!isUsableLanIpv4Address(address.address)) continue;
      return address.address;
    }
  }

  return null;
};

const resolveDesktopServerExposure = (input: {
  readonly mode: DesktopServerExposureMode;
  readonly port: number;
  readonly networkInterfaces: DesktopNetworkInterfaces;
  readonly advertisedHostOverride?: string;
}): ResolvedDesktopServerExposure => {
  const localHttpUrl = `http://${DESKTOP_LOOPBACK_HOST}:${input.port}`;
  const localWsUrl = `ws://${DESKTOP_LOOPBACK_HOST}:${input.port}`;

  if (input.mode === "local-only") {
    return {
      mode: input.mode,
      bindHost: DESKTOP_LOOPBACK_HOST,
      localHttpUrl,
      localWsUrl,
      endpointUrl: null,
      advertisedHost: null,
    };
  }

  const advertisedHost = resolveLanAdvertisedHost(
    input.networkInterfaces,
    input.advertisedHostOverride,
  );

  return {
    mode: input.mode,
    bindHost: DESKTOP_LAN_BIND_HOST,
    localHttpUrl,
    localWsUrl,
    endpointUrl: advertisedHost ? `http://${advertisedHost}:${input.port}` : null,
    advertisedHost,
  };
};

export class DesktopServerExposureNoNetworkAddressError extends Data.TaggedError(
  "DesktopServerExposureNoNetworkAddressError",
)<{
  readonly port: number;
}> {
  override get message() {
    return `No reachable network address is available for desktop network access on port ${this.port}.`;
  }
}

export class DesktopServerExposurePersistenceError extends Data.TaggedError(
  "DesktopServerExposurePersistenceError",
)<{
  readonly cause: DesktopAppSettingsService.DesktopSettingsWriteError;
}> {
  override get message() {
    return "Failed to persist desktop server exposure settings.";
  }
}

export type DesktopServerExposureSetModeError =
  | DesktopServerExposureNoNetworkAddressError
  | DesktopServerExposurePersistenceError;

export interface DesktopServerExposureBackendConfig {
  readonly port: number;
  readonly bindHost: string;
  readonly httpBaseUrl: URL;
}

export interface DesktopServerExposureChange {
  readonly state: DesktopServerExposureState;
  readonly requiresRelaunch: boolean;
}

export interface DesktopServerExposureShape {
  readonly getState: Effect.Effect<DesktopServerExposureState>;
  readonly backendConfig: Effect.Effect<DesktopServerExposureBackendConfig>;
  readonly configureFromSettings: (input: {
    readonly port: number;
  }) => Effect.Effect<DesktopServerExposureState>;
  readonly setMode: (
    mode: DesktopServerExposureMode,
  ) => Effect.Effect<DesktopServerExposureChange, DesktopServerExposureSetModeError>;
}

export class DesktopServerExposure extends Context.Service<
  DesktopServerExposure,
  DesktopServerExposureShape
>()("honk/desktop/ServerExposure") {}

export interface DesktopNetworkInterfacesServiceShape {
  readonly read: Effect.Effect<DesktopNetworkInterfaces>;
}

export class DesktopNetworkInterfacesService extends Context.Service<
  DesktopNetworkInterfacesService,
  DesktopNetworkInterfacesServiceShape
>()("honk/desktop/ServerExposure/NetworkInterfaces") {}

interface RuntimeState {
  readonly requestedMode: DesktopServerExposureMode;
  readonly mode: DesktopServerExposureMode;
  readonly port: number;
  readonly bindHost: string;
  readonly localHttpUrl: string;
  readonly localWsUrl: string;
  readonly httpBaseUrl: URL;
  readonly endpointUrl: Option.Option<string>;
  readonly advertisedHost: Option.Option<string>;
}

interface ResolvedRuntimeState {
  readonly state: RuntimeState;
  readonly unavailable: boolean;
}

const runtimeStateFromResolvedExposure = (input: {
  readonly requestedMode: DesktopServerExposureMode;
  readonly exposure: ResolvedDesktopServerExposure;
  readonly port: number;
}): RuntimeState => ({
  requestedMode: input.requestedMode,
  mode: input.exposure.mode,
  port: input.port,
  bindHost: input.exposure.bindHost,
  localHttpUrl: input.exposure.localHttpUrl,
  localWsUrl: input.exposure.localWsUrl,
  httpBaseUrl: new URL(input.exposure.localHttpUrl),
  endpointUrl: Option.fromNullishOr(input.exposure.endpointUrl),
  advertisedHost: Option.fromNullishOr(input.exposure.advertisedHost),
});

const initialRuntimeState = (): RuntimeState =>
  runtimeStateFromResolvedExposure({
    requestedMode: DEFAULT_DESKTOP_SETTINGS.serverExposureMode,
    exposure: resolveDesktopServerExposure({
      mode: DEFAULT_DESKTOP_SETTINGS.serverExposureMode,
      port: 0,
      networkInterfaces: {},
    }),
    port: 0,
  });

const toContractState = (state: RuntimeState): DesktopServerExposureState => ({
  mode: state.mode,
  endpointUrl: Option.getOrNull(state.endpointUrl),
  advertisedHost: Option.getOrNull(state.advertisedHost),
});

const toBackendConfig = (state: RuntimeState): DesktopServerExposureBackendConfig => ({
  port: state.port,
  bindHost: state.bindHost,
  httpBaseUrl: state.httpBaseUrl,
});

function resolveRuntimeState(input: {
  readonly requestedMode: DesktopServerExposureMode;
  readonly port: number;
  readonly networkInterfaces: DesktopNetworkInterfaces;
  readonly advertisedHostOverride: Option.Option<string>;
}): ResolvedRuntimeState {
  const advertisedHostOverride = Option.getOrUndefined(input.advertisedHostOverride);
  const requestedExposure = resolveDesktopServerExposure({
    mode: input.requestedMode,
    port: input.port,
    networkInterfaces: input.networkInterfaces,
    ...(advertisedHostOverride ? { advertisedHostOverride } : {}),
  });
  const unavailable =
    input.requestedMode === "network-accessible" && requestedExposure.endpointUrl === null;
  const exposure = unavailable
    ? resolveDesktopServerExposure({
        mode: "local-only",
        port: input.port,
        networkInterfaces: input.networkInterfaces,
        ...(advertisedHostOverride ? { advertisedHostOverride } : {}),
      })
    : requestedExposure;

  return {
    state: runtimeStateFromResolvedExposure({
      requestedMode: input.requestedMode,
      exposure,
      port: input.port,
    }),
    unavailable,
  };
}

const requiresBackendRelaunch = (previous: RuntimeState, next: RuntimeState): boolean =>
  previous.port !== next.port ||
  previous.bindHost !== next.bindHost ||
  previous.localHttpUrl !== next.localHttpUrl;

const make = Effect.gen(function* () {
  const config = yield* DesktopConfig.DesktopConfig;
  const networkInterfaces = yield* DesktopNetworkInterfacesService;
  const desktopSettings = yield* DesktopAppSettingsService.DesktopAppSettings;
  const stateRef = yield* Ref.make(initialRuntimeState());

  const readNetworkInterfaces = networkInterfaces.read;

  const getState = Ref.get(stateRef).pipe(Effect.map(toContractState));
  const backendConfig = Ref.get(stateRef).pipe(Effect.map(toBackendConfig));

  const configureFromSettings = Effect.fn("desktop.serverExposure.configureFromSettings")(
    function* ({ port }: { readonly port: number }) {
      yield* Effect.annotateCurrentSpan({ port });
      const settings: DesktopSettings = yield* desktopSettings.get;
      const currentNetworkInterfaces = yield* readNetworkInterfaces;
      const resolved = resolveRuntimeState({
        requestedMode: settings.serverExposureMode,
        port,
        networkInterfaces: currentNetworkInterfaces,
        advertisedHostOverride: config.desktopLanHostOverride,
      });
      yield* Ref.set(stateRef, resolved.state);
      return toContractState(resolved.state);
    },
  );

  const setMode = Effect.fn("desktop.serverExposure.setMode")(function* (
    mode: DesktopServerExposureMode,
  ) {
    yield* Effect.annotateCurrentSpan({ mode });
    const previous = yield* Ref.get(stateRef);
    const currentNetworkInterfaces = yield* readNetworkInterfaces;
    const resolved = resolveRuntimeState({
      requestedMode: mode,
      port: previous.port,
      networkInterfaces: currentNetworkInterfaces,
      advertisedHostOverride: config.desktopLanHostOverride,
    });

    if (resolved.unavailable) {
      return yield* new DesktopServerExposureNoNetworkAddressError({ port: previous.port });
    }

    const change = yield* desktopSettings
      .setServerExposureMode(mode)
      .pipe(Effect.mapError((cause) => new DesktopServerExposurePersistenceError({ cause })));

    yield* Ref.set(stateRef, resolved.state);
    return {
      state: toContractState(resolved.state),
      requiresRelaunch: change.changed || requiresBackendRelaunch(previous, resolved.state),
    };
  });

  return DesktopServerExposure.of({
    getState,
    backendConfig,
    configureFromSettings,
    setMode,
  });
});

export const layer = Layer.effect(DesktopServerExposure, make);

export const networkInterfacesLayer = Layer.succeed(
  DesktopNetworkInterfacesService,
  DesktopNetworkInterfacesService.of({
    read: Effect.sync(() => NodeOS.networkInterfaces()),
  }),
);
