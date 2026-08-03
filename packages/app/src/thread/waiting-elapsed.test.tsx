import { StatusRow } from "@honk/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  WAITING_PLANNING_LABEL,
  WAITING_SLOW_LABEL,
  WAITING_SLOW_THRESHOLD_MS,
  waitingStatusLabel,
} from "./waiting-status";

// Mirrors the transcript footer: the epoch only reaches StatusRow once the copy
// has already escalated, so the number and the admission arrive together.
function startedAtMsForFooter(label: string | null, turnStartedAtMs: number | null): number | null {
  return label === WAITING_SLOW_LABEL ? turnStartedAtMs : null;
}

describe("waiting elapsed readout", () => {
  const turnStartedAtMs = 1_000;
  const waitingLabelAt = (nowMs: number): string | null =>
    waitingStatusLabel({
      isRunning: true,
      hasVisibleActivity: false,
      turnStartedAtMs,
      nowMs,
    });

  it("withholds the epoch while the wait still reads as ordinary planning", () => {
    const label = waitingLabelAt(turnStartedAtMs + WAITING_SLOW_THRESHOLD_MS - 1);
    expect(label).toBe(WAITING_PLANNING_LABEL);
    expect(startedAtMsForFooter(label, turnStartedAtMs)).toBeNull();
  });

  it("hands over the epoch on the same tick the copy admits the wait is slow", () => {
    const label = waitingLabelAt(turnStartedAtMs + WAITING_SLOW_THRESHOLD_MS);
    expect(label).toBe(WAITING_SLOW_LABEL);
    expect(startedAtMsForFooter(label, turnStartedAtMs)).toBe(turnStartedAtMs);
  });

  it("keeps the label as the row's accessible name and the figure out of the tree", () => {
    const html = renderToStaticMarkup(
      <StatusRow startedAtMs={turnStartedAtMs}>{WAITING_SLOW_LABEL}</StatusRow>,
    );
    expect(html).toContain(`aria-label="${WAITING_SLOW_LABEL}"`);
    // A ticking figure inside role="status" would be announced on every tick.
    expect(html).toContain('role="status"');
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("renders no elapsed figure when there is no clock to read", () => {
    const html = renderToStaticMarkup(
      <StatusRow startedAtMs={turnStartedAtMs}>{WAITING_SLOW_LABEL}</StatusRow>,
    );
    // Static render must not claim 0.0s for a wait that is already 15s old.
    expect(html).not.toMatch(/\d+\.\d+s/);
    expect(html).not.toMatch(/\dm \d\d\.\ds/);
  });
});
