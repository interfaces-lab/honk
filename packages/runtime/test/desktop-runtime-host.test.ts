import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  AccountId,
  AuthProviderId,
  DEFAULT_AGENT_POLICY_MODEL_SELECTION,
  DEFAULT_AGENT_RESOURCE_PREFERENCES,
  EventId,
  type AgentModelPolicy,
  type AgentRuntimeEvent,
  type HonkRuntimeHostEvent,
  MessageId,
  ModelId,
  RuntimeSessionId,
  type RuntimeDisplayTimelineProjection,
  ThreadId,
  TurnId,
} from "@honk/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { registerOAuthProvider, unregisterOAuthProvider } from "@earendil-works/pi-ai/oauth";
import { DesktopRuntimeHost } from "../src/desktop-runtime-host";
import { DesktopExtensionUiController } from "../src/extension-ui";
import type { ThreadAgentRuntime } from "../src/thread-agent-runtime";

describe("DesktopRuntimeHost", () => {
  const tempDirs: string[] = [];
  const testPolicy: AgentModelPolicy = {
    agentMode: "deep",
    interactionMode: "agent",
    modelSelection: { type: "pi-managed" },
    fast: false,
    thinkingLevel: "high",
    allowedToolNames: [],
    excludedToolNames: [],
  };

  afterEach(() => {
    vi.useRealTimers();
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
    const tempDir = mkdtempSync(join(tmpdir(), "honk-runtime-host-"));
    tempDirs.push(tempDir);
    return tempDir;
  }

  function createAgentDir(): string {
    return join(createTempDir(), "pi-agent");
  }

  function runtimeMapForTest(host: DesktopRuntimeHost): Map<
    string,
    {
      readonly runtime: ThreadAgentRuntime;
      readonly ui: DesktopExtensionUiController;
      readonly unsubscribe: () => void;
    }
  > {
    return (
      host as unknown as {
        readonly runtimes: Map<
          string,
          {
            readonly runtime: ThreadAgentRuntime;
            readonly ui: DesktopExtensionUiController;
            readonly unsubscribe: () => void;
          }
        >;
      }
    ).runtimes;
  }

  function displayTimelineMapForTest(
    host: DesktopRuntimeHost,
  ): Map<string, RuntimeDisplayTimelineProjection> {
    return (
      host as unknown as {
        readonly displayTimelines: Map<string, RuntimeDisplayTimelineProjection>;
      }
    ).displayTimelines;
  }

  function createRuntimeEvent(
    input: Pick<AgentRuntimeEvent, "type" | "threadId" | "runtimeSessionId"> &
      Partial<Omit<AgentRuntimeEvent, "type" | "threadId" | "runtimeSessionId">>,
  ): AgentRuntimeEvent {
    return {
      id: input.id ?? EventId.make(`runtime-event:${input.threadId}:${input.type}`),
      type: input.type,
      agentRuntime: "pi",
      threadId: input.threadId,
      runtimeSessionId: input.runtimeSessionId,
      createdAt: input.createdAt ?? "2026-06-12T12:00:00.000Z",
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.messageRole ? { messageRole: input.messageRole } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(input.thinking ? { thinking: input.thinking } : {}),
      ...(input.data !== undefined ? { data: input.data } : {}),
      ...(input.raw !== undefined ? { raw: input.raw } : {}),
    };
  }

  function emitRuntimeEventForTest(runtime: ThreadAgentRuntime, event: AgentRuntimeEvent): void {
    (
      runtime as unknown as {
        emit(event: AgentRuntimeEvent): void;
      }
    ).emit(event);
  }

  function schedulerForTest(host: DesktopRuntimeHost): {
    scheduleDisplayTimelineEmit(threadId: string): void;
  } {
    return host as unknown as {
      scheduleDisplayTimelineEmit(threadId: string): void;
    };
  }

  it("creates Pi auth storage under the Honk agent directory", async () => {
    const tempDir = createTempDir();
    const agentDir = join(tempDir, "pi-agent");

    const host = new DesktopRuntimeHost({ agentDir });
    const snapshot = await host.getHostSnapshot();

    expect(snapshot.preferences.agentMode).toBe("deep");
    expect(snapshot.preferences.thinkingLevel).toBe("high");
    expect(existsSync(join(agentDir, "auth.json"))).toBe(true);
    expect(snapshot.authStatuses.map((status) => status.authProviderId)).toEqual([
      "anthropic",
      "anthropic",
      "openai-codex",
      "openai",
      "cursor",
    ]);
    expect(snapshot.authStatuses.map((status) => status.credentialKind)).toEqual([
      "claude-api-key",
      "claude-oauth",
      "codex-oauth",
      "codex-api-key",
      "cursor-api-key",
    ]);
    expect(snapshot.authStatuses.slice(0, 4).every((status) => status.state === "missing")).toBe(
      true,
    );
    expect(snapshot.authStatuses[4]?.state).toBe(
      process.env.CURSOR_API_KEY ? "available" : "missing",
    );

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
    expect(anthropicStatus?.credentialKind).toBe("claude-api-key");
    expect(anthropicStatus?.message).toBe("Credential saved.");

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

  it("rejects Cursor OAuth credential configuration", async () => {
    const authStorage = AuthStorage.inMemory();
    const host = new DesktopRuntimeHost({ agentDir: createAgentDir(), authStorage });

    await expect(
      host.configureCredential({
        authProviderId: AuthProviderId.make("cursor"),
        method: "oauth",
        credentialKind: "cursor-api-key",
      }),
    ).rejects.toThrow("Cursor SDK authentication requires a Cursor API key");

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
        modelSelection: DEFAULT_AGENT_POLICY_MODEL_SELECTION,
        modelSettingsByModelId: {},
        fast: false,
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
              credentialKind: null,
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
        modelSelection: DEFAULT_AGENT_POLICY_MODEL_SELECTION,
        modelSettingsByModelId: {},
        fast: false,
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
          credentialKind: null,
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
        modelSelection: DEFAULT_AGENT_POLICY_MODEL_SELECTION,
        modelSettingsByModelId: {},
        fast: false,
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

  it("keeps same-cwd Honk threads in distinct Pi session directories", async () => {
    const tempDir = createTempDir();
    const agentDir = join(tempDir, "pi-agent");
    const firstThreadId = ThreadId.make("thread:same-cwd:first");
    const secondThreadId = ThreadId.make("thread:same-cwd:second");
    const host = new DesktopRuntimeHost({ agentDir });

    await host.hydrateThread({ threadId: firstThreadId, cwd: tempDir, policy: testPolicy });
    await host.hydrateThread({ threadId: secondThreadId, cwd: tempDir, policy: testPolicy });

    const sessionDirs = readdirSync(join(agentDir, "honk-thread-sessions"));
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

  it("sends continued turns on the existing runtime without applying a new provider policy", async () => {
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:pinned-provider-existing-runtime");
    const messageId = MessageId.make("message:pinned-provider-existing-runtime");
    const sentMessages: Array<{ text: string; interactionMode: string; clientMessageId: string }> =
      [];
    let disposed = false;
    let unsubscribed = false;
    const runtime = {
      threadId,
      identity: {
        agentRuntime: "pi",
        threadId,
        runtimeSessionId: "runtime-session:pinned-provider-existing-runtime",
        authProviderId: AuthProviderId.make("openai-codex"),
        modelId: ModelId.make("openai-codex/gpt-5.5"),
      },
      authStatus: null,
      sendMessage: async (
        text: string,
        options: { interactionMode: string; clientMessageId: string | null },
      ) => {
        sentMessages.push({
          text,
          interactionMode: options.interactionMode,
          clientMessageId: options.clientMessageId ?? "",
        });
        return TurnId.make("turn:pinned-provider-existing-runtime");
      },
      dispose: () => {
        disposed = true;
      },
    } as unknown as ThreadAgentRuntime;
    const host = new DesktopRuntimeHost({ agentDir: join(tempDir, "pi-agent") });
    runtimeMapForTest(host).set(threadId, {
      runtime,
      ui: new DesktopExtensionUiController(),
      unsubscribe: () => {
        unsubscribed = true;
      },
    });

    await host.sendTurn({
      threadId,
      cwd: tempDir,
      input: "continue",
      interactionMode: "agent",
      sourceProposedPlan: null,
      clientMessageId: messageId,
      images: [],
      policy: {
        ...testPolicy,
        modelSelection: {
          type: "explicit",
          authProviderId: AuthProviderId.make("anthropic"),
          accountId: AccountId.make("anthropic:default"),
          modelId: ModelId.make("anthropic/claude-opus-4-8"),
        },
      },
    });

    expect(sentMessages).toEqual([
      {
        text: "continue",
        interactionMode: "agent",
        clientMessageId: messageId,
      },
    ]);
    expect(disposed).toBe(false);
    expect(unsubscribed).toBe(false);

    host.dispose();
    expect(disposed).toBe(true);
    expect(unsubscribed).toBe(true);
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

  it("returns cached display timelines in host snapshots without reprojecting runtimes", async () => {
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:cached-display-timeline");
    const runtimeSessionId = RuntimeSessionId.make("runtime-session:cached-display-timeline");
    const cachedTimeline: RuntimeDisplayTimelineProjection = {
      threadId,
      runtimeSessionId,
      items: [],
    };
    let getSessionTreeCalls = 0;
    const runtime = {
      threadId,
      runtimeSessionId,
      identity: {
        agentRuntime: "pi",
        threadId,
        runtimeSessionId,
        authProviderId: AuthProviderId.make("openai-codex"),
        modelId: ModelId.make("openai-codex/gpt-5.5"),
      },
      authStatus: null,
      getSessionTree: () => {
        getSessionTreeCalls += 1;
        return {
          threadId,
          runtimeSessionId,
          entries: [],
        };
      },
      dispose: () => undefined,
    } as unknown as ThreadAgentRuntime;
    const host = new DesktopRuntimeHost({ agentDir: join(tempDir, "pi-agent") });
    runtimeMapForTest(host).set(threadId, {
      runtime,
      ui: new DesktopExtensionUiController(),
      unsubscribe: () => undefined,
    });
    displayTimelineMapForTest(host).set(threadId, cachedTimeline);

    const snapshot = await host.getHostSnapshot();

    expect(snapshot.displayTimelines).toEqual([cachedTimeline]);
    expect(getSessionTreeCalls).toBe(0);

    host.dispose();
  });

  it("emits trimmed message runtime events while preserving display timeline content", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:wire-trim-message");
    const turnId = TurnId.make("turn:wire-trim-message");
    const host = new DesktopRuntimeHost({
      agentDir: join(tempDir, "pi-agent"),
      bindExtensions: async (runtime) => {
        emitRuntimeEventForTest(
          runtime,
          createRuntimeEvent({
            type: "message.updated",
            threadId,
            runtimeSessionId: runtime.runtimeSessionId,
            turnId,
            messageRole: "assistant",
            text: "streamed assistant text",
            data: { largePayload: "drop me" },
          }),
        );
      },
    });
    await host.setThreadFocus({ threadId, focused: true });
    const hostEvents: HonkRuntimeHostEvent[] = [];
    const unsubscribe = host.onHostEvent((event) => {
      hostEvents.push(event);
    });

    await host.startThread({ threadId, cwd: tempDir, policy: testPolicy });
    await vi.advanceTimersByTimeAsync(16);

    const runtimeEvent = hostEvents.find(
      (event) => event.type === "runtime-event" && event.event.type === "message.updated",
    );
    const displayTimelineEvent = hostEvents.findLast(
      (event) => event.type === "display-timeline" && event.timeline.threadId === threadId,
    );
    expect(runtimeEvent).toMatchObject({
      type: "runtime-event",
      event: expect.objectContaining({
        type: "message.updated",
        text: "streamed assistant text",
      }),
    });
    expect(runtimeEvent?.type === "runtime-event" && "data" in runtimeEvent.event).toBe(false);
    expect(
      displayTimelineEvent?.type === "display-timeline" && displayTimelineEvent.timeline.items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          text: "streamed assistant text",
        }),
      ]),
    );

    unsubscribe();
    host.dispose();
  });

  it("keeps subagent tool runtime event data on the wire", async () => {
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:wire-subagent");
    const subagentData = {
      toolCallId: "toolu-subagent",
      toolName: "subagent",
      partialResult: { details: { activities: [{ id: "activity-1" }] } },
    };
    const host = new DesktopRuntimeHost({
      agentDir: join(tempDir, "pi-agent"),
      bindExtensions: async (runtime) => {
        emitRuntimeEventForTest(
          runtime,
          createRuntimeEvent({
            type: "tool.updated",
            threadId,
            runtimeSessionId: runtime.runtimeSessionId,
            data: subagentData,
          }),
        );
      },
    });
    const hostEvents: HonkRuntimeHostEvent[] = [];
    const unsubscribe = host.onHostEvent((event) => {
      hostEvents.push(event);
    });

    await host.startThread({ threadId, cwd: tempDir, policy: testPolicy });

    const runtimeEvent = hostEvents.find(
      (event) => event.type === "runtime-event" && event.event.type === "tool.updated",
    );
    expect(runtimeEvent?.type === "runtime-event" ? runtimeEvent.event.data : null).toBe(
      subagentData,
    );

    unsubscribe();
    host.dispose();
  });

  it("trims global snapshot runtime events without trimming display timeline inputs", async () => {
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:snapshot-wire-trim");
    const turnId = TurnId.make("turn:snapshot-wire-trim");
    const host = new DesktopRuntimeHost({
      agentDir: join(tempDir, "pi-agent"),
      bindExtensions: async (runtime) => {
        emitRuntimeEventForTest(
          runtime,
          createRuntimeEvent({
            type: "message.updated",
            threadId,
            runtimeSessionId: runtime.runtimeSessionId,
            turnId,
            messageRole: "assistant",
            text: "snapshot timeline text",
            data: { largePayload: "drop me" },
          }),
        );
      },
    });

    await host.startThread({ threadId, cwd: tempDir, policy: testPolicy });

    const snapshot = await host.getHostSnapshot();
    const messageEvent = snapshot.runtimeEvents.find((event) => event.type === "message.updated");
    const displayTimeline = snapshot.displayTimelines.find(
      (timeline) => timeline.threadId === threadId,
    );
    expect(messageEvent).toEqual(
      expect.objectContaining({
        type: "message.updated",
        text: "snapshot timeline text",
      }),
    );
    expect(messageEvent && "data" in messageEvent).toBe(false);
    expect(displayTimeline?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          text: "snapshot timeline text",
        }),
      ]),
    );

    host.dispose();
  });

  it("emits runtime identities instead of a full snapshot on successful thread start", async () => {
    const tempDir = createTempDir();
    const threadId = ThreadId.make("thread:start-runtime-identities");
    const host = new DesktopRuntimeHost({ agentDir: join(tempDir, "pi-agent") });
    const hostEvents: HonkRuntimeHostEvent[] = [];
    const unsubscribe = host.onHostEvent((event) => {
      hostEvents.push(event);
    });

    await host.startThread({ threadId, cwd: tempDir, policy: testPolicy });

    expect(hostEvents.some((event) => event.type === "snapshot")).toBe(false);
    expect(hostEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runtime-identities",
          identities: [
            expect.objectContaining({
              threadId,
            }),
          ],
        }),
      ]),
    );

    unsubscribe();
    host.dispose();
  });

  it("flushes display timelines at focused and background cadences", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));
    const tempDir = createTempDir();
    const host = new DesktopRuntimeHost({ agentDir: join(tempDir, "pi-agent") });
    const backgroundThreadId = ThreadId.make("thread:timeline-background");
    const focusedThreadId = ThreadId.make("thread:timeline-focused");
    const backgroundTimeline: RuntimeDisplayTimelineProjection = {
      threadId: backgroundThreadId,
      runtimeSessionId: RuntimeSessionId.make("runtime-session:timeline-background"),
      items: [],
    };
    const focusedTimeline: RuntimeDisplayTimelineProjection = {
      threadId: focusedThreadId,
      runtimeSessionId: RuntimeSessionId.make("runtime-session:timeline-focused"),
      items: [],
    };
    displayTimelineMapForTest(host).set(backgroundThreadId, backgroundTimeline);
    displayTimelineMapForTest(host).set(focusedThreadId, focusedTimeline);
    const displayEvents: RuntimeDisplayTimelineProjection[] = [];
    const unsubscribe = host.onHostEvent((event) => {
      if (event.type === "display-timeline") {
        displayEvents.push(event.timeline);
      }
    });

    schedulerForTest(host).scheduleDisplayTimelineEmit(backgroundThreadId);
    schedulerForTest(host).scheduleDisplayTimelineEmit(backgroundThreadId);
    await vi.advanceTimersByTimeAsync(249);
    expect(displayEvents).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(displayEvents).toEqual([backgroundTimeline]);

    await host.setThreadFocus({ threadId: focusedThreadId, focused: true });
    schedulerForTest(host).scheduleDisplayTimelineEmit(focusedThreadId);
    await vi.advanceTimersByTimeAsync(15);
    expect(displayEvents).toEqual([backgroundTimeline]);
    await vi.advanceTimersByTimeAsync(1);
    expect(displayEvents).toEqual([backgroundTimeline, focusedTimeline]);

    unsubscribe();
    host.dispose();
  });

  it("flushes a pending display timeline immediately when a thread becomes focused", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00.000Z"));
    const tempDir = createTempDir();
    const host = new DesktopRuntimeHost({ agentDir: join(tempDir, "pi-agent") });
    const threadId = ThreadId.make("thread:timeline-focus-immediate");
    const timeline: RuntimeDisplayTimelineProjection = {
      threadId,
      runtimeSessionId: RuntimeSessionId.make("runtime-session:timeline-focus-immediate"),
      items: [],
    };
    displayTimelineMapForTest(host).set(threadId, timeline);
    const displayEvents: RuntimeDisplayTimelineProjection[] = [];
    const unsubscribe = host.onHostEvent((event) => {
      if (event.type === "display-timeline") {
        displayEvents.push(event.timeline);
      }
    });

    schedulerForTest(host).scheduleDisplayTimelineEmit(threadId);
    await vi.advanceTimersByTimeAsync(100);
    expect(displayEvents).toEqual([]);

    await host.setThreadFocus({ threadId, focused: true });

    expect(displayEvents).toEqual([timeline]);

    unsubscribe();
    host.dispose();
  });
});
