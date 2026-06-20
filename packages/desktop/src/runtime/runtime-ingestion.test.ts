import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EventId,
  MessageId,
  RuntimeIngestionRecordId,
  RuntimeSessionId,
  ThreadEntryId,
  ThreadId,
  TurnId,
  type HonkRuntimeHostEvent,
  type RuntimeIngestionRecord,
} from "@honk/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __configureRuntimeIngestionForTests,
  __resetRuntimeIngestionForTests,
  ingestRuntimeHostEvent,
} from "./runtime-ingestion";

function fetchCallUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function fetchCallBody(init?: RequestInit): string {
  const body = init?.body;
  if (typeof body === "string") {
    return body;
  }
  if (body == null) {
    return "";
  }
  return JSON.stringify(body);
}

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

  it("dispatches canonical assistant completion records", async () => {
    const fetchMock = vi.mocked(fetch);
    const event: HonkRuntimeHostEvent = {
      type: "runtime-ingestion-records",
      records: [
        {
          recordId: RuntimeIngestionRecordId.make(
            "runtime-assistant:thread:ingestion:runtime:ingestion:runtime:assistant",
          ),
          threadId,
          runtimeSessionId,
          sourceEventId: "runtime:assistant",
          kind: "assistant.completion",
          createdAt: "2026-06-08T12:00:01.000Z",
          payload: {
            messageId: MessageId.make("runtime:runtime:ingestion:runtime:assistant"),
            text: "Hi there",
            turnId,
            parentEntryId: ThreadEntryId.make("thread-entry:user"),
          },
        },
      ],
    };

    ingestRuntimeHostEvent(event);
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => fetchCallUrl(url).endsWith("/api/runtime/ingest")),
      ).toBe(true),
    );

    const dispatchCall = fetchMock.mock.calls.find(([url]) =>
      fetchCallUrl(url).endsWith("/api/runtime/ingest"),
    );
    const body = JSON.parse(fetchCallBody(dispatchCall?.[1]));
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

  it("dispatches canonical tool activity records", async () => {
    const fetchMock = vi.mocked(fetch);
    const record: RuntimeIngestionRecord = {
      recordId: RuntimeIngestionRecordId.make(
        "runtime-tool:thread:ingestion:runtime:ingestion:runtime-activity:runtime-event:tool",
      ),
      sourceEventId: "runtime-event:tool",
      threadId,
      runtimeSessionId,
      createdAt,
      kind: "thread.activity",
      payload: {
        activity: {
          id: EventId.make("runtime-activity:runtime-event:tool"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Ran command",
          payload: {
            itemId: "toolu-1",
            itemType: "command_execution",
            status: "completed",
            title: "command",
            data: {
              toolName: "bash",
              toolCallId: "toolu-1",
              isError: false,
              result: {
                output: "done",
              },
            },
          },
          turnId,
          createdAt,
        },
      },
    };

    ingestRuntimeHostEvent({ type: "runtime-ingestion-records", records: [record] });
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => fetchCallUrl(url).endsWith("/api/runtime/ingest")),
      ).toBe(true),
    );

    const dispatchCall = fetchMock.mock.calls.find(([url]) =>
      fetchCallUrl(url).endsWith("/api/runtime/ingest"),
    );
    const body = JSON.parse(fetchCallBody(dispatchCall?.[1]));
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
    const contextRecord = (id: string, usedTokens: number): RuntimeIngestionRecord => ({
      recordId: RuntimeIngestionRecordId.make(
        `runtime-context-window:thread:ingestion:runtime:ingestion:${id}`,
      ),
      sourceEventId: id,
      threadId,
      runtimeSessionId,
      createdAt,
      kind: "thread.activity",
      payload: {
        activity: {
          id: EventId.make(`runtime-activity:${id}`),
          tone: "info",
          kind: "context-window.updated",
          summary: "Context usage updated",
          payload: {
            usedTokens,
            maxTokens: 1000,
          },
          turnId,
          createdAt,
        },
      },
    });
    const dispatchCalls = () =>
      fetchMock.mock.calls.filter(([url]) => fetchCallUrl(url).endsWith("/api/runtime/ingest"));
    const flushMicrotasks = async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    };

    ingestRuntimeHostEvent({
      type: "runtime-ingestion-records",
      records: [contextRecord("runtime-event:context-window-1", 100)],
    });
    await flushMicrotasks();

    await vi.waitFor(() => expect(dispatchCalls()).toHaveLength(1));

    ingestRuntimeHostEvent({
      type: "runtime-ingestion-records",
      records: [contextRecord("runtime-event:context-window-2", 200)],
    });
    ingestRuntimeHostEvent({
      type: "runtime-ingestion-records",
      records: [contextRecord("runtime-event:context-window-3", 300)],
    });
    await flushMicrotasks();

    expect(dispatchCalls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    const calls = dispatchCalls();
    expect(calls).toHaveLength(2);
    const trailingBody = JSON.parse(fetchCallBody(calls[1]?.[1]));
    expect(trailingBody.records).toMatchObject({
      0: {
        kind: "thread.activity",
        recordId:
          "runtime-context-window:thread:ingestion:runtime:ingestion:runtime-event:context-window-3",
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
                  recordId:
                    "runtime-tool:thread:ingestion:runtime:ingestion:runtime-activity:runtime-event:retry",
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

    const record: RuntimeIngestionRecord = {
      recordId: RuntimeIngestionRecordId.make(
        "runtime-tool:thread:ingestion:runtime:ingestion:runtime-activity:runtime-event:retry",
      ),
      sourceEventId: "runtime-event:retry",
      threadId,
      runtimeSessionId,
      createdAt,
      kind: "thread.activity",
      payload: {
        activity: {
          id: EventId.make("runtime-activity:runtime-event:retry"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Ran command",
          payload: {
            itemId: "toolu-retry",
            itemType: "command_execution",
            status: "completed",
            title: "command",
            data: {
              toolName: "bash",
              toolCallId: "toolu-retry",
              isError: false,
              result: {
                output: "done",
              },
            },
          },
          turnId,
          createdAt,
        },
      },
    };

    try {
      ingestRuntimeHostEvent({ type: "runtime-ingestion-records", records: [record] });

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
