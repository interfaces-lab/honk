const SCROLL_EDGE_EPSILON = 1;

interface SlotRect {
  left: number;
  width: number;
}

interface DragSession {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  slotsScrollLeft: number;
  scrollableFromIndex: number;
  fromIndex: number;
  tabEl: HTMLElement;
  isDragging: boolean;
  // Snapshot slots before the drag transform paints. Scroll updates translate them arithmetically.
  slots: readonly SlotRect[] | null;
}

interface ScrollMetrics {
  width: number;
  canScrollStart: boolean;
  canScrollEnd: boolean;
}

const INITIAL_SCROLL_METRICS: ScrollMetrics = Object.freeze({
  width: 0,
  canScrollStart: false,
  canScrollEnd: false,
});

function measureSlots(stripEl: HTMLElement | null): readonly SlotRect[] {
  if (stripEl === null) return [];
  return Array.from(stripEl.querySelectorAll<HTMLElement>("[data-tab-key]"), (element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
}

// Land where the dragged center crosses a neighbor's midpoint. Never place a tab before Home.
function resolveTargetIndex(
  fromIndex: number,
  dx: number,
  slots: readonly SlotRect[],
  minIndex: number,
): number {
  const origin = slots[fromIndex];
  if (origin === undefined) return fromIndex;

  const center = origin.left + origin.width / 2 + dx;
  let target = fromIndex;
  for (let index = 0; index < slots.length; index += 1) {
    if (index === fromIndex) continue;
    const slot = slots[index];
    if (slot === undefined) continue;

    const slotCenter = slot.left + slot.width / 2;
    if (index < fromIndex && center < slotCenter) target = Math.min(target, index);
    if (index > fromIndex && center > slotCenter) target = Math.max(target, index);
  }
  return Math.max(minIndex, target);
}

function syncSlotRectsWithScroll(session: DragSession, scrollLeft: number): void {
  const delta = scrollLeft - session.slotsScrollLeft;
  session.slotsScrollLeft = scrollLeft;
  if (delta === 0 || session.slots === null) return;

  session.slots = session.slots.map((slot, index) =>
    index < session.scrollableFromIndex ? slot : { left: slot.left - delta, width: slot.width },
  );
}

function scrollMetricsFrom(element: HTMLElement): ScrollMetrics {
  const max = Math.max(0, element.scrollWidth - element.clientWidth);
  return {
    width: element.clientWidth,
    canScrollStart: element.scrollLeft > SCROLL_EDGE_EPSILON,
    canScrollEnd: element.scrollLeft < max - SCROLL_EDGE_EPSILON,
  };
}

function scrollMetricsEqual(left: ScrollMetrics, right: ScrollMetrics): boolean {
  return (
    left.width === right.width &&
    left.canScrollStart === right.canScrollStart &&
    left.canScrollEnd === right.canScrollEnd
  );
}

export {
  INITIAL_SCROLL_METRICS,
  measureSlots,
  resolveTargetIndex,
  scrollMetricsEqual,
  scrollMetricsFrom,
  syncSlotRectsWithScroll,
};
export type { DragSession, ScrollMetrics };
