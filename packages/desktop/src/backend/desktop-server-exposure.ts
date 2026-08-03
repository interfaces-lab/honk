import * as NodeOS from "node:os";
import {
  acquireCloudflaredExecutable,
  clearCloudflaredTunnelRecord,
  CloudflaredTunnelError,
  CloudflaredTunnelTimeoutError,
  CloudflaredUnavailableError,
  reclaimOrphanedCloudflaredTunnel,
  resolveTailscaleHttpsEndpoint,
  startCloudflaredQuickTunnel,
  TailscaleUnavailableError,
  writeCloudflaredTunnelRecord,
  type CloudflaredQuickTunnel,
  type TailscaleHttpsEndpoint,
} from "@honk/cli/host";
import { isPrivateNetworkHost } from "@honk/opencode/private-host";
import type {
  DesktopServerExposureConfiguration,
  DesktopServerExposureMode,
  DesktopServerExposureState,
} from "@honk/shared/desktop-api";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from "../settings/desktop-app-settings";
import * as DesktopConfig from "../app/desktop-config";
import * as DesktopEnvironment from "../app/desktop-environment";
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

export interface ResolvedDesktopServerExposure {
  readonly mode: DesktopServerExposureMode;
  readonly bindHost: string;
  readonly localHttpUrl: string;
  readonly localWsUrl: string;
  readonly endpointUrl: string | null;
  // The endpoint a browser can pair through. A plaintext LAN endpoint is excluded:
  // crypto.randomUUID and crypto.subtle are secure-context only, so browser pairing cannot run.
  readonly browserUrl: string | null;
  readonly advertisedHost: string | null;
}

// Private IPv4 only. A public address would publish a cleartext endpoint to the internet, and
// 100.64.0.0/10 is Tailscale's own range, which already terminates HTTPS.
const isPrivateLanIpv4Address = (address: string): boolean => {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4) return false;
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second = 0] = octets;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return first === 192 && second === 168;
};

const resolveLanAdvertisedHost = (
  networkInterfaces: DesktopNetworkInterfaces,
  explicitHost: string | undefined,
): string | null =>
  privateOverrideHost(explicitHost) ??
  Object.values(networkInterfaces)
    .flatMap((interfaceAddresses) => interfaceAddresses ?? [])
    .find(
      (address) =>
        !address.internal && address.family === "IPv4" && isPrivateLanIpv4Address(address.address),
    )?.address ??
  null;

// The override ships to devices inside a pairing URL, so accept only a bare private host: a colon
// would smuggle a port or an IPv6 literal, the port always comes from the bound listener, and the
// URL parse rejects credentials, a path, a query, and a fragment.
const privateOverrideHost = (explicitHost: string | undefined): string | null => {
  const value = explicitHost?.trim();
  if (value === undefined || value.length === 0 || value.includes(":")) return null;
  if (!URL.canParse(`http://${value}`)) return null;
  const url = new URL(`http://${value}`);
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (url.search.length > 0 || url.hash.length > 0) return null;
  return isPrivateNetworkHost(url.hostname) ? url.hostname : null;
};

export const resolveDesktopServerExposure = (input: {
  readonly mode: DesktopServerExposureMode;
  readonly port: number;
  readonly networkInterfaces: DesktopNetworkInterfaces;
  readonly advertisedHostOverride?: string;
  readonly publicUrl: string | null;
  readonly tailscaleEndpoint: TailscaleHttpsEndpoint | null;
  readonly tunnelEndpoint: { readonly url: string; readonly hostname: string } | null;
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
      browserUrl: null,
      advertisedHost: null,
    };
  }

  if (input.mode === "tailscale") {
    return {
      mode: input.mode,
      bindHost: DESKTOP_LOOPBACK_HOST,
      localHttpUrl,
      localWsUrl,
      endpointUrl: input.tailscaleEndpoint?.url ?? null,
      browserUrl: input.tailscaleEndpoint?.url ?? null,
      advertisedHost: input.tailscaleEndpoint?.magicDnsName ?? null,
    };
  }

  if (input.mode === "tunnel") {
    return {
      mode: input.mode,
      bindHost: DESKTOP_LOOPBACK_HOST,
      localHttpUrl,
      localWsUrl,
      endpointUrl: input.tunnelEndpoint?.url ?? null,
      browserUrl: input.tunnelEndpoint?.url ?? null,
      advertisedHost: input.tunnelEndpoint?.hostname ?? null,
    };
  }

  const lanHost = resolveLanAdvertisedHost(input.networkInterfaces, input.advertisedHostOverride);
  // Port zero asks the host to choose a port, so the requested value cannot be advertised.
  const endpointUrl =
    input.publicUrl ??
    (input.port === 0 || lanHost === null ? null : `http://${lanHost}:${input.port}`);

  return {
    mode: input.mode,
    bindHost: DESKTOP_LAN_BIND_HOST,
    localHttpUrl,
    localWsUrl,
    endpointUrl,
    browserUrl: endpointUrl?.startsWith("https:") === true ? endpointUrl : null,
    advertisedHost: endpointUrl === null ? null : new URL(endpointUrl).hostname,
  };
};

export class DesktopServerExposurePublicUrlRequiredError extends Data.TaggedError(
  "DesktopServerExposurePublicUrlRequiredError",
)<{}> {
  override get message() {
    return "Enter a secure connection address before turning on device connections.";
  }
}

export class DesktopServerExposurePublicUrlError extends Data.TaggedError(
  "DesktopServerExposurePublicUrlError",
)<{}> {
  override get message() {
    return "Enter an address that starts with https:// and does not include a path, sign-in details, or extra options.";
  }
}

export class DesktopServerExposureTailscaleError extends Data.TaggedError(
  "DesktopServerExposureTailscaleError",
)<{}> {
  override get message() {
    return "Open Tailscale, make sure it is connected, then try again.";
  }
}

export class DesktopServerExposureTunnelError extends Data.TaggedError(
  "DesktopServerExposureTunnelError",
)<{}> {
  override get message() {
    return "Honk could not prepare the secure connection. Check your internet connection, then try again.";
  }
}

export class DesktopServerExposureLanUnavailableError extends Data.TaggedError(
  "DesktopServerExposureLanUnavailableError",
)<{}> {
  override get message() {
    return "Honk could not find this computer on your Wi-Fi network. Connect to a network, then try again.";
  }
}

export class DesktopServerExposurePersistenceError extends Data.TaggedError(
  "DesktopServerExposurePersistenceError",
)<{
  readonly cause: DesktopAppSettingsService.DesktopSettingsWriteError;
}> {
  override get message() {
    return "Honk could not save the connection settings.";
  }
}

export type DesktopServerExposureConfigurationError =
  | DesktopServerExposurePublicUrlRequiredError
  | DesktopServerExposurePublicUrlError
  | DesktopServerExposureTailscaleError
  | DesktopServerExposureTunnelError
  | DesktopServerExposureLanUnavailableError
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
  readonly setConfiguration: (
    input: DesktopServerExposureConfiguration,
  ) => Effect.Effect<DesktopServerExposureChange, DesktopServerExposureConfigurationError>;
  // The backend owns failure paths that must not leave a tunnel pointing at a host that never bound.
  readonly closeTunnel: Effect.Effect<void>;
  // This never completes outside tunnel mode, so the remote-host watcher can await it unconditionally.
  readonly awaitTunnelExit: Effect.Effect<void>;
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

export interface DesktopTailscaleEndpointServiceShape {
  readonly resolve: Effect.Effect<TailscaleHttpsEndpoint, TailscaleUnavailableError>;
}

export class DesktopTailscaleEndpointService extends Context.Service<
  DesktopTailscaleEndpointService,
  DesktopTailscaleEndpointServiceShape
>()("honk/desktop/ServerExposure/TailscaleEndpoint") {}

export interface DesktopTunnelEndpointServiceShape {
  // This prepares cloudflared for the settings toggle without opening a tunnel.
  readonly probe: Effect.Effect<void, CloudflaredUnavailableError>;
  readonly open: (input: {
    readonly targetOrigin: string;
  }) => Effect.Effect<
    CloudflaredQuickTunnel,
    CloudflaredUnavailableError | CloudflaredTunnelError | CloudflaredTunnelTimeoutError
  >;
  // Honk closed this child itself, so a later launch must not try to reap its old pid.
  readonly release: Effect.Effect<void>;
}

export class DesktopTunnelEndpointService extends Context.Service<
  DesktopTunnelEndpointService,
  DesktopTunnelEndpointServiceShape
>()("honk/desktop/ServerExposure/TunnelEndpoint") {}

interface RuntimeState {
  readonly requestedMode: DesktopServerExposureMode;
  readonly mode: DesktopServerExposureMode;
  readonly port: number;
  readonly bindHost: string;
  readonly localHttpUrl: string;
  readonly localWsUrl: string;
  readonly httpBaseUrl: URL;
  readonly endpointUrl: Option.Option<string>;
  readonly browserUrl: Option.Option<string>;
  readonly customUrl: Option.Option<string>;
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
  readonly customUrl: string | null;
}): RuntimeState => ({
  requestedMode: input.requestedMode,
  mode: input.exposure.mode,
  port: input.port,
  bindHost: input.exposure.bindHost,
  localHttpUrl: input.exposure.localHttpUrl,
  localWsUrl: input.exposure.localWsUrl,
  httpBaseUrl: new URL(input.exposure.localHttpUrl),
  endpointUrl: Option.fromNullishOr(input.exposure.endpointUrl),
  browserUrl: Option.fromNullishOr(input.exposure.browserUrl),
  customUrl: Option.fromNullishOr(input.customUrl),
  advertisedHost: Option.fromNullishOr(input.exposure.advertisedHost),
});

const initialRuntimeState = (): RuntimeState =>
  runtimeStateFromResolvedExposure({
    requestedMode: DEFAULT_DESKTOP_SETTINGS.serverExposureMode,
    exposure: resolveDesktopServerExposure({
      mode: DEFAULT_DESKTOP_SETTINGS.serverExposureMode,
      port: 0,
      networkInterfaces: {},
      publicUrl: DEFAULT_DESKTOP_SETTINGS.serverPublicUrl,
      tailscaleEndpoint: null,
      tunnelEndpoint: null,
    }),
    port: 0,
    customUrl: DEFAULT_DESKTOP_SETTINGS.serverPublicUrl,
  });

const toContractState = (state: RuntimeState): DesktopServerExposureState => ({
  mode: state.mode,
  localUrl: state.port === 0 ? null : state.localHttpUrl,
  endpointUrl: Option.getOrNull(state.endpointUrl),
  browserUrl: Option.getOrNull(state.browserUrl),
  customUrl: Option.getOrNull(state.customUrl),
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
  readonly publicUrl: string | null;
  readonly tailscaleEndpoint: TailscaleHttpsEndpoint | null;
  readonly tunnelEndpoint: { readonly url: string; readonly hostname: string } | null;
}): ResolvedRuntimeState {
  const advertisedHostOverride = Option.getOrUndefined(input.advertisedHostOverride);
  const requestedExposure = resolveDesktopServerExposure({
    mode: input.requestedMode,
    port: input.port,
    networkInterfaces: input.networkInterfaces,
    publicUrl: input.publicUrl,
    tailscaleEndpoint: input.tailscaleEndpoint,
    tunnelEndpoint: input.tunnelEndpoint,
    ...(advertisedHostOverride ? { advertisedHostOverride } : {}),
  });
  const unavailable =
    input.requestedMode !== "local-only" && requestedExposure.endpointUrl === null;

  return {
    state: runtimeStateFromResolvedExposure({
      requestedMode: input.requestedMode,
      exposure: requestedExposure,
      port: input.port,
      customUrl: input.publicUrl,
    }),
    unavailable,
  };
}

const requiresBackendRelaunch = (previous: RuntimeState, next: RuntimeState): boolean =>
  previous.mode !== next.mode ||
  previous.port !== next.port ||
  previous.bindHost !== next.bindHost ||
  previous.localHttpUrl !== next.localHttpUrl ||
  Option.getOrNull(previous.endpointUrl) !== Option.getOrNull(next.endpointUrl);

export function normalizeDesktopServerPublicUrl(value: string | null): string | null {
  const input = value?.trim() ?? "";
  if (input.length === 0) return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw new DesktopServerExposurePublicUrlError();
    }
    return url.origin;
  } catch (cause) {
    if (cause instanceof DesktopServerExposurePublicUrlError) throw cause;
    throw new DesktopServerExposurePublicUrlError();
  }
}

const make = Effect.gen(function* () {
  const config = yield* DesktopConfig.DesktopConfig;
  const networkInterfaces = yield* DesktopNetworkInterfacesService;
  const tailscaleEndpoint = yield* DesktopTailscaleEndpointService;
  const tunnelEndpoint = yield* DesktopTunnelEndpointService;
  const desktopSettings = yield* DesktopAppSettingsService.DesktopAppSettings;
  const stateRef = yield* Ref.make(initialRuntimeState());
  const tunnelRef = yield* Ref.make<
    Option.Option<{
      readonly tunnel: CloudflaredQuickTunnel;
      readonly exit: Deferred.Deferred<void>;
    }>
  >(Option.none());
  const tunnelExit = yield* Deferred.make<void>();
  const tunnelMutex = yield* Semaphore.make(1);
  const scope = yield* Effect.scope;

  const readNetworkInterfaces = networkInterfaces.read;

  const getState = Ref.get(stateRef).pipe(Effect.map(toContractState));
  const backendConfig = Ref.get(stateRef).pipe(Effect.map(toBackendConfig));
  const closeTunnelWithoutPermit = Effect.gen(function* () {
    const running = yield* Ref.getAndSet(tunnelRef, Option.none());
    yield* Option.match(running, {
      onNone: () => Effect.void,
      onSome: (entry) =>
        Effect.promise(() => entry.tunnel.close()).pipe(
          Effect.ignore,
          Effect.andThen(tunnelEndpoint.release),
        ),
    });
  });
  const closeTunnel = tunnelMutex.withPermits(1)(closeTunnelWithoutPermit);
  const awaitTunnelExit = Deferred.await(tunnelExit);

  yield* Effect.addFinalizer(() => closeTunnel);

  const configureFromSettings = Effect.fn("desktop.serverExposure.configureFromSettings")(
    function* ({ port }: { readonly port: number }) {
      return yield* tunnelMutex.withPermits(1)(
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan({ port });
          yield* closeTunnelWithoutPermit;
          const settings: DesktopSettings = yield* desktopSettings.get;
          const currentNetworkInterfaces = yield* readNetworkInterfaces;
          const resolvedTailscaleEndpoint =
            settings.serverExposureMode === "tailscale"
              ? yield* tailscaleEndpoint.resolve.pipe(Effect.orElseSucceed(() => null))
              : null;
          // Port zero asks the host to choose a port, so there is no real listener to tunnel to yet.
          const resolvedTunnelEndpoint =
            settings.serverExposureMode === "tunnel" && port !== 0
              ? yield* Effect.gen(function* () {
                  const tunnel = yield* tunnelEndpoint.open({
                    targetOrigin: `http://${DESKTOP_LOOPBACK_HOST}:${port}`,
                  });
                  const exit = yield* Deferred.make<void>();
                  yield* Ref.set(tunnelRef, Option.some({ tunnel, exit }));
                  yield* Effect.forkIn(
                    Effect.gen(function* () {
                      yield* Effect.promise(() => tunnel.exited);
                      yield* Deferred.succeed(exit, undefined);
                      const current = yield* Ref.get(tunnelRef);
                      if (Option.isSome(current) && current.value.exit === exit) {
                        yield* Deferred.succeed(tunnelExit, undefined);
                      }
                    }),
                    scope,
                  );
                  return tunnel;
                }).pipe(Effect.orElseSucceed(() => null))
              : null;
          const resolved = resolveRuntimeState({
            requestedMode: settings.serverExposureMode,
            port,
            networkInterfaces: currentNetworkInterfaces,
            advertisedHostOverride: config.desktopLanHostOverride,
            publicUrl: normalizeDesktopServerPublicUrl(settings.serverPublicUrl),
            tailscaleEndpoint: resolvedTailscaleEndpoint,
            tunnelEndpoint: resolvedTunnelEndpoint,
          });
          yield* Ref.set(stateRef, resolved.state);
          return toContractState(resolved.state);
        }),
      );
    },
  );

  const setConfiguration = Effect.fn("desktop.serverExposure.setConfiguration")(function* (
    input: DesktopServerExposureConfiguration,
  ) {
    yield* Effect.annotateCurrentSpan({ mode: input.mode });
    const normalized = yield* Effect.try({
      try: () => normalizeDesktopServerPublicUrl(input.publicUrl),
      catch: () => new DesktopServerExposurePublicUrlError(),
    });
    const previous = yield* Ref.get(stateRef);
    const currentNetworkInterfaces = yield* readNetworkInterfaces;
    if (input.mode === "tunnel") {
      yield* tunnelEndpoint.probe.pipe(
        Effect.mapError(() => new DesktopServerExposureTunnelError()),
      );
    }
    const currentTailscaleUrl = Option.getOrNull(previous.endpointUrl);
    const currentTailscaleDnsName = Option.getOrNull(previous.advertisedHost);
    const currentTailscaleEndpoint =
      input.mode === "tailscale" &&
      previous.requestedMode === "tailscale" &&
      currentTailscaleUrl !== null &&
      currentTailscaleDnsName !== null
        ? {
            url: currentTailscaleUrl,
            magicDnsName: currentTailscaleDnsName,
            tailnetIpv4Addresses: Object.freeze([]),
          }
        : null;
    const resolvedTailscaleEndpoint =
      input.mode === "tailscale" && currentTailscaleEndpoint === null
        ? yield* tailscaleEndpoint.resolve.pipe(
            Effect.mapError(() => new DesktopServerExposureTailscaleError()),
          )
        : currentTailscaleEndpoint;
    const resolved = resolveRuntimeState({
      requestedMode: input.mode,
      port: previous.port,
      networkInterfaces: currentNetworkInterfaces,
      advertisedHostOverride: config.desktopLanHostOverride,
      publicUrl: normalized,
      tailscaleEndpoint: resolvedTailscaleEndpoint,
      tunnelEndpoint: null,
    });
    // Tunnel readiness is prepared now, but its ephemeral endpoint is created after relaunch.
    if (resolved.unavailable && input.mode !== "tunnel") {
      if (input.mode === "tailscale") return yield* new DesktopServerExposureTailscaleError();
      if (normalized === null) return yield* new DesktopServerExposureLanUnavailableError();
      return yield* new DesktopServerExposurePublicUrlRequiredError();
    }
    yield* desktopSettings
      .setServerExposure({ mode: input.mode, publicUrl: normalized })
      .pipe(Effect.mapError((cause) => new DesktopServerExposurePersistenceError({ cause })));
    yield* Ref.set(stateRef, resolved.state);
    return {
      state: toContractState(resolved.state),
      requiresRelaunch: requiresBackendRelaunch(previous, resolved.state),
    };
  });

  return DesktopServerExposure.of({
    getState,
    backendConfig,
    configureFromSettings,
    setConfiguration,
    closeTunnel,
    awaitTunnelExit,
  });
});

export const layer = Layer.effect(DesktopServerExposure, make);

export const networkInterfacesLayer = Layer.succeed(
  DesktopNetworkInterfacesService,
  DesktopNetworkInterfacesService.of({
    read: Effect.sync(() => NodeOS.networkInterfaces()),
  }),
);

export const tailscaleEndpointLayer = Layer.succeed(
  DesktopTailscaleEndpointService,
  DesktopTailscaleEndpointService.of({
    resolve: Effect.tryPromise({
      try: () => resolveTailscaleHttpsEndpoint(),
      catch: () => new TailscaleUnavailableError(),
    }),
  }),
);

export const tunnelEndpointLayer = Layer.effect(
  DesktopTunnelEndpointService,
  Effect.gen(function* () {
    const config = yield* DesktopConfig.DesktopConfig;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    // Keep the child record beside host state because both describe the same desktop-owned listener.
    const recordPath = environment.path.join(environment.stateDir, "quick-tunnel.json");
    yield* Effect.tryPromise({
      try: () => reclaimOrphanedCloudflaredTunnel(recordPath),
      catch: () => new CloudflaredTunnelError(),
    }).pipe(Effect.ignore);
    const acquireExecutable = Effect.tryPromise({
      try: () =>
        acquireCloudflaredExecutable({
          stateDirectory: environment.stateDir,
          platform: environment.platform,
          arch: environment.processArch,
          ...Option.match(config.cloudflaredExecutableOverride, {
            onNone: () => ({}),
            onSome: (executableOverride) => ({ executableOverride }),
          }),
        }),
      catch: () => new CloudflaredUnavailableError(),
    });

    return DesktopTunnelEndpointService.of({
      probe: acquireExecutable.pipe(Effect.asVoid),
      open: (input) =>
        acquireExecutable.pipe(
          Effect.flatMap((executable) =>
            Effect.tryPromise({
              try: () =>
                startCloudflaredQuickTunnel(input.targetOrigin, {
                  platform: environment.platform,
                  executable,
                }),
              catch: (cause) => {
                if (cause instanceof CloudflaredUnavailableError) return cause;
                if (cause instanceof CloudflaredTunnelTimeoutError) return cause;
                return cause instanceof CloudflaredTunnelError
                  ? cause
                  : new CloudflaredTunnelError();
              },
            }).pipe(
              // The record only helps the next launch reap an orphan, so a failed write must not
              // cost the user a working tunnel.
              Effect.tap((tunnel) => {
                const pid = tunnel.pid;
                if (pid === null) return Effect.void;
                return Effect.tryPromise({
                  try: () =>
                    writeCloudflaredTunnelRecord(recordPath, {
                      pid,
                      executable,
                      startedAt: tunnel.startedAt,
                    }),
                  catch: () => new CloudflaredTunnelError(),
                }).pipe(Effect.ignore);
              }),
            ),
          ),
        ),
      release: Effect.tryPromise({
        try: () => clearCloudflaredTunnelRecord(recordPath),
        catch: () => new CloudflaredTunnelError(),
      }).pipe(Effect.ignore),
    });
  }),
);
