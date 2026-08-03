import {
  disableTailscaleHttpsServe,
  enableTailscaleHttpsServe,
  RemoteDisplayNameError,
  startHonkHost,
  TailscaleServeError,
  TailscaleServeNotEnabledError,
  type HonkHost,
  type PairingLink,
  normalizeRemoteDisplayName,
} from "@honk/cli/host";
import {
  freshAdminSecret,
  freshServerId,
  readHostState,
  writeHostState,
  type DeviceRecord,
} from "@honk/cli/state";
import type {
  DesktopRemoteHostDevice,
  DesktopRemoteHostState,
  DesktopRemotePairingLink,
  DesktopRemotePairingState,
} from "@honk/shared/desktop-api";
import { hostname } from "node:os";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import * as DesktopConfig from "../app/desktop-config";
import * as DesktopEnvironment from "../app/desktop-environment";
import * as DesktopAppSettingsService from "../settings/desktop-app-settings";
import * as OpencodeSidecar from "./opencode-sidecar";
import * as DesktopServerExposure from "./desktop-server-exposure";

const SIDECAR_READY_ATTEMPTS = 400;
const SIDECAR_READY_INTERVAL = Duration.millis(300);
const TUNNEL_EXIT_ERROR_MESSAGE =
  "The temporary link closed. Restart Honk to create a new one.";

const INITIAL_STATE: DesktopRemoteHostState = {
  status: "disabled",
  name: hostname(),
  publicUrl: null,
  localUrl: null,
  errorMessage: null,
  serveEnableUrl: null,
  devices: [],
};

export class DesktopRemoteHostUnavailableError extends Data.TaggedError(
  "DesktopRemoteHostUnavailableError",
)<{}> {
  override get message() {
    return "Device connections are not running.";
  }
}

export class DesktopRemoteHostSidecarError extends Data.TaggedError(
  "DesktopRemoteHostSidecarError",
)<{}> {
  override get message() {
    return "Honk was not ready before device connections timed out.";
  }
}

export class DesktopRemoteHostStaticBundleError extends Data.TaggedError(
  "DesktopRemoteHostStaticBundleError",
)<{}> {
  override get message() {
    return "Honk's web app is missing. Reinstall Honk or rebuild the desktop app, then try again.";
  }
}

export class DesktopRemoteHostTailscaleError extends Data.TaggedError(
  "DesktopRemoteHostTailscaleError",
)<{}> {
  override get message() {
    return "Honk could not finish setting up Tailscale. Open Tailscale, make sure it is connected, then try again.";
  }
}

export class DesktopRemoteHostServeNotEnabledError extends Data.TaggedError(
  "DesktopRemoteHostServeNotEnabledError",
)<{ readonly enableUrl: string | null }> {
  override get message() {
    return "Tailscale needs a one-time approval before it can give this computer a private HTTPS address. Approve it in Tailscale, then try again.";
  }
}

export class DesktopRemoteHostNameError extends Data.TaggedError("DesktopRemoteHostNameError")<{
  readonly message: string;
}> {}

export class DesktopRemoteHostDeviceError extends Data.TaggedError("DesktopRemoteHostDeviceError")<{
  readonly message: string;
}> {}

export interface DesktopRemoteHostShape {
  readonly start: Effect.Effect<void>;
  readonly getState: Effect.Effect<DesktopRemoteHostState>;
  readonly issuePairing: Effect.Effect<DesktopRemotePairingLink, DesktopRemoteHostUnavailableError>;
  readonly getPairingState: (
    pairingID: string,
  ) => Effect.Effect<DesktopRemotePairingState, DesktopRemoteHostUnavailableError>;
  readonly cancelPairing: (
    pairingID: string,
  ) => Effect.Effect<boolean, DesktopRemoteHostUnavailableError>;
  readonly setName: (
    name: string,
  ) => Effect.Effect<
    DesktopRemoteHostState,
    DesktopAppSettingsService.DesktopSettingsWriteError | DesktopRemoteHostNameError
  >;
  readonly renameDevice: (
    deviceID: string,
    label: string,
  ) => Effect.Effect<
    DesktopRemoteHostState,
    DesktopRemoteHostUnavailableError | DesktopRemoteHostDeviceError
  >;
  readonly revokeDevice: (
    deviceID: string,
  ) => Effect.Effect<
    DesktopRemoteHostState,
    DesktopRemoteHostUnavailableError | DesktopRemoteHostDeviceError
  >;
}

export class DesktopRemoteHost extends Context.Service<DesktopRemoteHost, DesktopRemoteHostShape>()(
  "honk/desktop/RemoteHost",
) {}

function publicDevice(device: DeviceRecord): DesktopRemoteHostDevice {
  return {
    id: device.id,
    label: device.label,
    createdAt: device.createdAt,
    revokedAt: device.revokedAt,
  };
}

function publicPairingState(host: HonkHost, pairingID: string): DesktopRemotePairingState {
  const pairing = host.pairingState(pairingID);
  if (pairing.status !== "completed") return pairing;
  const device = host.devices().find((candidate) => candidate.id === pairing.device.id);
  return device === undefined || device.revokedAt !== null
    ? { status: "unknown" }
    : { status: "completed", expiresAt: pairing.expiresAt, device: publicDevice(device) };
}

const make = Effect.gen(function* () {
  const config = yield* DesktopConfig.DesktopConfig;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const staticDir = yield* DesktopEnvironment.resolveDesktopStaticDir;
  const exposure = yield* DesktopServerExposure.DesktopServerExposure;
  const desktopSettings = yield* DesktopAppSettingsService.DesktopAppSettings;
  const sidecar = yield* OpencodeSidecar.OpencodeSidecar;
  const stateRef = yield* Ref.make<DesktopRemoteHostState>(INITIAL_STATE);
  const hostRef = yield* Ref.make<Option.Option<HonkHost>>(Option.none());
  const tailscaleServeRef = yield* Ref.make(false);
  const tunnelExited = yield* Ref.make(false);
  const savedHostMutex = yield* Semaphore.make(1);

  const readPublicState = Effect.gen(function* () {
    const [state, host] = yield* Effect.all([Ref.get(stateRef), Ref.get(hostRef)]);
    const runningHost = Option.getOrNull(host);
    return runningHost === null
      ? state
      : { ...state, devices: runningHost.devices().map(publicDevice) };
  });

  const updateSavedDevice = (
    deviceID: string,
    update: (device: DeviceRecord) => DeviceRecord,
  ): Effect.Effect<DesktopRemoteHostState, DesktopRemoteHostDeviceError> =>
    Effect.gen(function* () {
      const saved = yield* Effect.promise(() => readHostState(environment.remoteHostStatePath));
      const device = saved?.devices.find(
        (candidate) => candidate.id === deviceID && candidate.revokedAt === null,
      );
      if (saved === null || device === undefined) {
        return yield* new DesktopRemoteHostDeviceError({
          message: "This device no longer has access.",
        });
      }
      const devices = saved.devices.map((candidate) =>
        candidate.id === deviceID ? update(candidate) : candidate,
      );
      yield* Effect.tryPromise({
        try: () => writeHostState({ ...saved, devices }, environment.remoteHostStatePath),
        catch: () =>
          new DesktopRemoteHostDeviceError({
            message: "Honk could not save device access.",
          }),
      });
      yield* Ref.update(stateRef, (state) => ({ ...state, devices: devices.map(publicDevice) }));
      return yield* readPublicState;
    });

  const waitForSidecar = Effect.gen(function* () {
    for (let attempt = 0; attempt < SIDECAR_READY_ATTEMPTS; attempt += 1) {
      const current = yield* sidecar.snapshot;
      if (current.url !== null && current.password !== null) {
        return { origin: current.url, password: current.password };
      }
      yield* Effect.sleep(SIDECAR_READY_INTERVAL);
    }
    return yield* new DesktopRemoteHostSidecarError();
  });

  const start = Effect.gen(function* () {
    const settings = yield* desktopSettings.get;
    const hostName = settings.remoteHostName ?? hostname();
    const previous = yield* Effect.promise(() => readHostState(environment.remoteHostStatePath));
    yield* Ref.set(stateRef, {
      ...INITIAL_STATE,
      name: hostName,
      devices: previous?.devices.map(publicDevice) ?? [],
    });
    const configured = yield* exposure.configureFromSettings({ port: config.desktopRemotePort });
    if (configured.mode === "local-only") {
      return;
    }
    if (configured.endpointUrl === null || configured.localUrl === null) {
      yield* Ref.set(stateRef, {
        status: "error" as const,
        name: hostName,
        publicUrl: configured.endpointUrl,
        localUrl: configured.localUrl,
        errorMessage:
          configured.mode === "tailscale"
            ? "Open Tailscale, make sure it is connected, then try again."
            : configured.mode === "tunnel"
              ? "Honk could not open a temporary link. Check this computer's internet connection, then try again."
              : configured.customUrl === null
                ? "Honk could not find this computer on your Wi-Fi network."
                : "Enter a secure connection address in Device access settings.",
        serveEnableUrl: null,
        devices: previous?.devices.map(publicDevice) ?? [],
      });
      return;
    }

    const publicUrl = configured.endpointUrl;

    yield* Ref.set(stateRef, {
      status: "starting",
      name: hostName,
      publicUrl: configured.endpointUrl,
      localUrl: configured.localUrl,
      errorMessage: null,
      serveEnableUrl: null,
      devices: previous?.devices.map(publicDevice) ?? [],
    });
    const appDist = Option.getOrNull(staticDir);
    if (appDist === null) return yield* new DesktopRemoteHostStaticBundleError();
    const upstream = yield* waitForSidecar;
    const backend = yield* exposure.backendConfig;
    yield* savedHostMutex.withPermits(1)(
      Effect.gen(function* () {
        const latestSettings = yield* desktopSettings.get;
        const latestHostName = latestSettings.remoteHostName ?? hostname();
        const latest = yield* Effect.promise(() => readHostState(environment.remoteHostStatePath));
        const host = yield* Effect.tryPromise({
          try: () =>
            startHonkHost({
              name: latestHostName,
              hostname: backend.bindHost,
              port: backend.port,
              publicUrl,
              // Tunnel clients arrive over loopback, so pairing limits must use cf-connecting-ip.
              ...(configured.mode === "tunnel" ? { trustLoopbackForwardedFor: true } : {}),
              upstreamOrigin: upstream.origin,
              upstreamPassword: upstream.password,
              cwd: environment.backendCwd,
              appDist,
              adminSecret: latest?.adminSecret ?? freshAdminSecret(),
              serverId: latest?.serverId ?? freshServerId(),
              devices: latest?.devices ?? [],
              statePath: environment.remoteHostStatePath,
            }),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(Effect.tapError(() => exposure.closeTunnel));
        if (configured.mode === "tailscale") {
          yield* Effect.tryPromise({
            try: () => enableTailscaleHttpsServe(host.origin),
            catch: (cause) =>
              cause instanceof TailscaleServeNotEnabledError
                ? new DesktopRemoteHostServeNotEnabledError({ enableUrl: cause.enableUrl })
                : new DesktopRemoteHostTailscaleError(),
          }).pipe(Effect.tapError(() => Effect.promise(() => host.close()).pipe(Effect.ignore)));
          yield* Ref.set(tailscaleServeRef, true);
        }
        yield* Ref.set(hostRef, Option.some(host));
        yield* Ref.set(stateRef, {
          status: "ready",
          name: latestHostName,
          publicUrl: host.publicUrl,
          localUrl: configured.localUrl,
          errorMessage: null,
          serveEnableUrl: null,
          devices: host.devices().map(publicDevice),
        });
        // Checking after publishing closes every watcher-versus-publisher interleaving.
        if (yield* Ref.get(tunnelExited)) {
          yield* Ref.update(stateRef, (state) => ({
            ...state,
            status: "error" as const,
            publicUrl: null,
            errorMessage: TUNNEL_EXIT_ERROR_MESSAGE,
          }));
        }
      }),
    );
  }).pipe(
    Effect.catchCause((cause) => {
      const failure = Cause.squash(cause);
      return Ref.update(stateRef, (state) => ({
        ...state,
        status: "error" as const,
        errorMessage: failure instanceof Error ? failure.message : String(failure),
        serveEnableUrl:
          failure instanceof DesktopRemoteHostServeNotEnabledError ? failure.enableUrl : null,
      }));
    }),
    Effect.withSpan("desktop.remoteHost.start"),
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const runningHost = yield* Ref.getAndSet(hostRef, Option.none());
      yield* Option.match(runningHost, {
        onNone: () => Effect.void,
        onSome: (host) => Effect.promise(() => host.close()).pipe(Effect.ignore),
      });
      const tailscaleConfigured = yield* Ref.getAndSet(tailscaleServeRef, false);
      if (tailscaleConfigured) {
        yield* Effect.tryPromise({
          try: () => disableTailscaleHttpsServe(),
          catch: () => new TailscaleServeError(),
        }).pipe(Effect.ignore);
      }
    }),
  );

  // A quick tunnel can die on its own. Do not keep advertising an address that no longer resolves.
  yield* Effect.forkScoped(
    exposure.awaitTunnelExit.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          yield* Ref.set(tunnelExited, true);
          yield* Ref.update(stateRef, (state) =>
            state.status === "disabled"
              ? state
              : {
                  ...state,
                  status: "error" as const,
                  publicUrl: null,
                  errorMessage: TUNNEL_EXIT_ERROR_MESSAGE,
                },
          );
        }),
      ),
    ),
  );

  return DesktopRemoteHost.of({
    start,
    getState: readPublicState,
    issuePairing: Ref.get(hostRef).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new DesktopRemoteHostUnavailableError()),
          onSome: (host) =>
            Effect.sync(() => {
              const pairing: PairingLink = host.issuePairing();
              return {
                id: pairing.id,
                url: pairing.url,
                mobileUrl: pairing.mobileUrl,
                expiresAt: pairing.expiresAt,
              } satisfies DesktopRemotePairingLink;
            }),
        }),
      ),
    ),
    getPairingState: (pairingID) =>
      Ref.get(hostRef).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new DesktopRemoteHostUnavailableError()),
            onSome: (host) => Effect.sync(() => publicPairingState(host, pairingID)),
          }),
        ),
      ),
    cancelPairing: (pairingID) =>
      Ref.get(hostRef).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new DesktopRemoteHostUnavailableError()),
            onSome: (host) => Effect.promise(() => host.cancelPairing(pairingID)),
          }),
        ),
      ),
    setName: (name) =>
      savedHostMutex.withPermits(1)(
        Effect.gen(function* () {
          const normalized = yield* Effect.try({
            try: () => normalizeRemoteDisplayName(name),
            catch: (cause) =>
              new DesktopRemoteHostNameError({
                message: cause instanceof Error ? cause.message : "The computer name is invalid.",
              }),
          });
          yield* desktopSettings.setRemoteHostName(normalized === hostname() ? null : normalized);
          yield* Option.match(yield* Ref.get(hostRef), {
            onNone: () => Effect.void,
            onSome: (host) => Effect.sync(() => host.setName(normalized)),
          });
          yield* Ref.update(stateRef, (state) => ({ ...state, name: normalized }));
          return yield* readPublicState;
        }).pipe(Effect.withSpan("desktop.remoteHost.setName")),
      ),
    renameDevice: (deviceID, label) =>
      savedHostMutex.withPermits(1)(
        Effect.gen(function* () {
          const normalized = yield* Effect.try({
            try: () => normalizeRemoteDisplayName(label),
            catch: (cause) =>
              new DesktopRemoteHostDeviceError({
                message:
                  cause instanceof RemoteDisplayNameError
                    ? cause.message
                    : "The device name is invalid.",
              }),
          });
          const host = Option.getOrNull(yield* Ref.get(hostRef));
          if (host === null) {
            return yield* updateSavedDevice(deviceID, (device) => ({
              ...device,
              label: normalized,
            }));
          }
          const renamed = yield* Effect.tryPromise({
            try: () => host.renameDevice(deviceID, normalized),
            catch: () =>
              new DesktopRemoteHostDeviceError({
                message: "Honk could not save the device name.",
              }),
          });
          if (!renamed) {
            return yield* new DesktopRemoteHostDeviceError({
              message: "This device no longer has access.",
            });
          }
          return yield* readPublicState;
        }),
      ),
    revokeDevice: (deviceID) =>
      savedHostMutex.withPermits(1)(
        Effect.gen(function* () {
          const host = Option.getOrNull(yield* Ref.get(hostRef));
          if (host === null) {
            return yield* updateSavedDevice(deviceID, (device) => ({
              ...device,
              revokedAt: new Date().toISOString(),
            }));
          }
          const revoked = yield* Effect.tryPromise({
            try: () => host.revokeDevice(deviceID),
            catch: () =>
              new DesktopRemoteHostDeviceError({
                message: "Honk could not remove access for this device.",
              }),
          });
          if (!revoked) {
            return yield* new DesktopRemoteHostDeviceError({
              message: "This device no longer has access.",
            });
          }
          return yield* readPublicState;
        }),
      ),
  });
});

export const layer = Layer.effect(DesktopRemoteHost, make);
