import { createOpenCodeServer, openCodeSessionRef } from "@honk/opencode";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const watchState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../use-sdk-watch", () => ({
  useSessionWatch: () => ({ state: watchState.current, status: "live" }),
}));

import type { AppChildSessionSummary } from "../open-code-view";
import { ActiveSubagentRequestDetail, ActiveSubagents } from "./active-subagents";
import { ThreadRuntimeContext } from "./runtime";
import type { TaskChildLink } from "./subagent-session";
import type { ThreadPart, ToolPart } from "./transcript-model";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });

function child(id: string, needsAttention: boolean): AppChildSessionSummary {
  return {
    id,
    server: server.key,
    agent: "honk-read-thread",
    model: null,
    title: `Mission ${id}`,
    status: "running",
    needsAttention,
    archivedAt: null,
    updatedAt: new Date(2).toISOString(),
    revertMessageId: null,
    projectId: null,
    projectDirectory: "/repo",
    location: { directory: "/repo" },
    worktree: null,
    parentSessionId: "session-parent",
  };
}

function taskPart(id: string): ToolPart {
  return {
    id,
    sessionID: "session-parent",
    messageID: "message-parent",
    type: "tool",
    callID: `call-${id}`,
    tool: "task",
    state: {
      status: "running",
      input: { description: `Mission ${id}`, subagent_type: "honk-read-thread" },
      time: { start: 1 },
    },
  } as ToolPart;
}

function render(links: readonly TaskChildLink[], parts: readonly ThreadPart[]): string {
  return renderToStaticMarkup(
    <ThreadRuntimeContext.Provider
      value={{
        ref: openCodeSessionRef(server.key, "session-parent"),
        client: null,
        tabKey: "session-parent",
      }}
    >
      <ActiveSubagents links={links} parts={parts} onSelect={() => undefined} />
    </ThreadRuntimeContext.Provider>,
  );
}

function link(id: string, needsAttention: boolean): TaskChildLink {
  return { partID: id, child: child(id, needsAttention), ownsLiveState: true, state: "running" };
}

describe("active subagents", () => {
  it("counts working subagents while none are blocked", () => {
    const html = render(
      [link("part-a", false), link("part-b", false)],
      [taskPart("part-a"), taskPart("part-b")],
    );

    expect(html).toContain("2 working");
    expect(html).toContain("2 subagents working. Show active subagents");
    expect(html).not.toContain("needs you");
  });

  it("leads with the blocked subagent so it cannot read as merely working", () => {
    const html = render(
      [link("part-a", false), link("part-b", true)],
      [taskPart("part-a"), taskPart("part-b")],
    );

    expect(html).toContain("1 needs you");
    expect(html).toContain("1 subagent needs you, 1 working. Show active subagents");
    expect(html).not.toContain("2 working");
  });

  it("does not describe an all-blocked group as working", () => {
    const html = render(
      [link("part-a", true), link("part-b", true)],
      [taskPart("part-a"), taskPart("part-b")],
    );

    expect(html).toContain("2 need you");
    expect(html).toContain("2 subagents need you. Show active subagents");
    expect(html).not.toContain("working");
  });

  it("names the blocked request in the row's secondary line", () => {
    watchState.current = {
      app: {
        summary: { status: "running" },
        messages: [],
        parts: [],
        permissions: [{ id: "per_1", action: "bash", resources: ["pnpm test"] }],
        questions: [],
      },
      attachedDirectories: [],
      activity: "busy",
    };

    expect(
      renderToStaticMarkup(
        <ActiveSubagentRequestDetail server={server.key} childID="session-child" />,
      ),
    ).toContain("Needs you — bash");
    watchState.current = null;
  });
});
