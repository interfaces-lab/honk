import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ProviderDriverKind, ProviderInstanceId, type ServerProviderModel } from "@multi/contracts";
import { createModelCapabilities } from "@multi/shared/model";

import { ProviderModelsSection } from "./provider-models-section";

const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const CODEX_DRIVER = ProviderDriverKind.make("codex");

function model(slug: string, name: string, isCustom = false): ServerProviderModel {
  return {
    slug,
    name,
    isCustom,
    capabilities: createModelCapabilities({ optionDescriptors: [] }),
  };
}

async function renderProviderModelsSection(
  overrides: Partial<Parameters<typeof ProviderModelsSection>[0]> = {},
) {
  const props = {
    instanceId: CODEX_INSTANCE_ID,
    driverKind: CODEX_DRIVER,
    models: [
      model("gpt-5-codex", "GPT-5 Codex"),
      model("existing-custom", "existing-custom", true),
    ],
    customModels: ["existing-custom"],
    hiddenModels: [],
    favoriteModels: [],
    modelOrder: [],
    onChange: vi.fn(),
    onHiddenModelsChange: vi.fn(),
    onFavoriteModelsChange: vi.fn(),
    onModelOrderChange: vi.fn(),
    ...overrides,
  };

  return {
    props,
    screen: await render(<ProviderModelsSection {...props} />),
  };
}

describe("ProviderModelsSection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("validates built-in duplicates and adds normalized custom models from the UI", async () => {
    const { props, screen } = await renderProviderModelsSection();

    try {
      const input = page.getByPlaceholder("gpt-6.7-codex-ultra-preview");
      await input.fill("gpt-5-codex");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      await expect.element(page.getByText("That model is already built in.")).toBeInTheDocument();
      expect(props.onChange).not.toHaveBeenCalled();

      await input.fill("my-custom-model");
      await page.getByRole("button", { name: "Add", exact: true }).click();

      expect(props.onChange).toHaveBeenCalledWith(["existing-custom", "my-custom-model"]);
    } finally {
      await screen.unmount();
    }
  });

  it("persists favorite and hidden model changes from row controls", async () => {
    const { props, screen } = await renderProviderModelsSection();

    try {
      await page.getByRole("button", { name: "Add GPT-5 Codex to favorites" }).click();
      await page.getByRole("button", { name: "Hide GPT-5 Codex" }).click();

      expect(props.onFavoriteModelsChange).toHaveBeenCalledWith(["gpt-5-codex"]);
      expect(props.onHiddenModelsChange).toHaveBeenCalledWith(["gpt-5-codex"]);
    } finally {
      await screen.unmount();
    }
  });
});
