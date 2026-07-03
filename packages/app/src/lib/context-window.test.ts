import { EventId } from "@honk/shared/base-schemas";
import type { ThreadTokenUsageSnapshot } from "@honk/shared/runtime-events";
import type { OrchestrationThreadActivity } from "@honk/shared/orchestration";
import { describe, expect, it } from "vitest";

import { deriveLatestContextWindowSnapshot, formatContextUsageSummary } from "./context-window";

function contextWindowActivity(
  id: string,
  createdAt: string,
  payload: ThreadTokenUsageSnapshot,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind: "context-window.updated",
    summary: "Context usage updated",
    payload,
    turnId: null,
    createdAt,
  };
}

describe("deriveLatestContextWindowSnapshot", () => {
  it("ignores impossible snapshots that are larger than the model context window", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      contextWindowActivity("event:context-window-good", "2026-06-17T17:30:00.000Z", {
        usedTokens: 42_000,
        maxTokens: 128_000,
        categories: [{ id: "conversation", label: "Conversation", tokens: 42_000 }],
        compactsAutomatically: true,
      }),
      contextWindowActivity("event:context-window-bad", "2026-06-17T17:35:00.000Z", {
        usedTokens: 331_710,
        maxTokens: 128_000,
        categories: [{ id: "conversation", label: "Conversation", tokens: 323_378 }],
        inputTokens: 177_783,
        cachedInputTokens: 151_653,
        outputTokens: 2_274,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(42_000);
    expect(formatContextUsageSummary(snapshot!)).toBe("33% · 42k / 128k context used");
  });

  it("allows small overages so near-limit context remains visible", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      contextWindowActivity("event:context-window-near-limit", "2026-06-17T17:30:00.000Z", {
        usedTokens: 130_000,
        maxTokens: 128_000,
        categories: [{ id: "conversation", label: "Conversation", tokens: 130_000 }],
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(130_000);
    expect(snapshot?.usedPercentage).toBe(100);
    expect(snapshot?.remainingTokens).toBe(0);
  });

  it("returns null when every context window snapshot is impossible", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      contextWindowActivity("event:context-window-bad", "2026-06-17T17:35:00.000Z", {
        usedTokens: 331_710,
        maxTokens: 128_000,
        categories: [{ id: "conversation", label: "Conversation", tokens: 323_378 }],
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).toBeNull();
  });
});
