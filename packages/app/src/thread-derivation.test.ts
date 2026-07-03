import { EnvironmentId } from "@honk/shared/environment";
import { MessageId } from "@honk/contracts";
import { ProjectId, ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import { initialEnvironmentState, type EnvironmentState } from "./stores/thread-store";
import { getThreadFromEnvironmentState } from "./thread-derivation";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type ChatMessage } from "./types";

const environmentId = EnvironmentId.make("environment:thread-derivation");
const threadId = ThreadId.make("thread:thread-derivation");
const projectId = ProjectId.make("project:thread-derivation");
const messageId = MessageId.make("message:thread-derivation");
const createdAt = "2026-06-06T00:00:00.000Z";

function environmentState(): EnvironmentState {
  const message: ChatMessage = {
    id: messageId,
    role: "user",
    text: "please reply ok",
    createdAt,
    streaming: false,
  };
  return {
    ...initialEnvironmentState,
    threadIds: [threadId],
    threadShellById: {
      [threadId]: {
        id: threadId,
        environmentId,
        codexThreadId: null,
        projectId,
        title: "Thread derivation",
        modelSelection: {
          instanceId: "codex",
          model: "gpt-5.5",
        },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        error: null,
        createdAt,
        archivedAt: null,
        branch: null,
        worktreePath: null,
      },
    },
    messageIdsByThreadId: {
      [threadId]: [messageId],
    },
    messageByThreadId: {
      [threadId]: {
        [messageId]: message,
      },
    },
  };
}

describe("getThreadFromEnvironmentState", () => {
  it("reuses the derived thread when unrelated environment state changes", () => {
    const firstState = environmentState();
    const firstThread = getThreadFromEnvironmentState(firstState, threadId);
    const nextState = {
      ...firstState,
      projectIds: [],
      snapshotSource: "server" as const,
    };
    const nextThread = getThreadFromEnvironmentState(nextState, threadId);

    expect(nextThread).toBe(firstThread);
  });
});
