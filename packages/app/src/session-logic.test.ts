import { EventId, TurnId, type OrchestrationThreadActivity } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { deriveWorkLogEntries } from "./session-logic";

const createdAt = "2026-06-05T20:00:00.000Z";
const turnId = TurnId.make("turn:streaming-command");

describe("deriveWorkLogEntries", () => {
  it("keeps running command output on the work entry instead of duplicating it in artifacts", () => {
    const entries = deriveWorkLogEntries(
      [
        {
          id: EventId.make("event:tool-updated"),
          kind: "tool.updated",
          tone: "tool",
          summary: "Running command",
          turnId,
          createdAt,
          payload: {
            itemId: "tool-call-1",
            itemType: "command_execution",
            detail: "Enumerating objects...\n",
            data: {
              streamKind: "command_output",
              command: "git push",
            },
          },
        } satisfies OrchestrationThreadActivity,
      ],
      undefined,
    );

    expect(entries).toEqual([
      expect.objectContaining({
        itemType: "command_execution",
        output: "Enumerating objects...",
        status: "running",
        artifacts: [
          expect.objectContaining({
            type: "command",
            command: "git push",
            isPartial: true,
          }),
        ],
      }),
    ]);
    expect(entries[0]?.artifacts?.[0]).not.toHaveProperty("output");
  });

  it("keeps command output on completed command artifacts", () => {
    const entries = deriveWorkLogEntries(
      [
        {
          id: EventId.make("event:tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Ran command",
          turnId,
          createdAt,
          payload: {
            itemId: "tool-call-1",
            itemType: "command_execution",
            detail: "To github.com:org/repo.git\n",
            data: {
              streamKind: "command_output",
              command: "git push",
              result: { exitCode: 0 },
            },
          },
        } satisfies OrchestrationThreadActivity,
      ],
      undefined,
    );

    expect(entries[0]).toEqual(
      expect.objectContaining({
        output: "To github.com:org/repo.git",
        status: "completed",
        artifacts: [
          expect.objectContaining({
            type: "command",
            command: "git push",
            output: "To github.com:org/repo.git",
            exitCode: 0,
          }),
        ],
      }),
    );
  });

  it("does not infer a command from command execution detail output", () => {
    const entries = deriveWorkLogEntries(
      [
        {
          id: EventId.make("event:tool-completed-output-only"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Ran command",
          turnId,
          createdAt,
          payload: {
            itemId: "tool-call-output-only",
            itemType: "command_execution",
            detail: "M AGENTS.md M packages/app/src/session-logic.ts\n",
            data: {
              result: { exitCode: 0 },
            },
          },
        } satisfies OrchestrationThreadActivity,
      ],
      undefined,
    );

    expect(entries[0]).toEqual(
      expect.objectContaining({
        detail: "M AGENTS.md M packages/app/src/session-logic.ts",
        status: "completed",
      }),
    );
    expect(entries[0]).not.toHaveProperty("command");
    expect(entries[0]?.artifacts?.[0]).toEqual(
      expect.objectContaining({
        type: "command",
        exitCode: 0,
      }),
    );
    expect(entries[0]?.artifacts?.[0]).not.toHaveProperty("command");
  });
});
