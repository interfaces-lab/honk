import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setEnabled: vi.fn() }));

vi.mock("cuelume", () => ({ setEnabled: mocks.setEnabled }));

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
  mocks.setEnabled.mockClear();
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("document", { documentElement: { toggleAttribute: vi.fn() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("app settings", () => {
  it("hydrates new preferences with safe defaults", async () => {
    const store = await import("./app-settings-store");

    expect(store.getSnapshot()).toMatchObject({
      alertSoundSelection: "ready",
      alertSoundsEnabled: true,
      customAlertSoundFileName: null,
      cursorPointerOnButtons: false,
      defaultThreadEnvironment: "local",
      diffWordWrap: false,
      notifyWhenThreadFinishes: true,
      notifyWhenThreadNeedsInput: true,
    });
    expect(mocks.setEnabled).toHaveBeenCalledWith(true);
  });

  it("persists interaction, environment, notification, and diff preferences", async () => {
    const store = await import("./app-settings-store");

    store.actions.setDefaultThreadEnvironment("worktree");
    store.actions.setCursorPointerOnButtons(true);
    store.actions.setDiffWordWrap(true);
    store.actions.setNotifyWhenThreadFinishes(false);
    store.actions.setNotifyWhenThreadNeedsInput(false);
    store.actions.setAlertSoundsEnabled(false);
    store.actions.setAlertSoundSelection("chime");
    store.actions.selectCustomAlertSound("done.mp3");

    expect(JSON.parse(storage.value ?? "{}")).toMatchObject({
      alertSoundSelection: "custom",
      alertSoundsEnabled: false,
      customAlertSoundFileName: "done.mp3",
      cursorPointerOnButtons: true,
      defaultThreadEnvironment: "worktree",
      diffWordWrap: true,
      notifyWhenThreadFinishes: false,
      notifyWhenThreadNeedsInput: false,
    });
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it("restores persisted preferences", async () => {
    storage.value = JSON.stringify({
      alertSoundSelection: "custom",
      alertSoundsEnabled: false,
      customAlertSoundFileName: "done.mp3",
      cursorPointerOnButtons: true,
      defaultThreadEnvironment: "worktree",
      diffWordWrap: true,
      notifyWhenThreadFinishes: false,
      notifyWhenThreadNeedsInput: false,
    });

    const store = await import("./app-settings-store");

    expect(store.getSnapshot()).toMatchObject({
      alertSoundSelection: "custom",
      alertSoundsEnabled: false,
      customAlertSoundFileName: "done.mp3",
      cursorPointerOnButtons: true,
      defaultThreadEnvironment: "worktree",
      diffWordWrap: true,
      notifyWhenThreadFinishes: false,
      notifyWhenThreadNeedsInput: false,
    });
  });

  it("migrates the former completion-only sound preference", async () => {
    storage.value = JSON.stringify({
      completionSoundEnabled: false,
      completionSoundFileName: "done.mp3",
    });

    const store = await import("./app-settings-store");

    expect(store.getSnapshot()).toMatchObject({
      alertSoundSelection: "custom",
      alertSoundsEnabled: false,
      customAlertSoundFileName: "done.mp3",
    });
  });

  it("keeps a saved custom sound when a default sound is selected", async () => {
    const store = await import("./app-settings-store");

    store.actions.selectCustomAlertSound("done.mp3");
    store.actions.setAlertSoundSelection("chime");

    expect(store.getSnapshot()).toMatchObject({
      alertSoundSelection: "chime",
      customAlertSoundFileName: "done.mp3",
    });
  });
});
