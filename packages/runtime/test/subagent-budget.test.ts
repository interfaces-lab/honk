import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBAGENT_BUDGET_LIMITS,
  createSubagentBudgetController,
  evictIdleSubagentRuntimes,
  truncateSubagentOutputForParent,
  type LoadedSubagentRuntime,
  type SubagentBudgetLimits,
} from "../src/subagent-budget";

function testLimits(overrides: Partial<SubagentBudgetLimits> = {}): SubagentBudgetLimits {
  return {
    ...DEFAULT_SUBAGENT_BUDGET_LIMITS,
    profileActiveLimits: { ...DEFAULT_SUBAGENT_BUDGET_LIMITS.profileActiveLimits },
    ...overrides,
  };
}

describe("createSubagentBudgetController", () => {
  it("accepts task counts up to the configured cap", () => {
    const budget = createSubagentBudgetController(testLimits({ maxTasksPerToolCall: 20 }));

    expect(budget.canAcceptTaskCount(20)).toBe(true);
    expect(budget.canAcceptTaskCount(21)).toBe(false);
  });

  it("queues slot requests until a lease is released", async () => {
    const budget = createSubagentBudgetController(
      testLimits({
        maxActivePerSession: 1,
        maxActivePerToolCall: 1,
        profileActiveLimits: { librarian: 1 },
      }),
    );

    const first = await budget.acquireSlot({
      parentSessionId: "parent",
      toolCallId: "tool",
      profileName: "librarian",
    });
    let secondResolved = false;
    const secondPromise = budget
      .acquireSlot({
        parentSessionId: "parent",
        toolCallId: "tool",
        profileName: "librarian",
      })
      .then((lease) => {
        secondResolved = true;
        return lease;
      });

    await Promise.resolve();
    expect(secondResolved).toBe(false);
    expect(budget.snapshot()).toMatchObject({ activeTotal: 1, queuedTotal: 1 });

    first.release();
    const second = await secondPromise;
    expect(secondResolved).toBe(true);
    expect(budget.snapshot()).toMatchObject({ activeTotal: 1, queuedTotal: 0 });

    second.release();
    expect(budget.snapshot()).toMatchObject({ activeTotal: 0, queuedTotal: 0 });
  });

  it("does not exceed the configured parent session active cap", async () => {
    const budget = createSubagentBudgetController(
      testLimits({
        maxActivePerSession: 2,
        maxActivePerToolCall: 10,
        profileActiveLimits: { librarian: 10 },
      }),
    );

    const first = await budget.acquireSlot({
      parentSessionId: "parent",
      toolCallId: "tool-a",
      profileName: "librarian",
    });
    const second = await budget.acquireSlot({
      parentSessionId: "parent",
      toolCallId: "tool-b",
      profileName: "librarian",
    });
    let thirdResolved = false;
    const thirdPromise = budget
      .acquireSlot({
        parentSessionId: "parent",
        toolCallId: "tool-c",
        profileName: "librarian",
      })
      .then((lease) => {
        thirdResolved = true;
        return lease;
      });

    await Promise.resolve();
    expect(thirdResolved).toBe(false);
    expect(budget.snapshot()).toMatchObject({
      activeTotal: 2,
      queuedTotal: 1,
      activeBySession: { parent: 2 },
    });

    first.release();
    const third = await thirdPromise;
    expect(thirdResolved).toBe(true);
    expect(budget.snapshot()).toMatchObject({ activeTotal: 2, queuedTotal: 0 });

    second.release();
    third.release();
  });

  it("applies profile-specific active caps", async () => {
    const budget = createSubagentBudgetController(
      testLimits({
        maxActivePerSession: 10,
        maxActivePerToolCall: 10,
        profileActiveLimits: { oracle: 1, librarian: 10 },
      }),
    );

    const oracle = await budget.acquireSlot({
      parentSessionId: "parent",
      toolCallId: "tool",
      profileName: "oracle",
    });
    const librarian = await budget.acquireSlot({
      parentSessionId: "parent",
      toolCallId: "tool",
      profileName: "librarian",
    });
    let secondOracleResolved = false;
    const secondOraclePromise = budget
      .acquireSlot({
        parentSessionId: "parent",
        toolCallId: "tool",
        profileName: "oracle",
      })
      .then((lease) => {
        secondOracleResolved = true;
        return lease;
      });

    await Promise.resolve();
    expect(secondOracleResolved).toBe(false);
    expect(budget.snapshot()).toMatchObject({
      activeByProfile: { oracle: 1, librarian: 1 },
      queuedTotal: 1,
    });

    oracle.release();
    const secondOracle = await secondOraclePromise;
    expect(secondOracleResolved).toBe(true);

    librarian.release();
    secondOracle.release();
  });
});

describe("truncateSubagentOutputForParent", () => {
  it("keeps parent-visible output under the byte cap", () => {
    const text = `prefix ${"🪿".repeat(100)}`;
    const truncated = truncateSubagentOutputForParent({ text, maxBytes: 120 });

    expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(120);
    expect(truncated).toContain("Output truncated");
  });
});

describe("evictIdleSubagentRuntimes", () => {
  it("evicts least-recently-used idle children without disposing active children", () => {
    const disposed: string[] = [];
    const child = (id: string, input: { active: boolean; lastUsedAt: number }): LoadedSubagentRuntime => ({
      active: input.active,
      disposed: false,
      lastUsedAt: input.lastUsedAt,
      dispose: () => {
        disposed.push(id);
      },
    });
    const loadedChildren = new Map<string, LoadedSubagentRuntime>([
      ["active-old", child("active-old", { active: true, lastUsedAt: 1 })],
      ["idle-old", child("idle-old", { active: false, lastUsedAt: 2 })],
      ["idle-newer", child("idle-newer", { active: false, lastUsedAt: 3 })],
      ["idle-newest", child("idle-newest", { active: false, lastUsedAt: 4 })],
    ]);

    evictIdleSubagentRuntimes({ loadedChildren, maxLoadedIdleChildren: 2 });

    expect(disposed).toEqual(["idle-old"]);
    expect(loadedChildren.has("active-old")).toBe(true);
    expect(loadedChildren.has("idle-old")).toBe(false);
    expect(loadedChildren.has("idle-newer")).toBe(true);
    expect(loadedChildren.has("idle-newest")).toBe(true);
  });
});
