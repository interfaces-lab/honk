import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { HomePage } from "./home";

vi.mock("./app-settings-store", () => ({
  setHomeProjectOrder: vi.fn(),
  useAppSettings: () => ({
    defaultProjectDirectory: null,
    homeProjectOrder: [],
  }),
}));

vi.mock("./composer/home-composer", () => ({
  HomeComposer: () => <div data-home-composer>Describe a task…</div>,
}));

vi.mock("./desktop-bridge", () => ({
  pickFolder: vi.fn(async () => null),
}));

vi.mock("./settings-store", () => ({
  actions: { open: vi.fn() },
}));

vi.mock("./tab-store", () => ({
  actions: { open: vi.fn() },
}));

vi.mock("./use-sdk-watch", () => ({
  useSessionInventoryWatch: () => ({ status: "connecting", state: null }),
}));

it("keeps permanent Home UI mounted while inventory connects", () => {
  const html = renderToStaticMarkup(<HomePage />);

  expect(html).toContain("data-home-composer");
  expect(html).toContain("Projects");
  expect(html).toContain("All");
  expect(html).toContain("Add project");
  expect(html).toContain("Settings");
  expect(html).toContain('aria-label="Loading workspace"');
  expect(html).not.toContain("Connecting to workspace");
  expect(html).not.toContain("No threads yet");
});
