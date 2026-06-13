import { EnvironmentId, ThreadId } from "@honk/contracts";
import { describe, expect, it } from "vitest";

import type { SidebarThreadSummary } from "~/types";
import { splitPromptIntoComposerSegments } from "../prompt-segments";
import {
  buildPastThreadCandidates,
  buildThreadMentionToken,
  buildThreadSessionFileUri,
  sanitizeThreadMentionTitle,
} from "./thread-items";

const environmentId = EnvironmentId.make("environment:thread-items");
const otherEnvironmentId = EnvironmentId.make("environment:thread-items-other");

function makeSummary(input: {
  id: string;
  title?: string;
  environmentId?: EnvironmentId;
  createdAt?: string;
  updatedAt?: string | undefined;
  latestUserMessageAt?: string | null;
}): SidebarThreadSummary {
  return {
    id: ThreadId.make(input.id),
    environmentId: input.environmentId ?? environmentId,
    projectId: null,
    title: input.title ?? `Thread ${input.id}`,
    interactionMode: "agent",
    session: null,
    createdAt: input.createdAt ?? "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: input.updatedAt,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt:
      input.latestUserMessageAt === undefined
        ? "2026-06-01T00:00:00.000Z"
        : input.latestUserMessageAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function isoAtMinute(minute: number): string {
  return `2026-06-12T10:${String(minute).padStart(2, "0")}:00.000Z`;
}

describe("sanitizeThreadMentionTitle", () => {
  it("strips square brackets and parens", () => {
    expect(sanitizeThreadMentionTitle("Fix [WIP] (later) work")).toBe("Fix WIP later work");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeThreadMentionTitle("  hello\n  world\t ")).toBe("hello world");
  });

  it("caps the title at 50 characters", () => {
    expect(sanitizeThreadMentionTitle("a".repeat(60))).toBe("a".repeat(50));
  });

  it("trims trailing whitespace left by the 50-character cap", () => {
    expect(sanitizeThreadMentionTitle(`${"a".repeat(49)} bcd`)).toBe("a".repeat(49));
  });

  it("falls back to Untitled for empty, null, undefined, and stripped-to-empty titles", () => {
    expect(sanitizeThreadMentionTitle("")).toBe("Untitled");
    expect(sanitizeThreadMentionTitle("   ")).toBe("Untitled");
    expect(sanitizeThreadMentionTitle(null)).toBe("Untitled");
    expect(sanitizeThreadMentionTitle(undefined)).toBe("Untitled");
    expect(sanitizeThreadMentionTitle("()[]")).toBe("Untitled");
  });

  it("keeps @word and $word fragments intact", () => {
    expect(sanitizeThreadMentionTitle("ping @alice about $budget")).toBe(
      "ping @alice about $budget",
    );
  });
});

describe("buildThreadSessionFileUri", () => {
  it("percent-encodes spaces per segment while keeping slashes", () => {
    expect(
      buildThreadSessionFileUri(
        "/Users/dev/Library/Application Support/Honk/pi-agent/honk-thread-sessions/abc/2026-06-12T02-50-14-320Z_x.jsonl",
      ),
    ).toBe(
      "file:///Users/dev/Library/Application%20Support/Honk/pi-agent/honk-thread-sessions/abc/2026-06-12T02-50-14-320Z_x.jsonl",
    );
  });

  it("encodes parens as %28 and %29", () => {
    expect(buildThreadSessionFileUri("/tmp/dir (1)/file (copy).jsonl")).toBe(
      "file:///tmp/dir%20%281%29/file%20%28copy%29.jsonl",
    );
  });
});

describe("buildThreadMentionToken", () => {
  it("builds a [@title](file://...) token with a trailing space", () => {
    const token = buildThreadMentionToken("My thread", "/tmp/threads/session.jsonl");
    expect(token).toBe("[@My thread](file:///tmp/threads/session.jsonl) ");
    expect(token.endsWith(" ")).toBe(true);
  });

  it("round-trips through splitPromptIntoComposerSegments as one inline-token segment", () => {
    const token = buildThreadMentionToken(
      "Fix the (flaky) [auth] tests",
      "/Users/dev/Library/Application Support/honk-dev/pi-agent/honk-thread-sessions/a (1)/s.jsonl",
    );
    const markdown = token.slice(0, -1);

    expect(splitPromptIntoComposerSegments(token)).toEqual([
      {
        type: "inline-token",
        label: "Fix the flaky auth tests",
        sourceUri:
          "file:///Users/dev/Library/Application%20Support/honk-dev/pi-agent/honk-thread-sessions/a%20%281%29/s.jsonl",
        markdown,
      },
      { type: "text", text: " " },
    ]);
  });

  it("round-trips titles containing @word and $word without splitting extra segments", () => {
    const token = buildThreadMentionToken("ping @alice about $budget", "/tmp/threads/s.jsonl");
    const segments = splitPromptIntoComposerSegments(token);

    expect(segments).toEqual([
      {
        type: "inline-token",
        label: "ping @alice about $budget",
        sourceUri: "file:///tmp/threads/s.jsonl",
        markdown: token.slice(0, -1),
      },
      { type: "text", text: " " },
    ]);
  });

  it("round-trips when embedded mid-prompt thanks to the trailing space", () => {
    const token = buildThreadMentionToken("Old chat", "/tmp/threads/s.jsonl");
    expect(splitPromptIntoComposerSegments(`look at ${token}please`)).toEqual([
      { type: "text", text: "look at " },
      {
        type: "inline-token",
        label: "Old chat",
        sourceUri: "file:///tmp/threads/s.jsonl",
        markdown: token.slice(0, -1),
      },
      { type: "text", text: " please" },
    ]);
  });

  it("falls back to Untitled labels for empty titles", () => {
    expect(buildThreadMentionToken(null, "/tmp/threads/s.jsonl")).toBe(
      "[@Untitled](file:///tmp/threads/s.jsonl) ",
    );
  });
});

describe("buildPastThreadCandidates", () => {
  const baseOptions = {
    activeThreadId: null,
    environmentId,
    query: "",
  };

  it("filters to the environment, excludes the active thread, and requires latestUserMessageAt", () => {
    const activeThreadId = ThreadId.make("thread:active");
    const summaries = [
      makeSummary({ id: "thread:keep", latestUserMessageAt: isoAtMinute(3) }),
      makeSummary({
        id: "thread:other-env",
        environmentId: otherEnvironmentId,
        latestUserMessageAt: isoAtMinute(2),
      }),
      makeSummary({ id: "thread:active", latestUserMessageAt: isoAtMinute(1) }),
      makeSummary({ id: "thread:never-prompted", latestUserMessageAt: null }),
    ];

    const candidates = buildPastThreadCandidates(summaries, { ...baseOptions, activeThreadId });
    expect(candidates.map((candidate) => candidate.threadId)).toEqual([
      ThreadId.make("thread:keep"),
    ]);
  });

  it("returns plain records with description 'Past thread' and the recency sortKey", () => {
    const summaries = [
      makeSummary({ id: "thread:a", title: "Alpha", latestUserMessageAt: isoAtMinute(5) }),
    ];
    expect(buildPastThreadCandidates(summaries, baseOptions)).toEqual([
      {
        threadId: ThreadId.make("thread:a"),
        title: "Alpha",
        description: "Past thread",
        sortKey: isoAtMinute(5),
      },
    ]);
  });

  it("falls back to Untitled for blank titles", () => {
    const summaries = [
      makeSummary({ id: "thread:blank", title: "   ", latestUserMessageAt: isoAtMinute(1) }),
    ];
    const candidates = buildPastThreadCandidates(summaries, baseOptions);
    expect(candidates.map((candidate) => candidate.title)).toEqual(["Untitled"]);
  });

  it("sorts by latestUserMessageAt descending and returns the first 5 for an empty query", () => {
    const summaries = [1, 2, 3, 4, 5, 6, 7].map((minute) =>
      makeSummary({ id: `thread:${minute}`, latestUserMessageAt: isoAtMinute(minute) }),
    );

    const candidates = buildPastThreadCandidates(summaries, baseOptions);
    expect(candidates.map((candidate) => candidate.threadId)).toEqual([
      ThreadId.make("thread:7"),
      ThreadId.make("thread:6"),
      ThreadId.make("thread:5"),
      ThreadId.make("thread:4"),
      ThreadId.make("thread:3"),
    ]);
  });

  it("honors a custom limit", () => {
    const summaries = [1, 2, 3].map((minute) =>
      makeSummary({ id: `thread:${minute}`, latestUserMessageAt: isoAtMinute(minute) }),
    );
    expect(buildPastThreadCandidates(summaries, { ...baseOptions, limit: 2 })).toHaveLength(2);
  });

  it("caps the recency pool at 25 BEFORE query filtering", () => {
    const recent = Array.from({ length: 25 }, (_, index) =>
      makeSummary({
        id: `thread:recent-${index}`,
        title: `Recent ${index}`,
        latestUserMessageAt: isoAtMinute(30 + index),
      }),
    );
    const olderMatches = Array.from({ length: 5 }, (_, index) =>
      makeSummary({
        id: `thread:needle-${index}`,
        title: "Special needle",
        latestUserMessageAt: isoAtMinute(index),
      }),
    );

    const candidates = buildPastThreadCandidates([...olderMatches, ...recent], {
      ...baseOptions,
      query: "needle",
      limit: 25,
    });
    expect(candidates).toEqual([]);
  });

  it("ranks query matches by title with prefix beating boundary beating includes", () => {
    // The shared scorer adds match-position and length penalties on top of the
    // tier bases (prefix 2 / boundary 4 / includes 6), so titles are chosen so
    // penalties cannot cross tiers: "login work" prefix=9, "fix login"
    // boundary=18, "catalog work" includes=23, "unrelated" no match.
    const summaries = [
      makeSummary({
        id: "thread:includes",
        title: "catalog work",
        latestUserMessageAt: isoAtMinute(9),
      }),
      makeSummary({
        id: "thread:boundary",
        title: "fix login",
        latestUserMessageAt: isoAtMinute(8),
      }),
      makeSummary({
        id: "thread:prefix",
        title: "login work",
        latestUserMessageAt: isoAtMinute(7),
      }),
      makeSummary({ id: "thread:miss", title: "unrelated", latestUserMessageAt: isoAtMinute(6) }),
    ];

    const candidates = buildPastThreadCandidates(summaries, { ...baseOptions, query: "log" });
    expect(candidates.map((candidate) => candidate.threadId)).toEqual([
      ThreadId.make("thread:prefix"),
      ThreadId.make("thread:boundary"),
      ThreadId.make("thread:includes"),
    ]);
  });

  it("matches queries case-insensitively and ignores surrounding whitespace", () => {
    const summaries = [
      makeSummary({
        id: "thread:fix",
        title: "Fix login bug",
        latestUserMessageAt: isoAtMinute(1),
      }),
    ];
    const candidates = buildPastThreadCandidates(summaries, { ...baseOptions, query: "  FIX " });
    expect(candidates.map((candidate) => candidate.threadId)).toEqual([
      ThreadId.make("thread:fix"),
    ]);
  });

  it("breaks score ties by recency", () => {
    const summaries = [
      makeSummary({ id: "thread:older", title: "Same title", latestUserMessageAt: isoAtMinute(1) }),
      makeSummary({ id: "thread:newer", title: "Same title", latestUserMessageAt: isoAtMinute(2) }),
    ];

    const candidates = buildPastThreadCandidates(summaries, { ...baseOptions, query: "same" });
    expect(candidates.map((candidate) => candidate.threadId)).toEqual([
      ThreadId.make("thread:newer"),
      ThreadId.make("thread:older"),
    ]);
  });

  it("caps ranked query results at the limit", () => {
    const summaries = Array.from({ length: 8 }, (_, index) =>
      makeSummary({
        id: `thread:match-${index}`,
        title: `match ${index}`,
        latestUserMessageAt: isoAtMinute(index),
      }),
    );
    const candidates = buildPastThreadCandidates(summaries, {
      ...baseOptions,
      query: "match",
      limit: 3,
    });
    expect(candidates).toHaveLength(3);
  });
});
