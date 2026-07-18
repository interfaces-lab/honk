import { openCodeSessionRef, type OpenCodeEvent } from "@honk/opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appSessionSummary, projectSessionSummaries } from "./open-code-view";
import {
  cloud,
  createClient,
  createDurableEventQueue,
  createEventQueue,
  local,
  reasoningEvent,
  reasoningMessage,
  sessionInfo,
  waitUntil,
} from "./watch-registry.test-helpers";

import {
  bindOpenCodeClient,
  getBoundOpenCodeClient,
  getOpenCodeCatalogRevision,
  getOpenCodeClient,
  getOpenCodeServersSnapshot,
  getSessionWatchSnapshot,
  getWorkspaceWatchSnapshot,
  noteOpenCodeSessionPromptAccepted,
  registerOpenCodeClient,
  selectOpenCodeServer,
  subscribeOpenCodeCatalog,
  subscribeSessionWatch,
  subscribeWorkspaceWatch,
  unregisterOpenCodeClient,
} from "./watch-registry";

afterEach(async () => {
  unregisterOpenCodeClient(local.key);
  unregisterOpenCodeClient(cloud.key);
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("OpenCode watch registry", () => {
  it("keeps deleted project paths as display data until a session action needs resolution", async () => {
    const resolveLocation = vi.fn();
    const info = sessionInfo("ses_deleted", "Deleted project", "/deleted/sachi");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        onResolveLocation: resolveLocation,
        resolvedProjectDirectory: "/Users/me/Developer/sachi",
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribeWorkspace = subscribeWorkspaceWatch(() => undefined);

    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);
    expect(getWorkspaceWatchSnapshot().state?.sessions[0]?.projectDirectory).toBe("/deleted/sachi");
    expect(resolveLocation).not.toHaveBeenCalled();

    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribeSession = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");
    expect(resolveLocation).toHaveBeenCalledOnce();
    expect(getSessionWatchSnapshot(ref).state?.app.summary.projectDirectory).toBe(
      "/Users/me/Developer/sachi",
    );

    unsubscribeSession();
    unsubscribeWorkspace();
  });

  it("publishes catalog revisions from OpenCode catalog updates", async () => {
    const events = createEventQueue();
    const info = sessionInfo("ses_catalog", "Catalog", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const before = getOpenCodeCatalogRevision();
    const listener = vi.fn();
    const unsubscribe = subscribeOpenCodeCatalog(listener);

    events.push({ id: "event-catalog", type: "catalog.updated", data: {} });
    await waitUntil(() => getOpenCodeCatalogRevision() > before);

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("keeps an accepted prompt busy when its signal immediately precedes a workspace fetch", async () => {
    const info = sessionInfo("ses_initial_prompt", "Initial prompt", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);

    noteOpenCodeSessionPromptAccepted(ref);
    const unsubscribe = subscribeWorkspaceWatch(() => undefined);
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);

    expect(getWorkspaceWatchSnapshot().state?.sessions[0]).toMatchObject({
      id: info.id,
      status: "running",
    });
    unsubscribe();
  });

  it("refreshes workspace metadata without replacing a transcript on global reconnect", async () => {
    let sessionListLoads = 0;
    let transcriptLoads = 0;
    let sessionPumps = 0;
    const events = createEventQueue();
    const info = sessionInfo("ses_reconnected", "Reconnected", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        onSessionList: () => {
          sessionListLoads += 1;
        },
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onSessionPump: () => {
          sessionPumps += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribeWorkspace = subscribeWorkspaceWatch(() => undefined);
    const unsubscribeSession = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(
      () =>
        getWorkspaceWatchSnapshot().state?.sessions.length === 1 &&
        getSessionWatchSnapshot(ref).status === "live" &&
        sessionPumps === 1,
    );
    expect(sessionListLoads).toBe(1);
    expect(transcriptLoads).toBe(2);

    events.push({ id: "evt_connected", type: "server.connected", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 220));
    await waitUntil(() => sessionListLoads === 2);
    expect(transcriptLoads).toBe(2);
    expect(sessionPumps).toBe(1);

    unsubscribeSession();
    unsubscribeWorkspace();
  });

  it("skips a throwing event without marking the pump as reconnecting", async () => {
    const events = createEventQueue();
    const info = sessionInfo("ses_malformed", "Malformed event", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      events.push({
        id: "evt_malformed",
        type: "session.status",
        data: { sessionID: info.id },
      } as unknown as OpenCodeEvent);
      await waitUntil(() => warn.mock.calls.length === 1);
      expect(warn.mock.calls[0]?.[0]).toContain("session.status");
      expect(getSessionWatchSnapshot(ref).status).toBe("live");

      events.push({
        id: "evt_busy",
        type: "session.status",
        data: { sessionID: info.id, status: { type: "busy" } },
      });
      await waitUntil(() => getSessionWatchSnapshot(ref).state?.activity === "busy");
      expect(getSessionWatchSnapshot(ref).status).toBe("live");
    } finally {
      warn.mockRestore();
      unsubscribe();
    }
  });

  it("keeps a healthy quiet event pump connected past the heartbeat timeout", async () => {
    vi.useFakeTimers();
    let pumpCount = 0;
    let healthChecks = 0;
    const info = sessionInfo("ses_watchdog", "Watchdog", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: (signal) => ({
          async *[Symbol.asyncIterator]() {
            pumpCount += 1;
            yield { id: `evt_connected_${String(pumpCount)}`, type: "server.connected", data: {} };
            await new Promise<void>((resolve) => {
              if (signal?.aborted === true) {
                resolve();
                return;
              }
              signal?.addEventListener("abort", () => resolve(), { once: true });
            });
          },
        }),
        onHealth: () => {
          healthChecks += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribe = subscribeOpenCodeCatalog(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(pumpCount).toBe(1);

    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(250);
    expect(healthChecks).toBe(1);
    expect(pumpCount).toBe(1);
    unsubscribe();
  });

  it("resubscribes when a quiet event pump fails its health probe", async () => {
    vi.useFakeTimers();
    let pumpCount = 0;
    const info = sessionInfo("ses_failed_watchdog", "Failed watchdog", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        healthFails: true,
        events: (signal) => ({
          async *[Symbol.asyncIterator]() {
            pumpCount += 1;
            yield { id: `evt_connected_${String(pumpCount)}`, type: "server.connected", data: {} };
            await new Promise<void>((resolve) => {
              if (signal?.aborted === true) {
                resolve();
                return;
              }
              signal?.addEventListener("abort", () => resolve(), { once: true });
            });
          },
        }),
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribe = subscribeOpenCodeCatalog(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(pumpCount).toBe(1);

    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(250);
    expect(pumpCount).toBe(2);
    unsubscribe();
  });

  it("preserves a queued workspace refetch across a zero-subscriber window", async () => {
    let releaseSessionList: (() => void) | undefined;
    const sessionListGate = new Promise<void>((resolve) => {
      releaseSessionList = resolve;
    });
    let sessionListLoads = 0;
    const events = createEventQueue();
    const info = sessionInfo("ses_deferred_inventory", "Deferred inventory", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        sessionListGate,
        onSessionList: () => {
          sessionListLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribeFirst = subscribeWorkspaceWatch(() => undefined);
    expect(sessionListLoads).toBe(1);

    events.push({
      id: "evt_inventory_dirty",
      type: "session.updated",
      data: { sessionID: info.id, info },
    } as unknown as OpenCodeEvent);
    await new Promise((resolve) => setTimeout(resolve, 220));
    unsubscribeFirst();
    releaseSessionList?.();
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);
    expect(sessionListLoads).toBe(1);

    const unsubscribeSecond = subscribeWorkspaceWatch(() => undefined);
    await waitUntil(() => sessionListLoads === 2);
    unsubscribeSecond();
  });

  it("coalesces cold workspace subscribers into one inventory fetch", async () => {
    let releaseSessionList: (() => void) | undefined;
    const sessionListGate = new Promise<void>((resolve) => {
      releaseSessionList = resolve;
    });
    let sessionListLoads = 0;
    const info = sessionInfo("ses_inventory", "Inventory", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        sessionListGate,
        onSessionList: () => {
          sessionListLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );

    const unsubscribers = Array.from({ length: 5 }, () => subscribeWorkspaceWatch(() => undefined));
    try {
      expect(sessionListLoads).toBe(1);
      releaseSessionList?.();
      await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);
      expect(sessionListLoads).toBe(1);
    } finally {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    }
  });

  it("keeps warm session data through leaf subscriber swaps without reloading", async () => {
    let transcriptLoads = 0;
    let sessionPumps = 0;
    const info = sessionInfo("ses_warm", "Warm", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onSessionPump: () => {
          sessionPumps += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const releaseRetainer = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => sessionPumps === 1);

    for (let visit = 0; visit < 20; visit += 1) {
      const releaseLeaf = subscribeSessionWatch(ref, () => undefined);
      releaseLeaf();
    }
    expect(transcriptLoads).toBe(2);
    expect(sessionPumps).toBe(1);
    releaseRetainer();
  });

  it("tears down an unretained session and performs one cold load when reopened", async () => {
    let transcriptLoads = 0;
    let sessionPumps = 0;
    const info = sessionInfo("ses_reopen", "Reopen", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onSessionPump: () => {
          sessionPumps += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const releaseFirst = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => sessionPumps === 1);
    expect(transcriptLoads).toBe(2);
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSessionWatchSnapshot(ref).state).toBeNull();

    const releaseReopened = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => sessionPumps === 2);
    expect(transcriptLoads).toBe(3);
    releaseReopened();
  });

  it("coalesces cold subscribers without letting global invalidations reload the transcript", async () => {
    let releaseTranscript: (() => void) | undefined;
    const transcriptGate = new Promise<void>((resolve) => {
      releaseTranscript = resolve;
    });
    let transcriptLoads = 0;
    let sessionPumps = 0;
    const events = createEventQueue();
    const info = sessionInfo("ses_coalesced", "Coalesced", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        transcriptGate,
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onSessionPump: () => {
          sessionPumps += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribeFirst = subscribeSessionWatch(ref, () => undefined);
    const unsubscribeSecond = subscribeSessionWatch(ref, () => undefined);
    try {
      expect(transcriptLoads).toBe(1);
      events.push({
        id: "event-coalesced-update",
        type: "session.updated",
        data: { sessionID: info.id, info },
      } as unknown as OpenCodeEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(transcriptLoads).toBe(1);

      releaseTranscript?.();
      await waitUntil(() => sessionPumps === 1);
      expect(transcriptLoads).toBe(2);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  it("projects roots and children without crossing server identities", () => {
    const root = sessionInfo("ses_root", "Root", "/local/repo", { updated: 2 });
    const pairedChild = sessionInfo("ses_agent", "Paired", "/local/repo", {
      agent: "honk-sidekick-medium",
      parentID: root.id,
      updated: 4,
    });
    const genericChild = sessionInfo("ses_child", "Generic child", "/local/repo", {
      agent: "honk-build",
      parentID: root.id,
      updated: 5,
    });
    const sameCloudRoot = sessionInfo("ses_root", "Cloud root", "/cloud/repo", { updated: 3 });
    const projection = projectSessionSummaries([
      appSessionSummary(root, local.key, "idle", false),
      appSessionSummary(pairedChild, local.key, "running", false),
      appSessionSummary(genericChild, local.key, "idle", true),
      appSessionSummary(sameCloudRoot, cloud.key, "idle", false),
    ]);

    expect(projection.sessions).toHaveLength(4);
    expect(projection.rootSessions).toHaveLength(2);
    expect(projection.rootSessions.find((session) => session.server === local.key)).toMatchObject({
      id: root.id,
      status: "running",
      needsAttention: true,
      updatedAt: new Date(5).toISOString(),
    });
    expect(projection.rootSessions.find((session) => session.server === cloud.key)).toMatchObject({
      id: sameCloudRoot.id,
      status: "idle",
      needsAttention: false,
      updatedAt: new Date(3).toISOString(),
    });
    expect(projection.childSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: pairedChild.id,
          agent: "honk-sidekick-medium",
          parentSessionId: root.id,
          server: local.key,
        }),
        expect.objectContaining({
          id: genericChild.id,
          agent: "honk-build",
          parentSessionId: root.id,
          server: local.key,
        }),
      ]),
    );
  });

  it("publishes all, root, and child inventories with child state folded into the root", async () => {
    const events = createEventQueue();
    const root = sessionInfo("ses_parent", "Parent", "/local/repo", { updated: 2 });
    const child = sessionInfo("ses_child", "Child", "/local/repo", {
      agent: "honk-sidekick-medium",
      parentID: root.id,
      updated: 4,
    });
    registerOpenCodeClient(
      createClient({
        server: local,
        info: root,
        inventory: [root, child],
        activeSessionIDs: [child.id],
        events: events.events,
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribe = subscribeWorkspaceWatch(() => undefined);

    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 2);
    expect(getWorkspaceWatchSnapshot().state).toMatchObject({
      sessions: expect.arrayContaining([
        expect.objectContaining({ id: root.id, server: local.key }),
        expect.objectContaining({ id: child.id, server: local.key }),
      ]),
      rootSessions: [
        expect.objectContaining({
          id: root.id,
          status: "running",
          updatedAt: new Date(4).toISOString(),
        }),
      ],
      childSessions: [
        expect.objectContaining({
          id: child.id,
          agent: "honk-sidekick-medium",
          parentSessionId: root.id,
          status: "running",
        }),
      ],
    });

    events.push({
      id: "event-child-attention",
      type: "permission.asked",
      data: { id: "permission-child", sessionID: child.id },
    } as unknown as OpenCodeEvent);
    await waitUntil(
      () => getWorkspaceWatchSnapshot().state?.rootSessions[0]?.needsAttention === true,
    );
    expect(getWorkspaceWatchSnapshot().state?.childSessions[0]?.needsAttention).toBe(true);
    unsubscribe();
  });

  it("uses durable boundaries for canonical messages and global deltas only as overlays", async () => {
    let transcriptLoads = 0;
    let messageLoads = 0;
    const events = createEventQueue();
    const durable = createDurableEventQueue();
    const info = sessionInfo("ses_incremental", "Incremental", "/local/repo");
    const messageID = "message-assistant";
    const partID = "part-reasoning";
    let message = reasoningMessage(messageID, partID, ".");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        sessionEvents: durable.events,
        sessionMessage: async () => {
          messageLoads += 1;
          return message;
        },
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => durable.after.length === 1);

    events.push({
      id: "event-early-delta",
      type: "session.next.reasoning.delta",
      data: {
        timestamp: 2,
        sessionID: info.id,
        assistantMessageID: messageID,
        reasoningID: partID,
        delta: ".",
      },
    });
    durable.push(
      reasoningEvent("session.next.reasoning.started", {
        seq: 1,
        sessionID: info.id,
        messageID,
        partID,
      }),
    );
    await waitUntil(() => {
      const reasoning = getSessionWatchSnapshot(ref).state?.app.parts[0];
      return reasoning?.type === "reasoning" && reasoning.text === ".";
    });
    Array.from({ length: 24 }, (_, index) => index + 1).forEach((index) => {
      events.push({
        id: `event-compat-delta-${String(index)}`,
        type: "message.part.delta",
        data: {
          sessionID: info.id,
          messageID,
          partID,
          field: "text",
          delta: "ignored",
        },
      } as unknown as OpenCodeEvent);
      events.push({
        id: `event-next-delta-${String(index)}`,
        type: "session.next.reasoning.delta",
        data: {
          timestamp: index + 2,
          sessionID: info.id,
          assistantMessageID: messageID,
          reasoningID: partID,
          delta: ".",
        },
      });
    });

    await waitUntil(() => {
      const reasoning = getSessionWatchSnapshot(ref).state?.app.parts[0];
      return reasoning?.type === "reasoning" && reasoning.text.length === 25;
    });
    expect(transcriptLoads).toBe(2);
    expect(messageLoads).toBe(1);
    expect(getSessionWatchSnapshot(ref).state?.app.messages).toHaveLength(1);

    message = reasoningMessage(messageID, partID, "authoritative", 100);
    durable.push(
      reasoningEvent("session.next.reasoning.ended", {
        seq: 2,
        sessionID: info.id,
        messageID,
        partID,
        text: "authoritative",
        timestamp: 100,
      }),
    );
    await waitUntil(() => {
      const reasoning = getSessionWatchSnapshot(ref).state?.app.parts[0];
      return reasoning?.type === "reasoning" && reasoning.text === "authoritative";
    });
    events.push({
      id: "event-delayed-delta",
      type: "session.next.reasoning.delta",
      data: {
        timestamp: 99,
        sessionID: info.id,
        assistantMessageID: messageID,
        reasoningID: partID,
        delta: "ignored",
      },
    });
    events.push({
      id: "event-incremental-idle",
      type: "session.idle",
      data: { sessionID: info.id },
    });
    expect(transcriptLoads).toBe(2);
    expect(messageLoads).toBe(2);
    expect(getSessionWatchSnapshot(ref).state?.app.parts[0]).toMatchObject({
      type: "reasoning",
      text: "authoritative",
    });
    unsubscribe();
  });

  it.each(["session.status", "session.idle"] as const)(
    "does not reload a durable transcript for global %s invalidations",
    async (terminalEvent) => {
      let transcriptLoads = 0;
      let sessionPumps = 0;
      const events = createEventQueue();
      const info = sessionInfo(`ses_terminal_${terminalEvent}`, "Terminal", "/local/repo");
      registerOpenCodeClient(
        createClient({
          server: local,
          info,
          events: events.events,
          onTranscript: () => {
            transcriptLoads += 1;
          },
          onSessionPump: () => {
            sessionPumps += 1;
          },
          onPump: () => undefined,
        }),
        { primary: true },
      );
      const ref = openCodeSessionRef(local.key, info.id);
      const unsubscribe = subscribeSessionWatch(ref, () => undefined);
      await waitUntil(() => sessionPumps === 1);
      expect(transcriptLoads).toBe(2);

      vi.useFakeTimers();
      events.push({
        id: "event-updated",
        type: "session.updated",
        data: { sessionID: info.id, info },
      } as unknown as OpenCodeEvent);
      await vi.advanceTimersByTimeAsync(100);
      events.push(
        (terminalEvent === "session.status"
          ? {
              id: "event-status-idle",
              type: terminalEvent,
              data: { sessionID: info.id, status: { type: "idle" } },
            }
          : {
              id: "event-idle",
              type: terminalEvent,
              data: { sessionID: info.id },
            }) as unknown as OpenCodeEvent,
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(transcriptLoads).toBe(2);
      unsubscribe();
    },
  );

  it("keeps one event plane per server and isolates equal session IDs", async () => {
    let localPumps = 0;
    let cloudPumps = 0;
    const localInfo = sessionInfo("ses_same", "Local title", "/local/repo");
    const cloudInfo = sessionInfo("ses_same", "Cloud title", "/cloud/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info: localInfo,
        onPump: () => {
          localPumps += 1;
        },
      }),
      { primary: true },
    );
    registerOpenCodeClient(
      createClient({
        server: cloud,
        info: cloudInfo,
        needsAttention: true,
        onPump: () => {
          cloudPumps += 1;
        },
      }),
    );

    const unsubscribeWorkspace = subscribeWorkspaceWatch(() => undefined);
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 2);
    expect(getWorkspaceWatchSnapshot().state?.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ses_same", server: local.key, title: "Local title" }),
        expect.objectContaining({ id: "ses_same", server: cloud.key, title: "Cloud title" }),
      ]),
    );
    expect(localPumps).toBe(1);
    expect(cloudPumps).toBe(1);

    const localRef = openCodeSessionRef(local.key, "ses_same");
    const cloudRef = openCodeSessionRef(cloud.key, "ses_same");
    const unsubscribeLocal = subscribeSessionWatch(localRef, () => undefined);
    const unsubscribeCloud = subscribeSessionWatch(cloudRef, () => undefined);
    await waitUntil(
      () =>
        getSessionWatchSnapshot(localRef).status === "live" &&
        getSessionWatchSnapshot(cloudRef).status === "live",
    );
    expect(getSessionWatchSnapshot(localRef).state?.app.summary).toMatchObject({
      server: local.key,
      title: "Local title",
      needsAttention: false,
    });
    expect(getSessionWatchSnapshot(cloudRef).state?.app.summary).toMatchObject({
      server: cloud.key,
      title: "Cloud title",
      needsAttention: true,
    });
    expect(localPumps).toBe(1);
    expect(cloudPumps).toBe(1);

    unsubscribeLocal();
    unsubscribeCloud();
    unsubscribeWorkspace();
  });

  it("keeps a session live when supplementary attention requests fail", async () => {
    const info = sessionInfo("ses_attention_failure", "Still visible", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        attentionRequestsFail: true,
        isActive: true,
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);

    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");

    expect(getSessionWatchSnapshot(ref).state?.app.summary.title).toBe("Still visible");
    expect(getSessionWatchSnapshot(ref).state?.app.permissions).toEqual([]);
    expect(getSessionWatchSnapshot(ref).state?.app.questions).toEqual([]);
    unsubscribe();
  });

  it("skips location request queues for inactive sessions", async () => {
    let attentionRequestLoads = 0;
    const info = sessionInfo("ses_inactive", "Archived project", "/removed/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        attentionRequestsFail: true,
        onAttentionRequest: () => {
          attentionRequestLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribe = subscribeWorkspaceWatch(() => undefined);

    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);

    expect(attentionRequestLoads).toBe(0);
    expect(getWorkspaceWatchSnapshot().state?.sessions[0]).toMatchObject({
      id: info.id,
      needsAttention: false,
    });
    unsubscribe();
  });

  it("keeps the remaining server bound when the primary server disconnects", async () => {
    const localClient = createClient({
      server: local,
      info: sessionInfo("ses_local", "Local title", "/local/repo"),
      onPump: () => undefined,
    });
    const cloudClient = createClient({
      server: cloud,
      info: sessionInfo("ses_cloud", "Cloud title", "/cloud/repo"),
      onPump: () => undefined,
    });
    bindOpenCodeClient(localClient);
    registerOpenCodeClient(cloudClient);

    expect(getBoundOpenCodeClient()).toBe(localClient);
    bindOpenCodeClient(null);
    expect(getBoundOpenCodeClient()).toBe(cloudClient);

    const unsubscribeWorkspace = subscribeWorkspaceWatch(() => undefined);
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);
    expect(getWorkspaceWatchSnapshot().state?.sessions[0]).toMatchObject({
      id: "ses_cloud",
      server: cloud.key,
    });
    unsubscribeWorkspace();
  });

  it("preserves secondary servers when the bootstrap client reconnects", () => {
    const localClient = createClient({
      server: local,
      info: sessionInfo("ses_local", "Local title", "/local/repo"),
      onPump: () => undefined,
    });
    const cloudClient = createClient({
      server: cloud,
      info: sessionInfo("ses_cloud", "Cloud title", "/cloud/repo"),
      onPump: () => undefined,
    });

    bindOpenCodeClient(localClient);
    registerOpenCodeClient(cloudClient);
    expect(selectOpenCodeServer(cloud.key)).toBe(true);
    expect(getBoundOpenCodeClient()).toBe(cloudClient);

    bindOpenCodeClient(null);
    expect(getOpenCodeClient(cloud.key)).toBe(cloudClient);

    const replacement = createClient({
      server: local,
      info: sessionInfo("ses_local", "Local title", "/local/repo"),
      onPump: () => undefined,
    });
    bindOpenCodeClient(replacement);

    expect(getOpenCodeClient(cloud.key)).toBe(cloudClient);
    expect(getBoundOpenCodeClient()).toBe(replacement);
    expect(getOpenCodeServersSnapshot().servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ server: local, selected: true }),
        expect.objectContaining({ server: cloud, selected: false }),
      ]),
    );
  });

  it("moves live subscribers to a replacement client for the same server", async () => {
    let firstPumps = 0;
    let replacementPumps = 0;
    const ref = openCodeSessionRef(local.key, "ses_replace");
    registerOpenCodeClient(
      createClient({
        server: local,
        info: sessionInfo("ses_replace", "Before reconnect", "/local/repo"),
        onPump: () => {
          firstPumps += 1;
        },
      }),
      { primary: true },
    );
    const unsubscribeSession = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");

    registerOpenCodeClient(
      createClient({
        server: local,
        info: sessionInfo("ses_replace", "After reconnect", "/local/repo"),
        onPump: () => {
          replacementPumps += 1;
        },
      }),
      { primary: true },
    );
    await waitUntil(
      () => getSessionWatchSnapshot(ref).state?.app.summary.title === "After reconnect",
    );

    expect(getSessionWatchSnapshot(ref).status).toBe("live");
    expect(firstPumps).toBe(1);
    expect(replacementPumps).toBe(1);
    unsubscribeSession();
  });
});
