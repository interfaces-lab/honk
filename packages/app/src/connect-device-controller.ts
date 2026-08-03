import type {
  DesktopRemoteHostDevice,
  DesktopRemoteHostState,
  DesktopRemotePairingLink,
  DesktopRemotePairingState,
  DesktopServerExposureState,
} from "@honk/shared/desktop-api";
import { useSyncExternalStore } from "react";

import {
  cancelDesktopRemotePairing,
  configureDesktopServerExposure,
  getDesktopRemoteHostState,
  getDesktopRemotePairingState,
  getDesktopServerExposureState,
  issueDesktopRemotePairing,
  restartDesktopRemoteHost,
} from "./desktop-bridge";

const PAIRING_RESUME_KEY = "honk.desktop.resume-device-pairing";
const RELAUNCH_TIMEOUT_MS = 15_000;

type PairingContext = {
  readonly host: DesktopRemoteHostState;
  readonly exposure: DesktopServerExposureState;
};

export type ConnectDeviceSnapshot =
  | { readonly status: "closed" }
  | { readonly status: "cancelling" }
  | { readonly status: "cancel-error"; readonly pairingID: string; readonly message: string }
  | { readonly status: "loading" }
  | ({ readonly status: "setup" } & PairingContext)
  | ({ readonly status: "enabling" } & PairingContext)
  | ({ readonly status: "starting" } & PairingContext)
  | ({ readonly status: "host-error" } & PairingContext)
  | ({ readonly status: "restarting" } & PairingContext)
  | ({ readonly status: "issuing" } & PairingContext)
  | ({
      readonly status: "pairing";
      readonly pairing: DesktopRemotePairingLink;
      readonly remaining: number;
    } & PairingContext)
  | ({ readonly status: "expired"; readonly pairing: DesktopRemotePairingLink } & PairingContext)
  | ({ readonly status: "connected"; readonly device: DesktopRemoteHostDevice } & PairingContext)
  | {
      readonly status: "error";
      readonly message: string;
      readonly retry: "load";
    }
  | ({
      readonly status: "error";
      readonly message: string;
      readonly retry: "enable" | "issue" | "restart";
    } & PairingContext)
  | ({
      readonly status: "error";
      readonly message: string;
      readonly retry: "check";
      readonly pairing: DesktopRemotePairingLink;
    } & PairingContext);

export interface ConnectDeviceDependencies {
  readonly load: () => Promise<{
    readonly host: DesktopRemoteHostState | null;
    readonly exposure: DesktopServerExposureState | null;
  }>;
  readonly issue: () => Promise<DesktopRemotePairingLink | null>;
  readonly pairingState: (pairingID: string) => Promise<DesktopRemotePairingState | null>;
  readonly cancel: (pairingID: string) => Promise<boolean>;
  readonly enableTailscale: (
    publicUrl: string | null,
  ) => Promise<DesktopServerExposureState | null>;
  readonly restartHost: () => Promise<void>;
  readonly now: () => number;
  readonly watch: (listener: () => void) => () => void;
  readonly resume: {
    readonly get: () => boolean;
    readonly set: () => void;
    readonly clear: () => void;
  };
}

export interface ConnectDeviceController {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ConnectDeviceSnapshot;
  readonly actions: {
    readonly resume: () => void;
    readonly open: () => void;
    readonly close: () => void;
    readonly retry: () => void;
    readonly enableTailscale: () => void;
    readonly newPairing: () => void;
    readonly connectAnother: () => void;
  };
}

const CLOSED_SNAPSHOT: ConnectDeviceSnapshot = Object.freeze({ status: "closed" });

export function createConnectDeviceController(
  dependencies: ConnectDeviceDependencies,
): ConnectDeviceController {
  const listeners = new Set<() => void>();
  let snapshot = CLOSED_SNAPSHOT;
  let generation = 0;
  let stopWatching: (() => void) | null = null;
  let pairingCheck: object | null = null;
  let hostCheck: object | null = null;
  let relaunchWatch: object | null = null;
  let pendingCancellation: { readonly request: object; readonly pairingID: string | null } | null =
    null;

  const publish = (next: ConnectDeviceSnapshot): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const stop = (): void => {
    stopWatching?.();
    stopWatching = null;
    pairingCheck = null;
    hostCheck = null;
    relaunchWatch = null;
  };

  const report = (cause: unknown, fallback: string): string =>
    cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;

  const cancelPairing = (pairingID: string): void => {
    void dependencies.cancel(pairingID).catch(() => undefined);
  };

  const finishCancellation = (pairingID: string, request: object): void => {
    pendingCancellation = { request, pairingID };
    void dependencies
      .cancel(pairingID)
      .then(async (cancelled): Promise<boolean | undefined> => {
        if (pendingCancellation?.request !== request) return undefined;
        if (cancelled) return true;
        const pairing = await dependencies.pairingState(pairingID);
        if (pendingCancellation?.request !== request) return undefined;
        return pairing !== null && pairing.status !== "pending";
      })
      .then(
        (cancelled) => {
          if (cancelled === undefined || pendingCancellation?.request !== request) return;
          pendingCancellation = null;
          if (!cancelled) {
            publish({
              status: "cancel-error",
              pairingID,
              message: "Honk could not cancel this code. Try again before closing this window.",
            });
            return;
          }
          publish(CLOSED_SNAPSHOT);
        },
        () => {
          if (pendingCancellation?.request !== request) return;
          pendingCancellation = null;
          publish({
            status: "cancel-error",
            pairingID,
            message: "Honk could not cancel this code. Try again before closing this window.",
          });
        },
      );
  };

  const beginCancellation = (pairingID: string): void => {
    const request = {};
    publish({ status: "cancelling" });
    finishCancellation(pairingID, request);
  };

  const check = async (requestGeneration: number): Promise<void> => {
    if (snapshot.status !== "pairing" || pairingCheck !== null) return;
    const current = snapshot;
    const request = {};
    const remaining = Math.max(
      0,
      Math.ceil((new Date(current.pairing.expiresAt).getTime() - dependencies.now()) / 1_000),
    );
    if (remaining !== current.remaining) publish({ ...current, remaining });
    pairingCheck = request;
    try {
      const pairing = await dependencies.pairingState(current.pairing.id);
      if (
        pairingCheck !== request ||
        requestGeneration !== generation ||
        snapshot.status !== "pairing" ||
        snapshot.pairing.id !== current.pairing.id
      ) {
        return;
      }
      if (pairing?.status === "completed") {
        const refreshed = await dependencies.load().catch(() => null);
        if (
          pairingCheck !== request ||
          requestGeneration !== generation ||
          snapshot.status !== "pairing" ||
          snapshot.pairing.id !== current.pairing.id
        ) {
          return;
        }
        stop();
        publish({
          status: "connected",
          host: refreshed?.host ?? {
            ...current.host,
            devices: [
              ...current.host.devices.filter((device) => device.id !== pairing.device.id),
              pairing.device,
            ],
          },
          exposure: refreshed?.exposure ?? current.exposure,
          device: pairing.device,
        });
        return;
      }
      if (pairing?.status === "expired" || pairing?.status === "cancelled") {
        stop();
        publish({ ...current, status: "expired" });
        return;
      }
      if (pairing?.status === "unknown" || pairing === null) {
        stop();
        publish({
          status: "error",
          host: current.host,
          exposure: current.exposure,
          pairing: current.pairing,
          retry: "check",
          message: "This pairing code is no longer available.",
        });
      }
    } catch (cause) {
      if (
        pairingCheck !== request ||
        requestGeneration !== generation ||
        snapshot.status !== "pairing" ||
        snapshot.pairing.id !== current.pairing.id
      ) {
        return;
      }
      stop();
      publish({
        status: "error",
        host: current.host,
        exposure: current.exposure,
        pairing: current.pairing,
        retry: "check",
        message: report(cause, "Honk could not check whether the device connected."),
      });
    } finally {
      if (pairingCheck === request) pairingCheck = null;
    }
  };

  const watch = (requestGeneration: number): void => {
    stop();
    stopWatching = dependencies.watch(() => void check(requestGeneration));
    void check(requestGeneration);
  };

  const issue = async (context: PairingContext, requestGeneration: number): Promise<void> => {
    stop();
    publish({ status: "issuing", ...context });
    try {
      const pairing = await dependencies.issue();
      if (requestGeneration !== generation) {
        const cancellation = pendingCancellation;
        if (cancellation?.pairingID === null && snapshot.status === "cancelling") {
          if (pairing === null) {
            pendingCancellation = null;
            publish(CLOSED_SNAPSHOT);
            return;
          }
          finishCancellation(pairing.id, cancellation.request);
          return;
        }
        if (pairing !== null) cancelPairing(pairing.id);
        return;
      }
      if (pairing === null) {
        dependencies.resume.clear();
        publish({
          status: "error",
          ...context,
          retry: "issue",
          message: "Honk could not create a pairing code.",
        });
        return;
      }
      dependencies.resume.clear();
      publish({
        status: "pairing",
        ...context,
        pairing,
        remaining: Math.max(
          0,
          Math.ceil((new Date(pairing.expiresAt).getTime() - dependencies.now()) / 1_000),
        ),
      });
      watch(requestGeneration);
    } catch (cause) {
      if (requestGeneration !== generation) {
        if (pendingCancellation?.pairingID === null && snapshot.status === "cancelling") {
          pendingCancellation = null;
          publish(CLOSED_SNAPSHOT);
        }
        return;
      }
      dependencies.resume.clear();
      publish({
        status: "error",
        ...context,
        retry: "issue",
        message: report(cause, "Honk could not create a pairing code."),
      });
    }
  };

  const waitForHost = async (requestGeneration: number): Promise<void> => {
    if (snapshot.status !== "starting" || hostCheck !== null) return;
    const request = {};
    hostCheck = request;
    try {
      const loaded = await dependencies.load();
      if (
        hostCheck !== request ||
        requestGeneration !== generation ||
        snapshot.status !== "starting"
      ) {
        return;
      }
      if (loaded.host === null || loaded.exposure === null) {
        stop();
        dependencies.resume.clear();
        publish({
          status: "error",
          retry: "load",
          message: "Device connections are not available in this version of Honk.",
        });
        return;
      }
      const context = { host: loaded.host, exposure: loaded.exposure };
      if (loaded.host.status === "ready") {
        await issue(context, requestGeneration);
        return;
      }
      if (loaded.exposure.mode === "local-only" || loaded.host.status === "disabled") {
        stop();
        dependencies.resume.clear();
        publish({ status: "setup", ...context });
        return;
      }
      if (loaded.host.status === "error") {
        stop();
        dependencies.resume.clear();
        publish({ status: "host-error", ...context });
        return;
      }
      publish({ status: "starting", ...context });
    } catch (cause) {
      if (
        hostCheck !== request ||
        requestGeneration !== generation ||
        snapshot.status !== "starting"
      ) {
        return;
      }
      stop();
      dependencies.resume.clear();
      publish({
        status: "error",
        retry: "load",
        message: report(cause, "Honk could not load connection settings."),
      });
    } finally {
      if (hostCheck === request) hostCheck = null;
    }
  };

  const watchHost = (requestGeneration: number): void => {
    stop();
    stopWatching = dependencies.watch(() => void waitForHost(requestGeneration));
  };

  const load = async (requestGeneration: number): Promise<void> => {
    stop();
    publish({ status: "loading" });
    try {
      const loaded = await dependencies.load();
      if (requestGeneration !== generation) return;
      if (loaded.host === null || loaded.exposure === null) {
        dependencies.resume.clear();
        publish({
          status: "error",
          retry: "load",
          message: "Device connections are not available in this version of Honk.",
        });
        return;
      }
      const context = { host: loaded.host, exposure: loaded.exposure };
      if (loaded.exposure.mode === "local-only" || loaded.host.status === "disabled") {
        dependencies.resume.clear();
        publish({ status: "setup", ...context });
        return;
      }
      if (loaded.host.status === "starting") {
        publish({ status: "starting", ...context });
        watchHost(requestGeneration);
        return;
      }
      if (loaded.host.status === "error") {
        dependencies.resume.clear();
        publish({ status: "host-error", ...context });
        return;
      }
      await issue(context, requestGeneration);
    } catch (cause) {
      if (requestGeneration !== generation) return;
      dependencies.resume.clear();
      publish({
        status: "error",
        retry: "load",
        message: report(cause, "Honk could not load connection settings."),
      });
    }
  };

  const watchForRelaunch = (context: PairingContext, requestGeneration: number): void => {
    stop();
    const request = {};
    const startedAt = dependencies.now();
    relaunchWatch = request;
    publish({ status: "restarting", host: context.host, exposure: context.exposure });
    stopWatching = dependencies.watch(() => {
      if (
        relaunchWatch !== request ||
        requestGeneration !== generation ||
        snapshot.status !== "restarting" ||
        dependencies.now() - startedAt < RELAUNCH_TIMEOUT_MS
      ) {
        return;
      }
      stop();
      publish({
        status: "error",
        host: context.host,
        exposure: context.exposure,
        retry: "restart",
        message: "Honk did not restart device connections. Try again to continue.",
      });
    });
  };

  const restartHost = (context: PairingContext): void => {
    const requestGeneration = generation;
    dependencies.resume.set();
    watchForRelaunch(context, requestGeneration);
    void dependencies.restartHost().catch((cause: unknown) => {
      if (requestGeneration !== generation || snapshot.status !== "restarting") return;
      stop();
      dependencies.resume.clear();
      publish({
        status: "error",
        host: context.host,
        exposure: context.exposure,
        retry: "restart",
        message: report(cause, "Honk could not restart device connections."),
      });
    });
  };

  const actions = {
    resume(): void {
      if (dependencies.resume.get()) actions.open();
    },
    open(): void {
      if (snapshot.status !== "closed") return;
      generation += 1;
      void load(generation);
    },
    close(): void {
      const current = snapshot;
      if (current.status === "cancelling") return;
      if (current.status === "cancel-error") {
        beginCancellation(current.pairingID);
        return;
      }
      generation += 1;
      stop();
      dependencies.resume.clear();
      const pairing =
        current.status === "pairing" ||
        current.status === "expired" ||
        (current.status === "error" && current.retry === "check")
          ? current.pairing
          : null;
      if (pairing !== null) {
        beginCancellation(pairing.id);
        return;
      }
      if (current.status === "issuing") {
        const request = {};
        pendingCancellation = { request, pairingID: null };
        publish({ status: "cancelling" });
        return;
      }
      pendingCancellation = null;
      publish(CLOSED_SNAPSHOT);
    },
    retry(): void {
      const current = snapshot;
      if (current.status === "cancel-error") {
        beginCancellation(current.pairingID);
        return;
      }
      if (current.status === "host-error") {
        restartHost(current);
        return;
      }
      if (current.status === "starting") {
        void waitForHost(generation);
        return;
      }
      if (current.status !== "error") return;
      if (current.retry === "load") {
        void load(generation);
        return;
      }
      if (current.retry === "enable") {
        actions.enableTailscale();
        return;
      }
      if (current.retry === "restart") {
        restartHost(current);
        return;
      }
      if (current.retry === "issue") {
        void issue({ host: current.host, exposure: current.exposure }, generation);
        return;
      }
      if (current.retry !== "check") return;
      publish({
        status: "pairing",
        host: current.host,
        exposure: current.exposure,
        pairing: current.pairing,
        remaining: 0,
      });
      watch(generation);
    },
    enableTailscale(): void {
      const current = snapshot;
      if (
        current.status !== "setup" &&
        !(current.status === "error" && current.retry === "enable")
      ) {
        return;
      }
      const context = { host: current.host, exposure: current.exposure };
      const requestGeneration = generation;
      dependencies.resume.set();
      publish({ status: "enabling", ...context });
      void dependencies
        .enableTailscale(current.exposure.customUrl)
        .then(() => {
          if (requestGeneration !== generation || snapshot.status !== "enabling") return;
          watchForRelaunch(context, requestGeneration);
        })
        .catch((cause: unknown) => {
          if (requestGeneration !== generation || snapshot.status !== "enabling") return;
          dependencies.resume.clear();
          publish({
            status: "error",
            ...context,
            retry: "enable",
            message: report(cause, "Honk could not turn on Tailscale access."),
          });
        });
    },
    newPairing(): void {
      const current = snapshot;
      if (current.status !== "expired") return;
      cancelPairing(current.pairing.id);
      void issue({ host: current.host, exposure: current.exposure }, generation);
    },
    connectAnother(): void {
      const current = snapshot;
      if (current.status !== "connected") return;
      void issue({ host: current.host, exposure: current.exposure }, generation);
    },
  } as const;

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    actions,
  };
}

export const connectDeviceController = createConnectDeviceController({
  load: async () => {
    const [exposure, host] = await Promise.all([
      getDesktopServerExposureState(),
      getDesktopRemoteHostState(),
    ]);
    return { host, exposure };
  },
  issue: issueDesktopRemotePairing,
  pairingState: getDesktopRemotePairingState,
  cancel: cancelDesktopRemotePairing,
  enableTailscale: async (publicUrl) =>
    (await configureDesktopServerExposure({ mode: "tailscale", publicUrl }))?.state ?? null,
  restartHost: restartDesktopRemoteHost,
  now: Date.now,
  watch: (listener) => {
    const timer = window.setInterval(listener, 1_000);
    return () => window.clearInterval(timer);
  },
  resume: {
    get: () => window.localStorage.getItem(PAIRING_RESUME_KEY) === "1",
    set: () => window.localStorage.setItem(PAIRING_RESUME_KEY, "1"),
    clear: () => window.localStorage.removeItem(PAIRING_RESUME_KEY),
  },
});

export function useConnectDeviceSnapshot(): ConnectDeviceSnapshot {
  return useSyncExternalStore(
    connectDeviceController.subscribe,
    connectDeviceController.getSnapshot,
    () => CLOSED_SNAPSHOT,
  );
}
