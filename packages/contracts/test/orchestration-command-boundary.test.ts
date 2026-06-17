import {
  ClientOrchestrationCommand,
  CommandId,
  EventId,
  OrchestrationCommand,
  ThreadId,
} from "@honk/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const createdAt = "2026-06-17T12:00:00.000Z";

describe("orchestration command boundary", () => {
  it("accepts public client commands", () => {
    expect(
      Schema.is(ClientOrchestrationCommand)({
        type: "thread.session.stop",
        commandId: CommandId.make("command:public-stop"),
        threadId: ThreadId.make("thread:public"),
        createdAt,
      }),
    ).toBe(true);
  });

  it("keeps internal runtime persistence commands out of the public client schema", () => {
    const internalCommand = {
      type: "thread.activity.append",
      commandId: CommandId.make("command:internal-activity"),
      threadId: ThreadId.make("thread:internal"),
      activity: {
        id: EventId.make("event:internal-activity"),
        tone: "info",
        kind: "context-window.updated",
        summary: "Context usage updated",
        payload: {
          usedTokens: 1,
        },
        turnId: null,
        createdAt,
      },
      createdAt,
    };

    expect(Schema.is(ClientOrchestrationCommand)(internalCommand)).toBe(false);
    expect(Schema.is(OrchestrationCommand)(internalCommand)).toBe(true);
  });
});
