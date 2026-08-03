import { HonkPairingRequestError } from "@honk/opencode";
import { describe, expect, it, vi } from "vitest";

import {
  ConnectionRequestTimeoutError,
  runWithConnectionRequestDeadline,
} from "./connection-request";
import {
  beginPairingAdoption,
  decodePairingAdoption,
  PairingIdentityError,
  removePairingAdoption,
  resumePairingAdoption,
  type PairingAdoption,
  type PairingAdoptionOperations,
  type PairingRequest,
  type PendingPairingAdoption,
} from "./pairing-adoption";

const REQUEST_ID = "019f81b3-e756-7740-943d-c647307d40d9";
const EXPIRES_AT = "2026-07-20T21:30:00.000Z";
const input = {
  deviceId: null,
  origin: "https://mac.example.com",
  serverId: "server-mac",
  rebindOrigin: null,
  token: "one-time-token",
  requestId: REQUEST_ID,
  serverLabel: "Studio Mac",
  deviceLabel: "Honk on iPhone",
  defaultDirectory: "",
  replacePassword: null,
  replaceServerId: null,
  previousServerLabel: null,
  previousDefaultDirectory: null,
  previousActiveServerKey: null,
  previousEnvironmentId: null,
  previousDeviceId: null,
  previousProofKeyThumbprint: null,
};
const replacementInput = {
  ...input,
  rebindOrigin: "https://old-mac.example.com",
  replacePassword: "old-password",
  replaceServerId: "server-mac",
  previousServerLabel: "Previous Studio",
  previousDefaultDirectory: "/Users/me/Previous",
  previousActiveServerKey: "https://laptop.example.com",
  previousEnvironmentId: "environment-studio",
  previousDeviceId: "device-iphone",
  previousProofKeyThumbprint: "thumbprint-iphone",
};

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function operations(
  events: string[],
  options: {
    readonly failConfirm?: () => Error | null;
    readonly failExchange?: () => Error | null;
    readonly failPersistence?: boolean;
    readonly failStage?: PendingPairingAdoption["status"];
    readonly identityVerified?: boolean;
    readonly activationError?: Error;
    readonly probeError?: Error;
    readonly onStage?: (pending: PendingPairingAdoption) => void;
    readonly onRollback?: (pending: PendingPairingAdoption) => void;
    readonly isCurrent?: () => boolean;
  } = {},
): PairingAdoptionOperations {
  return {
    isCurrent: options.isCurrent ?? (() => true),
    verifyIdentity: async (target) => {
      events.push(`verifyIdentity:${target.origin}:${target.serverId}`);
      return options.identityVerified ?? true;
    },
    exchange: async (request) => {
      events.push(`exchange:${request.requestId}`);
      const failure = options.failExchange?.();
      if (failure !== null && failure !== undefined) throw failure;
      return {
        deviceId: "device-new",
        origin: request.origin,
        password: "provisional-password",
        requestId: request.requestId,
        expiresAt: EXPIRES_AT,
      };
    },
    stage: async (pending) => {
      events.push(`stage:${pending.status}`);
      if (options.failStage === pending.status) throw new Error("marker unavailable");
      options.onStage?.(pending);
    },
    persist: async () => {
      events.push("persist");
      if (options.failPersistence === true) throw new Error("registry unavailable");
    },
    confirm: async (adoption) => {
      events.push(`confirm:${adoption.requestId}`);
      const failure = options.failConfirm?.();
      if (failure !== null && failure !== undefined) throw failure;
      return {
        deviceId: adoption.deviceId,
        origin: adoption.origin,
        password: adoption.password,
        serverId: adoption.serverId,
      };
    },
    releaseRebind: async (adoption) => {
      events.push(`releaseRebind:${adoption.rebindOrigin}`);
    },
    activate: async () => {
      events.push("activate");
      if (options.activationError !== undefined) throw options.activationError;
    },
    probe: async (connection) => {
      events.push(`probe:${connection.password}`);
      if (options.probeError !== undefined) throw options.probeError;
    },
    isAccessRejected: (error) =>
      typeof error === "object" && error !== null && Reflect.get(error, "status") === 401,
    cancel: async () => {
      events.push("cancel");
    },
    rollback: async (pending) => {
      events.push(`rollback:${pending.status}:${String(pending.restorePreviousAccess)}`);
      options.onRollback?.(pending);
    },
    complete: async (pending) => {
      events.push(`complete:${pending.status}`);
    },
  };
}

function provisional(
  status: PairingAdoption["status"] = "provisional",
  replacePassword: string | null = null,
): PairingAdoption {
  return {
    deviceId: "device-new",
    origin: input.origin,
    serverId: input.serverId,
    rebindOrigin: input.rebindOrigin,
    password: "provisional-password",
    requestId: REQUEST_ID,
    expiresAt: EXPIRES_AT,
    serverLabel: input.serverLabel,
    defaultDirectory: input.defaultDirectory,
    replacePassword,
    replaceServerId: replacePassword === null ? null : replacementInput.replaceServerId,
    restorePreviousAccess: replacePassword !== null && status === "provisional",
    previousServerLabel: replacePassword === null ? null : replacementInput.previousServerLabel,
    previousDefaultDirectory:
      replacePassword === null ? null : replacementInput.previousDefaultDirectory,
    previousActiveServerKey:
      replacePassword === null ? null : replacementInput.previousActiveServerKey,
    previousEnvironmentId: replacePassword === null ? null : replacementInput.previousEnvironmentId,
    previousDeviceId: replacePassword === null ? null : replacementInput.previousDeviceId,
    previousProofKeyThumbprint:
      replacePassword === null ? null : replacementInput.previousProofKeyThumbprint,
    status,
  };
}

function replacementRequest(): PairingRequest {
  return {
    ...replacementInput,
    restorePreviousAccess: true,
    status: "requesting",
  };
}

describe("pairing adoption", () => {
  it("decodes legacy durable identity fields as null", () => {
    const legacy = {
      ...replacementRequest(),
      serverId: undefined,
      rebindOrigin: undefined,
      replaceServerId: undefined,
      previousEnvironmentId: undefined,
      previousDeviceId: undefined,
      previousProofKeyThumbprint: undefined,
    };

    expect(decodePairingAdoption(JSON.stringify(legacy))).toMatchObject({
      serverId: null,
      rebindOrigin: null,
      replaceServerId: null,
      previousEnvironmentId: null,
      previousDeviceId: null,
      previousProofKeyThumbprint: null,
    });
  });

  it("round-trips identity and managed rollback fields", () => {
    const record: PairingRequest = {
      ...replacementInput,
      origin: "https://mac.example.com/",
      rebindOrigin: "https://old-mac.example.com/",
      previousEnvironmentId: " environment-studio ",
      previousDeviceId: " device-iphone ",
      previousProofKeyThumbprint: " thumbprint-iphone ",
      restorePreviousAccess: true,
      status: "requesting",
    };

    expect(decodePairingAdoption(JSON.stringify(record))).toEqual({
      ...record,
      origin: "https://mac.example.com",
      rebindOrigin: "https://old-mac.example.com",
      previousEnvironmentId: "environment-studio",
      previousDeviceId: "device-iphone",
      previousProofKeyThumbprint: "thumbprint-iphone",
    });
  });

  it("round-trips an unfinished private-network HTTP pairing", () => {
    const record: PairingRequest = {
      ...input,
      origin: "http://192.168.1.42:4096",
      restorePreviousAccess: false,
      status: "requesting",
    };

    expect(decodePairingAdoption(JSON.stringify(record))).toEqual(record);
  });

  it("persists a stable request identity before exchange and confirms only after local storage", async () => {
    const events: string[] = [];
    const staged: PendingPairingAdoption[] = [];
    await beginPairingAdoption(
      input,
      operations(events, { onStage: (pending) => staged.push(pending) }),
    );

    expect(events).toEqual([
      "stage:requesting",
      `exchange:${REQUEST_ID}`,
      "stage:provisional",
      "persist",
      "stage:confirming",
      `confirm:${REQUEST_ID}`,
      "releaseRebind:null",
      "activate",
      "complete:confirming",
    ]);
    expect(staged.map((pending) => [pending.status, pending.deviceId])).toEqual([
      ["requesting", null],
      ["provisional", "device-new"],
      ["confirming", "device-new"],
    ]);
  });

  it("surfaces a request deadline without adopting or cancelling the owning attempt", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const owner = new AbortController();
    const actions: PairingAdoptionOperations = {
      ...operations(events, { isCurrent: () => !owner.signal.aborted }),
      exchange: (request) => {
        events.push(`exchange:${request.requestId}`);
        return runWithConnectionRequestDeadline(
          owner.signal,
          () => new Promise<never>(() => undefined),
          15_000,
        );
      },
    };
    const adoption = beginPairingAdoption(input, actions);
    const rejected = expect(adoption).rejects.toBeInstanceOf(ConnectionRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(15_000);

    await rejected;
    expect(owner.signal.aborted).toBe(false);
    expect(events).toEqual(["stage:requesting", `exchange:${REQUEST_ID}`]);
    vi.useRealTimers();
  });

  it("forgets the previous address only after the new access is confirmed", async () => {
    const events: string[] = [];
    await beginPairingAdoption(
      { ...input, rebindOrigin: "https://old-mac.example.com" },
      operations(events),
    );

    expect(events).toEqual([
      "stage:requesting",
      `exchange:${REQUEST_ID}`,
      "stage:provisional",
      "persist",
      "stage:confirming",
      `confirm:${REQUEST_ID}`,
      "releaseRebind:https://old-mac.example.com",
      "activate",
      "complete:confirming",
    ]);
  });

  it("keeps the previous saved connection when confirmation is rejected", async () => {
    const events: string[] = [];
    const unauthorized = Object.assign(new Error("unauthorized"), { status: 401 });

    await expect(
      beginPairingAdoption(
        { ...input, rebindOrigin: "https://old-mac.example.com" },
        operations(events, {
          failConfirm: () => new HonkPairingRequestError("invalid", "expired"),
          activationError: unauthorized,
        }),
      ),
    ).rejects.toThrow("expired");

    expect(events).toEqual([
      "stage:requesting",
      `exchange:${REQUEST_ID}`,
      "stage:provisional",
      "persist",
      "stage:confirming",
      `confirm:${REQUEST_ID}`,
      "activate",
      "cancel",
      "rollback:confirming:false",
      "complete:confirming",
    ]);
    expect(events.some((event) => event.startsWith("releaseRebind:"))).toBe(false);
  });

  it("resumes a crashed rebind to a consistent state", async () => {
    const events: string[] = [];
    await resumePairingAdoption(
      { ...provisional("confirming"), rebindOrigin: "https://old-mac.example.com" },
      operations(events, {
        failConfirm: () => new HonkPairingRequestError("invalid", "confirmation forgotten"),
      }),
    );

    expect(events).toEqual([
      "persist",
      `confirm:${REQUEST_ID}`,
      "activate",
      "releaseRebind:https://old-mac.example.com",
      "complete:confirming",
    ]);
  });

  it("releases the previous address at most once per adoption", async () => {
    const events: string[] = [];
    await beginPairingAdoption(
      { ...input, rebindOrigin: "https://old-mac.example.com" },
      operations(events),
    );

    expect(events.filter((event) => event.startsWith("releaseRebind:"))).toEqual([
      "releaseRebind:https://old-mac.example.com",
    ]);
  });

  it("refuses to send the saved password when the computer cannot prove its identity", async () => {
    const events: string[] = [];

    await expect(
      beginPairingAdoption(replacementInput, operations(events, { identityVerified: false })),
    ).rejects.toBeInstanceOf(PairingIdentityError);

    expect(events).toEqual([
      "stage:requesting",
      `verifyIdentity:${replacementInput.origin}:${replacementInput.replaceServerId}`,
    ]);
    expect(events.some((event) => event.startsWith("exchange:"))).toBe(false);
    expect(events).not.toContain("persist");
    expect(events.some((event) => event.startsWith("rollback:"))).toBe(false);
  });

  it("still exchanges when the saved record has no identity", async () => {
    const events: string[] = [];
    await beginPairingAdoption({ ...replacementInput, replaceServerId: null }, operations(events));

    expect(events).not.toContain(
      `verifyIdentity:${replacementInput.origin}:${replacementInput.replaceServerId}`,
    );
    expect(events).toContain(`exchange:${REQUEST_ID}`);
  });

  it("refuses the rollback probe when the computer cannot prove its identity", async () => {
    const events: string[] = [];

    await removePairingAdoption(
      provisional("confirming", "old-password"),
      operations(events, { identityVerified: false }),
    );

    // No probe, and the saved connection is kept rather than deleted on an unprovable computer.
    expect(events).toEqual([
      "stage:removing",
      "cancel",
      `verifyIdentity:${input.origin}:${replacementInput.replaceServerId}`,
      "rollback:removing:true",
      "complete:removing",
    ]);
    expect(events.some((event) => event.startsWith("probe:"))).toBe(false);
  });

  it("drops an unfinished replacement request locally when identity cannot be proven", async () => {
    const events: string[] = [];

    await removePairingAdoption(
      replacementRequest(),
      operations(events, { identityVerified: false }),
    );

    expect(events).toEqual([
      `verifyIdentity:${replacementInput.origin}:${replacementInput.replaceServerId}`,
      "rollback:requesting:true",
      "complete:requesting",
    ]);
    expect(events.some((event) => event.startsWith("exchange:"))).toBe(false);
  });

  it("verifies before every send of the saved password", async () => {
    const events: string[] = [];
    await beginPairingAdoption(replacementInput, operations(events));

    expect(
      events.indexOf(
        `verifyIdentity:${replacementInput.origin}:${replacementInput.replaceServerId}`,
      ),
    ).toBeLessThan(events.indexOf(`exchange:${REQUEST_ID}`));
  });

  it("does not let a delayed exchange stage or save access after cancellation begins", async () => {
    const events: string[] = [];
    const exchangeStarted = deferred();
    const exchangeResponse = deferred();
    const generation = { current: 1 };
    const staged: PendingPairingAdoption[] = [];
    let firstExchange = true;
    const actions: PairingAdoptionOperations = {
      ...operations(events, {
        isCurrent: () => generation.current === 1,
        onStage: (pending) => {
          staged.push(pending);
        },
      }),
      exchange: async (request) => {
        events.push(`exchange:${request.requestId}`);
        if (firstExchange) {
          firstExchange = false;
          exchangeStarted.resolve();
          await exchangeResponse.promise;
        }
        return {
          deviceId: "device-new",
          origin: request.origin,
          password: "provisional-password",
          requestId: request.requestId,
          expiresAt: EXPIRES_AT,
        };
      },
    };

    const finishing = beginPairingAdoption(input, actions);
    await exchangeStarted.promise;
    const durable = staged.at(-1);
    if (durable === undefined || durable.status !== "requesting") {
      throw new Error("Missing durable request.");
    }
    generation.current = 2;
    await removePairingAdoption(durable, {
      ...actions,
      isCurrent: () => generation.current === 2,
    });
    exchangeResponse.resolve();
    await finishing;

    expect(events).toEqual([
      "stage:requesting",
      `exchange:${REQUEST_ID}`,
      `exchange:${REQUEST_ID}`,
      "stage:removing",
      "cancel",
      "rollback:removing:false",
      "complete:removing",
    ]);
    expect(events).not.toContain("stage:provisional");
    expect(events).not.toContain("persist");
    expect(events).not.toContain(`confirm:${REQUEST_ID}`);
    expect(events).not.toContain("activate");
  });

  it("does not let a delayed confirmation overwrite the removing state", async () => {
    const events: string[] = [];
    const confirmationStarted = deferred();
    const confirmationResponse = deferred();
    const generation = { current: 1 };
    const staged: PendingPairingAdoption[] = [];
    const actions: PairingAdoptionOperations = {
      ...operations(events, {
        isCurrent: () => generation.current === 1,
        onStage: (pending) => {
          staged.push(pending);
        },
      }),
      confirm: async (adoption) => {
        events.push(`confirm:${adoption.requestId}`);
        confirmationStarted.resolve();
        await confirmationResponse.promise;
        return {
          deviceId: adoption.deviceId,
          origin: adoption.origin,
          password: adoption.password,
          serverId: adoption.serverId,
        };
      },
    };

    const finishing = beginPairingAdoption(input, actions);
    await confirmationStarted.promise;
    const durable = staged.at(-1);
    if (durable === undefined || durable.status !== "confirming") {
      throw new Error("Missing durable confirmation.");
    }
    generation.current = 2;
    await removePairingAdoption(durable, {
      ...actions,
      isCurrent: () => generation.current === 2,
    });
    confirmationResponse.resolve();
    await finishing;

    expect(events.slice(events.indexOf(`confirm:${REQUEST_ID}`) + 1)).toEqual([
      "stage:removing",
      "cancel",
      "rollback:removing:false",
      "complete:removing",
    ]);
    expect(events).not.toContain("activate");
  });

  it("cancels provisional access before any follow-up marker write when storage fails", async () => {
    const events: string[] = [];
    await expect(
      beginPairingAdoption(input, operations(events, { failPersistence: true })),
    ).rejects.toThrow("new access was removed");

    expect(events).toEqual([
      "stage:requesting",
      `exchange:${REQUEST_ID}`,
      "stage:provisional",
      "persist",
      "cancel",
      "rollback:provisional:false",
      "complete:provisional",
    ]);
    expect(events).not.toContain("stage:removing");
  });

  it("cancels from memory when the provisional marker itself cannot be saved", async () => {
    const events: string[] = [];
    await expect(
      beginPairingAdoption(input, operations(events, { failStage: "provisional" })),
    ).rejects.toThrow("new access was removed");

    expect(events).toEqual([
      "stage:requesting",
      `exchange:${REQUEST_ID}`,
      "stage:provisional",
      "cancel",
      "rollback:provisional:false",
      "complete:provisional",
    ]);
  });

  it("retries a lost confirm response without exchanging the one-time code again", async () => {
    const events: string[] = [];
    let durable: PendingPairingAdoption | null = null;
    let loseResponse = true;
    const actions = operations(events, {
      failConfirm: () => {
        if (!loseResponse) return null;
        loseResponse = false;
        return new HonkPairingRequestError("retryable", "response lost");
      },
      onStage: (pending) => {
        durable = pending;
      },
    });

    await expect(beginPairingAdoption(input, actions)).rejects.toThrow("response lost");
    const restored = decodePairingAdoption(JSON.stringify(durable));
    if (restored === null) throw new Error("Missing durable confirmation.");
    expect(restored.status).toBe("confirming");
    await resumePairingAdoption(restored, actions);

    expect(events.filter((event) => event.startsWith("exchange:"))).toEqual([
      `exchange:${REQUEST_ID}`,
    ]);
    expect(events.filter((event) => event.startsWith("confirm:"))).toHaveLength(2);
    expect(events.at(-1)).toBe("complete:confirming");
  });

  it("reuses the durable request ID after exchange response loss and app restart", async () => {
    const events: string[] = [];
    let durable: PendingPairingAdoption | null = null;
    let loseResponse = true;
    const actions = operations(events, {
      failExchange: () => {
        if (!loseResponse) return null;
        loseResponse = false;
        return new HonkPairingRequestError("retryable", "exchange response lost");
      },
      onStage: (pending) => {
        durable = pending;
      },
    });

    await expect(beginPairingAdoption(input, actions)).rejects.toThrow("exchange response lost");
    const restored = decodePairingAdoption(JSON.stringify(durable));
    if (restored === null || restored.status !== "requesting") {
      throw new Error("Missing durable request.");
    }
    await resumePairingAdoption(restored, actions);

    expect(events.filter((event) => event.startsWith("exchange:"))).toEqual([
      `exchange:${REQUEST_ID}`,
      `exchange:${REQUEST_ID}`,
    ]);
    expect(events.at(-1)).toBe("complete:confirming");
  });

  it("adopts active access when confirm history was lost during a host restart", async () => {
    const events: string[] = [];
    await resumePairingAdoption(
      provisional("confirming"),
      operations(events, {
        failConfirm: () => new HonkPairingRequestError("invalid", "confirmation forgotten"),
      }),
    );

    expect(events).toEqual([
      "persist",
      `confirm:${REQUEST_ID}`,
      "activate",
      "releaseRebind:null",
      "complete:confirming",
    ]);
    expect(events).not.toContain("cancel");
  });

  it("keeps late confirm recovery pending when the health check cannot reach the computer", async () => {
    const events: string[] = [];
    await expect(
      resumePairingAdoption(
        provisional("confirming"),
        operations(events, {
          failConfirm: () => new HonkPairingRequestError("invalid", "confirmation forgotten"),
          activationError: new Error("offline"),
        }),
      ),
    ).rejects.toThrow("offline");

    expect(events).toEqual(["persist", `confirm:${REQUEST_ID}`, "activate"]);
  });

  it("rolls back an actually rejected late confirmation", async () => {
    const events: string[] = [];
    const unauthorized = Object.assign(new Error("unauthorized"), { status: 401 });
    await expect(
      resumePairingAdoption(
        provisional("confirming"),
        operations(events, {
          failConfirm: () => new HonkPairingRequestError("invalid", "expired"),
          activationError: unauthorized,
        }),
      ),
    ).rejects.toThrow("expired");

    expect(events).toEqual([
      "persist",
      `confirm:${REQUEST_ID}`,
      "activate",
      "cancel",
      "rollback:confirming:false",
      "complete:confirming",
    ]);
  });

  it("restores replacement access when storage fails before confirm starts", async () => {
    const events: string[] = [];
    const rollbacks: PendingPairingAdoption[] = [];
    await expect(
      beginPairingAdoption(
        replacementInput,
        operations(events, {
          failPersistence: true,
          onRollback: (pending) => {
            rollbacks.push(pending);
          },
        }),
      ),
    ).rejects.toThrow("new access was removed");

    expect(rollbacks[0]).toMatchObject({
      replacePassword: "old-password",
      restorePreviousAccess: true,
      previousServerLabel: "Previous Studio",
      previousDefaultDirectory: "/Users/me/Previous",
      previousActiveServerKey: "https://laptop.example.com",
      previousEnvironmentId: "environment-studio",
      previousDeviceId: "device-iphone",
      previousProofKeyThumbprint: "thumbprint-iphone",
    });
    expect(events.indexOf("cancel")).toBeLessThan(events.indexOf("rollback:provisional:true"));
  });

  it("restores old replacement access when cancellation finds confirm did not commit", async () => {
    const events: string[] = [];
    await removePairingAdoption(provisional("confirming", "old-password"), operations(events));

    expect(events).toEqual([
      "stage:removing",
      "cancel",
      `verifyIdentity:${input.origin}:${replacementInput.replaceServerId}`,
      "probe:old-password",
      "rollback:removing:true",
      "complete:removing",
    ]);
  });

  it("removes replacement access when cancellation finds confirm committed", async () => {
    const events: string[] = [];
    const unauthorized = Object.assign(new Error("unauthorized"), { status: 401 });
    await removePairingAdoption(
      provisional("confirming", "old-password"),
      operations(events, { probeError: unauthorized }),
    );

    expect(events).toEqual([
      "stage:removing",
      "cancel",
      `verifyIdentity:${input.origin}:${replacementInput.replaceServerId}`,
      "probe:old-password",
      "rollback:removing:false",
      "complete:removing",
    ]);
  });

  it("keeps ambiguous replacement cleanup pending when old access cannot be checked", async () => {
    const events: string[] = [];
    const durable: PendingPairingAdoption[] = [];
    await expect(
      removePairingAdoption(
        provisional("confirming", "old-password"),
        operations(events, {
          probeError: new Error("offline"),
          onStage: (pending) => {
            durable.push(pending);
          },
        }),
      ),
    ).rejects.toThrow("offline");

    expect(events).toEqual([
      "stage:removing",
      "cancel",
      `verifyIdentity:${input.origin}:${replacementInput.replaceServerId}`,
      "probe:old-password",
    ]);
    expect(durable[0]?.status).toBe("removing");
  });

  it("persists removal intent before cancelling and resumes interrupted cleanup", async () => {
    const events: string[] = [];
    let durable: PendingPairingAdoption | null = null;
    let failRollback = true;
    const actions: PairingAdoptionOperations = {
      ...operations(events, {
        onStage: (pending) => {
          durable = pending;
        },
      }),
      rollback: async (pending) => {
        events.push(`rollback:${pending.status}:${String(pending.restorePreviousAccess)}`);
        if (failRollback) throw new Error("registry unavailable");
      },
    };

    await expect(removePairingAdoption(provisional("confirming"), actions)).rejects.toThrow(
      "registry unavailable",
    );
    const restored = decodePairingAdoption(JSON.stringify(durable));
    if (restored === null) throw new Error("Missing removal marker.");
    expect(restored.status).toBe("removing");
    failRollback = false;
    await resumePairingAdoption(restored, actions);

    expect(events).toEqual([
      "stage:removing",
      "cancel",
      "rollback:removing:false",
      "cancel",
      "rollback:removing:false",
      "complete:removing",
    ]);
  });

  it("clears existing-access-invalid requests during begin, removal, and restart recovery", async () => {
    const error = () =>
      new HonkPairingRequestError("existing-access-invalid", "Remove the stale saved connection.");

    const beginEvents: string[] = [];
    await expect(
      beginPairingAdoption(replacementInput, operations(beginEvents, { failExchange: error })),
    ).rejects.toThrow("Remove the stale saved connection.");
    expect(beginEvents).toEqual([
      "stage:requesting",
      `verifyIdentity:${replacementInput.origin}:${replacementInput.replaceServerId}`,
      `exchange:${REQUEST_ID}`,
      "rollback:requesting:true",
      "complete:requesting",
    ]);

    const removalEvents: string[] = [];
    await expect(
      removePairingAdoption(
        replacementRequest(),
        operations(removalEvents, { failExchange: error }),
      ),
    ).rejects.toThrow("Remove the stale saved connection.");
    expect(removalEvents).toEqual([
      `verifyIdentity:${replacementInput.origin}:${replacementInput.replaceServerId}`,
      `exchange:${REQUEST_ID}`,
      "rollback:requesting:true",
      "complete:requesting",
    ]);

    const recoveryEvents: string[] = [];
    const restored = decodePairingAdoption(JSON.stringify(replacementRequest()));
    if (restored === null) throw new Error("Missing restored request.");
    await expect(
      resumePairingAdoption(restored, operations(recoveryEvents, { failExchange: error })),
    ).rejects.toThrow("Remove the stale saved connection.");
    expect(recoveryEvents).toEqual([
      `verifyIdentity:${replacementInput.origin}:${replacementInput.replaceServerId}`,
      `exchange:${REQUEST_ID}`,
      "rollback:requesting:true",
      "complete:requesting",
    ]);
  });

  it("tolerates rollback metadata missing from an older replacement record", () => {
    const legacy = {
      ...replacementRequest(),
      previousServerLabel: undefined,
      previousDefaultDirectory: undefined,
      previousActiveServerKey: undefined,
      previousEnvironmentId: undefined,
      previousDeviceId: undefined,
      previousProofKeyThumbprint: undefined,
    };
    const restored = decodePairingAdoption(JSON.stringify(legacy));

    expect(restored).toMatchObject({
      previousServerLabel: input.serverLabel,
      previousDefaultDirectory: input.defaultDirectory,
      previousActiveServerKey: input.origin,
      previousEnvironmentId: null,
      previousDeviceId: null,
      previousProofKeyThumbprint: null,
    });
  });

  it("rejects malformed durable request identities, computer names, and managed metadata", () => {
    const request: PairingRequest = {
      ...input,
      restorePreviousAccess: false,
      status: "requesting",
    };
    expect(() => decodePairingAdoption(JSON.stringify({ ...request, requestId: "short" }))).toThrow(
      "incomplete",
    );
    expect(() => decodePairingAdoption(JSON.stringify({ ...request, serverLabel: "   " }))).toThrow(
      "incomplete",
    );
    expect(() =>
      decodePairingAdoption(JSON.stringify({ ...request, previousEnvironmentId: "   " })),
    ).toThrow("invalid previousEnvironmentId");
    expect(() =>
      decodePairingAdoption(JSON.stringify({ ...request, previousDeviceId: 42 })),
    ).toThrow("invalid previousDeviceId");
    expect(() =>
      decodePairingAdoption(JSON.stringify({ ...request, previousProofKeyThumbprint: false })),
    ).toThrow("invalid previousProofKeyThumbprint");
  });
});
