import { EnvironmentId, ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { scopeThreadRef } from "~/lib/environment-scope";
import { DraftId } from "~/stores/chat-drafts";
import { getCurrentRouteTarget, resolveThreadRouteTarget } from "./thread-route-targets";

const environmentId = EnvironmentId.make("environment:test");
const threadId = ThreadId.make("thread:test");
const draftId = DraftId.make("draft:test");

describe("thread route targets", () => {
  it("parses server thread route params into a scoped thread ref", () => {
    expect(resolveThreadRouteTarget({ environmentId, threadId })).toEqual({
      kind: "server",
      threadRef: scopeThreadRef(environmentId, threadId),
    });
  });

  it("parses draft route params into a draft target", () => {
    expect(resolveThreadRouteTarget({ draftId })).toEqual({
      kind: "draft",
      draftId,
    });
  });

  it("returns null when the current route is not a chat target", () => {
    expect(
      getCurrentRouteTarget({
        state: {
          matches: [{ params: {} }],
        },
      }),
    ).toBeNull();
  });
});
