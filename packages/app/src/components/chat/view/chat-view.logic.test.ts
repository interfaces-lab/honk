import { EnvironmentId, ProviderInteractionMode, ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { DraftId as ComposerDraftId } from "../../../stores/chat-drafts";
import type { WorkLogEntry } from "../../../session-logic";
import type { Thread } from "../../../types";
import {
  COMPOSER_INTERACTION_MODE_CYCLE,
  assertActiveThread,
  nextComposerInteractionMode,
  workLogEntrySubagents,
} from "./chat-view.logic";

describe("nextComposerInteractionMode", () => {
  it("cycles through default, plan, ask, back to default", () => {
    let mode: ProviderInteractionMode = "default";
    const visited: ProviderInteractionMode[] = [mode];
    for (let step = 0; step < COMPOSER_INTERACTION_MODE_CYCLE.length; step += 1) {
      mode = nextComposerInteractionMode(mode);
      visited.push(mode);
    }
    expect(visited).toStrictEqual(["default", "plan", "ask", "default"]);
  });

  it("recovers from an unrecognized mode by starting at the head of the cycle", () => {
    expect(nextComposerInteractionMode("unrecognized" as ProviderInteractionMode)).toBe("default");
  });
});

describe("workLogEntrySubagents", () => {
  it("returns the subagents array when set", () => {
    const entry = {
      id: "work-1",
      createdAt: "2026-02-23T00:00:00.000Z",
      label: "label",
      tone: "tool",
      subagents: [
        {
          threadId: "subagent-thread-1",
        },
      ],
    } as unknown as WorkLogEntry;
    expect(workLogEntrySubagents(entry)).toStrictEqual([
      { threadId: "subagent-thread-1" },
    ]);
  });

  it("returns an empty array when there are no subagents", () => {
    const entry = {
      id: "work-1",
      createdAt: "2026-02-23T00:00:00.000Z",
      label: "label",
      tone: "tool",
    } as unknown as WorkLogEntry;
    expect(workLogEntrySubagents(entry)).toStrictEqual([]);
  });
});

describe("assertActiveThread", () => {
  const environmentId = EnvironmentId.make("env-1");
  const threadId = ThreadId.make("thread-1");

  it("returns when an active thread is provided", () => {
    const thread = {
      id: threadId,
      environmentId,
    } as unknown as Thread;
    expect(() =>
      assertActiveThread(thread, {
        routeKind: "server",
        environmentId,
        threadId,
        draftId: null,
      }),
    ).not.toThrow();
  });

  it("throws when the thread is missing on the server route", () => {
    expect(() =>
      assertActiveThread(undefined, {
        routeKind: "server",
        environmentId,
        threadId,
        draftId: null,
      }),
    ).toThrow(/server route/);
  });

  it("includes the draft id in the error for draft routes", () => {
    const draftId = ComposerDraftId.make("draft-1");
    expect(() =>
      assertActiveThread(undefined, {
        routeKind: "draft",
        environmentId,
        threadId,
        draftId,
      }),
    ).toThrow(/draft-1/);
  });
});
