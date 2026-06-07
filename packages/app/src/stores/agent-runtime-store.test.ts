import {
  AuthProviderId,
  EventId,
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type DesktopExtensionUiRequest,
  type SessionTreeProjection,
  type RuntimeDisplayTimelineProjection,
} from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "../lib/environment-scope";
import { createEmptyRuntimeHostSnapshot } from "../lib/multi-runtime-api";
import { getThreadFromEnvironmentState } from "../thread-derivation";
import { selectIsRuntimeThread, useAgentRuntimeStore } from "./agent-runtime-store";
import { initialState, selectEnvironmentState, useStore } from "./thread-store";

const threadId = ThreadId.make("thread:agent-runtime-store");
const runtimeSessionId = RuntimeSessionId.make("runtime:agent-runtime-store");
const turnId = TurnId.make("turn:agent-runtime-store");
const userEntryId = RuntimeItemId.make("runtime-item:agent-store:user");
const userThreadEntryId = ThreadEntryId.make("thread-entry:agent-store:user");
const userMessageCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 13, 0, 0)),
);
const turnStartedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 13, 0, 10)),
);
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

function currentThread() {
  const environmentState = selectEnvironmentState(useStore.getState(), DESKTOP_RUNTIME_ENVIRONMENT_ID);
  const thread = getThreadFromEnvironmentState(environmentState, threadId);
  expect(thread).toBeDefined();
  return thread!;
}

describe("agent runtime store", () => {
  beforeEach(() => {
    useStore.setState(initialState);
    useAgentRuntimeStore.setState({
      snapshot: createEmptyRuntimeHostSnapshot(),
      localRuntimeThreadIds: new Set(),
    });
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
          toolName: "shell",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          args: { command: "git status --short" },
          command: "git status --short",
          output: "M file.ts",
          summary: "Running shell",
          display: {
            kind: "shell",
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
          toolName: "shell",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          command: "git status --short",
          output: "M file.ts",
          display: {
            kind: "shell",
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
              kind: "shell",
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
          toolName: "shell",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          command: "git status --short",
          output: "M file.ts",
          display: {
            kind: "shell",
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
          toolName: "shell",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          command: "git status --short",
          output: "M file.ts",
          display: {
            kind: "shell",
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
                kind: "shell",
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

  it("does not replace display timeline identity when legacy command fields change behind typed display", () => {
    const timeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "tool:toolu-snapshot-typed-display",
          kind: "tool",
          orderKey: `${turnStartedAt}:tool:toolu-snapshot-typed-display`,
          createdAt: turnStartedAt,
          toolCallId: "toolu-snapshot-typed-display",
          toolName: "shell",
          turnId,
          status: "running",
          eventIds: [EventId.make("runtime-event:tool-started")],
          command: "git status --short",
          output: "M file.ts",
          display: {
            kind: "shell",
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

  it("does not update display timelines for recreated custom payloads with the same visible text", () => {
    const timeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "custom-message:agent-store",
          kind: "custom-message",
          orderKey: `${turnStartedAt}:custom-message:agent-store`,
          createdAt: turnStartedAt,
          entryId: RuntimeItemId.make("runtime:agent-store:custom"),
          threadEntryId: ThreadEntryId.make("thread-entry:agent-store:custom"),
          parentEntryId: null,
          parentThreadEntryId: null,
          customType: "git-agent-action",
          content: [{ type: "text", text: "Queued branch handoff" }],
          display: true,
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
            content: [{ type: "text", text: "Queued branch handoff" }],
            details: { observedAt: "2026-06-02T00:00:00.000Z" },
          },
        ],
      },
    });

    expect(useAgentRuntimeStore.getState().snapshot).toBe(initialSnapshot);
  });

  it("updates display timelines when custom message visible text changes", () => {
    const timeline = {
      ...displayTimelinePrototype,
      items: [
        {
          id: "custom-message:agent-store-visible",
          kind: "custom-message",
          orderKey: `${turnStartedAt}:custom-message:agent-store-visible`,
          createdAt: turnStartedAt,
          entryId: RuntimeItemId.make("runtime:agent-store:custom-visible"),
          threadEntryId: ThreadEntryId.make("thread-entry:agent-store:custom-visible"),
          parentEntryId: null,
          parentThreadEntryId: null,
          customType: "git-agent-action",
          content: [{ type: "text", text: "Queued branch handoff" }],
          display: true,
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
            content: [{ type: "text", text: "Committed branch" }],
          },
        ],
      },
    });

    expect(useAgentRuntimeStore.getState().snapshot).not.toBe(initialSnapshot);
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

  it("recognizes runtime thread ownership from host session trees", () => {
    useAgentRuntimeStore.getState().applyHostEvent({
      type: "session-tree",
      tree: sessionTreePrototype,
    });

    expect(selectIsRuntimeThread(useAgentRuntimeStore.getState(), threadId)).toBe(true);
  });

  it("does not append live raw runtime events to the app snapshot", () => {
    const initialSnapshot = useAgentRuntimeStore.getState().snapshot;
    let storeUpdateCount = 0;
    const unsubscribe = useAgentRuntimeStore.subscribe(() => {
      storeUpdateCount += 1;
    });

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "runtime-event",
      event: turnStartedEventPrototype,
    });
    unsubscribe();

    expect(useAgentRuntimeStore.getState().snapshot).toBe(initialSnapshot);
    expect(useAgentRuntimeStore.getState().snapshot.runtimeEvents).toEqual([]);
    expect(storeUpdateCount).toBe(0);
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
});
