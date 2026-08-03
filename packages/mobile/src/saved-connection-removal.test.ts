import { describe, expect, it } from "vitest";

import { persistSavedConnectionRemoval } from "./saved-connection-removal";

describe("saved connection removal", () => {
  it("leaves the live registry intact when its durable update fails", async () => {
    const current = new Map([
      ["studio", { origin: "https://studio.example.com" }],
      ["laptop", { origin: "https://laptop.example.com" }],
    ]);

    await expect(
      persistSavedConnectionRemoval(current, "studio", "studio", async () => {
        throw new Error("storage unavailable");
      }),
    ).rejects.toThrow("storage unavailable");
    expect([...current.keys()]).toEqual(["studio", "laptop"]);

    const retried = await persistSavedConnectionRemoval(
      current,
      "studio",
      "studio",
      async () => undefined,
    );
    expect([...retried.servers.keys()]).toEqual(["laptop"]);
    expect(retried.activeServerKey).toBe("laptop");
  });
});
