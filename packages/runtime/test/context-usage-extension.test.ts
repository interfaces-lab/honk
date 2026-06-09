import type { ThreadTokenUsageSnapshot } from "@multi/contracts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { createContextUsageExtension } from "../src/context-usage-extension";

interface MockTool {
  readonly name: string;
  readonly description: string;
  readonly parameters?: unknown;
  readonly promptGuidelines?: readonly string[];
}

interface MockSessionEntry {
  readonly type: string;
  readonly message?: unknown;
  readonly summary?: string;
}

interface MockExtensionContext {
  readonly getContextUsage: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  readonly model: { contextWindow: number } | undefined;
  readonly sessionManager: { getBranch: () => MockSessionEntry[] };
}

function makeUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function makeContext(input: {
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly entries?: MockSessionEntry[];
}): MockExtensionContext {
  return {
    getContextUsage: () => ({
      tokens: input.tokens,
      contextWindow: input.contextWindow,
      percent: null,
    }),
    model: { contextWindow: input.contextWindow },
    sessionManager: { getBranch: () => input.entries ?? [] },
  };
}

function createHarness(tools: MockTool[] = []) {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const snapshots: ThreadTokenUsageSnapshot[] = [];
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers.set(event, handler);
    },
    getAllTools: () => tools,
  } as unknown as ExtensionAPI;

  void createContextUsageExtension({
    publish: (snapshot) => {
      snapshots.push(snapshot);
    },
  })(pi);

  return {
    snapshots,
    emit(type: string, event: unknown, ctx?: MockExtensionContext) {
      const handler = handlers.get(type);
      expect(handler, `expected a handler for ${type}`).toBeDefined();
      handler!(event, ctx);
    },
  };
}

function categoryTokens(snapshot: ThreadTokenUsageSnapshot, id: string): number | undefined {
  return snapshot.categories?.find((category) => category.id === id)?.tokens;
}

describe("context usage extension", () => {
  it("publishes a categorized snapshot at turn end", () => {
    const harness = createHarness([
      { name: "read", description: "x".repeat(400), parameters: { a: "b" } },
      { name: "subagent", description: "y".repeat(200) },
      { name: "mcp__linear__search", description: "z".repeat(100) },
    ]);
    const ctx = makeContext({ tokens: 60_000, contextWindow: 200_000 });

    harness.emit(
      "before_agent_start",
      {
        systemPrompt: "p".repeat(4_000),
        systemPromptOptions: {
          cwd: "/tmp",
          contextFiles: [{ path: "AGENTS.md", content: "r".repeat(400) }],
          skills: [{ name: "s".repeat(40), description: "d".repeat(160) }],
        },
      },
      ctx,
    );
    harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: Date.now() }, ctx);
    harness.emit("tool_execution_end", { toolName: "read", isError: false }, ctx);
    harness.emit("tool_execution_end", { toolName: "read", isError: false }, ctx);
    harness.emit(
      "turn_end",
      {
        turnIndex: 0,
        message: { role: "assistant", usage: makeUsage(50_000, 1_500, 8_000) },
        toolResults: [],
      },
      ctx,
    );

    expect(harness.snapshots).toHaveLength(1);
    const snapshot = harness.snapshots[0]!;
    expect(snapshot.usedTokens).toBe(60_000);
    expect(snapshot.maxTokens).toBe(200_000);
    expect(snapshot.toolUses).toBe(2);
    expect(snapshot.inputTokens).toBe(50_000);
    expect(snapshot.cachedInputTokens).toBe(8_000);
    expect(snapshot.outputTokens).toBe(1_500);
    expect(snapshot.lastUsedTokens).toBe(59_500);
    expect(snapshot.lastInputTokens).toBe(50_000);
    expect(snapshot.compactsAutomatically).toBe(true);
    expect(snapshot.durationMs).toBeGreaterThanOrEqual(0);

    // 4000/4 minus rules (100) and skills (50).
    expect(categoryTokens(snapshot, "system_prompt")).toBe(850);
    expect(categoryTokens(snapshot, "rules")).toBe(100);
    expect(categoryTokens(snapshot, "skills")).toBe(50);
    expect(categoryTokens(snapshot, "subagents")).toBeGreaterThan(0);
    expect(categoryTokens(snapshot, "mcp")).toBeGreaterThan(0);
    expect(categoryTokens(snapshot, "tool_definitions")).toBeGreaterThan(0);

    const total = snapshot.categories!.reduce((sum, category) => sum + category.tokens, 0);
    expect(categoryTokens(snapshot, "conversation")).toBeGreaterThan(0);
    expect(total).toBe(60_000);
  });

  it("scales static categories down when estimates exceed reported usage", () => {
    const harness = createHarness();
    const ctx = makeContext({ tokens: 100, contextWindow: 200_000 });

    harness.emit(
      "before_agent_start",
      {
        systemPrompt: "p".repeat(40_000),
        systemPromptOptions: { cwd: "/tmp" },
      },
      ctx,
    );
    harness.emit(
      "turn_end",
      {
        turnIndex: 0,
        message: { role: "assistant", usage: makeUsage(80, 20) },
        toolResults: [],
      },
      ctx,
    );

    const snapshot = harness.snapshots.at(-1)!;
    const total = snapshot.categories!.reduce((sum, category) => sum + category.tokens, 0);
    expect(total).toBeLessThanOrEqual(100);
    expect(snapshot.usedTokens).toBe(100);
  });

  it("includes summarized conversation after compaction", () => {
    const harness = createHarness();
    const ctx = makeContext({ tokens: 5_000, contextWindow: 200_000 });

    harness.emit(
      "session_compact",
      { compactionEntry: { summary: "m".repeat(2_000) }, fromExtension: false },
      ctx,
    );
    harness.emit(
      "turn_end",
      {
        turnIndex: 1,
        message: { role: "assistant", usage: makeUsage(4_000, 1_000) },
        toolResults: [],
      },
      ctx,
    );

    const snapshot = harness.snapshots.at(-1)!;
    expect(categoryTokens(snapshot, "summarized_conversation")).toBe(500);
  });

  it("seeds usage from restored session entries on session start", () => {
    const harness = createHarness();
    const ctx = makeContext({
      tokens: 42_000,
      contextWindow: 200_000,
      entries: [
        { type: "message", message: { role: "user", content: "hi" } },
        { type: "message", message: { role: "assistant", usage: makeUsage(10_000, 500, 2_000) } },
        { type: "message", message: { role: "toolResult", toolName: "read" } },
        { type: "compaction", summary: "c".repeat(400) },
        { type: "message", message: { role: "assistant", usage: makeUsage(30_000, 1_000, 9_000) } },
      ],
    });

    harness.emit("session_start", { type: "session_start", reason: "resume" }, ctx);

    expect(harness.snapshots).toHaveLength(1);
    const snapshot = harness.snapshots[0]!;
    expect(snapshot.usedTokens).toBe(42_000);
    expect(snapshot.inputTokens).toBe(40_000);
    expect(snapshot.cachedInputTokens).toBe(11_000);
    expect(snapshot.outputTokens).toBe(1_500);
    expect(snapshot.toolUses).toBe(1);
    expect(snapshot.lastUsedTokens).toBe(40_000);
    expect(categoryTokens(snapshot, "summarized_conversation")).toBe(100);
  });

  it("does not publish without assistant usage", () => {
    const harness = createHarness();
    const ctx = makeContext({ tokens: null, contextWindow: 200_000 });

    harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
    harness.emit(
      "turn_end",
      {
        turnIndex: 0,
        message: { role: "assistant", usage: makeUsage(0, 0) },
        toolResults: [],
      },
      ctx,
    );
    harness.emit(
      "turn_end",
      { turnIndex: 1, message: { role: "user", content: "hello" }, toolResults: [] },
      ctx,
    );

    expect(harness.snapshots).toHaveLength(0);
  });
});
