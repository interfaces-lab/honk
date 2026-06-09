import { MessageId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { type MessagesTimelineRow } from "./timeline-rows";
import {
  LAST_PAIR_MIN_HEIGHT_FLOOR_PX,
  LAST_PAIR_MIN_HEIGHT_RATIO,
  NEAR_BOTTOM_THRESHOLD_PX,
  PIN_SNAP_THRESHOLD_PX,
  TIMELINE_ROW_GAP_PX,
  USER_SCROLL_INPUT_WINDOW_MS,
  computeDynamicPaddingEndPx,
  computeLastPairMinHeightPx,
  computeLastTurnContentHeightPx,
  computePinnedState,
  shouldAdjustScrollOnItemResize,
  type TimelinePinnedStateEvent,
  type TimelineScrollFollowState,
} from "./timeline-scroll-follow";

const createdAt = "2026-06-05T20:30:00.000Z";

function row(id: string): MessagesTimelineRow {
  return {
    kind: "message",
    id,
    createdAt,
    message: {
      id: MessageId.make(id),
      role: "user",
      text: id,
      createdAt,
      streaming: false,
    },
    durationStart: createdAt,
    editAvailable: false,
    messageIndex: 0,
    pairId: null,
  };
}

function pinnedEvent(
  overrides: Partial<TimelinePinnedStateEvent> = {},
): TimelinePinnedStateEvent {
  return {
    totalHeight: 1000,
    clampedOffset: 280,
    viewportHeight: 720,
    isScrolling: false,
    lastObservedScrollOffset: 280,
    isUserPointerDown: false,
    msSinceUserScrollInput: Number.POSITIVE_INFINITY,
    isReady: true,
    isProgrammaticScrollActive: false,
    ...overrides,
  };
}

describe("timeline scroll-follow constants", () => {
  it("matches Cursor bundle values", () => {
    expect(TIMELINE_ROW_GAP_PX).toBe(12);
    expect(LAST_PAIR_MIN_HEIGHT_RATIO).toBe(0.6);
    expect(LAST_PAIR_MIN_HEIGHT_FLOOR_PX).toBe(120);
    expect(NEAR_BOTTOM_THRESHOLD_PX).toBe(4);
    expect(USER_SCROLL_INPUT_WINDOW_MS).toBe(250);
    expect(PIN_SNAP_THRESHOLD_PX).toBe(1);
  });
});

describe("computeLastPairMinHeightPx", () => {
  it("returns 0 for a zero-height viewport", () => {
    expect(computeLastPairMinHeightPx(0)).toBe(0);
  });

  it("applies the 60% ratio after subtracting scroll inset", () => {
    expect(computeLastPairMinHeightPx(721, 1)).toBeCloseTo(720 * LAST_PAIR_MIN_HEIGHT_RATIO);
  });

  it("uses the 120px floor when the ratio result is smaller", () => {
    expect(computeLastPairMinHeightPx(200, 1)).toBe(LAST_PAIR_MIN_HEIGHT_FLOOR_PX);
  });
});

describe("computeLastTurnContentHeightPx", () => {
  it("returns 0 when there is no last human row", () => {
    const rows = [row("a"), row("b")];
    const measuredHeights = new Map([
      ["a", 40],
      ["b", 60],
    ]);

    expect(computeLastTurnContentHeightPx(rows, measuredHeights, undefined)).toBe(0);
    expect(computeLastTurnContentHeightPx(rows, measuredHeights, -1)).toBe(0);
  });

  it("sums measured heights from the last human row through the end", () => {
    const rows = [row("human"), row("assistant"), row("tool")];
    const measuredHeights = new Map([
      ["human", 80],
      ["assistant", 120],
      ["tool", 40],
    ]);

    expect(computeLastTurnContentHeightPx(rows, measuredHeights, 0)).toBe(
      80 + 120 + 40 + 2 * TIMELINE_ROW_GAP_PX,
    );
  });

  it("counts only rows from the provided last human index", () => {
    const rows = [row("older-human"), row("assistant"), row("latest-human"), row("tool")];
    const measuredHeights = new Map([
      ["older-human", 50],
      ["assistant", 70],
      ["latest-human", 90],
      ["tool", 30],
    ]);

    expect(computeLastTurnContentHeightPx(rows, measuredHeights, 2)).toBe(
      90 + 30 + TIMELINE_ROW_GAP_PX,
    );
  });

  it("treats missing measurements as zero height", () => {
    const rows = [row("human"), row("assistant")];
    const measuredHeights = new Map([["human", 64]]);

    expect(computeLastTurnContentHeightPx(rows, measuredHeights, 0)).toBe(
      64 + TIMELINE_ROW_GAP_PX,
    );
  });

  it("falls back to row estimates when measurements are missing", () => {
    const rows = [row("human"), row("assistant")];

    expect(computeLastTurnContentHeightPx(rows, new Map(), 0, () => 96)).toBe(
      96 + 96 + TIMELINE_ROW_GAP_PX,
    );
  });
});

describe("computeDynamicPaddingEndPx", () => {
  it("returns base padding when the last turn already fills the min height", () => {
    expect(
      computeDynamicPaddingEndPx({
        basePadding: 88,
        lastTurnHeight: 420,
        minHeight: 400,
      }),
    ).toBe(88);
  });

  it("pads up when the last turn is shorter than the min height", () => {
    expect(
      computeDynamicPaddingEndPx({
        basePadding: 88,
        lastTurnHeight: 140,
        minHeight: 400,
      }),
    ).toBe(260);
  });

  it("never returns less than base padding", () => {
    expect(
      computeDynamicPaddingEndPx({
        basePadding: 120,
        lastTurnHeight: 360,
        minHeight: 400,
      }),
    ).toBe(120);
  });
});

describe("computePinnedState", () => {
  const pinnedAtBottom: TimelineScrollFollowState = { pinned: true, atBottom: true };

  it("unpins when the user scrolls up with recent input away from bottom", () => {
    const next = computePinnedState(
      pinnedAtBottom,
      pinnedEvent({
        clampedOffset: 100,
        lastObservedScrollOffset: 200,
        isScrolling: true,
        isUserPointerDown: true,
        totalHeight: 1000,
        viewportHeight: 720,
      }),
    );

    expect(next).toEqual({ pinned: false, atBottom: false });
  });

  it("does not unpin during programmatic scroll", () => {
    const next = computePinnedState(
      pinnedAtBottom,
      pinnedEvent({
        clampedOffset: 100,
        lastObservedScrollOffset: 200,
        isScrolling: true,
        isUserPointerDown: true,
        isProgrammaticScrollActive: true,
        totalHeight: 1000,
        viewportHeight: 720,
      }),
    );

    expect(next).toEqual({ pinned: true, atBottom: false });
  });

  it("does not unpin when the user is still near bottom", () => {
    const next = computePinnedState(
      pinnedAtBottom,
      pinnedEvent({
        clampedOffset: 276,
        lastObservedScrollOffset: 280,
        isScrolling: true,
        isUserPointerDown: true,
        totalHeight: 1000,
        viewportHeight: 720,
      }),
    );

    expect(next).toEqual({ pinned: true, atBottom: true });
  });

  it("re-pins when settled at bottom after being unpinned", () => {
    const next = computePinnedState(
      { pinned: false, atBottom: false },
      pinnedEvent({
        clampedOffset: 276,
        lastObservedScrollOffset: 276,
        isScrolling: false,
        totalHeight: 1000,
        viewportHeight: 720,
      }),
    );

    expect(next).toEqual({ pinned: true, atBottom: true });
  });

  it("keeps pinned false while scrolling even if near bottom", () => {
    const next = computePinnedState(
      { pinned: false, atBottom: false },
      pinnedEvent({
        clampedOffset: 276,
        lastObservedScrollOffset: 276,
        isScrolling: true,
        totalHeight: 1000,
        viewportHeight: 720,
      }),
    );

    expect(next).toEqual({ pinned: false, atBottom: true });
  });

  it("treats recent wheel/touch input within the 250ms window as user intent", () => {
    const next = computePinnedState(
      pinnedAtBottom,
      pinnedEvent({
        clampedOffset: 120,
        lastObservedScrollOffset: 220,
        isScrolling: true,
        msSinceUserScrollInput: USER_SCROLL_INPUT_WINDOW_MS,
        totalHeight: 1000,
        viewportHeight: 720,
      }),
    );

    expect(next).toEqual({ pinned: false, atBottom: false });
  });

  it("supports simplified scroll events for timeline integration", () => {
    expect(
      computePinnedState({ pinned: true, atBottom: true }, { type: "repin" }),
    ).toEqual({ pinned: true, atBottom: true });

    expect(
      computePinnedState(
        { pinned: true, atBottom: true },
        {
          type: "scroll",
          scrollOffset: 100,
          maxScrollOffset: 500,
          scrollDelta: -20,
          now: 1_000,
          lastUserInputAt: 1_000 - USER_SCROLL_INPUT_WINDOW_MS + 1,
        },
      ),
    ).toEqual({ pinned: false, atBottom: false });
  });
});

describe("shouldAdjustScrollOnItemResize", () => {
  it("adjusts above-viewport items while streaming and not pinned-following", () => {
    expect(
      shouldAdjustScrollOnItemResize({
        isStreaming: true,
        pinnedFollowing: false,
        delta: 12,
        itemEnd: 180,
        scrollOffset: 200,
      }),
    ).toBe(true);
  });

  it("skips adjustment while pinned-following during streaming", () => {
    expect(
      shouldAdjustScrollOnItemResize({
        isStreaming: true,
        pinnedFollowing: true,
        delta: 12,
        itemEnd: 180,
        scrollOffset: 200,
      }),
    ).toBe(false);
  });

  it("skips adjustment for below-viewport growth during streaming", () => {
    expect(
      shouldAdjustScrollOnItemResize({
        isStreaming: true,
        pinnedFollowing: false,
        delta: 12,
        itemEnd: 240,
        scrollOffset: 200,
      }),
    ).toBe(false);
  });

  it("skips adjustment when delta is zero", () => {
    expect(
      shouldAdjustScrollOnItemResize({
        isStreaming: true,
        pinnedFollowing: false,
        delta: 0,
        itemEnd: 180,
        scrollOffset: 200,
      }),
    ).toBe(false);
  });

  it("skips adjustment when not streaming", () => {
    expect(
      shouldAdjustScrollOnItemResize({
        isStreaming: false,
        pinnedFollowing: false,
        delta: 12,
        itemEnd: 180,
        scrollOffset: 200,
      }),
    ).toBe(false);
  });
});
