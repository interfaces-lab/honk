import {
  EnvironmentId,
  EventId,
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type SessionTreeProjection,
} from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { getThreadFromEnvironmentState } from "../thread-derivation";
import { initialState, selectEnvironmentState, useStore } from "./thread-store";

const environmentId = EnvironmentId.make("environment:pi-runtime-store");
const threadId = ThreadId.make("thread:pi-runtime-store");
const runtimeSessionId = RuntimeSessionId.make("runtime:pi-runtime-store");
const turnId = TurnId.make("turn:pi-runtime-store");
const modelEntryId = RuntimeItemId.make("runtime-item:model");
const thinkingEntryId = RuntimeItemId.make("runtime-item:thinking");
const userEntryId = RuntimeItemId.make("runtime-item:user");
const toolCallEntryId = RuntimeItemId.make("runtime-item:assistant-tool-call");
const toolResultEntryId = RuntimeItemId.make("runtime-item:tool-result");
const assistantEntryId = RuntimeItemId.make("runtime-item:assistant");
const infoEntryId = RuntimeItemId.make("runtime-item:session-info");
const modelThreadEntryId = ThreadEntryId.make("thread-entry:model");
const thinkingThreadEntryId = ThreadEntryId.make("thread-entry:thinking");
const userThreadEntryId = ThreadEntryId.make("thread-entry:user");
const toolCallThreadEntryId = ThreadEntryId.make("thread-entry:assistant-tool-call");
const toolResultThreadEntryId = ThreadEntryId.make("thread-entry:tool-result");
const assistantThreadEntryId = ThreadEntryId.make("thread-entry:assistant");
const infoThreadEntryId = ThreadEntryId.make("thread-entry:session-info");
const seededToolCallId = "tool-call-seeded";
const modelEntryCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 11, 59, 58)),
);
const thinkingEntryCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 11, 59, 59)),
);
const userMessageCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 0)),
);
const toolCallCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 1)),
);
const toolResultCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 2)),
);
const assistantMessageCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 3)),
);
const sessionInfoCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 4)),
);
const turnStartedAt = Date.prototype.toISOString.call(new Date(Date.UTC(2026, 5, 1, 12, 0, 10)));
const messageUpdatedAt = Date.prototype.toISOString.call(new Date(Date.UTC(2026, 5, 1, 12, 0, 11)));
const toolStartedAt = Date.prototype.toISOString.call(new Date(Date.UTC(2026, 5, 1, 12, 0, 12)));
const extensionUiRequestedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 25)),
);
const queueUpdatedAt = Date.prototype.toISOString.call(new Date(Date.UTC(2026, 5, 1, 12, 0, 30)));
const turnInterruptedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 31)),
);
const turnCompletedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 32)),
);
const sessionTreeProjection = {
  threadId,
  runtimeSessionId,
  leafEntryId: infoEntryId,
  entries: [
    {
      id: modelEntryId,
      threadEntryId: modelThreadEntryId,
      parentId: null,
      parentThreadEntryId: null,
      kind: "model-change",
      createdAt: modelEntryCreatedAt,
      rawEntry: {},
    },
    {
      id: thinkingEntryId,
      threadEntryId: thinkingThreadEntryId,
      parentId: modelEntryId,
      parentThreadEntryId: modelThreadEntryId,
      kind: "thinking-level-change",
      createdAt: thinkingEntryCreatedAt,
      rawEntry: {},
    },
    {
      id: userEntryId,
      threadEntryId: userThreadEntryId,
      parentId: thinkingEntryId,
      parentThreadEntryId: thinkingThreadEntryId,
      kind: "message",
      role: "user",
      clientMessageId: MessageId.make("message:user"),
      text: "Start",
      createdAt: userMessageCreatedAt,
      rawEntry: {},
    },
    {
      id: toolCallEntryId,
      threadEntryId: toolCallThreadEntryId,
      parentId: userEntryId,
      parentThreadEntryId: userThreadEntryId,
      kind: "message",
      role: "assistant",
      turnId,
      thinking: "Seeded thinking",
      createdAt: toolCallCreatedAt,
      rawEntry: {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Seeded thinking" },
            {
              type: "toolCall",
              id: seededToolCallId,
              name: "bash",
              arguments: { command: "pwd" },
            },
          ],
        },
      },
    },
    {
      id: toolResultEntryId,
      threadEntryId: toolResultThreadEntryId,
      parentId: toolCallEntryId,
      parentThreadEntryId: toolCallThreadEntryId,
      kind: "message",
      role: "toolResult",
      turnId,
      createdAt: toolResultCreatedAt,
      rawEntry: {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: seededToolCallId,
          toolName: "bash",
          content: [{ type: "text", text: "/Users/workgyver/Developer/multi" }],
          isError: false,
        },
      },
    },
    {
      id: assistantEntryId,
      threadEntryId: assistantThreadEntryId,
      parentId: toolResultEntryId,
      parentThreadEntryId: toolResultThreadEntryId,
      kind: "message",
      role: "assistant",
      turnId,
      text: "Seeded answer",
      createdAt: assistantMessageCreatedAt,
      rawEntry: {},
    },
    {
      id: infoEntryId,
      threadEntryId: infoThreadEntryId,
      parentId: assistantEntryId,
      parentThreadEntryId: assistantThreadEntryId,
      kind: "session-info",
      text: "Pi runtime thread",
      createdAt: sessionInfoCreatedAt,
      rawEntry: {},
    },
  ],
  nodes: [
    {
      entryId: modelEntryId,
      threadEntryId: modelThreadEntryId,
      parentEntryId: null,
      depth: 0,
      isActivePath: true,
      isActiveLeaf: false,
      childCount: 1,
    },
    {
      entryId: thinkingEntryId,
      threadEntryId: thinkingThreadEntryId,
      parentEntryId: modelEntryId,
      depth: 1,
      isActivePath: true,
      isActiveLeaf: false,
      childCount: 1,
    },
    {
      entryId: userEntryId,
      threadEntryId: userThreadEntryId,
      parentEntryId: thinkingEntryId,
      depth: 2,
      isActivePath: true,
      isActiveLeaf: false,
      childCount: 1,
    },
    {
      entryId: toolCallEntryId,
      threadEntryId: toolCallThreadEntryId,
      parentEntryId: userEntryId,
      depth: 3,
      isActivePath: true,
      isActiveLeaf: false,
      childCount: 1,
    },
    {
      entryId: toolResultEntryId,
      threadEntryId: toolResultThreadEntryId,
      parentEntryId: toolCallEntryId,
      depth: 4,
      isActivePath: true,
      isActiveLeaf: false,
      childCount: 1,
    },
    {
      entryId: assistantEntryId,
      threadEntryId: assistantThreadEntryId,
      parentEntryId: toolResultEntryId,
      depth: 5,
      isActivePath: true,
      isActiveLeaf: false,
      childCount: 1,
    },
    {
      entryId: infoEntryId,
      threadEntryId: infoThreadEntryId,
      parentEntryId: assistantEntryId,
      depth: 6,
      isActivePath: true,
      isActiveLeaf: true,
      childCount: 0,
    },
  ],
} satisfies SessionTreeProjection;
const turnStartedEvent = {
  id: EventId.make("runtime-event:turn.started"),
  type: "turn.started",
  agentRuntime: "pi",
  threadId,
  runtimeSessionId,
  turnId,
  createdAt: turnStartedAt,
} satisfies AgentRuntimeEvent;
const userMessageUpdatedEvent = {
  id: EventId.make("runtime-event:user-message.updated"),
  type: "message.updated",
  agentRuntime: "pi",
  threadId,
  runtimeSessionId,
  turnId,
  createdAt: messageUpdatedAt,
  messageRole: "user",
  text: "Follow-up prompt",
} satisfies AgentRuntimeEvent;
const messageUpdatedEvent = {
  id: EventId.make("runtime-event:message.updated"),
  type: "message.updated",
  agentRuntime: "pi",
  threadId,
  runtimeSessionId,
  turnId,
  createdAt: messageUpdatedAt,
  messageRole: "assistant",
  text: "Live answer",
  thinking: "Live thinking",
} satisfies AgentRuntimeEvent;
const toolStartedEvent = {
  id: EventId.make("runtime-event:tool.started"),
  type: "tool.started",
  agentRuntime: "pi",
  threadId,
  runtimeSessionId,
  turnId,
  createdAt: toolStartedAt,
  data: {
    toolCallId: "tool-call-1",
    toolName: "bash",
    args: { command: "pnpm run typecheck" },
  },
} satisfies AgentRuntimeEvent;
const extensionUiRequest = {
  id: EventId.make("extension-ui-request:confirm"),
  threadId,
  runtimeSessionId,
  kind: "confirm",
  title: "Run tool?",
  message: "Pi needs a confirmation.",
  createdAt: extensionUiRequestedAt,
} satisfies DesktopExtensionUiRequest;
const queueUpdatedEvent = {
  id: EventId.make("runtime-event:queue.updated"),
  type: "queue.updated",
  agentRuntime: "pi",
  threadId,
  runtimeSessionId,
  createdAt: queueUpdatedAt,
  data: { queuedTurns: 1 },
} satisfies AgentRuntimeEvent;
const turnInterruptedEvent = {
  id: EventId.make("runtime-event:turn.interrupted"),
  type: "turn.interrupted",
  agentRuntime: "pi",
  threadId,
  runtimeSessionId,
  turnId,
  createdAt: turnInterruptedAt,
} satisfies AgentRuntimeEvent;
const turnCompletedEvent = {
  id: EventId.make("runtime-event:turn.completed"),
  type: "turn.completed",
  agentRuntime: "pi",
  threadId,
  runtimeSessionId,
  turnId,
  createdAt: turnCompletedAt,
} satisfies AgentRuntimeEvent;

function currentThread() {
  const environmentState = selectEnvironmentState(useStore.getState(), environmentId);
  const thread = getThreadFromEnvironmentState(environmentState, threadId);
  expect(thread).toBeDefined();
  return { environmentState, thread: thread! };
}

describe("Pi runtime thread sync", () => {
  beforeEach(() => {
    useStore.setState(initialState);
  });

  it("projects Pi session trees into normalized thread state", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);

    const { environmentState, thread } = currentThread();
    expect(environmentState.bootstrapComplete).toBe(true);
    expect(thread.title).toBe("Pi runtime thread");
    expect(thread.session?.status).toBe("ready");
    expect(thread.session?.orchestrationStatus).toBe("ready");
    expect(thread.leafId).toBe(assistantThreadEntryId);
    expect(thread.entries.map((entry) => [entry.id, entry.parentEntryId])).toEqual([
      [userThreadEntryId, null],
      [assistantThreadEntryId, userThreadEntryId],
    ]);
    expect(thread.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "Start"],
      ["assistant", "Seeded answer"],
    ]);
    expect(thread.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "assistant", text: "" })]),
    );
    expect(thread.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "task.completed",
          payload: expect.objectContaining({ detail: "Seeded thinking" }),
          turnId,
        }),
        expect.objectContaining({
          kind: "tool.started",
          payload: expect.objectContaining({
            itemId: seededToolCallId,
            data: expect.objectContaining({ command: "pwd" }),
          }),
          turnId,
        }),
        expect.objectContaining({
          kind: "tool.completed",
          payload: expect.objectContaining({
            itemId: seededToolCallId,
            detail: "/Users/workgyver/Developer/multi",
          }),
          turnId,
        }),
      ]),
    );
    expect((thread.chatTimelineRows ?? []).map((row) => row.kind)).toEqual(
      expect.arrayContaining(["message", "work"]),
    );
    expect(environmentState.sidebarThreadSummaryById[threadId]?.title).toBe("Pi runtime thread");
  });

  it("applies live Pi events and pending extension UI requests", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);
    useStore.getState().applyAgentRuntimeEvent(turnStartedEvent, environmentId);
    useStore.getState().applyAgentRuntimeEvent(userMessageUpdatedEvent, environmentId);
    expect(currentThread().thread.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          streaming: true,
          text: "Follow-up prompt",
        }),
      ]),
    );

    useStore.getState().applyAgentRuntimeEvent(messageUpdatedEvent, environmentId);
    useStore.getState().applyAgentRuntimeEvent(toolStartedEvent, environmentId);
    useStore.getState().syncPendingExtensionUiRequests([extensionUiRequest], environmentId);
    let { thread } = currentThread();

    expect(thread.session?.status).toBe("running");
    expect(thread.latestTurn?.state).toBe("running");
    expect(thread.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          streaming: true,
          text: "Live answer",
          turnId,
        }),
      ]),
    );
    expect(thread.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "task.progress", turnId }),
        expect.objectContaining({
          kind: "tool.started",
          payload: expect.objectContaining({
            itemId: "tool-call-1",
            data: expect.objectContaining({ command: "pnpm run typecheck" }),
          }),
          turnId,
        }),
        expect.objectContaining({
          kind: "extension-ui.requested",
          summary: "Waiting for Run tool?",
          turnId,
        }),
      ]),
    );
    expect((thread.chatTimelineRows ?? []).map((row) => row.kind)).toEqual(
      expect.arrayContaining(["message", "work"]),
    );

    useStore.getState().syncPendingExtensionUiRequests([], environmentId);
    thread = currentThread().thread;
    expect(thread.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "extension-ui.resolved",
          summary: "Answered Run tool?",
          turnId,
        }),
      ]),
    );

    const activityIdsBeforeQueueEvent = currentThread().environmentState.activityIdsByThreadId[threadId];
    useStore.getState().applyAgentRuntimeEvent(queueUpdatedEvent, environmentId);
    expect(currentThread().environmentState.activityIdsByThreadId[threadId]).toEqual(
      activityIdsBeforeQueueEvent,
    );

    useStore.getState().applyAgentRuntimeEvent(turnInterruptedEvent, environmentId);
    thread = currentThread().thread;
    expect(thread.session?.status).toBe("ready");
    expect(thread.session?.activeTurnId).toBeUndefined();
    expect(thread.latestTurn?.state).toBe("interrupted");
    expect(thread.latestTurn?.completedAt).toBe(turnInterruptedAt);
    expect(thread.messages.find((message) => message.turnId === turnId)?.streaming).toBe(false);

    useStore.getState().applyAgentRuntimeEvent(turnCompletedEvent, environmentId);
    thread = currentThread().thread;
    expect(thread.latestTurn?.state).toBe("interrupted");
    expect(thread.latestTurn?.completedAt).toBe(turnInterruptedAt);
  });
});
