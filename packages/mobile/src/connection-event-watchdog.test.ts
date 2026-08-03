import { describe, expect, it, vi } from "vitest";

import {
  MOBILE_EVENT_HEARTBEAT_TIMEOUT_MS,
  readConnectionEvent,
} from "./connection-event-watchdog";

const OPENCODE_HEARTBEAT_INTERVAL_MS = 30_000;

describe("readConnectionEvent", () => {
  it("allows scheduling headroom above the upstream heartbeat interval", () => {
    expect(MOBILE_EVENT_HEARTBEAT_TIMEOUT_MS).toBeGreaterThan(OPENCODE_HEARTBEAT_INTERVAL_MS);
  });

  it("returns an event from the stream", async () => {
    const iterator = (async function* () {
      yield "heartbeat";
    })();

    await expect(
      readConnectionEvent(
        iterator,
        new AbortController().signal,
        MOBILE_EVENT_HEARTBEAT_TIMEOUT_MS,
      ),
    ).resolves.toEqual({ kind: "event", event: "heartbeat" });
  });

  it("detects a half-open stream", async () => {
    vi.useFakeTimers();
    const iterator: AsyncIterator<string> = {
      next: () => new Promise(() => undefined),
    };
    const reading = readConnectionEvent(
      iterator,
      new AbortController().signal,
      MOBILE_EVENT_HEARTBEAT_TIMEOUT_MS,
    );

    await vi.advanceTimersByTimeAsync(MOBILE_EVENT_HEARTBEAT_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    await expect(reading).resolves.toEqual({ kind: "timeout" });
    vi.useRealTimers();
  });

  it("stops immediately when its client lifetime ends", async () => {
    const controller = new AbortController();
    const iterator: AsyncIterator<string> = {
      next: () => new Promise(() => undefined),
    };
    const reading = readConnectionEvent(
      iterator,
      controller.signal,
      MOBILE_EVENT_HEARTBEAT_TIMEOUT_MS,
    );

    controller.abort();

    await expect(reading).resolves.toEqual({ kind: "stopped" });
  });
});
