import {
  MessageId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type AgentPreferences,
  type LocalApi,
  type HonkRuntimeApi,
  type HonkRuntimeHostSnapshot,
  type ThreadAgentRuntimeSendTurnInput,
} from "@honk/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetLocalApiForTests } from "../local-api";
import { createEmptyRuntimeHostSnapshot } from "./honk-runtime-api";
import {
  hydrateRuntimeThread,
  prepareRuntimeTurnPolicy,
  resetRuntimeThreadHydrationCache,
  sendRuntimeTurn,
  sendRuntimeTurnWithPreparedPolicy,
} from "./runtime-turn-dispatch";

async function notCalled(): Promise<never> {
  throw new Error("Unexpected local API call.");
}

function createRuntimeApi(input: {
  snapshot: HonkRuntimeHostSnapshot;
  getPreferences?: () => Promise<AgentPreferences>;
  onSendTurn?: (turn: ThreadAgentRuntimeSendTurnInput) => void;
}): HonkRuntimeApi {
  return {
    getHostSnapshot: async () => input.snapshot,
    getPreferences: input.getPreferences ?? (async () => input.snapshot.preferences),
    updatePreferences: async () => input.snapshot.preferences,
    configureCredential: async () => input.snapshot,
    hydrateThread: async () => undefined,
    setThreadFocus: async () => undefined,
    sendTurn: async (turn) => {
      input.onSendTurn?.(turn);
      return TurnId.make(`turn:${turn.threadId}`);
    },
    abort: async () => undefined,
    respondToExtensionUiRequest: async () => undefined,
    listSkills: async () => ({ skills: [] }),
    getThreadSessionFile: async () => ({ path: null }),
    onHostEvent: () => () => undefined,
  };
}

function createLocalApi(runtime: HonkRuntimeApi): LocalApi {
  return {
    runtime,
    dialogs: {
      pickFolder: async () => null,
      confirm: async () => false,
    },
    shell: {
      openInEditor: async () => notCalled(),
      openExternal: async () => undefined,
      showItemInFolder: async () => undefined,
    },
    contextMenu: {
      show: async () => null,
    },
    persistence: {
      getClientSettings: async () => null,
      setClientSettings: async () => undefined,
    },
    server: {
      getConfig: async () => notCalled(),
      upsertKeybinding: async () => notCalled(),
      getSettings: async () => notCalled(),
      updateSettings: async () => notCalled(),
    },
  };
}

const codexModelSelection = {
  instanceId: "codex",
  model: "gpt-5.5",
} as const;

const claudeModelSelection = {
  instanceId: "claudeAgent",
  model: "claude-opus-4-8",
} as const;

describe("hydrateRuntimeThread", () => {
  beforeEach(async () => {
    resetRuntimeThreadHydrationCache();
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    resetRuntimeThreadHydrationCache();
    vi.unstubAllGlobals();
    await __resetLocalApiForTests();
  });

  it("hydrates each runtime thread only once per session", async () => {
    let hydrateCount = 0;
    const runtime = createRuntimeApi({
      snapshot: createEmptyRuntimeHostSnapshot(),
    });
    runtime.hydrateThread = async () => {
      hydrateCount += 1;
    };
    vi.stubGlobal("window", { nativeApi: createLocalApi(runtime) });

    const threadId = ThreadId.make("thread:hydrate-once");
    await hydrateRuntimeThread({
      threadId,
      cwd: "/tmp",
      interactionMode: "agent",
      modelSelection: codexModelSelection,
    });
    await hydrateRuntimeThread({
      threadId,
      cwd: "/tmp",
      interactionMode: "agent",
      modelSelection: codexModelSelection,
    });

    expect(hydrateCount).toBe(1);
  });
});

describe("sendRuntimeTurn", () => {
  beforeEach(async () => {
    resetRuntimeThreadHydrationCache();
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await __resetLocalApiForTests();
  });

  it("rejects before sending when no runtime host is available", async () => {
    vi.stubGlobal("window", {});

    await expect(
      sendRuntimeTurn({
        threadId: ThreadId.make("thread:missing-runtime-host"),
        cwd: "/tmp",
        text: "hi",
        interactionMode: "agent",
        sourceProposedPlan: null,
        clientMessageId: MessageId.make("message:missing-runtime-host"),
        replacesClientMessageId: null,
        images: [],
        modelSelection: codexModelSelection,
      }),
    ).rejects.toThrow("Runtime host unavailable.");
  });

  it("sends through the exposed runtime host", async () => {
    const sentInputs: ThreadAgentRuntimeSendTurnInput[] = [];
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          onSendTurn: (turn) => {
            sentInputs.push(turn);
          },
        }),
      ),
    });

    await sendRuntimeTurn({
      threadId: ThreadId.make("thread:runtime-host"),
      cwd: "/tmp",
      text: "hi",
      interactionMode: "agent",
      sourceProposedPlan: null,
      clientMessageId: MessageId.make("message:runtime-host"),
      replacesClientMessageId: null,
      images: [],
      modelSelection: codexModelSelection,
    });

    expect(sentInputs).toEqual([
      expect.objectContaining({
        threadId: ThreadId.make("thread:runtime-host"),
        cwd: "/tmp",
        input: "hi",
        interactionMode: "agent",
        sourceProposedPlan: null,
        clientMessageId: MessageId.make("message:runtime-host"),
        replacesClientMessageId: null,
        images: [],
        policy: expect.objectContaining({
          modelSelection: expect.objectContaining({
            authProviderId: "openai-codex",
            modelId: "openai-codex/gpt-5.5",
          }),
        }),
      }),
    ]);
  });

  it("uses the pinned model selection even when preferences are Smart", async () => {
    const sentInputs: ThreadAgentRuntimeSendTurnInput[] = [];
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
      preferences: {
        ...createEmptyRuntimeHostSnapshot().preferences,
        agentMode: "smart" as const,
        thinkingLevel: "medium" as const,
      },
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          onSendTurn: (turn) => {
            sentInputs.push(turn);
          },
        }),
      ),
    });

    const preparedPolicy = prepareRuntimeTurnPolicy({
      interactionMode: "agent",
      modelSelection: codexModelSelection,
    });
    await sendRuntimeTurnWithPreparedPolicy({
      preparedPolicy,
      threadId: ThreadId.make("thread:smart-runtime-host"),
      cwd: "/tmp",
      text: "hi",
      interactionMode: "agent",
      sourceProposedPlan: null,
      clientMessageId: MessageId.make("message:smart-runtime-host"),
      replacesClientMessageId: null,
      images: [],
      modelSelection: codexModelSelection,
    });

    expect(sentInputs[0]?.policy.modelSelection).toMatchObject({
      authProviderId: "openai-codex",
      modelId: "openai-codex/gpt-5.5",
    });
  });

  it("prepares Anthropic turns from a pinned Claude model", async () => {
    const sentInputs: ThreadAgentRuntimeSendTurnInput[] = [];
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
      preferences: {
        ...createEmptyRuntimeHostSnapshot().preferences,
        agentMode: "deep" as const,
        thinkingLevel: "medium" as const,
      },
    };
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          onSendTurn: (turn) => {
            sentInputs.push(turn);
          },
        }),
      ),
    });

    const preparedPolicy = prepareRuntimeTurnPolicy({
      interactionMode: "agent",
      modelSelection: claudeModelSelection,
    });
    await sendRuntimeTurnWithPreparedPolicy({
      preparedPolicy,
      threadId: ThreadId.make("thread:claude-runtime-host"),
      cwd: "/tmp",
      text: "hi",
      interactionMode: "agent",
      sourceProposedPlan: null,
      clientMessageId: MessageId.make("message:claude-runtime-host"),
      replacesClientMessageId: null,
      images: [],
      modelSelection: claudeModelSelection,
    });

    expect(sentInputs[0]?.policy.modelSelection).toMatchObject({
      authProviderId: "anthropic",
      modelId: "anthropic/claude-opus-4-8",
    });
  });

  it("starts policy preparation before the later send", async () => {
    const events: string[] = [];
    const sentInputs: ThreadAgentRuntimeSendTurnInput[] = [];
    const snapshot = {
      ...createEmptyRuntimeHostSnapshot(),
      diagnostics: [],
    };
    let resolvePreferences: (preferences: AgentPreferences) => void = () => undefined;
    const preferences = new Promise<AgentPreferences>((resolve) => {
      resolvePreferences = resolve;
    });
    vi.stubGlobal("window", {
      nativeApi: createLocalApi(
        createRuntimeApi({
          snapshot,
          getPreferences: () => {
            events.push("preferences");
            return preferences;
          },
          onSendTurn: (turn) => {
            events.push("send");
            sentInputs.push(turn);
          },
        }),
      ),
    });

    const preparedPolicy = prepareRuntimeTurnPolicy({
      interactionMode: "agent",
      modelSelection: codexModelSelection,
    });
    expect(events).toEqual(["preferences"]);

    const sendPromise = sendRuntimeTurnWithPreparedPolicy({
      preparedPolicy,
      threadId: ThreadId.make("thread:prepared-policy"),
      cwd: "/tmp",
      text: "hi",
      interactionMode: "agent",
      sourceProposedPlan: null,
      clientMessageId: MessageId.make("message:prepared-policy"),
      replacesClientMessageId: MessageId.make("message:original"),
      parentEntryId: ThreadEntryId.make("message:parent"),
      images: [],
      modelSelection: codexModelSelection,
    });
    await Promise.resolve();
    expect(sentInputs).toEqual([]);

    resolvePreferences(snapshot.preferences);
    await sendPromise;

    expect(events).toEqual(["preferences", "send"]);
    expect(sentInputs).toEqual([
      expect.objectContaining({
        threadId: ThreadId.make("thread:prepared-policy"),
        input: "hi",
        parentEntryId: ThreadEntryId.make("message:parent"),
        replacesClientMessageId: MessageId.make("message:original"),
      }),
    ]);
  });
});
