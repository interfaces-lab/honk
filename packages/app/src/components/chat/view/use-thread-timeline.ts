import { useMemo, useRef } from "react";

import type { TimelineEntry } from "../../../session-logic";
import { debugAgentLog } from "~/lib/debug-agent-log";
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
  const previousBranchRef = useRef<string | null>(null);
  return useMemo(() => {
    const next = projectThreadTimeline(input);
    const result = keepActiveTimelineTail(previousRef.current, next, input.isTurnActive);
    previousRef.current = result;

    // #region agent log
    const duplicates = findDuplicateAssistantTexts(result);
    const branch = result.some(
      (entry) => entry.kind === "runtime-tool" || entry.kind === "runtime-thinking",
    )
      ? "runtime"
      : "committed";
    if (duplicates.length > 0) {
      debugAgentLog(
        "use-thread-timeline.ts:useThreadTimeline",
        "duplicate assistant text rendered under different ids",
        { duplicates, branch, isTurnActive: input.isTurnActive, entryCount: result.length },
        "H-DUP",
      );
    }
    if (previousBranchRef.current !== null && previousBranchRef.current !== branch) {
      debugAgentLog(
        "use-thread-timeline.ts:useThreadTimeline",
        "projector entry source flipped",
        {
          from: previousBranchRef.current,
          to: branch,
          isTurnActive: input.isTurnActive,
          entryIds: result.slice(-6).map((entry) => `${entry.kind}:${entry.id}`),
        },
        "H-IDSWAP",
      );
    }
    previousBranchRef.current = branch;
    // #endregion

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

// #region agent log
function findDuplicateAssistantTexts(entries: ReadonlyArray<TimelineEntry>): Array<{
  textPreview: string;
  rows: Array<{ entryId: string; messageId: string; turnId: string | null; createdAt: string }>;
}> {
  const byText = new Map<
    string,
    Array<{ entryId: string; messageId: string; turnId: string | null; createdAt: string }>
  >();
  for (const entry of entries) {
    if (entry.kind !== "message" || entry.message.role !== "assistant") {
      continue;
    }
    const text = entry.message.text.trim();
    if (text.length === 0) {
      continue;
    }
    const rows = byText.get(text) ?? [];
    rows.push({
      entryId: entry.id,
      messageId: entry.message.id,
      turnId: entry.message.turnId ?? null,
      createdAt: entry.message.createdAt,
    });
    byText.set(text, rows);
  }
  return [...byText.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([text, rows]) => ({ textPreview: text.slice(0, 80), rows }));
}
// #endregion

/**
 * Return `previous` while an active turn momentarily regresses to a user-message/waiting-only
 * frame — e.g. the runtime overlay re-projects as a new command spins up — so the running
 * work-group preview does not flash out and back in.
 *
 * Message-safe by construction: the carry only happens when `next` is a pure regression of
 * `previous` (every row `next` still has, ignoring the waiting row, already exists in
 * `previous`). So the lease can never hide or duplicate a row that `next` introduced — a
 * freshly committed user message, a runtime user echo, a new send, or streaming assistant
 * text all carry a new id, which releases the carry and shows `next`. The projector remains
 * the sole authority for reconciling send-intent and committed user rows.
 */
export function keepActiveTimelineTail(
  previous: ReadonlyArray<TimelineEntry>,
  next: ReadonlyArray<TimelineEntry>,
  isTurnActive: boolean,
): ReadonlyArray<TimelineEntry> {
  if (!isTurnActive || endsWithAgentSurface(next) || !endsWithAgentSurface(previous)) {
    return next;
  }

  const previousIds = new Set(previous.map((entry) => entry.id));
  const nextIsRegressionOfPrevious = next.every(
    (entry) => entry.kind === "waiting" || previousIds.has(entry.id),
  );
  return nextIsRegressionOfPrevious ? previous : next;
}

// Whether the timeline ends with something the agent is actively presenting: a tool/work/
// thinking row, a proposed plan, or assistant text. A trailing user message (or only a
// waiting row) is not a surface — that is the regressed frame we bridge over.
function endsWithAgentSurface(entries: ReadonlyArray<TimelineEntry>): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.kind === "waiting") {
      continue;
    }
    if (entry.kind === "message") {
      return entry.message.role === "assistant";
    }
    return true;
  }
  return false;
}
