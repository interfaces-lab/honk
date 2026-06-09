const PREFIX = "[timeline-preview]";

export interface TimelinePreviewTailSnapshot {
  tailIndex: number;
  groupId: string | null;
  isRunning: boolean;
  isTailGroup: boolean;
  stepIds: readonly string[];
  isTurnActive: boolean;
}

let previousTailSnapshot: TimelinePreviewTailSnapshot | null = null;
const previousTailHeights = new Map<string, number>();

export function isTimelinePreviewDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    (window as { __MULTI_DEBUG_TIMELINE_PREVIEW?: boolean }).__MULTI_DEBUG_TIMELINE_PREVIEW ===
      true || localStorage.getItem("multi:debug:timeline-preview") === "1"
  );
}

export function logTimelinePreview(event: string, payload: Record<string, unknown>): void {
  if (!isTimelinePreviewDebugEnabled()) {
    return;
  }
  console.log(PREFIX, event, payload);
}

export function recordTimelinePreviewTailSnapshot(snapshot: TimelinePreviewTailSnapshot): void {
  if (!isTimelinePreviewDebugEnabled()) {
    previousTailSnapshot = snapshot;
    return;
  }

  const previous = previousTailSnapshot;
  if (previous) {
    if (previous.groupId !== snapshot.groupId && snapshot.groupId !== null) {
      logTimelinePreview("tail-group-id-change", {
        prevId: previous.groupId,
        nextId: snapshot.groupId,
        stepIds: snapshot.stepIds,
      });
    }
    if (previous.tailIndex !== snapshot.tailIndex) {
      logTimelinePreview("tail-index-change", {
        prevIndex: previous.tailIndex,
        nextIndex: snapshot.tailIndex,
        prevGroupId: previous.groupId,
        nextGroupId: snapshot.groupId,
      });
    }
    if (
      snapshot.isTurnActive &&
      previous.isRunning !== snapshot.isRunning &&
      snapshot.isTailGroup
    ) {
      logTimelinePreview("tail-running-flip", {
        groupId: snapshot.groupId,
        prev: previous.isRunning,
        next: snapshot.isRunning,
      });
    }
  }

  const changed =
    !previous ||
    previous.tailIndex !== snapshot.tailIndex ||
    previous.groupId !== snapshot.groupId ||
    previous.isRunning !== snapshot.isRunning ||
    previous.isTailGroup !== snapshot.isTailGroup ||
    previous.stepIds.length !== snapshot.stepIds.length ||
    previous.stepIds.some((stepId, index) => stepId !== snapshot.stepIds[index]);

  if (changed) {
    logTimelinePreview("tail-snapshot", { ...snapshot });
  }

  previousTailSnapshot = snapshot;
}

export function recordTimelinePreviewTailHeight(input: {
  rowId: string;
  nextPx: number;
  previewStepCount: number;
}): void {
  const previousPx = previousTailHeights.get(input.rowId);
  if (previousPx !== undefined && previousPx !== input.nextPx) {
    logTimelinePreview("tail-height-change", {
      rowId: input.rowId,
      prevPx: previousPx,
      nextPx: input.nextPx,
      previewStepCount: input.previewStepCount,
    });
  }
  previousTailHeights.set(input.rowId, input.nextPx);
}

export function __resetTimelinePreviewDebugForTests(): void {
  previousTailSnapshot = null;
  previousTailHeights.clear();
}
