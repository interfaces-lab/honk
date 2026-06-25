import {
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  resolveThreadEntryPath,
  runtimeSessionEntryMessageId,
  threadEntryIdForMessageId,
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type OrchestrationThreadActivity,
  type OrchestrationThread,
  type SessionTreeProjection,
} from "@honk/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { getThreadFromEnvironmentState } from "../thread-derivation";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { applyLocalThreadTurnStartRequested } from "./local-orchestration-events";
import { selectSubagentProjection, useSubagentActivityStore } from "./subagent-activity-store";
import { useSubagentTrayStore } from "./subagent-tray-store";
import { runtimeSubagentActivitiesForToolEvent } from "./thread-sync";
import { initialState, selectEnvironmentState, useStore } from "./thread-store";

const environmentId = EnvironmentId.make("environment:pi-runtime-store");
const threadId = ThreadId.make("thread:pi-runtime-store");
const projectId = ProjectId.make("project:pi-runtime-store");
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
const serverUserThreadEntryId = ThreadEntryId.make("thread-entry:server-user");
const toolCallThreadEntryId = ThreadEntryId.make("thread-entry:assistant-tool-call");
const toolResultThreadEntryId = ThreadEntryId.make("thread-entry:tool-result");
const assistantThreadEntryId = ThreadEntryId.make("thread-entry:assistant");
const infoThreadEntryId = ThreadEntryId.make("thread-entry:session-info");
const seededToolCallId = "tool-call-seeded";
const subagentParentItemId = RuntimeItemId.make("tool-call-subagent");
const modelEntryCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 11, 59, 58)),
);
const thinkingEntryCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 11, 59, 59)),
);
const userMessageCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 0)),
);
const toolCallCreatedAt = Date.prototype.toISOString.call(new Date(Date.UTC(2026, 5, 1, 12, 0, 1)));
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
const subagentUpdatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 26)),
);
const subagentSnapshotUpdatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 27)),
);
const subagentSnapshotUpdatedAgainAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 28)),
);
const queueUpdatedAt = Date.prototype.toISOString.call(new Date(Date.UTC(2026, 5, 1, 12, 0, 30)));
const turnInterruptedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 0, 31)),
);
const turnCompletedAt = Date.prototype.toISOString.call(new Date(Date.UTC(2026, 5, 1, 12, 0, 32)));
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
          content: [{ type: "text", text: "/Users/workgyver/Developer/honk" }],
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
  data: { type: "turn_end" },
} satisfies AgentRuntimeEvent;
const agentCompletedEvent = {
  id: EventId.make("runtime-event:agent.completed"),
  type: "agent.completed",
  agentRuntime: "pi",
  threadId,
  runtimeSessionId,
  createdAt: "2026-06-01T12:00:33.000Z",
} satisfies AgentRuntimeEvent;
const subagentThreadId = "thread:pi-runtime-store:subagent";
const otherThreadId = ThreadId.make("thread:pi-runtime-store:other");
const otherSubagentThreadId = "thread:pi-runtime-store:other:subagent";
const siblingSubagentThreadId = "thread:pi-runtime-store:sibling-subagent";

function openSubagentTrayForTests(
  input: {
    readonly threadId?: ThreadId;
    readonly subagentThreadId?: string;
  } = {},
): void {
  const activeThreadId = input.threadId ?? threadId;
  const focusedSubagentThreadId = input.subagentThreadId ?? subagentThreadId;
  useSubagentTrayStore.getState().openTray({
    key: focusedSubagentThreadId,
    activeThreadId,
    environmentId,
    projectRoot: undefined,
    subagentThreadId: focusedSubagentThreadId,
  });
}

function subagentToolUpdatedEvent(
  detail: string,
  createdAt = subagentUpdatedAt,
): AgentRuntimeEvent {
  return {
    id: EventId.make(`runtime-event:subagent-tool.updated:${detail}`),
    type: "tool.updated",
    agentRuntime: "pi",
    threadId,
    runtimeSessionId,
    turnId,
    createdAt,
    data: {
      toolName: "subagent",
      partialResult: {
        details: {
          activities: [
            {
              id: "runtime-subagent:start",
              kind: "subagent.thread.started",
              tone: "info",
              summary: "Started review",
              sequence: 1,
              createdAt,
              payload: {
                subagentThreadId,
                parentThreadId: threadId,
                parentItemId: "tool-call-subagent",
                agentId: "agent:review",
                nickname: "Review renderer",
                role: "reviewer",
                model: "gpt-5.5",
                prompt: "Review the renderer",
              },
            },
            {
              id: "runtime-subagent:assistant",
              kind: "subagent.item.updated",
              tone: "info",
              summary: "Subagent response",
              sequence: 2,
              createdAt,
              payload: {
                subagentThreadId,
                parentThreadId: threadId,
                parentItemId: "tool-call-subagent",
                agentId: "agent:review",
                nickname: "Review renderer",
                role: "reviewer",
                model: "gpt-5.5",
                prompt: "Review the renderer",
                itemType: "assistant_message",
                itemId: "assistant:review",
                status: "running",
                title: "Assistant",
                detail,
              },
            },
          ],
        },
      },
    },
  } satisfies AgentRuntimeEvent;
}

function otherThreadSubagentToolUpdatedEvent(
  detail: string,
  createdAt = subagentUpdatedAt,
): AgentRuntimeEvent {
  return {
    id: EventId.make(`runtime-event:other-subagent-tool.updated:${detail}`),
    type: "tool.updated",
    agentRuntime: "pi",
    threadId: otherThreadId,
    runtimeSessionId,
    turnId,
    createdAt,
    data: {
      toolName: "subagent",
      partialResult: {
        details: {
          activities: [
            {
              id: "runtime-subagent:other:start",
              kind: "subagent.thread.started",
              tone: "info",
              summary: "Started other review",
              sequence: 1,
              createdAt,
              payload: {
                subagentThreadId: otherSubagentThreadId,
                parentThreadId: otherThreadId,
                parentItemId: "tool-call-other-subagent",
                agentId: "agent:other-review",
                nickname: "Other reviewer",
                role: "reviewer",
                model: "gpt-5.5",
                prompt: "Review the other renderer",
              },
            },
            {
              id: "runtime-subagent:other:assistant",
              kind: "subagent.item.updated",
              tone: "info",
              summary: "Other subagent response",
              sequence: 2,
              createdAt,
              payload: {
                subagentThreadId: otherSubagentThreadId,
                parentThreadId: otherThreadId,
                parentItemId: "tool-call-other-subagent",
                agentId: "agent:other-review",
                nickname: "Other reviewer",
                role: "reviewer",
                model: "gpt-5.5",
                prompt: "Review the other renderer",
                itemType: "assistant_message",
                itemId: "assistant:other-review",
                status: "running",
                title: "Assistant",
                detail,
              },
            },
          ],
        },
      },
    },
  } satisfies AgentRuntimeEvent;
}

function subagentProjectionActivities(
  streamingDetail: string,
): ReadonlyArray<OrchestrationThreadActivity> {
  return [
    {
      id: EventId.make("projection-subagent:start"),
      kind: "subagent.thread.started",
      tone: "info",
      summary: "Started review",
      sequence: 1,
      createdAt: subagentUpdatedAt,
      turnId,
      payload: {
        subagentThreadId,
        parentThreadId: threadId,
        parentItemId: subagentParentItemId,
        agentId: "agent:review",
        nickname: "Review renderer",
        role: "reviewer",
        model: "gpt-5.5",
        prompt: "Review the renderer",
      },
    },
    {
      id: EventId.make("projection-subagent:stable"),
      kind: "subagent.item.completed",
      tone: "info",
      summary: "Stable subagent response",
      sequence: 2,
      createdAt: subagentUpdatedAt,
      turnId,
      payload: {
        subagentThreadId,
        parentThreadId: threadId,
        parentItemId: subagentParentItemId,
        agentId: "agent:review",
        nickname: "Review renderer",
        role: "reviewer",
        model: "gpt-5.5",
        prompt: "Review the renderer",
        itemType: "assistant_message",
        itemId: "assistant:stable",
        status: "completed",
        title: "Assistant",
        detail: "stable child response",
      },
    },
    {
      id: EventId.make("projection-subagent:streaming"),
      kind: "subagent.item.updated",
      tone: "info",
      summary: "Streaming subagent response",
      sequence: 3,
      createdAt: subagentUpdatedAt,
      turnId,
      payload: {
        subagentThreadId,
        parentThreadId: threadId,
        parentItemId: subagentParentItemId,
        agentId: "agent:review",
        nickname: "Review renderer",
        role: "reviewer",
        model: "gpt-5.5",
        prompt: "Review the renderer",
        itemType: "assistant_message",
        itemId: "assistant:streaming",
        status: "running",
        title: "Assistant",
        detail: streamingDetail,
      },
    },
  ];
}

function siblingSubagentProjectionActivities(): ReadonlyArray<OrchestrationThreadActivity> {
  return [
    {
      id: EventId.make("projection-sibling-subagent:start"),
      kind: "subagent.thread.started",
      tone: "info",
      summary: "Started sibling review",
      sequence: 10,
      createdAt: subagentUpdatedAt,
      turnId,
      payload: {
        subagentThreadId: siblingSubagentThreadId,
        parentThreadId: threadId,
        parentItemId: RuntimeItemId.make("tool-call-sibling-subagent"),
        agentId: "agent:sibling-review",
        nickname: "Sibling reviewer",
        role: "reviewer",
        model: "gpt-5.5",
        prompt: "Review the sibling renderer",
      },
    },
    {
      id: EventId.make("projection-sibling-subagent:stable"),
      kind: "subagent.item.completed",
      tone: "info",
      summary: "Stable sibling response",
      sequence: 11,
      createdAt: subagentUpdatedAt,
      turnId,
      payload: {
        subagentThreadId: siblingSubagentThreadId,
        parentThreadId: threadId,
        parentItemId: RuntimeItemId.make("tool-call-sibling-subagent"),
        agentId: "agent:sibling-review",
        nickname: "Sibling reviewer",
        role: "reviewer",
        model: "gpt-5.5",
        prompt: "Review the sibling renderer",
        itemType: "assistant_message",
        itemId: "assistant:sibling",
        status: "completed",
        title: "Assistant",
        detail: "stable sibling response",
      },
    },
  ];
}

function subagentContentDeltaActivity(input: {
  id: string;
  delta: string;
  sequence: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(`projection-subagent:delta:${input.id}`),
    kind: "subagent.content.delta",
    tone: "info",
    summary: "Streaming assistant text",
    sequence: input.sequence,
    createdAt: subagentUpdatedAt,
    turnId,
    payload: {
      subagentThreadId,
      parentThreadId: threadId,
      parentItemId: subagentParentItemId,
      agentId: "agent:review",
      nickname: "Review renderer",
      role: "reviewer",
      model: "gpt-5.5",
      prompt: "Review the renderer",
      streamKind: "assistant_text",
      itemId: "assistant:delta",
      delta: input.delta,
    },
  };
}

function currentThread() {
  const environmentState = selectEnvironmentState(useStore.getState(), environmentId);
  const thread = getThreadFromEnvironmentState(environmentState, threadId);
  expect(thread).toBeDefined();
  return { environmentState, thread: thread! };
}

function serverThreadDetailWithSubagent(detail: string, updatedAt: string): OrchestrationThread {
  const userMessageId = MessageId.make("message:server-user");
  return {
    id: threadId,
    projectId,
    title: "Pi runtime thread",
    modelSelection: {
      instanceId: "codex",
      model: "gpt-5.5",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: userMessageCreatedAt,
    updatedAt,
    archivedAt: null,
    deletedAt: null,
    messages: [
      {
        id: userMessageId,
        role: "user",
        text: "Start",
        turnId: null,
        streaming: false,
        createdAt: userMessageCreatedAt,
        updatedAt: userMessageCreatedAt,
      },
    ],
    leafId: serverUserThreadEntryId,
    entries: [
      {
        id: serverUserThreadEntryId,
        threadId,
        parentEntryId: null,
        kind: "message",
        messageId: userMessageId,
        turnId: null,
        createdAt: userMessageCreatedAt,
      },
    ],
    proposedPlans: [],
    activities: [
      {
        id: EventId.make("server-subagent:start"),
        kind: "subagent.thread.started",
        tone: "info",
        summary: "Started review",
        turnId,
        sequence: 1,
        createdAt: subagentSnapshotUpdatedAt,
        payload: {
          subagentThreadId,
          parentThreadId: threadId,
          parentItemId: subagentParentItemId,
          agentId: "agent:review",
          nickname: "Review renderer",
          role: "reviewer",
          model: "gpt-5.5",
          prompt: "Review the renderer",
        },
      },
      {
        id: EventId.make("server-subagent:assistant"),
        kind: "subagent.item.updated",
        tone: "info",
        summary: "Subagent response",
        turnId,
        sequence: 2,
        createdAt: updatedAt,
        payload: {
          subagentThreadId,
          parentThreadId: threadId,
          parentItemId: subagentParentItemId,
          agentId: "agent:review",
          nickname: "Review renderer",
          role: "reviewer",
          model: "gpt-5.5",
          prompt: "Review the renderer",
          itemType: "assistant_message",
          itemId: "assistant:review",
          status: "running",
          title: "Assistant",
          detail,
        },
      },
    ],
    session: null,
  };
}

const existingUserMessageId = MessageId.make("message:existing-user");
const existingAssistantMessageId = MessageId.make("message:existing-assistant");
const existingUserThreadEntryId = threadEntryIdForMessageId(existingUserMessageId);
const existingAssistantThreadEntryId = threadEntryIdForMessageId(existingAssistantMessageId);
const gitActionMessageId = MessageId.make("message:git-action");
const gitActionThreadEntryId = threadEntryIdForMessageId(gitActionMessageId);
const gitActionAssistantThreadEntryId = ThreadEntryId.make("thread-entry:git-action-assistant");
const gitActionTurnId = TurnId.make("turn:git-action");
const gitActionUserRuntimeItemId = RuntimeItemId.make("runtime-item:git-action-user");
const gitActionAssistantRuntimeItemId = RuntimeItemId.make("runtime-item:git-action-assistant");
const textEchoUserRuntimeItemId = RuntimeItemId.make("runtime-item:text-echo-user");
const userClientThreadEntryId = threadEntryIdForMessageId(MessageId.make("message:user"));
const assistantRuntimeThreadEntryId = runtimeSessionThreadEntryId(assistantEntryId);
const gitActionUserRuntimeThreadEntryId = runtimeSessionThreadEntryId(gitActionUserRuntimeItemId);
const gitActionAssistantRuntimeThreadEntryId = runtimeSessionThreadEntryId(
  gitActionAssistantRuntimeItemId,
);
const gitActionUserCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 1, 0)),
);
const gitActionAssistantCreatedAt = Date.prototype.toISOString.call(
  new Date(Date.UTC(2026, 5, 1, 12, 1, 1)),
);
const gitActionPrompt = "GitAction: commitAndPush\nAction: Commit & Push";

function runtimeSessionThreadEntryId(entryId: RuntimeItemId): ThreadEntryId {
  return threadEntryIdForMessageId(runtimeSessionEntryMessageId(runtimeSessionId, entryId));
}

function serverThreadDetailWithExistingTranscript(input?: {
  readonly includeGitActionUser?: boolean;
}): OrchestrationThread {
  const includeGitActionUser = input?.includeGitActionUser ?? false;
  return {
    id: threadId,
    projectId,
    title: "Existing thread",
    modelSelection: {
      instanceId: "codex",
      model: "gpt-5.5",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: userMessageCreatedAt,
    updatedAt: includeGitActionUser ? gitActionUserCreatedAt : assistantMessageCreatedAt,
    archivedAt: null,
    deletedAt: null,
    messages: [
      {
        id: existingUserMessageId,
        role: "user",
        text: "hello!",
        turnId: null,
        streaming: false,
        createdAt: userMessageCreatedAt,
        updatedAt: userMessageCreatedAt,
      },
      {
        id: existingAssistantMessageId,
        role: "assistant",
        text: "Hello. How can I help?",
        turnId,
        streaming: false,
        createdAt: assistantMessageCreatedAt,
        updatedAt: assistantMessageCreatedAt,
      },
      ...(includeGitActionUser
        ? [
            {
              id: gitActionMessageId,
              role: "user" as const,
              text: gitActionPrompt,
              turnId: null,
              streaming: false,
              createdAt: gitActionUserCreatedAt,
              updatedAt: gitActionUserCreatedAt,
            },
          ]
        : []),
    ],
    leafId: includeGitActionUser ? gitActionThreadEntryId : existingAssistantThreadEntryId,
    entries: [
      {
        id: existingUserThreadEntryId,
        threadId,
        parentEntryId: null,
        kind: "message",
        messageId: existingUserMessageId,
        turnId: null,
        createdAt: userMessageCreatedAt,
      },
      {
        id: existingAssistantThreadEntryId,
        threadId,
        parentEntryId: existingUserThreadEntryId,
        kind: "message",
        messageId: existingAssistantMessageId,
        turnId,
        createdAt: assistantMessageCreatedAt,
      },
      ...(includeGitActionUser
        ? [
            {
              id: gitActionThreadEntryId,
              threadId,
              parentEntryId: existingAssistantThreadEntryId,
              kind: "message" as const,
              messageId: gitActionMessageId,
              turnId: null,
              createdAt: gitActionUserCreatedAt,
            },
          ]
        : []),
    ],
    proposedPlans: [],
    activities: [],
    session: null,
  };
}

function gitActionRuntimeSessionTree(input?: {
  readonly clientMessageId?: MessageId;
  readonly userThreadEntryId?: ThreadEntryId;
}): SessionTreeProjection {
  const userThreadEntryId =
    input?.userThreadEntryId ?? ThreadEntryId.make("thread-entry:runtime-git-action-user");
  return {
    threadId,
    runtimeSessionId,
    leafEntryId: gitActionAssistantRuntimeItemId,
    entries: [
      {
        id: gitActionUserRuntimeItemId,
        threadEntryId: userThreadEntryId,
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "user",
        ...(input?.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
        text: gitActionPrompt,
        createdAt: gitActionUserCreatedAt,
        rawEntry: {},
      },
      {
        id: gitActionAssistantRuntimeItemId,
        threadEntryId: gitActionAssistantThreadEntryId,
        parentId: gitActionUserRuntimeItemId,
        parentThreadEntryId: userThreadEntryId,
        kind: "message",
        role: "assistant",
        turnId: gitActionTurnId,
        text: "Committed and pushed.",
        createdAt: gitActionAssistantCreatedAt,
        rawEntry: {},
      },
    ],
    nodes: [
      {
        entryId: gitActionUserRuntimeItemId,
        threadEntryId: userThreadEntryId,
        parentEntryId: null,
        depth: 0,
        isActivePath: true,
        isActiveLeaf: false,
        childCount: 1,
      },
      {
        entryId: gitActionAssistantRuntimeItemId,
        threadEntryId: gitActionAssistantThreadEntryId,
        parentEntryId: gitActionUserRuntimeItemId,
        depth: 1,
        isActivePath: true,
        isActiveLeaf: true,
        childCount: 0,
      },
    ],
  };
}

function textEchoRuntimeSessionTree(): SessionTreeProjection {
  const runtimeThreadEntryId = runtimeSessionThreadEntryId(textEchoUserRuntimeItemId);
  return {
    threadId,
    runtimeSessionId,
    leafEntryId: textEchoUserRuntimeItemId,
    entries: [
      {
        id: textEchoUserRuntimeItemId,
        threadEntryId: runtimeThreadEntryId,
        parentId: null,
        parentThreadEntryId: null,
        kind: "message",
        role: "user",
        text: "hello!",
        createdAt: gitActionUserCreatedAt,
        rawEntry: {},
      },
    ],
    nodes: [
      {
        entryId: textEchoUserRuntimeItemId,
        threadEntryId: runtimeThreadEntryId,
        parentEntryId: null,
        depth: 0,
        isActivePath: true,
        isActiveLeaf: true,
        childCount: 0,
      },
    ],
  };
}

describe("Pi runtime thread sync", () => {
  beforeEach(() => {
    useStore.setState(initialState);
    useSubagentActivityStore.getState().reset();
    useSubagentTrayStore.getState().closeTray();
  });

  it("projects Pi session trees into normalized thread state", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);

    const { environmentState, thread } = currentThread();
    expect(environmentState.bootstrapComplete).toBe(true);
    expect(thread.title).toBe("Pi runtime thread");
    expect(thread.session?.status).toBe("ready");
    expect(thread.session?.orchestrationStatus).toBe("ready");
    expect(thread.leafId).toBe(assistantRuntimeThreadEntryId);
    expect(thread.entries.map((entry) => [entry.id, entry.parentEntryId])).toEqual([
      [userClientThreadEntryId, null],
      [assistantRuntimeThreadEntryId, userClientThreadEntryId],
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
          summary: "Started command",
          payload: expect.objectContaining({
            itemId: seededToolCallId,
            itemType: "command_execution",
            title: "command",
            data: expect.objectContaining({ command: "pwd" }),
          }),
          turnId,
        }),
        expect.objectContaining({
          kind: "tool.completed",
          summary: "Ran command",
          payload: expect.objectContaining({
            itemId: seededToolCallId,
            itemType: "command_execution",
            title: "command",
            detail: "/Users/workgyver/Developer/honk",
          }),
          turnId,
        }),
      ]),
    );
    expect(environmentState.sidebarThreadSummaryById[threadId]?.title).toBe("Pi runtime thread");
  });

  it("adopts the server's parent when a message-sent echo lands on a projected entry", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);

    const assistantMessageId = runtimeSessionEntryMessageId(runtimeSessionId, assistantEntryId);
    const serverParentEntryId = ThreadEntryId.make("thread-entry:server-resolved-parent");
    useStore.getState().applyOrchestrationEvent(
      {
        sequence: 7,
        eventId: EventId.make("event:assistant-echo"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: messageUpdatedAt,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "thread.message-sent",
        payload: {
          threadId,
          messageId: assistantMessageId,
          entryId: assistantRuntimeThreadEntryId,
          parentEntryId: serverParentEntryId,
          role: "assistant",
          text: "Seeded answer",
          attachments: [],
          turnId,
          streaming: false,
          createdAt: assistantMessageCreatedAt,
          updatedAt: messageUpdatedAt,
        },
      },
      environmentId,
    );

    const { thread } = currentThread();
    const assistantEntry = thread.entries.find(
      (entry) => entry.id === assistantRuntimeThreadEntryId,
    );
    expect(assistantEntry?.parentEntryId).toBe(serverParentEntryId);
  });

  it("merges runtime session projections into existing thread history", () => {
    useStore
      .getState()
      .syncServerThreadDetail(serverThreadDetailWithExistingTranscript(), environmentId);

    useStore
      .getState()
      .applyRuntimeSessionTreeProjection(gitActionRuntimeSessionTree(), environmentId);

    const { thread } = currentThread();
    expect(thread.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "hello!"],
      ["assistant", "Hello. How can I help?"],
      ["user", gitActionPrompt],
      ["assistant", "Committed and pushed."],
    ]);
    expect(thread.entries.map((entry) => [entry.id, entry.parentEntryId])).toEqual([
      [existingUserThreadEntryId, null],
      [existingAssistantThreadEntryId, existingUserThreadEntryId],
      [gitActionUserRuntimeThreadEntryId, existingAssistantThreadEntryId],
      [gitActionAssistantRuntimeThreadEntryId, gitActionUserRuntimeThreadEntryId],
    ]);
    expect(thread.leafId).toBe(gitActionAssistantRuntimeThreadEntryId);
  });

  it("keeps runtime-projected branches when stale server detail lags ingestion", () => {
    useStore
      .getState()
      .syncServerThreadDetail(serverThreadDetailWithExistingTranscript(), environmentId);
    useStore
      .getState()
      .applyRuntimeSessionTreeProjection(gitActionRuntimeSessionTree(), environmentId);

    useStore
      .getState()
      .syncServerThreadDetail(serverThreadDetailWithExistingTranscript(), environmentId);

    const { thread } = currentThread();
    expect(thread.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "hello!"],
      ["assistant", "Hello. How can I help?"],
      ["user", gitActionPrompt],
      ["assistant", "Committed and pushed."],
    ]);
    expect(thread.entries.map((entry) => [entry.id, entry.parentEntryId])).toEqual([
      [existingUserThreadEntryId, null],
      [existingAssistantThreadEntryId, existingUserThreadEntryId],
      [gitActionUserRuntimeThreadEntryId, existingAssistantThreadEntryId],
      [gitActionAssistantRuntimeThreadEntryId, gitActionUserRuntimeThreadEntryId],
    ]);
    expect(thread.leafId).toBe(gitActionAssistantRuntimeThreadEntryId);
  });

  it("moves an interrupted runtime turn leaf back to the interrupted user's parent", () => {
    useStore
      .getState()
      .syncServerThreadDetail(serverThreadDetailWithExistingTranscript(), environmentId);
    const interruptedMessageId = MessageId.make("message:interrupted-runtime-user");
    const interruptedEntryId = threadEntryIdForMessageId(interruptedMessageId);
    applyLocalThreadTurnStartRequested({
      environmentId,
      threadId,
      message: {
        messageId: interruptedMessageId,
        text: "cancel me",
        attachments: [],
      },
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.5",
      },
      titleSeed: "cancel me",
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_INTERACTION_MODE,
      createdAt: gitActionUserCreatedAt,
    });
    expect(currentThread().thread.leafId).toBe(interruptedEntryId);

    useStore.getState().applyAgentRuntimeEvent(
      {
        ...turnStartedEvent,
        id: EventId.make("runtime-event:turn.started-interrupted"),
        turnId: gitActionTurnId,
      },
      environmentId,
    );
    useStore.getState().applyAgentRuntimeEvent(
      {
        ...turnInterruptedEvent,
        id: EventId.make("runtime-event:turn.interrupted-interrupted"),
        turnId: gitActionTurnId,
      },
      environmentId,
    );

    const { thread } = currentThread();
    expect(thread.entries.find((entry) => entry.id === interruptedEntryId)?.turnId).toBe(
      gitActionTurnId,
    );
    expect(thread.latestTurn?.state).toBe("interrupted");
    expect(thread.leafId).toBe(existingAssistantThreadEntryId);
  });

  it("does not duplicate an optimistic runtime user message with the same client message id", () => {
    useStore
      .getState()
      .syncServerThreadDetail(
        serverThreadDetailWithExistingTranscript({ includeGitActionUser: true }),
        environmentId,
      );

    useStore.getState().applyRuntimeSessionTreeProjection(
      gitActionRuntimeSessionTree({
        clientMessageId: gitActionMessageId,
        userThreadEntryId: gitActionThreadEntryId,
      }),
      environmentId,
    );

    const { thread } = currentThread();
    const actionUserMessages = thread.messages.filter(
      (message) => message.id === gitActionMessageId,
    );
    const actionUserEntries = thread.entries.filter((entry) => entry.id === gitActionThreadEntryId);
    expect(actionUserMessages).toHaveLength(1);
    expect(actionUserEntries).toHaveLength(1);
    expect(actionUserEntries[0]?.parentEntryId).toBe(existingAssistantThreadEntryId);
    expect(thread.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "hello!"],
      ["assistant", "Hello. How can I help?"],
      ["user", gitActionPrompt],
      ["assistant", "Committed and pushed."],
    ]);
  });

  it("aliases a reloaded git action runtime user echo when the client message id is missing", () => {
    useStore
      .getState()
      .syncServerThreadDetail(
        serverThreadDetailWithExistingTranscript({ includeGitActionUser: true }),
        environmentId,
      );

    useStore
      .getState()
      .applyRuntimeSessionTreeProjection(gitActionRuntimeSessionTree(), environmentId);

    const { thread } = currentThread();
    const actionUserMessages = thread.messages.filter(
      (message) => message.text === gitActionPrompt && message.role === "user",
    );
    const actionUserEntries = thread.entries.filter((entry) => entry.id === gitActionThreadEntryId);
    expect(actionUserMessages).toHaveLength(1);
    expect(actionUserMessages[0]?.id).toBe(gitActionMessageId);
    expect(actionUserEntries).toHaveLength(1);
    expect(actionUserEntries[0]?.parentEntryId).toBe(existingAssistantThreadEntryId);
    expect(thread.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "hello!"],
      ["assistant", "Hello. How can I help?"],
      ["user", gitActionPrompt],
      ["assistant", "Committed and pushed."],
    ]);
    expect(thread.entries.map((entry) => [entry.id, entry.parentEntryId])).toEqual([
      [existingUserThreadEntryId, null],
      [existingAssistantThreadEntryId, existingUserThreadEntryId],
      [gitActionThreadEntryId, existingAssistantThreadEntryId],
      [gitActionAssistantRuntimeThreadEntryId, gitActionThreadEntryId],
    ]);
  });

  it("aliases a unique text runtime user echo without moving the committed leaf backwards", () => {
    useStore
      .getState()
      .syncServerThreadDetail(serverThreadDetailWithExistingTranscript(), environmentId);

    useStore
      .getState()
      .applyRuntimeSessionTreeProjection(textEchoRuntimeSessionTree(), environmentId);

    const { thread } = currentThread();
    const helloMessages = thread.messages.filter(
      (message) => message.role === "user" && message.text === "hello!",
    );
    expect(helloMessages).toHaveLength(1);
    expect(helloMessages[0]?.id).toBe(existingUserMessageId);
    expect(helloMessages[0]?.createdAt).toBe(userMessageCreatedAt);
    expect(
      thread.entries.find((entry) => entry.id === existingUserThreadEntryId)?.parentEntryId,
    ).toBe(null);
    expect(thread.leafId).toBe(existingAssistantThreadEntryId);
    expect(thread.messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "hello!"],
      ["assistant", "Hello. How can I help?"],
    ]);
  });

  it("keeps git action branch paths acyclic across repeated runtime projections", () => {
    useStore
      .getState()
      .syncServerThreadDetail(
        serverThreadDetailWithExistingTranscript({ includeGitActionUser: true }),
        environmentId,
      );

    const runtimeTree = gitActionRuntimeSessionTree({
      clientMessageId: gitActionMessageId,
      userThreadEntryId: gitActionThreadEntryId,
    });
    useStore.getState().applyRuntimeSessionTreeProjection(runtimeTree, environmentId);
    useStore.getState().applyRuntimeSessionTreeProjection(runtimeTree, environmentId);

    const { thread } = currentThread();
    expect(thread.leafId).toBe(gitActionAssistantRuntimeThreadEntryId);
    expect(
      resolveThreadEntryPath({
        entries: thread.entries,
        entryId: gitActionAssistantRuntimeThreadEntryId,
      }).ok,
    ).toBe(true);
    expect(thread.entries.find((entry) => entry.id === gitActionThreadEntryId)?.parentEntryId).toBe(
      existingAssistantThreadEntryId,
    );
    expect(
      thread.entries.find((entry) => entry.id === gitActionAssistantRuntimeThreadEntryId)
        ?.parentEntryId,
    ).toBe(gitActionThreadEntryId);
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
    expect(thread.messages).not.toEqual(
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
        expect.objectContaining({
          kind: "extension-ui.requested",
          summary: "Waiting for Run tool?",
          turnId,
        }),
      ]),
    );
    expect(thread.activities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "task.progress", turnId }),
        expect.objectContaining({
          kind: "tool.started",
          payload: expect.objectContaining({
            itemId: "tool-call-1",
          }),
          turnId,
        }),
      ]),
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

    const activityIdsBeforeQueueEvent =
      currentThread().environmentState.activityIdsByThreadId[threadId];
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

  it("keeps the Pi run active between turn_end and agent_end", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);
    useStore.getState().applyAgentRuntimeEvent(turnStartedEvent, environmentId);
    useStore.getState().applyAgentRuntimeEvent(turnCompletedEvent, environmentId);

    let { thread } = currentThread();
    expect(thread.session?.status).toBe("running");
    expect(thread.session?.orchestrationStatus).toBe("running");
    expect(thread.session?.activeTurnId).toBeUndefined();
    expect(thread.latestTurn?.state).toBe("completed");
    expect(thread.latestTurn?.completedAt).toBe(turnCompletedAt);

    useStore.getState().applyAgentRuntimeEvent(agentCompletedEvent, environmentId);
    thread = currentThread().thread;
    expect(thread.session?.status).toBe("ready");
    expect(thread.session?.orchestrationStatus).toBe("ready");
    expect(thread.session?.activeTurnId).toBeUndefined();
  });

  it("applies live context window usage events as thread activities", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);

    const snapshot = {
      usedTokens: 60_000,
      maxTokens: 200_000,
      categories: [
        { id: "system_prompt", label: "System prompt", tokens: 850 },
        { id: "conversation", label: "Conversation", tokens: 59_150 },
      ],
      compactsAutomatically: true,
    };
    const contextWindowEvent = {
      id: EventId.make("runtime-event:context-window"),
      type: "context-window.updated",
      agentRuntime: "pi",
      threadId,
      runtimeSessionId,
      turnId,
      createdAt: "2026-06-01T12:00:30.000Z",
      summary: "Context usage updated",
      data: snapshot,
    } satisfies AgentRuntimeEvent;

    useStore.getState().applyAgentRuntimeEvent(contextWindowEvent, environmentId);

    const liveActivity = currentThread().thread.activities.find(
      (activity) => activity.kind === "context-window.updated",
    );
    expect(liveActivity).toMatchObject({
      id: "runtime-activity:runtime-event:context-window",
      kind: "context-window.updated",
      payload: snapshot,
      turnId,
    });

    const updatedSnapshot = { ...snapshot, usedTokens: 61_000 };
    useStore.getState().applyAgentRuntimeEvent(
      {
        ...contextWindowEvent,
        id: EventId.make("runtime-event:context-window-later"),
        createdAt: "2026-06-01T12:00:31.000Z",
        data: updatedSnapshot,
      },
      environmentId,
    );
    const replaced = currentThread().thread.activities.filter(
      (activity) => activity.kind === "context-window.updated",
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.payload).toMatchObject({ usedTokens: 61_000 });

    const malformedEvent = {
      ...contextWindowEvent,
      id: EventId.make("runtime-event:context-window-bad"),
      data: { usedTokens: -5 },
    } satisfies AgentRuntimeEvent;
    useStore.getState().applyAgentRuntimeEvent(malformedEvent, environmentId);
    expect(
      currentThread().thread.activities.filter(
        (activity) => activity.kind === "context-window.updated",
      ),
    ).toHaveLength(1);
  });

  it("compacts live subagent item payloads before projection", () => {
    const event: AgentRuntimeEvent = {
      id: EventId.make("runtime-event:subagent-tool-with-item"),
      agentRuntime: "pi",
      threadId,
      runtimeSessionId,
      turnId,
      type: "tool.completed",
      summary: "Completed subagent",
      createdAt: subagentUpdatedAt,
      data: {
        toolName: "subagent",
        toolCallId: "tool-call-subagent",
        isError: false,
        result: {
          details: {
            activities: [
              {
                id: "runtime-subagent:thread",
                kind: "subagent.thread.started",
                summary: "Started Review",
                createdAt: subagentUpdatedAt,
                sequence: 1,
                payload: {
                  subagentThreadId,
                  parentThreadId: threadId,
                  parentItemId: "tool-call-subagent",
                  agentId: "agent:review",
                  nickname: "Review renderer",
                  role: "reviewer",
                  model: "gpt-5.5",
                  prompt: "Review the renderer",
                },
              },
              {
                id: "runtime-subagent:item",
                kind: "subagent.item.completed",
                summary: "Completed read",
                createdAt: subagentUpdatedAt,
                sequence: 2,
                payload: {
                  subagentThreadId,
                  parentThreadId: threadId,
                  parentItemId: "tool-call-subagent",
                  agentId: "agent:review",
                  nickname: "Review renderer",
                  role: "reviewer",
                  model: "gpt-5.5",
                  prompt: "Review the renderer",
                  itemType: "file_read",
                  itemId: "item:read",
                  status: "completed",
                  title: "Read",
                  data: {
                    type: "tool_execution_end",
                    toolCallId: "toolu-read",
                    toolName: "read",
                    result: {
                      content: [{ type: "text", text: "visible output" }],
                      details: {
                        truncation: {
                          content: "visible output",
                          totalBytes: 100,
                          outputBytes: 14,
                          truncated: true,
                        },
                      },
                    },
                    isError: false,
                  },
                },
              },
            ],
          },
        },
      },
    };

    const activities = runtimeSubagentActivitiesForToolEvent(event);
    const threadActivity = activities.find(
      (activity) => activity.kind === "subagent.thread.started",
    );
    const itemActivity = activities.find((activity) => activity.kind === "subagent.item.completed");
    const itemPayload = itemActivity?.payload as Record<string, unknown> | undefined;
    const itemData = itemPayload?.data as Record<string, unknown> | undefined;
    const itemResult = itemData?.result as Record<string, unknown> | undefined;
    const itemDetails = itemResult?.details as Record<string, unknown> | undefined;
    const itemTruncation = itemDetails?.truncation as Record<string, unknown> | undefined;

    expect(threadActivity?.payload).toMatchObject({ prompt: "Review the renderer" });
    expect(itemPayload?.prompt).toBeUndefined();
    expect(itemResult?.content).toEqual([{ type: "text", text: "visible output" }]);
    expect(itemTruncation).toEqual({
      totalBytes: 100,
      outputBytes: 14,
      truncated: true,
    });
  });

  it("routes live subagent tool activity outside the main thread store", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);
    const previousState = useStore.getState();
    const previousThread = currentThread().thread;
    let storeUpdateCount = 0;
    const unsubscribe = useStore.subscribe(() => {
      storeUpdateCount += 1;
    });

    useStore
      .getState()
      .applyAgentRuntimeEvent(subagentToolUpdatedEvent("child says hi"), environmentId);
    unsubscribe();

    expect(useStore.getState()).toBe(previousState);
    expect(currentThread().thread).toBe(previousThread);
    expect(storeUpdateCount).toBe(0);
    const projection = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    const subagent = projection.subagentById[subagentThreadId];
    expect(subagent).toMatchObject({
      subagentThreadId,
      title: "Review renderer",
      isActive: true,
    });
    expect(subagent?.transcriptItems).toBeUndefined();
  });

  it("projects subagent transcript only while the tray is open", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);
    useStore
      .getState()
      .applyAgentRuntimeEvent(subagentToolUpdatedEvent("child says hi"), environmentId);

    openSubagentTrayForTests();
    useSubagentActivityStore.getState().refreshProjection({ environmentId, threadId });

    const projection = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    expect(projection.subagentById[subagentThreadId]?.transcriptItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: "assistant:review",
          text: "child says hi",
          loading: true,
        }),
      ]),
    );
  });

  it("does not notify the main thread store during repeated subagent stream updates", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);
    openSubagentTrayForTests();
    const previousState = useStore.getState();
    let storeUpdateCount = 0;
    const unsubscribe = useStore.subscribe(() => {
      storeUpdateCount += 1;
    });

    for (let index = 0; index < 100; index += 1) {
      useStore
        .getState()
        .applyAgentRuntimeEvent(
          subagentToolUpdatedEvent(`child stream chunk ${index}`, subagentUpdatedAt),
          environmentId,
        );
    }
    unsubscribe();

    expect(useStore.getState()).toBe(previousState);
    expect(storeUpdateCount).toBe(0);
    const projection = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    expect(projection.activityIds).toHaveLength(2);
    expect(projection.subagentById[subagentThreadId]?.transcriptItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: "assistant:review",
          text: "child stream chunk 99",
        }),
      ]),
    );
  });

  it("does not notify the subagent projection store for duplicate stream snapshots", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);
    let mainStoreUpdateCount = 0;
    let subagentStoreUpdateCount = 0;
    const unsubscribeMainStore = useStore.subscribe(() => {
      mainStoreUpdateCount += 1;
    });
    const unsubscribeSubagentStore = useSubagentActivityStore.subscribe(() => {
      subagentStoreUpdateCount += 1;
    });

    useStore
      .getState()
      .applyAgentRuntimeEvent(subagentToolUpdatedEvent("duplicate child snapshot"), environmentId);
    useStore
      .getState()
      .applyAgentRuntimeEvent(subagentToolUpdatedEvent("duplicate child snapshot"), environmentId);
    unsubscribeMainStore();
    unsubscribeSubagentStore();

    expect(mainStoreUpdateCount).toBe(0);
    expect(subagentStoreUpdateCount).toBe(1);
  });

  it("keeps the active subagent projection stable while another thread streams", () => {
    useStore.getState().applyRuntimeSessionTreeProjection(sessionTreeProjection, environmentId);
    useStore
      .getState()
      .applyAgentRuntimeEvent(subagentToolUpdatedEvent("active child"), environmentId);
    const activeProjectionBefore = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    let mainStoreUpdateCount = 0;
    const unsubscribeMainStore = useStore.subscribe(() => {
      mainStoreUpdateCount += 1;
    });

    useStore
      .getState()
      .applyAgentRuntimeEvent(otherThreadSubagentToolUpdatedEvent("other child"), environmentId);
    unsubscribeMainStore();

    const activeProjectionAfter = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    const otherProjection = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId: otherThreadId,
    });
    expect(mainStoreUpdateCount).toBe(0);
    expect(activeProjectionAfter).toBe(activeProjectionBefore);
    expect(otherProjection.subagentById[otherSubagentThreadId]?.transcriptItems).toBeUndefined();
  });

  it("preserves unchanged transcript row objects when one subagent item streams", () => {
    openSubagentTrayForTests();
    const store = useSubagentActivityStore.getState();
    store.upsertActivities(
      { environmentId, threadId },
      subagentProjectionActivities("streaming child part 1"),
    );
    const projectionBefore = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    const itemsBefore = projectionBefore.subagentById[subagentThreadId]?.transcriptItems ?? [];
    const stableItemBefore = itemsBefore.find((item) => item.itemId === "assistant:stable");
    const streamingItemBefore = itemsBefore.find((item) => item.itemId === "assistant:streaming");

    store.upsertActivities(
      { environmentId, threadId },
      subagentProjectionActivities("streaming child part 2"),
    );

    const projectionAfter = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    const itemsAfter = projectionAfter.subagentById[subagentThreadId]?.transcriptItems ?? [];
    const stableItemAfter = itemsAfter.find((item) => item.itemId === "assistant:stable");
    const streamingItemAfter = itemsAfter.find((item) => item.itemId === "assistant:streaming");
    expect(stableItemAfter).toBe(stableItemBefore);
    expect(streamingItemAfter).not.toBe(streamingItemBefore);
    expect(streamingItemAfter?.text).toBe("streaming child part 2");
  });

  it("preserves sibling subagent objects when one subagent item streams", () => {
    openSubagentTrayForTests();
    const store = useSubagentActivityStore.getState();
    store.upsertActivities({ environmentId, threadId }, [
      ...subagentProjectionActivities("streaming child part 1"),
      ...siblingSubagentProjectionActivities(),
    ]);
    const projectionBefore = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    const activeSubagentBefore = projectionBefore.subagentById[subagentThreadId];
    const siblingSubagentBefore = projectionBefore.subagentById[siblingSubagentThreadId];

    store.upsertActivities(
      { environmentId, threadId },
      subagentProjectionActivities("streaming child part 2"),
    );

    const projectionAfter = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    expect(projectionAfter.subagentById[subagentThreadId]).not.toBe(activeSubagentBefore);
    expect(projectionAfter.subagentById[siblingSubagentThreadId]).toBe(siblingSubagentBefore);
  });

  it("preserves sibling subagent objects during content delta streams", () => {
    openSubagentTrayForTests();
    const store = useSubagentActivityStore.getState();
    store.upsertActivities({ environmentId, threadId }, [
      subagentProjectionActivities("seed child item")[0]!,
      subagentContentDeltaActivity({ id: "1", delta: "first", sequence: 2 }),
      ...siblingSubagentProjectionActivities(),
    ]);
    const projectionBefore = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    const siblingSubagentBefore = projectionBefore.subagentById[siblingSubagentThreadId];

    store.upsertActivities({ environmentId, threadId }, [
      subagentContentDeltaActivity({ id: "2", delta: " second", sequence: 3 }),
    ]);

    const projectionAfter = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    const deltaItem = projectionAfter.subagentById[subagentThreadId]?.transcriptItems?.find(
      (item) => item.itemId === "assistant:delta",
    );
    expect(deltaItem?.text).toBe("first second");
    expect(projectionAfter.subagentById[siblingSubagentThreadId]).toBe(siblingSubagentBefore);
  });

  it("routes server subagent detail snapshots outside the main thread store", () => {
    openSubagentTrayForTests();
    useStore
      .getState()
      .syncServerThreadDetail(
        serverThreadDetailWithSubagent("server child says hi", subagentSnapshotUpdatedAt),
        environmentId,
      );
    const previousState = useStore.getState();
    const previousThread = currentThread().thread;
    let storeUpdateCount = 0;
    const unsubscribe = useStore.subscribe(() => {
      storeUpdateCount += 1;
    });

    useStore
      .getState()
      .syncServerThreadDetail(
        serverThreadDetailWithSubagent(
          "server child says hi again",
          subagentSnapshotUpdatedAgainAt,
        ),
        environmentId,
      );
    unsubscribe();

    expect(useStore.getState()).toBe(previousState);
    expect(currentThread().thread).toBe(previousThread);
    expect(storeUpdateCount).toBe(0);
    const projection = selectSubagentProjection(useSubagentActivityStore.getState(), {
      environmentId,
      threadId,
    });
    expect(projection.subagentById[subagentThreadId]?.transcriptItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: "assistant:review",
          text: "server child says hi again",
        }),
      ]),
    );
  });
});
