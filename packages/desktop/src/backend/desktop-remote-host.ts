import {
  disableTailscaleHttpsServe,
  enableTailscaleHttpsServe,
  startHonkHost,
  TailscaleServeError,
  type HonkHost,
  type PairingLink,
} from "@honk/cli/host";
import { freshAdminSecret, readHostState, type DeviceRecord } from "@honk/cli/state";
import type {
  DesktopRemoteHostDevice,
  DesktopRemoteHostState,
  DesktopRemotePairingLink,
} from "@honk/shared/desktop-api";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as DesktopConfig from "../app/desktop-config";
import * as DesktopEnvironment from "../app/desktop-environment";
import * as OpencodeSidecar from "./opencode-sidecar";
import * as DesktopServerExposure from "./desktop-server-exposure";

const SIDECAR_READY_ATTEMPTS = 400;
const SIDECAR_READY_INTERVAL = Duration.millis(300);

const INITIAL_STATE: DesktopRemoteHostState = {
  status: "disabled",
  publicUrl: null,
  localUrl: null,
  errorMessage: null,
  devices: [],
};

export class DesktopRemoteHostUnavailableError extends Data.TaggedError(
  "DesktopRemoteHostUnavailableError",
)<{}> {
  override get message() {
    return "Remote access is not running.";
  }
}

export class DesktopRemoteHostSidecarError extends Data.TaggedError(
  "DesktopRemoteHostSidecarError",
)<{}> {
  override get message() {
    return "OpenCode did not publish its local endpoint before the remote host timed out.";
  }
}

export class DesktopRemoteHostTailscaleError extends Data.TaggedError(
  "DesktopRemoteHostTailscaleError",
)<{}> {
  override get message() {
    return "Tailscale HTTPS Serve could not be configured.";
  }
}

export interface DesktopRemoteHostShape {
  readonly start: Effect.Effect<void>;
  readonly getState: Effect.Effect<DesktopRemoteHostState>;
  readonly issuePairing: (
    label: string | null,
  ) => Effect.Effect<DesktopRemotePairingLink, DesktopRemoteHostUnavailableError>;
  readonly revokeDevice: (
    deviceID: string,
  ) => Effect.Effect<DesktopRemoteHostState, DesktopRemoteHostUnavailableError>;
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

function publicPairing(pairing: PairingLink): DesktopRemotePairingLink {
  return {
    url: pairing.url,
    mobileUrl: pairing.mobileUrl,
    expiresAt: pairing.expiresAt,
  };
}

function stateWithDevices(
  state: DesktopRemoteHostState,
  host: HonkHost | null,
): DesktopRemoteHostState {
  return host === null ? state : { ...state, devices: host.devices().map(publicDevice) };
}

const make = Effect.gen(function* () {
  const config = yield* DesktopConfig.DesktopConfig;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const exposure = yield* DesktopServerExposure.DesktopServerExposure;
  const sidecar = yield* OpencodeSidecar.OpencodeSidecar;
  const stateRef = yield* Ref.make<DesktopRemoteHostState>(INITIAL_STATE);
  const hostRef = yield* Ref.make<Option.Option<HonkHost>>(Option.none());
  const tailscaleServeRef = yield* Ref.make(false);

  const readPublicState = Effect.gen(function* () {
    const [state, host] = yield* Effect.all([Ref.get(stateRef), Ref.get(hostRef)]);
    return stateWithDevices(state, Option.getOrNull(host));
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
    const configured = yield* exposure.configureFromSettings({ port: config.desktopRemotePort });
    if (configured.mode === "local-only") {
      yield* Ref.set(stateRef, INITIAL_STATE);
      return;
    }
    if (configured.endpointUrl === null || configured.localUrl === null) {
      yield* Ref.set(stateRef, {
        status: "error" as const,
        publicUrl: configured.endpointUrl,
        localUrl: configured.localUrl,
        errorMessage:
          configured.mode === "tailscale"
            ? "Tailscale must be installed, connected, and have MagicDNS enabled."
            : "Remote access requires a public HTTPS URL.",
        devices: [],
      });
      return;
    }

    const publicUrl = configured.endpointUrl;

    yield* Ref.set(stateRef, {
      status: "starting",
      publicUrl: configured.endpointUrl,
      localUrl: configured.localUrl,
      errorMessage: null,
      devices: [],
    });
    const upstream = yield* waitForSidecar;
    const backend = yield* exposure.backendConfig;
    const previous = yield* Effect.promise(() => readHostState(environment.remoteHostStatePath));
    const host = yield* Effect.tryPromise({
      try: () =>
        startHonkHost({
          hostname: backend.bindHost,
          port: backend.port,
          publicUrl,
          upstreamOrigin: upstream.origin,
          upstreamPassword: upstream.password,
          cwd: environment.backendCwd,
          adminSecret: previous?.adminSecret ?? freshAdminSecret(),
          devices: previous?.devices ?? [],
          statePath: environment.remoteHostStatePath,
        }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (configured.mode === "tailscale") {
      yield* Effect.tryPromise({
        try: () => enableTailscaleHttpsServe(host.origin),
        catch: () => new DesktopRemoteHostTailscaleError(),
      }).pipe(Effect.tapError(() => Effect.promise(() => host.close()).pipe(Effect.ignore)));
      yield* Ref.set(tailscaleServeRef, true);
    }
    yield* Ref.set(hostRef, Option.some(host));
    yield* Ref.set(stateRef, {
      status: "ready",
      publicUrl: host.publicUrl,
      localUrl: configured.localUrl,
      errorMessage: null,
      devices: host.devices().map(publicDevice),
    });
  }).pipe(
    Effect.catch((cause) =>
      Ref.update(stateRef, (state) => ({
        ...state,
        status: "error" as const,
        errorMessage: cause instanceof Error ? cause.message : String(cause),
      })),
    ),
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

  return DesktopRemoteHost.of({
    start,
    getState: readPublicState,
    issuePairing: (label) =>
      Ref.get(hostRef).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new DesktopRemoteHostUnavailableError()),
            onSome: (host) =>
              Effect.sync(() => publicPairing(host.issuePairing(label?.trim() || undefined))),
          }),
        ),
      ),
    revokeDevice: (deviceID) =>
      Ref.get(hostRef).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new DesktopRemoteHostUnavailableError()),
            onSome: (host) =>
              Effect.promise(() => host.revokeDevice(deviceID)).pipe(
                Effect.andThen(readPublicState),
              ),
          }),
        ),
      ),
  });
});

export const layer = Layer.effect(DesktopRemoteHost, make);
