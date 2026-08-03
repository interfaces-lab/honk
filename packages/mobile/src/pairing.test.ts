import { describe, expect, it } from "vitest";

import { normalizeRemoteOrigin } from "./pairing";

describe("normalizeRemoteOrigin", () => {
  it("accepts private-network HTTP origins", () => {
    expect(normalizeRemoteOrigin("http://192.168.1.42:4096")).toBe("http://192.168.1.42:4096");
  });

  it("rejects public HTTP origins", () => {
    expect(() => normalizeRemoteOrigin("http://example.com")).toThrow(
      "Connections over the internet must use HTTPS.",
    );
  });
});
