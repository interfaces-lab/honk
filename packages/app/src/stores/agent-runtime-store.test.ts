import {
  AuthProviderId,
  type ClientOrchestrationCommand,
  ClientOrchestrationCommand as ClientOrchestrationCommandSchema,
  type EnvironmentApi,
  EventId,
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  threadEntryIdForMessageId,
  type DesktopExtensionUiRequest,
  type SessionTreeProjection,
  type RuntimeDisplayTimelineProjection,
} from "@multi/contracts";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../environment-api";
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
const decodeClientOrchestrationCommand = Schema.decodeUnknownSync(ClientOrchestrationCommandSchema);

function installRuntimePersistenceApi() {
  const dispatchedCommands: ClientOrchestrationCommand[] = [];
  const dispatchCommand = vi.fn((command: unknown) => {
    dispatchedCommands.push(decodeClientOrchestrationCommand(command));
    return Promise.resolve(undefined);
  });
  vi.stubGlobal("window", {});
  __setEnvironmentApiOverrideForTests(DESKTOP_RUNTIME_ENVIRONMENT_ID, {
    orchestration: { dispatchCommand },
  } as unknown as EnvironmentApi);
  return { dispatchedCommands };
}

function runtimePersistenceSessionTree(input: {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly clientMessageId: MessageId;
  readonly text: string;
  readonly assistantText: string;
  readonly turnId: TurnId;
}): SessionTreeProjection {
  const threadEntryId = threadEntryIdForMessageId(input.clientMessageId);
  const assistantEntryId = RuntimeItemId.make(`runtime-item:assistant:${input.clientMessageId}`);
  const assistantThreadEntryId = ThreadEntryId.make(`runtime:assistant:${input.clientMessageId}`);
  return {
    threadId: input.threadId,
    runtimeSessionId: input.runtimeSessionId,
    leafEntryId: assistantEntryId,
    entries: [
      {
        id: userEntryId,
        threadEntryId,
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "user",
        clientMessageId: input.clientMessageId,
        text: input.text,
        createdAt: userMessageCreatedAt,
        rawEntry: {},
      },
      {
        id: assistantEntryId,
        threadEntryId: assistantThreadEntryId,
        parentId: userEntryId,
        parentThreadEntryId: threadEntryId,
        kind: "message",
        role: "assistant",
        turnId: input.turnId,
        text: input.assistantText,
        createdAt: "2026-06-01T13:00:20.000Z",
        rawEntry: {},
      },
    ],
    nodes: [
      {
        entryId: userEntryId,
        threadEntryId,
        parentEntryId: null,
        depth: 0,
        isActivePath: true,
        isActiveLeaf: false,
        childCount: 1,
      },
      {
        entryId: assistantEntryId,
        threadEntryId: assistantThreadEntryId,
        parentEntryId: userEntryId,
        depth: 1,
        isActivePath: true,
        isActiveLeaf: true,
        childCount: 0,
      },
    ],
  };
}

function currentThread() {
  const environmentState = selectEnvironmentState(useStore.getState(), DESKTOP_RUNTIME_ENVIRONMENT_ID);
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
            agentScope: "user",
            projectAgentsDir: null,
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

  it("persists assistant completions from host snapshot session trees", () => {
    const { dispatchedCommands } = installRuntimePersistenceApi();
    const clientMessageId = MessageId.make("message:agent-store:persist-user");

    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      sessionTrees: [
        runtimePersistenceSessionTree({
          threadId,
          runtimeSessionId,
          clientMessageId,
          text: "Start",
          assistantText: "Persisted answer",
          turnId,
        }),
      ],
    });

    expect(dispatchedCommands).toEqual([
      expect.objectContaining({
        type: "thread.message.assistant.complete",
        threadId,
        text: "Persisted answer",
        turnId,
        parentEntryId: threadEntryIdForMessageId(clientMessageId),
      }),
    ]);
  });

  it("dedupes runtime assistant persistence by thread and runtime session", () => {
    const { dispatchedCommands } = installRuntimePersistenceApi();
    const secondThreadId = ThreadId.make("thread:agent-runtime-store:second");
    const secondRuntimeSessionId = RuntimeSessionId.make("runtime:agent-runtime-store:second");
    const secondTurnId = TurnId.make("turn:agent-runtime-store:second");
    const firstClientMessageId = MessageId.make("message:agent-store:first-user");
    const secondClientMessageId = MessageId.make("message:agent-store:second-user");

    useAgentRuntimeStore.getState().setSnapshot({
      ...emptyHostSnapshotPrototype,
      sessionTrees: [
        runtimePersistenceSessionTree({
          threadId,
          runtimeSessionId,
          clientMessageId: firstClientMessageId,
          text: "First",
          assistantText: "First answer",
          turnId,
        }),
        runtimePersistenceSessionTree({
          threadId: secondThreadId,
          runtimeSessionId: secondRuntimeSessionId,
          clientMessageId: secondClientMessageId,
          text: "Second",
          assistantText: "Second answer",
          turnId: secondTurnId,
        }),
      ],
    });

    expect(dispatchedCommands).toEqual([
      expect.objectContaining({
        type: "thread.message.assistant.complete",
        threadId,
        text: "First answer",
        parentEntryId: threadEntryIdForMessageId(firstClientMessageId),
      }),
      expect.objectContaining({
        type: "thread.message.assistant.complete",
        threadId: secondThreadId,
        text: "Second answer",
        parentEntryId: threadEntryIdForMessageId(secondClientMessageId),
      }),
    ]);
  });

  it("persists tool completion activities with contract-safe payload values", () => {
    const { dispatchedCommands } = installRuntimePersistenceApi();

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "runtime-event",
      event: {
        ...turnStartedEventPrototype,
        id: EventId.make("runtime-event:agent-store:tool-completed"),
        type: "tool.completed",
        summary: "   ",
        data: {
          toolCallId: "   ",
          toolName: "   ",
          isError: false,
          args: {
            count: 1n,
            skipped: undefined,
          },
          result: {
            value: Number.POSITIVE_INFINITY,
          },
        },
      },
    });

    expect(dispatchedCommands).toHaveLength(1);
    const command = dispatchedCommands[0];
    expect(command).toEqual(
      expect.objectContaining({
        type: "thread.activity.append",
        threadId,
        activity: expect.objectContaining({
          kind: "tool.completed",
          summary: "Tool completed",
          payload: expect.objectContaining({
            itemId: "runtime-event:agent-store:tool-completed",
            title: "tool",
            data: {
              toolCallId: "runtime-event:agent-store:tool-completed",
              toolName: "tool",
              isError: false,
              args: {
                count: "1",
              },
              result: {
                value: null,
              },
            },
          }),
        }),
      }),
    );
  });

  it("normalizes subagent usage activities before persistence", () => {
    const { dispatchedCommands } = installRuntimePersistenceApi();

    useAgentRuntimeStore.getState().applyHostEvent({
      type: "runtime-event",
      event: {
        ...turnStartedEventPrototype,
        id: EventId.make("runtime-event:agent-store:subagent-usage"),
        type: "tool.completed",
        data: {
          toolName: "subagent",
          result: {
            details: {
              activities: [
                {
                  id: "runtime-subagent:usage",
                  kind: "subagent.usage.updated",
                  summary: "Usage update",
                  createdAt: turnStartedAt,
                  sequence: -1,
                  payload: {
                    subagentThreadId: "thread:agent-runtime-store:child",
                    usedTokens: 42,
                    maxTokens: 0,
                  },
                },
              ],
            },
          },
        },
      },
    });

    expect(dispatchedCommands).toHaveLength(1);
    const command = dispatchedCommands[0];
    expect(command).toEqual(
      expect.objectContaining({
        type: "thread.activity.append",
        activity: expect.objectContaining({
          kind: "subagent.usage.updated",
          payload: {
            subagentThreadId: "thread:agent-runtime-store:child",
            parentTurnId: turnId,
            usedTokens: 42,
          },
        }),
      }),
    );
    if (command?.type !== "thread.activity.append") {
      throw new Error("expected thread activity append command");
    }
    expect(command.activity).not.toHaveProperty("sequence");
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
