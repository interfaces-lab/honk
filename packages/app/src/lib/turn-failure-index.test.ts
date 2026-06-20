import { EventId, MessageId, TurnId } from "@honk/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../types";
import {
  buildTurnFailuresByUserMessageId,
  areSameTurnFailuresByUserMessageId,
} from "./turn-failure-index";

const turnId = TurnId.make("turn:failure-index");
const userMessageId = MessageId.make("message:failure-index:user");

const userMessage = {
  id: userMessageId,
  role: "user",
  text: "Run this",
  turnId,
  createdAt: "2026-06-05T16:00:00.000Z",
  streaming: false,
} satisfies ChatMessage;

describe("buildTurnFailuresByUserMessageId", () => {
  it("maps provider failure activities to the triggering user message", () => {
    const failures = buildTurnFailuresByUserMessageId({
      messages: [userMessage],
      activities: [
        {
          id: EventId.make("activity:provider-failed"),
          tone: "error",
          kind: "runtime.turn.provider.failed",
          summary: "Provider request failed",
          payload: {
            detail: "The usage limit has been reached",
            messageId: userMessageId,
          },
          turnId,
          createdAt: "2026-06-05T16:00:01.000Z",
        },
      ],
      latestTurn: null,
      threadError: null,
    });

    expect(failures.get(userMessageId)).toBe("The usage limit has been reached");
  });

  it("maps stored provider-failure assistant text to the triggering user message", () => {
    const failures = buildTurnFailuresByUserMessageId({
      messages: [
        userMessage,
        {
          id: MessageId.make("message:failure-index:assistant"),
          role: "assistant",
          text: "Provider error: Codex error: overloaded",
          turnId,
          createdAt: "2026-06-05T16:00:01.000Z",
          streaming: false,
        },
      ],
      activities: [],
      latestTurn: null,
      threadError: null,
    });

    expect(failures.get(userMessageId)).toBe("overloaded");
  });

  it("maps thread.error to the latest errored turn user message", () => {
    const failures = buildTurnFailuresByUserMessageId({
      messages: [userMessage],
      activities: [],
      latestTurn: {
        turnId,
        state: "error",
        requestedAt: "2026-06-05T16:00:00.000Z",
        startedAt: "2026-06-05T16:00:00.100Z",
        completedAt: "2026-06-05T16:00:01.000Z",
        assistantMessageId: null,
      },
      threadError: "Turn failed",
    });

    expect(failures.get(userMessageId)).toBe("Turn failed");
  });
});

describe("areSameTurnFailuresByUserMessageId", () => {
  it("returns true for maps with identical entries", () => {
    const left = buildTurnFailuresByUserMessageId({
      messages: [userMessage],
      activities: [],
      latestTurn: null,
      threadError: null,
    });
    const right = buildTurnFailuresByUserMessageId({
      messages: [userMessage],
      activities: [],
      latestTurn: null,
      threadError: null,
    });

    expect(areSameTurnFailuresByUserMessageId(left, right)).toBe(true);
  });
});
