import { describe, expect, it, vi } from "vitest";

import {
  MOBILE_CONNECTION_RETRY_DELAYS_MS,
  mobileApplicationActiveWakeup,
  shouldReconnectAfterBackground,
  superviseMobileConnection,
} from "./connection-supervisor";

describe("superviseMobileConnection", () => {
  it("retries transient setup failures with the capped T3 reconnect ladder", async () => {
    const attempts: number[] = [];
    const delays: number[] = [];
    const states: Array<{ readonly phase: string; readonly retryAt: number | null }> = [];

    await expect(
      superviseMobileConnection(new AbortController().signal, {
        connect: (attempt) => {
          attempts.push(attempt);
          return attempt === 7
            ? Promise.resolve()
            : Promise.reject(new Error(`failure ${attempt}`));
        },
        classifyFailure: () => "transient",
        errorMessage: (error) => (error instanceof Error ? error.message : "failed"),
        now: () => 10_000,
        publish: (state) => states.push(state),
        wait: (_signal, delay) => {
          delays.push(delay);
          return Promise.resolve();
        },
      }),
    ).resolves.toBe("connected");

    expect(attempts).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 16_000]);
    expect(states.at(-1)).toMatchObject({ phase: "connected", retryAt: null });
    expect(MOBILE_CONNECTION_RETRY_DELAYS_MS).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it("stops a blocked failure without retrying", async () => {
    const connect = vi.fn(() => Promise.reject(new Error("Access was revoked.")));
    const wait = vi.fn(() => Promise.resolve());
    const states: Array<{ readonly phase: string; readonly error: string | null }> = [];

    await expect(
      superviseMobileConnection(new AbortController().signal, {
        connect,
        classifyFailure: () => "blocked",
        errorMessage: (error) => (error instanceof Error ? error.message : "failed"),
        publish: (state) => states.push(state),
        wait,
      }),
    ).resolves.toBe("blocked");

    expect(connect).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({
      phase: "blocked",
      error: "Access was revoked.",
    });
  });

  it("cancels an in-flight backoff without another attempt", async () => {
    const controller = new AbortController();
    const connect = vi.fn(() => Promise.reject(new Error("offline")));

    await expect(
      superviseMobileConnection(controller.signal, {
        connect,
        classifyFailure: () => "transient",
        errorMessage: () => "offline",
        publish: () => undefined,
        wait: (signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
            controller.abort();
          }),
      }),
    ).resolves.toBe("stopped");

    expect(connect).toHaveBeenCalledOnce();
  });

  it("resets the retry ladder after a heartbeat-confirmed connection", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await expect(
      superviseMobileConnection(new AbortController().signal, {
        connect: () => {
          attempts += 1;
          return attempts === 3
            ? Promise.resolve()
            : Promise.reject(new Error(attempts === 2 ? "stable stream closed" : "offline"));
        },
        classifyFailure: (error) =>
          error instanceof Error && error.message === "stable stream closed"
            ? "transient-reset"
            : "transient",
        errorMessage: (error) => (error instanceof Error ? error.message : "failed"),
        publish: () => undefined,
        wait: (_signal, delay) => {
          delays.push(delay);
          return Promise.resolve();
        },
      }),
    ).resolves.toBe("connected");

    expect(delays).toEqual([1_000, 1_000]);
  });
});

describe("shouldReconnectAfterBackground", () => {
  it("replaces a likely suspended connection after ten seconds", () => {
    expect(shouldReconnectAfterBackground(null, 20_000)).toBe(false);
    expect(shouldReconnectAfterBackground(10_001, 20_000)).toBe(false);
    expect(shouldReconnectAfterBackground(10_000, 20_000)).toBe(true);
  });

  it("maps short resumes to a probe and likely suspension to a reconnect", () => {
    expect(mobileApplicationActiveWakeup(null, 20_000)).toBe("application-active-probe");
    expect(mobileApplicationActiveWakeup(10_001, 20_000)).toBe("application-active-probe");
    expect(mobileApplicationActiveWakeup(10_000, 20_000)).toBe("application-active-reconnect");
  });
});
