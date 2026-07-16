import { createOpenCodeServer, openCodeSessionRef } from "@honk/opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserResourceFor,
  removeBrowserResource,
  removeBrowserSessions,
  resetBrowserStoreForTests,
} from "./browser-store";
import { createWorkbenchTabStore, type WorkbenchBrowserTab } from "./workbench-tab-store";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096", kind: "local" });

afterEach(() => {
  resetBrowserStoreForTests();
  vi.unstubAllGlobals();
});

describe("workbench browser lifetime", () => {
  it("reserves the default browser for automation and retains the first workbench browser", () => {
    const owner = openCodeSessionRef(server.key, "ses_workbench_browser");
    const store = createWorkbenchTabStore({ createID: () => "browser-workbench" });
    const tab = store.actions.openTool("workspace", "browser", owner) as WorkbenchBrowserTab;
    const destroyBrowserView = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      desktopBridge: {
        syncBrowserView: vi.fn(),
        detachBrowserView: vi.fn(),
        commandBrowserView: vi.fn(),
        destroyBrowserView,
        onBrowserViewState: vi.fn(() => () => undefined),
        onBrowserAutomationOpen: vi.fn(() => () => undefined),
      },
    });

    expect(tab.browserID).toBe("browser-workbench");
    browserResourceFor(tab.owner, tab.browserID).requestNavigation(
      "https://example.test/workbench",
    );

    removeBrowserSessions(server.key, [owner.sessionID]);

    expect(destroyBrowserView).not.toHaveBeenCalled();
    expect(browserResourceFor(tab.owner, tab.browserID).getSnapshot().inputValue).toBe(
      "https://example.test/workbench",
    );

    removeBrowserResource(tab.owner, tab.browserID);
    expect(destroyBrowserView).toHaveBeenCalledTimes(1);
  });
});
