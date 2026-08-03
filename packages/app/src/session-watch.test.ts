import { openCodeSessionRef } from "@honk/opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appSessionSummary } from "./open-code-view";
import { projectSessionSummaryMetadata, sessionActivityTransition } from "./session-watch";
import {
  cloud,
  createClient,
  createEventQueue,
  local,
  sessionInfo,
  waitUntil,
} from "./watch-registry.test-helpers";
import {
  getSessionWatchSnapshot,
  registerOpenCodeClient,
  subscribeSessionWatch,
  unregisterOpenCodeClient,
} from "./watch-registry";

afterEach(async () => {
  unregisterOpenCodeClient(local.key);
  unregisterOpenCodeClient(cloud.key);
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("OpenCode session watch invariants", () => {
  it("converges from an unavailable snapshot at the next connection boundary", async () => {
    const events = createEventQueue();
    const info = sessionInfo("ses_initial_retry", "Initial retry", "/local/repo");
    let transcriptLoads = 0;
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        loadTranscript: async () => {
          transcriptLoads += 1;
          if (transcriptLoads === 1) throw new Error("temporary transcript read failure");
          return {
            info,
            messages: [],
            parts: [],
            sources: { persistedMessages: 0, projectedMessages: 0 },
          };
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);

    await waitUntil(() => transcriptLoads === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSessionWatchSnapshot(ref)).toMatchObject({
      state: null,
      status: "connecting",
    });

    events.push({ id: "event-connected", type: "server.connected", data: {} });
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");
    expect(getSessionWatchSnapshot(ref)).toMatchObject({
      state: expect.objectContaining({
        app: expect.objectContaining({
          summary: expect.objectContaining({ title: "Initial retry" }),
        }),
      }),
      status: "live",
    });
    expect(transcriptLoads).toBe(2);
    unsubscribe();
  });

  it("reconciles monitor-only mutations through the authoritative snapshot", async () => {
    const events = createEventQueue();
    const initial = sessionInfo("ses_monitor_boundary", "Monitor boundary", "/local/repo", {
      agent: "honk-build",
    });
    let current = initial;
    let transcriptLoads = 0;
    registerOpenCodeClient(
      createClient({
        server: local,
        info: initial,
        events: events.events,
        loadTranscript: async () => ({
          info: current,
          messages: [],
          parts: [],
          sources: { persistedMessages: 0, projectedMessages: 0 },
        }),
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, initial.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");

    current = sessionInfo(initial.id, initial.title, initial.location.directory, {
      agent: "honk-plan",
      updated: 3,
    });
    events.push({
      id: "event-agent-switched",
      type: "session.next.agent.switched",
      data: {
        sessionID: initial.id,
        messageID: "message-agent-switched",
        timestamp: 3,
        agent: "honk-plan",
      },
    });

    await waitUntil(() => getSessionWatchSnapshot(ref).state?.app.summary.agent === "honk-plan");
    expect(transcriptLoads).toBe(2);
    unsubscribe();
  });

  it("projects canonical session metadata without republishing an unchanged summary", () => {
    const initial = sessionInfo("ses_core_selection", "Before", "/local/repo", {
      agent: "honk-build",
      model: { providerID: "openai", id: "gpt-5.6-sol", variant: "high" },
    });
    const updated = sessionInfo(initial.id, "After", initial.location.directory, {
      agent: "honk-plan",
      model: { providerID: "openai", id: "gpt-5.6-sol", variant: "xhigh" },
      updated: 3,
    });
    const summary = appSessionSummary(initial, local.key, "running", true);
    const projected = projectSessionSummaryMetadata(summary, updated);

    expect(projected).toMatchObject({
      title: "After",
      agent: "honk-plan",
      model: {
        providerID: "openai",
        id: "gpt-5.6-sol",
        variant: "xhigh",
      },
      updatedAt: new Date(3).toISOString(),
      status: "running",
      needsAttention: true,
    });
    expect(projectSessionSummaryMetadata(projected, updated)).toBe(projected);
  });

  it.each([
    { needsAttention: true, requests: "refresh" },
    { needsAttention: false, requests: "unchanged" },
  ])(
    "converges terminal activity to idle with requests $requests when attention is $needsAttention",
    ({ needsAttention, requests }) => {
      expect(
        sessionActivityTransition({
          activity: "idle",
          needsAttention,
        }),
      ).toEqual({
        activity: "idle",
        requests,
      });
    },
  );

  it("does not refresh requests for a non-terminal activity transition", () => {
    expect(
      sessionActivityTransition({
        activity: "busy",
        needsAttention: true,
      }),
    ).toEqual({ activity: "busy", requests: "unchanged" });
  });
});
