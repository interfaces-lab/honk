import { describe, expect, it } from "vitest";

import { serverStatus } from "./server-status";

describe("serverStatus", () => {
  it("uses one presentation for transient and terminal connection states", () => {
    expect(serverStatus("live")).toMatchObject({ tone: "ok", detail: "Connected" });
    expect(serverStatus("connecting")).toMatchObject({ tone: "neutral", detail: "Connecting" });
    expect(serverStatus("closed")).toMatchObject({
      tone: "neutral",
      detail: "Reconnecting",
      pulse: true,
    });
    expect(serverStatus("reconnecting")).toMatchObject({
      tone: "neutral",
      detail: "Reconnecting",
    });
    expect(serverStatus("credential-missing")).toMatchObject({
      tone: "warn",
      detail: "Sign in needed",
      pulse: false,
    });
    expect(serverStatus("unauthorized")).toMatchObject({
      tone: "warn",
      detail: "Sign in needed",
      pulse: false,
    });
    expect(serverStatus("failed")).toMatchObject({ tone: "err", detail: "Failed" });
  });
});
