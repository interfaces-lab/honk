import { MessageId } from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { createPendingTimelineRow } from "../components/chat/view/pending-timeline-rows";
import { usePendingThreadSendStore } from "./pending-thread-send-store";

const createdAt = "2026-06-05T18:30:00.000Z";

describe("pending thread send store", () => {
  beforeEach(() => {
    usePendingThreadSendStore.getState().resetForTests();
  });

  it("copies optimistic rows to a promoted thread key without removing the draft row", () => {
    const draftThreadKey = "draft:thread";
    const promotedThreadKey = "environment:local:thread:server";
    const messageId = MessageId.make("message:first-send");
    const row = createPendingTimelineRow({
      messageId,
      text: "fix the chat",
      createdAt,
      parentEntryId: null,
    });

    const store = usePendingThreadSendStore.getState();
    store.appendPendingRow(draftThreadKey, row);
    store.copyPendingRows(draftThreadKey, promotedThreadKey, new Set([messageId]));
    store.copyPendingRows(draftThreadKey, promotedThreadKey, new Set([messageId]));

    expect(usePendingThreadSendStore.getState().pendingRowsByThreadKey[draftThreadKey]).toEqual([
      row,
    ]);
    expect(usePendingThreadSendStore.getState().pendingRowsByThreadKey[promotedThreadKey]).toEqual([
      row,
    ]);
  });
});
