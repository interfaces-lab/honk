import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cloud,
  createClient,
  createEventQueue,
  local,
  sessionInfo,
  waitUntil,
} from "./watch-registry.test-helpers";
import {
  getWorkspaceWatchSnapshot,
  registerOpenCodeClient,
  subscribeWorkspaceWatch,
  unregisterOpenCodeClient,
} from "./watch-registry";

function wireSession(info: ReturnType<typeof sessionInfo>) {
  return {
    ...info,
    slug: info.id,
    directory: info.location.directory,
    version: "test",
  };
}

afterEach(async () => {
  unregisterOpenCodeClient(local.key);
  unregisterOpenCodeClient(cloud.key);
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("OpenCode workspace synchronization", () => {
  it("hydrates external session inventory events from V2 without refetching the list", async () => {
    let sessionListLoads = 0;
    const events = createEventQueue();
    const initial = sessionInfo("ses_initial", "Initial", "/local/repo");
    const sessions = new Map([[initial.id, initial]]);
    registerOpenCodeClient(
      createClient({
        server: local,
        info: initial,
        events: events.events,
        sessionGet: async (ref) => {
          const info = sessions.get(ref.sessionID);
          if (info === undefined) throw new Error(`Unknown session: ${ref.sessionID}`);
          return info;
        },
        onSessionList: () => {
          sessionListLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribe = subscribeWorkspaceWatch(() => undefined);
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);

    const created = sessionInfo("ses_external", "External", "/local/repo", { updated: 3 });
    sessions.set(created.id, created);
    events.push({
      id: "evt_created",
      type: "session.created",
      data: { sessionID: created.id, info: wireSession(created) },
    });
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 2);
    expect(sessionListLoads).toBe(1);

    const updated = {
      ...created,
      title: "Renamed elsewhere",
      time: { ...created.time, updated: 4 },
    };
    sessions.set(updated.id, updated);
    events.push({
      id: "evt_updated",
      type: "session.updated",
      data: { sessionID: updated.id, info: wireSession(created) },
    });
    await waitUntil(
      () =>
        getWorkspaceWatchSnapshot().state?.sessions.find((session) => session.id === updated.id)
          ?.title === updated.title,
    );

    sessions.delete(updated.id);
    events.push({
      id: "evt_deleted",
      type: "session.deleted",
      data: { sessionID: updated.id, info: wireSession(created) },
    });
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);
    expect(sessionListLoads).toBe(1);
    unsubscribe();
  });

  it("replays session events received while an inventory fetch is in flight", async () => {
    let releaseSessionList: (() => void) | undefined;
    const sessionListGate = new Promise<void>((resolve) => {
      releaseSessionList = resolve;
    });
    const events = createEventQueue();
    const stale = sessionInfo("ses_fetch_race", "Stale title", "/local/repo");
    const current = { ...stale, title: "Current title", time: { ...stale.time, updated: 3 } };
    registerOpenCodeClient(
      createClient({
        server: local,
        info: stale,
        events: events.events,
        sessionGet: async () => current,
        sessionListGate,
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribe = subscribeWorkspaceWatch(() => undefined);
    events.push({
      id: "evt_racing_update",
      type: "session.updated",
      data: { sessionID: current.id, info: wireSession(stale) },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseSessionList?.();

    await waitUntil(
      () => getWorkspaceWatchSnapshot().state?.sessions[0]?.title === "Current title",
    );
    unsubscribe();
  });

  it("does not resurrect a deleted session when an older V2 lookup finishes", async () => {
    let releaseSessionGet: (() => void) | undefined;
    const sessionGetGate = new Promise<void>((resolve) => {
      releaseSessionGet = resolve;
    });
    const events = createEventQueue();
    const initial = sessionInfo("ses_deleted_race", "Initial", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info: initial,
        events: events.events,
        sessionGet: async () => {
          await sessionGetGate;
          return { ...initial, title: "Late update" };
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribe = subscribeWorkspaceWatch(() => undefined);
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);

    events.push({
      id: "evt_late_update",
      type: "session.updated",
      data: { sessionID: initial.id, info: wireSession(initial) },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    events.push({
      id: "evt_delete_after_update",
      type: "session.deleted",
      data: { sessionID: initial.id, info: wireSession(initial) },
    });
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 0);

    releaseSessionGet?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getWorkspaceWatchSnapshot().state?.sessions).toEqual([]);
    unsubscribe();
  });

  it("publishes a burst of session updates once per event frame", async () => {
    const events = createEventQueue();
    const initial = sessionInfo("ses_batched", "Initial", "/local/repo");
    let canonical = initial;
    registerOpenCodeClient(
      createClient({
        server: local,
        info: initial,
        events: events.events,
        sessionGet: async () => canonical,
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceWatch(listener);
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    listener.mockClear();

    const first = { ...initial, title: "First", time: { ...initial.time, updated: 3 } };
    const second = { ...first, title: "Second", time: { ...first.time, updated: 4 } };
    canonical = first;
    events.push({
      id: "evt_batched_first",
      type: "session.updated",
      data: { sessionID: first.id, info: wireSession(initial) },
    });
    canonical = second;
    events.push({
      id: "evt_batched_second",
      type: "session.updated",
      data: { sessionID: second.id, info: wireSession(initial) },
    });

    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions[0]?.title === "Second");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  // A turn re-declares its session busy on every provider step. Republishing there reprojects the
  // whole inventory, and every thread surface reading it re-renders its transcript.
  it("republishes activity only when it actually changes", async () => {
    const events = createEventQueue();
    const info = sessionInfo("ses_activity", "Activity", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        events: events.events,
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceWatch(listener);
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions.length === 1);

    events.push({
      id: "evt_activity_busy",
      type: "session.status",
      data: { sessionID: info.id, status: { type: "busy" } },
    });
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions[0]?.status === "running");
    // Let the notification batcher drain so a pending flush is not read as a later publish.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const running = getWorkspaceWatchSnapshot();
    listener.mockClear();

    for (const id of ["evt_activity_busy_again", "evt_activity_busy_third"]) {
      events.push({
        id,
        type: "session.status",
        data: { sessionID: info.id, status: { type: "busy" } },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getWorkspaceWatchSnapshot()).toBe(running);
    expect(listener).not.toHaveBeenCalled();

    events.push({ id: "evt_activity_idle", type: "session.idle", data: { sessionID: info.id } });
    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions[0]?.status === "idle");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("publishes session inventory before activity reconciliation finishes", async () => {
    let releaseActivity: (() => void) | undefined;
    const sessionActivityGate = new Promise<void>((resolve) => {
      releaseActivity = resolve;
    });
    const info = sessionInfo("ses_fast_inventory", "Fast inventory", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        sessionActivityGate,
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const unsubscribe = subscribeWorkspaceWatch(() => undefined);

    await waitUntil(() => getWorkspaceWatchSnapshot().state?.sessions[0]?.id === info.id);
    expect(getWorkspaceWatchSnapshot().status).toBe("live");

    releaseActivity?.();
    unsubscribe();
  });
});
