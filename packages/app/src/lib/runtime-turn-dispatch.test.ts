import {
  MessageId,
  ThreadId,
  TurnId,
  type AgentPreferences,
  type LocalApi,
  type MultiRuntimeApi,
  type MultiRuntimeHostSnapshot,
  type ThreadAgentRuntimeSendTurnInput,
} from "@multi/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetLocalApiForTests } from "../local-api";
import { createEmptyRuntimeHostSnapshot } from "./multi-runtime-api";
import {
  prepareRuntimeTurnPolicy,
  sendRuntimeTurn,
  sendRuntimeTurnWithPreparedPolicy,
} from "./runtime-turn-dispatch";

async function notCalled(): Promise<never> {
  throw new Error("Unexpected local API call.");
}

function createRuntimeApi(input: {
  snapshot: MultiRuntimeHostSnapshot;
  getPreferences?: () => Promise<AgentPreferences>;
  onSendTurn?: (turn: ThreadAgentRuntimeSendTurnInput) => void;
}): MultiRuntimeApi {
  return {
    getHostSnapshot: async () => input.snapshot,
    getPreferences: input.getPreferences ?? (async () => input.snapshot.preferences),
    updatePreferences: async () => input.snapshot.preferences,
    configureCredential: async () => input.snapshot,
    hydrateThread: async () => undefined,
    sendTurn: async (turn) => {
      input.onSendTurn?.(turn);
      return TurnId.make(`turn:${turn.threadId}`);
    },
    abort: async () => undefined,
    respondToExtensionUiRequest: async () => undefined,
    onHostEvent: () => () => undefined,
  };
}

function createLocalApi(runtime: MultiRuntimeApi): LocalApi {
  return {
    runtime,
    dialogs: {
      pickFolder: async () => null,
      confirm: async () => false,
    },
    shell: {
      openInEditor: async () => notCalled(),
      openExternal: async () => undefined,
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

describe("sendRuntimeTurn", () => {
  beforeEach(async () => {
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
        images: [],
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
      images: [],
    });

    expect(sentInputs).toEqual([
      expect.objectContaining({
        threadId: ThreadId.make("thread:runtime-host"),
        cwd: "/tmp",
        input: "hi",
        interactionMode: "agent",
        sourceProposedPlan: null,
        clientMessageId: MessageId.make("message:runtime-host"),
        images: [],
      }),
    ]);
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

    const preparedPolicy = prepareRuntimeTurnPolicy({ interactionMode: "agent" });
    expect(events).toEqual(["preferences"]);

    const sendPromise = sendRuntimeTurnWithPreparedPolicy({
      preparedPolicy,
      threadId: ThreadId.make("thread:prepared-policy"),
      cwd: "/tmp",
      text: "hi",
      interactionMode: "agent",
      sourceProposedPlan: null,
      clientMessageId: MessageId.make("message:prepared-policy"),
      images: [],
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
      }),
    ]);
  });
});
