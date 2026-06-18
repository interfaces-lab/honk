import { EnvironmentId, ThreadId } from "@honk/contracts";
import { describe, expect, it, vi } from "vitest";

import { DraftId } from "../../../stores/chat-drafts";
import {
  deriveChatViewLiveness,
  missingActiveThreadMessage,
  reportMissingActiveThread,
} from "./chat-view.logic";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "../../../types";

const environmentId = EnvironmentId.make("environment:chat-view-logic");
const threadId = ThreadId.make("thread:chat-view-logic");

function thread(): Thread {
  return {
    id: threadId,
    environmentId,
    codexThreadId: null,
    projectId: null,
    title: "Thread",
    modelSelection: {
      instanceId: "codex",
      model: "gpt-5.5",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    leafId: null,
    entries: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-06-06T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

describe("reportMissingActiveThread", () => {
  it("returns true when the active thread is present", () => {
    expect(
      reportMissingActiveThread(thread(), {
        routeKind: "server",
        environmentId,
        threadId,
        draftId: null,
        serverThreadExists: true,
      }),
    ).toBe(true);
  });

  it("logs diagnostics instead of throwing when the active thread is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      reportMissingActiveThread(undefined, {
        routeKind: "server",
        environmentId,
        threadId,
        draftId: DraftId.make("draft:chat-view-logic"),
        serverThreadExists: false,
      }),
    ).toBe(false);

    expect(warn).toHaveBeenCalledWith(
      missingActiveThreadMessage({
        routeKind: "server",
        environmentId,
        threadId,
        draftId: DraftId.make("draft:chat-view-logic"),
        serverThreadExists: false,
      }),
      {
        routeKind: "server",
        environmentId,
        threadId,
        draftId: DraftId.make("draft:chat-view-logic"),
        serverThreadExists: false,
      },
    );
  });
});

describe("deriveChatViewLiveness", () => {
  it("does not show runtime waiting state after the latest turn is settled", () => {
    expect(
      deriveChatViewLiveness({
        runtimeOwned: true,
        latestTurnSettled: true,
        activeRunningTurnId: null,
        runtimeAgentRunActive: false,
        runtimeTimelineHasActiveWork: false,
        runtimePresentationActive: true,
        visibleSendIntentCount: 0,
        isCompactingActive: false,
        isSendBusy: false,
        isConnecting: false,
      }),
    ).toMatchObject({
      isWorking: false,
      timelineTurnActive: false,
      goalStatusProgressActive: false,
    });
  });
});
