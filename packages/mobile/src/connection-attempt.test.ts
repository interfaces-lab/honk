import { describe, expect, it } from "vitest";

import {
  beginConnectionAttempt,
  invalidateConnectionAttempt,
  isCurrentConnectionAttempt,
  probeConnectionCandidate,
} from "./connection-attempt";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("connection attempts", () => {
  it("lets only the newest healthy candidate replace the managed connection", async () => {
    const attempts = new Map<string, number>();
    const firstHealth = deferred();
    const secondHealth = deferred();
    const events: string[] = [];
    const first = beginConnectionAttempt(attempts, "studio");
    const firstResult = probeConnectionCandidate({
      probe: () => firstHealth.promise,
      isCurrent: () => isCurrentConnectionAttempt(attempts, "studio", first),
      close: () => events.push("close:first"),
      commit: async () => {
        events.push("commit:first");
      },
    });
    const second = beginConnectionAttempt(attempts, "studio");
    const secondResult = probeConnectionCandidate({
      probe: () => secondHealth.promise,
      isCurrent: () => isCurrentConnectionAttempt(attempts, "studio", second),
      close: () => events.push("close:second"),
      commit: async () => {
        events.push("commit:second");
      },
    });

    firstHealth.resolve();
    await expect(firstResult).resolves.toBe("stale");
    expect(events).toEqual(["close:first"]);
    secondHealth.resolve();
    await expect(secondResult).resolves.toBe("committed");
    expect(events).toEqual(["close:first", "commit:second"]);
  });

  it("invalidates an in-flight candidate when its connection is removed", async () => {
    const attempts = new Map<string, number>();
    const health = deferred();
    const events: string[] = [];
    const attempt = beginConnectionAttempt(attempts, "studio");
    const result = probeConnectionCandidate({
      probe: () => health.promise,
      isCurrent: () => isCurrentConnectionAttempt(attempts, "studio", attempt),
      close: () => events.push("close"),
      commit: async () => {
        events.push("commit");
      },
    });

    invalidateConnectionAttempt(attempts, "studio");
    health.resolve();
    await expect(result).resolves.toBe("stale");
    expect(events).toEqual(["close"]);
  });
});
