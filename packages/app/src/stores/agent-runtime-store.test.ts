import {
  AuthProviderId,
  EventId,
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type SessionTreeProjection,
} from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { DESKTOP_RUNTIME_ENVIRONMENT_ID } from "../lib/environment-scope";
import { createEmptyRuntimeHostSnapshot } from "../lib/multi-runtime-api";
import { getThreadFromEnvironmentState } from "../thread-derivation";
import { useAgentRuntimeStore } from "./agent-runtime-store";
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

function currentThread() {
  const environmentState = selectEnvironmentState(useStore.getState(), DESKTOP_RUNTIME_ENVIRONMENT_ID);
  const thread = getThreadFromEnvironmentState(environmentState, threadId);
  expect(thread).toBeDefined();
  return thread!;
}

describe("agent runtime store", () => {
  beforeEach(() => {
    useStore.setState(initialState);
    useAgentRuntimeStore.setState({ snapshot: createEmptyRuntimeHostSnapshot() });
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
});
