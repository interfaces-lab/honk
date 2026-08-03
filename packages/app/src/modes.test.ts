import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  value: null as string | null,
  getItem: vi.fn(() => storage.value),
  setItem: vi.fn((_key: string, value: string) => {
    storage.value = value;
  }),
};

beforeEach(() => {
  vi.resetModules();
  storage.value = null;
  storage.getItem.mockClear();
  storage.setItem.mockClear();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mode defaults", () => {
  it("restores the configured default after a per-prompt change", async () => {
    const modes = await import("./modes");

    modes.actions.setDefaultMode("ask");
    modes.actions.setHomeMode("debug");
    modes.actions.resetHomeMode();

    expect(modes.getSnapshot()).toMatchObject({ defaultMode: "ask", homeMode: "ask" });
    expect(JSON.parse(storage.value ?? "{}")).toMatchObject({
      defaultMode: "ask",
      homeMode: "ask",
    });
  });

  it("hydrates the persisted default", async () => {
    storage.value = JSON.stringify({ defaultMode: "plan", homeMode: "plan" });

    const modes = await import("./modes");

    expect(modes.getSnapshot()).toMatchObject({ defaultMode: "plan", homeMode: "plan" });
  });

  it("keeps per-thread choices out of persisted renderer state", async () => {
    storage.value = JSON.stringify({
      defaultMode: "ask",
      homeMode: "ask",
      byThread: { "thread-1": "debug" },
    });

    const modes = await import("./modes");

    expect(modes.getSnapshot()).toMatchObject({
      defaultMode: "ask",
      homeMode: "ask",
      unsentModeByThread: {},
    });

    modes.actions.setThreadMode("thread-1", "plan");

    expect(modes.getSnapshot().unsentModeByThread).toEqual({ "thread-1": "plan" });
    expect(JSON.parse(storage.value ?? "{}")).toEqual({
      defaultMode: "ask",
      homeMode: "ask",
    });
  });
});

describe("fusion thread agents", () => {
  it("keeps the per-stop fusion agent in build mode and overrides it elsewhere", async () => {
    const modes = await import("./modes");

    expect(modes.threadAgentName("build", "honk-build-fusion-high")).toBe("honk-build-fusion-high");
    expect(modes.threadAgentName("ask", "honk-build-fusion-high")).toBe("honk-ask");
    expect(modes.threadAgentName("build", "honk-build")).toBe("honk-build");
    expect(modes.threadAgentName("build", null)).toBe("honk-build");
  });

  it("derives the mode from the core session agent", async () => {
    const modes = await import("./modes");

    expect(modes.modeFromAgent("honk-plan")).toBe("plan");
    expect(modes.modeFromAgent("honk-debug")).toBe("debug");
    expect(modes.modeFromAgent("honk-ask")).toBe("ask");
    expect(modes.modeFromAgent("honk-build-fusion-high")).toBe("build");
    expect(modes.modeFromAgent("honk-build")).toBe("build");
    expect(modes.modeFromAgent(null)).toBe("build");
  });

  it("recovers the fusion agent from message history after a mode round-trip", async () => {
    const modes = await import("./modes");

    // Born fusion, then an Ask follow-up overwrote the live session agent.
    const messages = [{ agent: "honk-build-fusion-high" }, { agent: "honk-ask" }];
    const recovered = modes.threadBuildAgent(messages, "honk-ask");
    expect(recovered).toBe("honk-build-fusion-high");
    expect(modes.threadAgentName("build", recovered)).toBe("honk-build-fusion-high");

    // A thread that never ran fusion keeps the live agent.
    expect(modes.threadBuildAgent([{ agent: "honk-build" }], "honk-build")).toBe("honk-build");
  });

  it("uses Cursor's mode cycle order", async () => {
    const modes = await import("./modes");

    expect(modes.MODES.map((mode) => mode.id)).toEqual(["build", "plan", "debug", "ask"]);
    expect(modes.nextModeId("debug")).toBe("ask");
    expect(modes.nextModeId("ask")).toBe("build");
  });
});
