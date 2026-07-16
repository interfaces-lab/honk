import { createOpenCodeServer } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import type { AppChildSessionSummary } from "../open-code-view";
import type { ToolPart } from "./transcript-model";
import { projectTaskChildLinks, resolveTaskChildSession, taskSessionID } from "./subagent-session";

const local = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });
const remote = createOpenCodeServer({ origin: "https://example.test" });

function child(input: {
  readonly id: string;
  readonly parentSessionId?: string;
  readonly agent?: string;
  readonly remote?: boolean;
  readonly status?: AppChildSessionSummary["status"];
}): AppChildSessionSummary {
  return {
    id: input.id,
    server: input.remote === true ? remote.key : local.key,
    agent: input.agent ?? "honk-sidekick-medium",
    title: input.id,
    status: input.status ?? "idle",
    needsAttention: false,
    archivedAt: null,
    updatedAt: new Date(1).toISOString(),
    projectId: null,
    projectDirectory: "/repo",
    location: { directory: "/repo" },
    worktree: null,
    parentSessionId: input.parentSessionId ?? "ses_parent",
  };
}

function task(input: {
  readonly id?: string;
  readonly taskID?: string;
  readonly metadataID?: string;
  readonly partMetadataID?: string;
  readonly agent?: string;
  readonly status?: ToolPart["state"]["status"];
}): ToolPart {
  const id = input.id ?? "part_task";
  const common = {
    id,
    sessionID: "ses_parent",
    messageID: "msg_parent",
    type: "tool" as const,
    callID: `call_${id}`,
    tool: "task",
    ...(input.partMetadataID === undefined
      ? {}
      : { metadata: { sessionID: input.partMetadataID } }),
  };
  const taskInput = {
    ...(input.taskID === undefined ? {} : { task_id: input.taskID }),
    ...(input.agent === undefined ? {} : { subagent_type: input.agent }),
  };
  const metadata = input.metadataID === undefined ? {} : { sessionId: input.metadataID };
  if (input.status === "pending") {
    return { ...common, state: { status: "pending", input: taskInput, raw: "{}" } };
  }
  if (input.status === "running") {
    return {
      ...common,
      state: { status: "running", input: taskInput, metadata, time: { start: 1 } },
    };
  }
  if (input.status === "error") {
    return {
      ...common,
      state: {
        status: "error",
        input: taskInput,
        error: "Task failed",
        metadata,
        time: { start: 1, end: 2 },
      },
    };
  }
  return {
    ...common,
    state: {
      status: "completed",
      input: taskInput,
      output: "Done",
      title: "Task",
      metadata,
      time: { start: 1, end: 2 },
    },
  };
}

describe("task child-session resolution", () => {
  it("uses the child id emitted by task metadata before the resume input", () => {
    const part = task({ metadataID: "ses_current", taskID: "ses_stale" });
    expect(taskSessionID(part)).toBe("ses_current");
    expect(
      resolveTaskChildSession({
        part,
        children: [child({ id: "ses_current" }), child({ id: "ses_stale" })],
        parentSessionID: "ses_parent",
        server: local.key,
      })?.id,
    ).toBe("ses_current");
  });

  it("uses task_id for a resumed persistent child", () => {
    const part = task({ taskID: "ses_child" });
    expect(taskSessionID(part)).toBe("ses_child");
  });

  it("accepts the observed top-level task metadata shape", () => {
    expect(taskSessionID(task({ partMetadataID: "ses_child" }))).toBe("ses_child");
  });

  it("falls back only to one server-qualified child with the observed agent", () => {
    const part = task({ agent: "honk-sidekick-high" });
    expect(
      resolveTaskChildSession({
        part,
        children: [
          child({ id: "ses_match", agent: "honk-sidekick-high" }),
          child({ id: "ses_other", agent: "honk-sidekick-medium" }),
          child({ id: "ses_remote", agent: "honk-sidekick-high", remote: true }),
        ],
        parentSessionID: "ses_parent",
        server: local.key,
      })?.id,
    ).toBe("ses_match");
  });

  it("does not guess when matching children are ambiguous or an explicit id is missing", () => {
    const children = [child({ id: "ses_one" }), child({ id: "ses_two" })];
    expect(
      resolveTaskChildSession({
        part: task({ agent: "honk-sidekick-medium" }),
        children,
        parentSessionID: "ses_parent",
        server: local.key,
      }),
    ).toBeNull();
    expect(
      resolveTaskChildSession({
        part: task({}),
        children: [child({ id: "ses_only" })],
        parentSessionID: "ses_parent",
        server: local.key,
      }),
    ).toBeNull();
    expect(
      resolveTaskChildSession({
        part: task({ metadataID: "ses_missing" }),
        children,
        parentSessionID: "ses_parent",
        server: local.key,
      }),
    ).toBeNull();
  });
});

describe("task child-session projection", () => {
  it("lets only the last call for a child own its live running state", () => {
    const parts = [
      task({ id: "part_old", taskID: "ses_child" }),
      task({ id: "part_current", taskID: "ses_child" }),
    ];
    const project = (status: AppChildSessionSummary["status"]) =>
      projectTaskChildLinks({
        parts,
        children: [child({ id: "ses_child", status })],
        parentSessionID: "ses_parent",
        server: local.key,
      });

    expect(project("running")).toMatchObject([
      { partID: "part_old", ownsLiveState: false, state: "done" },
      { partID: "part_current", ownsLiveState: true, state: "running" },
    ]);
    expect(project("idle")).toMatchObject([
      { partID: "part_old", ownsLiveState: false, state: "done" },
      { partID: "part_current", ownsLiveState: true, state: "done" },
    ]);
    expect(project("failed")).toMatchObject([
      { partID: "part_old", ownsLiveState: false, state: "done" },
      { partID: "part_current", ownsLiveState: true, state: "failed" },
    ]);
  });

  it("keeps task error and in-flight part states independent of child activity", () => {
    expect(
      projectTaskChildLinks({
        parts: [
          task({ id: "part_error", taskID: "ses_child", status: "error" }),
          task({ id: "part_pending", taskID: "ses_child", status: "pending" }),
        ],
        children: [child({ id: "ses_child" })],
        parentSessionID: "ses_parent",
        server: local.key,
      }),
    ).toMatchObject([
      { partID: "part_error", ownsLiveState: false, state: "failed" },
      { partID: "part_pending", ownsLiveState: true, state: "running" },
    ]);
  });

  it("omits unresolved tasks instead of assigning an unrelated child", () => {
    expect(
      projectTaskChildLinks({
        parts: [
          task({ id: "part_missing", taskID: "ses_missing" }),
          task({ id: "part_known", taskID: "ses_known" }),
        ],
        children: [child({ id: "ses_known" })],
        parentSessionID: "ses_parent",
        server: local.key,
      }).map((link) => link.partID),
    ).toEqual(["part_known"]);
  });

  it("qualifies identical child ids by server", () => {
    const links = projectTaskChildLinks({
      parts: [task({ taskID: "ses_shared" })],
      children: [
        child({ id: "ses_shared", status: "running" }),
        child({ id: "ses_shared", remote: true }),
      ],
      parentSessionID: "ses_parent",
      server: remote.key,
    });

    expect(links).toHaveLength(1);
    expect(links[0]?.child.server).toBe(remote.key);
    expect(links[0]?.state).toBe("done");
  });
});
