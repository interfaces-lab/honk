import { useMemo, useRef } from "react";

import type { TimelineEntry } from "../../../session-logic";
import { projectThreadTimeline } from "./thread-timeline-projector";

type ProjectThreadTimelineInput = Parameters<typeof projectThreadTimeline>[0];

/**
 * The semantic projector runs per render and holds no cross-frame state. While a turn is
 * active, a runtime frame can briefly arrive with the work/runtime tail dropped (the runtime
 * overlay regressed and committed activities have not caught up) before the next frame
 * restores it. Keep the previous entries for that one frame so the collapsed work-group
 * preview does not unmount and lose its animation.
 *
 * This is the only place that remembers the previous projection. The projector stays pure,
 * `chat-view` consumes a value, and `MessagesTimeline` still only renders.
 */
export function useThreadTimeline(
  input: ProjectThreadTimelineInput,
): ReadonlyArray<TimelineEntry> {
  const previousRef = useRef<ReadonlyArray<TimelineEntry>>([]);
  return useMemo(() => {
    const next = projectThreadTimeline(input);
    const result = keepActiveTimelineTail(previousRef.current, next, input.isTurnActive);
    previousRef.current = result;
    return result;
    // Recompute only when a projector input changes; `input` is a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    input.committedMessages,
    input.proposedPlans,
    input.workLogEntries,
    input.sendIntents,
    input.runtimeAcknowledgedMessageIds,
    input.activeRuntimeDisplayTimeline,
    input.isWorking,
    input.isTurnActive,
    input.activeTurnStartedAt,
  ]);
}

/**
 * Return `previous` for one frame when an active turn momentarily drops its agent-activity
 * tail. Guarded so a genuine change — a new user message, branch switch, or turn ending —
 * always shows `next`.
 */
export function keepActiveTimelineTail(
  previous: ReadonlyArray<TimelineEntry>,
  next: ReadonlyArray<TimelineEntry>,
  isTurnActive: boolean,
): ReadonlyArray<TimelineEntry> {
  if (
    isTurnActive &&
    endsWithAgentActivity(previous) &&
    !endsWithAgentActivity(next) &&
    sameMessageIds(previous, next)
  ) {
    return previous;
  }
  return next;
}

function endsWithAgentActivity(entries: ReadonlyArray<TimelineEntry>): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.kind === "waiting") {
      continue;
    }
    return (
      entry.kind === "runtime-tool" ||
      entry.kind === "runtime-thinking" ||
      entry.kind === "work"
    );
  }
  return false;
}

function sameMessageIds(
  previous: ReadonlyArray<TimelineEntry>,
  next: ReadonlyArray<TimelineEntry>,
): boolean {
  const previousIds = messageIds(previous);
  const nextIds = messageIds(next);
  if (previousIds.length !== nextIds.length) {
    return false;
  }
  return previousIds.every((id, index) => id === nextIds[index]);
}

function messageIds(entries: ReadonlyArray<TimelineEntry>) {
  return entries.flatMap((entry) => (entry.kind === "message" ? [entry.message.id] : []));
}
