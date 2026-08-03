import { StatusRow } from "@honk/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThreadTranscriptRow } from "./transcript-turn";
import {
  buildTranscriptRows,
  groupMessagesIntoTurns,
  groupPartsByMessage,
  liveWorkRowKey,
  segmentAssistantTurn,
  turnHasVisibleActivity,
  type AssistantThreadMessage,
  type ThreadPart,
  type TranscriptBlock,
  type TranscriptRow,
  type UserThreadMessage,
} from "./transcript-model";
import {
  activeTurnStartedAtMs,
  WAITING_PLANNING_LABEL,
  waitingStatusLabel,
} from "./waiting-status";

// The six ways the transcript can tell the user work is live. Naming them lets the
// invariant assert which one fired, not merely how many: a shape that loses its own
// signal but gains another still reads wrong to the user.
type LiveSignal = "work-group" | "tool" | "prose" | "reasoning" | "task" | "waiting";

// A block reports its signal at most once. Two tools running side by side in one block
// is a legal state, not a second signal.
function activeSignals(input: {
  readonly rows: readonly { readonly row: TranscriptRow; readonly html: string }[];
  readonly liveWorkKey: string | null;
  readonly footer: string;
}): readonly LiveSignal[] {
  const rowSignals = input.rows.flatMap((rendered): readonly LiveSignal[] => {
    if (rendered.row.kind !== "block") return [];
    if (rendered.row.block.kind === "work") {
      if (rendered.row.key === input.liveWorkKey) {
        return rendered.html.includes('data-assistant-work-group=""') &&
          rendered.html.includes('data-work-group-running="true"') &&
          rendered.html.includes('aria-busy="true"')
          ? ["work-group"]
          : [];
      }
      return rendered.html.includes('data-tool-status="running"') ? ["tool"] : [];
    }
    if (rendered.row.block.kind === "prose") {
      return rendered.html.includes('data-message-bubble="assistant"') &&
        rendered.html.includes('aria-busy="true"')
        ? ["prose"]
        : [];
    }
    if (rendered.row.block.kind === "reasoning") {
      return rendered.html.includes('data-runtime-thinking-streaming="true"') &&
        rendered.html.includes('data-tool-status="running"') &&
        rendered.html.includes(">Thinking<")
        ? ["reasoning"]
        : [];
    }
    if (rendered.row.block.kind === "task") {
      return rendered.html.includes('data-tool-call-status-glyph="working"') &&
        rendered.html.includes('data-tool-status="running"')
        ? ["task"]
        : [];
    }
    return [];
  });
  return input.footer.includes(`>${WAITING_PLANNING_LABEL}<`)
    ? [...rowSignals, "waiting"]
    : rowSignals;
}

const assistantMessage = {
  id: "assistant-1",
  sessionID: "session-1",
  role: "assistant",
  time: { created: 1 },
  parentID: "user-1",
  modelID: "model-1",
  providerID: "provider-1",
  mode: "build",
  agent: "build",
  path: { cwd: "/repo", root: "/repo" },
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
} satisfies AssistantThreadMessage;

const previousUserMessage = {
  id: "user-0",
  sessionID: "session-1",
  role: "user",
  time: { created: -2 },
  agent: "build",
  model: { providerID: "provider-1", modelID: "model-1" },
} satisfies UserThreadMessage;

const previousAssistantMessage = {
  ...assistantMessage,
  id: "assistant-0",
  time: { created: -1 },
  parentID: previousUserMessage.id,
} satisfies AssistantThreadMessage;

const currentUserMessage = {
  ...previousUserMessage,
  id: "user-1",
  time: { created: 0 },
} satisfies UserThreadMessage;

const historicalRunningWork = {
  id: "work-historical",
  sessionID: "session-1",
  messageID: previousAssistantMessage.id,
  type: "tool",
  callID: "call-work-historical",
  tool: "bash",
  state: {
    status: "running",
    input: { command: "pnpm test" },
    title: "bash",
    metadata: {},
    time: { start: -1 },
  },
} satisfies ThreadPart;

const settledWork = {
  id: "work-settled",
  sessionID: "session-1",
  messageID: assistantMessage.id,
  type: "tool",
  callID: "call-work-settled",
  tool: "bash",
  state: {
    status: "completed",
    input: { command: "pnpm test" },
    output: "passed",
    title: "bash",
    metadata: {},
    time: { start: 1, end: 2 },
  },
} satisfies ThreadPart;

const runningWork = {
  id: "work-running",
  sessionID: "session-1",
  messageID: assistantMessage.id,
  type: "tool",
  callID: "call-work-running",
  tool: "bash",
  state: {
    status: "running",
    input: { command: "pnpm test" },
    title: "bash",
    metadata: {},
    time: { start: 1 },
  },
} satisfies ThreadPart;

const shapes = [
  {
    name: "work tail",
    parts: [runningWork],
    expected: ["work"],
    signal: "work-group",
  },
  {
    name: "prose tail",
    parts: [
      settledWork,
      {
        id: "prose-streaming",
        sessionID: "session-1",
        messageID: assistantMessage.id,
        type: "text",
        text: "Writing the answer",
        time: { start: 3 },
      },
    ],
    expected: ["work", "prose"],
    signal: "prose",
  },
  {
    name: "reasoning tail",
    parts: [
      settledWork,
      {
        id: "reasoning-active",
        sessionID: "session-1",
        messageID: assistantMessage.id,
        type: "reasoning",
        text: "Checking the code",
        time: { start: 3 },
      },
    ],
    expected: ["work", "reasoning"],
    signal: "reasoning",
  },
  {
    name: "task tail",
    parts: [
      settledWork,
      {
        id: "task-running",
        sessionID: "session-1",
        messageID: assistantMessage.id,
        type: "tool",
        callID: "call-task-running",
        tool: "task",
        state: {
          status: "running",
          input: { description: "Inspect the code", subagent_type: "honk-read-thread" },
          time: { start: 3 },
        },
      },
    ],
    expected: ["work", "task"],
    signal: "task",
  },
  {
    name: "notice tail",
    parts: [
      settledWork,
      {
        id: "notice-compaction",
        sessionID: "session-1",
        messageID: assistantMessage.id,
        type: "compaction",
        auto: true,
      },
    ],
    expected: ["work", "notice"],
    signal: "waiting",
  },
  {
    name: "error tail",
    parts: [settledWork],
    expected: ["work", "error"],
    signal: "waiting",
  },
  {
    name: "no blocks",
    parts: [],
    expected: [],
    signal: "waiting",
  },
  {
    name: "running tool before a settled task tail",
    parts: [
      runningWork,
      {
        id: "task-settled",
        sessionID: "session-1",
        messageID: assistantMessage.id,
        type: "tool",
        callID: "call-task-settled",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "Inspect the code", subagent_type: "honk-read-thread" },
          output: "Complete",
          title: "Inspect the code",
          metadata: {},
          time: { start: 2, end: 3 },
        },
      },
    ],
    expected: ["work", "task"],
    signal: "tool",
  },
] satisfies readonly {
  readonly name: string;
  readonly parts: readonly ThreadPart[];
  readonly expected: readonly TranscriptBlock["kind"][];
  readonly signal: LiveSignal;
}[];

describe("thread transcript liveness", () => {
  it("shows exactly one live signal while running and none while idle for every tail shape", () => {
    for (const shape of shapes) {
      const currentAssistantMessage: AssistantThreadMessage = {
        ...assistantMessage,
        ...(shape.expected.some((kind) => kind === "error")
          ? {
              error: {
                name: "UnknownError",
                data: { message: "Assistant failed" },
              },
            }
          : {}),
      };
      const messages = [
        previousUserMessage,
        previousAssistantMessage,
        currentUserMessage,
        currentAssistantMessage,
      ];
      const partsByMessageId = groupPartsByMessage([historicalRunningWork, ...shape.parts]);
      const turns = groupMessagesIntoTurns(messages);

      expect(
        segmentAssistantTurn([currentAssistantMessage], partsByMessageId).map(
          (block) => block.kind,
        ),
        shape.name,
      ).toEqual(shape.expected);

      for (const isThreadRunning of [true, false]) {
        const rows = buildTranscriptRows(turns, partsByMessageId, {
          isThreadRunning,
          showDiffSummary: false,
        });
        const liveWorkKey = liveWorkRowKey(turns, rows, isThreadRunning);
        const renderedRows = rows.map((row) => ({
          row,
          html: renderToStaticMarkup(
            <ThreadTranscriptRow
              row={row}
              conversationDensity="detailed"
              isThreadRunning={isThreadRunning && row.turnKey === currentUserMessage.id}
              isLiveWorkBlock={row.key === liveWorkKey}
            />,
          ),
        }));
        const waitingLabel = waitingStatusLabel({
          isRunning: isThreadRunning,
          hasVisibleActivity: turnHasVisibleActivity(turns.at(-1), partsByMessageId),
          turnStartedAtMs: activeTurnStartedAtMs(messages, [historicalRunningWork, ...shape.parts]),
          nowMs: 1_000,
        });
        const footer =
          waitingLabel === null ? "" : renderToStaticMarkup(<StatusRow>{waitingLabel}</StatusRow>);

        expect(
          activeSignals({ rows: renderedRows, liveWorkKey, footer }),
          `${shape.name}, thread ${isThreadRunning ? "running" : "idle"}\n${renderedRows
            .map((rendered) => rendered.html)
            .join("")}${footer}`,
        ).toEqual(isThreadRunning ? [shape.signal] : []);
      }
    }
  });
});

describe("thread change receipts", () => {
  it("renders changed files as controls when the workbench can open them", () => {
    const html = renderToStaticMarkup(
      <ThreadTranscriptRow
        row={{
          kind: "diff",
          key: "diff:user-1",
          turnKey: "user-1",
          diffs: [
            {
              file: "README.md",
              additions: 1,
              deletions: 1,
              status: "modified",
            },
          ],
        }}
        conversationDensity="detailed"
        onOpenFile={() => undefined}
      />,
    );

    expect(html).toContain('<button type="button" title="README.md"');
    expect(html).toContain('aria-label="Open README.md, modified"');
  });
});

describe("thread file references", () => {
  it("renders assistant workspace links through the workbench file treatment", () => {
    const html = renderToStaticMarkup(
      <ThreadTranscriptRow
        row={{
          kind: "block",
          key: "block:user-1:prose-1",
          turnKey: "user-1",
          block: {
            kind: "prose",
            key: "prose-1",
            part: {
              id: "prose-1",
              sessionID: "session-1",
              messageID: "assistant-1",
              type: "text",
              text: "[cursor-parity-handbook.md](docs/cursor-parity-handbook.md)",
              time: { start: 1, end: 2 },
            },
          },
        }}
        conversationDensity="detailed"
        onOpenFile={() => undefined}
      />,
    );

    expect(html).toContain('title="Open docs/cursor-parity-handbook.md in workbench"');
    expect(html).toMatch(/<a[^>]*><code[^>]*>cursor-parity-handbook\.md<\/code><\/a>/);
  });
});
