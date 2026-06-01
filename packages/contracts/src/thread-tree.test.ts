import { MessageId, ThreadEntryId, TurnId } from "./base-schemas";
import {
  flattenThreadEntryTree,
  getThreadBranch,
  resolveThreadBranchPathFacts,
  resolveLeafIdAfterThreadMessage,
  resolveLeafIdAfterThreadNavigate,
  resolveThreadEntryPath,
  threadEntryIdForMessageId,
} from "./thread-tree";
import { describe, expect, it } from "vitest";

const entry = (input: {
  readonly id: string;
  readonly parentEntryId: string | null;
  readonly messageId?: string | null;
  readonly turnId?: string | null;
  readonly role?: "user" | "assistant";
  readonly createdAt?: string;
}) => ({
  id: ThreadEntryId.make(input.id),
  parentEntryId: input.parentEntryId ? ThreadEntryId.make(input.parentEntryId) : null,
  kind: "message" as const,
  messageId: input.messageId ? MessageId.make(input.messageId) : null,
  turnId: input.turnId ? TurnId.make(input.turnId) : null,
  createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
});

describe("resolveLeafIdAfterThreadMessage", () => {
  it("always moves the leaf to a new user message", () => {
    expect(
      resolveLeafIdAfterThreadMessage({
        leafId: ThreadEntryId.make("leaf"),
        entryId: ThreadEntryId.make("user-entry"),
        parentEntryId: ThreadEntryId.make("leaf"),
        role: "user",
      }),
    ).toBe(ThreadEntryId.make("user-entry"));
  });

  it("moves the leaf to an assistant message only when on-branch", () => {
    const parentEntryId = ThreadEntryId.make("user-entry");
    const assistantEntryId = ThreadEntryId.make("assistant-entry");

    expect(
      resolveLeafIdAfterThreadMessage({
        leafId: parentEntryId,
        entryId: assistantEntryId,
        parentEntryId,
        role: "assistant",
      }),
    ).toBe(assistantEntryId);

    expect(
      resolveLeafIdAfterThreadMessage({
        leafId: ThreadEntryId.make("other-leaf"),
        entryId: assistantEntryId,
        parentEntryId,
        role: "assistant",
      }),
    ).toBe(ThreadEntryId.make("other-leaf"));
  });
});

describe("resolveLeafIdAfterThreadNavigate", () => {
  it("moves the leaf to the requested user message entry", () => {
    expect(
      resolveLeafIdAfterThreadNavigate({
        entryId: ThreadEntryId.make("user-1"),
      }),
    ).toBe(ThreadEntryId.make("user-1"));
  });

  it("moves the leaf to an assistant message entry", () => {
    expect(
      resolveLeafIdAfterThreadNavigate({
        entryId: ThreadEntryId.make("assistant-1"),
      }),
    ).toBe(ThreadEntryId.make("assistant-1"));
  });
});

describe("getThreadBranch", () => {
  it("returns the path from root to the leaf", () => {
    const entries = [
      entry({ id: "user-1", parentEntryId: null, messageId: "m1" }),
      entry({ id: "assistant-1", parentEntryId: "user-1", messageId: "m2" }),
      entry({ id: "user-2", parentEntryId: "assistant-1", messageId: "m3" }),
    ];
    const branch = getThreadBranch({
      entries,
      leafId: ThreadEntryId.make("user-2"),
    });
    expect(branch?.ok).toBe(true);
    if (!branch?.ok) {
      return;
    }
    expect(branch.entries.map((item) => item.id)).toEqual([
      ThreadEntryId.make("user-1"),
      ThreadEntryId.make("assistant-1"),
      ThreadEntryId.make("user-2"),
    ]);
  });

  it("returns null when there is no leaf", () => {
    expect(getThreadBranch({ entries: [], leafId: null })).toBeNull();
  });
});

describe("resolveThreadBranchPathFacts", () => {
  it("derives entry, message, and turn ids for the branch path", () => {
    const entries = [
      entry({ id: "user-1", parentEntryId: null, messageId: "m1" }),
      entry({
        id: "assistant-1",
        parentEntryId: "user-1",
        messageId: "m2",
        turnId: "entry-turn",
      }),
    ];

    const facts = resolveThreadBranchPathFacts({
      entries,
      entryId: ThreadEntryId.make("assistant-1"),
      messages: [
        { id: MessageId.make("m1"), turnId: null },
        { id: MessageId.make("m2"), turnId: TurnId.make("message-turn") },
      ],
    });

    expect(facts.ok).toBe(true);
    if (!facts.ok) {
      return;
    }
    expect([...facts.entryIds]).toEqual([
      ThreadEntryId.make("user-1"),
      ThreadEntryId.make("assistant-1"),
    ]);
    expect([...facts.messageIds]).toEqual([MessageId.make("m1"), MessageId.make("m2")]);
    expect([...facts.turnIds]).toEqual([
      TurnId.make("entry-turn"),
      TurnId.make("message-turn"),
    ]);
  });

  it("reports entries that point to missing messages", () => {
    const facts = resolveThreadBranchPathFacts({
      entries: [entry({ id: "user-1", parentEntryId: null, messageId: "missing-message" })],
      entryId: ThreadEntryId.make("user-1"),
      messages: [],
    });

    expect(facts.ok).toBe(false);
    if (facts.ok) {
      return;
    }
    expect(facts.reason).toBe("missing-message");
    expect(facts.entryId).toBe(ThreadEntryId.make("user-1"));
  });
});

describe("flattenThreadEntryTree", () => {
  it("orders active branch siblings first and includes view metadata", () => {
    const entries = [
      entry({
        id: "root",
        parentEntryId: null,
        messageId: "m-root",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      entry({
        id: "inactive-child",
        parentEntryId: "root",
        messageId: "m-inactive",
        createdAt: "2026-01-01T00:01:00.000Z",
      }),
      entry({
        id: "active-child",
        parentEntryId: "root",
        messageId: "m-active",
        createdAt: "2026-01-01T00:02:00.000Z",
      }),
      entry({
        id: "active-leaf",
        parentEntryId: "active-child",
        messageId: "m-leaf",
        createdAt: "2026-01-01T00:03:00.000Z",
      }),
    ];

    const result = flattenThreadEntryTree({
      entries,
      leafId: ThreadEntryId.make("active-leaf"),
    });

    expect(result.issues).toEqual([]);
    expect(result.nodes.map((node) => node.entry.id)).toEqual([
      ThreadEntryId.make("root"),
      ThreadEntryId.make("active-child"),
      ThreadEntryId.make("active-leaf"),
      ThreadEntryId.make("inactive-child"),
    ]);
    expect(result.nodes.map((node) => node.depth)).toEqual([0, 1, 2, 1]);
    expect(result.nodes.map((node) => node.isActivePath)).toEqual([true, true, true, false]);
    expect([...result.activePathEntryIds]).toEqual([
      ThreadEntryId.make("root"),
      ThreadEntryId.make("active-child"),
      ThreadEntryId.make("active-leaf"),
    ]);
    expect(result.nodes[0]?.childCount).toBe(2);
    expect(result.nodes[2]?.isActiveLeaf).toBe(true);
    expect(result.nodes[1]?.siblingIndex).toBe(0);
    expect(result.nodes[1]?.siblingCount).toBe(2);
    expect(result.nodes[1]?.hasNextSibling).toBe(true);
    expect(result.nodes[2]?.ancestorHasNextSibling).toEqual([false, true]);
  });

  it("excludes orphaned entries and reports missing parents", () => {
    const result = flattenThreadEntryTree({
      entries: [
        entry({ id: "root", parentEntryId: null, messageId: "m-root" }),
        entry({ id: "orphan", parentEntryId: "missing-parent", messageId: "m-orphan" }),
      ],
      leafId: ThreadEntryId.make("root"),
    });

    expect(result.nodes.map((node) => node.entry.id)).toEqual([ThreadEntryId.make("root")]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.reason).toBe("missing-entry");
  });

  it("excludes cyclic entries and reports cycles", () => {
    const result = flattenThreadEntryTree({
      entries: [
        entry({ id: "cycle-a", parentEntryId: "cycle-b", messageId: "m-a" }),
        entry({ id: "cycle-b", parentEntryId: "cycle-a", messageId: "m-b" }),
      ],
      leafId: ThreadEntryId.make("cycle-a"),
    });

    expect(result.nodes).toEqual([]);
    expect(result.issues.map((issue) => issue.reason)).toContain("cycle");
  });

  it("reports a missing active leaf without dropping valid tree rows", () => {
    const result = flattenThreadEntryTree({
      entries: [entry({ id: "root", parentEntryId: null, messageId: "m-root" })],
      leafId: ThreadEntryId.make("missing-leaf"),
    });

    expect(result.nodes.map((node) => node.entry.id)).toEqual([ThreadEntryId.make("root")]);
    expect(result.activePathEntryIds.size).toBe(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      reason: "missing-entry",
      entryId: ThreadEntryId.make("missing-leaf"),
      missingEntryId: ThreadEntryId.make("missing-leaf"),
    });
  });
});

describe("resolveThreadEntryPath", () => {
  it("detects a broken ancestor chain", () => {
    const path = resolveThreadEntryPath({
      entries: [
        entry({ id: "user-1", parentEntryId: "missing-parent", messageId: "m1" }),
      ],
      entryId: ThreadEntryId.make("user-1"),
    });
    expect(path.ok).toBe(false);
    if (path.ok) {
      return;
    }
    expect(path.reason).toBe("missing-entry");
  });
});
