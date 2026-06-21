import { describe, expect, it } from "vitest";

import type { SubagentActivityDetails, SubagentToolDetails } from "@honk/contracts";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

import {
  capLiveSubagentActivities,
  compactSubagentActivityData,
  createSubagentExtension,
  MAX_LIVE_SUBAGENT_ACTIVITIES,
} from "../src/subagent-extension";

function makeActivity(sequence: number): SubagentActivityDetails {
  return {
    id: `activity-${sequence}`,
    kind: "subagent.item.updated",
    tone: "info",
    summary: `Activity ${sequence}`,
    createdAt: "2026-06-12T00:00:00.000Z",
    sequence,
    payload: {
      subagentThreadId: "subagent-thread",
      parentThreadId: "parent-thread",
      parentItemId: "parent-item",
      agentId: "general-purpose",
      nickname: "librarian",
      role: "researcher",
      model: null,
      prompt: "Investigate the bug",
      state: "running",
      itemType: null,
      itemId: null,
      status: null,
      title: null,
      detail: null,
      data: null,
    },
  };
}

function makeDetails(activityCount: number): SubagentToolDetails {
  return {
    mode: "parallel",
    runs: [],
    activities: Array.from({ length: activityCount }, (_, index) => makeActivity(index)),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

describe("capLiveSubagentActivities", () => {
  it("returns the same details when activities fit the live cap", () => {
    const details = makeDetails(MAX_LIVE_SUBAGENT_ACTIVITIES);
    expect(capLiveSubagentActivities(details)).toBe(details);
  });

  it("keeps only the most recent activities beyond the live cap", () => {
    const overflow = 120;
    const details = makeDetails(MAX_LIVE_SUBAGENT_ACTIVITIES + overflow);
    const capped = capLiveSubagentActivities(details);
    expect(capped.activities).toHaveLength(MAX_LIVE_SUBAGENT_ACTIVITIES);
    expect(capped.activities[0]?.sequence).toBe(overflow);
    expect(capped.activities.at(-1)?.sequence).toBe(MAX_LIVE_SUBAGENT_ACTIVITIES + overflow - 1);
    expect(capped.runs).toBe(details.runs);
    expect(capped.mode).toBe(details.mode);
  });
});

describe("compactSubagentActivityData", () => {
  it("drops bulky tool result bodies while preserving useful metadata", () => {
    const compacted = compactSubagentActivityData({
      type: "tool.completed",
      toolCallId: "call-read",
      toolName: "read",
      args: { path: "src/file.ts" },
      result: {
        content: [{ type: "text", text: "x".repeat(100_000) }],
        details: {
          truncation: {
            content: "x".repeat(100_000),
            omittedLines: 200,
          },
          fullOutputPath: "/tmp/output.log",
        },
      },
      isError: false,
    });

    expect(compacted).toEqual({
      type: "tool.completed",
      toolCallId: "call-read",
      toolName: "read",
      args: { path: "src/file.ts" },
      isError: false,
      result: {
        details: {
          truncation: {
            omittedLines: 200,
          },
          fullOutputPath: "/tmp/output.log",
        },
      },
    });
    expect(JSON.stringify(compacted)).not.toContain("xxxxx");
  });

  it("caps large metadata strings", () => {
    const compacted = compactSubagentActivityData({
      command: "printf hi",
      metadata: {
        summary: "a".repeat(8_000),
      },
    });

    const metadata = asRecord(compacted?.metadata);
    const summary = typeof metadata?.summary === "string" ? metadata.summary : "";
    expect(summary.length).toBeLessThan(8_000);
    expect(summary).toContain("[truncated]");
  });
});

describe("createSubagentExtension", () => {
  async function registerSubagentTool(): Promise<ToolDefinition> {
    const registeredTools: ToolDefinition[] = [];
    const extension = createSubagentExtension({ agentDir: "/tmp/honk-agent" });
    const pi = {
      registerTool(tool: ToolDefinition) {
        registeredTools.push(tool);
      },
    } as unknown as ExtensionAPI;

    await extension(pi);

    const registeredTool = registeredTools[0];
    if (!registeredTool) {
      throw new Error("Expected subagent tool to be registered");
    }
    return registeredTool;
  }

  it("guides models to omit agent for default Worker tasks and describe visible work", async () => {
    const registeredTool = await registerSubagentTool();
    expect(registeredTool?.description).toContain("Omit agent for the default Worker");
    expect(registeredTool?.promptSnippet).toContain("present-participle description");
    expect(registeredTool?.promptGuidelines).toContain(
      "Omit agent for normal Worker/default tasks; include a short visible description such as 'working through type errors'.",
    );
    expect(registeredTool?.description).toContain("use librarian for fast codebase research");
    expect(registeredTool?.promptGuidelines).toContain(
      "Use agent: 'librarian' for fast codebase reconnaissance and file/symbol mapping; pair it with a description such as 'researching session IDs'.",
    );
    expect(registeredTool?.promptGuidelines).toContain(
      "The legacy value 'general-purpose' is accepted but not preferred; omit agent for default Worker tasks instead.",
    );
  });

  it("rejects unknown agent types", async () => {
    const registeredTool = await registerSubagentTool();

    await expect(
      registeredTool.execute(
        "toolu-subagent",
        { prompt: "Inspect auth", agent: "custom-reviewer" },
        undefined,
        undefined,
        {} as ExtensionContext,
      ),
    ).rejects.toThrow('Unknown subagent agent type "custom-reviewer"');
  });
});
