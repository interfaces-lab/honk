import { MessageId, ThreadEntryId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../../types";
import {
  acknowledgedPendingTimelineRows,
  appendPendingTimelineRowsToMessages,
  appendTransientTimelineEntries,
  createPendingTimelineRow,
  filterPendingTimelineRowsToBranch,
} from "./pending-timeline-rows";
import type { ThreadBranchView } from "./thread-branch-view";

const USER_MESSAGE: ChatMessage = {
  id: MessageId.make("message-user-1"),
  role: "user",
  text: "Committed user",
  turnId: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  streaming: false,
};

const ASSISTANT_MESSAGE: ChatMessage = {
  id: MessageId.make("message-assistant-1"),
  role: "assistant",
  text: "Committed assistant",
  turnId: null,
  createdAt: "2026-03-01T00:00:01.000Z",
  streaming: false,
};

function makePendingRow(input?: { messageId?: MessageId; parentEntryId?: ThreadEntryId | null }) {
  return createPendingTimelineRow({
    messageId: input?.messageId ?? MessageId.make("message-pending-1"),
    text: "Pending user",
    createdAt: "2026-03-01T00:00:02.000Z",
    parentEntryId: input?.parentEntryId ?? ThreadEntryId.make("entry-user-1"),
  });
}

describe("pending timeline rows", () => {
  it("appends pending rows to message input and reconciles by client send key", () => {
    const pendingRow = makePendingRow();

    expect(appendPendingTimelineRowsToMessages([USER_MESSAGE], [pendingRow])).toEqual([
      USER_MESSAGE,
      pendingRow.message,
    ]);
    expect(
      appendPendingTimelineRowsToMessages(
        [
          USER_MESSAGE,
          {
            ...pendingRow.message,
            streaming: false,
          },
        ],
        [pendingRow],
      ),
    ).toEqual([USER_MESSAGE, pendingRow.message]);
    expect(
      acknowledgedPendingTimelineRows({
        pendingRows: [pendingRow],
        committedMessages: [USER_MESSAGE, pendingRow.message],
      }),
    ).toEqual([pendingRow]);
  });

  it("filters pending rows after branch selection", () => {
    const keptRow = makePendingRow({ parentEntryId: ThreadEntryId.make("entry-kept") });
    const droppedRow = makePendingRow({
      messageId: MessageId.make("message-pending-2"),
      parentEntryId: ThreadEntryId.make("entry-dropped"),
    });
    const branchView: ThreadBranchView = {
      status: "valid",
      entryId: ThreadEntryId.make("entry-kept"),
      entryIds: new Set([ThreadEntryId.make("entry-root"), ThreadEntryId.make("entry-kept")]),
      messageIds: new Set(),
      turnIds: new Set(),
      issue: null,
    };

    expect(filterPendingTimelineRowsToBranch([keptRow, droppedRow], branchView)).toEqual([
      keptRow,
    ]);
    expect(
      filterPendingTimelineRowsToBranch([keptRow], { ...branchView, status: "invalid" }),
    ).toEqual([]);
  });

  it("appends pending and live messages to canonical timeline entries", () => {
    const liveAssistant: ChatMessage = {
      id: MessageId.make("message-live-assistant"),
      role: "assistant",
      text: "Streaming assistant",
      turnId: null,
      createdAt: "2026-03-01T00:00:03.000Z",
      streaming: true,
    };
    const pendingRow = makePendingRow();

    const entries = appendTransientTimelineEntries({
      entries: [
        {
          id: `message:${USER_MESSAGE.id}`,
          kind: "message",
          createdAt: USER_MESSAGE.createdAt,
          message: USER_MESSAGE,
        },
        {
          id: `message:${ASSISTANT_MESSAGE.id}`,
          kind: "message",
          createdAt: ASSISTANT_MESSAGE.createdAt,
          message: ASSISTANT_MESSAGE,
        },
      ],
      liveMessages: [liveAssistant],
      pendingRows: [pendingRow],
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      `message:${USER_MESSAGE.id}`,
      `message:${ASSISTANT_MESSAGE.id}`,
      pendingRow.id,
      `message:${liveAssistant.id}`,
    ]);
    expect(entries.map((entry) => (entry.kind === "message" ? entry.message.text : ""))).toEqual([
      "Committed user",
      "Committed assistant",
      "Pending user",
      "Streaming assistant",
    ]);
  });
});
