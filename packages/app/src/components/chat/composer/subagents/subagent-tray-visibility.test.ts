import { ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import { deriveSubagentTrayVirtualRows, shouldPresentSubagentTray } from "./subagent-tray";
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

describe("deriveSubagentTrayVirtualRows", () => {
  it("merges transcript rows and visible logs chronologically", () => {
    const rows = deriveSubagentTrayVirtualRows({
      isStreaming: false,
      streamingLogId: undefined,
      items: [
        {
          id: "older-transcript",
          itemId: "older-transcript",
          kind: "message",
          role: "assistant",
          text: "Older transcript",
          loading: false,
          createdAt: "2026-06-05T20:00:01.000Z",
          sequence: 0,
        },
        {
          id: "newer-transcript",
          itemId: "newer-transcript",
          kind: "message",
          role: "assistant",
          text: "Newer transcript",
          loading: false,
          createdAt: "2026-06-05T20:00:03.000Z",
          sequence: 1,
        },
      ],
      logs: [
        {
          id: "middle-log",
          kind: "subagent.thread.state.changed",
          label: "State changed",
          detail: "active",
          createdAt: "2026-06-05T20:00:02.000Z",
        },
      ],
    });

    expect(rows.map((row) => row.id)).toEqual([
      "transcript:older-transcript",
      "log:middle-log",
      "transcript:newer-transcript",
    ]);
  });
});
