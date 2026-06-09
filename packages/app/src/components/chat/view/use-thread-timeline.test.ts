import { MessageId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { TimelineEntry } from "../../../session-logic";
import { keepActiveTimelineTail } from "./use-thread-timeline";

const userId = MessageId.make("message:user");
const otherUserId = MessageId.make("message:user-2");

function messageEntry(id: MessageId): TimelineEntry {
  return {
    id: `message:${id}`,
    kind: "message",
    createdAt: "2026-06-05T16:00:00.000Z",
    message: {
      id,
      role: "user",
      text: "hi",
      createdAt: "2026-06-05T16:00:00.000Z",
      streaming: false,
    },
  } as unknown as TimelineEntry;
}

function workEntry(id: string): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: "2026-06-05T16:00:01.000Z",
    entry: {
      id,
      label: id,
      tone: "tool",
      status: "running",
      createdAt: "2026-06-05T16:00:01.000Z",
    },
  } as unknown as TimelineEntry;
}

function waitingEntry(): TimelineEntry {
  return {
    id: "working-indicator-row",
    kind: "waiting",
    createdAt: null,
    phase: "thinking",
    elapsedStartedAt: null,
  } as unknown as TimelineEntry;
}

describe("keepActiveTimelineTail", () => {
  it("carries the previous frame when an active turn momentarily drops the agent tail", () => {
    const previous = [messageEntry(userId), workEntry("work:1")];
    const next = [messageEntry(userId), waitingEntry()];
    expect(keepActiveTimelineTail(previous, next, true)).toBe(previous);
  });

  it("shows the next frame once the turn ends", () => {
    const previous = [messageEntry(userId), workEntry("work:1")];
    const next = [messageEntry(userId), waitingEntry()];
    expect(keepActiveTimelineTail(previous, next, false)).toBe(next);
  });

  it("shows the next frame when it still has an agent tail", () => {
    const previous = [messageEntry(userId), workEntry("work:1")];
    const next = [messageEntry(userId), workEntry("work:2")];
    expect(keepActiveTimelineTail(previous, next, true)).toBe(next);
  });

  it("does not carry when a new user message changes the prefix", () => {
    const previous = [messageEntry(userId), workEntry("work:1")];
    const next = [messageEntry(userId), messageEntry(otherUserId), waitingEntry()];
    expect(keepActiveTimelineTail(previous, next, true)).toBe(next);
  });

  it("does not carry before any agent activity exists", () => {
    const previous = [messageEntry(userId), waitingEntry()];
    const next = [messageEntry(userId), waitingEntry()];
    expect(keepActiveTimelineTail(previous, next, true)).toBe(next);
  });
});
