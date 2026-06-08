import { MessageId, TurnId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../../types";
import {
  appendMissingRuntimeTimelineMessageEntries,
  appendPendingUserTimelineEntries,
  appendTransientTimelineEntries,
  createPendingTimelineRow,
  materializePendingUserTimelineEntries,
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

function assistantMessage(input: {
  id: string;
  text: string;
  turnId?: ChatMessage["turnId"];
}): ChatMessage {
  return {
    id: MessageId.make(input.id),
    role: "assistant",
    text: input.text,
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
    createdAt,
    streaming: true,
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

  it("hides a duplicate transient row once runtime display acknowledges its client message id", () => {
    const clientMessageId = MessageId.make("message:runtime-acknowledged");
    const pending = createPendingTimelineRow({
      messageId: clientMessageId,
      text: "Commit & Push",
      createdAt,
      parentEntryId: null,
    });

    expect(
      unacknowledgedPendingTimelineRows({
        pendingRows: [pending],
        committedMessages: [],
        acknowledgedMessageIds: new Set([clientMessageId]),
      }),
    ).toEqual([]);
  });
});

describe("materializePendingUserTimelineEntries", () => {
  it("renders only pending user messages for runtime startup gaps", () => {
    const pending = createPendingTimelineRow({
      messageId: MessageId.make("message:runtime-startup"),
      text: "Commit & Push",
      createdAt,
      parentEntryId: null,
    });

    expect(materializePendingUserTimelineEntries([pending])).toEqual([
      {
        id: "message:message:runtime-startup",
        kind: "message",
        createdAt,
        message: pending.message,
      },
    ]);
  });
});

describe("appendPendingUserTimelineEntries", () => {
  it("keeps the pending user bubble visible when a runtime timeline is empty", () => {
    const pending = createPendingTimelineRow({
      messageId: MessageId.make("message:runtime-startup-empty-timeline"),
      text: "Commit & Push",
      createdAt,
      parentEntryId: null,
    });

    expect(
      appendPendingUserTimelineEntries({
        entries: [],
        pendingRows: [pending],
      }),
    ).toEqual([
      {
        id: "message:message:runtime-startup-empty-timeline",
        kind: "message",
        createdAt,
        message: pending.message,
      },
    ]);
  });

  it("does not duplicate pending user rows already represented by runtime messages", () => {
    const message = userMessage({
      id: "message:runtime-startup-canonical",
      text: "Commit & Push",
    });
    const pending = createPendingTimelineRow({
      messageId: message.id,
      text: message.text,
      createdAt,
      parentEntryId: null,
    });
    const runtimeEntry = {
      id: "message:runtime-entry",
      kind: "message" as const,
      createdAt,
      message,
    };

    expect(
      appendPendingUserTimelineEntries({
        entries: [runtimeEntry],
        pendingRows: [pending],
      }),
    ).toEqual([runtimeEntry]);
  });
});

describe("appendMissingRuntimeTimelineMessageEntries", () => {
  it("keeps committed user messages visible while runtime display timeline lags", () => {
    const message = userMessage({
      id: "message:runtime-committed-before-display",
      text: "Commit & Push",
    });

    expect(
      appendMissingRuntimeTimelineMessageEntries({
        entries: [],
        messages: [message],
        pendingRows: [],
      }),
    ).toEqual([
      {
        id: "message:message:runtime-committed-before-display",
        kind: "message",
        createdAt,
        message,
      },
    ]);
  });

  it("keeps committed assistant messages visible while runtime display timeline has only tool rows", () => {
    const message = assistantMessage({
      id: "message:assistant-before-display",
      text: "Done.",
    });

    expect(
      appendMissingRuntimeTimelineMessageEntries({
        entries: [],
        messages: [message],
        pendingRows: [],
      }),
    ).toEqual([
      {
        id: "message:message:assistant-before-display",
        kind: "message",
        createdAt,
        message,
      },
    ]);
  });

  it("does not duplicate user messages already represented by runtime entries", () => {
    const message = userMessage({
      id: "message:runtime-canonical-user",
      text: "Commit & Push",
    });
    const runtimeEntry = {
      id: "message:runtime-entry",
      kind: "message" as const,
      createdAt,
      message,
    };

    expect(
      appendMissingRuntimeTimelineMessageEntries({
        entries: [runtimeEntry],
        messages: [message],
        pendingRows: [],
      }),
    ).toEqual([runtimeEntry]);
  });

  it("does not duplicate committed assistant messages already represented by runtime message entries", () => {
    const turnId = TurnId.make("turn:runtime-assistant");
    const committedMessage = assistantMessage({
      id: "message:committed-assistant",
      text: "Final answer",
      turnId,
    });
    const runtimeMessage = assistantMessage({
      id: "message:runtime-assistant",
      text: "Final",
      turnId,
    });
    const runtimeEntry = {
      id: "message:runtime-assistant",
      kind: "message" as const,
      createdAt,
      message: runtimeMessage,
    };

    expect(
      appendMissingRuntimeTimelineMessageEntries({
        entries: [runtimeEntry],
        messages: [committedMessage],
        pendingRows: [],
      }),
    ).toEqual([runtimeEntry]);
  });
});

describe("appendTransientTimelineEntries", () => {
  it("does not duplicate messages already represented by canonical rows", () => {
    const message = userMessage({
      id: "message:canonical",
      text: "already here",
    });
    const existingEntry = {
      id: "message:message:canonical",
      kind: "message" as const,
      createdAt,
      message,
    };

    expect(
      appendTransientTimelineEntries({
        entries: [existingEntry],
        messages: [message],
        pendingRows: [],
      }),
    ).toEqual([existingEntry]);
  });

  it("keeps committed messages visible while canonical timeline rows lag", () => {
    const message = userMessage({
      id: "message:committed-before-row",
      text: "Commit & Push",
    });

    expect(
      appendTransientTimelineEntries({
        entries: [],
        messages: [message],
        pendingRows: [],
      }),
    ).toEqual([
      {
        id: "message:message:committed-before-row",
        kind: "message",
        createdAt,
        message,
      },
    ]);
  });

  it("does not reorder canonical rows when transient messages share a timestamp", () => {
    const message = userMessage({
      id: "message:lagging",
      text: "Lagging message",
    });
    const firstWorkEntry = {
      id: "work:first",
      kind: "work" as const,
      createdAt,
      entry: {
        id: "first",
        createdAt,
        label: "First",
        tone: "tool" as const,
        status: "completed" as const,
      },
    };
    const secondWorkEntry = {
      id: "work:second",
      kind: "work" as const,
      createdAt,
      entry: {
        id: "second",
        createdAt,
        label: "Second",
        tone: "tool" as const,
        status: "completed" as const,
      },
    };

    expect(
      appendTransientTimelineEntries({
        entries: [firstWorkEntry, secondWorkEntry],
        messages: [message],
        pendingRows: [],
      }).map((entry) => entry.id),
    ).toEqual(["work:first", "work:second", "message:message:lagging"]);
  });
});
