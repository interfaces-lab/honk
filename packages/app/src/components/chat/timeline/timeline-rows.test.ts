import { describe, expect, it } from "vitest";
import {
  computeStableMessagesTimelineRows,
  computeMessageDurationStart,
  deriveMessagesTimelineRows,
} from "./timeline-rows";

describe("computeMessageDurationStart", () => {
  it("returns message createdAt when there is no preceding user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:05Z",
        completedAt: "2026-01-01T00:00:10Z",
      },
    ]);
    expect(result).toEqual(new Map([["a1", "2026-01-01T00:00:05Z"]]));
  });

  it("uses the user message createdAt for the first assistant response", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("uses the previous assistant completedAt for subsequent assistant responses", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:30Z"],
      ]),
    );
  });

  it("does not advance the boundary for a streaming message without completedAt", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a1", role: "assistant", createdAt: "2026-01-01T00:00:30Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("resets the boundary on a new user message", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      { id: "u2", role: "user", createdAt: "2026-01-01T00:01:00Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:01:20Z",
        completedAt: "2026-01-01T00:01:20Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["u2", "2026-01-01T00:01:00Z"],
        ["a2", "2026-01-01T00:01:00Z"],
      ]),
    );
  });

  it("handles system messages without affecting the boundary", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s1", role: "system", createdAt: "2026-01-01T00:00:01Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["s1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("returns empty map for empty input", () => {
    expect(computeMessageDurationStart([])).toEqual(new Map());
  });
});

describe("deriveMessagesTimelineRows", () => {
  it("groups assistant rows without adding copy-button state", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Write a poem",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "I should ground this first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            completedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Here is the poem.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      editableUserMessageIds: new Set(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows).toHaveLength(2);
  });

  it("projects edit availability onto user rows", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Do the thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      editableUserMessageIds: new Set(["user-1" as never]),
    });

    const userRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );

    expect(userRow?.editAvailable).toBe(true);
  });
});

describe("computeStableMessagesTimelineRows", () => {
  it("returns the previous result when row order and content are unchanged", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      editableUserMessageIds: new Set(),
    });

    const initial = computeStableMessagesTimelineRows(rows, {
      byId: new Map(),
      result: [],
    });

    const repeated = computeStableMessagesTimelineRows(rows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result).toBe(initial.result);
  });

  it("returns a new result when row order changes without content changes", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      editableUserMessageIds: new Set(),
    });

    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const reordered = computeStableMessagesTimelineRows([firstRows[1]!, firstRows[0]!], initial);

    expect(reordered).not.toBe(initial);
    expect(reordered.result).toEqual([initial.result[1], initial.result[0]]);
  });
});
