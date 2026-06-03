import { EnvironmentId, ThreadId } from "@multi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../../../session-logic";
import { ToolCallMessage } from "./tool-message";

const createdAt = "2026-06-03T21:13:00.000Z";

function renderWorkEntry(workEntry: WorkLogEntry): string {
  return renderToStaticMarkup(
    <ToolCallMessage
      workEntry={workEntry}
      projectRoot="/Users/workgyver/Developer/multi"
      activeThreadId={ThreadId.make("thread:thinking-markdown")}
      environmentId={EnvironmentId.make("environment:thinking-markdown")}
    />,
  );
}

describe("ToolCallMessage thinking entries", () => {
  it("renders thought detail as markdown instead of a truncated status label", () => {
    const html = renderWorkEntry({
      id: "thought:1",
      createdAt,
      label: "Thinking",
      detail: "**Considering package inspection** I need to inspect the package.",
      tone: "thinking",
      status: "completed",
    });

    expect(html).toContain("data-thinking-markdown");
    expect(html).toContain("<strong");
    expect(html).toContain("Considering package inspection");
    expect(html).not.toContain("Thought -");
  });
});
