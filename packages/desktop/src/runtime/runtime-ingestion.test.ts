import {
  CommandId,
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
        if (url.endsWith("/api/orchestration/dispatch")) {
          const headers = new Headers(init?.headers);
          expect(headers.get("authorization")).toBe("Bearer session-token");
          return new Response(JSON.stringify({ sequence: 1 }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    __resetRuntimeIngestionForTests();
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
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/orchestration/dispatch")),
      ).toBe(true),
    );

    const dispatchCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/orchestration/dispatch"),
    );
    const body = JSON.parse(String(dispatchCall?.[1]?.body));
    expect(body).toMatchObject({
      type: "thread.message.assistant.complete",
      commandId: CommandId.make(
        "runtime-assistant:thread:ingestion:runtime:ingestion:runtime:assistant",
      ),
      threadId,
      text: "Hi there",
      parentEntryId: ThreadEntryId.make("thread-entry:user"),
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
      },
    };

    ingestRuntimeHostEvent({ type: "runtime-event", event: runtimeEvent });
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/orchestration/dispatch")),
      ).toBe(true),
    );

    const dispatchCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/orchestration/dispatch"),
    );
    const body = JSON.parse(String(dispatchCall?.[1]?.body));
    expect(body).toMatchObject({
      type: "thread.activity.append",
      activity: {
        id: EventId.make("runtime-activity:runtime-event:tool"),
        kind: "tool.completed",
      },
    });
  });
});
