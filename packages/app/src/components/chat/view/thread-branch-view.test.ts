import {
  EnvironmentId,
  EventId,
  MessageId,
  type OrchestrationThreadActivity,
  OrchestrationProposedPlanId,
  ProviderItemId,
  ThreadEntryId,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { Thread } from "../../../types";
import {
  containsThreadEntry,
  deriveThreadBranchView,
  filterActivitiesToBranch,
  filterChatTimelineRowsToBranch,
  filterMessagesToBranch,
  findThreadMessageEntry,
  materializeTimelineEntriesFromChatTimelineRows,
} from "./thread-branch-view";
import { getThreadBranch } from "@multi/contracts";

const ENVIRONMENT_ID = EnvironmentId.make("env-1");
const THREAD_ID = ThreadId.make("thread-1");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: THREAD_ID,
    environmentId: ENVIRONMENT_ID,
    codexThreadId: null,
    projectId: null,
    title: "thread",
    modelSelection: { provider: "codex" as never, model: "gpt-5" as never },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    leafId: null,
    entries: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-23T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    chatTimelineRows: [],
    ...overrides,
  } as Thread;
}

describe("deriveThreadBranchView", () => {
  it("returns unfiltered when no thread is provided", () => {
    const view = deriveThreadBranchView(null, null);
    expect(view.status).toBe("unfiltered");
    expect(view.entryId).toBeNull();
    expect(view.messageIds).toBeNull();
    expect(view.turnIds).toBeNull();
  });

  it("returns unfiltered when there are no entries", () => {
    const view = deriveThreadBranchView(makeThread(), ThreadEntryId.make("entry-1"));
    expect(view.status).toBe("unfiltered");
  });

  it("returns unfiltered when leafId is null even if entries exist", () => {
    const messageId = MessageId.make("m1");
    const thread = makeThread({
      leafId: null,
      messages: [
        {
          id: messageId,
          role: "user",
          text: "root prompt",
          turnId: null,
          createdAt: "",
          streaming: false,
        },
      ],
      entries: [
        {
          id: ThreadEntryId.make("message:m1"),
          threadId: THREAD_ID,
          parentEntryId: null,
          kind: "message",
          messageId,
          turnId: null,
          createdAt: "2026-02-23T00:00:00.000Z",
        },
      ],
    });

    const view = deriveThreadBranchView(thread, null);
    expect(view.status).toBe("unfiltered");
    expect(filterMessagesToBranch(thread.messages, view)).toBe(thread.messages);
  });

  it("returns invalid when the target entry id cannot be resolved", () => {
    const thread = makeThread({
      leafId: ThreadEntryId.make("missing-entry"),
      entries: [],
    });
    // Force the missing-entry branch by passing a leaf while keeping
    // the entries array empty would short-circuit with "unfiltered". Instead,
    // populate entries with an unrelated entry so resolveThreadEntryPath fails.
    const populatedThread = makeThread({
      leafId: ThreadEntryId.make("missing-entry"),
      entries: [
        {
          id: ThreadEntryId.make("other-entry"),
          threadId: THREAD_ID,
          parentEntryId: null,
          kind: "message",
          messageId: MessageId.make("other-message"),
          turnId: null,
          createdAt: "2026-02-23T00:00:00.000Z",
        },
      ],
    });

    expect(deriveThreadBranchView(thread, null).status).toBe("unfiltered");
    expect(deriveThreadBranchView(populatedThread, null).status).toBe("invalid");
  });

  it("filters visible messages from the current leaf branch", () => {
    const userEntryId = ThreadEntryId.make("message:m1");
    const assistantEntryId = ThreadEntryId.make("message:m2");
    const siblingEntryId = ThreadEntryId.make("message:m3");
    const thread = makeThread({
      leafId: assistantEntryId,
      messages: [
        {
          id: MessageId.make("m1"),
          role: "user",
          text: "hello",
          turnId: null,
          createdAt: "",
          streaming: false,
        },
        {
          id: MessageId.make("m2"),
          role: "assistant",
          text: "hi",
          turnId: TurnId.make("turn-1"),
          createdAt: "",
          streaming: false,
        },
        {
          id: MessageId.make("m3"),
          role: "assistant",
          text: "off branch",
          turnId: TurnId.make("turn-2"),
          createdAt: "",
          streaming: false,
        },
      ],
      entries: [
        {
          id: userEntryId,
          threadId: THREAD_ID,
          parentEntryId: null,
          kind: "message",
          messageId: MessageId.make("m1"),
          turnId: null,
          createdAt: "2026-02-23T00:00:00.000Z",
        },
        {
          id: assistantEntryId,
          threadId: THREAD_ID,
          parentEntryId: userEntryId,
          kind: "message",
          messageId: MessageId.make("m2"),
          turnId: TurnId.make("turn-1"),
          createdAt: "2026-02-23T00:00:00.000Z",
        },
        {
          id: siblingEntryId,
          threadId: THREAD_ID,
          parentEntryId: userEntryId,
          kind: "message",
          messageId: MessageId.make("m3"),
          turnId: TurnId.make("turn-2"),
          createdAt: "2026-02-23T00:00:00.000Z",
        },
      ],
    });

    const branch = getThreadBranch({ entries: thread.entries, leafId: thread.leafId });
    expect(branch?.ok).toBe(true);

    const view = deriveThreadBranchView(thread, null);
    expect(view.status).toBe("valid");
    expect(filterMessagesToBranch(thread.messages, view).map((message) => message.id)).toEqual([
      MessageId.make("m1"),
      MessageId.make("m2"),
    ]);
  });
});

describe("filterMessagesToBranch", () => {
  it("returns all messages when status is unfiltered", () => {
    const messages = [
      {
        id: MessageId.make("m1"),
        role: "user" as const,
        text: "hi",
        turnId: null,
        createdAt: "",
        streaming: false,
      },
    ];
    const out = filterMessagesToBranch(messages, {
      status: "unfiltered",
      entryId: null,
      entryIds: null,
      messageIds: null,
      turnIds: null,
      issue: null,
    });
    expect(out).toBe(messages);
  });

  it("returns empty when status is invalid", () => {
    expect(
      filterMessagesToBranch(
        [
          {
            id: MessageId.make("m1"),
            role: "user",
            text: "hi",
            turnId: null,
            createdAt: "",
            streaming: false,
          },
        ],
        {
          status: "invalid",
          entryId: null,
          entryIds: null,
          messageIds: null,
          turnIds: null,
          issue: "broken",
        },
      ),
    ).toEqual([]);
  });

  it("filters to the messageIds set when status is valid", () => {
    const keptId = MessageId.make("m1");
    const droppedId = MessageId.make("m2");
    const messages = [
      {
        id: keptId,
        role: "user" as const,
        text: "hi",
        turnId: null,
        createdAt: "",
        streaming: false,
      },
      {
        id: droppedId,
        role: "assistant" as const,
        text: "yo",
        turnId: null,
        createdAt: "",
        streaming: false,
      },
    ];
    const out = filterMessagesToBranch(messages, {
      status: "valid",
      entryId: ThreadEntryId.make("e1"),
      entryIds: new Set([ThreadEntryId.make("e1")]),
      messageIds: new Set([keptId]),
      turnIds: new Set(),
      issue: null,
    });
    expect(out.map((m) => m.id)).toEqual([keptId]);
  });
});

describe("filterActivitiesToBranch", () => {
  it("returns the activities array when status is unfiltered", () => {
    const activities = [] as never[];
    expect(
      filterActivitiesToBranch(activities, {
        status: "unfiltered",
        entryId: null,
        entryIds: null,
        messageIds: null,
        turnIds: null,
        issue: null,
      }),
    ).toBe(activities);
  });

  it("filters by turn id when status is valid", () => {
    const turnId = TurnId.make("turn-1");
    const otherTurnId = TurnId.make("turn-2");
    const activities = [
      { id: "a-1", turnId, kind: "tool.completed" },
      { id: "a-2", turnId: otherTurnId, kind: "tool.completed" },
      { id: "a-3", turnId: null, kind: "tool.completed" },
    ] as never[];
    const out = filterActivitiesToBranch(activities, {
      status: "valid",
      entryId: ThreadEntryId.make("e1"),
      entryIds: new Set([ThreadEntryId.make("e1")]),
      messageIds: new Set(),
      turnIds: new Set([turnId]),
      issue: null,
    });
    expect(out.map((a) => (a as unknown as { id: string }).id)).toEqual(["a-1"]);
  });
});

describe("containsThreadEntry", () => {
  it("returns false when there is no thread", () => {
    expect(containsThreadEntry(null, ThreadEntryId.make("e"))).toBe(false);
  });

  it("returns false when entryId is null", () => {
    const thread = makeThread();
    expect(containsThreadEntry(thread, null)).toBe(false);
  });
});

describe("findThreadMessageEntry", () => {
  it("returns null when there is no thread", () => {
    expect(findThreadMessageEntry(null, MessageId.make("m"))).toBeNull();
  });

  it("returns null when no matching message entry exists", () => {
    const thread = makeThread({
      entries: [
        {
          id: ThreadEntryId.make("e1"),
          threadId: THREAD_ID,
          parentEntryId: null,
          kind: "message",
          messageId: MessageId.make("other"),
          turnId: null,
          createdAt: "2026-02-23T00:00:00.000Z",
        },
      ],
    });
    expect(findThreadMessageEntry(thread, MessageId.make("m"))).toBeNull();
  });
});

describe("filterChatTimelineRowsToBranch", () => {
  it("filters message rows by entry id when present", () => {
    const keptEntryId = ThreadEntryId.make("entry-kept");
    const droppedEntryId = ThreadEntryId.make("entry-dropped");
    const rows = filterChatTimelineRowsToBranch(
      [
        {
          kind: "message",
          id: "message:m1",
          orderKey: "2026-03-01T00:00:00.000Z:message:m1",
          createdAt: "2026-03-01T00:00:00.000Z",
          messageId: MessageId.make("m1"),
          turnId: null,
          entryId: keptEntryId,
        },
        {
          kind: "message",
          id: "message:m2",
          orderKey: "2026-03-01T00:00:01.000Z:message:m2",
          createdAt: "2026-03-01T00:00:01.000Z",
          messageId: MessageId.make("m2"),
          turnId: null,
          entryId: droppedEntryId,
        },
      ],
      {
        status: "valid",
        entryId: keptEntryId,
        entryIds: new Set([keptEntryId]),
        messageIds: new Set([MessageId.make("m1"), MessageId.make("m2")]),
        turnIds: new Set(),
        issue: null,
      },
    );

    expect(rows.map((row) => row.id)).toEqual(["message:m1"]);
  });

  it("includes null-turn work rows on every branch", () => {
    const turnId = TurnId.make("turn-1");
    const rows = filterChatTimelineRowsToBranch(
      [
        {
          kind: "work",
          id: "work:activity:activity-1",
          orderKey: "2026-03-01T00:00:00.000Z:activity-1",
          createdAt: "2026-03-01T00:00:00.000Z",
          workId: "activity:activity-1",
          activityIds: [EventId.make("activity-1")],
          turnId: null,
        },
        {
          kind: "work",
          id: "work:tool:turn-1:tool-1",
          orderKey: "2026-03-01T00:00:01.000Z:tool-1",
          createdAt: "2026-03-01T00:00:01.000Z",
          workId: "tool:turn-1:tool-1",
          activityIds: [EventId.make("activity-2")],
          turnId,
          toolCallId: "tool-1",
        },
      ],
      {
        status: "valid",
        entryId: ThreadEntryId.make("entry-1"),
        entryIds: new Set([ThreadEntryId.make("entry-1")]),
        messageIds: new Set(),
        turnIds: new Set([TurnId.make("turn-2")]),
        issue: null,
      },
    );

    expect(rows.map((row) => row.kind)).toEqual(["work"]);
    expect(rows.map((row) => row.id)).toEqual(["work:activity:activity-1"]);
  });

  it("excludes null-turn proposed-plan rows without global scope", () => {
    const rows = filterChatTimelineRowsToBranch(
      [
        {
          kind: "proposed-plan",
          id: "proposed-plan:plan-1",
          orderKey: "2026-03-01T00:00:00.000Z:plan-1",
          createdAt: "2026-03-01T00:00:00.000Z",
          planId: OrchestrationProposedPlanId.make("plan-1"),
          turnId: null,
        },
      ],
      {
        status: "valid",
        entryId: ThreadEntryId.make("entry-1"),
        entryIds: new Set([ThreadEntryId.make("entry-1")]),
        messageIds: new Set(),
        turnIds: new Set([TurnId.make("turn-1")]),
        issue: null,
      },
    );

    expect(rows).toEqual([]);
  });
});

describe("materializeTimelineEntriesFromChatTimelineRows", () => {
  it("maps canonical rows back to timeline entries", () => {
    const messageId = MessageId.make("m1");
    const entries = materializeTimelineEntriesFromChatTimelineRows({
      rows: [
        {
          kind: "message",
          id: `message:${messageId}`,
          orderKey: "2026-03-01T00:00:00.000Z:message",
          createdAt: "2026-03-01T00:00:00.000Z",
          messageId,
          turnId: null,
          entryId: ThreadEntryId.make("entry-1"),
        },
        {
          kind: "proposed-plan",
          id: "proposed-plan:plan-1",
          orderKey: "2026-03-01T00:00:01.000Z:plan-1",
          createdAt: "2026-03-01T00:00:01.000Z",
          planId: OrchestrationProposedPlanId.make("plan-1"),
          turnId: TurnId.make("turn-1"),
        },
      ],
      messages: [
        {
          id: messageId,
          role: "user",
          text: "hello",
          turnId: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          streaming: false,
        },
      ],
      proposedPlans: [
        {
          id: OrchestrationProposedPlanId.make("plan-1"),
          turnId: TurnId.make("turn-1"),
          planMarkdown: "# Plan",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-03-01T00:00:01.000Z",
          updatedAt: "2026-03-01T00:00:01.000Z",
        },
      ],
      activities: [],
    });

    expect(entries.map((entry) => entry.kind)).toEqual(["message", "proposed-plan"]);
  });

  it("keeps subagent details for canonical work rows", () => {
    const turnId = TurnId.make("turn-1");
    const activities: OrchestrationThreadActivity[] = [
      {
        id: EventId.make("parent-task-tool"),
        tone: "tool",
        kind: "tool.started",
        summary: "Subagent task started",
        payload: {
          itemId: "tool-task-1",
          itemType: "collab_agent_tool_call",
          title: "Subagent task",
          detail: "Review the database layer",
        },
        turnId,
        createdAt: "2026-02-23T00:00:01.000Z",
      },
      {
        id: EventId.make("subagent-thread"),
        tone: "info",
        kind: "subagent.thread.started",
        summary: "Subagent thread started",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: ProviderItemId.make("tool-task-1"),
          nickname: "reviewer",
        },
        turnId,
        createdAt: "2026-02-23T00:00:02.000Z",
      },
      {
        id: EventId.make("subagent-delta"),
        tone: "info",
        kind: "subagent.content.delta",
        summary: "Subagent content delta",
        payload: {
          providerThreadId: "codex-subagent-thread-1",
          parentItemId: ProviderItemId.make("tool-task-1"),
          itemId: "subagent-message-1",
          streamKind: "assistant_text",
          delta: "Reviewed the database layer.",
        },
        turnId,
        createdAt: "2026-02-23T00:00:03.000Z",
      },
    ];

    const entries = materializeTimelineEntriesFromChatTimelineRows({
      rows: [
        {
          kind: "work",
          id: "work:tool:turn-1:tool-task-1",
          orderKey: "2026-02-23T00:00:01.000Z:tool-task-1",
          createdAt: "2026-02-23T00:00:01.000Z",
          workId: "tool:turn-1:tool-task-1",
          activityIds: [EventId.make("parent-task-tool")],
          turnId,
          toolCallId: "tool-task-1",
        },
      ],
      messages: [],
      proposedPlans: [],
      activities,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("work");
    expect(entries[0]?.kind === "work" ? entries[0].entry.subagents?.[0] : null).toMatchObject({
      providerThreadId: "codex-subagent-thread-1",
      parentItemId: "tool-task-1",
      nickname: "reviewer",
      hasDetails: true,
    });
  });
});
