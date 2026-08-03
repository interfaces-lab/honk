import { describe, expect, it } from "vitest";

import { createServerStorageQueue } from "./server-storage-queue";

describe("createServerStorageQueue", () => {
  it("runs durable mutations in submission order", async () => {
    const queue = createServerStorageQueue();
    const order: string[] = [];
    let releaseFirst = (): void => undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      order.push("first-started");
      await firstBlocked;
      order.push("first-finished");
    });
    const second = queue.run(async () => {
      order.push("second");
    });

    await Promise.resolve();
    expect(order).toEqual(["first-started"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-started", "first-finished", "second"]);
  });

  it("continues after a failed mutation", async () => {
    const queue = createServerStorageQueue();
    const failure = queue.run(async () => {
      throw new Error("storage failed");
    });
    const recovery = queue.run(async () => "recovered");

    await expect(failure).rejects.toThrow("storage failed");
    await expect(recovery).resolves.toBe("recovered");
  });
});
