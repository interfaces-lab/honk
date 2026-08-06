import { describe, expect, it } from "vitest";

import type { Session } from "@honk/core/session";

import type { ChatEvent, ChatState } from "./chat-model";
import { effectiveLayer, initialState, reduce, threadItems, tickerOf, turnViews } from "./chat-model";

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

describe("thread items", () => {
  it("projects user and assistant messages natively", () => {
    const items = threadItems(
      [userEntry("u1", "Say hello"), assistantEntry("a1", "Hello from faux")],
      null,
    );
    expect(items).toEqual([
      { kind: "user", id: "u1", text: "Say hello" },
      {
        kind: "assistant",
        id: "a1",
        live: false,
        blocks: [{ kind: "text", key: "a1:0", text: "Hello from faux" }],
        error: null,
      },
    ]);
  });

  it("pairs tool results onto the calls that made them, never as rows", () => {
    const call = {
      type: "message",
      id: "a1",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } }],
      },
    } as unknown as Session.SessionTreeEntry;
    const result = {
      type: "message",
      id: "t1",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        isError: false,
        content: [{ type: "text", text: "file body" }],
      },
    } as unknown as Session.SessionTreeEntry;

    const items = threadItems([call, result], null);
    expect(items).toHaveLength(1);
    const assistant = items[0];
    if (assistant?.kind !== "assistant") throw new Error("expected an assistant item");
    expect(assistant.blocks).toEqual([
      {
        kind: "tool",
        key: "a1:0",
        name: "read",
        args: JSON.stringify({ path: "a.ts" }, null, 2),
        state: "ok",
        output: "file body",
      },
    ]);
  });

  it("marks an unanswered tool call running and a failed one failed", () => {
    const call = (id: string, callId: string) =>
      ({
        type: "message",
        id,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: callId, name: "bash", arguments: {} }],
        },
      }) as unknown as Session.SessionTreeEntry;
    const failure = {
      type: "message",
      id: "t1",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        isError: true,
        content: [{ type: "text", text: "boom" }],
      },
    } as unknown as Session.SessionTreeEntry;

    const items = threadItems([call("a1", "c1"), failure, call("a2", "c2")], null);
    const states = items.flatMap((item) =>
      item.kind === "assistant"
        ? item.blocks.map((block) => (block.kind === "tool" ? block.state : block.kind))
        : [],
    );
    expect(states).toEqual(["error", "running"]);
  });

  it("attaches a turn's git receipt after its settling entry", () => {
    const entries = [userEntry("u1", "change it"), assistantEntry("a1", "done")];
    const turns = [
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
    ] as unknown as Session.ChangesOutput["turns"];

    const items = threadItems(entries, null, turns);
    expect(items.map((item) => item.kind)).toEqual(["user", "assistant", "receipt"]);
    const receipt = items.at(-1);
    if (receipt?.kind !== "receipt") throw new Error("expected a receipt item");
    expect(receipt.files[0]?.file).toBe("src/index.ts");
  });

  it("omits receipts for turns that touched nothing", () => {
    const turns = [{ entryId: "a1", files: [] }] as unknown as Session.ChangesOutput["turns"];
    const items = threadItems([assistantEntry("a1", "just talk")], null, turns);
    expect(items.map((item) => item.kind)).toEqual(["assistant"]);
  });

  it("renders transcript markers as notices, not fabricated messages", () => {
    const modelChange = {
      type: "model_change",
      id: "m1",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    } as unknown as Session.SessionTreeEntry;
    const move = {
      type: "custom",
      id: "w1",
      customType: "honk.workspace_change",
      data: { directory: "/tmp/elsewhere" },
    } as unknown as Session.SessionTreeEntry;
    const label = { type: "label", id: "l1" } as unknown as Session.SessionTreeEntry;

    expect(threadItems([modelChange, move, label], null)).toEqual([
      { kind: "notice", id: "m1", text: "Model: anthropic/claude-sonnet-4-6" },
      { kind: "notice", id: "w1", text: "Moved to /tmp/elsewhere" },
    ]);
  });

  it("projects compaction with its summary for the divider", () => {
    const compaction = {
      type: "compaction",
      id: "c1",
      summary: "Earlier discussion about auth",
      tokensBefore: 52_000,
    } as unknown as Session.SessionTreeEntry;
    expect(threadItems([compaction], null)).toEqual([
      { kind: "compaction", id: "c1", summary: "Earlier discussion about auth", tokensBefore: 52_000 },
    ]);
  });

  it("appends the streaming message as a live assistant row with a stable id", () => {
    const streaming = {
      role: "assistant",
      timestamp: 1234,
      stopReason: "pending",
      content: [{ type: "text", text: "typing…" }],
    } as unknown as Parameters<typeof threadItems>[1];

    const items = threadItems([userEntry("u1", "Go")], streaming);
    const liveRow = items.at(-1);
    if (liveRow?.kind !== "assistant") throw new Error("expected a live assistant item");
    expect(liveRow.id).toBe("live:1234");
    expect(liveRow.live).toBe(true);
    expect(liveRow.blocks).toEqual([{ kind: "text", key: "live:1234:0", text: "typing…" }]);
  });

  it("handles plain string content", () => {
    const entry = {
      type: "message",
      id: "u1",
      message: { role: "user", content: "plain" },
    } as unknown as Session.SessionTreeEntry;
    expect(threadItems([entry], null)).toEqual([{ kind: "user", id: "u1", text: "plain" }]);
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
