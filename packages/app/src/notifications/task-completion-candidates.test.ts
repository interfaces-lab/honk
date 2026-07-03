import { DEFAULT_TEXT_GENERATION_MODEL_SELECTION } from "@honk/shared/server-settings";
import { EnvironmentId } from "@honk/shared/environment";
import {
  MessageId,
  ThreadEntryId,
  TurnId,
} from "@honk/contracts";
import { ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Thread,
  type ThreadSession,
} from "../types";
import { collectCompletedThreadCandidates } from "./task-completion-candidates";

const environmentId = EnvironmentId.make("environment:task-completion-candidates");
const threadId = ThreadId.make("thread:task-completion-candidates");
const turnId = TurnId.make("turn:task-completion-candidates");
const assistantMessageId = MessageId.make("message:task-completion-assistant");
const assistantEntryId = ThreadEntryId.make("entry:task-completion-assistant");
const createdAt = "2026-06-01T12:00:00.000Z";
const startedAt = "2026-06-01T12:00:01.000Z";
const completedAt = "2026-06-01T12:00:02.000Z";

function threadSession(input: {
  status: ThreadSession["status"];
  orchestrationStatus: ThreadSession["orchestrationStatus"];
  activeTurnId?: TurnId | undefined;
}): ThreadSession {
  return {
    status: input.status,
    orchestrationStatus: input.orchestrationStatus,
    ...(input.activeTurnId ? { activeTurnId: input.activeTurnId } : {}),
    createdAt,
    updatedAt: completedAt,
  };
}

function thread(overrides: Pick<Thread, "latestTurn" | "session">): Thread {
  return {
    id: threadId,
    environmentId,
    codexThreadId: null,
    projectId: null,
    title: "Release thread",
    modelSelection: DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: overrides.session,
    messages: [
      {
        id: assistantMessageId,
        role: "assistant",
        text: "Still running the release workflow.",
        turnId,
        createdAt: completedAt,
        completedAt,
        streaming: false,
      },
    ],
    leafId: assistantEntryId,
    entries: [
      {
        id: assistantEntryId,
        threadId,
        parentEntryId: null,
        kind: "message",
        messageId: assistantMessageId,
        turnId,
        createdAt: completedAt,
      },
    ],
    proposedPlans: [],
    error: null,
    createdAt,
    archivedAt: null,
    updatedAt: completedAt,
    latestTurn: overrides.latestTurn,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

describe("collectCompletedThreadCandidates", () => {
  it("waits for the orchestration session to settle before notifying completion", () => {
    const running = thread({
      session: threadSession({
        status: "running",
        orchestrationStatus: "running",
        activeTurnId: turnId,
      }),
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: createdAt,
        startedAt,
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const completedButSessionRunning = thread({
      session: threadSession({
        status: "running",
        orchestrationStatus: "running",
      }),
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: createdAt,
        startedAt,
        completedAt,
        assistantMessageId,
      },
    });
    const settled = thread({
      session: threadSession({
        status: "ready",
        orchestrationStatus: "ready",
      }),
      latestTurn: completedButSessionRunning.latestTurn,
    });

    expect(collectCompletedThreadCandidates([running], [completedButSessionRunning])).toEqual([]);
    expect(collectCompletedThreadCandidates([completedButSessionRunning], [settled])).toEqual([
      {
        threadId,
        projectId: null,
        environmentId,
        title: "Release thread",
        completedAt,
        assistantSummary: "Still running the release workflow.",
      },
    ]);
  });
});
