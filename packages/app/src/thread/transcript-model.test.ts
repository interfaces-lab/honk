import { describe, expect, it } from "vitest";

import { gitAgentActionMetadata } from "../lib/git-agent-actions";
import {
  buildTranscriptRows,
  gitAgentActionForParts,
  groupMessagesIntoTurns,
  groupPartsByMessage,
  hasVisibleUserMessage,
  segmentAssistantTurn,
  transcriptPartsWithoutQuestions,
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

  it("keeps questions out of assistant turns", () => {
    const question = part({
      id: "question-part",
      messageID: "a1",
      callID: "call-question",
      type: "tool",
      tool: "question",
      state: { status: "running" },
    });
    const read = part({
      id: "read-part",
      messageID: "a1",
      callID: "call-read",
      type: "tool",
      tool: "read",
      state: { status: "completed" },
    });
    const answeredQuestion = part({
      id: "answered-question-part",
      messageID: "a0",
      callID: "call-answered-question",
      type: "tool",
      tool: "question",
      state: { status: "completed" },
    });
    expect(transcriptPartsWithoutQuestions([answeredQuestion, question, read])).toEqual([read]);
  });

  it("renders user text and files but not synthetic or empty parts", () => {
    const synthetic = part({
      id: "synthetic",
      messageID: "u1",
      type: "text",
      text: '<task state="completed">',
      synthetic: true,
    });

    expect(hasVisibleUserMessage([synthetic])).toBe(false);
    expect(
      hasVisibleUserMessage([
        synthetic,
        part({ id: "empty", messageID: "u1", type: "text", text: "" }),
      ]),
    ).toBe(false);
    expect(
      hasVisibleUserMessage([
        synthetic,
        part({ id: "file", messageID: "u1", type: "file", url: "file:///image.png" }),
      ]),
    ).toBe(true);
    expect(
      hasVisibleUserMessage([
        synthetic,
        part({ id: "text", messageID: "u1", type: "text", text: "Visible prompt" }),
      ]),
    ).toBe(true);
    expect(hasVisibleUserMessage([])).toBe(false);
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
    // The patch part is a server snapshot, not a step: it never joins the work block.
    expect(blocks[3]?.kind === "work" ? blocks[3].parts.map(({ id }) => id) : []).toEqual(["w1"]);
    expect(blocks.at(-1)).toMatchObject({ kind: "error", message: "quota exceeded" });
  });

  it("resolves the git action from the first tagged text part, ignoring other parts", () => {
    expect(
      gitAgentActionForParts([
        part({ id: "f", messageID: "u1", type: "file", url: "file:///a.png" }),
        part({
          id: "t",
          messageID: "u1",
          type: "text",
          text: "Commit & Push",
          metadata: gitAgentActionMetadata("commitAndPush"),
        }),
      ]),
    ).toBe("commitAndPush");
  });

  it("returns null when no text part carries git-action metadata", () => {
    expect(
      gitAgentActionForParts([
        part({ id: "t1", messageID: "u1", type: "text", text: "hello" }),
        part({ id: "t2", messageID: "u1", type: "text", text: "world", metadata: { other: 1 } }),
      ]),
    ).toBeNull();
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
        tool: "edit",
        state: { status: "completed", input: { filePath: "/repo/a.ts" } },
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

  it("keeps work-block keys stable when part ids change across transcript planes", () => {
    const turns = groupMessagesIntoTurns([user("u1"), assistant("a1")]);
    const rowsFor = (partID: string) =>
      buildTranscriptRows(
        turns,
        groupPartsByMessage([
          part({ id: "up1", messageID: "u1", type: "text", text: "go" }),
          part({
            id: partID,
            messageID: "a1",
            type: "tool",
            tool: "read",
            state: { status: "completed" },
          }),
        ]),
        { isThreadRunning: false, showDiffSummary: false },
      );
    const workKey = (rows: ReturnType<typeof rowsFor>) =>
      rows.find((row) => row.kind === "block" && row.block.kind === "work")?.key;

    // A refetch swaps projected part ids for persisted ones; the disclosure
    // state keyed off this row must survive the swap.
    expect(workKey(rowsFor("prt_persisted"))).toBe(workKey(rowsFor("a1:tool:0")));
  });

  it("suppresses turn diffs the turn's own tools could not have produced", () => {
    const turns = groupMessagesIntoTurns([userWithDiffs("u1"), assistant("a1")]);
    const rowKinds = (parts: readonly ThreadPart[]) =>
      buildTranscriptRows(turns, groupPartsByMessage(parts), {
        isThreadRunning: false,
        showDiffSummary: true,
      }).map((row) => row.kind);
    const prompt = part({ id: "up1", messageID: "u1", type: "text", text: "look around" });

    // Read-only turns inherit dirty-tree diffs from concurrent sessions.
    expect(
      rowKinds([
        prompt,
        part({
          id: "w1",
          messageID: "a1",
          type: "tool",
          tool: "grep",
          state: { status: "completed" },
        }),
      ]),
    ).toEqual(["human", "block"]);

    // An edit naming a different file cannot explain the diff either.
    expect(
      rowKinds([
        prompt,
        part({
          id: "w1",
          messageID: "a1",
          type: "tool",
          tool: "edit",
          state: { status: "completed", input: { filePath: "/repo/other.ts" } },
        }),
      ]),
    ).toEqual(["human", "block"]);

    // An edit naming the file claims the diff, absolute path against the
    // repo-relative diff path included.
    expect(
      rowKinds([
        prompt,
        part({
          id: "w1",
          messageID: "a1",
          type: "tool",
          tool: "edit",
          state: { status: "completed", input: { filePath: "/repo/a.ts" } },
        }),
      ]),
    ).toEqual(["human", "block", "diff"]);

    // Shell and delegated work can touch anything, so their turns keep diffs.
    expect(
      rowKinds([
        prompt,
        part({
          id: "w1",
          messageID: "a1",
          type: "tool",
          tool: "bash",
          state: { status: "completed" },
        }),
      ]),
    ).toEqual(["human", "block", "diff"]);
  });

  it("skips synthetic-only human rows and hides the running last turn's diff row", () => {
    const turns = groupMessagesIntoTurns([userWithDiffs("u1"), assistant("a1")]);
    const grouped = groupPartsByMessage([
      part({ id: "up1", messageID: "u1", type: "text", text: "<done>", synthetic: true }),
      part({ id: "t1", messageID: "a1", type: "text", text: "Working" }),
      part({
        id: "w1",
        messageID: "a1",
        type: "tool",
        tool: "edit",
        state: { status: "completed", input: { filePath: "/repo/a.ts" } },
      }),
    ]);

    const running = buildTranscriptRows(turns, grouped, {
      isThreadRunning: true,
      showDiffSummary: true,
    });
    expect(running.map((row) => row.kind)).toEqual(["block", "block"]);

    const settled = buildTranscriptRows(turns, grouped, {
      isThreadRunning: false,
      showDiffSummary: true,
    });
    expect(settled.map((row) => row.kind)).toEqual(["block", "block", "diff"]);

    const preview = buildTranscriptRows(turns, grouped, {
      isThreadRunning: false,
      showDiffSummary: false,
    });
    expect(preview.map((row) => row.kind)).toEqual(["block", "block"]);
  });

  it("keeps a synthetic plan execution as a human row with the live plan todo summary", () => {
    const turns = groupMessagesIntoTurns([user("build-user"), assistant("builder")]);
    const grouped = groupPartsByMessage([
      part({
        id: "execution",
        messageID: "build-user",
        type: "text",
        text: "Implement the attached plan.",
        synthetic: true,
        metadata: {
          honkPlanExecution: {
            planKey: "plan-1",
            planTitle: "Tracker parity",
            assignedSteps: [
              { id: "step-1", title: "Inspect" },
              { id: "step-2", title: "Build" },
            ],
          },
        },
      }),
      part({
        id: "todos",
        messageID: "builder",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { id: "step-1", content: "Inspect", status: "completed" },
              { id: "step-2", content: "Build", status: "in_progress" },
            ],
          },
          metadata: {},
        },
      }),
    ]);

    const row = buildTranscriptRows(turns, grouped, {
      isThreadRunning: true,
      showDiffSummary: true,
    }).find((candidate) => candidate.kind === "human");

    expect(row).toMatchObject({
      kind: "human",
      todoSummary: {
        kind: "plan",
        planKey: "plan-1",
        messageID: "build-user",
        title: "Tracker parity",
        isActive: true,
        canRestoreCheckpoint: false,
        tasks: [
          { id: "step-1", status: "completed" },
          { id: "step-2", status: "in_progress" },
        ],
      },
    });
  });

  it("keeps a synthetic queued-tasks start as a human row without first-write todo adjacency", () => {
    const turns = groupMessagesIntoTurns([user("queued-user"), assistant("queued-root")]);
    const grouped = groupPartsByMessage([
      part({
        id: "queued-start",
        messageID: "queued-user",
        type: "text",
        text: "Start the queued tasks.",
        synthetic: true,
        metadata: {
          honkQueuedTasks: {
            version: 1,
            reason: "queue",
            queueItemIDs: ["queue-1", "queue-2"],
          },
        },
      }),
      part({
        id: "todos",
        messageID: "queued-root",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { content: "Inspect", status: "completed" },
              { content: "Build", status: "in_progress" },
            ],
          },
          metadata: {},
        },
      }),
    ]);

    const human = buildTranscriptRows(turns, grouped, {
      isThreadRunning: true,
      showDiffSummary: true,
    }).find((row) => row.kind === "human");

    expect(human).toMatchObject({
      kind: "human",
      turnKey: "queued-user",
    });
    expect(human?.kind === "human" ? human.todoSummary : undefined).toBeUndefined();
  });

  it("still renders a session persisted under the legacy multitask start key", () => {
    const turns = groupMessagesIntoTurns([user("legacy-user"), assistant("legacy-root")]);
    const grouped = groupPartsByMessage([
      part({
        id: "legacy-start",
        messageID: "legacy-user",
        type: "text",
        text: "Start multitasking.",
        synthetic: true,
        metadata: {
          honkMultitaskStart: {
            version: 1,
            reason: "queue",
            queueItemIDs: ["queue-1"],
          },
        },
      }),
    ]);

    const human = buildTranscriptRows(turns, grouped, {
      isThreadRunning: false,
      showDiffSummary: true,
    }).find((row) => row.kind === "human");

    expect(human).toMatchObject({ kind: "human", turnKey: "legacy-user" });
    expect(human?.kind === "human" ? human.todoSummary : undefined).toBeUndefined();
  });

  it("does not expose a historical plan stop action while a later turn is running", () => {
    const turns = groupMessagesIntoTurns([
      user("build-user"),
      assistant("builder"),
      user("later-user"),
      assistant("later-assistant"),
    ]);
    const grouped = groupPartsByMessage([
      part({
        id: "execution",
        messageID: "build-user",
        type: "text",
        text: "Implement the attached plan.",
        synthetic: true,
        metadata: {
          honkPlanExecution: {
            planKey: "plan-1",
            planTitle: "Tracker parity",
            assignedSteps: [{ id: "step-1", title: "Inspect" }],
          },
        },
      }),
      part({ id: "later-text", messageID: "later-user", type: "text", text: "Continue" }),
    ]);

    const planRow = buildTranscriptRows(turns, grouped, {
      isThreadRunning: true,
      showDiffSummary: true,
    }).find((candidate) => candidate.kind === "human" && candidate.todoSummary?.kind === "plan");

    expect(planRow).toMatchObject({
      kind: "human",
      todoSummary: { kind: "plan", isActive: false, canRestoreCheckpoint: true },
    });
  });

  it("updates every build row from the latest plan tracker state", () => {
    const turns = groupMessagesIntoTurns([
      user("build-user-1"),
      assistant("builder-1"),
      user("build-user-2"),
      assistant("builder-2"),
    ]);
    const grouped = groupPartsByMessage([
      part({
        id: "execution-1",
        messageID: "build-user-1",
        type: "text",
        text: "Implement the attached plan.",
        synthetic: true,
        metadata: {
          honkPlanExecution: {
            planKey: "plan-1",
            planTitle: "Tracker parity",
            assignedSteps: [
              { id: "step-1", title: "Inspect" },
              { id: "step-2", title: "Build" },
            ],
          },
        },
      }),
      part({
        id: "todos-1",
        messageID: "builder-1",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { id: "step-1", content: "Inspect", status: "completed" },
              { id: "step-2", content: "Build", status: "pending" },
            ],
          },
          metadata: {},
        },
      }),
      part({
        id: "execution-2",
        messageID: "build-user-2",
        type: "text",
        text: "Implement the attached plan.",
        synthetic: true,
        metadata: {
          honkPlanExecution: {
            planKey: "plan-1",
            planTitle: "Tracker parity",
            assignedSteps: [{ id: "step-2", title: "Build" }],
          },
        },
      }),
      part({
        id: "todos-2",
        messageID: "builder-2",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [{ id: "step-2", content: "Build", status: "completed" }],
          },
          metadata: {},
        },
      }),
    ]);

    const planRows = buildTranscriptRows(turns, grouped, {
      isThreadRunning: false,
      showDiffSummary: true,
    }).filter((row) => row.kind === "human" && row.todoSummary?.kind === "plan");

    expect(planRows).toHaveLength(2);
    for (const row of planRows) {
      expect(row).toMatchObject({
        todoSummary: {
          tasks: [
            { id: "step-1", status: "completed" },
            { id: "step-2", status: "completed" },
          ],
        },
      });
    }
    expect(
      planRows.flatMap((row) =>
        row.kind === "human" && row.todoSummary?.kind === "plan"
          ? [row.todoSummary.canRestoreCheckpoint]
          : [],
      ),
    ).toEqual([true, false]);
  });

  it("keeps the root build row current through invisible worker-completion turns", () => {
    const turns = groupMessagesIntoTurns([
      user("build-user"),
      assistant("builder"),
      user("worker-completion"),
      assistant("completion-handler"),
    ]);
    const grouped = groupPartsByMessage([
      part({
        id: "execution",
        messageID: "build-user",
        type: "text",
        text: "Implement the attached plan.",
        synthetic: true,
        metadata: {
          honkPlanExecution: {
            planKey: "plan-1",
            planTitle: "Tracker parity",
            assignedSteps: [
              { id: "step-1", title: "Inspect" },
              { id: "step-2", title: "Build" },
            ],
          },
        },
      }),
      part({
        id: "initial-todos",
        messageID: "builder",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { id: "step-1", content: "Inspect", status: "in_progress" },
              { id: "step-2", content: "Build", status: "in_progress" },
            ],
          },
          metadata: {},
        },
      }),
      part({
        id: "completion-notice",
        messageID: "worker-completion",
        type: "text",
        text: '<task state="completed">',
        synthetic: true,
      }),
      part({
        id: "completion-todos",
        messageID: "completion-handler",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { id: "step-1", content: "Inspect", status: "completed" },
              { id: "step-2", content: "Build", status: "completed" },
            ],
          },
          metadata: {},
        },
      }),
    ]);

    const humans = buildTranscriptRows(turns, grouped, {
      isThreadRunning: false,
      showDiffSummary: true,
    }).filter((row) => row.kind === "human");

    expect(humans).toHaveLength(1);
    expect(humans[0]).toMatchObject({
      turnKey: "build-user",
      requiresRevertConfirmation: false,
      todoSummary: {
        kind: "plan",
        canRestoreCheckpoint: false,
        tasks: [
          { id: "step-1", status: "completed" },
          { id: "step-2", status: "completed" },
        ],
      },
    });
  });

  it("does not replace an implementing-plan tracker with a later unrelated TodoWrite", () => {
    const turns = groupMessagesIntoTurns([
      user("build-user"),
      assistant("builder"),
      user("later-user"),
      assistant("later-assistant"),
    ]);
    const grouped = groupPartsByMessage([
      part({
        id: "execution",
        messageID: "build-user",
        type: "text",
        text: "Implement the attached plan.",
        synthetic: true,
        metadata: {
          honkPlanExecution: {
            planKey: "plan-1",
            planTitle: "Tracker parity",
            assignedSteps: [
              { id: "step-1", title: "Inspect" },
              { id: "step-2", title: "Build" },
            ],
          },
        },
      }),
      part({
        id: "plan-todos",
        messageID: "builder",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { id: "step-1", content: "Inspect", status: "completed" },
              { id: "step-2", content: "Build", status: "in_progress" },
            ],
          },
          metadata: {},
        },
      }),
      part({
        id: "later-text",
        messageID: "later-user",
        type: "text",
        text: "Unrelated follow-up",
      }),
      part({
        id: "later-todos",
        messageID: "later-assistant",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: { todos: [{ content: "Answer the follow-up", status: "in_progress" }] },
          metadata: {},
        },
      }),
    ]);

    const planRow = buildTranscriptRows(turns, grouped, {
      isThreadRunning: true,
      showDiffSummary: true,
    }).find((row) => row.kind === "human" && row.todoSummary?.kind === "plan");

    expect(planRow).toMatchObject({
      kind: "human",
      todoSummary: {
        kind: "plan",
        isActive: false,
        tasks: [
          { id: "step-1", content: "Inspect", status: "completed" },
          { id: "step-2", content: "Build", status: "in_progress" },
        ],
      },
    });
  });

  it("keeps generic TodoWrite progress on its originating human turn", () => {
    const turns = groupMessagesIntoTurns([
      user("u1"),
      assistant("a1"),
      user("u2"),
      assistant("a2"),
    ]);
    const grouped = groupPartsByMessage([
      part({ id: "up1", messageID: "u1", type: "text", text: "old" }),
      part({
        id: "old-todos",
        messageID: "a1",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: { todos: [{ content: "Old", status: "completed" }] },
          metadata: {},
        },
      }),
      part({ id: "up2", messageID: "u2", type: "text", text: "current" }),
      part({
        id: "current-todos",
        messageID: "a2",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: { todos: [{ content: "Current", status: "in_progress" }] },
          metadata: {},
        },
      }),
    ]);

    const humans = buildTranscriptRows(turns, grouped, {
      isThreadRunning: true,
      showDiffSummary: true,
    }).filter((row) => row.kind === "human");

    expect(humans[0]?.todoSummary).toMatchObject({
      kind: "todo",
      tasks: [{ content: "Current", status: "in_progress" }],
    });
    expect(humans[1]?.todoSummary).toBeUndefined();
  });

  it("skips user messages with no parts", () => {
    const rows = buildTranscriptRows([groupMessagesIntoTurns([user("u1")])[0]!], new Map(), {
      isThreadRunning: true,
      showDiffSummary: true,
    });

    expect(rows).toEqual([]);
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
