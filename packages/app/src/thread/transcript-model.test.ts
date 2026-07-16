import { describe, expect, it } from "vitest";

import {
  groupMessagesIntoTurns,
  groupPartsByMessage,
  segmentAssistantTurn,
  turnHasVisibleActivity,
  turnDiffs,
  type AssistantThreadMessage,
  type ThreadPart,
  type UserThreadMessage,
} from "./transcript-model";

const user = (id: string): UserThreadMessage =>
  ({ id, role: "user" }) as unknown as UserThreadMessage;
const assistant = (id: string, error?: string): AssistantThreadMessage =>
  ({
    id,
    role: "assistant",
    ...(error === undefined ? {} : { error: { name: "ProviderError", data: { message: error } } }),
  }) as unknown as AssistantThreadMessage;
const part = (value: object): ThreadPart => value as unknown as ThreadPart;

describe("transcript projection", () => {
  it("groups leading assistants and user-led assistant turns", () => {
    const turns = groupMessagesIntoTurns([
      assistant("a0"),
      assistant("a1"),
      user("u1"),
      assistant("a2"),
      user("u2"),
    ]);

    expect(
      turns.map((turn) => [turn.user?.id ?? null, turn.assistants.map(({ id }) => id)]),
    ).toEqual([
      [null, ["a0", "a1"]],
      ["u1", ["a2"]],
      ["u2", []],
    ]);
  });

  it("preserves part order within each message", () => {
    const parts = [
      part({ id: "p1", messageID: "m1", type: "text", text: "one" }),
      part({ id: "p2", messageID: "m2", type: "text", text: "two" }),
      part({ id: "p3", messageID: "m1", type: "text", text: "three" }),
    ];
    expect(
      groupPartsByMessage(parts)
        .get("m1")
        ?.map(({ id }) => id),
    ).toEqual(["p1", "p3"]);
  });

  it("derives visible generation activity from the latest turn only", () => {
    const turns = groupMessagesIntoTurns([
      user("u1"),
      assistant("a1"),
      user("u2"),
      assistant("a2"),
    ]);
    const grouped = groupPartsByMessage([
      part({
        id: "stale-running-tool",
        messageID: "a1",
        type: "tool",
        tool: "bash",
        state: { status: "running" },
      }),
      part({
        id: "finished-current-tool",
        messageID: "a2",
        type: "tool",
        tool: "read",
        state: { status: "completed" },
      }),
    ]);

    expect(turnHasVisibleActivity(turns[0], grouped)).toBe(true);
    expect(turnHasVisibleActivity(turns[1], grouped)).toBe(false);
  });

  it("segments prose, work, notices, and message errors across assistant seams", () => {
    const messages = [assistant("a1"), assistant("a2", "quota exceeded")];
    const grouped = groupPartsByMessage([
      part({ id: "t1", messageID: "a1", type: "text", text: "Starting" }),
      part({ id: "r1", messageID: "a1", type: "reasoning", text: "Checking the code" }),
      part({
        id: "task1",
        messageID: "a1",
        type: "tool",
        tool: "task",
        state: { status: "completed" },
      }),
      part({
        id: "w1",
        messageID: "a1",
        type: "tool",
        tool: "read",
        state: { status: "completed" },
      }),
      part({ id: "w2", messageID: "a1", type: "patch", files: ["a.ts"] }),
      part({
        id: "todo",
        messageID: "a1",
        type: "tool",
        tool: "todowrite",
        state: { status: "completed" },
      }),
      part({ id: "n1", messageID: "a2", type: "retry", attempt: 1 }),
    ]);

    const blocks = segmentAssistantTurn(messages, grouped);
    expect(blocks.map(({ kind }) => kind)).toEqual([
      "prose",
      "reasoning",
      "task",
      "work",
      "notice",
      "error",
    ]);
    expect(blocks[3]?.kind === "work" ? blocks[3].parts.map(({ id }) => id) : []).toEqual([
      "w1",
      "w2",
    ]);
    expect(blocks.at(-1)).toMatchObject({ kind: "error", message: "quota exceeded" });
  });

  it("keeps the newest material diff for each path in display order", () => {
    const message = {
      id: "u1",
      role: "user",
      summary: {
        diffs: [
          { file: "a.ts", additions: 1, deletions: 0, status: "modified" },
          { file: "skip.ts", additions: 0, deletions: 0, status: "modified" },
          { file: "b.ts", additions: 0, deletions: 1, status: "deleted" },
          { file: "a.ts", additions: 3, deletions: 2, status: "modified" },
        ],
      },
    } as unknown as UserThreadMessage;

    expect(turnDiffs(message)).toMatchObject([
      { file: "b.ts", additions: 0, deletions: 1 },
      { file: "a.ts", additions: 3, deletions: 2 },
    ]);
  });
});
