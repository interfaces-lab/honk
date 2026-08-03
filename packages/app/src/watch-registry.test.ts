import { openCodeSessionRef, type OpenCodeEvent } from "@honk/opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appSessionSummary, projectSessionSummaries } from "./open-code-view";
import {
  cloud,
  createClient,
  createEventQueue,
  local,
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
  sessionActivitySignal,
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
    await new Promise((resolve) => setTimeout(resolve, 20));

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

  it("refreshes an open transcript after a follow-up prompt is accepted", async () => {
    let transcriptLoads = 0;
    const info = sessionInfo("ses_follow_up", "Follow-up", "/local/repo");
    const userMessage = {
      id: "message-follow-up",
      sessionID: info.id,
      role: "user" as const,
      time: { created: 10 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
    };
    const initialTranscript = {
      info,
      messages: [],
      parts: [],
      sources: { persistedMessages: 0, projectedMessages: 0 },
    };
    const followUpTranscript = {
      info,
      messages: [userMessage],
      parts: [
        {
          id: "part-follow-up",
          sessionID: info.id,
          messageID: userMessage.id,
          type: "text" as const,
          text: "Check the follow-up rendering",
        },
      ],
      sources: { persistedMessages: 1, projectedMessages: 0 },
    };
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        loadTranscript: async () => (transcriptLoads > 1 ? followUpTranscript : initialTranscript),
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => transcriptLoads === 1);

    noteOpenCodeSessionPromptAccepted(ref);

    await waitUntil(
      () => getSessionWatchSnapshot(ref).state?.app.parts[0]?.id === "part-follow-up",
    );
    expect(transcriptLoads).toBe(2);
    expect(getSessionWatchSnapshot(ref).state?.app.messages).toEqual([userMessage]);
    unsubscribe();
  });

  it("reconciles workspace metadata and transcripts at every connection boundary", async () => {
    let sessionListLoads = 0;
    let transcriptLoads = 0;
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
        getSessionWatchSnapshot(ref).status === "live",
    );
    expect(sessionListLoads).toBe(1);
    expect(transcriptLoads).toBe(1);

    events.push({ id: "evt_initial_connected", type: "server.connected", data: {} });
    await waitUntil(() => sessionListLoads === 2 && transcriptLoads === 2);

    events.push({ id: "evt_reconnected", type: "server.connected", data: {} });
    await waitUntil(() => sessionListLoads === 3 && transcriptLoads === 3);

    unsubscribeSession();
    unsubscribeWorkspace();
  });

  it("closes the bootstrap gap with a snapshot after the first connection boundary", async () => {
    const events = createEventQueue();
    const initial = sessionInfo("ses_first_connection", "Before connection", "/local/repo");
    let current = initial;
    let transcriptLoads = 0;
    let releaseInitial = (): void => undefined;
    const initialGate = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    registerOpenCodeClient(
      createClient({
        server: local,
        info: initial,
        events: events.events,
        loadTranscript: async () => {
          transcriptLoads += 1;
          const info = current;
          if (transcriptLoads === 1) await initialGate;
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
    const ref = openCodeSessionRef(local.key, initial.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => transcriptLoads === 1);

    current = sessionInfo(initial.id, "After connection", initial.location.directory, {
      updated: 3,
    });
    events.push({ id: "evt_first_connected", type: "server.connected", data: {} });
    await waitUntil(() => getOpenCodeServersSnapshot().servers[0]?.status === "live");
    releaseInitial();

    await waitUntil(
      () =>
        transcriptLoads === 2 &&
        getSessionWatchSnapshot(ref).state?.app.summary.title === "After connection",
    );
    unsubscribe();
  });

  it.each([
    {
      id: "evt_native_agent",
      type: "session.next.agent.switched",
      data: {
        timestamp: 3,
        sessionID: "ses_native_inventory",
        messageID: "message-agent",
        agent: "honk-plan",
      },
    },
    {
      id: "evt_native_model",
      type: "session.next.model.switched",
      data: {
        timestamp: 3,
        sessionID: "ses_native_inventory",
        messageID: "message-model",
        model: { id: "gpt-5", providerID: "openai" },
      },
    },
    {
      id: "evt_native_move",
      type: "session.next.moved",
      data: {
        timestamp: 3,
        sessionID: "ses_native_inventory",
        location: { directory: "/local/repo-moved" },
      },
    },
    {
      id: "evt_native_revert_staged",
      type: "session.next.revert.staged",
      data: {
        timestamp: 3,
        sessionID: "ses_native_inventory",
        revert: { messageID: "message-revert" },
      },
    },
    {
      id: "evt_native_revert_cleared",
      type: "session.next.revert.cleared",
      data: { timestamp: 3, sessionID: "ses_native_inventory" },
    },
    {
      id: "evt_native_revert_committed",
      type: "session.next.revert.committed",
      data: {
        timestamp: 3,
        sessionID: "ses_native_inventory",
        messageID: "message-revert",
      },
    },
  ] satisfies readonly OpenCodeEvent[])(
    "reconciles unopened inventory at the $type boundary while a snapshot is in flight",
    async (event) => {
      const events = createEventQueue();
      const initial = sessionInfo(event.data.sessionID, "Before mutation", "/local/repo");
      let current = initial;
      let sessionListLoads = 0;
      let releaseInitial = (): void => undefined;
      const initialGate = new Promise<void>((resolve) => {
        releaseInitial = resolve;
      });
      registerOpenCodeClient(
        createClient({
          server: local,
          info: initial,
          events: events.events,
          sessionList: async () => {
            sessionListLoads += 1;
            const snapshot = current;
            if (sessionListLoads === 1) await initialGate;
            return { data: [snapshot], cursor: {} };
          },
          onPump: () => undefined,
        }),
        { primary: true },
      );
      const unsubscribe = subscribeWorkspaceWatch(() => undefined);
      await waitUntil(() => sessionListLoads === 1);

      current = sessionInfo(initial.id, `After ${event.type}`, initial.location.directory, {
        updated: 3,
      });
      events.push(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
      releaseInitial();

      await waitUntil(
        () =>
          sessionListLoads === 2 &&
          getWorkspaceWatchSnapshot().state?.sessions[0]?.title === `After ${event.type}`,
      );
      unsubscribe();
    },
  );

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

  it("replaces a half-open server stream without overlapping it", async () => {
    vi.useFakeTimers();
    let streamCount = 0;
    let activeStreams = 0;
    let peakStreams = 0;
    const info = sessionInfo("ses_half_open", "Half open", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: (signal) => ({
          async *[Symbol.asyncIterator]() {
            streamCount += 1;
            activeStreams += 1;
            peakStreams = Math.max(peakStreams, activeStreams);
            try {
              yield {
                id: `evt_connected_${String(streamCount)}`,
                type: "server.connected",
                data: {},
              };
              await new Promise<void>((resolve) => {
                if (signal?.aborted === true) {
                  resolve();
                  return;
                }
                signal?.addEventListener("abort", () => resolve(), { once: true });
              });
            } finally {
              activeStreams -= 1;
            }
          },
        }),
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribeCatalog = subscribeOpenCodeCatalog(() => undefined);
    const unsubscribeSession = subscribeSessionWatch(ref, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(streamCount).toBe(1);
    expect(getSessionWatchSnapshot(ref).status).toBe("live");

    await vi.advanceTimersByTimeAsync(15_000);
    expect(getSessionWatchSnapshot(ref).status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(250);
    expect(streamCount).toBe(2);
    expect(peakStreams).toBe(1);
    expect(getSessionWatchSnapshot(ref).status).toBe("live");
    unsubscribeSession();
    unsubscribeCatalog();
  });

  it("marks retained sessions unauthorized when the server stream rejects authorization", async () => {
    let rejectStream = (): void => undefined;
    const streamGate = new Promise<void>((_, reject) => {
      rejectStream = () => reject(Object.assign(new Error("unauthorized"), { status: 401 }));
    });
    const info = sessionInfo("ses_stream_unauthorized", "Unauthorized stream", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: () => ({
          async *[Symbol.asyncIterator]() {
            yield { id: "evt_connected", type: "server.connected", data: {} };
            await streamGate;
          },
        }),
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");

    rejectStream();

    await waitUntil(() => getSessionWatchSnapshot(ref).status === "unauthorized");
    unsubscribe();
  });

  it("keeps one heartbeating event stream until its consumer releases it", async () => {
    vi.useFakeTimers();
    let pumpCount = 0;
    const events = createEventQueue();
    const info = sessionInfo("ses_quiet", "Quiet", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: (signal) => {
          pumpCount += 1;
          return events.events(signal);
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribe = subscribeOpenCodeCatalog(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(pumpCount).toBe(1);

    for (let heartbeat = 0; heartbeat < 6; heartbeat += 1) {
      await vi.advanceTimersByTimeAsync(9_000);
      events.push({
        id: `evt_heartbeat_${String(heartbeat)}`,
        type: "server.heartbeat",
        data: {},
      });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(pumpCount).toBe(1);
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
      id: "evt_inventory_moved",
      type: "session.next.moved",
      data: {
        timestamp: 3,
        sessionID: info.id,
        location: { directory: "/local/moved" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
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
    const info = sessionInfo("ses_warm", "Warm", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const releaseRetainer = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");

    for (let visit = 0; visit < 20; visit += 1) {
      const releaseLeaf = subscribeSessionWatch(ref, () => undefined);
      releaseLeaf();
    }
    expect(transcriptLoads).toBe(1);
    releaseRetainer();
  });

  it("tears down an unretained session and performs one cold load when reopened", async () => {
    let transcriptLoads = 0;
    const info = sessionInfo("ses_reopen", "Reopen", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const releaseFirst = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");
    expect(transcriptLoads).toBe(1);
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSessionWatchSnapshot(ref).state).toBeNull();

    const releaseReopened = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");
    expect(transcriptLoads).toBe(2);
    releaseReopened();
  });

  it("coalesces cold subscribers without letting global invalidations reload the transcript", async () => {
    let releaseTranscript: (() => void) | undefined;
    const transcriptGate = new Promise<void>((resolve) => {
      releaseTranscript = resolve;
    });
    let transcriptLoads = 0;
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
      await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");
      expect(transcriptLoads).toBe(1);
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
    expect(
      appSessionSummary(
        { ...root, revert: { messageID: "message-plan-build" } },
        local.key,
        "idle",
        false,
      ).revertMessageId,
    ).toBe("message-plan-build");
  });

  it("folds child state into the root summary without marking the idle parent active", async () => {
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
    const rootRef = openCodeSessionRef(local.key, root.id);
    const unsubscribeRoot = subscribeSessionWatch(rootRef, () => undefined);

    await waitUntil(
      () =>
        getWorkspaceWatchSnapshot().state?.sessions.length === 2 &&
        getSessionWatchSnapshot(rootRef).status === "live",
    );
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
    expect(getSessionWatchSnapshot(rootRef).state).toMatchObject({
      activity: "idle",
      app: { summary: { status: "running" } },
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
    unsubscribeRoot();
    unsubscribe();
  });

  it("owns one live event stream per server regardless of subscribed session count", async () => {
    const events = createEventQueue();
    const info = sessionInfo("ses_stream_0", "Stream 0", "/local/repo");
    const inventory = [
      info,
      ...Array.from({ length: 11 }, (_, index) =>
        sessionInfo(
          `ses_stream_${String(index + 1)}`,
          `Stream ${String(index + 1)}`,
          "/local/repo",
        ),
      ),
    ];
    let streamCount = 0;
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        inventory,
        events: (signal) => {
          streamCount += 1;
          return events.events(signal);
        },
        loadTranscript: async (ref) => {
          const session = inventory.find((info) => info.id === ref.sessionID);
          if (session === undefined) throw new Error(`Unknown session ${ref.sessionID}.`);
          return {
            info: session,
            messages: [],
            parts: [],
            sources: { persistedMessages: 0, projectedMessages: 0 },
          };
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const releaseCatalog = subscribeOpenCodeCatalog(() => undefined);
    const releases = inventory.map((info) =>
      subscribeSessionWatch(openCodeSessionRef(local.key, info.id), () => undefined),
    );

    await waitUntil(
      () =>
        inventory.every(
          (info) =>
            getSessionWatchSnapshot(openCodeSessionRef(local.key, info.id)).status === "live",
        ) && streamCount === 1,
    );
    expect(streamCount).toBe(1);

    releases.forEach((release) => release());
    releaseCatalog();
  });

  it("routes a terminal server event without reloading the transcript", async () => {
    let transcriptLoads = 0;
    const events = createEventQueue();
    const info = sessionInfo("ses_terminal", "Terminal", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");
    expect(transcriptLoads).toBe(1);

    events.push({
      id: "event-status-busy",
      type: "session.status",
      data: { sessionID: info.id, status: { type: "busy" } },
    });
    await waitUntil(() => getSessionWatchSnapshot(ref).state?.activity === "busy");
    events.push({
      id: "event-status-idle",
      type: "session.status",
      data: { sessionID: info.id, status: { type: "idle" } },
    });
    await waitUntil(() => getSessionWatchSnapshot(ref).state?.activity === "idle");

    expect(transcriptLoads).toBe(1);
    unsubscribe();
  });

  it.each([
    {
      id: "event-status-idle",
      type: "session.status",
      data: { sessionID: "ses_terminal", status: { type: "idle" } },
    },
    {
      id: "event-idle",
      type: "session.idle",
      data: { sessionID: "ses_terminal" },
    },
  ] satisfies readonly OpenCodeEvent[])(
    "routes global $type through the terminal policy",
    (event) => {
      expect(sessionActivitySignal(event)).toEqual({
        sessionID: "ses_terminal",
        activity: "idle",
      });
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
