import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EventId,
  MessageId,
  RuntimeItemId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type AgentRuntimeEvent,
  type HonkRuntimeHostEvent,
} from "@honk/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __configureRuntimeIngestionForTests,
  __resetRuntimeIngestionForTests,
  ingestRuntimeHostEvent,
} from "./runtime-ingestion";

const threadId = ThreadId.make("thread:ingestion");
const runtimeSessionId = RuntimeSessionId.make("runtime:ingestion");
const turnId = TurnId.make("turn:ingestion");
const createdAt = "2026-06-08T12:00:00.000Z";

describe("runtime ingestion", () => {
  beforeEach(() => {
    __configureRuntimeIngestionForTests({
      httpBaseUrl: new URL("http://127.0.0.1:4242"),
      bootstrapToken: "desktop-bootstrap-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/api/auth/bootstrap")) {
          return new Response(
            JSON.stringify({
              authenticated: true,
              role: "owner",
              sessionMethod: "bearer-session-token",
              expiresAt: "2026-12-31T00:00:00.000Z",
              sessionToken: "session-token",
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/api/runtime/ingest")) {
          const headers = new Headers(init?.headers);
          expect(headers.get("authorization")).toBe("Bearer session-token");
          return new Response(JSON.stringify({ accepted: 1, acks: [] }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    __resetRuntimeIngestionForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("dispatches assistant complete commands for session-tree host events", async () => {
    const fetchMock = vi.mocked(fetch);
    const event: HonkRuntimeHostEvent = {
      type: "session-tree",
      tree: {
        threadId,
        runtimeSessionId,
        leafEntryId: RuntimeItemId.make("runtime:assistant"),
        entries: [
          {
            id: RuntimeItemId.make("runtime:user"),
            threadEntryId: ThreadEntryId.make("thread-entry:user"),
            parentId: null,
            parentThreadEntryId: null,
            kind: "message",
            role: "user",
            clientMessageId: MessageId.make("client:send-1"),
            turnId,
            text: "Hello",
            createdAt,
            rawEntry: { type: "message" },
          },
          {
            id: RuntimeItemId.make("runtime:assistant"),
            threadEntryId: ThreadEntryId.make("thread-entry:assistant"),
            parentId: RuntimeItemId.make("runtime:user"),
            parentThreadEntryId: ThreadEntryId.make("thread-entry:user"),
            kind: "message",
            role: "assistant",
            turnId,
            text: "Hi there",
            createdAt: "2026-06-08T12:00:01.000Z",
            rawEntry: { type: "message" },
          },
        ],
        nodes: [],
      },
    };

    ingestRuntimeHostEvent(event);
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/runtime/ingest")),
      ).toBe(true),
    );

    const dispatchCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/runtime/ingest"),
    );
    const body = JSON.parse(String(dispatchCall?.[1]?.body));
    expect(body.records).toMatchObject({
      0: {
        kind: "assistant.completion",
        recordId: "runtime-assistant:thread:ingestion:runtime:ingestion:runtime:assistant",
        threadId,
        payload: {
          text: "Hi there",
          parentEntryId: ThreadEntryId.make("thread-entry:user"),
        },
      },
    });
  });

  it("dispatches tool completed activity commands for runtime events", async () => {
    const fetchMock = vi.mocked(fetch);
    const runtimeEvent: AgentRuntimeEvent = {
      id: EventId.make("runtime-event:tool"),
      threadId,
      runtimeSessionId,
      turnId,
      agentRuntime: "pi",
      type: "tool.completed",
      summary: "Ran bash",
      createdAt,
      data: {
        toolName: "bash",
        toolCallId: "toolu-1",
        isError: false,
        result: {
          output: "done",
        },
      },
    };

    ingestRuntimeHostEvent({ type: "runtime-event", event: runtimeEvent });
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/runtime/ingest")),
      ).toBe(true),
    );

    const dispatchCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/runtime/ingest"),
    );
    const body = JSON.parse(String(dispatchCall?.[1]?.body));
    expect(body.records).toMatchObject({
      0: {
        kind: "thread.activity",
        payload: {
          activity: {
            id: EventId.make("runtime-activity:runtime-event:tool"),
            kind: "tool.completed",
            payload: {
              data: {
                toolName: "bash",
                toolCallId: "toolu-1",
                isError: false,
                result: {
                  output: "done",
                },
              },
            },
          },
        },
      },
    });
  });

  it("throttles persisted context-window updates to the latest trailing event", async () => {
    vi.useFakeTimers({ now: new Date("2026-06-08T12:00:00.000Z") });
    const fetchMock = vi.mocked(fetch);
    const contextEvent = (id: string, usedTokens: number): AgentRuntimeEvent => ({
      id: EventId.make(id),
      threadId,
      runtimeSessionId,
      turnId,
      agentRuntime: "pi",
      type: "context-window.updated",
      summary: "Context usage updated",
      createdAt,
      data: {
        usedTokens,
        maxTokens: 1000,
      },
    });
    const dispatchCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/runtime/ingest"));
    const flushMicrotasks = async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    };

    ingestRuntimeHostEvent({
      type: "runtime-event",
      event: contextEvent("runtime-event:context-window-1", 100),
    });
    await flushMicrotasks();

    await vi.waitFor(() => expect(dispatchCalls()).toHaveLength(1));

    ingestRuntimeHostEvent({
      type: "runtime-event",
      event: contextEvent("runtime-event:context-window-2", 200),
    });
    ingestRuntimeHostEvent({
      type: "runtime-event",
      event: contextEvent("runtime-event:context-window-3", 300),
    });
    await flushMicrotasks();

    expect(dispatchCalls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    const calls = dispatchCalls();
    expect(calls).toHaveLength(2);
    const trailingBody = JSON.parse(String(calls[1]?.[1]?.body));
    expect(trailingBody.records).toMatchObject({
      0: {
        kind: "thread.activity",
        recordId: "runtime-context-window:thread:ingestion:runtime:ingestion:runtime-event:context-window-3",
        payload: {
          activity: {
            id: EventId.make("runtime-activity:runtime-event:context-window-3"),
            kind: "context-window.updated",
            payload: {
              usedTokens: 300,
            },
          },
        },
      },
    });
  });

  it("keeps failed records in a durable outbox and retries them", async () => {
    vi.useFakeTimers({ now: new Date("2026-06-08T12:00:00.000Z") });
    const outboxDir = await mkdtemp(join(tmpdir(), "honk-runtime-outbox-"));
    const outboxPath = join(outboxDir, "runtime-records.json");
    __resetRuntimeIngestionForTests();
    __configureRuntimeIngestionForTests({
      httpBaseUrl: new URL("http://127.0.0.1:4242"),
      bootstrapToken: "desktop-bootstrap-token",
      runtimeRecordOutboxPath: outboxPath,
    });

    let ingestAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/api/auth/bootstrap")) {
          return new Response(
            JSON.stringify({
              authenticated: true,
              role: "owner",
              sessionMethod: "bearer-session-token",
              expiresAt: "2026-12-31T00:00:00.000Z",
              sessionToken: "session-token",
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/api/runtime/ingest")) {
          const headers = new Headers(init?.headers);
          expect(headers.get("authorization")).toBe("Bearer session-token");
          ingestAttempts += 1;
          if (ingestAttempts === 1) {
            return new Response(JSON.stringify({ error: "backend down" }), { status: 503 });
          }
          return new Response(
            JSON.stringify({
              accepted: 1,
              acks: [
                {
                  recordId: "runtime-tool:thread:ingestion:runtime:ingestion:runtime-activity:runtime-event:retry",
                  sequence: 7,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const runtimeEvent: AgentRuntimeEvent = {
      id: EventId.make("runtime-event:retry"),
      threadId,
      runtimeSessionId,
      turnId,
      agentRuntime: "pi",
      type: "tool.completed",
      summary: "Ran bash",
      createdAt,
      data: {
        toolName: "bash",
        toolCallId: "toolu-retry",
        isError: false,
        result: {
          output: "done",
        },
      },
    };

    try {
      ingestRuntimeHostEvent({ type: "runtime-event", event: runtimeEvent });

      await vi.waitFor(() => expect(ingestAttempts).toBe(1));
      const failedOutbox = JSON.parse(await readFile(outboxPath, "utf8"));
      expect(failedOutbox).toMatchObject([
        {
          attempts: 1,
          status: "failed",
          lastError: "backend down",
        },
      ]);

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(ingestAttempts).toBe(2));
      const ackedOutbox = JSON.parse(await readFile(outboxPath, "utf8"));
      expect(ackedOutbox).toMatchObject([
        {
          attempts: 2,
          status: "acked",
          ackSequence: 7,
        },
      ]);
    } finally {
      await rm(outboxDir, { recursive: true, force: true });
    }
  });
});
