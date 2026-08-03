import type {
  DesktopRemoteHostState,
  DesktopRemotePairingLink,
  DesktopRemotePairingState,
  DesktopServerExposureState,
} from "@honk/shared/desktop-api";
import { describe, expect, it, vi } from "vitest";

import {
  createConnectDeviceController,
  type ConnectDeviceDependencies,
} from "./connect-device-controller";

const HOST: DesktopRemoteHostState = {
  status: "ready",
  name: "Studio Mac",
  publicUrl: "https://studio.example.com",
  localUrl: "http://127.0.0.1:4000",
  errorMessage: null,
  serveEnableUrl: null,
  devices: [],
};

const EXPOSURE: DesktopServerExposureState = {
  mode: "tailscale",
  localUrl: HOST.localUrl,
  endpointUrl: HOST.publicUrl,
  browserUrl: HOST.publicUrl,
  customUrl: null,
  advertisedHost: "studio.tail.example.com",
};

const PAIRING: DesktopRemotePairingLink = {
  id: "pairing-1",
  url: "https://studio.example.com/pair#pairing=secret",
  mobileUrl: "honk://connect?origin=https%3A%2F%2Fstudio.example.com#pairing=secret",
  expiresAt: "2026-07-20T18:10:00.000Z",
};

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (cause: unknown) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((cause: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (cause) => rejectPromise?.(cause),
  };
}

function fixture(overrides: Partial<ConnectDeviceDependencies> = {}) {
  const watchers = new Set<() => void>();
  let now = new Date("2026-07-20T18:00:00.000Z").getTime();
  const pairingState = vi.fn<(pairingID: string) => Promise<DesktopRemotePairingState | null>>(
    async () => ({ status: "pending", expiresAt: PAIRING.expiresAt }),
  );
  const cancel = vi.fn(async () => true);
  const issue = vi.fn(async () => PAIRING);
  const resume = { value: false };
  const controller = createConnectDeviceController({
    load: async () => ({ host: HOST, exposure: EXPOSURE }),
    issue,
    pairingState,
    cancel,
    enableTailscale: async () => EXPOSURE,
    restartHost: async () => undefined,
    now: () => now,
    watch: (listener) => {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    resume: {
      get: () => resume.value,
      set: () => {
        resume.value = true;
      },
      clear: () => {
        resume.value = false;
      },
    },
    ...overrides,
  });
  return {
    controller,
    issue,
    pairingState,
    cancel,
    resume,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    tick: async () => {
      for (const watcher of watchers) watcher();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("connect device controller", () => {
  it("cancels a code that finishes issuing after the dialog closes", async () => {
    const issued = deferred<DesktopRemotePairingLink | null>();
    const test = fixture({ issue: () => issued.promise });

    test.controller.actions.open();
    await Promise.resolve();
    expect(test.controller.getSnapshot().status).toBe("issuing");

    test.controller.actions.close();
    issued.resolve(PAIRING);

    await vi.waitFor(() => expect(test.controller.getSnapshot()).toEqual({ status: "closed" }));
    expect(test.cancel).toHaveBeenCalledWith(PAIRING.id);
  });

  it("waits for an explicit retry after issuance fails", async () => {
    const issue = vi.fn(async () => {
      throw new Error("Pairing service stopped.");
    });
    const test = fixture({ issue });

    test.controller.actions.open();
    await Promise.resolve();
    await Promise.resolve();

    expect(test.controller.getSnapshot()).toMatchObject({
      status: "error",
      retry: "issue",
      message: "Pairing service stopped.",
    });
    expect(issue).toHaveBeenCalledTimes(1);

    await test.tick();
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it("only reports the device that completed this pairing", async () => {
    const unrelated = {
      ...HOST,
      devices: [
        {
          id: "other-device",
          label: "Other phone",
          createdAt: "2026-07-20T18:01:00.000Z",
          revokedAt: null,
        },
      ],
    };
    const test = fixture({ load: async () => ({ host: unrelated, exposure: EXPOSURE }) });

    test.controller.actions.open();
    await Promise.resolve();
    await Promise.resolve();
    await test.tick();
    expect(test.controller.getSnapshot().status).toBe("pairing");

    test.pairingState.mockResolvedValue({
      status: "completed",
      expiresAt: PAIRING.expiresAt,
      device: {
        id: "paired-device",
        label: "Daniel's iPhone",
        createdAt: "2026-07-20T18:02:00.000Z",
        revokedAt: null,
      },
    });
    await test.tick();

    expect(test.controller.getSnapshot()).toMatchObject({
      status: "connected",
      device: { id: "paired-device", label: "Daniel's iPhone" },
    });
  });

  it("refreshes the host after replacement while keeping the exact paired device", async () => {
    const oldDevice = {
      id: "old-device",
      label: "Daniel's iPhone",
      createdAt: "2026-07-20T17:00:00.000Z",
      revokedAt: null,
    };
    const pairedDevice = {
      id: "paired-device",
      label: "Daniel's iPhone",
      createdAt: "2026-07-20T18:02:00.000Z",
      revokedAt: null,
    };
    const refreshedHost = {
      ...HOST,
      devices: [{ ...oldDevice, revokedAt: "2026-07-20T18:02:00.000Z" }, pairedDevice],
    };
    const load = vi
      .fn<ConnectDeviceDependencies["load"]>()
      .mockResolvedValueOnce({ host: { ...HOST, devices: [oldDevice] }, exposure: EXPOSURE })
      .mockResolvedValueOnce({ host: refreshedHost, exposure: EXPOSURE });
    const test = fixture({
      load,
      pairingState: async () => ({
        status: "completed",
        expiresAt: PAIRING.expiresAt,
        device: pairedDevice,
      }),
    });

    test.controller.actions.open();
    await vi.waitFor(() => expect(test.controller.getSnapshot().status).toBe("connected"));

    expect(test.controller.getSnapshot()).toMatchObject({
      status: "connected",
      device: { id: pairedDevice.id },
      host: { devices: refreshedHost.devices },
    });
  });

  it("still reports the exact paired device when the final host refresh fails", async () => {
    const pairedDevice = {
      id: "paired-device",
      label: "Daniel's iPhone",
      createdAt: "2026-07-20T18:02:00.000Z",
      revokedAt: null,
    };
    const load = vi
      .fn<ConnectDeviceDependencies["load"]>()
      .mockResolvedValueOnce({ host: HOST, exposure: EXPOSURE })
      .mockRejectedValueOnce(new Error("Host restarted."));
    const test = fixture({
      load,
      pairingState: async () => ({
        status: "completed",
        expiresAt: PAIRING.expiresAt,
        device: pairedDevice,
      }),
    });

    test.controller.actions.open();
    await vi.waitFor(() => expect(test.controller.getSnapshot().status).toBe("connected"));
    expect(test.controller.getSnapshot()).toMatchObject({
      status: "connected",
      device: { id: pairedDevice.id },
      host: { devices: [{ id: pairedDevice.id }] },
    });
  });

  it("shows expiry and issues a fresh code only when requested", async () => {
    const nextPairing = { ...PAIRING, id: "pairing-2" };
    const pairingState = vi
      .fn<ConnectDeviceDependencies["pairingState"]>()
      .mockResolvedValueOnce({ status: "expired", expiresAt: PAIRING.expiresAt })
      .mockResolvedValue({ status: "pending", expiresAt: nextPairing.expiresAt });
    const test = fixture({ pairingState });
    test.issue.mockResolvedValueOnce(PAIRING).mockResolvedValueOnce(nextPairing);

    test.controller.actions.open();
    await vi.waitFor(() => expect(test.controller.getSnapshot().status).toBe("expired"));

    expect(test.controller.getSnapshot().status).toBe("expired");
    expect(test.issue).toHaveBeenCalledTimes(1);

    test.controller.actions.newPairing();
    await vi.waitFor(() =>
      expect(test.controller.getSnapshot()).toMatchObject({
        status: "pairing",
        pairing: { id: "pairing-2" },
      }),
    );
  });

  it("clears relaunch recovery on close and terminal load failure", async () => {
    const closed = fixture();
    closed.resume.value = true;
    closed.controller.actions.resume();
    closed.controller.actions.close();
    expect(closed.resume.value).toBe(false);

    const failed = fixture({
      load: async () => {
        throw new Error("Remote access failed to start.");
      },
    });
    failed.resume.value = true;
    failed.controller.actions.resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(failed.resume.value).toBe(false);
    expect(failed.controller.getSnapshot()).toMatchObject({ status: "error", retry: "load" });
  });

  it("keeps relaunch recovery until a resumed pairing is issued", async () => {
    const startingHost = { ...HOST, status: "starting" as const };
    const load = vi
      .fn<ConnectDeviceDependencies["load"]>()
      .mockResolvedValueOnce({ host: startingHost, exposure: EXPOSURE })
      .mockResolvedValueOnce({ host: HOST, exposure: EXPOSURE });
    const test = fixture({ load });
    test.resume.value = true;

    test.controller.actions.resume();
    await Promise.resolve();
    expect(test.controller.getSnapshot().status).toBe("starting");
    expect(test.resume.value).toBe(true);

    await test.tick();
    expect(test.controller.getSnapshot().status).toBe("pairing");
    expect(test.resume.value).toBe(false);
  });

  it("requests a real host relaunch and keeps recovery until the next renderer", async () => {
    const restart = deferred<void>();
    const test = fixture({
      load: async () => ({
        host: { ...HOST, status: "error", errorMessage: "Tailscale is disconnected." },
        exposure: EXPOSURE,
      }),
      restartHost: () => restart.promise,
    });

    test.controller.actions.open();
    await Promise.resolve();
    expect(test.controller.getSnapshot().status).toBe("host-error");

    test.controller.actions.retry();
    expect(test.controller.getSnapshot().status).toBe("restarting");
    expect(test.resume.value).toBe(true);
    restart.resolve(undefined);
    await Promise.resolve();
    expect(test.resume.value).toBe(true);

    test.controller.actions.close();
    expect(test.resume.value).toBe(false);
  });

  it("makes a stalled relaunch retryable without discarding relaunch recovery", async () => {
    const restartHost = vi.fn(async () => undefined);
    const test = fixture({
      load: async () => ({
        host: { ...HOST, status: "error", errorMessage: "Tailscale is disconnected." },
        exposure: EXPOSURE,
      }),
      restartHost,
    });

    test.controller.actions.open();
    await vi.waitFor(() => expect(test.controller.getSnapshot().status).toBe("host-error"));
    test.controller.actions.retry();
    await Promise.resolve();

    expect(test.controller.getSnapshot().status).toBe("restarting");
    test.advance(15_000);
    await test.tick();

    expect(test.controller.getSnapshot()).toMatchObject({
      status: "error",
      retry: "restart",
      message: "Honk did not restart device connections. Try again to continue.",
    });
    expect(test.resume.value).toBe(true);

    test.controller.actions.retry();
    expect(test.controller.getSnapshot().status).toBe("restarting");
    expect(restartHost).toHaveBeenCalledTimes(2);
    expect(test.resume.value).toBe(true);
    test.controller.actions.close();
  });

  it("ignores an enable request that completes after the dialog is reopened", async () => {
    const firstEnable = deferred<DesktopServerExposureState | null>();
    const secondEnable = deferred<DesktopServerExposureState | null>();
    const enableTailscale = vi
      .fn<ConnectDeviceDependencies["enableTailscale"]>()
      .mockReturnValueOnce(firstEnable.promise)
      .mockReturnValueOnce(secondEnable.promise);
    const test = fixture({
      load: async () => ({
        host: { ...HOST, status: "disabled" },
        exposure: { ...EXPOSURE, mode: "local-only" },
      }),
      enableTailscale,
    });

    test.controller.actions.open();
    await vi.waitFor(() => expect(test.controller.getSnapshot().status).toBe("setup"));
    test.controller.actions.enableTailscale();
    test.controller.actions.close();
    test.controller.actions.open();
    await vi.waitFor(() => expect(test.controller.getSnapshot().status).toBe("setup"));
    test.controller.actions.enableTailscale();

    firstEnable.resolve(EXPOSURE);
    await firstEnable.promise;
    await Promise.resolve();
    expect(test.controller.getSnapshot().status).toBe("enabling");
    expect(test.resume.value).toBe(true);

    test.controller.actions.close();
  });

  it("keeps cancellation failures visible and retryable", async () => {
    const cancel = vi
      .fn<ConnectDeviceDependencies["cancel"]>()
      .mockRejectedValueOnce(new Error("Host could not save the cancellation."))
      .mockResolvedValue(true);
    const active = fixture({ cancel });
    active.controller.actions.open();
    await vi.waitFor(() => expect(active.controller.getSnapshot().status).toBe("pairing"));
    active.controller.actions.close();
    await vi.waitFor(() =>
      expect(active.controller.getSnapshot()).toMatchObject({
        status: "cancel-error",
        pairingID: PAIRING.id,
      }),
    );
    active.controller.actions.retry();
    await vi.waitFor(() => expect(active.controller.getSnapshot()).toEqual({ status: "closed" }));

    const lateCancel = vi
      .fn<ConnectDeviceDependencies["cancel"]>()
      .mockRejectedValueOnce(new Error("Host could not save the cancellation."))
      .mockResolvedValue(true);
    const pendingIssue = deferred<DesktopRemotePairingLink | null>();
    const late = fixture({ cancel: lateCancel, issue: () => pendingIssue.promise });
    late.controller.actions.open();
    await vi.waitFor(() => expect(late.controller.getSnapshot().status).toBe("issuing"));
    late.controller.actions.close();
    expect(late.controller.getSnapshot().status).toBe("cancelling");
    pendingIssue.resolve(PAIRING);
    await vi.waitFor(() => expect(late.controller.getSnapshot().status).toBe("cancel-error"));
    late.controller.actions.retry();
    await vi.waitFor(() => expect(late.controller.getSnapshot()).toEqual({ status: "closed" }));
  });

  it("treats a refused cancellation as a retryable failure", async () => {
    const cancel = vi
      .fn<ConnectDeviceDependencies["cancel"]>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const test = fixture({ cancel });

    test.controller.actions.open();
    await vi.waitFor(() => expect(test.controller.getSnapshot().status).toBe("pairing"));
    test.controller.actions.close();

    await vi.waitFor(() =>
      expect(test.controller.getSnapshot()).toMatchObject({
        status: "cancel-error",
        pairingID: PAIRING.id,
      }),
    );
    expect(cancel).toHaveBeenCalledWith(PAIRING.id);

    test.controller.actions.retry();
    await vi.waitFor(() => expect(test.controller.getSnapshot()).toEqual({ status: "closed" }));
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["expired", { status: "expired" as const, expiresAt: PAIRING.expiresAt }],
    ["cancelled", { status: "cancelled" as const, expiresAt: PAIRING.expiresAt }],
    ["unknown", { status: "unknown" as const }],
  ])("closes when a refused cancellation is already %s", async (_name, terminalState) => {
    const pairingState = vi
      .fn<ConnectDeviceDependencies["pairingState"]>()
      .mockResolvedValueOnce({ status: "pending", expiresAt: PAIRING.expiresAt })
      .mockResolvedValue(terminalState);
    const test = fixture({ cancel: async () => false, pairingState });

    test.controller.actions.open();
    await vi.waitFor(() => {
      expect(test.controller.getSnapshot().status).toBe("pairing");
      expect(pairingState).toHaveBeenCalledTimes(1);
    });
    test.controller.actions.close();

    await vi.waitFor(() => expect(test.controller.getSnapshot()).toEqual({ status: "closed" }));
    expect(pairingState).toHaveBeenCalledTimes(2);
  });
});
