import type { SessionListSummary } from "~/lib/ui-session-types";
import { assert, it } from "vitest";

import { buildWorkspaceChatSections } from "./sidebar-chat-view-model";

function sum(id: string, cwd: string, modifiedAt: string): SessionListSummary {
  return {
    id,
    harness: "codex",
    path: cwd,
    cwd,
    name: id,
    createdAt: modifiedAt,
    modifiedAt,
    messageCount: 1,
    firstMessage: id,
    allMessagesText: id,
    isStreaming: false,
  };
}

it("buildWorkspaceChatSections does not reorder workspace sections when cwd changes", () => {
  const sums = {
    a: sum("a", "/ws/a", "2026-04-08T10:00:00.000Z"),
    b: sum("b", "/ws/b", "2026-04-08T09:00:00.000Z"),
  };

  const first = buildWorkspaceChatSections(sums, [], "/ws/a", "/Users/workgyver");
  const second = buildWorkspaceChatSections(sums, [], "/ws/b", "/Users/workgyver");

  assert.deepEqual(
    first.map((section) => section.cwd),
    ["/ws/a", "/ws/b"],
  );
  assert.deepEqual(
    second.map((section) => section.cwd),
    ["/ws/a", "/ws/b"],
  );
  assert.equal(first[0]?.label, "ws/a");
  assert.equal(second[1]?.label, "ws/b");
});
