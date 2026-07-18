import type {
  ManagedAnthropicImport,
  OpenCodeClient,
  OpenCodeProviderApi,
  OpenCodeProviderAuthMethod,
  OpenCodeProviderInventory,
} from "@honk/opencode";
import { describe, expect, it, vi } from "vitest";

import {
  createProviderAuthCoordinator,
  isProviderAuthPromptVisible,
  nextProviderAuthPromptIndex,
} from "./provider-auth";

const conditionalMethod: OpenCodeProviderAuthMethod = {
  index: 3,
  type: "oauth",
  label: "Sign in",
  prompts: [
    {
      type: "select",
      key: "account",
      message: "Choose an account",
      options: [
        { label: "Personal", value: "personal" },
        { label: "Team", value: "team" },
      ],
    },
    {
      type: "text",
      key: "organization",
      message: "Organization",
      when: { key: "account", op: "eq", value: "team" },
    },
    {
      type: "text",
      key: "nickname",
      message: "Nickname",
      when: { key: "account", op: "neq", value: "team" },
    },
  ],
};

function inventory(
  openAiConnected: boolean,
  openCodeGoConnected = false,
): OpenCodeProviderInventory {
  return {
    providers: [
      { id: "openai", name: "OpenAI", connected: openAiConnected },
      { id: "opencode-go", name: "OpenCode Go", connected: openCodeGoConnected },
      { id: "anthropic", name: "Anthropic", connected: false },
    ],
  };
}

function managedResult(value: OpenCodeProviderInventory): ManagedAnthropicImport {
  return { kind: "unavailable", inventory: value };
}

function fakeClient(overrides: Partial<OpenCodeProviderApi> = {}): OpenCodeClient {
  const providers: OpenCodeProviderApi = {
    list: vi.fn().mockResolvedValue(inventory(false)),
    authMethods: vi.fn().mockResolvedValue([conditionalMethod]),
    authorizeOauth: vi.fn().mockResolvedValue({
      url: "https://auth.example.test",
      method: "code",
      instructions: "Paste the code",
    }),
    completeOauth: vi.fn().mockResolvedValue(undefined),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    removeAuth: vi.fn().mockResolvedValue(undefined),
    ensureManagedAnthropicImport: vi.fn().mockResolvedValue(managedResult(inventory(false))),
    ...overrides,
  };
  return { providers } as OpenCodeClient;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("provider auth prompts", () => {
  it("evaluates controlling prompt inputs", () => {
    const organization = conditionalMethod.prompts[1]!;
    const nickname = conditionalMethod.prompts[2]!;
    expect(isProviderAuthPromptVisible(organization, {})).toBe(false);
    expect(isProviderAuthPromptVisible(organization, { account: "team" })).toBe(true);
    expect(isProviderAuthPromptVisible(nickname, { account: "team" })).toBe(false);
    expect(isProviderAuthPromptVisible(nickname, { account: "personal" })).toBe(true);
  });

  it("skips prompts whose conditions do not match", () => {
    expect(nextProviderAuthPromptIndex(conditionalMethod, 1, { account: "team" })).toBe(1);
    expect(nextProviderAuthPromptIndex(conditionalMethod, 2, { account: "team" })).toBeNull();
    expect(nextProviderAuthPromptIndex(conditionalMethod, 1, { account: "personal" })).toBe(2);
  });
});

describe("provider auth coordinator", () => {
  it("deduplicates the initial managed import and refresh", async () => {
    const pending = deferred<ManagedAnthropicImport>();
    const ensureManagedAnthropicImport = vi.fn().mockReturnValue(pending.promise);
    const coordinator = createProviderAuthCoordinator(fakeClient({ ensureManagedAnthropicImport }));
    const first = coordinator.start();
    const second = coordinator.refresh();
    expect(first).toBe(second);
    expect(ensureManagedAnthropicImport).toHaveBeenCalledOnce();
    pending.resolve(managedResult(inventory(false)));
    await first;
    expect(coordinator.getSnapshot().phase).toBe("ready");
  });

  it("collects conditional prompt inputs before authorization", async () => {
    const authorizeOauth = vi.fn().mockResolvedValue({
      url: "https://auth.example.test",
      method: "code",
      instructions: "Paste the code",
    });
    const client = fakeClient({ authorizeOauth });
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const coordinator = createProviderAuthCoordinator(client, openUrl);
    await coordinator.startOpenAi();
    await coordinator.chooseOpenAiMethod(conditionalMethod.index);
    await coordinator.submitOpenAiPrompt("team");
    await coordinator.submitOpenAiPrompt("acme");
    expect(authorizeOauth).toHaveBeenCalledWith("openai", conditionalMethod.index, {
      account: "team",
      organization: "acme",
    });
    expect(openUrl).toHaveBeenCalledWith("https://auth.example.test");
    expect(coordinator.getSnapshot().openAi.kind).toBe("code");
  });

  it("trims API keys and verifies connection from refreshed inventory", async () => {
    const apiMethod: OpenCodeProviderAuthMethod = {
      index: 1,
      type: "api",
      label: "API key",
      prompts: [],
    };
    const setApiKey = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue(inventory(true));
    const coordinator = createProviderAuthCoordinator(
      fakeClient({ authMethods: vi.fn().mockResolvedValue([apiMethod]), setApiKey, list }),
    );
    await coordinator.startOpenAi();
    await coordinator.chooseOpenAiMethod(apiMethod.index);
    await coordinator.submitOpenAiApiKey("  secret  ");
    expect(setApiKey).toHaveBeenCalledWith("openai", "secret");
    expect(coordinator.getSnapshot().openAiConnected).toBe(true);
  });

  it("detects OpenCode Go credentials supplied by the environment inventory", async () => {
    const coordinator = createProviderAuthCoordinator(
      fakeClient({
        ensureManagedAnthropicImport: vi
          .fn()
          .mockResolvedValue(managedResult(inventory(false, true))),
      }),
    );
    await coordinator.start();
    expect(coordinator.getSnapshot().openCodeGoConnected).toBe(true);
  });

  it("saves a trimmed OpenCode key against the opencode-go provider", async () => {
    const setApiKey = vi.fn().mockResolvedValue(undefined);
    const coordinator = createProviderAuthCoordinator(
      fakeClient({
        setApiKey,
        list: vi.fn().mockResolvedValue(inventory(false, true)),
      }),
    );
    await coordinator.startOpenCodeGo();
    await coordinator.submitOpenCodeGoApiKey("  go-secret  ");
    expect(setApiKey).toHaveBeenCalledWith("opencode-go", "go-secret");
    expect(coordinator.getSnapshot().openCodeGoConnected).toBe(true);
  });

  it("opens code OAuth and completes with a trimmed callback code", async () => {
    const completeOauth = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue(inventory(true));
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const coordinator = createProviderAuthCoordinator(fakeClient({ completeOauth, list }), openUrl);
    await coordinator.startOpenAi();
    await coordinator.chooseOpenAiMethod(conditionalMethod.index);
    await coordinator.submitOpenAiPrompt("team");
    await coordinator.submitOpenAiPrompt("acme");
    await coordinator.submitOpenAiCode("  callback-code  ");
    expect(completeOauth).toHaveBeenCalledWith("openai", conditionalMethod.index, "callback-code");
    expect(coordinator.getSnapshot().openAiConnected).toBe(true);
  });

  it("ignores an auto OAuth completion after cancellation", async () => {
    const autoMethod: OpenCodeProviderAuthMethod = {
      index: 4,
      type: "oauth",
      label: "Browser",
      prompts: [],
    };
    const completion = deferred<void>();
    const coordinator = createProviderAuthCoordinator(
      fakeClient({
        authMethods: vi.fn().mockResolvedValue([autoMethod]),
        authorizeOauth: vi.fn().mockResolvedValue({
          url: "https://auth.example.test",
          method: "auto",
          instructions: "Waiting",
        }),
        completeOauth: vi.fn().mockReturnValue(completion.promise),
      }),
      vi.fn().mockResolvedValue(undefined),
    );
    await coordinator.startOpenAi();
    const authorization = coordinator.chooseOpenAiMethod(autoMethod.index);
    await vi.waitFor(() => {
      expect(coordinator.getSnapshot().openAi.kind).toBe("waiting");
    });
    coordinator.cancelOpenAi();
    completion.resolve();
    await authorization;
    expect(coordinator.getSnapshot().openAi.kind).toBe("idle");
  });

  it("disconnects and verifies the resulting inventory", async () => {
    const removeAuth = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValue(inventory(false));
    const coordinator = createProviderAuthCoordinator(fakeClient({ removeAuth, list }));
    await coordinator.start();
    const connectedInventory = inventory(true);
    const connected = createProviderAuthCoordinator(
      fakeClient({
        ensureManagedAnthropicImport: vi.fn().mockResolvedValue(managedResult(connectedInventory)),
        removeAuth,
        list,
      }),
    );
    await connected.start();
    await connected.disconnectOpenAi();
    expect(removeAuth).toHaveBeenCalledWith("openai");
    expect(connected.getSnapshot().openAiConnected).toBe(false);
    coordinator.dispose();
  });

  it("ignores stale completion from a disposed coordinator", async () => {
    const pending = deferred<ManagedAnthropicImport>();
    const stale = createProviderAuthCoordinator(
      fakeClient({ ensureManagedAnthropicImport: vi.fn().mockReturnValue(pending.promise) }),
    );
    const oldStart = stale.start();
    stale.dispose();
    const fresh = createProviderAuthCoordinator(fakeClient());
    await fresh.start();
    pending.resolve(managedResult(inventory(true)));
    await oldStart;
    expect(fresh.getSnapshot().openAiConnected).toBe(false);
  });
});
