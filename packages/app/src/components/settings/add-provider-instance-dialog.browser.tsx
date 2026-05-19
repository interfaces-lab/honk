import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AddProviderInstanceDialog } from "./add-provider-instance-dialog";

const settingsHarness = vi.hoisted(() => ({
  updateSettings: vi.fn(),
}));

vi.mock("../../hooks/use-settings", () => ({
  useSettings: () => ({
    providerInstances: {},
  }),
  useUpdateSettings: () => ({
    updateSettings: settingsHarness.updateSettings,
  }),
}));

vi.mock("~/app/toast", () => ({
  toastManager: {
    add: vi.fn(),
  },
}));

describe("AddProviderInstanceDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    settingsHarness.updateSettings.mockReset();
  });

  it("creates a provider instance through identity and schema config steps", async () => {
    const onOpenChange = vi.fn();
    const screen = await render(
      <AddProviderInstanceDialog open onOpenChange={onOpenChange} />,
    );

    try {
      await expect.element(page.getByText("Add provider instance")).toBeVisible();
      await expect.element(page.getByText("Codex", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Next" }).click();
      await page.getByLabelText("Label").fill("Work");
      await expect.element(page.getByLabelText("Instance ID")).toHaveValue("codex_work");

      await page.getByRole("button", { name: "Next" }).click();
      await expect.element(page.getByLabelText("Binary path")).toBeVisible();
      await expect.element(page.getByText("CODEX_HOME path")).toBeVisible();
      await expect.element(page.getByText("Shadow home path")).toBeVisible();
      await page.getByLabelText("Binary path").fill("codex-next");

      await page.getByRole("button", { name: "Add instance" }).click();

      expect(settingsHarness.updateSettings).toHaveBeenCalledWith({
        providerInstances: {
          codex_work: {
            driver: "codex",
            enabled: true,
            displayName: "Work",
            config: {
              binaryPath: "codex-next",
            },
          },
        },
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      await screen.unmount();
    }
  });
});
