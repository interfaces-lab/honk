import {
  EventId,
  MessageId,
  type OrchestrationChatTimelineRow,
  type OrchestrationThreadActivity,
} from "@multi/contracts";
import { deriveChatTimelineRows } from "@multi/shared/chat-timeline-derivation";
import { describe, expect, it } from "vitest";

import {
  deriveWorkLogEntriesForChatTimelineRows,
  materializeTimelineEntriesFromChatTimelineRows,
} from "./thread-branch-view";

const createdAt = "2026-06-05T20:30:00.000Z";

describe("timeline row work entry derivation", () => {
  it("uses message ids as canonical display row ids", () => {
    const messageId = MessageId.make("message:client-user");
    const rows = [
      {
        id: "row:server-user",
        kind: "message",
        messageId,
        entryId: null,
        turnId: null,
        createdAt,
        orderKey: "0001",
      },
    ] satisfies OrchestrationChatTimelineRow[];
    const entries = materializeTimelineEntriesFromChatTimelineRows({
      rows,
      messages: [
        {
          id: messageId,
          role: "user",
          text: "hi",
          createdAt,
          streaming: false,
        },
      ],
      proposedPlans: [],
      activities: [],
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "message:message:client-user",
        kind: "message",
      }),
    ]);
  });

  it("preserves null-turn work rows when deriving from visible timeline rows", () => {
    const activityId = EventId.make("event:null-turn-command");
    const rows = [
      {
        id: "global-status:tool:global-command",
        kind: "work",
        workId: "tool:global-command",
        activityIds: [activityId],
        turnId: null,
        toolCallId: "global-command",
        createdAt,
        orderKey: "0001",
      },
    ] satisfies OrchestrationChatTimelineRow[];
    const activities = [
      {
        id: activityId,
        kind: "tool.completed",
        tone: "tool",
        summary: "Ran command",
        turnId: null,
        createdAt,
        payload: {
          itemId: "global-command",
          itemType: "command_execution",
          data: { command: "git status --short" },
        },
      },
    ] satisfies OrchestrationThreadActivity[];

    const workEntries = deriveWorkLogEntriesForChatTimelineRows({ rows, activities });
    const entries = materializeTimelineEntriesFromChatTimelineRows({
      rows,
      messages: [],
      proposedPlans: [],
      activities: [],
      workEntries,
    });

    expect(workEntries).toEqual([
      expect.objectContaining({
        id: "tool:global-command",
        command: "git status --short",
      }),
    ]);
    expect(entries).toEqual([
      expect.objectContaining({
        id: "global-status:tool:global-command",
        kind: "work",
        entry: expect.objectContaining({
          command: "git status --short",
        }),
      }),
    ]);
  });

  it("materializes extension UI lifecycle rows by request id", () => {
    const requestId = "extension-request-1";
    const resolvedAt = "2026-06-05T20:30:03.000Z";
    const activities = [
      {
        id: EventId.make("runtime-extension-ui-requested"),
        kind: "extension-ui.requested",
        tone: "info",
        summary: "Waiting for Run tool?",
        turnId: null,
        createdAt,
        payload: {
          requestId,
          requestKind: "custom",
          title: "Run tool?",
          detail: "Confirm command execution",
          placeholder: null,
          options: null,
        },
      },
      {
        id: EventId.make("runtime-extension-ui-resolved"),
        kind: "extension-ui.resolved",
        tone: "info",
        summary: "Answered Run tool?",
        turnId: null,
        createdAt: resolvedAt,
        payload: {
          requestId,
          requestKind: "custom",
          title: "Run tool?",
          detail: "Confirm command execution",
          value: null,
        },
      },
    ] satisfies OrchestrationThreadActivity[];
    const rows = deriveChatTimelineRows({
      messages: [],
      entries: [],
      activities,
      proposedPlans: [],
    });
    const entries = materializeTimelineEntriesFromChatTimelineRows({
      rows,
      messages: [],
      proposedPlans: [],
      activities,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        id: `work:extension-ui:${requestId}`,
        kind: "work",
        workId: `extension-ui:${requestId}`,
        workKind: "extension-ui",
        activityIds: [
          EventId.make("runtime-extension-ui-requested"),
          EventId.make("runtime-extension-ui-resolved"),
        ],
        extensionUiRequestId: requestId,
        extensionUiRequestKind: "custom",
      }),
    ]);
    expect(entries).toEqual([
      expect.objectContaining({
        id: `work:extension-ui:${requestId}`,
        kind: "work",
        entry: expect.objectContaining({
          id: `extension-ui:${requestId}`,
          extensionUiRequestId: requestId,
          extensionUiRequestKind: "custom",
          status: "completed",
        }),
      }),
    ]);
  });
});
