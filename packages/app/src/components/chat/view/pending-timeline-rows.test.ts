import { MessageId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../../types";
import {
  createPendingTimelineRow,
  unacknowledgedPendingTimelineRows,
} from "./pending-timeline-rows";

const createdAt = "2026-06-03T21:10:27.000Z";

function userMessage(input: { id: string; text: string }): ChatMessage {
  return {
    id: MessageId.make(input.id),
    role: "user",
    text: input.text,
    createdAt,
    streaming: false,
  };
}

describe("unacknowledgedPendingTimelineRows", () => {
  it("hides an optimistic row once the runtime projection contains its client message id", () => {
    const pending = createPendingTimelineRow({
      messageId: MessageId.make("message:optimistic"),
      text: "what is this codebase",
      createdAt,
      parentEntryId: null,
    });

    expect(
      unacknowledgedPendingTimelineRows({
        pendingRows: [pending],
        committedMessages: [
          userMessage({
            id: "message:optimistic",
            text: "what is this codebase",
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("keeps a text row pending while a committed user message has a different id", () => {
    const pending = createPendingTimelineRow({
      messageId: MessageId.make("message:optimistic"),
      text: "what is this codebase",
      createdAt,
      parentEntryId: null,
    });

    expect(
      unacknowledgedPendingTimelineRows({
        pendingRows: [pending],
        committedMessages: [
          userMessage({
            id: "message:runtime-entry",
            text: "what is this codebase",
          }),
        ],
      }),
    ).toEqual([pending]);
  });
});
