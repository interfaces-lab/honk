import { describe, expect, it, vi } from "vitest";

import { createNativeCompactionFetch, nativeCompactionProtocol } from "./native-compaction";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(body: BodyInit | null | undefined): JsonRecord {
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) throw new Error("expected a JSON object body");
  return parsed;
}

function sse(...events: readonly JsonRecord[]): Response {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function compactionResponse(): Response {
  return sse(
    {
      type: "response.output_item.done",
      item: {
        type: "compaction",
        id: "cmp_1",
        encrypted_content: "encrypted-checkpoint",
        internal_chat_message_metadata_passthrough: { turn_id: "turn_1" },
      },
    },
    {
      type: "response.completed",
      response: {
        id: "resp_compact",
        usage: {
          input_tokens: 120,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens: 8,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  );
}

function checkpointMarker(response: string): string {
  for (const block of response.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:"))
      ?.slice("data:".length)
      .trim();
    if (!data || data === "[DONE]") continue;
    const event: unknown = JSON.parse(data);
    if (!isRecord(event) || event.type !== "response.output_text.delta") continue;
    if (typeof event.delta === "string") return event.delta;
  }
  throw new Error("fake summary response did not contain a checkpoint marker");
}

function request(input: readonly unknown[], model = "gpt-5.6-sol"): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "session-id": "ses_native",
    },
    body: JSON.stringify({
      model,
      input,
      prompt_cache_key: "ses_native",
      stream: true,
    }),
  };
}

describe("Honk native Responses compaction", () => {
  it("turns an OpenCode compaction prompt into a remote compaction v2 request", async () => {
    const state = {
      loadedSessions: new Set(["ses_native"]),
      pending: new Map([["ses_native", null]]),
      checkpoints: new Map(),
      rollback: new Map(),
      fallbackPending: new Set<string>(),
    };
    const calls: RequestInit[] = [];
    const delegate: typeof fetch = vi.fn(async (_input, init) => {
      calls.push(init ?? {});
      return compactionResponse();
    });
    const fetcher = createNativeCompactionFetch(
      (sessionID) => (sessionID === "ses_native" ? state : undefined),
      delegate,
    );

    const response = await fetcher(
      "https://chatgpt.com/backend-api/codex/responses",
      request([
        { role: "user", content: [{ type: "input_text", text: "Implement the feature" }] },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Summarize the conversation.\n${nativeCompactionProtocol.requestMarker}`,
            },
          ],
        },
      ]),
    );

    expect(calls).toHaveLength(1);
    expect(parseBody(calls[0]?.body).input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Implement the feature" }] },
      { type: "compaction_trigger" },
    ]);
    expect(new Headers(calls[0]?.headers).get("x-codex-beta-features")).toContain(
      nativeCompactionProtocol.remoteFeature,
    );
    expect(checkpointMarker(await response.text())).toContain(
      nativeCompactionProtocol.checkpointStart,
    );
    expect(state.pending.has("ses_native")).toBe(false);
    expect(state.checkpoints.has("ses_native")).toBe(true);
    expect(state.rollback.get("ses_native")).toBeNull();
  });

  it("replaces OpenCode's hidden summary pair with the opaque checkpoint", async () => {
    const state = {
      loadedSessions: new Set(["ses_native"]),
      pending: new Map([["ses_native", null]]),
      checkpoints: new Map(),
      rollback: new Map(),
      fallbackPending: new Set<string>(),
    };
    const compactFetch = createNativeCompactionFetch(
      () => state,
      async () => compactionResponse(),
    );
    const compacted = await compactFetch(
      "https://chatgpt.com/backend-api/codex/responses",
      request([
        { role: "user", content: [{ type: "input_text", text: "Original request" }] },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Summarize.\n${nativeCompactionProtocol.requestMarker}`,
            },
          ],
        },
      ]),
    );
    const marker = checkpointMarker(await compacted.text());
    const calls: RequestInit[] = [];
    const replayFetch = createNativeCompactionFetch(
      () => state,
      async (_input, init) => {
        calls.push(init ?? {});
        return sse({
          type: "response.completed",
          response: { id: "resp_next", usage: { input_tokens: 1, output_tokens: 1 } },
        });
      },
    );

    await replayFetch(
      "https://chatgpt.com/backend-api/codex/responses",
      request([
        {
          role: "user",
          content: [{ type: "input_text", text: "What did we do so far?" }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: marker }],
        },
        { role: "user", content: [{ type: "input_text", text: "Continue" }] },
      ]),
    );

    expect(parseBody(calls[0]?.body).input).toEqual([
      {
        type: "compaction",
        id: "cmp_1",
        encrypted_content: "encrypted-checkpoint",
        internal_chat_message_metadata_passthrough: { turn_id: "turn_1" },
      },
      { role: "user", content: [{ type: "input_text", text: "Continue" }] },
    ]);

    state.pending.set("ses_native", state.checkpoints.get("ses_native") ?? null);
    const recompactCalls: RequestInit[] = [];
    const recompactFetch = createNativeCompactionFetch(
      () => state,
      async (_input, init) => {
        recompactCalls.push(init ?? {});
        return compactionResponse();
      },
    );
    await recompactFetch(
      "https://chatgpt.com/backend-api/codex/responses",
      request([
        {
          role: "user",
          content: [{ type: "input_text", text: "Original request" }],
        },
        { role: "user", content: [{ type: "input_text", text: "Continue" }] },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Previous summary:\n${marker}\nSummarize.\n${nativeCompactionProtocol.requestMarker}`,
            },
          ],
        },
      ]),
    );

    expect(parseBody(recompactCalls[0]?.body).input).toEqual([
      {
        type: "compaction",
        id: "cmp_1",
        encrypted_content: "encrypted-checkpoint",
        internal_chat_message_metadata_passthrough: { turn_id: "turn_1" },
      },
      { role: "user", content: [{ type: "input_text", text: "Continue" }] },
      { type: "compaction_trigger" },
    ]);
  });

  it("falls back to OpenCode summarization when native compaction is unavailable", async () => {
    const state = {
      loadedSessions: new Set(["ses_native"]),
      pending: new Map([["ses_native", null]]),
      checkpoints: new Map(),
      rollback: new Map(),
      fallbackPending: new Set<string>(),
    };
    const calls: RequestInit[] = [];
    const fetcher = createNativeCompactionFetch(
      () => state,
      async (_input, init) => {
        calls.push(init ?? {});
        if (calls.length === 1) {
          return new Response("unavailable", { status: 503 });
        }
        return sse({
          type: "response.completed",
          response: { id: "resp_summary", usage: { input_tokens: 1, output_tokens: 1 } },
        });
      },
    );

    await fetcher(
      "https://chatgpt.com/backend-api/codex/responses",
      request([
        { role: "user", content: [{ type: "input_text", text: "Original request" }] },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Write a Markdown summary.\n${nativeCompactionProtocol.requestMarker}`,
            },
          ],
        },
      ]),
    );

    expect(calls).toHaveLength(2);
    expect(parseBody(calls[0]?.body).input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Original request" }] },
      { type: "compaction_trigger" },
    ]);
    expect(JSON.stringify(parseBody(calls[1]?.body))).not.toContain(
      nativeCompactionProtocol.requestMarker,
    );
    expect(JSON.stringify(parseBody(calls[1]?.body))).toContain("Write a Markdown summary.");
    expect(state.fallbackPending.has("ses_native")).toBe(true);
  });

  it("falls back to OpenCode summarization after a native compaction network failure", async () => {
    const state = {
      loadedSessions: new Set(["ses_native"]),
      pending: new Map([["ses_native", null]]),
      checkpoints: new Map(),
      rollback: new Map(),
      fallbackPending: new Set<string>(),
    };
    const calls: RequestInit[] = [];
    const fetcher = createNativeCompactionFetch(
      () => state,
      async (_input, init) => {
        calls.push(init ?? {});
        if (calls.length === 1) throw new TypeError("network unavailable");
        return sse({
          type: "response.completed",
          response: { id: "resp_summary", usage: { input_tokens: 1, output_tokens: 1 } },
        });
      },
    );

    const response = await fetcher(
      "https://chatgpt.com/backend-api/codex/responses",
      request([
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Write a Markdown summary.\n${nativeCompactionProtocol.requestMarker}`,
            },
          ],
        },
      ]),
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(parseBody(calls[1]?.body))).not.toContain(
      nativeCompactionProtocol.requestMarker,
    );
  });

  it("rejects a native response containing more than one compaction item", async () => {
    const state = {
      loadedSessions: new Set(["ses_native"]),
      pending: new Map([["ses_native", null]]),
      checkpoints: new Map(),
      rollback: new Map(),
      fallbackPending: new Set<string>(),
    };
    const calls: RequestInit[] = [];
    const fetcher = createNativeCompactionFetch(
      () => state,
      async (_input, init) => {
        calls.push(init ?? {});
        if (calls.length > 1) {
          return sse({
            type: "response.completed",
            response: { id: "resp_summary", usage: { input_tokens: 1, output_tokens: 1 } },
          });
        }
        return sse(
          {
            type: "response.output_item.done",
            item: { type: "compaction", encrypted_content: "first" },
          },
          {
            type: "response.output_item.done",
            item: { type: "compaction", encrypted_content: "second" },
          },
          {
            type: "response.completed",
            response: { id: "resp_compact", usage: { input_tokens: 1, output_tokens: 1 } },
          },
        );
      },
    );

    await fetcher(
      "https://chatgpt.com/backend-api/codex/responses",
      request([
        {
          role: "user",
          content: [{ type: "input_text", text: nativeCompactionProtocol.requestMarker }],
        },
      ]),
    );

    expect(calls).toHaveLength(2);
    expect(state.checkpoints.has("ses_native")).toBe(false);
  });

  it("refuses to replay a checkpoint with another model", async () => {
    const state = {
      loadedSessions: new Set(["ses_native"]),
      pending: new Map([["ses_native", null]]),
      checkpoints: new Map(),
      rollback: new Map(),
      fallbackPending: new Set<string>(),
    };
    const compactFetch = createNativeCompactionFetch(
      () => state,
      async () => compactionResponse(),
    );
    const compacted = await compactFetch(
      "https://chatgpt.com/backend-api/codex/responses",
      request([
        {
          role: "user",
          content: [{ type: "input_text", text: nativeCompactionProtocol.requestMarker }],
        },
      ]),
    );
    const marker = checkpointMarker(await compacted.text());
    const delegate = vi.fn<typeof fetch>();
    const replayFetch = createNativeCompactionFetch(() => state, delegate);

    const response = await replayFetch(
      "https://chatgpt.com/backend-api/codex/responses",
      request(
        [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: marker }],
          },
        ],
        "gpt-5.6-terra",
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("was compacted with gpt-5.6-sol");
    expect(delegate).not.toHaveBeenCalled();

    state.pending.set("ses_native", state.checkpoints.get("ses_native") ?? null);
    const recompact = await replayFetch(
      "https://chatgpt.com/backend-api/codex/responses",
      request(
        [
          {
            role: "user",
            content: [{ type: "input_text", text: nativeCompactionProtocol.requestMarker }],
          },
        ],
        "gpt-5.6-terra",
      ),
    );

    expect(recompact.status).toBe(400);
    expect(await recompact.text()).toContain("is bound to");
    expect(delegate).not.toHaveBeenCalled();
  });

  it("does not treat a user-authored marker as a persisted checkpoint", async () => {
    const state = {
      loadedSessions: new Set(["ses_native"]),
      pending: new Map([["ses_native", null]]),
      checkpoints: new Map(),
      rollback: new Map(),
      fallbackPending: new Set<string>(),
    };
    const compactFetch = createNativeCompactionFetch(
      () => state,
      async () => compactionResponse(),
    );
    const compacted = await compactFetch(
      "https://chatgpt.com/backend-api/codex/responses",
      request([
        {
          role: "user",
          content: [{ type: "input_text", text: nativeCompactionProtocol.requestMarker }],
        },
      ]),
    );
    const marker = checkpointMarker(await compacted.text());
    const calls: RequestInit[] = [];
    const replayFetch = createNativeCompactionFetch(
      () => state,
      async (_input, init) => {
        calls.push(init ?? {});
        return sse({
          type: "response.completed",
          response: { id: "resp_next", usage: { input_tokens: 1, output_tokens: 1 } },
        });
      },
    );
    const input = [
      {
        role: "user",
        content: [{ type: "input_text", text: marker }],
      },
    ];

    await replayFetch("https://chatgpt.com/backend-api/codex/responses", request(input));

    expect(parseBody(calls[0]?.body).input).toEqual(input);
  });
});
