import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@multi/contracts";
import { createModelCapabilities } from "@multi/shared/model";

import { ProviderInstanceCard } from "./provider-instance-card";
import { getDriverOption } from "./provider-driver-meta";

const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex_work");

function providerInstance(
  overrides: Partial<ProviderInstanceConfig> = {},
): ProviderInstanceConfig {
  return {
    driver: CODEX_DRIVER,
    displayName: "Codex Work",
    enabled: true,
    config: {
      customModels: ["custom-codex"],
    },
    ...overrides,
  };
}

function liveProvider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: CODEX_INSTANCE_ID,
    driver: CODEX_DRIVER,
    displayName: "Codex Work",
    enabled: true,
    installed: true,
    version: "1.2.3",
    status: "ready",
    auth: {
      status: "authenticated",
      type: "account",
      label: "work@example.com",
    },
    checkedAt: "2026-05-18T12:00:00.000Z",
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

async function renderProviderInstanceCard(
  overrides: Partial<Parameters<typeof ProviderInstanceCard>[0]> = {},
) {
  const props = {
    instanceId: CODEX_INSTANCE_ID,
    instance: providerInstance(),
    driverOption: getDriverOption(CODEX_DRIVER),
    liveProvider: liveProvider(),
    isExpanded: true,
    onExpandedChange: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    hiddenModels: [],
    favoriteModels: [],
    modelOrder: [],
    onHiddenModelsChange: vi.fn(),
    onFavoriteModelsChange: vi.fn(),
    onModelOrderChange: vi.fn(),
    ...overrides,
  };

  return {
    props,
    screen: await render(<ProviderInstanceCard {...props} />),
  };
}

describe("ProviderInstanceCard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the provider instance shell and writes enabled changes", async () => {
    const { props, screen } = await renderProviderInstanceCard();

    try {
      await expect.element(page.getByText("Codex Work")).toBeVisible();
      await expect.element(page.getByText("Authenticated")).toBeVisible();
      await expect.element(page.getByText("· work@example.com")).toBeVisible();
      await expect.element(page.getByText("Display name")).toBeVisible();
      await expect.element(page.getByText("Accent color")).toBeVisible();
      await expect.element(page.getByText("Environment variables")).toBeVisible();
      await expect.element(page.getByText("GPT-5 Codex")).toBeVisible();
      await expect.element(page.getByText("custom-codex")).toBeVisible();

      await page.getByRole("switch", { name: "Enable Codex Work" }).click();

      expect(props.onUpdate).toHaveBeenCalledWith({
        ...props.instance,
        enabled: false,
      });
    } finally {
      await screen.unmount();
    }
  });

  it("preserves unknown provider instances without editable driver fields", async () => {
    const unknownDriver = ProviderDriverKind.make("customFork");
    const { screen } = await renderProviderInstanceCard({
      instanceId: ProviderInstanceId.make("customFork"),
      instance: providerInstance({
        driver: unknownDriver,
        displayName: "Custom Fork",
        config: {
          customSetting: true,
        },
      }),
      driverOption: undefined,
      liveProvider: undefined,
      onDelete: undefined,
    });

    try {
      await expect.element(page.getByText("Custom Fork")).toBeVisible();
      await expect
        .element(
          page.getByText(
            "This instance uses a driver (customFork) that is not shipped with the current build. Configuration values are preserved but cannot be edited from this surface.",
          ),
        )
        .toBeVisible();
      await expect
        .element(page.getByRole("button", { name: /Delete provider instance/ }))
        .not.toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });
});
