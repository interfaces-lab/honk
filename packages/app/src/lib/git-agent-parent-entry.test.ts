import {
  EnvironmentId,
  MessageId,
  ProjectId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  threadEntryIdForMessageId,
} from "@multi/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "~/types";
import { GIT_AGENT_ACTIONS } from "./git-agent-actions";
import { buildThreadTurnStartCommand } from "./turn-send-coordinator";
import { resolveGitAgentParentEntryId } from "./git-agent-parent-entry";

const environmentId = EnvironmentId.make("environment:git-agent-parent");
const projectId = ProjectId.make("project:git-agent-parent");
const threadId = ThreadId.make("thread:git-agent-parent");
const runtimeSessionId = RuntimeSessionId.make("019ea90a-5f4f-7a22-8067-ef9980854afd");
const runtimeAssistantItemId = RuntimeItemId.make("56aa747e");

const userMessageId = MessageId.make("11111111-1111-4111-8111-111111111111");
const assistantMessageId = MessageId.make("22222222-2222-4222-8222-222222222222");
const runtimeAssistantMessageId = MessageId.make(`${runtimeSessionId}:${runtimeAssistantItemId}`);

const userThreadEntryId = threadEntryIdForMessageId(userMessageId);
const assistantThreadEntryId = threadEntryIdForMessageId(assistantMessageId);
const runtimeAssistantThreadEntryId = threadEntryIdForMessageId(runtimeAssistantMessageId);

function threadWithEntries(): Thread {
  return {
    id: threadId,
    environmentId,
    codexThreadId: null,
    projectId,
    title: "Git parent entry thread",
    modelSelection: {
      instanceId: "codex",
      model: "gpt-5.5",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [
      {
        id: userMessageId,
        role: "user",
        text: "hi",
        createdAt: "2026-06-08T20:30:00.000Z",
        streaming: false,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        text: "Hello.",
        createdAt: "2026-06-08T20:30:01.000Z",
        streaming: false,
      },
      {
        id: runtimeAssistantMessageId,
        role: "assistant",
        text: "Hello.",
        createdAt: "2026-06-08T20:30:02.000Z",
        streaming: false,
      },
    ],
    leafId: runtimeAssistantThreadEntryId,
    entries: [
      {
        id: userThreadEntryId,
        threadId,
        parentEntryId: null,
        kind: "message",
        messageId: userMessageId,
        turnId: null,
        createdAt: "2026-06-08T20:30:00.000Z",
      },
      {
        id: assistantThreadEntryId,
        threadId,
        parentEntryId: userThreadEntryId,
        kind: "message",
        messageId: assistantMessageId,
        turnId: null,
        createdAt: "2026-06-08T20:30:01.000Z",
      },
      {
        id: runtimeAssistantThreadEntryId,
        threadId,
        parentEntryId: userThreadEntryId,
        kind: "message",
        messageId: runtimeAssistantMessageId,
        turnId: null,
        createdAt: "2026-06-08T20:30:02.000Z",
      },
    ],
    proposedPlans: [],
    error: null,
    createdAt: "2026-06-08T20:30:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

describe("resolveGitAgentParentEntryId", () => {
  it("rejects runtime projection message ids when choosing the git parent entry", () => {
    expect(resolveGitAgentParentEntryId(threadWithEntries())).toBe(assistantThreadEntryId);
  });

  it("uses the persisted branch leaf when it is orchestration-backed", () => {
    const thread = threadWithEntries();
    thread.leafId = assistantThreadEntryId;

    expect(resolveGitAgentParentEntryId(thread)).toBe(assistantThreadEntryId);
  });

  it("returns undefined when the thread is missing", () => {
    expect(resolveGitAgentParentEntryId(null)).toBeUndefined();
  });

  it("ignores runtime-only entries that are not canonical message entries", () => {
    const thread = threadWithEntries();
    thread.entries.push({
      id: ThreadEntryId.make("thread-entry:runtime-only"),
      threadId,
      parentEntryId: assistantThreadEntryId,
      kind: "message",
      messageId: runtimeAssistantMessageId,
      turnId: null,
      createdAt: "2026-06-08T20:30:03.000Z",
    });

    expect(resolveGitAgentParentEntryId(thread)).toBe(assistantThreadEntryId);
  });

  it("builds git action turn start with a persisted parent entry id", () => {
    const clientMessageId = MessageId.make("33333333-3333-4333-8333-333333333333");
    const parentEntryId = resolveGitAgentParentEntryId(threadWithEntries());

    const command = buildThreadTurnStartCommand({
      threadId,
      clientMessageId,
      createdAt: "2026-06-08T20:31:00.000Z",
      text: GIT_AGENT_ACTIONS.commitAndPush.prompt,
      attachments: [],
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.5",
      },
      titleSeed: GIT_AGENT_ACTIONS.commitAndPush.label,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_INTERACTION_MODE,
      parentEntryId: parentEntryId ?? null,
      sourceProposedPlan: null,
    });

    expect(command.type).toBe("thread.turn.start");
    if (command.type !== "thread.turn.start") {
      throw new Error("Expected thread.turn.start command.");
    }
    expect(command.parentEntryId).toBe(assistantThreadEntryId);
    expect(command.parentEntryId).not.toBe(runtimeAssistantThreadEntryId);
    expect(command.message.messageId).toBe(clientMessageId);
  });
});
