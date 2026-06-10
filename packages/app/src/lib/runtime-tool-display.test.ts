import type { RuntimeDisplayTimelineToolDisplay } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { runtimeToolDisplaySignature } from "./runtime-tool-display";

const createdAt = "2026-06-05T20:30:00.000Z";

type RuntimeSubagentDisplay = Extract<RuntimeDisplayTimelineToolDisplay, { kind: "subagent" }>;

function runtimeSubagentDisplay(
  activities: RuntimeSubagentDisplay["activities"],
): RuntimeSubagentDisplay {
  return {
    kind: "subagent",
    mode: "single",
    agentScope: "project",
    projectAgentsDir: null,
    runs: [
      {
        subagentThreadId: "thread:child",
        agentId: "agent:child",
        nickname: "Research",
        role: "general-purpose",
        model: "gpt-5.5",
        prompt: "Inspect the renderer",
        state: "running",
        finalText: null,
        errorMessage: null,
      },
    ],
    activities,
  };
}

function parallelRuntimeSubagentDisplay(
  activities: RuntimeSubagentDisplay["activities"],
): RuntimeSubagentDisplay {
  return {
    kind: "subagent",
    mode: "parallel",
    agentScope: "project",
    projectAgentsDir: null,
    runs: [
      {
        subagentThreadId: "thread:child-a",
        agentId: "agent:child-a",
        nickname: "Research A",
        role: "general-purpose",
        model: "gpt-5.5",
        prompt: "Inspect renderer A",
        state: "running",
        finalText: null,
        errorMessage: null,
      },
      {
        subagentThreadId: "thread:child-b",
        agentId: "agent:child-b",
        nickname: "Research B",
        role: "general-purpose",
        model: "gpt-5.5",
        prompt: "Inspect renderer B",
        state: "running",
        finalText: null,
        errorMessage: null,
      },
    ],
    activities,
  };
}

function subagentActivity(
  sequence: number,
  detail: string,
): RuntimeSubagentDisplay["activities"][number] {
  return {
    id: `activity:${sequence}`,
    kind: "subagent.item.completed",
    tone: "info",
    summary: `Activity ${sequence}`,
    createdAt,
    sequence,
    payload: {
      subagentThreadId: "thread:child",
      parentThreadId: "thread:parent",
      parentItemId: "toolu-subagent",
      agentId: "agent:child",
      nickname: "Research",
      role: "general-purpose",
      model: "gpt-5.5",
      prompt: "Inspect the renderer",
      state: "running",
      itemType: "assistant_message",
      itemId: `item:${sequence}`,
      status: "completed",
      title: "Assistant message",
      detail,
      data: null,
    },
  };
}

function parallelSubagentActivity(input: {
  subagentThreadId: string;
  sequence: number;
  detail: string;
}): RuntimeSubagentDisplay["activities"][number] {
  return {
    ...subagentActivity(input.sequence, input.detail),
    id: `${input.subagentThreadId}:activity:${input.sequence}`,
    payload: {
      ...subagentActivity(input.sequence, input.detail).payload,
      subagentThreadId: input.subagentThreadId,
      agentId: `agent:${input.subagentThreadId}`,
      nickname: input.subagentThreadId.endsWith("a") ? "Research A" : "Research B",
      prompt: input.subagentThreadId.endsWith("a") ? "Inspect renderer A" : "Inspect renderer B",
      itemId: `${input.subagentThreadId}:item:${input.sequence}`,
    },
  };
}

describe("runtimeToolDisplaySignature", () => {
  it("includes grep and find count fields", () => {
    expect(
      runtimeToolDisplaySignature({
        kind: "grep",
        query: "ToolSearchArtifact",
        output: "packages/app/src/session-logic.ts\n 42: export interface ToolSearchArtifact {",
        totalMatched: 2,
        totalIndexedFiles: 100,
      }),
    ).not.toBe(
      runtimeToolDisplaySignature({
        kind: "grep",
        query: "ToolSearchArtifact",
        output: "packages/app/src/session-logic.ts\n 42: export interface ToolSearchArtifact {",
        totalMatched: 3,
        totalIndexedFiles: 100,
      }),
    );

    expect(
      runtimeToolDisplaySignature({
        kind: "find",
        query: "tool renderer",
        output: "packages/app/src/components/chat/message/tool-renderer.tsx",
        totalMatched: 1,
        totalIndexedFiles: 100,
        hasMore: false,
      }),
    ).not.toBe(
      runtimeToolDisplaySignature({
        kind: "find",
        query: "tool renderer",
        output: "packages/app/src/components/chat/message/tool-renderer.tsx",
        totalMatched: 1,
        totalIndexedFiles: 100,
        hasMore: true,
      }),
    );
  });

  it("keeps subagent activity comparison bounded to the visible tail", () => {
    const activities = Array.from({ length: 100 }, (_, index) =>
      subagentActivity(index + 1, `detail ${index + 1}`),
    );
    const changedOldActivity = activities.map((activity) =>
      activity.sequence === 1
        ? {
            ...activity,
            payload: {
              ...activity.payload,
              detail: "changed old detail",
            },
          }
        : activity,
    );
    const changedRecentActivity = activities.map((activity) =>
      activity.sequence === 50
        ? {
            ...activity,
            payload: {
              ...activity.payload,
              detail: "changed recent detail",
            },
          }
        : activity,
    );

    expect(runtimeToolDisplaySignature(runtimeSubagentDisplay(changedOldActivity))).toBe(
      runtimeToolDisplaySignature(runtimeSubagentDisplay(activities)),
    );
    expect(runtimeToolDisplaySignature(runtimeSubagentDisplay(changedRecentActivity))).not.toBe(
      runtimeToolDisplaySignature(runtimeSubagentDisplay(activities)),
    );
    expect(
      runtimeToolDisplaySignature(
        runtimeSubagentDisplay([...activities, subagentActivity(101, "new detail")]),
      ),
    ).not.toBe(runtimeToolDisplaySignature(runtimeSubagentDisplay(activities)));
    expect(
      runtimeToolDisplaySignature(
        runtimeSubagentDisplay([
          ...activities,
          {
            ...subagentActivity(101, "unrelated detail"),
            id: "thread:unrelated:activity:101",
            payload: {
              ...subagentActivity(101, "unrelated detail").payload,
              subagentThreadId: "thread:unrelated",
            },
          },
        ]),
      ),
    ).toBe(runtimeToolDisplaySignature(runtimeSubagentDisplay(activities)));
  });

  it("keeps subagent activity comparison bounded per subagent", () => {
    const childAActivities = Array.from({ length: 100 }, (_, index) =>
      parallelSubagentActivity({
        subagentThreadId: "thread:child-a",
        sequence: index + 1,
        detail: `child A detail ${index + 1}`,
      }),
    );
    const childBActivities = Array.from({ length: 100 }, (_, index) =>
      parallelSubagentActivity({
        subagentThreadId: "thread:child-b",
        sequence: index + 1,
        detail: `child B detail ${index + 1}`,
      }),
    );
    const activities = [...childAActivities, ...childBActivities];
    const changedChildARecentActivity = activities.map((activity) =>
      activity.payload.subagentThreadId === "thread:child-a" && activity.sequence === 50
        ? {
            ...activity,
            payload: {
              ...activity.payload,
              detail: "changed child A recent detail",
            },
          }
        : activity,
    );

    expect(
      runtimeToolDisplaySignature(parallelRuntimeSubagentDisplay(changedChildARecentActivity)),
    ).not.toBe(runtimeToolDisplaySignature(parallelRuntimeSubagentDisplay(activities)));
  });
});
