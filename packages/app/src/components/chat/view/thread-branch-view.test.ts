import {
  EnvironmentId,
  MessageId,
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
  filterMessagesToBranch,
  findThreadMessageEntry,
} from "./thread-branch-view";

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
    activeEntryId: null,
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

  it("returns invalid when the target entry id cannot be resolved", () => {
    const thread = makeThread({
      activeEntryId: ThreadEntryId.make("missing-entry"),
      entries: [],
    });
    // Force the missing-entry branch by passing an active entry while keeping
    // the entries array empty would short-circuit with "unfiltered". Instead,
    // populate entries with an unrelated entry so resolveThreadEntryPath fails.
    const populatedThread = makeThread({
      activeEntryId: ThreadEntryId.make("missing-entry"),
      entries: [
        {
          id: ThreadEntryId.make("other-entry"),
          kind: "label",
          parentId: null,
          turnId: null,
          label: "root",
          createdAt: "2026-02-23T00:00:00.000Z",
        } as never,
      ],
    });

    expect(deriveThreadBranchView(thread, null).status).toBe("unfiltered");
    expect(deriveThreadBranchView(populatedThread, null).status).toBe("invalid");
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
          kind: "message",
          parentId: null,
          messageId: MessageId.make("other"),
          turnId: null,
          label: null,
          createdAt: "2026-02-23T00:00:00.000Z",
        } as never,
      ],
    });
    expect(findThreadMessageEntry(thread, MessageId.make("m"))).toBeNull();
  });
});
