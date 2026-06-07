import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthProviderId,
  DEFAULT_AGENT_RESOURCE_PREFERENCES,
  type AgentModelPolicy,
  MessageId,
  ThreadId,
} from "@multi/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { registerOAuthProvider, unregisterOAuthProvider } from "@earendil-works/pi-ai/oauth";
import { DesktopRuntimeHost } from "../src/desktop-runtime-host";

describe("DesktopRuntimeHost", () => {
  const tempDirs: string[] = [];
  const testPolicy: AgentModelPolicy = {
    agentMode: "deep",
    interactionMode: "agent",
    modelSelection: { type: "pi-managed" },
    thinkingLevel: "high",
    allowedToolNames: [],
    excludedToolNames: [],
  };

  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  function testOAuthProviderId(name: string) {
    return AuthProviderId.make(
      `test-oauth-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  }

  function createTempDir(): string {
    const tempDir = mkdtempSync(join(tmpdir(), "multi-runtime-host-"));
    tempDirs.push(tempDir);
    return tempDir;
  }

  function createAgentDir(): string {
    return join(createTempDir(), "pi-agent");
  }

  it("creates Pi auth storage under the Multi agent directory", async () => {
    const tempDir = createTempDir();
    const agentDir = join(tempDir, "pi-agent");

    const host = new DesktopRuntimeHost({ agentDir });
    const snapshot = await host.getHostSnapshot();

    expect(snapshot.preferences.agentMode).toBe("deep");
    expect(snapshot.preferences.thinkingLevel).toBe("high");
    expect(existsSync(join(agentDir, "auth.json"))).toBe(true);
    expect(snapshot.authStatuses.map((status) => status.authProviderId)).toEqual([
      "anthropic",
      "openai-codex",
      "openai",
      "xai",
    ]);
    expect(snapshot.authStatuses.every((status) => status.state === "missing")).toBe(true);

    host.dispose();
  });

  it("reports concrete Pi auth state from auth storage", async () => {
    const authStorage = AuthStorage.inMemory({
      anthropic: { type: "api_key", key: "test-key" },
    });
    const host = new DesktopRuntimeHost({ agentDir: createAgentDir(), authStorage });

    const snapshot = await host.getHostSnapshot();
    const anthropicStatus = snapshot.authStatuses.find(
      (status) => status.authProviderId === "anthropic",
    );

    expect(anthropicStatus?.state).toBe("available");
    expect(anthropicStatus?.message).toBe("Stored in Pi auth storage.");

    host.dispose();
  });

  it("configures API key credentials through the desktop runtime host", async () => {
    const authStorage = AuthStorage.inMemory();
    const host = new DesktopRuntimeHost({ agentDir: createAgentDir(), authStorage });

    const snapshot = await host.configureCredential({
      authProviderId: AuthProviderId.make("anthropic"),
      method: "api-key",
      apiKey: "test-key",
    });

    expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "test-key" });
    expect(
      snapshot.authStatuses.find((status) => status.authProviderId === "anthropic")?.state,
    ).toBe("available");

    host.dispose();
  });

  it("removes credentials through the desktop runtime host", async () => {
    const authStorage = AuthStorage.inMemory({
      anthropic: { type: "api_key", key: "test-key" },
    });
    const host = new DesktopRuntimeHost({ agentDir: createAgentDir(), authStorage });

    const snapshot = await host.configureCredential({
      authProviderId: AuthProviderId.make("anthropic"),
      method: "logout",
    });

    expect(authStorage.get("anthropic")).toBeUndefined();
    expect(
      snapshot.authStatuses.find((status) => status.authProviderId === "anthropic")?.state,
    ).toBe("missing");

    host.dispose();
  });

  it("publishes and clears OAuth credential flow state during login", async () => {
    const providerId = testOAuthProviderId("success");
    const authStorage = AuthStorage.inMemory();
    const host = new DesktopRuntimeHost({
      agentDir: createAgentDir(),
      authStorage,
      preferences: {
        agentMode: "smart",
        interactionMode: "agent",
        thinkingLevel: "medium",
        resources: DEFAULT_AGENT_RESOURCE_PREFERENCES,
        credentials: [
          {
            kind: "codex-oauth",
            label: "Test OAuth",
            authProviderId: providerId,
            accountId: null,
          },
        ],
      },
    });
    const flowEvents: unknown[] = [];
    const unsubscribe = host.onHostEvent((event) => {
      if (event.type === "credential-auth-flows") {
        flowEvents.push(event.flows);
      }
    });

    registerOAuthProvider({
      id: providerId,
      name: "Test OAuth",
      async login(callbacks) {
        callbacks.onAuth({
          url: "https://example.com/login",
          instructions: "Complete login in the browser.",
        });
        callbacks.onProgress?.("Waiting for token.");
        return {
          access: "access-token",
          refresh: "refresh-token",
          expires: Date.now() + 60_000,
        };
      },
      async refreshToken(credentials) {
        return credentials;
      },
      getApiKey(credentials) {
        return credentials.access;
      },
    });

    try {
      const snapshot = await host.configureCredential(
        {
          authProviderId: providerId,
          method: "oauth",
        },
        {
          onAuth: () => undefined,
          onDeviceCode: () => undefined,
          onPrompt: async () => "",
          onManualCodeInput: async () => "",
          onProgress: () => undefined,
          onSelect: async (prompt) => prompt.options[0]?.id,
        },
      );

      expect(authStorage.get(providerId)?.type).toBe("oauth");
      expect(snapshot.credentialAuthFlows).toEqual([]);
      expect(flowEvents).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({
              authProviderId: providerId,
              state: "pending",
              kind: "oauth-browser",
              verificationUri: "https://example.com/login",
            }),
          ]),
          expect.arrayContaining([
            expect.objectContaining({
              authProviderId: providerId,
              message: "Waiting for token.",
            }),
          ]),
          [],
        ]),
      );
    } finally {
      unsubscribe();
      unregisterOAuthProvider(providerId);
      host.dispose();
    }
  });

  it("preserves OAuth credential flow details when login fails", async () => {
    const providerId = testOAuthProviderId("error");
    const authStorage = AuthStorage.inMemory();
    const host = new DesktopRuntimeHost({
      agentDir: createAgentDir(),
      authStorage,
      preferences: {
        agentMode: "smart",
        interactionMode: "agent",
        thinkingLevel: "medium",
        resources: DEFAULT_AGENT_RESOURCE_PREFERENCES,
        credentials: [
          {
            kind: "codex-oauth",
            label: "Test OAuth",
            authProviderId: providerId,
            accountId: null,
          },
        ],
      },
    });

    registerOAuthProvider({
      id: providerId,
      name: "Test OAuth",
      async login(callbacks) {
        callbacks.onDeviceCode({
          verificationUri: "https://example.com/device",
          userCode: "ABCD-1234",
          expiresInSeconds: 600,
          intervalSeconds: 5,
        });
        throw new Error("Device login expired.");
      },
      async refreshToken(credentials) {
        return credentials;
      },
      getApiKey(credentials) {
        return credentials.access;
      },
    });

    try {
      await expect(
        host.configureCredential(
          {
            authProviderId: providerId,
            method: "oauth",
          },
          {
            onAuth: () => undefined,
            onDeviceCode: () => undefined,
            onPrompt: async () => "",
            onManualCodeInput: async () => "",
            onProgress: () => undefined,
            onSelect: async (prompt) => prompt.options[0]?.id,
          },
        ),
      ).rejects.toThrow("Device login expired.");

      const snapshot = await host.getHostSnapshot();
      expect(snapshot.credentialAuthFlows).toEqual([
        expect.objectContaining({
          authProviderId: providerId,
          state: "error",
          kind: "oauth-device-code",
          message: "Device login expired.",
          verificationUri: "https://example.com/device",
          userCode: "ABCD-1234",
        }),
      ]);
    } finally {
      unregisterOAuthProvider(providerId);
      host.dispose();
    }
  });

  it("passes the selected agent mode into new runtime policy", async () => {
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:agent-mode-policy");
    let observedAgentMode: string | null = null;
    let observedThinkingLevel: string | null = null;
    const host = new DesktopRuntimeHost({
      agentDir: join(tempDir, "pi-agent"),
      preferences: {
        agentMode: "deep",
        interactionMode: "debug",
        thinkingLevel: "high",
        resources: DEFAULT_AGENT_RESOURCE_PREFERENCES,
        credentials: [],
      },
      bindExtensions: async (runtime) => {
        observedAgentMode = runtime.policy.agentMode;
        observedThinkingLevel = runtime.policy.thinkingLevel;
      },
    });

    await host.startThread({ threadId, cwd: tempDir, policy: testPolicy });

    expect(observedAgentMode).toBe("deep");
    expect(observedThinkingLevel).toBe("high");

    host.dispose();
  });

  it("keeps same-cwd Multi threads in distinct Pi session directories", async () => {
    const tempDir = createTempDir();
    const agentDir = join(tempDir, "pi-agent");
    const firstThreadId = ThreadId.make("thread:same-cwd:first");
    const secondThreadId = ThreadId.make("thread:same-cwd:second");
    const host = new DesktopRuntimeHost({ agentDir });

    await host.hydrateThread({ threadId: firstThreadId, cwd: tempDir, policy: testPolicy });
    await host.hydrateThread({ threadId: secondThreadId, cwd: tempDir, policy: testPolicy });

    const sessionDirs = readdirSync(join(agentDir, "multi-thread-sessions"));
    expect(sessionDirs).toHaveLength(2);
    expect(new Set(sessionDirs).size).toBe(2);

    host.dispose();
  });

  it("cleans up a partially started session when extension binding fails", async () => {
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:broken-session");
    const host = new DesktopRuntimeHost({
      agentDir: join(tempDir, "pi-agent"),
      bindExtensions: async () => {
        throw new Error("bind failed");
      },
    });

    await expect(host.startThread({ threadId, cwd: tempDir, policy: testPolicy })).rejects.toThrow(
      "bind failed",
    );

    const snapshot = await host.getHostSnapshot();
    expect(snapshot.runtimeEvents.filter((event) => event.threadId === threadId)).toHaveLength(0);
    expect(snapshot.sessionTrees).toHaveLength(0);
    expect(snapshot.pendingExtensionUiRequests).toHaveLength(0);
    await expect(
      host.send({
        threadId,
        input: "still there?",
        interactionMode: "agent",
        sourceProposedPlan: null,
        clientMessageId: MessageId.make("message:after-failed-start"),
        images: [],
      }),
    ).rejects.toThrow("No runtime thread exists");

    host.dispose();
  });

  it("serializes same-thread starts without replacing an active session", async () => {
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:serialized-start");
    let bindCount = 0;
    let releaseFirstBind!: () => void;
    const firstBindReleased = new Promise<void>((resolve) => {
      releaseFirstBind = resolve;
    });
    let resolveFirstBindStarted!: () => void;
    const firstBindStarted = new Promise<void>((resolve) => {
      resolveFirstBindStarted = resolve;
    });
    const host = new DesktopRuntimeHost({
      agentDir: join(tempDir, "pi-agent"),
      bindExtensions: async (runtime) => {
        bindCount += 1;
        if (bindCount === 1) {
          runtime.setThinkingLevel("low");
          resolveFirstBindStarted();
          await firstBindReleased;
          return;
        }
        runtime.setThinkingLevel("medium");
      },
    });

    const firstStart = host.startThread({ threadId, cwd: tempDir, policy: testPolicy });
    await firstBindStarted;
    const secondStart = host.startThread({ threadId, cwd: tempDir, policy: testPolicy });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bindCount).toBe(1);
    releaseFirstBind();
    const firstIdentity = await firstStart;
    const secondIdentity = await secondStart;

    const snapshot = await host.getHostSnapshot();
    expect(bindCount).toBe(1);
    expect(secondIdentity).toEqual(firstIdentity);
    expect(snapshot.runtimeEvents.filter((event) => event.threadId === threadId)).toEqual([
      expect.objectContaining({ type: "thinking.changed", summary: "Thinking low" }),
    ]);

    host.dispose();
  });

  it("caps raw runtime events in host snapshots", async () => {
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:capped-runtime-events");
    let emitThinkingChange!: (index: number) => void;
    const host = new DesktopRuntimeHost({
      agentDir: join(tempDir, "pi-agent"),
      bindExtensions: async (runtime) => {
        emitThinkingChange = (index) => {
          runtime.setThinkingLevel(index % 2 === 0 ? "low" : "medium");
        };
      },
    });

    await host.startThread({ threadId, cwd: tempDir, policy: testPolicy });
    for (let index = 1; index <= 505; index += 1) {
      emitThinkingChange(index);
    }

    const snapshot = await host.getHostSnapshot();
    const runtimeEvents = snapshot.runtimeEvents.filter((event) => event.threadId === threadId);
    expect(runtimeEvents).toHaveLength(500);
    expect(runtimeEvents[0]?.summary).toBe("Thinking low");
    expect(runtimeEvents.at(-1)?.summary).toBe("Thinking medium");

    host.dispose();
  });
});
