import { ThreadEntryId, ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { activeTimelineCacheKey } from "./chat-view-timeline-cache";

describe("activeTimelineCacheKey", () => {
  it("stays stable when the live thread leaf advances", () => {
    const threadId = ThreadId.make("thread:timeline-cache");

    expect(
      activeTimelineCacheKey({
        id: threadId,
        leafId: ThreadEntryId.make("thread-entry:first"),
      }),
    ).toBe(
      activeTimelineCacheKey({
        id: threadId,
        leafId: ThreadEntryId.make("thread-entry:next"),
      }),
    );
  });

  it("returns an empty key while no thread is active", () => {
    expect(activeTimelineCacheKey(null)).toBe("");
  });
});
