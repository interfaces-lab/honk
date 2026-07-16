import {
  createOpenCodeServer,
  openCodeSessionRef,
  type OpenCodeClient,
  type OpenCodeEvent,
  type OpenCodeServerDescriptor,
  type OpenCodeSessionInfo,
} from "@honk/opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appSessionSummary, projectSessionSummaries } from "./open-code-view";

import {
  bindOpenCodeClient,
  getBoundOpenCodeClient,
  getOpenCodeClient,
  getOpenCodeServersSnapshot,
  getSessionWatchSnapshot,
  getWorkspaceWatchSnapshot,
  registerOpenCodeClient,
  selectOpenCodeServer,
  subscribeSessionWatch,
  subscribeWorkspaceWatch,
  unregisterOpenCodeClient,
} from "./watch-registry";

const local = createOpenCodeServer({
  origin: "http://127.0.0.1:4096",
  label: "This Mac",
  kind: "local",
});
const cloud = createOpenCodeServer({
  origin: "https://cloud.example.test",
  label: "Cloud",
  kind: "cloud",
});
const SESSION_REFETCH_WAIT_MS = 120;

function sessionInfo(
  id: string,
  title: string,
  directory: string,
  options?: {
    readonly agent?: string;
    readonly parentID?: string;
    readonly updated?: number;
  },
): OpenCodeSessionInfo {
  return {
    id,
    ...(options?.agent === undefined ? {} : { agent: options.agent }),
    ...(options?.parentID === undefined ? {} : { parentID: options.parentID }),
    projectID: `project-${id}`,
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: { created: 1, updated: options?.updated ?? 2 },
    title,
    location: { directory },
  };
}

function createClient(input: {
  readonly server: OpenCodeServerDescriptor;
  readonly info: OpenCodeSessionInfo;
  readonly inventory?: readonly OpenCodeSessionInfo[];
  readonly activeSessionIDs?: readonly string[];
  readonly needsAttention?: boolean;
  readonly attentionRequestsFail?: boolean;
  readonly isActive?: boolean;
  readonly onAttentionRequest?: () => void;
  readonly events?: (signal?: AbortSignal) => AsyncIterable<OpenCodeEvent>;
  readonly onTranscript?: () => void;
  readonly transcriptGate?: Promise<void>;
  readonly onPump: () => void;
}): OpenCodeClient {
  const inventory = input.inventory ?? [input.info];
  const activeSessionIDs = new Set(input.activeSessionIDs);
  if (input.isActive === true || input.needsAttention === true) {
    activeSessionIDs.add(input.info.id);
  }
  const waitForAbort = (signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal?.aborted === true) {
        resolve();
        return;
      }
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  const events =
    input.events ??
    ((signal?: AbortSignal): AsyncIterable<OpenCodeEvent> => ({
      async *[Symbol.asyncIterator]() {
        input.onPump();
        await waitForAbort(signal);
        yield* [] as OpenCodeEvent[];
      },
    }));
  return {
    server: input.server,
    requests: {
      permissions: async () => {
        input.onAttentionRequest?.();
        if (input.attentionRequestsFail === true) throw new Error("permission request failed");
        return {
          location: {
            directory: input.info.location.directory,
            project: { id: input.info.projectID, directory: input.info.location.directory },
          },
          data:
            input.needsAttention === true
              ? [
                  {
                    id: `permission-${input.info.id}`,
                    sessionID: input.info.id,
                    action: "read",
                    resources: [input.info.location.directory],
                  },
                ]
              : [],
        };
      },
      questions: async () => {
        input.onAttentionRequest?.();
        if (input.attentionRequestsFail === true) throw new Error("question request failed");
        return {
          location: {
            directory: input.info.location.directory,
            project: { id: input.info.projectID, directory: input.info.location.directory },
          },
          data: [],
        };
      },
    },
    sessions: {
      list: async () => ({ data: inventory, cursor: {} }),
      active: async () =>
        Object.fromEntries(
          [...activeSessionIDs].map((sessionID) => [sessionID, { type: "running" }]),
        ),
      get: async () => input.info,
      messages: async () => ({ data: [], cursor: {} }),
      transcript: async () => {
        input.onTranscript?.();
        await input.transcriptGate;
        return {
          info: input.info,
          messages: [],
          parts: [],
          sources: { persistedMessages: 0, projectedMessages: 0 },
        };
      },
      permissions: async () => {
        if (input.attentionRequestsFail === true) throw new Error("permission request failed");
        return input.needsAttention === true
          ? [
              {
                id: `permission-${input.info.id}`,
                sessionID: input.info.id,
                action: "read",
                resources: [input.info.location.directory],
              },
            ]
          : [];
      },
      questions: async () => {
        if (input.attentionRequestsFail === true) throw new Error("question request failed");
        return [];
      },
    },
    events,
  } as unknown as OpenCodeClient;
}

function createEventQueue(): {
  readonly push: (event: OpenCodeEvent) => void;
  readonly events: (signal?: AbortSignal) => AsyncIterable<OpenCodeEvent>;
} {
  const queued: OpenCodeEvent[] = [];
  let resolveNext: ((event: OpenCodeEvent | null) => void) | null = null;

  return {
    push(event) {
      const resolve = resolveNext;
      if (resolve === null) {
        queued.push(event);
        return;
      }
      resolveNext = null;
      resolve(event);
    },
    events(signal) {
      return {
        async *[Symbol.asyncIterator]() {
          while (signal?.aborted !== true) {
            const next =
              queued.shift() ??
              (await new Promise<OpenCodeEvent | null>((resolve) => {
                resolveNext = resolve;
                signal?.addEventListener("abort", () => resolve(null), { once: true });
              }));
            if (next === null) return;
            yield next;
          }
        },
      };
    },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `Timed out waiting for watch state: ${JSON.stringify(getWorkspaceWatchSnapshot())}`,
  );
}

afterEach(async () => {
  unregisterOpenCodeClient(local.key);
  unregisterOpenCodeClient(cloud.key);
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("OpenCode watch registry", () => {
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
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSessionWatchSnapshot(ref).state).toBeNull();

    const releaseReopened = subscribeSessionWatch(ref, () => undefined);
    await waitUntil(() => transcriptLoads === 2 && getSessionWatchSnapshot(ref).status === "live");
    expect(transcriptLoads).toBe(2);
    releaseReopened();
  });

  it("coalesces cold subscribers and queues one event-driven trailing fetch", async () => {
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
      await new Promise((resolve) => setTimeout(resolve, SESSION_REFETCH_WAIT_MS + 20));
      expect(transcriptLoads).toBe(1);

      releaseTranscript?.();
      await waitUntil(
        () => transcriptLoads === 2 && getSessionWatchSnapshot(ref).status === "live",
      );
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

  it.each(["session.status", "session.idle"] as const)(
    "keeps a trailing transcript refetch for %s after an earlier debounce",
    async (terminalEvent) => {
      let transcriptLoads = 0;
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
          onPump: () => undefined,
        }),
        { primary: true },
      );
      const ref = openCodeSessionRef(local.key, info.id);
      const unsubscribe = subscribeSessionWatch(ref, () => undefined);
      await waitUntil(() => getSessionWatchSnapshot(ref).status === "live");
      expect(transcriptLoads).toBe(1);

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
      await vi.advanceTimersByTimeAsync(21);

      // The first debounce would have fired at 120ms. A terminal event moves
      // the fetch to 120ms after itself so the final persisted part is loaded.
      expect(transcriptLoads).toBe(1);
      await vi.advanceTimersByTimeAsync(100);
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
