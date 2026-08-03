import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appSettings: {
    alertSoundSelection: "custom" as "custom" | "ready",
    alertSoundsEnabled: true,
    customAlertSoundFileName: "done.mp3" as string | null,
    notifyWhenThreadFinishes: true,
    notifyWhenThreadNeedsInput: true,
  },
  add: vi.fn(),
  addAttention: vi.fn(),
  clearCustomAlertSound: vi.fn(),
  play: vi.fn(),
  playAlertSound: vi.fn(() => Promise.resolve("custom")),
  subscribeWatch: vi.fn<(listener: () => void) => () => void>(() => () => {}),
  tabSnapshot: { activeKey: null as string | null },
  watchSnapshot: { state: null as unknown, status: "ready" },
}));

vi.mock("@honk/opencode", () => ({
  openCodeSessionKey: (value: string) => value,
  openCodeSessionRef: (_server: string, id: string) => id,
}));
vi.mock("@honk/shared/paths", () => ({ basename: (value: string) => value }));
vi.mock("cuelume", () => ({ play: mocks.play }));
vi.mock("./app-settings-store", () => ({
  actions: { clearCustomAlertSound: mocks.clearCustomAlertSound },
  getSnapshot: () => mocks.appSettings,
}));
vi.mock("./command-menu-model", () => ({ tabStatusFromSummary: () => "done" }));
vi.mock("./completion-sound", () => ({
  installAlertSoundPlayback: () => () => {},
  playAlertSound: mocks.playAlertSound,
}));
vi.mock("./desktop-bridge", () => ({
  showDesktopThreadNotification: () => false,
  subscribeDesktopThreadNotificationActivate: () => () => {},
}));
vi.mock("./notification-permission", () => ({
  isWindowForeground: () => true,
  showSystemThreadNotification: vi.fn(),
}));
vi.mock("./tab-store", () => ({
  actions: { open: vi.fn() },
  getSnapshot: () => mocks.tabSnapshot,
}));
vi.mock("./toast-store", () => ({
  actions: { add: mocks.add, addAttention: mocks.addAttention },
}));
vi.mock("./watch-registry", () => ({
  getSessionInventoryWatchSnapshot: () => mocks.watchSnapshot,
  subscribeSessionInventoryWatch: mocks.subscribeWatch,
}));

const summary = {
  id: "thread-1",
  server: "local",
  title: "Build feature",
  status: "running",
  needsAttention: false,
  worktree: { path: "/repo" },
};

afterEach(async () => {
  const notifications = await import("./thread-notifications");
  notifications.uninstallThreadNotifications();
  mocks.add.mockClear();
  mocks.addAttention.mockClear();
  mocks.clearCustomAlertSound.mockClear();
  mocks.play.mockClear();
  mocks.playAlertSound.mockClear();
  mocks.subscribeWatch.mockClear();
  mocks.appSettings.alertSoundSelection = "custom";
  mocks.appSettings.alertSoundsEnabled = true;
  mocks.appSettings.customAlertSoundFileName = "done.mp3";
  mocks.tabSnapshot.activeKey = null;
  mocks.watchSnapshot.state = null;
});

describe("thread alert sounds", () => {
  it("uses the canonical needs-you wording for attention", async () => {
    mocks.watchSnapshot.state = { rootSessions: [summary] };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    mocks.watchSnapshot.state = {
      rootSessions: [{ ...summary, needsAttention: true }],
    };
    mocks.subscribeWatch.mock.calls[0]?.[0]();

    expect(mocks.addAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Needs you — Build feature",
        description: "Needs you.",
      }),
    );
  });

  it("plays the selected sound for inactive completion and attention transitions", async () => {
    mocks.watchSnapshot.state = { rootSessions: [summary] };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    mocks.watchSnapshot.state = {
      rootSessions: [{ ...summary, status: "idle" }],
    };
    mocks.subscribeWatch.mock.calls[0]?.[0]();
    mocks.watchSnapshot.state = {
      rootSessions: [{ ...summary, status: "idle", needsAttention: true }],
    };
    mocks.subscribeWatch.mock.calls[0]?.[0]();

    expect(mocks.playAlertSound).toHaveBeenNthCalledWith(1, "custom", "done.mp3");
    expect(mocks.playAlertSound).toHaveBeenNthCalledWith(2, "custom", "done.mp3");
  });

  it("raises one needs-you alert when completion and attention arrive together", async () => {
    mocks.watchSnapshot.state = { rootSessions: [summary] };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    mocks.watchSnapshot.state = {
      rootSessions: [{ ...summary, status: "idle", needsAttention: true }],
    };
    mocks.subscribeWatch.mock.calls[0]?.[0]();

    expect(mocks.addAttention).toHaveBeenCalledOnce();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.playAlertSound).toHaveBeenCalledOnce();
  });

  it("reports a failure once instead of also raising needs-you feedback", async () => {
    mocks.watchSnapshot.state = { rootSessions: [summary] };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    mocks.watchSnapshot.state = {
      rootSessions: [{ ...summary, status: "failed", needsAttention: true }],
    };
    mocks.subscribeWatch.mock.calls[0]?.[0]();

    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Failed — Build feature",
        description: "Stopped with an error.",
      }),
    );
    expect(mocks.addAttention).not.toHaveBeenCalled();
    expect(mocks.play).toHaveBeenCalledWith("error");
    expect(mocks.playAlertSound).not.toHaveBeenCalled();
  });

  it("respects the sound preference and inactive-thread gate", async () => {
    mocks.watchSnapshot.state = { rootSessions: [summary] };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    mocks.appSettings.alertSoundsEnabled = false;
    mocks.watchSnapshot.state = { rootSessions: [{ ...summary, status: "idle" }] };
    mocks.subscribeWatch.mock.calls[0]?.[0]();
    expect(mocks.playAlertSound).not.toHaveBeenCalled();

    mocks.watchSnapshot.state = { rootSessions: [summary] };
    mocks.subscribeWatch.mock.calls[0]?.[0]();
    mocks.watchSnapshot.state = { rootSessions: [{ ...summary, status: "failed" }] };
    mocks.subscribeWatch.mock.calls[0]?.[0]();
    expect(mocks.play).not.toHaveBeenCalled();

    mocks.appSettings.alertSoundsEnabled = true;
    mocks.tabSnapshot.activeKey = summary.id;
    mocks.watchSnapshot.state = {
      rootSessions: [{ ...summary, status: "idle", needsAttention: true }],
    };
    mocks.subscribeWatch.mock.calls[0]?.[0]();
    expect(mocks.playAlertSound).not.toHaveBeenCalled();
  });

  it("clears stale custom metadata when playback falls back to the built-in sound", async () => {
    mocks.playAlertSound.mockResolvedValueOnce("built-in");
    mocks.watchSnapshot.state = { rootSessions: [summary] };
    const notifications = await import("./thread-notifications");
    notifications.installThreadNotifications();

    mocks.watchSnapshot.state = { rootSessions: [{ ...summary, status: "idle" }] };
    mocks.subscribeWatch.mock.calls[0]?.[0]();
    await Promise.resolve();

    expect(mocks.clearCustomAlertSound).toHaveBeenCalledOnce();
  });
});
