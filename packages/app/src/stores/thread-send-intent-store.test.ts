import { MessageId } from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { createThreadSendIntent, useThreadSendIntentStore } from "./thread-send-intent-store";

const createdAt = "2026-06-05T18:30:00.000Z";

describe("thread send intent store", () => {
  beforeEach(() => {
    useThreadSendIntentStore.getState().resetForTests();
  });

  it("copies send intents to a promoted thread key without removing the draft intent", () => {
    const draftThreadKey = "draft:thread";
    const promotedThreadKey = "environment:local:thread:server";
    const messageId = MessageId.make("message:first-send");
    const intent = createThreadSendIntent({
      messageId,
      text: "fix the chat",
      createdAt,
      parentEntryId: null,
    });

    const store = useThreadSendIntentStore.getState();
    store.appendSendIntent(draftThreadKey, intent);
    store.copySendIntents(draftThreadKey, promotedThreadKey, new Set([messageId]));
    store.copySendIntents(draftThreadKey, promotedThreadKey, new Set([messageId]));

    expect(useThreadSendIntentStore.getState().sendIntentsByThreadKey[draftThreadKey]).toEqual([
      intent,
    ]);
    expect(
      useThreadSendIntentStore.getState().sendIntentsByThreadKey[promotedThreadKey],
    ).toEqual([intent]);
  });

  it("copies local dispatch to a promoted thread key", () => {
    const draftThreadKey = "draft:thread";
    const promotedThreadKey = "environment:local:thread:server";
    const dispatch = {
      startedAt: createdAt,
      preparingWorktree: false,
      latestTurnTurnId: null,
      latestTurnRequestedAt: null,
      latestTurnStartedAt: null,
      latestTurnCompletedAt: null,
      sessionOrchestrationStatus: null,
      sessionUpdatedAt: null,
    };

    const store = useThreadSendIntentStore.getState();
    store.setLocalDispatch(draftThreadKey, dispatch);
    store.copyLocalDispatch(draftThreadKey, promotedThreadKey);

    expect(useThreadSendIntentStore.getState().localDispatchByThreadKey).toEqual({
      [draftThreadKey]: dispatch,
      [promotedThreadKey]: dispatch,
    });
  });
});
