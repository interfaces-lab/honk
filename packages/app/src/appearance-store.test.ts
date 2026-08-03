import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = {
  value: null as string | null,
  getItem: vi.fn(() => storage.value),
  setItem: vi.fn((_key: string, value: string) => {
    storage.value = value;
  }),
};

const rootStyle = {
  colorScheme: "",
  removeProperty: vi.fn(),
  setProperty: vi.fn(),
};

beforeEach(() => {
  vi.resetModules();
  storage.value = null;
  storage.getItem.mockClear();
  storage.setItem.mockClear();
  rootStyle.colorScheme = "";
  rootStyle.removeProperty.mockClear();
  rootStyle.setProperty.mockClear();
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("document", { documentElement: { style: rootStyle } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("appearance typography", () => {
  it("hydrates safe font families and drops unsafe persisted values", async () => {
    storage.value = JSON.stringify({
      uiFontFamily: "  Inter  ",
      codeFontFamily: "url(https://example.com/font.woff2)",
    });

    const store = await import("./appearance-store");

    expect(store.getSnapshot()).toMatchObject({
      uiFontFamily: "Inter",
      codeFontFamily: null,
    });
  });

  it("applies interface and code families through the global token boundary", async () => {
    const store = await import("./appearance-store");
    rootStyle.removeProperty.mockClear();
    rootStyle.setProperty.mockClear();

    store.actions.setUiFontFamily("Inter");
    store.actions.setCodeFontFamily("JetBrains Mono");

    expect(rootStyle.setProperty).toHaveBeenCalledWith(
      "--honk-font-family-ui",
      expect.stringContaining('"Inter", -apple-system'),
    );
    expect(rootStyle.setProperty).toHaveBeenCalledWith(
      "--honk-font-family-rounded",
      expect.stringContaining('"Inter", -apple-system'),
    );
    expect(rootStyle.setProperty).toHaveBeenCalledWith(
      "--honk-font-family-mono",
      expect.stringContaining('"JetBrains Mono", Menlo'),
    );
    expect(JSON.parse(storage.value ?? "{}")).toMatchObject({
      uiFontFamily: "Inter",
      codeFontFamily: "JetBrains Mono",
    });

    rootStyle.removeProperty.mockClear();
    store.actions.resetUiFontFamily();
    store.actions.resetCodeFontFamily();
    expect(rootStyle.removeProperty).toHaveBeenCalledWith("--honk-font-family-ui");
    expect(rootStyle.removeProperty).toHaveBeenCalledWith("--honk-font-family-rounded");
    expect(rootStyle.removeProperty).toHaveBeenCalledWith("--honk-font-family-mono");
  });

  it("uses View zoom actions to step and reset both typography sizes", async () => {
    const store = await import("./appearance-store");

    store.actions.stepFontSizes(1);
    expect(store.getSnapshot()).toMatchObject({ uiFontSize: 14, codeFontSize: 13 });

    store.actions.resetFontSizes();
    expect(store.getSnapshot()).toMatchObject({ uiFontSize: 13, codeFontSize: 12 });
  });

  it("applies the interface size to the typography variables used by chat prose", async () => {
    const store = await import("./appearance-store");
    rootStyle.setProperty.mockClear();

    store.actions.setUiFontSize(14);

    expect(rootStyle.setProperty).toHaveBeenCalledWith("--honk-text-title", "15px");
    expect(rootStyle.setProperty).toHaveBeenCalledWith("--honk-leading-heading", "22px");
  });
});
