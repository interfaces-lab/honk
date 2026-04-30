// @ts-nocheck
import { TurnId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { assistantBlocks, hasStreamingThinking, hasTurnThinking } from "./assistant-content";

describe("assistantBlocks", () => {
  it("keeps thinking visible while clipping text to the visible assistant transcript", () => {
    expect(
      assistantBlocks({
        text: "",
        content: [
          { type: "thinking", thinking: "Inspect", summary: "Reasoning" },
          { type: "text", text: "Answer" },
        ],
      }),
    ).toEqual([{ type: "thinking", thinking: "Inspect", summary: "Reasoning" }]);

    expect(
      assistantBlocks({
        text: "Answer",
        content: [
          { type: "thinking", thinking: "Inspect", summary: "Reasoning" },
          { type: "text", text: "Answer" },
        ],
      }),
    ).toEqual([
      { type: "thinking", thinking: "Inspect", summary: "Reasoning" },
      { type: "text", text: "Answer" },
    ]);
  });
});

describe("hasStreamingThinking", () => {
  it("matches the latest streaming assistant message", () => {
    expect(
      hasStreamingThinking([
        {
          role: "assistant",
          streaming: true,
          content: [{ type: "thinking", thinking: "Inspect" }],
        },
      ]),
    ).toBe(true);

    expect(
      hasStreamingThinking([
        {
          role: "assistant",
          streaming: true,
          content: [{ type: "thinking", thinking: "Inspect" }],
        },
        {
          role: "assistant",
          streaming: true,
          content: [{ type: "text", text: "Answer" }],
        },
      ]),
    ).toBe(false);
  });
});

describe("hasTurnThinking", () => {
  const turn = TurnId.make("turn-thinking");
  const old = TurnId.make("turn-old");

  it("keeps reasoning visible for the active turn after streaming stops", () => {
    expect(
      hasTurnThinking(
        [
          {
            role: "assistant",
            turnId: turn,
            content: [{ type: "thinking", thinking: "Inspect" }],
          },
        ],
        turn,
      ),
    ).toBe(true);
  });

  it("ignores reasoning from older turns", () => {
    expect(
      hasTurnThinking(
        [
          {
            role: "assistant",
            turnId: old,
            content: [{ type: "thinking", thinking: "Inspect" }],
          },
          {
            role: "assistant",
            turnId: turn,
            content: [{ type: "text", text: "Answer" }],
          },
        ],
        turn,
      ),
    ).toBe(false);
  });
});
