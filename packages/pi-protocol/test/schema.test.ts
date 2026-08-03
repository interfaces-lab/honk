import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";

import {
  PROTOCOL_VERSION,
  SessionSnapshotSchema,
  TranscriptItemSchema,
  UPSTREAM_VERSION,
  type UserTranscriptItem,
} from "../src/schema";

const userItem: UserTranscriptItem = {
  id: "item-1",
  role: "user",
  content: [{ type: "text", text: "Say hello" }],
  timestamp: 1700000000000,
};

const assistantItem = {
  id: "item-2",
  role: "assistant",
  content: [{ type: "text", text: "Hello from faux" }],
  model: { provider: "faux", id: "faux-model" },
  status: "complete",
  stopReason: "stop",
  timestamp: 1700000000001,
};

describe("vendored pi-protocol schemas", () => {
  it("tracks the upstream 0.83.0 line and protocol version 2", () => {
    expect(UPSTREAM_VERSION).toBe("0.83.0");
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it("accepts well-formed transcript items", () => {
    expect(Value.Check(TranscriptItemSchema, userItem)).toBe(true);
    expect(Value.Check(TranscriptItemSchema, assistantItem)).toBe(true);
  });

  it("rejects malformed transcript items", () => {
    expect(Value.Check(TranscriptItemSchema, { ...userItem, role: "system" })).toBe(false);
    expect(Value.Check(TranscriptItemSchema, { ...assistantItem, status: "done" })).toBe(false);
    expect(Value.Check(TranscriptItemSchema, { ...userItem, id: "" })).toBe(false);
  });

  it("accepts a session snapshot wrapping a transcript", () => {
    const snapshot = {
      id: "session-1",
      cwd: "/workspace",
      createdAt: 1700000000000,
      updatedAt: 1700000000002,
      phase: "idle",
      model: { provider: "faux", id: "faux-model" },
      thinkingLevel: "off",
      attached: true,
      locked: false,
      revision: 3,
      transcript: [userItem, assistantItem],
      queuedSteer: [],
      queuedSteerCount: 0,
    };
    expect(Value.Check(SessionSnapshotSchema, snapshot)).toBe(true);
    expect(Value.Check(SessionSnapshotSchema, { ...snapshot, phase: "sleeping" })).toBe(false);
  });
});
