import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@multi/contracts";
import { EnvironmentId } from "@multi/contracts";
import { createModelCapabilities } from "@multi/shared/model";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderModelPicker } from "./model-picker";
import { resolveAppProviderModelState } from "../../../model/selection";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@multi/contracts/settings";
import { __resetClientSettingsPersistenceForTests } from "../../../hooks/use-settings";
import { __resetLocalApiForTests } from "../../../local-api";

function getFirstStarButton() {
  const starButton = document.querySelector<HTMLButtonElement>('button[aria-label*="favorites"]');
  expect(starButton).not.toBeNull();
  return starButton!;
}

// Mock the environments/runtime module to provide a mock primary environment connection
vi.mock("../../../environments/runtime", () => {
  const primaryConnection = {
    knownEnvironment: {
      id: "environment-local",
      label: "Local environment",
      source: "manual" as const,
      environmentId: EnvironmentId.make("environment-local"),
      target: {
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
      },
    },
    environmentId: EnvironmentId.make("environment-local"),
    client: {
      server: {
        getConfig: vi.fn(),
        updateSettings: vi.fn(),
      },
    },
    ensureBootstrapped: async () => undefined,
    reconnect: async () => undefined,
    dispose: async () => undefined,
  };

  return {
    getEnvironmentHttpBaseUrl: () => "http://localhost:3000",
    resolveEnvironmentHttpUrl: (_environmentId: unknown, path: string) =>
      new URL(path, "http://localhost:3000").toString(),
    ensureEnvironmentConnectionBootstrapped: async () => undefined,
    getPrimaryEnvironmentConnection: () => primaryConnection,
    readEnvironmentConnection: () => primaryConnection,
    requireEnvironmentConnection: () => primaryConnection,
    resetEnvironmentServiceForTests: vi.fn(),
    startEnvironmentConnectionService: vi.fn(),
    subscribeEnvironmentConnections: () => () => {},
  };
});

function selectDescriptor(
  id: string,
  label: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
) {
  return {
    id,
    label,
    type: "select" as const,
    options: [...options],
    ...(options.find((option) => option.isDefault)?.id
      ? { currentValue: options.find((option) => option.isDefault)?.id }
      : {}),
  };
}

function booleanDescriptor(id: string, label: string) {
  return {
    id,
    label,
    type: "boolean" as const,
  };
}

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("reasoningEffort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
            ]),
            booleanDescriptor("fastMode", "Fast Mode"),
          ],
        }),
      },
      {
        slug: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("reasoningEffort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
            ]),
            booleanDescriptor("fastMode", "Fast Mode"),
          ],
        }),
      },
    ],
  },
  {
    driver: ProviderDriverKind.make("claudeAgent"),
    instanceId: ProviderInstanceId.make("claudeAgent"),
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
              { id: "max", label: "max" },
            ]),
            booleanDescriptor("thinking", "Thinking"),
          ],
        }),
      },
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
              { id: "max", label: "max" },
            ]),
            booleanDescriptor("thinking", "Thinking"),
          ],
        }),
      },
      {
        slug: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            selectDescriptor("effort", "Reasoning", [
              { id: "low", label: "low" },
              { id: "medium", label: "medium", isDefault: true },
              { id: "high", label: "high" },
            ]),
            booleanDescriptor("thinking", "Thinking"),
          ],
        }),
      },
    ],
  },
];

const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const CLAUDE_INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const OPENCODE_INSTANCE_ID = ProviderInstanceId.make("opencode");

function buildCodexProvider(models: ServerProvider["models"]): ServerProvider {
  return {
    driver: ProviderDriverKind.make("codex"),
    instanceId: ProviderInstanceId.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models,
    slashCommands: [],
    skills: [],
  };
}

function buildOpenCodeProvider(models: ServerProvider["models"]): ServerProvider {
  return {
    driver: ProviderDriverKind.make("opencode"),
    instanceId: ProviderInstanceId.make("opencode"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models,
    slashCommands: [],
    skills: [],
  };
}

function buildCursorProvider(models: ServerProvider["models"]): ServerProvider {
  return {
    driver: ProviderDriverKind.make("cursor"),
    instanceId: ProviderInstanceId.make("cursor"),
    displayName: "Cursor",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models,
    slashCommands: [],
    skills: [],
  };
}

async function mountPicker(props: {
  activeInstanceId?: ProviderInstanceId;
  model: string;
  providers?: ReadonlyArray<ServerProvider>;
  popoverPlacement?: "top" | "top-start" | "top-end" | "bottom" | "bottom-start" | "bottom-end";
  settings?: UnifiedSettings;
  triggerVariant?: "ghost" | "outline";
  open?: boolean;
  openSearchSeed?: string;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onSelectionChange = vi.fn();
  const providers = props.providers ?? TEST_PROVIDERS;
  const state = resolveAppProviderModelState({
    settings: props.settings ?? DEFAULT_UNIFIED_SETTINGS,
    providers,
    requestedInstanceId: props.activeInstanceId ?? CODEX_INSTANCE_ID,
    requestedModel: props.model,
  });
  const screen = await render(
    <ProviderModelPicker
      activeInstanceId={state.selectedInstanceId}
      model={state.selectedModel}
      instanceEntries={state.providerInstanceEntries}
      modelCatalogItems={state.modelCatalogItems}
      selectedCatalogItem={state.selectedCatalogItem}
      availabilityStatus={state.status}
      {...(props.popoverPlacement !== undefined
        ? { popoverPlacement: props.popoverPlacement }
        : {})}
      triggerVariant={props.triggerVariant}
      {...(props.open !== undefined ? { open: props.open } : {})}
      {...(props.openSearchSeed !== undefined ? { openSearchSeed: props.openSearchSeed } : {})}
      onSelectionChange={onSelectionChange}
    />,
    { container: host },
  );

  return {
    onSelectionChange,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

async function mountPickerFromResolver(props: {
  requestedInstanceId?: ProviderInstanceId | null;
  requestedModel?: string | null;
  providers?: ReadonlyArray<ServerProvider>;
  settings?: UnifiedSettings;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onSelectionChange = vi.fn();
  const state = resolveAppProviderModelState({
    settings: props.settings ?? DEFAULT_UNIFIED_SETTINGS,
    providers: props.providers ?? TEST_PROVIDERS,
    requestedInstanceId: props.requestedInstanceId ?? null,
    requestedModel: props.requestedModel ?? null,
  });
  const screen = await render(
    <ProviderModelPicker
      activeInstanceId={state.selectedInstanceId}
      model={state.selectedModel}
      instanceEntries={state.providerInstanceEntries}
      modelCatalogItems={state.modelCatalogItems}
      selectedCatalogItem={state.selectedCatalogItem}
      availabilityStatus={state.status}
      onSelectionChange={onSelectionChange}
    />,
    { container: host },
  );

  return {
    state,
    onSelectionChange,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

function getModelPickerListElement() {
  const modelPickerList = document.querySelector<HTMLElement>(".model-picker-list");
  expect(modelPickerList).not.toBeNull();
  return modelPickerList!;
}

function getModelPickerListText() {
  return getModelPickerListElement().textContent ?? "";
}

function getVisibleModelNames() {
  return Array.from(getModelPickerListElement().querySelectorAll<HTMLDivElement>("div.font-medium"))
    .map((element) => element.textContent?.replace(/New$/u, "").trim() ?? "")
    .filter((text) => text.length > 0);
}

function getSidebarProviderOrder() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-model-picker-provider]")).map(
    (element) => element.dataset.modelPickerProvider ?? "",
  );
}

function disableProvider(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): ReadonlyArray<ServerProvider> {
  return providers.map((provider) =>
    provider.instanceId === instanceId
      ? {
          ...provider,
          enabled: false,
          status: "disabled",
        }
      : provider,
  );
}

describe("ProviderModelPicker", () => {
  beforeEach(async () => {
    // Reset test environment before each test
    await __resetLocalApiForTests();
    __resetClientSettingsPersistenceForTests();
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    await __resetLocalApiForTests();
    __resetClientSettingsPersistenceForTests();
  });

  it("seeds model search when opened with openSearchSeed", async () => {
    const mounted = await mountPicker({
      model: "claude-opus-4-6",
      open: true,
      openSearchSeed: "haiku",
    });

    try {
      await vi.waitFor(() => {
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder="Search models..."]',
        );
        expect(input).not.toBeNull();
        expect(input?.value).toBe("haiku");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows provider sidebar", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).not.toContain("Codex");
        expect(text).toContain("Claude");
        expect(text).toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows favorites first in the provider sidebar", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getSidebarProviderOrder().slice(0, 3)).toEqual([
          "favorites",
          "codex",
          "claudeAgent",
        ]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("filters models by selected provider in sidebar", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      // Start with Claude models visible
      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).not.toContain("GPT-5 Codex");
        expect(text).toContain("Claude Opus 4.6");
      });

      // Click on Codex provider in sidebar
      await vi.waitFor(() => {
        expect(document.querySelector('[data-model-picker-provider="codex"]')).not.toBeNull();
      });
      await page.getByRole("button", { name: "Codex", exact: true }).click();

      // Now should only show Codex models
      await vi.waitFor(() => {
        const listText = getModelPickerListText();
        expect(listText).toContain("GPT-5 Codex");
        expect(listText).not.toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("uses client model visibility and ordering preferences", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      settings: {
        ...DEFAULT_UNIFIED_SETTINGS,
        providerModelPreferences: {
          [CLAUDE_INSTANCE_ID]: {
            hiddenModels: ["claude-opus-4-6"],
            modelOrder: ["claude-haiku-4-5", "claude-sonnet-4-6"],
          },
        },
      },
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getVisibleModelNames()).toEqual(["Claude Haiku 4.5", "Claude Sonnet 4.6"]);
        expect(getModelPickerListText()).not.toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("focuses the search input after selecting a sidebar provider", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(document.querySelector('[data-model-picker-provider="codex"]')).not.toBeNull();
      });
      await page.getByRole("button", { name: "Codex", exact: true }).click();

      await vi.waitFor(() => {
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[placeholder="Search models..."]',
        );
        expect(searchInput).not.toBeNull();
        expect(document.activeElement).toBe(searchInput);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows active provider models and the full provider rail", async () => {
    localStorage.setItem(
      "multi:client-settings:v1",
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        favorites: [
          { provider: "codex", model: "gpt-5-codex" },
          { provider: "claudeAgent", model: "claude-sonnet-4-6" },
        ],
      }),
    );

    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      providers: [
        ...TEST_PROVIDERS,
        buildCursorProvider([
          {
            slug: "composer-2",
            name: "Composer 2",
            isCustom: false,
            capabilities: createModelCapabilities({ optionDescriptors: [] }),
          },
        ]),
      ],
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude");
        expect(getSidebarProviderOrder()).toEqual([
          "favorites",
          "codex",
          "claudeAgent",
          "cursor",
          "pi-pending",
        ]);
        expect(getVisibleModelNames()).toEqual([
          "Claude Sonnet 4.6",
          "Claude Opus 4.6",
          "Claude Haiku 4.5",
        ]);
      });
    } finally {
      localStorage.removeItem("multi:client-settings:v1");
      await mounted.cleanup();
    }
  });

  it("anchors top-start placement to the trigger start edge", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
      popoverPlacement: "top-start",
    });

    try {
      const trigger = document.querySelector<HTMLButtonElement>(
        '[data-chat-provider-model-picker="true"]',
      );
      expect(trigger).not.toBeNull();
      trigger!.style.marginLeft = "260px";
      trigger!.style.marginTop = "420px";
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const positioner = document.querySelector<HTMLElement>('[data-slot="popover-positioner"]');
        expect(positioner).not.toBeNull();
        const triggerRect = trigger!.getBoundingClientRect();
        const positionerRect = positioner!.getBoundingClientRect();
        expect(Math.abs(positionerRect.left - triggerRect.left)).toBeLessThanOrEqual(2);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows every configured provider instance in the rail", async () => {
    const defaultCodexModels: ServerProvider["models"] = [
      {
        slug: "gpt-work",
        name: "GPT Work",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ];
    const personalCodexModels: ServerProvider["models"] = [
      {
        slug: "gpt-personal",
        name: "GPT Personal",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ];
    const isolatedCodexModels: ServerProvider["models"] = [
      {
        slug: "gpt-isolated",
        name: "GPT Isolated",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ];
    const providers: ReadonlyArray<ServerProvider> = [
      {
        ...buildCodexProvider(defaultCodexModels),
        instanceId: "codex" as ProviderInstanceId,
        displayName: "Codex Work",
        accentColor: "#2563eb",
        continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      },
      {
        ...buildCodexProvider(personalCodexModels),
        instanceId: "codex_personal" as ProviderInstanceId,
        displayName: "Codex Personal",
        accentColor: "#dc2626",
        continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      },
      {
        ...buildCodexProvider(isolatedCodexModels),
        instanceId: "codex_isolated" as ProviderInstanceId,
        displayName: "Codex Isolated",
        accentColor: "#16a34a",
        continuation: { groupKey: "codex:home:/Users/julius/.codex_isolated" },
      },
      TEST_PROVIDERS[1]!,
    ];
    const mounted = await mountPicker({
      activeInstanceId: "codex" as ProviderInstanceId,
      model: "gpt-work",
      providers,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getSidebarProviderOrder()).toEqual([
          "favorites",
          "codex",
          "codex_personal",
          "codex_isolated",
          "claudeAgent",
          "pi-pending",
        ]);
        expect(
          document.querySelector<HTMLElement>('[data-model-picker-provider="codex_personal"]')
            ?.dataset.providerAccentColor,
        ).toBe("#dc2626");
        expect(getModelPickerListText()).toContain("Codex Work");
        expect(getVisibleModelNames()).toEqual(["GPT Work"]);
      });

      await page.getByRole("button", { name: "Codex Personal" }).click();

      await vi.waitFor(() => {
        expect(getModelPickerListText()).toContain("Codex Personal");
        expect(getVisibleModelNames()).toEqual(["GPT Personal"]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders the resolver-selected catalog item when requested model belongs to another provider (#1982)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onSelectionChange = vi.fn();
    const state = resolveAppProviderModelState({
      settings: DEFAULT_UNIFIED_SETTINGS,
      providers: TEST_PROVIDERS,
      requestedInstanceId: CLAUDE_INSTANCE_ID,
      requestedModel: "gpt-5-codex",
    });
    const screen = await render(
      <ProviderModelPicker
        activeInstanceId={state.selectedInstanceId}
        model={state.selectedModel}
        instanceEntries={state.providerInstanceEntries}
        modelCatalogItems={state.modelCatalogItems}
        selectedCatalogItem={state.selectedCatalogItem}
        onSelectionChange={onSelectionChange}
      />,
      { container: host },
    );

    try {
      const trigger = document.querySelector<HTMLElement>(
        '[data-chat-provider-model-picker="true"]',
      );
      expect(trigger).not.toBeNull();
      const label = trigger?.textContent ?? "";
      expect(label).not.toContain("gpt-5-codex");
      expect(label).toContain("Claude Opus 4.6");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders resolver fallback state for missing and disabled selections", async () => {
    const missingProvider = await mountPickerFromResolver({
      requestedInstanceId: ProviderInstanceId.make("missingProvider"),
      requestedModel: "retired-model",
    });

    try {
      expect(missingProvider.state.status.kind).toBe("missing-provider");
      expect(missingProvider.state.selectedInstanceId).toBe(CODEX_INSTANCE_ID);
      expect(missingProvider.state.selectedModel).toBe("gpt-5-codex");

      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const trigger = document.querySelector<HTMLElement>(
          '[data-chat-provider-model-picker="true"]',
        );
        expect(trigger?.textContent).toContain("GPT-5 Codex");
        expect(trigger?.textContent).not.toContain("retired-model");
        expect(document.body.textContent ?? "").toContain(missingProvider.state.status.message);
      });
    } finally {
      await missingProvider.cleanup();
    }

    const missingModel = await mountPickerFromResolver({
      requestedInstanceId: CLAUDE_INSTANCE_ID,
      requestedModel: "retired-claude-model",
    });

    try {
      expect(missingModel.state.status.kind).toBe("missing-model");
      expect(missingModel.state.selectedInstanceId).toBe(CLAUDE_INSTANCE_ID);
      expect(missingModel.state.selectedModel).toBe("claude-opus-4-6");

      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const trigger = document.querySelector<HTMLElement>(
          '[data-chat-provider-model-picker="true"]',
        );
        expect(trigger?.textContent).toContain("Claude Opus 4.6");
        expect(trigger?.textContent).not.toContain("retired-claude-model");
        expect(document.body.textContent ?? "").toContain(missingModel.state.status.message);
      });
    } finally {
      await missingModel.cleanup();
    }

    const disabledProvider = await mountPickerFromResolver({
      requestedInstanceId: CLAUDE_INSTANCE_ID,
      requestedModel: "claude-opus-4-6",
      providers: disableProvider(TEST_PROVIDERS, CLAUDE_INSTANCE_ID),
    });

    try {
      expect(disabledProvider.state.status.kind).toBe("disabled-provider");
      expect(disabledProvider.state.selectedInstanceId).toBe(CODEX_INSTANCE_ID);
      expect(disabledProvider.state.selectedModel).toBe("gpt-5-codex");

      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const disabledRailButton = document.querySelector<HTMLButtonElement>(
          '[data-model-picker-provider="claudeAgent"]',
        );
        expect(disabledRailButton).not.toBeNull();
        expect(disabledRailButton?.disabled).toBe(true);
        expect(disabledRailButton?.getAttribute("aria-label")).toBe(
          "Claude — Disabled in settings.",
        );
        const listText = getModelPickerListText();
        expect(listText).toContain("GPT-5 Codex");
        expect(listText).not.toContain("Claude Opus 4.6");
        expect(document.body.textContent ?? "").toContain(disabledProvider.state.status.message);
      });
    } finally {
      await disabledProvider.cleanup();
    }
  });

  it("renders the empty catalog resolver state without selectable rows", async () => {
    const emptyCatalog = await mountPickerFromResolver({
      requestedInstanceId: CODEX_INSTANCE_ID,
      requestedModel: "gpt-5-codex",
      providers: [buildCodexProvider([])],
    });

    try {
      expect(emptyCatalog.state.status.kind).toBe("empty-catalog");
      expect(emptyCatalog.state.selectedInstanceId).toBe(CODEX_INSTANCE_ID);
      expect(emptyCatalog.state.selectableModelOptions).toHaveLength(0);

      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getVisibleModelNames()).toEqual([]);
        expect(document.body.textContent ?? "").toContain(emptyCatalog.state.status.message);
      });
    } finally {
      await emptyCatalog.cleanup();
    }
  });

  it("uses compact model labels for opencode rows", async () => {
    const providers: ReadonlyArray<ServerProvider> = [
      buildOpenCodeProvider([
        {
          slug: "github-copilot/claude-opus-4.5",
          name: "Claude Opus 4.5",
          subProvider: "GitHub Copilot",
          shortName: "Opus 4.5",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
            ],
          }),
        },
      ]),
    ];
    const mounted = await mountPicker({
      activeInstanceId: OPENCODE_INSTANCE_ID,
      model: "github-copilot/claude-opus-4.5",
      providers,
    });

    try {
      await vi.waitFor(() => {
        const trigger = document.querySelector<HTMLElement>(
          '[data-chat-provider-model-picker="true"]',
        );
        expect(trigger?.textContent).toContain("GitHub Copilot");
        expect(trigger?.textContent).toContain("Opus 4.5");
      });

      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getVisibleModelNames()).toEqual(["Opus 4.5"]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("searches models by name in flat list", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
        expect(text).not.toContain("GPT-5 Codex");
      });

      // Find and type in search box
      const searchInput = page.getByPlaceholder("Search models...");
      await searchInput.fill("claude");

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
        expect(text).not.toContain("GPT-5 Codex");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("supports arrow-key navigation in the model picker", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      const searchInput = page.getByPlaceholder("Search models...");
      await userEvent.click(searchInput);
      await userEvent.keyboard("{ArrowDown}");
      await vi.waitFor(() => {
        const highlightedItem = document.querySelector<HTMLElement>(
          '[data-slot="combobox-item"][data-highlighted]',
        );
        expect(highlightedItem).not.toBeNull();
        expect(highlightedItem?.textContent).toContain("Claude Opus 4.6");
      });
      await userEvent.keyboard("{ArrowDown}");
      await vi.waitFor(() => {
        const highlightedItem = document.querySelector<HTMLElement>(
          '[data-slot="combobox-item"][data-highlighted]',
        );
        expect(highlightedItem).not.toBeNull();
        expect(highlightedItem?.textContent).toContain("Claude Sonnet 4.6");
      });
      await userEvent.keyboard("{Enter}");

      expect(mounted.onSelectionChange).toHaveBeenCalledWith({
        instanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("hides the provider sidebar while searching", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(getSidebarProviderOrder().length).toBeGreaterThan(0);
      });

      await page.getByPlaceholder("Search models...").fill("cla");

      await vi.waitFor(() => {
        expect(getSidebarProviderOrder()).toEqual([]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("closes the picker when escape is pressed in search", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      const searchInput = page.getByPlaceholder("Search models...");
      await searchInput.click();
      const searchInputElement = document.querySelector<HTMLInputElement>(
        'input[placeholder="Search models..."]',
      );
      expect(searchInputElement).not.toBeNull();
      searchInputElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );

      await vi.waitFor(() => {
        expect(document.querySelector(".model-picker-list")).toBeNull();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("searches models by provider name", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
        expect(text).not.toContain("GPT-5 Codex");
      });

      // Search by provider name
      const searchInput = page.getByPlaceholder("Search models...");
      await searchInput.fill("codex");

      await vi.waitFor(() => {
        const listText = getModelPickerListText();
        expect(listText).toContain("GPT-5 Codex");
        expect(listText).not.toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("matches fuzzy multi-token queries across provider and model text", async () => {
    const providers: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5-codex",
          name: "GPT-5 Codex",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
      ]),
      buildOpenCodeProvider([
        {
          slug: "github-copilot/claude-opus-4.7",
          name: "Claude Opus 4.7",
          subProvider: "GitHub Copilot",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
            ],
          }),
        },
      ]),
    ];
    const mounted = await mountPicker({
      activeInstanceId: OPENCODE_INSTANCE_ID,
      model: "github-copilot/claude-opus-4.7",
      providers,
    });

    try {
      await page.getByRole("button").click();
      await page.getByPlaceholder("Search models...").fill("coplt op");

      await vi.waitFor(() => {
        const listText = getModelPickerListText();
        expect(listText).toContain("Claude Opus 4.7");
        expect(listText).not.toContain("GPT-5 Codex");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders each search result with its own provider branding", async () => {
    const providers: ReadonlyArray<ServerProvider> = [
      buildOpenCodeProvider([
        {
          slug: "github-copilot/claude-opus-4.7",
          name: "Claude Opus 4.7",
          subProvider: "GitHub Copilot",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
            ],
          }),
        },
      ]),
      {
        ...TEST_PROVIDERS[1]!,
        models: [
          {
            slug: "claude-opus-4-6",
            name: "Claude Opus 4.6",
            isCustom: false,
            capabilities: createModelCapabilities({
              optionDescriptors: [
                selectDescriptor("effort", "Reasoning", [
                  { id: "low", label: "low" },
                  { id: "medium", label: "medium", isDefault: true },
                  { id: "high", label: "high" },
                  { id: "max", label: "max" },
                ]),
                booleanDescriptor("thinking", "Thinking"),
              ],
            }),
          },
        ],
      },
    ];
    const mounted = await mountPicker({
      activeInstanceId: OPENCODE_INSTANCE_ID,
      model: "github-copilot/claude-opus-4.7",
      providers,
    });

    try {
      await page.getByRole("button").click();
      await page.getByPlaceholder("Search models...").fill("opus");

      await vi.waitFor(() => {
        const listText = getModelPickerListText();
        expect(listText).toContain("OpenCode · GitHub Copilot");
        expect(listText).toContain("Claude");
        expect(listText).not.toContain("OpenCodeClaude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("toggles favorite stars when clicked", async () => {
    localStorage.removeItem("multi:client-settings:v1");

    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
      });

      const firstStar = getFirstStarButton();
      const initialAriaLabel = firstStar.getAttribute("aria-label");
      expect(
        initialAriaLabel === "Add to favorites" || initialAriaLabel === "Remove from favorites",
      ).toBe(true);

      await page.getByRole("button", { name: initialAriaLabel! }).first().click();

      const expectedAriaLabel =
        initialAriaLabel === "Add to favorites" ? "Remove from favorites" : "Add to favorites";

      await vi.waitFor(() => {
        expect(getFirstStarButton().getAttribute("aria-label")).toBe(expectedAriaLabel);
      });
    } finally {
      await mounted.cleanup();
      localStorage.removeItem("multi:client-settings:v1");
    }
  });

  it("does not duplicate favorited models across favorites and all models sections", async () => {
    localStorage.removeItem("multi:client-settings:v1");

    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Opus 4.6");
      });

      const favoriteButton = page.getByRole("button", {
        name: "Add to favorites",
      });
      await favoriteButton.first().click();

      await vi.waitFor(async () => {
        const favoritedModelRows = Array.from(
          getModelPickerListElement().querySelectorAll<HTMLDivElement>("div.font-medium"),
        ).filter((element) => element.textContent?.trim() === "Claude Opus 4.6");
        expect(favoritedModelRows.length).toBe(1);
      });
    } finally {
      await mounted.cleanup();
      localStorage.removeItem("multi:client-settings:v1");
    }
  });

  it("shows favorited models first within the selected provider list", async () => {
    localStorage.setItem(
      "multi:client-settings:v1",
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        favorites: [{ provider: "codex", model: "gpt-5.3-codex" }],
      }),
    );

    const mounted = await mountPicker({
      model: "gpt-5-codex",
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("button", { name: "Codex", exact: true }).click();

      await vi.waitFor(() => {
        expect(getVisibleModelNames().slice(0, 2)).toEqual(["GPT-5.3 Codex", "GPT-5 Codex"]);
      });
    } finally {
      await mounted.cleanup();
      localStorage.removeItem("multi:client-settings:v1");
    }
  });

  it("dispatches callback with correct provider and model when selected", async () => {
    const mounted = await mountPicker({
      activeInstanceId: CLAUDE_INSTANCE_ID,
      model: "claude-opus-4-6",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Claude Sonnet 4.6");
      });

      // Click on a model
      const modelRow = page.getByText("Claude Sonnet 4.6").first();
      await modelRow.click();

      // Verify callback was called with correct values
      expect(mounted.onSelectionChange).toHaveBeenCalledWith({
        instanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("only shows codex spark when the server reports it", async () => {
    const providersWithoutSpark: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
      ]),
      TEST_PROVIDERS[1]!,
    ];
    const providersWithSpark: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
        {
          slug: "gpt-5.3-codex-spark",
          name: "GPT-5.3 Codex Spark",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoningEffort", "Reasoning", [
                { id: "low", label: "low" },
                { id: "medium", label: "medium", isDefault: true },
                { id: "high", label: "high" },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
      ]),
      TEST_PROVIDERS[1]!,
    ];

    const hidden = await mountPicker({
      model: "gpt-5.3-codex",
      providers: providersWithoutSpark,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("GPT-5.3 Codex");
        expect(text).not.toContain("GPT-5.3 Codex Spark");
      });
    } finally {
      await hidden.cleanup();
    }

    const visible = await mountPicker({
      model: "gpt-5.3-codex",
      providers: providersWithSpark,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("GPT-5.3 Codex Spark");
      });
    } finally {
      await visible.cleanup();
    }
  });

  it("shows disabled providers grayed out in sidebar", async () => {
    const disabledProviders = disableProvider(TEST_PROVIDERS, CLAUDE_INSTANCE_ID);

    const mounted = await mountPicker({
      model: "gpt-5-codex",
      providers: disabledProviders,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("GPT-5 Codex");
        // Disabled provider should not have its models shown
        expect(text).not.toContain("Claude Opus 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("accepts outline trigger styling", async () => {
    const mounted = await mountPicker({
      model: "gpt-5-codex",
      triggerVariant: "outline",
    });

    try {
      const button = document.querySelector<HTMLButtonElement>(
        '[data-chat-provider-model-picker="true"]',
      );
      if (!button) {
        throw new Error("Expected picker trigger button to be rendered.");
      }
      expect(button.className).toContain("border-multi-stroke-tertiary");
      expect(button.className).toContain("bg-multi-bg-quinary");
    } finally {
      await mounted.cleanup();
    }
  });
});
