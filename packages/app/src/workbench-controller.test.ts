import { afterEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "honk:app:workbench:v1";

async function loadController(stored: string | null, pathname = "/") {
  const entries = new Map<string, string>();
  if (stored !== null) entries.set(STORAGE_KEY, stored);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
    },
    location: { pathname, search: "" },
  });
  vi.resetModules();
  const controller = await import("./workbench-controller");
  const openSessionRoute = vi.spyOn((await import("./tab-store")).actions, "openSessionRoute");
  return {
    actions: controller.workbenchActions,
    openSessionRoute,
    persisted: () => JSON.parse(entries.get(STORAGE_KEY) ?? "null") as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workbench maximized persistence", () => {
  it("loads a snapshot written before the field existed without disturbing its other fields", async () => {
    const controller = await loadController(
      JSON.stringify({ isRailMinimized: true, width: 640, lastTab: "terminal" }),
    );

    controller.actions.setMaximized(true);

    expect(controller.persisted()).toEqual({
      isRailMinimized: true,
      isMaximized: true,
      width: 640,
      lastTab: "terminal",
    });
  });

  it("restores a stored maximized snapshot", async () => {
    const controller = await loadController(
      JSON.stringify({ isRailMinimized: false, isMaximized: true, width: 480, lastTab: "changes" }),
    );

    controller.actions.setRailMinimized(true);

    expect(controller.persisted().isMaximized).toBe(true);
    expect(controller.persisted().width).toBe(480);
  });

  it("leaves the preference alone when the chord fires away from a session", async () => {
    const controller = await loadController(
      JSON.stringify({
        isRailMinimized: false,
        isMaximized: false,
        width: 560,
        lastTab: "changes",
      }),
    );

    controller.actions.toggleMaximized();

    expect(controller.persisted().isMaximized).toBe(false);
  });

  it("exits without navigating when the chord fires on an open workbench route", async () => {
    const controller = await loadController(
      JSON.stringify({ isRailMinimized: false, isMaximized: true, width: 560, lastTab: "changes" }),
      "/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session/ses_a/workbench/changes",
    );

    controller.actions.toggleMaximized();

    expect(controller.persisted().isMaximized).toBe(false);
  });

  it("maximizes the empty workbench without opening the last tool", async () => {
    const controller = await loadController(
      JSON.stringify({
        isRailMinimized: false,
        isMaximized: false,
        width: 560,
        lastTab: "terminal",
      }),
      "/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session/ses_a/workbench/start",
    );

    controller.actions.toggleMaximized();

    expect(controller.persisted().isMaximized).toBe(true);
  });
});

describe("workbench file navigation", () => {
  it("opens a transcript file in the current session's workbench", async () => {
    const controller = await loadController(
      null,
      "/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session/ses_a",
    );

    controller.actions.openFile("README.md");

    expect(controller.openSessionRoute).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "ses_a" }),
      "/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session/ses_a/workbench/file%3AUkVBRE1FLm1k",
    );
  });
});
