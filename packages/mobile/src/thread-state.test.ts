import type { Message, OpenCodeEvent, OpenCodeSessionInfo, Part } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import {
  applySessionEvent,
  eventSessionID,
  optimisticTurn,
  type SessionViewState,
} from "./thread-state";

const info: OpenCodeSessionInfo = {
  id: "ses_mobile",
  projectID: "project",
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
  time: { created: 100, updated: 200 },
  title: "Mobile session",
  location: { directory: "/workspace" },
  agent: "build",
  model: { id: "gpt-5", providerID: "openai" },
};

const message: Extract<Message, { role: "user" }> = {
  id: "msg_user",
  sessionID: info.id,
  role: "user",
  time: { created: 100 },
  agent: "build",
  model: { modelID: "gpt-5", providerID: "openai" },
};

const part: Extract<Part, { type: "text" }> = {
  id: "part_text",
  sessionID: info.id,
  messageID: message.id,
  type: "text",
  text: "A complete streamed answer",
  time: { start: 100 },
};

const state: SessionViewState = {
  info,
  messages: [message],
  parts: [part],
  running: true,
  questions: [],
  permissions: [],
};

describe("thread state", () => {
  it("does not regress streamed text when a stale part update arrives", () => {
    const event: OpenCodeEvent = {
      id: "evt_part",
      type: "message.part.updated",
      data: {
        sessionID: info.id,
        part: { ...part, text: "A complete" },
        time: 200,
      },
    };

    const next = applySessionEvent(state, event);
    expect(next.parts).toHaveLength(1);
    expect(next.parts[0]).toMatchObject({ text: part.text });
  });

  it("reconciles an optimistic message by id instead of appending a duplicate", () => {
    const updated = { ...message, time: { created: 125 } };
    const event: OpenCodeEvent = {
      id: "evt_message",
      type: "message.updated",
      data: { sessionID: info.id, info: updated },
    };

    const next = applySessionEvent(state, event);
    expect(next.messages).toEqual([updated]);
  });

  it("tracks session activity and extracts scoped session ids", () => {
    const event: OpenCodeEvent = {
      id: "evt_idle",
      type: "session.idle",
      data: { sessionID: info.id },
    };

    expect(eventSessionID(event)).toBe(info.id);
    expect(applySessionEvent(state, event).running).toBe(false);
  });

  it("builds optimistic text and typed image parts", () => {
    const turn = optimisticTurn(info, "msg_optimistic", "Inspect this", [
      {
        id: "image",
        uri: "file:///image.png",
        file: { name: "image.png", uri: "data:image/png;base64,AA==" },
      },
    ]);

    expect(turn.message).toMatchObject({ id: "msg_optimistic", role: "user" });
    expect(turn.parts).toMatchObject([
      { type: "text", text: "Inspect this" },
      { type: "file", mime: "image/png", filename: "image.png" },
    ]);
  });
});
