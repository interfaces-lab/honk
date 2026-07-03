import { AuthProviderId, ThreadId } from "@honk/shared/base-schemas";
import {
  EventId,
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  TurnId,
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type HonkRuntimeApi,
  type HonkRuntimeHostEvent,
  type HonkRuntimeHostSnapshot,
  type SessionTreeProjection,
  type RuntimeDisplayTimelineProjection,
} from "@honk/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetEnvironmentApiOverridesForTests } from "../environment-api";
import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "../lib/environment-scope";
import { createEmptyRuntimeHostSnapshot } from "../lib/honk-runtime-api";
import { getThreadFromEnvironmentState } from "../thread-derivation";
import {
  latestRuntimeEventTurnId,
  runtimeAgentRunEventState,
  runtimeEventsIndicateActiveAgentRun,
  runtimeEventsIndicateTerminalAgentRun,
  selectIsRuntimeThread,
  selectRuntimeEventsForThread,
  startDesktopRuntimeHostSync,
  useAgentRuntimeStore,
} from "./agent-runtime-store";
import { initialState, selectEnvironmentState, useStore } from "./thread-store";

const threadId = ThreadId.make("thread:agent-runtime-store");
const runtimeSessionId = RuntimeSessionId.make("runtime:agent-runtime-store");
const turnId = TurnId.make("turn:agent-runtime-store");
const userEntryId = RuntimeItemId.make("runtime-item:agent-store:user");
const userThreadEntryId = ThreadEntryId.make("thread-entry:agent-store:user");
const userMessageCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 13, 0, 0)),
);
const turnStartedAt = Date.prototype.toISOString.call(new Date(Date.UTC(2026, 5, 1, 13, 0, 10)));
const sessionTreePrototype = {
  threadId,
  runtimeSessionId,
  leafEntryId: userEntryId,
  entries: [
    {
      id: userEntryId,
      threadEntryId: userThreadEntryId,
      parentId: null,
      parentThreadEntryId: null,
      kind: "message",
      role: "user",
      clientMessageId: MessageId.make("message:agent-store:user"),
      text: "Start",
      createdAt: userMessageCreatedAt,
      rawEntry: {},
    },
  ],
  nodes: [
    {
      entryId: userEntryId,
      threadEntryId: userThreadEntryId,
      parentEntryId: null,
      depth: 0,
      isActivePath: true,
      isActiveLeaf: true,
      childCount: 0,
    },
  ],
} satisfies SessionTreeProjection;
const turnStartedEventPrototype = {
  id: EventId.make("runtime-event:agent-store:turn-started"),
  type: "turn.started",
  agentRuntime: "pi",
  threadId,
  runtimeSessionId,
  turnId,
  createdAt: turnStartedAt,
} as const;
const emptyHostSnapshotPrototype = createEmptyRuntimeHostSnapshot();
const runningHostSnapshotPrototype = {
  ...emptyHostSnapshotPrototype,
  sessionTrees: [sessionTreePrototype],
  runtimeEvents: [turnStartedEventPrototype],
};
const displayTimelinePrototype = {
  threadId,
  runtimeSessionId,
  items: [
    {
      id: "message:runtime-item:agent-store:user",
      kind: "message",
      source: "session-entry",
      orderKey: `${userMessageCreatedAt}:message:runtime-item:agent-store:user`,
      createdAt: userMessageCreatedAt,
      entryId: userEntryId,
      threadEntryId: userThreadEntryId,
      parentEntryId: null,
      parentThreadEntryId: null,
      role: "user",
      clientMessageId: MessageId.make("message:agent-store:user"),
      eventIds: [],
      streaming: false,
      text: "Start",
    },
  ],
} satisfies RuntimeDisplayTimelineProjection;
const pendingExtensionUiRequestPrototype = {
  id: "extension-ui:agent-store:request",
  threadId,
  runtimeSessionId,
  kind: "select",
  title: "Run command?",
  message: "Allow git status?",
  options: ["Allow", "Deny"],
  createdAt: turnStartedAt,
} satisfies DesktopExtensionUiRequest;

function createRuntimeApi(overrides: Partial<HonkRuntimeApi> = {}): HonkRuntimeApi {
  return {
    getHostSnapshot: async () => emptyHostSnapshotPrototype,
    getPreferences: async () => emptyHostSnapshotPrototype.preferences,
    updatePreferences: async () => emptyHostSnapshotPrototype.preferences,
    configureCredential: async () => emptyHostSnapshotPrototype,
    hydrateThread: async () => undefined,
    cloneThread: async () => undefined,
    setThreadFocus: async () => undefined,
    sendTurn: async (input) => TurnId.make(`turn:${input.threadId}`),
    enqueueFollowUp: async () => undefined,
    updateQueuedFollowUp: async () => undefined,
    removeQueuedFollowUp: async () => undefined,
    reorderQueuedFollowUp: async () => undefined,
    sendQueuedFollowUpNow: async () => undefined,
    compactThread: async () => undefined,
    abort: async () => undefined,
    respondToExtensionUiRequest: async () => undefined,
    listSkills: async () => ({ skills: [] }),
    getThreadSessionFile: async () => ({ path: null }),
    onHostEvent: () => () => undefined,
    ...overrides,
  };
}

function expectHostEventListener(
  listener: ((event: HonkRuntimeHostEvent) => void) | null,
): (event: HonkRuntimeHostEvent) => void {
  expect(listener).not.toBeNull();
  if (!listener) {
    throw new Error("Host event listener was not registered.");
  }
  return listener;
}

function expectSnapshotResolver(
  resolveSnapshot: ((snapshot: HonkRuntimeHostSnapshot) => void) | null,
): (snapshot: HonkRuntimeHostSnapshot) => void {
  expect(resolveSnapshot).not.toBeNull();
  if (!resolveSnapshot) {
    throw new Error("Snapshot promise was not created.");
  }
  return resolveSnapshot;
}

function currentThread() {
  const environmentState = selectEnvironmentState(
    useStore.getState(),
    DESKTOP_RUNTIME_ENVIRONMENT_ID,
  );
  const thread = getThreadFromEnvironmentState(environmentState, threadId);
  expect(thread).toBeDefined();
  return thread!;
}

describe("agent runtime store", () => {
  beforeEach(() => {
    __resetEnvironmentApiOverridesForTests();
    vi.unstubAllGlobals();
    useStore.setState(initialState);
    useAgentRuntimeStore.setState({
      snapshot: createEmptyRuntimeHostSnapshot(),
      localRuntimeThreadIds: new Set(),
      runtimeActivityByThreadId: new Map(),
    });
  });

  afterEach(() => {
    __resetEnvironmentApiOverridesForTests();
    vi.unstubAllGlobals();
  });

  it("closes stale Pi sessions when host snapshots remove the runtime thread", () => {
    useAgentRuntimeStore.getState().setSnapshot(runningHostSnapshotPrototype);

    expect(currentThread().session?.status).toBe("running");
    expect(currentThread().latestTurn?.state).toBe("running");

    useAgentRuntimeStore.getState().setSnapshot(emptyHostSnapshotPrototype);

    const thread = currentThread();
    expect(thread.session?.status).toBe("closed");
    expect(thread.session?.orchestrationStatus).toBe("stopped");
    expect(thread.session?.activeTurnId).toBeUndefined();
    expect(thread.latestTurn?.state).toBe("interrupted");
    expect(thread.latestTurn?.completedAt).not.toBeNull();
    expect(thread.messages.map((message) => message.text)).toEqual(["Start"]);
  });

  it("updates credential auth flows from host events", () => {
    const flow = {
      authProviderId: AuthProviderId.make("openai-codex"),
      credentialKind: "codex-oauth",
      state: "pending",
      kind: "oauth-device-code",
      message: "Waiting for authentication.",
      verificationUri: "https://example.com/device",
      userCode: "ABCD-1234",
      updatedAt: "2026-06-02T00:00:00.000Z",
    } as const;

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "credential-auth-flows",
      flows: [flow],
    });

    expect(useAgentRuntimeStore.getState().snapshot.credentialAuthFlows).toEqual([flow]);

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "credential-auth-flows",
      flows: [],
    });

    expect(useAgentRuntimeStore.getState().snapshot.credentialAuthFlows).toEqual([]);
  });

  it("buffers runtime host events until the initial host snapshot resolves", async () => {
    let resolveSnapshot: ((snapshot: HonkRuntimeHostSnapshot) => void) | null = null;
    let hostEventListener: ((event: HonkRuntimeHostEvent) => void) | null = null;
    const getHostSnapshot = vi.fn(
      () =>
        new Promise<HonkRuntimeHostSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    vi.stubGlobal("window", {
      desktopBridge: {
        runtime: createRuntimeApi({
          getHostSnapshot,
          onHostEvent: (listener) => {
            hostEventListener = listener;
            return () => {
              hostEventListener = null;
            };
          },
        }),
      },
    });

    const stop = startDesktopRuntimeHostSync();
    expect(getHostSnapshot).toHaveBeenCalledTimes(1);
    const emitHostEvent = expectHostEventListener(hostEventListener);

    emitHostEvent({
      type: "display-timeline",
      timeline: displayTimelinePrototype,
    });

    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines).toEqual([]);

    expectSnapshotResolver(resolveSnapshot)(emptyHostSnapshotPrototype);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines).toEqual([
      displayTimelinePrototype,
    ]);

    stop();
  });

  it("keeps buffered runtime host events if the initial host snapshot fails", async () => {
    let hostEventListener: ((event: HonkRuntimeHostEvent) => void) | null = null;
    vi.stubGlobal("window", {
      desktopBridge: {
        runtime: createRuntimeApi({
          getHostSnapshot: async () => {
            throw new Error("Snapshot failed");
          },
          onHostEvent: (listener) => {
            hostEventListener = listener;
            return () => {
              hostEventListener = null;
            };
          },
        }),
      },
    });

    const stop = startDesktopRuntimeHostSync();
    const emitHostEvent = expectHostEventListener(hostEventListener);

    emitHostEvent({
      type: "display-timeline",
      timeline: displayTimelinePrototype,
    });

    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines).toEqual([]);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines).toEqual([
      displayTimelinePrototype,
    ]);

    stop();
  });

  it("does not update pending extension UI requests when request data is unchanged", () => {
    useAgentRuntimeStore.getState().applyHostEvent({
      type: "pending-extension-ui",
      requests: [pendingExtensionUiRequestPrototype],
    });
    const initialSnapshot = useAgentRuntimeStore.getState().snapshot;
    const initialRequests = initialSnapshot.pendingExtensionUiRequests;
    let storeUpdateCount = 0;
    const unsubscribe = useAgentRuntimeStore.subscribe(() => {
      storeUpdateCount += 1;
    });

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "pending-extension-ui",
      requests: [
        {
          ...pendingExtensionUiRequestPrototype,
          options: ["Allow", "Deny"],
        },
      ],
    });
    unsubscribe();

    expect(useAgentRuntimeStore.getState().snapshot).toBe(initialSnapshot);
    expect(useAgentRuntimeStore.getState().snapshot.pendingExtensionUiRequests).toBe(
      initialRequests,
    );
    expect(storeUpdateCount).toBe(0);
  });

  it("updates pending extension UI requests when visible request data changes", () => {
    useAgentRuntimeStore.getState().applyHostEvent({
      type: "pending-extension-ui",
      requests: [pendingExtensionUiRequestPrototype],
    });
    const initialSnapshot = useAgentRuntimeStore.getState().snapshot;

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "pending-extension-ui",
      requests: [
        {
          ...pendingExtensionUiRequestPrototype,
          title: "Confirm command?",
        },
      ],
    });

    expect(useAgentRuntimeStore.getState().snapshot).not.toBe(initialSnapshot);
    expect(useAgentRuntimeStore.getState().snapshot.pendingExtensionUiRequests[0]?.title).toBe(
      "Confirm command?",
    );
  });

  it("preserves pending extension UI request identity across equivalent snapshots", () => {
    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      pendingExtensionUiRequests: [pendingExtensionUiRequestPrototype],
    });
    const initialRequests = useAgentRuntimeStore.getState().snapshot.pendingExtensionUiRequests;

    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      pendingExtensionUiRequests: [
        {
          ...pendingExtensionUiRequestPrototype,
          options: ["Allow", "Deny"],
        },
      ],
    });

    expect(useAgentRuntimeStore.getState().snapshot.pendingExtensionUiRequests).toBe(
      initialRequests,
    );
  });

  it("stores display timeline host events by thread", () => {
    useAgentRuntimeStore.getState().applyHostEvent({
      type: "display-timeline",
      timeline: displayTimelinePrototype,
    });

    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines).toEqual([
      displayTimelinePrototype,
    ]);
  });

  it("migrates legacy shell display timeline host events to bash", () => {
    const legacyTimeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "tool:toolu-legacy-shell",
          kind: "tool",
          orderKey: `${turnStartedAt}:tool:toolu-legacy-shell`,
          createdAt: turnStartedAt,
          toolCallId: "toolu-legacy-shell",
          toolName: "bash",
          turnId,
          status: "completed",
          eventIds: [EventId.make("runtime-event:legacy-shell")],
          display: {
            kind: "shell",
            command: "pwd",
            output: "/repo",
          },
        },
      ],
    } as unknown as RuntimeDisplayTimelineProjection;

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "display-timeline",
      timeline: legacyTimeline,
    });

    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines[0]?.items[0]).toMatchObject({
      kind: "tool",
      display: {
        kind: "bash",
        command: "pwd",
      },
    });
  });

  it("does not update display timelines for diagnostic-only timeline changes", () => {
    const timeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "tool:toolu-diagnostic-only",
          kind: "tool",
          orderKey: `${turnStartedAt}:tool:toolu-diagnostic-only`,
          createdAt: turnStartedAt,
          toolCallId: "toolu-diagnostic-only",
          toolName: "bash",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          args: { command: "git status --short" },
          command: "git status --short",
          output: "M file.ts",
          summary: "Running bash",
          display: {
            kind: "bash",
            command: "git status --short",
            output: "M file.ts",
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;
    useAgentRuntimeStore.getState().applyHostEvent({ type: "display-timeline", timeline });
    const initialSnapshot = useAgentRuntimeStore.getState().snapshot;
    let storeUpdateCount = 0;
    const unsubscribe = useAgentRuntimeStore.subscribe(() => {
      storeUpdateCount += 1;
    });

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "display-timeline",
      timeline: {
        ...timeline,
        items: [
          {
            ...timeline.items[0]!,
            eventIds: [
              EventId.make("runtime-event:tool-started"),
              EventId.make("runtime-event:tool-updated"),
            ],
            args: { command: "git status --short", cwd: "/tmp/updated" },
            details: { observedAt: "2026-06-02T00:00:00.000Z" },
            result: { content: [{ type: "text", text: "M file.ts" }] },
          },
        ],
      },
    });
    unsubscribe();

    expect(useAgentRuntimeStore.getState().snapshot).toBe(initialSnapshot);
    expect(storeUpdateCount).toBe(0);
  });

  it("does not update display timelines for subagent activity-only changes", () => {
    const timeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "tool:toolu-subagent-stream",
          kind: "tool",
          orderKey: `${turnStartedAt}:tool:toolu-subagent-stream`,
          createdAt: turnStartedAt,
          toolCallId: "toolu-subagent-stream",
          toolName: "subagent",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:subagent-started")],
          display: {
            kind: "subagent",
            mode: "single",
            runs: [
              {
                subagentThreadId: "thread:agent-store:child",
                agentId: "thread:agent-store:child",
                nickname: "Review renderer",
                role: "general-purpose",
                model: "gpt-5.5",
                prompt: "Review renderer",
                state: "running",
                finalText: null,
                errorMessage: null,
              },
            ],
            activities: [
              {
                id: "runtime-subagent:toolu-subagent-stream:thread:agent-store:child:item:assistant",
                kind: "subagent.item.updated",
                tone: "info",
                summary: "Subagent response",
                createdAt: turnStartedAt,
                sequence: 1,
                payload: {
                  subagentThreadId: "thread:agent-store:child",
                  parentThreadId: threadId,
                  parentItemId: "toolu-subagent-stream",
                  agentId: "thread:agent-store:child",
                  nickname: "Review renderer",
                  role: "general-purpose",
                  model: "gpt-5.5",
                  prompt: "Review renderer",
                  state: null,
                  itemType: "assistant_message",
                  itemId: "assistant:turn:child",
                  status: "running",
                  title: "Assistant",
                  detail: "partial response",
                  data: null,
                },
              },
            ],
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;

    useAgentRuntimeStore.getState().applyHostEvent({ type: "display-timeline", timeline });
    const initialSnapshot = useAgentRuntimeStore.getState().snapshot;
    const initialTimeline = initialSnapshot.displayTimelines[0];
    let storeUpdateCount = 0;
    const unsubscribe = useAgentRuntimeStore.subscribe(() => {
      storeUpdateCount += 1;
    });

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "display-timeline",
      timeline: {
        ...timeline,
        items: [
          {
            ...timeline.items[0]!,
            display: {
              ...timeline.items[0]!.display,
              activities: [
                {
                  ...timeline.items[0]!.display.activities[0]!,
                  payload: {
                    ...timeline.items[0]!.display.activities[0]!.payload,
                    detail: "longer streamed response",
                  },
                },
              ],
            },
          },
        ],
      },
    });
    unsubscribe();

    expect(useAgentRuntimeStore.getState().snapshot).toBe(initialSnapshot);
    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines[0]).toBe(initialTimeline);
    expect(storeUpdateCount).toBe(0);
  });

  it("updates display timelines when visible tool output changes", () => {
    const timeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "tool:toolu-visible-output",
          kind: "tool",
          orderKey: `${turnStartedAt}:tool:toolu-visible-output`,
          createdAt: turnStartedAt,
          toolCallId: "toolu-visible-output",
          toolName: "bash",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          command: "git status --short",
          output: "M file.ts",
          display: {
            kind: "bash",
            command: "git status --short",
            output: "M file.ts",
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;
    useAgentRuntimeStore.getState().applyHostEvent({ type: "display-timeline", timeline });
    const initialSnapshot = useAgentRuntimeStore.getState().snapshot;

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "display-timeline",
      timeline: {
        ...timeline,
        items: [
          {
            ...timeline.items[0]!,
            eventIds: [
              EventId.make("runtime-event:tool-started"),
              EventId.make("runtime-event:tool-updated"),
            ],
            output: "M file.ts\nM second.ts",
            display: {
              kind: "bash",
              command: "git status --short",
              output: "M file.ts\nM second.ts",
            },
          },
        ],
      },
    });

    expect(useAgentRuntimeStore.getState().snapshot).not.toBe(initialSnapshot);
    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines[0]?.items[0]).toEqual(
      expect.objectContaining({
        output: "M file.ts\nM second.ts",
      }),
    );
  });

  it("preserves display timeline identity across snapshots with diagnostic-only changes", () => {
    const timeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "tool:toolu-snapshot-diagnostic-only",
          kind: "tool",
          orderKey: `${turnStartedAt}:tool:toolu-snapshot-diagnostic-only`,
          createdAt: turnStartedAt,
          toolCallId: "toolu-snapshot-diagnostic-only",
          toolName: "bash",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          command: "git status --short",
          output: "M file.ts",
          display: {
            kind: "bash",
            command: "git status --short",
            output: "M file.ts",
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;
    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      displayTimelines: [timeline],
    });
    const storedTimeline = useAgentRuntimeStore.getState().snapshot.displayTimelines[0];

    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      displayTimelines: [
        {
          ...timeline,
          items: [
            {
              ...timeline.items[0]!,
              eventIds: [
                EventId.make("runtime-event:tool-started"),
                EventId.make("runtime-event:tool-updated"),
              ],
              args: { command: "git status --short", cwd: "/tmp/updated" },
              result: { content: [{ type: "text", text: "M file.ts" }] },
            },
          ],
        },
      ],
    });

    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines[0]).toBe(storedTimeline);
  });

  it("replaces display timeline identity across snapshots when visible fields change", () => {
    const timeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "tool:toolu-snapshot-visible-output",
          kind: "tool",
          orderKey: `${turnStartedAt}:tool:toolu-snapshot-visible-output`,
          createdAt: turnStartedAt,
          toolCallId: "toolu-snapshot-visible-output",
          toolName: "bash",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          command: "git status --short",
          output: "M file.ts",
          display: {
            kind: "bash",
            command: "git status --short",
            output: "M file.ts",
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;
    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      displayTimelines: [timeline],
    });
    const storedTimeline = useAgentRuntimeStore.getState().snapshot.displayTimelines[0];

    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      displayTimelines: [
        {
          ...timeline,
          items: [
            {
              ...timeline.items[0]!,
              output: "M file.ts\nM second.ts",
              display: {
                kind: "bash",
                command: "git status --short",
                output: "M file.ts\nM second.ts",
              },
            },
          ],
        },
      ],
    });

    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines[0]).not.toBe(storedTimeline);
  });

  it("does not replace display timeline identity when stale command fields change behind typed display", () => {
    const timeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "tool:toolu-snapshot-typed-display",
          kind: "tool",
          orderKey: `${turnStartedAt}:tool:toolu-snapshot-typed-display`,
          createdAt: turnStartedAt,
          toolCallId: "toolu-snapshot-typed-display",
          toolName: "bash",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          command: "git status --short",
          output: "M file.ts",
          display: {
            kind: "bash",
            command: "git status --short",
            output: "M file.ts",
          },
        },
      ],
    } satisfies RuntimeDisplayTimelineProjection;
    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      displayTimelines: [timeline],
    });
    const storedTimeline = useAgentRuntimeStore.getState().snapshot.displayTimelines[0];

    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      displayTimelines: [
        {
          ...timeline,
          items: [
            {
              ...timeline.items[0]!,
              command: "git diff --stat",
              output: "1 file changed",
            },
          ],
        },
      ],
    });

    expect(useAgentRuntimeStore.getState().snapshot.displayTimelines[0]).toBe(storedTimeline);
  });

  it("recognizes local runtime thread ownership before host timeline data arrives", () => {
    expect(selectIsRuntimeThread(useAgentRuntimeStore.getState(), threadId)).toBe(false);

    useAgentRuntimeStore.getState().markLocalRuntimeThread(threadId);

    expect(selectIsRuntimeThread(useAgentRuntimeStore.getState(), threadId)).toBe(true);

    useAgentRuntimeStore.getState().clearLocalRuntimeThread(threadId);

    expect(selectIsRuntimeThread(useAgentRuntimeStore.getState(), threadId)).toBe(false);
  });

  it("does not clear local runtime ownership on an empty host snapshot", () => {
    useAgentRuntimeStore.getState().markLocalRuntimeThread(threadId);

    useAgentRuntimeStore.getState().setSnapshot(emptyHostSnapshotPrototype);

    expect(selectIsRuntimeThread(useAgentRuntimeStore.getState(), threadId)).toBe(true);
    expect(useAgentRuntimeStore.getState().localRuntimeThreadIds.has(threadId)).toBe(true);
  });

  it("clears local runtime ownership once host timeline ownership arrives", () => {
    useAgentRuntimeStore.getState().markLocalRuntimeThread(threadId);

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "display-timeline",
      timeline: displayTimelinePrototype,
    });

    expect(useAgentRuntimeStore.getState().localRuntimeThreadIds.has(threadId)).toBe(false);
    expect(selectIsRuntimeThread(useAgentRuntimeStore.getState(), threadId)).toBe(true);
  });

  it("updates runtime identities and clears local ownership from scoped identity events", () => {
    useAgentRuntimeStore.getState().markLocalRuntimeThread(threadId);
    const authStatus = {
      authProviderId: AuthProviderId.make("openai-codex"),
      credentialKind: "codex-oauth",
      accountId: null,
      state: "available",
      label: "Codex",
      message: "Signed in.",
      updatedAt: "2026-06-02T00:00:00.000Z",
    } as const;

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "runtime-identities",
      identities: [
        {
          threadId,
          runtimeSessionId,
          authProviderId: AuthProviderId.make("openai-codex"),
          modelId: null,
        },
      ],
      authStatuses: [authStatus],
    });

    expect(useAgentRuntimeStore.getState().snapshot.runtimeIdentities).toEqual([
      expect.objectContaining({ threadId, runtimeSessionId }),
    ]);
    expect(useAgentRuntimeStore.getState().snapshot.authStatuses).toEqual([authStatus]);
    expect(useAgentRuntimeStore.getState().localRuntimeThreadIds.has(threadId)).toBe(false);
    expect(selectIsRuntimeThread(useAgentRuntimeStore.getState(), threadId)).toBe(true);
  });

  it("recognizes runtime thread ownership from host session trees", () => {
    useAgentRuntimeStore.getState().applyHostEvent({
      type: "session-tree",
      tree: sessionTreePrototype,
    });

    expect(selectIsRuntimeThread(useAgentRuntimeStore.getState(), threadId)).toBe(true);
  });

  it("does not append live raw runtime events to the app snapshot", () => {
    const initialSnapshot = useAgentRuntimeStore.getState().snapshot;

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "runtime-event",
      event: turnStartedEventPrototype,
    });

    expect(useAgentRuntimeStore.getState().snapshot).toBe(initialSnapshot);
    expect(useAgentRuntimeStore.getState().snapshot.runtimeEvents).toEqual([]);
  });

  it("does not dispatch orchestration persistence commands from renderer runtime events", () => {
    const dispatchCommand = vi.fn(() => Promise.resolve(undefined));
    vi.stubGlobal("window", {});

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "runtime-event",
      event: {
        ...turnStartedEventPrototype,
        id: EventId.make("runtime-event:agent-store:tool-completed"),
        type: "tool.completed",
        summary: "Done",
        data: {
          toolCallId: "tool-1",
          toolName: "read",
          isError: false,
        },
      },
    });

    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("caps incoming host snapshot runtime events before storing", () => {
    const runtimeEvents = Array.from({ length: 505 }, (_value, index) => ({
      ...turnStartedEventPrototype,
      id: EventId.make(`runtime-event:agent-store:snapshot:${index + 1}`),
      createdAt: new Date(Date.UTC(2026, 5, 1, 13, 0, index + 1)).toISOString(),
    }));

    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      runtimeEvents,
    });

    const retainedEvents = useAgentRuntimeStore.getState().snapshot.runtimeEvents;
    expect(retainedEvents).toHaveLength(500);
    expect(retainedEvents[0]?.id).toBe("runtime-event:agent-store:snapshot:6");
    expect(retainedEvents.at(-1)?.id).toBe("runtime-event:agent-store:snapshot:505");
  });

  it("keeps runtime threads active when only display timeline data is present", () => {
    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      sessionTrees: [sessionTreePrototype],
      displayTimelines: [displayTimelinePrototype],
    });

    expect(currentThread().session?.status).toBe("ready");

    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      displayTimelines: [displayTimelinePrototype],
    });

    expect(currentThread().session?.status).toBe("ready");
  });

  it("tracks active agent runs across turn boundaries", () => {
    const agentStartedEvent = {
      ...turnStartedEventPrototype,
      id: EventId.make("runtime-event:agent-store:agent-started"),
      type: "agent.started",
    } satisfies AgentRuntimeEvent;
    const turnCompletedEvent = {
      ...turnStartedEventPrototype,
      id: EventId.make("runtime-event:agent-store:turn-completed"),
      type: "turn.completed",
    } satisfies AgentRuntimeEvent;
    const toolCompletedEvent = {
      ...turnStartedEventPrototype,
      id: EventId.make("runtime-event:agent-store:tool-completed-active-run"),
      type: "tool.completed",
      data: { toolCallId: "tool-1", toolName: "read" },
    } satisfies AgentRuntimeEvent;
    const agentCompletedEvent = {
      ...turnStartedEventPrototype,
      id: EventId.make("runtime-event:agent-store:agent-completed"),
      type: "agent.completed",
    } satisfies AgentRuntimeEvent;

    expect(
      runtimeEventsIndicateActiveAgentRun(
        [agentStartedEvent, turnCompletedEvent, toolCompletedEvent],
        threadId,
      ),
    ).toBe(true);
    expect(
      runtimeEventsIndicateTerminalAgentRun(
        [agentStartedEvent, turnCompletedEvent, toolCompletedEvent],
        threadId,
      ),
    ).toBe(false);
    expect(
      runtimeEventsIndicateActiveAgentRun(
        [agentStartedEvent, turnCompletedEvent, agentCompletedEvent],
        threadId,
      ),
    ).toBe(false);
    expect(
      runtimeEventsIndicateTerminalAgentRun(
        [agentStartedEvent, turnCompletedEvent, agentCompletedEvent],
        threadId,
      ),
    ).toBe(true);
    expect(
      runtimeAgentRunEventState(
        [agentStartedEvent, turnCompletedEvent, toolCompletedEvent],
        threadId,
      ),
    ).toEqual({
      lifecycle: "active",
      latestTurnId: turnId,
    });
    expect(
      runtimeAgentRunEventState(
        [agentStartedEvent, turnCompletedEvent, agentCompletedEvent],
        threadId,
      ),
    ).toEqual({
      lifecycle: "terminal",
      latestTurnId: turnId,
    });
  });

  it("resolves the latest runtime event turn id for interruption fallback", () => {
    const nextTurnId = TurnId.make("turn:agent-runtime-store:next");
    const nextTurnEvent = {
      ...turnStartedEventPrototype,
      id: EventId.make("runtime-event:agent-store:next-turn"),
      turnId: nextTurnId,
    } satisfies AgentRuntimeEvent;

    expect(latestRuntimeEventTurnId([turnStartedEventPrototype, nextTurnEvent], threadId)).toBe(
      nextTurnId,
    );
    expect(latestRuntimeEventTurnId([nextTurnEvent], ThreadId.make("thread:other"))).toBeNull();
  });

  it("keeps per-thread runtime event references stable across interleaved tile reads", () => {
    const threadA = ThreadId.make("thread:runtime-events:tile-a");
    const threadB = ThreadId.make("thread:runtime-events:tile-b");
    const eventA = {
      ...turnStartedEventPrototype,
      id: EventId.make("runtime-event:tiling:a"),
      threadId: threadA,
    } satisfies AgentRuntimeEvent;
    const eventB = {
      ...turnStartedEventPrototype,
      id: EventId.make("runtime-event:tiling:b"),
      threadId: threadB,
    } satisfies AgentRuntimeEvent;

    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      runtimeEvents: [eventA, eventB],
    });
    const state = useAgentRuntimeStore.getState();

    // Tiled ChatView surfaces subscribe with different thread ids. Interleaving
    // reads must not invalidate one another's cached reference, otherwise each
    // useSyncExternalStore getSnapshot returns a fresh array and React loops.
    const firstA = selectRuntimeEventsForThread(state, threadA);
    const firstB = selectRuntimeEventsForThread(state, threadB);
    const secondA = selectRuntimeEventsForThread(state, threadA);
    const secondB = selectRuntimeEventsForThread(state, threadB);

    expect(secondA).toBe(firstA);
    expect(secondB).toBe(firstB);
    expect(firstA.map((event) => event.threadId)).toEqual([threadA]);
    expect(firstB.map((event) => event.threadId)).toEqual([threadB]);
  });
});
