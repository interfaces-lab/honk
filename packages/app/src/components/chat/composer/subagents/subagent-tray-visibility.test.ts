import { ThreadId } from "@honk/contracts";
import { describe, expect, it } from "vitest";

import { shouldPresentSubagentTray } from "./subagent-tray";
import { shouldShowSubagentTrayForComposer } from "./subagent-tray-visibility";

const parentThreadId = ThreadId.make("thread:parent");
const otherThreadId = ThreadId.make("thread:other");

describe("shouldShowSubagentTrayForComposer", () => {
  it("keeps subagent details reachable from thread composers", () => {
    expect(shouldShowSubagentTrayForComposer({ isInlineEditComposer: false })).toBe(true);
  });

  it("hides subagent details for inline edit composers", () => {
    expect(shouldShowSubagentTrayForComposer({ isInlineEditComposer: true })).toBe(false);
  });
});

describe("shouldPresentSubagentTray", () => {
  it("presents a visible focused tray for the active thread", () => {
    expect(
      shouldPresentSubagentTray({
        activeThreadId: parentThreadId,
        trayActiveThreadId: parentThreadId,
        hasFocus: true,
        visible: true,
      }),
    ).toBe(true);
  });

  it("does not present a tray for another thread", () => {
    expect(
      shouldPresentSubagentTray({
        activeThreadId: parentThreadId,
        trayActiveThreadId: otherThreadId,
        hasFocus: true,
        visible: true,
      }),
    ).toBe(false);
  });
});
