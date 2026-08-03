import type {
  OpenCodeClient,
  OpenCodeProviderApi,
  OpenCodeProviderAuthMethod,
  OpenCodeProviderInventory,
} from "@honk/opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProviderAuthCoordinator,
  isProviderAuthPromptVisible,
  nextProviderAuthPromptIndex,
} from "./provider-auth";

const conditionalMethod = {
  id: "browser",
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
} satisfies OpenCodeProviderAuthMethod;

function inventory(openAiConnected: boolean, openCodeConnected = false): OpenCodeProviderInventory {
  return [
    {
      id: "openai",
      name: "OpenAI",
      methods: [conditionalMethod, { type: "key", label: "API key" }],
      connections: openAiConnected
        ? [{ type: "credential", id: "cred_openai", label: "Codex" }]
        : [],
    },
    {
      id: "opencode",
      name: "OpenCode",
      methods: [{ type: "key", label: "API key" }],
      connections: openCodeConnected
        ? [{ type: "credential", id: "cred_opencode", label: "OpenCode" }]
        : [],
    },
  ];
}

function fakeClient(overrides: Partial<OpenCodeProviderApi> = {}): OpenCodeClient {
  const providers: OpenCodeProviderApi = {
    list: vi.fn().mockResolvedValue(inventory(false)),
    connectOauth: vi.fn().mockResolvedValue({
      attemptID: "attempt_1",
      url: "https://auth.example.test",
      mode: "code",
      instructions: "Paste the code",
      time: { created: 1, expires: 2 },
    }),
    oauthStatus: vi.fn().mockResolvedValue({
      status: "complete",
      time: { created: 1, expires: 2 },
    }),
    completeOauth: vi.fn().mockResolvedValue(undefined),
    cancelOauth: vi.fn().mockResolvedValue(undefined),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    removeCredential: vi.fn().mockResolvedValue(undefined),
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
  it("skips prompts whose conditions do not match", () => {
    expect(isProviderAuthPromptVisible(conditionalMethod.prompts[1]!, {})).toBe(false);
    expect(nextProviderAuthPromptIndex(conditionalMethod, 1, { account: "team" })).toBe(1);
    expect(nextProviderAuthPromptIndex(conditionalMethod, 2, { account: "team" })).toBeNull();
    expect(nextProviderAuthPromptIndex(conditionalMethod, 1, { account: "personal" })).toBe(2);
  });
});

describe("provider auth coordinator", () => {
  it("deduplicates concurrent inventory refreshes", async () => {
    const pending = deferred<OpenCodeProviderInventory>();
    const list = vi.fn().mockReturnValue(pending.promise);
    const coordinator = createProviderAuthCoordinator(fakeClient({ list }));
    const first = coordinator.start();
    const second = coordinator.refresh();
    expect(first).toBe(second);
    pending.resolve(inventory(false));
    await first;
    expect(list).toHaveBeenCalledOnce();
  });

  it("passes prompt inputs and the V2 method ID into an OAuth attempt", async () => {
    const connectOauth = vi.fn().mockResolvedValue({
      attemptID: "attempt_1",
      url: "https://auth.example.test",
      mode: "code",
      instructions: "Paste the code",
      time: { created: 1, expires: 2 },
    });
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const coordinator = createProviderAuthCoordinator(fakeClient({ connectOauth }), openUrl);
    await coordinator.startOpenAi();
    await coordinator.chooseOpenAiMethod("browser");
    await coordinator.submitOpenAiPrompt("team");
    await coordinator.submitOpenAiPrompt("acme");
    expect(connectOauth).toHaveBeenCalledWith("openai", "browser", {
      account: "team",
      organization: "acme",
    });
    expect(openUrl).toHaveBeenCalledWith("https://auth.example.test");
  });

  it("completes code OAuth by attempt ID", async () => {
    const completeOauth = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValueOnce(inventory(false)).mockResolvedValue(inventory(true));
    const coordinator = createProviderAuthCoordinator(
      fakeClient({ completeOauth, list }),
      vi.fn().mockResolvedValue(undefined),
    );
    await coordinator.startOpenAi();
    await coordinator.chooseOpenAiMethod("browser");
    await coordinator.submitOpenAiPrompt("team");
    await coordinator.submitOpenAiPrompt("acme");
    await coordinator.submitOpenAiCode("  callback-code  ");
    expect(completeOauth).toHaveBeenCalledWith("attempt_1", "callback-code");
    expect(coordinator.getSnapshot().openAiConnected).toBe(true);
  });

  it("stores keys against the V2 integration IDs", async () => {
    const setApiKey = vi.fn().mockResolvedValue(undefined);
    const list = vi
      .fn()
      .mockResolvedValueOnce(inventory(false))
      .mockResolvedValueOnce(inventory(true))
      .mockResolvedValueOnce(inventory(true))
      .mockResolvedValue(inventory(true, true));
    const coordinator = createProviderAuthCoordinator(fakeClient({ setApiKey, list }));
    await coordinator.startOpenAi();
    await coordinator.chooseOpenAiMethod("key");
    await coordinator.submitOpenAiApiKey("  openai-secret  ");
    await coordinator.startOpenCodeGo();
    await coordinator.submitOpenCodeGoApiKey("  opencode-secret  ");
    expect(setApiKey).toHaveBeenNthCalledWith(1, "openai", "openai-secret");
    expect(setApiKey).toHaveBeenNthCalledWith(2, "opencode", "opencode-secret");
  });

  it("populates claudeConnected from the injected probe and re-reads on refresh", async () => {
    const readClaudeConnected = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const coordinator = createProviderAuthCoordinator(
      fakeClient(),
      vi.fn().mockResolvedValue(undefined),
      readClaudeConnected,
    );
    await coordinator.start();
    expect(coordinator.getSnapshot().claudeConnected).toBe(false);
    await coordinator.refresh();
    expect(coordinator.getSnapshot().claudeConnected).toBe(true);
  });

  it("re-probes only claude on refreshClaude, leaving phase and inventory alone", async () => {
    const list = vi.fn().mockResolvedValue(inventory(false));
    const readClaudeConnected = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const coordinator = createProviderAuthCoordinator(
      fakeClient({ list }),
      vi.fn().mockResolvedValue(undefined),
      readClaudeConnected,
    );
    await coordinator.start();
    expect(coordinator.getSnapshot().claudeConnected).toBe(false);
    await coordinator.refreshClaude();
    expect(coordinator.getSnapshot().claudeConnected).toBe(true);
    expect(coordinator.getSnapshot().phase).toBe("ready");
    expect(list).toHaveBeenCalledOnce();
  });

  it("keeps claudeConnected null when the probe rejects", async () => {
    const coordinator = createProviderAuthCoordinator(
      fakeClient(),
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockRejectedValue(new Error("bridge gone")),
    );
    await coordinator.start();
    expect(coordinator.getSnapshot().phase).toBe("ready");
    expect(coordinator.getSnapshot().claudeConnected).toBeNull();
  });

  it("publishes the claude probe even when the inventory fetch fails", async () => {
    const list = vi.fn().mockRejectedValue(new Error("sidecar not ready"));
    const coordinator = createProviderAuthCoordinator(
      fakeClient({ list }),
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(true),
    );
    await coordinator.start();
    expect(coordinator.getSnapshot().claudeConnected).toBe(true);
    expect(coordinator.getSnapshot().phase).toBe("ready");
    expect(coordinator.getSnapshot().errorMessage).toBe("sidecar not ready");
  });

  it("removes the V2 credential exposed by the integration", async () => {
    const removeCredential = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockResolvedValueOnce(inventory(true)).mockResolvedValue(inventory(false));
    const coordinator = createProviderAuthCoordinator(fakeClient({ removeCredential, list }));
    await coordinator.start();
    await coordinator.disconnectOpenAi();
    expect(removeCredential).toHaveBeenCalledWith("cred_openai");
    expect(coordinator.getSnapshot().openAiConnected).toBe(false);
  });
});

describe("default claude probe", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the desktop bridge status into claudeConnected", async () => {
    vi.stubGlobal("window", {
      desktopBridge: { getClaudeAuthStatus: vi.fn().mockResolvedValue("connected") },
    });
    const coordinator = createProviderAuthCoordinator(fakeClient());
    await coordinator.start();
    expect(coordinator.getSnapshot().claudeConnected).toBe(true);
  });

  it("treats an unknown probe result and a missing bridge as null", async () => {
    vi.stubGlobal("window", {
      desktopBridge: { getClaudeAuthStatus: vi.fn().mockResolvedValue("unknown") },
    });
    const unknown = createProviderAuthCoordinator(fakeClient());
    await unknown.start();
    expect(unknown.getSnapshot().claudeConnected).toBeNull();

    vi.stubGlobal("window", {});
    const web = createProviderAuthCoordinator(fakeClient());
    await web.start();
    expect(web.getSnapshot().claudeConnected).toBeNull();
  });
});
