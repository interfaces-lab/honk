import { describe, expect, it } from "vitest";

import type { Session } from "@honk/core/session";

import type { ChatEvent, ChatState } from "./chat-model";
import {
  conversationItems,
  effectiveLayer,
  initialState,
  reduce,
  segmentRows,
  tickerOf,
  turnViews,
} from "./chat-model";

const fold = (events: readonly ChatEvent[], from: ChatState = initialState): ChatState =>
  events.reduce(reduce, from);

const sessionId = "session-1" as Session.SessionId;

const piEvent = (event: { type: string; [key: string]: unknown }): ChatEvent => ({
  type: "event",
  event: event as unknown as Session.AgentHarnessEvent,
});

const assistantUpdate = (text: string): ChatEvent =>
  piEvent({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });

const stateFrame = (
  entries: readonly Session.SessionTreeEntry[],
  status: Session.RunStatus = "idle",
  turns: Session.ChangesOutput["turns"] = [],
): ChatEvent => ({ type: "state", entries, status, turns });

// Minimal Pi-shaped entries: the projection only reads type, id, and message.
const userEntry = (id: string, text: string): Session.SessionTreeEntry =>
  ({
    type: "message",
    id,
    message: { role: "user", content: [{ type: "text", text }] },
  }) as unknown as Session.SessionTreeEntry;

const assistantEntry = (id: string, text: string): Session.SessionTreeEntry =>
  ({
    type: "message",
    id,
    message: { role: "assistant", content: [{ type: "text", text }] },
  }) as unknown as Session.SessionTreeEntry;

describe("chat model", () => {
  it("starts connecting with an empty transcript", () => {
    expect(initialState.status).toBe("connecting");
    expect(initialState.sessionId).toBeNull();
    expect(initialState.entries).toEqual([]);
    expect(initialState.turns).toEqual([]);
    expect(initialState.error).toBeNull();
    expect(initialState.streamingMessage).toBeNull();
  });

  it("attached records the session id but stays connecting until the first state frame", () => {
    const state = fold([{ type: "attached", sessionId }]);
    expect(state.sessionId).toBe(sessionId);
    expect(state.status).toBe("connecting");
  });

  it("the attach state frame makes the chat ready to prompt", () => {
    const state = fold([{ type: "attached", sessionId }, stateFrame([])]);
    expect(state.status).toBe("ready");
  });

  it("prompted enters running immediately", () => {
    const state = fold([{ type: "attached", sessionId }, stateFrame([]), { type: "prompted" }]);
    expect(state.status).toBe("running");
  });

  it("streams the live assistant message and clears it at message end", () => {
    const streaming = fold([
      { type: "attached", sessionId },
      stateFrame([]),
      piEvent({ type: "agent_start" }),
      assistantUpdate("Hel"),
      assistantUpdate("Hello"),
    ]);
    expect(streaming.status).toBe("running");
    expect(streaming.streamingMessage).not.toBeNull();

    const ended = fold(
      [
        piEvent({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
        }),
      ],
      streaming,
    );
    expect(ended.streamingMessage).toBeNull();
  });

  it("authoritative state replaces entries, receipts, and run status wholesale", () => {
    const turns = [{ entryId: "u1", files: [] }] as unknown as Session.ChangesOutput["turns"];
    const settled = fold([
      { type: "attached", sessionId },
      stateFrame([]),
      piEvent({ type: "agent_start" }),
      piEvent({ type: "settled" }),
      stateFrame([userEntry("u1", "hi")], "idle", turns),
    ]);
    expect(settled.status).toBe("ready");
    expect(settled.entries).toHaveLength(1);
    expect(settled.turns).toBe(turns);
  });

  it("a state frame reporting a running harness wins over local guesses", () => {
    const state = fold([{ type: "attached", sessionId }, stateFrame([], "running")]);
    expect(state.status).toBe("running");
  });

  it("stream end disconnects; failures carry the message", () => {
    const ready = fold([{ type: "attached", sessionId }, stateFrame([])]);
    expect(reduce(ready, { type: "stream_ended" }).status).toBe("disconnected");

    const failed = reduce(ready, { type: "failed", message: "session.not_found" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("session.not_found");
  });
});

describe("conversation items", () => {
  it("renders each turn at its user entry, with markers interleaved in order", () => {
    const modelChange = {
      type: "model_change",
      id: "m1",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    } as unknown as Session.SessionTreeEntry;
    const compaction = {
      type: "compaction",
      id: "c1",
      summary: "Earlier discussion about auth",
      tokensBefore: 52_000,
    } as unknown as Session.SessionTreeEntry;
    const label = { type: "label", id: "l1" } as unknown as Session.SessionTreeEntry;

    const items = conversationItems(
      [
        modelChange,
        userEntry("u1", "Say hello"),
        assistantEntry("a1", "Hello from faux"),
        compaction,
        userEntry("u2", "again"),
        label,
      ],
      null,
    );
    expect(items.map((item) => (item.kind === "turn" ? `turn:${item.turn.id}` : item.kind))).toEqual(
      ["notice", "turn:u1", "compaction", "turn:u2"],
    );
    expect(items[0]).toEqual({
      kind: "notice",
      id: "m1",
      text: "Model: anthropic/claude-sonnet-4-6",
    });
  });

  it("handles plain string content", () => {
    const entry = {
      type: "message",
      id: "u1",
      message: { role: "user", content: "plain" },
    } as unknown as Session.SessionTreeEntry;
    const items = conversationItems([entry], null);
    expect(items[0]?.kind === "turn" && items[0].turn.userText).toBe("plain");
  });
});

describe("turn grammar", () => {
  const toolCall = (id: string, callId: string, name: string, headline?: string) =>
    ({
      type: "message",
      id,
      message: {
        role: "assistant",
        content: [
          ...(headline === undefined ? [] : [{ type: "text", text: headline }]),
          { type: "toolCall", id: callId, name, arguments: { path: "a.ts" } },
        ],
      },
    }) as unknown as Session.SessionTreeEntry;
  const result = (id: string, callId: string, text = "done") =>
    ({
      type: "message",
      id,
      message: {
        role: "toolResult",
        toolCallId: callId,
        isError: false,
        content: [{ type: "text", text }],
      },
    }) as unknown as Session.SessionTreeEntry;

  it("folds headline → steps → summary into one turn", () => {
    const turns = turnViews([
      userEntry("u1", "fix the test"),
      toolCall("a1", "c1", "read", "Rerunning tests from package level"),
      result("t1", "c1"),
      assistantEntry("a2", "All four suites are green now."),
    ]);
    expect(turns).toHaveLength(1);
    const turn = turns[0];
    expect(turn?.id).toBe("u1");
    expect(turn?.segments).toHaveLength(1);
    expect(turn?.segments[0]?.headline).toBe("Rerunning tests from package level");
    expect(turn?.segments[0]?.steps[0]).toMatchObject({
      key: "c1",
      name: "read",
      state: "ok",
      readShaped: true,
    });
    expect(turn?.summary).toBe("All four suites are green now.");
  });

  it("a new text block closes the segment and opens the next", () => {
    const turns = turnViews([
      userEntry("u1", "go"),
      toolCall("a1", "c1", "read", "Looking at the config"),
      result("t1", "c1"),
      toolCall("a2", "c2", "edit", "Fixing the transform"),
      result("t2", "c2"),
    ]);
    const segments = turns[0]?.segments ?? [];
    expect(segments.map((segment) => segment.headline)).toEqual([
      "Looking at the config",
      "Fixing the transform",
    ]);
    // edits never read-shape: they stay visible at every density.
    expect(segments[1]?.steps[0]?.readShaped).toBe(false);
  });

  it("tools without a preceding text block get a headline-less segment", () => {
    const turns = turnViews([userEntry("u1", "go"), toolCall("a1", "c1", "bash")]);
    expect(turns[0]?.segments[0]?.headline).toBeNull();
    expect(turns[0]?.segments[0]?.steps[0]?.state).toBe("running");
    expect(turns[0]?.summary).toBeNull();
  });

  it("splits turns on user messages", () => {
    const turns = turnViews([
      userEntry("u1", "first"),
      assistantEntry("a1", "Answered."),
      userEntry("u2", "second"),
      toolCall("a2", "c1", "read"),
    ]);
    expect(turns.map((turn) => turn.id)).toEqual(["u1", "u2"]);
    expect(turns[0]?.summary).toBe("Answered.");
    expect(turns[0]?.segments).toEqual([]);
    expect(turns[1]?.segments[0]?.steps[0]?.readShaped).toBe(true);
  });

  it("unknown tools never group: opaque classifies as not read-shaped", () => {
    const turns = turnViews([userEntry("u1", "go"), toolCall("a1", "c1", "some-mcp-tool")]);
    expect(turns[0]?.segments[0]?.steps[0]?.readShaped).toBe(false);
  });

  it("folds the streaming message into the open turn", () => {
    const streaming = {
      role: "assistant",
      timestamp: 1234,
      content: [
        { type: "text", text: "Reading the config first" },
        { type: "toolCall", id: "c9", name: "read", arguments: { path: "conf.ts" } },
        { type: "text", text: "The port was wrong" },
      ],
    } as unknown as Parameters<typeof turnViews>[1];

    const turns = turnViews([userEntry("u1", "fix it")], streaming);
    expect(turns).toHaveLength(1);
    const turn = turns[0];
    expect(turn?.segments).toHaveLength(1);
    expect(turn?.segments[0]?.headline).toBe("Reading the config first");
    expect(turn?.segments[0]?.steps[0]).toMatchObject({ key: "c9", state: "running" });
    // The trailing text is the summary-so-far: it streams outside the preview
    // window and becomes the next headline if another tool call arrives.
    expect(turn?.summary).toBe("The port was wrong");
  });

  it("attaches the change receipt to the turn that earned it", () => {
    const changes = [
      {
        entryId: "a1",
        files: [
          {
            file: "src/index.ts",
            status: "modified",
            tracked: true,
            binary: false,
            additions: 3,
            deletions: 1,
          },
        ],
      },
      { entryId: "a2", files: [] },
    ] as unknown as Session.ChangesOutput["turns"];

    const turns = turnViews(
      [
        userEntry("u1", "change it"),
        assistantEntry("a1", "done"),
        userEntry("u2", "and this"),
        assistantEntry("a2", "nothing to do"),
      ],
      null,
      changes,
    );
    expect(turns[0]?.files.map((file) => file.file)).toEqual(["src/index.ts"]);
    // A turn that touched nothing shows no receipt.
    expect(turns[1]?.files).toEqual([]);
  });

  it("a failed turn carries the model's error message", () => {
    const failed = {
      type: "message",
      id: "a1",
      timestamp: "2026-08-06T10:00:01.000Z",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "overloaded_error",
        content: [],
      },
    } as unknown as Session.SessionTreeEntry;
    const turns = turnViews([userEntry("u1", "go"), failed]);
    expect(turns[0]?.outcome).toBe("failed");
    expect(turns[0]?.error).toBe("overloaded_error");
  });

  it("segment rows group consecutive reads and never a write", () => {
    const step = (key: string, readShaped: boolean) =>
      ({ key, readShaped }) as unknown as Parameters<typeof segmentRows>[0][number];
    const rows = segmentRows([
      step("r1", true),
      step("r2", true),
      step("w1", false),
      step("r3", true),
    ]);
    expect(
      rows.map((row) => (row.kind === "group" ? row.steps.map((s) => s.key) : row.step.key)),
    ).toEqual([["r1", "r2"], "w1", "r3"]);
  });
});

describe("ticker and turn timing", () => {
  const running = (content: readonly unknown[]): ChatState => ({
    ...initialState,
    status: "running",
    streamingMessage: { role: "assistant", content } as unknown as ChatState["streamingMessage"],
  });

  it("plans before any block streams, and while thinking streams", () => {
    expect(turnViews([]).length).toBe(0);
    expect(tickerOf({ ...initialState, status: "running", streamingMessage: null })).toEqual({
      kind: "planning",
    });
    expect(tickerOf(running([{ type: "thinking", thinking: "hmm" }]))).toEqual({
      kind: "planning",
    });
  });

  it("names the streaming tool call with its detail", () => {
    const state = running([
      { type: "text", text: "Fixing the test" },
      { type: "toolCall", id: "c1", name: "bash", arguments: { command: "pnpm vitest run" } },
    ]);
    expect(tickerOf(state)).toEqual({ kind: "step", name: "bash", detail: "pnpm vitest run" });
  });

  it("rolls up a trailing run of reads at the group minimum", () => {
    const read = (id: string, path: string) => ({
      type: "toolCall",
      id,
      name: "read",
      arguments: { path },
    });
    // One read is a step; the second crosses the minimum and rolls up.
    expect(tickerOf(running([read("c1", "a.ts")]))).toEqual({
      kind: "step",
      name: "read",
      detail: "a.ts",
    });
    expect(tickerOf(running([read("c1", "a.ts"), read("c2", "b.ts")]))).toEqual({
      kind: "rollup",
      count: 2,
    });
    // A text block breaks the run: only the segment's trailing reads count.
    expect(
      tickerOf(running([read("c1", "a.ts"), { type: "text", text: "Now" }, read("c2", "b.ts")])),
    ).toEqual({ kind: "step", name: "read", detail: "b.ts" });
    // A writing tool never disappears into a roll-up (spec §4).
    expect(
      tickerOf(
        running([
          read("c1", "a.ts"),
          { type: "toolCall", id: "c2", name: "edit", arguments: { path: "b.ts", edits: [] } },
        ]),
      ),
    ).toEqual({ kind: "step", name: "edit", detail: "b.ts" });
  });

  it("reports writing while prose streams, idle when not running", () => {
    expect(tickerOf(running([{ type: "text", text: "All done because" }]))).toEqual({
      kind: "writing",
    });
    expect(tickerOf(initialState)).toEqual({ kind: "idle" });
  });

  it("measures duration from the turn's entry timestamps", () => {
    const at = (id: string, role: string, timestamp: string, content: unknown) =>
      ({ type: "message", id, timestamp, message: { role, content } }) as unknown as
        Session.SessionTreeEntry;
    const turns = turnViews([
      at("u1", "user", "2026-08-05T10:00:00.000Z", [{ type: "text", text: "go" }]),
      at("a1", "assistant", "2026-08-05T10:00:04.000Z", [{ type: "text", text: "Done." }]),
    ]);
    expect(turns[0]?.durationMs).toBe(4000);
    expect(turns[0]?.startedAt).toBe("2026-08-05T10:00:00.000Z");
    expect(turns[0]?.outcome).toBe("done");
  });

  it("labels an aborted turn stopped and an errored turn failed", () => {
    const withStop = (stopReason: string) =>
      ({
        type: "message",
        id: "a1",
        timestamp: "2026-08-05T10:00:01.000Z",
        message: { role: "assistant", stopReason, content: [{ type: "text", text: "…" }] },
      }) as unknown as Session.SessionTreeEntry;
    const user = userEntry("u1", "go");
    expect(turnViews([user, withStop("aborted")])[0]?.outcome).toBe("stopped");
    expect(turnViews([user, withStop("error")])[0]?.outcome).toBe("failed");
  });
});

describe("effective layer", () => {
  it("maps each density to its phase defaults", () => {
    expect(effectiveLayer(null, "compact-all-grouped", "running")).toBe(1);
    expect(effectiveLayer(null, "compact-all-grouped", "settled")).toBe(0);
    expect(effectiveLayer(null, "compact-ungrouped", "running")).toBe(1);
    expect(effectiveLayer(null, "compact-ungrouped", "settled")).toBe(1);
    expect(effectiveLayer(null, "detailed", "running")).toBe(2);
    expect(effectiveLayer(null, "detailed", "settled")).toBe(2);
  });

  it("a per-turn override beats the setting in every phase", () => {
    expect(effectiveLayer(2, "compact-all-grouped", "settled")).toBe(2);
    expect(effectiveLayer(0, "detailed", "running")).toBe(0);
  });
});
