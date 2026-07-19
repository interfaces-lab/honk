import { describe, expect, it } from "vitest";

import {
  buildTranscriptRows,
  groupMessagesIntoTurns,
  groupPartsByMessage,
  isSyntheticOnlyUserMessage,
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

  it("distinguishes internal user callbacks from visible user content", () => {
    const synthetic = part({
      id: "synthetic",
      messageID: "u1",
      type: "text",
      text: '<task state="completed">',
      synthetic: true,
    });

    expect(isSyntheticOnlyUserMessage([synthetic])).toBe(true);
    expect(
      isSyntheticOnlyUserMessage([
        synthetic,
        part({ id: "empty", messageID: "u1", type: "text", text: "" }),
      ]),
    ).toBe(false);
    expect(
      isSyntheticOnlyUserMessage([
        synthetic,
        part({ id: "file", messageID: "u1", type: "file", url: "file:///image.png" }),
      ]),
    ).toBe(false);
    expect(isSyntheticOnlyUserMessage([])).toBe(false);
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

  it("defers empty active reasoning to the waiting status until its first text delta", () => {
    const messages = [assistant("a1")];
    const emptyActive = part({
      id: "reasoning-empty",
      messageID: "a1",
      type: "reasoning",
      text: "",
      time: { start: 1 },
    });
    const streaming = part({
      id: "reasoning-streaming",
      messageID: "a1",
      type: "reasoning",
      text: "Weighing options",
      time: { start: 1 },
    });
    const completedEmpty = part({
      id: "reasoning-completed",
      messageID: "a1",
      type: "reasoning",
      text: "",
      time: { start: 1, end: 2 },
    });
    const turn = { key: "a1", user: null, assistants: messages };

    expect(turnHasVisibleActivity(turn, groupPartsByMessage([emptyActive]))).toBe(false);
    expect(segmentAssistantTurn(messages, groupPartsByMessage([emptyActive]))).toEqual([]);
    expect(turnHasVisibleActivity(turn, groupPartsByMessage([streaming]))).toBe(true);
    expect(segmentAssistantTurn(messages, groupPartsByMessage([streaming]))).toMatchObject([
      { kind: "reasoning", key: "reasoning-streaming" },
    ]);
    expect(segmentAssistantTurn(messages, groupPartsByMessage([completedEmpty]))).toEqual([]);
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

describe("buildTranscriptRows", () => {
  const userWithDiffs = (id: string): UserThreadMessage =>
    ({
      id,
      role: "user",
      summary: { diffs: [{ file: "a.ts", additions: 1, deletions: 0, status: "modified" }] },
    }) as unknown as UserThreadMessage;

  it("flattens turns into human, block, and diff rows with turn-scoped keys", () => {
    const turns = groupMessagesIntoTurns([userWithDiffs("u1"), assistant("a1"), user("u2")]);
    const grouped = groupPartsByMessage([
      part({ id: "up1", messageID: "u1", type: "text", text: "hello" }),
      part({ id: "t1", messageID: "a1", type: "text", text: "Starting" }),
      part({
        id: "w1",
        messageID: "a1",
        type: "tool",
        tool: "read",
        state: { status: "completed" },
      }),
      part({ id: "up2", messageID: "u2", type: "text", text: "next" }),
    ]);

    const rows = buildTranscriptRows(turns, grouped, {
      isThreadRunning: false,
      showDiffSummary: true,
    });
    expect(rows.map((row) => [row.kind, row.turnKey])).toEqual([
      ["human", "u1"],
      ["block", "u1"],
      ["block", "u1"],
      ["diff", "u1"],
      ["human", "u2"],
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("keeps row keys stable while the assistant turn streams and grows", () => {
    const turns = groupMessagesIntoTurns([user("u1"), assistant("a1")]);
    const before = buildTranscriptRows(
      turns,
      groupPartsByMessage([
        part({ id: "up1", messageID: "u1", type: "text", text: "hello" }),
        part({ id: "t1", messageID: "a1", type: "text", text: "Star" }),
        part({
          id: "w1",
          messageID: "a1",
          type: "tool",
          tool: "read",
          state: { status: "running" },
        }),
      ]),
      { isThreadRunning: true, showDiffSummary: true },
    );
    const after = buildTranscriptRows(
      turns,
      groupPartsByMessage([
        part({ id: "up1", messageID: "u1", type: "text", text: "hello" }),
        part({ id: "t1", messageID: "a1", type: "text", text: "Starting the work" }),
        part({
          id: "w1",
          messageID: "a1",
          type: "tool",
          tool: "read",
          state: { status: "completed" },
        }),
        part({
          id: "w2",
          messageID: "a1",
          type: "tool",
          tool: "bash",
          state: { status: "running" },
        }),
      ]),
      { isThreadRunning: true, showDiffSummary: true },
    );

    // Existing rows keep their keys; streaming only appends within blocks.
    expect(after.map((row) => row.key).slice(0, before.length)).toEqual(
      before.map((row) => row.key),
    );
  });

  it("skips synthetic-only human rows and hides the running last turn's diff row", () => {
    const turns = groupMessagesIntoTurns([userWithDiffs("u1"), assistant("a1")]);
    const grouped = groupPartsByMessage([
      part({ id: "up1", messageID: "u1", type: "text", text: "<done>", synthetic: true }),
      part({ id: "t1", messageID: "a1", type: "text", text: "Working" }),
    ]);

    const running = buildTranscriptRows(turns, grouped, {
      isThreadRunning: true,
      showDiffSummary: true,
    });
    expect(running.map((row) => row.kind)).toEqual(["block"]);

    const settled = buildTranscriptRows(turns, grouped, {
      isThreadRunning: false,
      showDiffSummary: true,
    });
    expect(settled.map((row) => row.kind)).toEqual(["block", "diff"]);

    const preview = buildTranscriptRows(turns, grouped, {
      isThreadRunning: false,
      showDiffSummary: false,
    });
    expect(preview.map((row) => row.kind)).toEqual(["block"]);
  });

  it("marks only the diff-free final human row as not requiring revert confirmation", () => {
    const turns = groupMessagesIntoTurns([userWithDiffs("u1"), assistant("a1"), user("u2")]);
    const grouped = groupPartsByMessage([
      part({ id: "up1", messageID: "u1", type: "text", text: "hello" }),
      part({ id: "up2", messageID: "u2", type: "text", text: "next" }),
    ]);

    const rows = buildTranscriptRows(turns, grouped, {
      isThreadRunning: false,
      showDiffSummary: true,
    });
    const humans = rows.filter((row) => row.kind === "human");
    expect(humans.map((row) => row.requiresRevertConfirmation)).toEqual([true, false]);
  });
});
