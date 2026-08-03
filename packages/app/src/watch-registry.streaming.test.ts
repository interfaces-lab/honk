import { openCodeSessionRef } from "@honk/opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createClient,
  createEventQueue,
  local,
  sessionInfo,
  waitUntil,
} from "./watch-registry.test-helpers";
import {
  getSessionWatchSnapshot,
  registerOpenCodeClient,
  subscribeSessionWatch,
  unregisterOpenCodeClient,
} from "./watch-registry";

afterEach(async () => {
  unregisterOpenCodeClient(local.key);
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("OpenCode persisted runner streaming", () => {
  it("replays server events that arrive during an authoritative snapshot load", async () => {
    let transcriptLoads = 0;
    const events = createEventQueue();
    const info = sessionInfo("ses_persisted_stream", "Persisted stream", "/local/repo");
    const userMessage = {
      id: "message-user",
      sessionID: info.id,
      role: "user" as const,
      time: { created: 10 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
    };
    const transcript = {
      info,
      messages: [userMessage],
      parts: [
        {
          id: "part-user",
          sessionID: info.id,
          messageID: userMessage.id,
          type: "text" as const,
          text: "Start a new worktree task",
        },
      ],
      sources: { persistedMessages: 1, projectedMessages: 0 },
    };
    let resolveTranscript = (_value: typeof transcript): void => undefined;
    const transcriptGate = new Promise<typeof transcript>((resolve) => {
      resolveTranscript = resolve;
    });
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        loadTranscript: async () => transcriptGate,
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => transcriptLoads === 1);

    const assistantMessage = {
      id: "message-assistant",
      sessionID: info.id,
      role: "assistant" as const,
      time: { created: 20 },
      parentID: userMessage.id,
      modelID: "gpt-5",
      providerID: "openai",
      mode: "build",
      agent: "build",
      path: { cwd: info.location.directory, root: info.location.directory },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    };
    events.push({
      id: "event-message",
      type: "message.updated",
      data: { sessionID: info.id, info: assistantMessage },
    });
    events.push({
      id: "event-reasoning",
      type: "message.part.updated",
      data: {
        sessionID: info.id,
        part: {
          id: "part-reasoning",
          sessionID: info.id,
          messageID: assistantMessage.id,
          type: "reasoning",
          text: "",
          time: { start: 21 },
        },
        time: 21,
      },
    });
    events.push({
      id: "event-reasoning-delta",
      type: "message.part.delta",
      data: {
        sessionID: info.id,
        messageID: assistantMessage.id,
        partID: "part-reasoning",
        field: "text",
        delta: "Inspecting the worktree",
      },
    });
    events.push({
      id: "event-tool",
      type: "message.part.updated",
      data: {
        sessionID: info.id,
        part: {
          id: "part-tool",
          sessionID: info.id,
          messageID: assistantMessage.id,
          type: "tool",
          callID: "call-tool",
          tool: "bash",
          state: {
            status: "running",
            input: { command: "git status --short" },
            title: "Checking the worktree",
            metadata: {},
            time: { start: 22 },
          },
        },
        time: 22,
      },
    });

    resolveTranscript(transcript);
    await waitUntil(() => getSessionWatchSnapshot(ref).state?.app.parts.length === 3);
    expect(getSessionWatchSnapshot(ref).state?.app.messages).toHaveLength(2);
    // The streamed assistant message keeps the debug counters in step with the
    // rendered transcript instead of the last full fetch.
    expect(getSessionWatchSnapshot(ref).state?.app.transcriptSources).toMatchObject({
      persistedMessages: 2,
      projectedMessages: 0,
    });
    expect(getSessionWatchSnapshot(ref).state?.app.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "part-reasoning",
          type: "reasoning",
          text: "Inspecting the worktree",
        }),
        expect.objectContaining({
          id: "part-tool",
          type: "tool",
          state: expect.objectContaining({ status: "running" }),
        }),
      ]),
    );
    expect(transcriptLoads).toBe(1);
    unsubscribe();
  });
});
