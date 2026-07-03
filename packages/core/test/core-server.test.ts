import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Effect, Fiber, Layer, Queue, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import WebSocket from "ws";
import {
  decodeThreadStreamEvent,
  HonkApi,
  MessageId,
  ModelId,
  QuestionId,
  ThreadId,
  TurnId,
  type ThreadStreamEvent,
} from "@honk/api/core/v1";
import { makeAuth } from "../src/auth";
import { makeCheckpoints } from "../src/checkpoint";
import { makeCore } from "../src/core";
import type { Harness } from "../src/harness";
import { resolveCoreHome } from "../src/home";
import { boundPort, makeServerLayer } from "../src/server";
import { makeSessions } from "../src/session";
import { makeTerminals } from "../src/terminal";

/**
 * The scaffold echo Harness, now a test fixture (grill 2026-07-02): streams
 * the user text back word by word, draining the Steer mailbox between words.
 * Marker texts exercise specific seams — "wait for steer" BLOCKS on the
 * mailbox (the awaitable seam), "slow abort" holds settlement open through a
 * slow interrupt finalizer (the supersede window), "deaf:" never drains (the
 * leftover-steer rule). The first part's metadata snapshots the TurnContext
 * facts under test, and every completed turn honors the continuity contract
 * (setSessionRef once, setTurnLeaf per turn) like a real harness. It runs as
 * the openai-codex arm purely so creation-time catalog validation has a real
 * provider to pin.
 */
const echoHarness: Harness = {
  capabilities: { steer: true },
  runTurn: (ctx) =>
    Effect.gen(function* () {
      const partId = ctx.newPartId();
      yield* ctx.createPart({
        _tag: "text",
        id: partId,
        messageId: ctx.assistantMessageId,
        turnId: ctx.turnId,
        origin: "honk",
        state: "active",
        text: "",
        metadata: {
          mode: ctx.interactionMode,
          images: ctx.images.length,
          resumeLeaf: ctx.resumeLeaf,
          hadSessionRef: ctx.sessionRef !== null,
        },
      });
      if (ctx.userText === "wait for steer") {
        const steered = yield* Queue.take(ctx.steered);
        const suffix = steered.images.length > 0 ? ` +${steered.images.length}img` : "";
        yield* ctx.appendDelta(partId, "text", `steered: ${steered.text}${suffix}`);
      } else if (ctx.userText === "slow abort") {
        yield* Effect.never.pipe(Effect.onInterrupt(() => Effect.sleep(150)));
      } else {
        const deaf = ctx.userText.startsWith("deaf:");
        const words = `Echo: ${ctx.userText}`.split(" ");
        for (let index = 0; index < words.length; index++) {
          const word = index === 0 ? words[index] : ` ${words[index]}`;
          yield* ctx.appendDelta(partId, "text", word ?? "");
          yield* Effect.sleep(25);
          if (deaf) continue;
          const steered = yield* Queue.clear(ctx.steered);
          for (const item of steered) {
            yield* ctx.appendDelta(partId, "text", ` (steered: ${item.text})`);
          }
        }
      }
      yield* ctx.completePart(partId);
      if (ctx.sessionRef === null) {
        yield* ctx.setSessionRef(`echo/${String(ctx.threadId)}`);
      }
      yield* ctx.setTurnLeaf(`leaf_${String(ctx.turnId)}`);
    }),
};

const PINNED_MODEL = ModelId.make("openai-codex/gpt-5.5");

/** A test Core: echo behind the openai-codex arm, with a stored (never validated) credential so the route is available. */
const makeTestCore = (home: string) => {
  const coreHome = resolveCoreHome(home);
  const auth = makeAuth(coreHome);
  auth.storage.set("openai-codex", { type: "api_key", key: "test-key" });
  return makeCore(coreHome, auth, { "openai-codex": echoHarness }, makeCheckpoints());
};

const tempHome = mkdtempSync(join(tmpdir(), "honk-core-test-"));
const core = makeTestCore(tempHome);
let coreOrigin: string | null = null;
const sessions = makeSessions(resolveCoreHome(tempHome), core.store, () => coreOrigin);
sessions.publishSecret();
const coreAppSecret = readFileSync(sessions.secretPath, "utf8");
const terminals = makeTerminals();
afterAll(async () => {
  await Effect.runPromise(terminals.dispose());
  rmSync(tempHome, { recursive: true, force: true });
});

const ServerLive = makeServerLayer(core, sessions, terminals, { port: 0 });
const TestLayer = Layer.mergeAll(ServerLive, FetchHttpClient.layer);

type Client = HttpApiClient.ForApi<typeof HonkApi>;

const makeApiClient = (baseUrl: string, bearer: string | null) =>
  bearer === null
    ? HttpApiClient.make(HonkApi, { baseUrl })
    : HttpApiClient.make(HonkApi, {
        baseUrl,
        transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(bearer)),
      });

const withBearer = <A, E>(
  bearer: string | null,
  f: (client: Client, baseUrl: string) => Effect.Effect<A, E, HttpClient.HttpClient>,
) =>
  Effect.gen(function* () {
    const port = yield* boundPort;
    const baseUrl = `http://127.0.0.1:${port}`;
    coreOrigin = baseUrl;
    const client = yield* makeApiClient(baseUrl, bearer);
    return yield* f(client, baseUrl);
  }).pipe(Effect.provide(TestLayer), Effect.runPromise);

const withClient = <A, E>(
  f: (client: Client, baseUrl: string) => Effect.Effect<A, E, HttpClient.HttpClient>,
) => withBearer(coreAppSecret, f);

const toWebSocketUrl = (baseUrl: string, ticket: string): string =>
  `${baseUrl.replace(/^http/, "ws")}/core/v1/terminals/attach?ticket=${encodeURIComponent(ticket)}`;

const rawDataToString = (data: WebSocket.RawData): string => {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
};

const terminalFrameData = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) return null;
  const frame = value as { readonly type?: unknown; readonly data?: unknown };
  if ((frame.type === "output" || frame.type === "history") && typeof frame.data === "string") {
    return frame.data;
  }
  return null;
};

const openTerminalSocket = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let timeout: ReturnType<typeof setTimeout>;
    let cleanup = () => {};
    const onOpen = () => {
      cleanup();
      resolve(ws);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    timeout = setTimeout(() => {
      cleanup();
      ws.terminate();
      reject(new Error("terminal websocket open timed out"));
    }, 3_000);
    cleanup = () => {
      clearTimeout(timeout);
      ws.off("open", onOpen);
      ws.off("error", onError);
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
  });

const closeTerminalSocket = (ws: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    let timeout: ReturnType<typeof setTimeout>;
    let cleanup = () => {};
    const onClose = () => {
      cleanup();
      resolve();
    };
    timeout = setTimeout(() => {
      cleanup();
      ws.terminate();
      resolve();
    }, 1_000);
    cleanup = () => {
      clearTimeout(timeout);
      ws.off("close", onClose);
    };
    ws.once("close", onClose);
    ws.close();
  });

const waitForRejectedTerminalSocket = (url: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let timeout: ReturnType<typeof setTimeout>;
    let cleanup = () => {};
    const onClose = (code: number) => {
      cleanup();
      resolve(code);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    timeout = setTimeout(() => {
      cleanup();
      ws.terminate();
      reject(new Error("terminal websocket close timed out"));
    }, 3_000);
    cleanup = () => {
      clearTimeout(timeout);
      ws.off("close", onClose);
      ws.off("error", onError);
    };
    ws.once("close", onClose);
    ws.once("error", onError);
  });

const waitForTerminalOutput = (ws: WebSocket, expected: string): Promise<string> =>
  new Promise((resolve, reject) => {
    let output = "";
    let timeout: ReturnType<typeof setTimeout>;
    let cleanup = () => {};
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const frameData = terminalFrameData(JSON.parse(rawDataToString(data)));
        if (frameData === null) return;
        output += frameData;
        if (!output.includes(expected)) return;
        cleanup();
        resolve(output);
      } catch {
        return;
      }
    };
    const onClose = (code: number) => {
      cleanup();
      reject(new Error(`terminal websocket closed before output: ${code}`));
    };
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`terminal output timed out waiting for ${expected}`));
    }, 5_000);
    cleanup = () => {
      clearTimeout(timeout);
      ws.off("message", onMessage);
      ws.off("close", onClose);
    };
    ws.on("message", onMessage);
    ws.once("close", onClose);
  });

const createPayload = (threadId: ThreadId, home: string, extra?: Record<string, unknown>) => ({
  threadId,
  cwd: home,
  model: PINNED_MODEL,
  ...extra,
});

const waitForIdle = (client: Client, threadId: ThreadId, queueLength = 0) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i++) {
      const detail = yield* client.threads.get({ params: { threadId } });
      if (detail.summary.status === "idle" && detail.queue.length === queueLength) return detail;
      yield* Effect.sleep(25);
    }
    return yield* Effect.die(new Error("thread never settled"));
  });

/** Read SSE frames, decoding each data: line fail-closed, until the predicate matches. */
const collectEvents = (
  response: { readonly stream: Stream.Stream<Uint8Array, unknown> },
  until: (event: ThreadStreamEvent) => boolean,
) =>
  Effect.gen(function* () {
    const events: Array<ThreadStreamEvent> = [];
    let buffer = "";
    yield* response.stream.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          buffer += chunk;
          let index = buffer.indexOf("\n\n");
          while (index !== -1) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (frame.startsWith("data: ")) {
              const event = decodeThreadStreamEvent(JSON.parse(frame.slice(6)));
              events.push(event);
              if (until(event)) return yield* Effect.fail("done" as const);
            }
            index = buffer.indexOf("\n\n");
          }
        }),
      ),
      // "done" ends collection; stream teardown races are equally terminal.
      Effect.catch(() => Effect.void),
    );
    return events;
  });

const collectEventsUntilEnd = (response: { readonly stream: Stream.Stream<Uint8Array, unknown> }) =>
  Effect.gen(function* () {
    const events: Array<ThreadStreamEvent> = [];
    let buffer = "";
    yield* response.stream.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Effect.sync(() => {
          buffer += chunk;
          let index = buffer.indexOf("\n\n");
          while (index !== -1) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (frame.startsWith("data: ")) {
              events.push(decodeThreadStreamEvent(JSON.parse(frame.slice(6))));
            }
            index = buffer.indexOf("\n\n");
          }
        }),
      ),
    );
    return events;
  });

const textParts = (detail: { parts: ReadonlyArray<{ _tag: string }> }) =>
  detail.parts.flatMap((part) =>
    part._tag === "text"
      ? [part as { _tag: "text"; text: string; metadata?: Record<string, unknown> }]
      : [],
  );

describe("@honk/core end-to-end", () => {
  it("serves health for the discovery probe", async () => {
    const health = await withClient((client) => client.meta.health());
    expect(health.apiVersion).toBe("core/v1");
    expect(health.pid).toBe(process.pid);
  });

  it("rejects unauthenticated protected requests", async () => {
    const error = await withBearer(null, (client) =>
      client.threads.list({ query: { archived: false } }).pipe(Effect.flip),
    );
    expect(error).toMatchObject({ _tag: "UnauthorizedError" });
  });

  it("rejects unauthenticated terminal creation", async () => {
    const error = await withBearer(null, (client) =>
      client.terminals.create({ payload: { cwd: tempHome } }).pipe(Effect.flip),
    );
    expect(error).toMatchObject({ _tag: "UnauthorizedError" });
  });

  it("attaches to a terminal with a single-use ticket over WebSocket", async () => {
    // The whole socket exchange stays INSIDE one withClient scope: withClient
    // builds and finalizes its own server layer per call, so the ephemeral port
    // is gone the moment the block resolves. Opening the WS afterward would hit
    // a torn-down server (ECONNREFUSED).
    await withClient((client, baseUrl) =>
      Effect.gen(function* () {
        const terminal = yield* client.terminals.create({
          payload: { cwd: tempHome, title: "pty test", cols: 80, rows: 24 },
        });
        const ticket = yield* client.terminals.ticket({ params: { terminalId: terminal.id } });
        const url = toWebSocketUrl(baseUrl, ticket.ticket);

        const output = yield* Effect.promise(async () => {
          const ws = await openTerminalSocket(url);
          try {
            ws.send(JSON.stringify({ type: "write", data: "echo hi\r" }));
            return await waitForTerminalOutput(ws, "hi");
          } finally {
            await closeTerminalSocket(ws);
          }
        });
        expect(output).toContain("hi");

        const reusedCode = yield* Effect.promise(() => waitForRejectedTerminalSocket(url));
        expect(reusedCode).toBe(4401);
        yield* client.terminals.close({ params: { terminalId: terminal.id } }).pipe(Effect.ignore);
      }),
    );
  });

  it("pairs a web session, restricts it, revokes it, and rejects consumed tokens", async () => {
    const result = await withClient((client, baseUrl) =>
      Effect.gen(function* () {
        const pairing = yield* client.sessions.pair();
        expect(pairing.url).toBe(`${baseUrl}/#token=${pairing.token}`);
        const grant = yield* client.pairing.exchange({ payload: { token: pairing.token } });
        const consumed = yield* client.pairing
          .exchange({ payload: { token: pairing.token } })
          .pipe(Effect.flip);
        const unknown = yield* client.pairing
          .exchange({ payload: { token: "unknown-token" } })
          .pipe(Effect.flip);
        const webClient = yield* makeApiClient(baseUrl, grant.bearer);
        const auth = yield* webClient.auth.get();
        const logout = yield* webClient.auth
          .logout({ payload: { kind: "codex-oauth" } })
          .pipe(Effect.flip);
        const list = yield* webClient.sessions.list().pipe(Effect.flip);
        yield* Effect.sync(() => console.error("[t] revoking"));
        yield* client.sessions.revoke({ params: { sessionId: grant.session.id } });
        yield* Effect.sync(() => console.error("[t] revoked, sending"));
        const revoked = yield* webClient.auth.get().pipe(Effect.flip);
        return { grant, consumed, unknown, webResult: { auth, logout, list }, revoked };
      }),
    );
    expect(result.grant.session.role).toBe("web");
    expect(result.consumed).toMatchObject({ _tag: "UnauthorizedError" });
    expect(result.unknown).toMatchObject({ _tag: "UnauthorizedError" });
    expect(result.webResult.auth.flow).toBeNull();
    expect(result.webResult.logout).toMatchObject({ _tag: "ForbiddenError" });
    expect(result.webResult.list).toMatchObject({ _tag: "ForbiddenError" });
    expect(result.revoked).toMatchObject({ _tag: "UnauthorizedError" });
  });

  it("keeps multiple pending pairing tokens exchangeable", async () => {
    const result = await withClient((client) =>
      Effect.gen(function* () {
        const first = yield* client.sessions.pair();
        const second = yield* client.sessions.pair();
        const firstGrant = yield* client.pairing.exchange({ payload: { token: first.token } });
        const secondGrant = yield* client.pairing.exchange({ payload: { token: second.token } });
        const consumed = yield* client.pairing
          .exchange({ payload: { token: first.token } })
          .pipe(Effect.flip);
        yield* client.sessions.revoke({ params: { sessionId: firstGrant.session.id } });
        yield* client.sessions.revoke({ params: { sessionId: secondGrant.session.id } });
        return { firstGrant, secondGrant, consumed };
      }),
    );
    expect(result.firstGrant.session.role).toBe("web");
    expect(result.secondGrant.session.role).toBe("web");
    expect(result.secondGrant.session.id).not.toBe(result.firstGrant.session.id);
    expect(result.consumed).toMatchObject({ _tag: "UnauthorizedError" });
  });

  it("rejects expired web sessions", async () => {
    const result = await withClient((client, baseUrl) =>
      Effect.gen(function* () {
        const pairing = yield* client.sessions.pair();
        const grant = yield* client.pairing.exchange({ payload: { token: pairing.token } });
        core.store.setSessionExpiresAt(
          String(grant.session.id),
          new Date(Date.now() - 1_000).toISOString(),
        );
        const webClient = yield* makeApiClient(baseUrl, grant.bearer);
        return yield* webClient.auth.get().pipe(Effect.flip);
      }),
    );
    expect(result).toMatchObject({ _tag: "UnauthorizedError" });
  });

  it("creates a thread idempotently, pins levels, and conflicts on drift", async () => {
    const threadId = ThreadId.make("thread_create_test");
    const input = createPayload(threadId, tempHome, { title: "hello" });
    const result = await withClient((client) =>
      Effect.gen(function* () {
        const first = yield* client.threads.create({ payload: input });
        const replay = yield* client.threads.create({ payload: input });
        const conflict = yield* client.threads
          .create({ payload: { ...input, title: "different" } })
          .pipe(Effect.flip);
        const pinnedLow = yield* client.threads.create({
          payload: createPayload(ThreadId.make("thread_create_low"), tempHome, {
            thinkingLevel: "low" as const,
          }),
        });
        return { first, replay, conflict, pinnedLow };
      }),
    );
    expect(result.first.title).toBe("hello");
    expect(String(result.first.model)).toBe("openai-codex/gpt-5.5");
    // gpt-5.5 offers low/high only; omitting the level pins the model's default.
    expect(result.first.thinkingLevel).toBe("high");
    expect(result.pinnedLow.thinkingLevel).toBe("low");
    expect(result.replay).toEqual(result.first);
    expect(result.conflict).toMatchObject({ _tag: "ThreadConflictError" });
  });

  /** The enforcement point of the fetch-only catalog (ADR 0016; grill 2026-07-02). */
  it("rejects creation for unknown models, bad pairs, and route-less providers", async () => {
    const result = await withClient((client) =>
      Effect.gen(function* () {
        const unknown = yield* client.threads
          .create({
            payload: { cwd: tempHome, model: ModelId.make("openai-codex/gpt-2") },
          })
          .pipe(Effect.flip);
        const badPair = yield* client.threads
          .create({
            payload: { cwd: tempHome, model: PINNED_MODEL, thinkingLevel: "off" as const },
          })
          .pipe(Effect.flip);
        // Fable 5 is in the catalog, but the claude-code arm lands in its own
        // round — and it is also the catalog default, so omitting the model
        // discovers the same reality (a stale picker's typed rejection).
        const noRoute = yield* client.threads
          .create({
            payload: { cwd: tempHome, model: ModelId.make("anthropic/claude-fable-5") },
          })
          .pipe(Effect.flip);
        const defaulted = yield* client.threads
          .create({ payload: { cwd: tempHome } })
          .pipe(Effect.flip);
        return { unknown, badPair, noRoute, defaulted };
      }),
    );
    expect(result.unknown).toMatchObject({
      _tag: "ModelUnavailableError",
      reason: "unknown-model",
    });
    expect(result.badPair).toMatchObject({
      _tag: "ModelUnavailableError",
      reason: "unsupported-thinking-level",
    });
    expect(result.noRoute).toMatchObject({
      _tag: "ModelUnavailableError",
      reason: "no-available-route",
    });
    expect(result.defaulted).toMatchObject({
      _tag: "ModelUnavailableError",
      reason: "no-available-route",
    });
  });

  it("filters archived threads out of the default list", async () => {
    const threadId = ThreadId.make("thread_archive_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.threads.archive({ params: { threadId } });
        const active = yield* client.threads.list({ query: { archived: false } });
        const archived = yield* client.threads.list({ query: { archived: true } });
        return { active, archived };
      }),
    );
    expect(result.active.threads.map((thread) => thread.id)).not.toContain(threadId);
    expect(result.archived.threads.map((thread) => thread.id)).toContain(threadId);
  });

  it("runs a full turn: admit, stream parts over SSE, settle, paint from snapshot", async () => {
    const threadId = ThreadId.make("thread_turn_test");
    const messageId = MessageId.make("msg_turn_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        const receipt = yield* client.messages.send({
          params: { threadId },
          payload: { messageId, text: "hello world" },
        });
        const watch = yield* client.threads.watchThread({
          params: { threadId },
          query: { after: 0 },
          responseMode: "response-only",
        });
        const events = yield* collectEvents(watch, (event) => event._tag === "turn.settled");
        const detail = yield* waitForIdle(client, threadId);
        return { receipt, events, detail };
      }),
    );
    expect(result.receipt.disposition).toBe("started");
    expect(result.receipt.turnId).not.toBeNull();
    const tags = result.events.map((event) => event._tag);
    expect(tags).toContain("message.created");
    expect(tags).toContain("turn.started");
    expect(tags).toContain("part.created");
    expect(tags).toContain("part.delta");
    expect(tags).toContain("part.completed");
    expect(tags[tags.length - 1]).toBe("turn.settled");
    const seqs = result.events.map((event) => event.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const texts = textParts(result.detail).map((part) => part.text);
    // The user's text is itself a Part attached to the user message (the
    // Message row carries no text — ADR 0013 raw-text wire).
    expect(texts).toContain("hello world");
    expect(texts).toContain("Echo: hello world");
    expect(result.detail.summary.status).toBe("idle");
    expect(result.detail.messages).toHaveLength(2);
  });

  it("ends an open web watch stream when its session is revoked", async () => {
    const threadId = ThreadId.make("thread_revoked_watch_test");
    const events = await withClient((client, baseUrl) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        const pairing = yield* client.sessions.pair();
        const grant = yield* client.pairing.exchange({ payload: { token: pairing.token } });
        const webClient = yield* makeApiClient(baseUrl, grant.bearer);
        const watch = yield* webClient.threads.watchThread({
          params: { threadId },
          query: { after: core.store.threadEventHighWater(String(threadId)) },
          responseMode: "response-only",
        });
        // Revoke FIRST, then trigger events: the per-event stillValid check
        // ends the stream, so reading it to completion is deterministic —
        // no fork, no timeout race on an in-flight fetch read.
        yield* client.sessions.revoke({ params: { sessionId: grant.session.id } });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_revoked_watch"), text: "after revoke" },
        });
        const collected = yield* collectEventsUntilEnd(watch);
        yield* waitForIdle(client, threadId);
        return collected;
      }),
    );
    expect(events).toEqual([]);
  });

  /** The awaitable Steer seam (grill 2026-07-02): a blocked Queue.take resumes the moment admit offers — images included. */
  it("delivers steered input (with images) to a turn blocked on the mailbox", async () => {
    const threadId = ThreadId.make("thread_steer_test");
    const png = Buffer.from("steer png bytes");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        const first = yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_steer_run"), text: "wait for steer" },
        });
        yield* Effect.sleep(60);
        const steer = yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_steer_inject"),
            text: "go left",
            delivery: "steer" as const,
            attachments: [
              {
                name: "hint.png",
                mimeType: "image/png",
                sizeBytes: png.length,
                dataUrl: `data:image/png;base64,${png.toString("base64")}`,
              },
            ],
          },
        });
        const detail = yield* waitForIdle(client, threadId);
        return { first, steer, detail };
      }),
    );
    expect(result.first.disposition).toBe("started");
    expect(result.steer.disposition).toBe("steered");
    expect(result.steer.turnId).toBe(result.first.turnId);
    expect(textParts(result.detail).map((part) => part.text)).toContain("steered: go left +1img");
  });

  /** Interrupt-with-message (ADR 0005 force send): the running turn aborts, the successor runs the new text. */
  it("interrupt-with-message aborts the turn and starts the successor", async () => {
    const threadId = ThreadId.make("thread_force_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        const running = yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_force_run"),
            text: "one two three four five six seven eight nine ten",
          },
        });
        yield* Effect.sleep(60);
        const force = yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_force_send"),
            text: "force text",
            delivery: "interrupt" as const,
          },
        });
        const detail = yield* waitForIdle(client, threadId);
        const watch = yield* client.threads.watchThread({
          params: { threadId },
          query: { after: 0 },
          responseMode: "response-only",
        });
        const events = yield* collectEvents(
          watch,
          (event) => event._tag === "turn.settled" && String(event.turnId) === String(force.turnId),
        );
        return { running, force, detail, events };
      }),
    );
    expect(result.force.disposition).toBe("interrupted");
    expect(textParts(result.detail).map((part) => part.text)).toContain("Echo: force text");
    const settled = result.events.filter((event) => event._tag === "turn.settled");
    expect(settled).toContainEqual(
      expect.objectContaining({ turnId: result.running.turnId, state: "aborted" }),
    );
    expect(settled).toContainEqual(
      expect.objectContaining({ turnId: result.force.turnId, state: "completed" }),
    );
  });

  /**
   * Two force sends racing the same supersede window: the second folds the
   * first's text into the successor and the first's promised turn settles
   * instantly aborted — no input is ever silently dropped.
   */
  it("folds a superseded force send instead of dropping it", async () => {
    const threadId = ThreadId.make("thread_supersede_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_supersede_run"), text: "slow abort" },
        });
        yield* Effect.sleep(60);
        // Both force sends must be in flight while the slow abort holds
        // settlement open; admit responses only return after the successor
        // is handed over, so fork rather than await sequentially.
        const first = yield* Effect.forkChild(
          client.messages.send({
            params: { threadId },
            payload: {
              messageId: MessageId.make("msg_supersede_a"),
              text: "first force",
              delivery: "interrupt" as const,
            },
          }),
        );
        yield* Effect.sleep(30);
        const second = yield* Effect.forkChild(
          client.messages.send({
            params: { threadId },
            payload: {
              messageId: MessageId.make("msg_supersede_b"),
              text: "second force",
              delivery: "interrupt" as const,
            },
          }),
        );
        const firstReceipt = yield* Fiber.join(first);
        const secondReceipt = yield* Fiber.join(second);
        const detail = yield* waitForIdle(client, threadId);
        return { firstReceipt, secondReceipt, detail };
      }),
    );
    expect(result.firstReceipt.disposition).toBe("interrupted");
    expect(result.secondReceipt.disposition).toBe("interrupted");
    const texts = textParts(result.detail).map((part) => part.text);
    expect(texts).toContain("Echo: first force\nsecond force");
  });

  /** Leftover Steer (offered, never taken) becomes the follow-up turn and inherits the settled turn's mode. */
  it("runs leftover steer as a follow-up turn inheriting the mode", async () => {
    const threadId = ThreadId.make("thread_leftover_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_leftover_run"),
            text: "deaf: one two three four five six",
            interactionMode: "ask" as const,
          },
        });
        yield* Effect.sleep(60);
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_leftover_steer"),
            text: "picked up later",
            delivery: "steer" as const,
          },
        });
        return yield* waitForIdle(client, threadId);
      }),
    );
    const followUp = textParts(result).find((part) => part.text === "Echo: picked up later");
    expect(followUp).toBeDefined();
    expect(followUp?.metadata).toMatchObject({ mode: "ask" });
  });

  it("queues input against a busy thread, then drains it", async () => {
    const threadId = ThreadId.make("thread_queue_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        const first = yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_queue_first"),
            text: "one two three four five six seven eight nine ten",
          },
        });
        const second = yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_queue_second"), text: "queued message" },
        });
        const detail = yield* waitForIdle(client, threadId);
        return { first, second, detail };
      }),
    );
    expect(result.first.disposition).toBe("started");
    expect(result.second.disposition).toBe("queued");
    expect(result.second.turnId).toBeNull();
    expect(textParts(result.detail).map((part) => part.text)).toContain("Echo: queued message");
  });

  /** An edit/resend admitted while busy still branches: the pinned parent survives the queue (grill fix). */
  it("honors an explicit parentEntryId on a queued message at promotion", async () => {
    const threadId = ThreadId.make("thread_queue_branch_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_qb_first"), text: "first exchange" },
        });
        const afterFirst = yield* waitForIdle(client, threadId);
        const firstUserEntry = afterFirst.entries.find((entry) => entry.parentId === null);
        if (firstUserEntry === undefined) return yield* Effect.die(new Error("no root entry"));
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_qb_running"),
            text: "one two three four five six seven eight nine ten",
          },
        });
        const queued = yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_qb_branch"),
            text: "branched resend",
            parentEntryId: firstUserEntry.id,
          },
        });
        const detail = yield* waitForIdle(client, threadId);
        return { queued, detail, firstUserEntry };
      }),
    );
    expect(result.queued.disposition).toBe("queued");
    const branchedEntry = result.detail.entries.find(
      (entry) => String(entry.messageId) === "msg_qb_branch",
    );
    expect(branchedEntry).toBeDefined();
    expect(String(branchedEntry?.parentId)).toBe(String(result.firstUserEntry.id));
  });

  it("cancels a queued message and returns it for composer restore", async () => {
    const threadId = ThreadId.make("thread_cancel_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_cancel_running"),
            text: "one two three four five six seven eight nine ten",
          },
        });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_cancel_queued"), text: "cancel me" },
        });
        const cancelled = yield* client.messages.cancelQueued({
          params: { threadId, messageId: MessageId.make("msg_cancel_queued") },
        });
        const detail = yield* waitForIdle(client, threadId);
        return { cancelled, detail };
      }),
    );
    expect(result.cancelled.text).toBe("cancel me");
    expect(textParts(result.detail).map((part) => part.text)).not.toContain("Echo: cancel me");
  });

  it("interrupts a running turn and settles it as aborted", async () => {
    const threadId = ThreadId.make("thread_interrupt_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_interrupt"),
            text: "one two three four five six seven eight nine ten eleven twelve",
          },
        });
        const watch = yield* client.threads.watchThread({
          params: { threadId },
          query: { after: 0 },
          responseMode: "response-only",
        });
        yield* Effect.sleep(60);
        yield* client.messages.interrupt({ params: { threadId }, payload: {} });
        const events = yield* collectEvents(watch, (event) => event._tag === "turn.settled");
        const settled = events.find((event) => event._tag === "turn.settled");
        return { settled };
      }),
    );
    expect(result.settled).toMatchObject({ _tag: "turn.settled", state: "aborted" });
  });

  /** Interrupt pauses the queue; the next admission drains the backlog in order. */
  it("drains an interrupt-paused backlog on the next admission", async () => {
    const threadId = ThreadId.make("thread_backlog_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_backlog_run"),
            text: "one two three four five six seven eight nine ten",
          },
        });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_backlog_q1"), text: "paused first" },
        });
        yield* Effect.sleep(60);
        yield* client.messages.interrupt({ params: { threadId }, payload: {} });
        // Idle with a backlog of one: the aborted settlement must NOT promote.
        const paused = yield* waitForIdle(client, threadId, 1);
        const next = yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_backlog_q2"), text: "drained second" },
        });
        const detail = yield* waitForIdle(client, threadId);
        return { paused, next, detail };
      }),
    );
    expect(result.paused.queue).toHaveLength(1);
    expect(result.next.disposition).toBe("queued");
    const texts = textParts(result.detail).map((part) => part.text);
    const first = texts.indexOf("Echo: paused first");
    const second = texts.indexOf("Echo: drained second");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it("stores attachments out-of-band, serves the bytes back, and hands images to the turn", async () => {
    const threadId = ThreadId.make("thread_attachment_test");
    const payloadBytes = Buffer.from("honk attachment payload");
    const result = await withClient((client, baseUrl) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_attachment"),
            text: "see attachment",
            attachments: [
              {
                name: "note.png",
                mimeType: "image/png",
                sizeBytes: payloadBytes.length,
                dataUrl: `data:image/png;base64,${payloadBytes.toString("base64")}`,
              },
            ],
          },
        });
        const detail = yield* waitForIdle(client, threadId);
        const ref = detail.messages.find((message) => message.role === "user")?.attachments[0];
        if (ref === undefined || ref.url === null) {
          return yield* Effect.die(new Error("attachment ref missing"));
        }
        const response = yield* Effect.promise(() =>
          fetch(`${baseUrl}${ref.url}`, {
            headers: { authorization: `Bearer ${coreAppSecret}` },
          }),
        );
        const bytes = yield* Effect.promise(() => response.arrayBuffer());
        return { ref, contentType: response.headers.get("content-type"), bytes, detail };
      }),
    );
    expect(result.ref.mimeType).toBe("image/png");
    expect(result.contentType).toBe("image/png");
    expect(Buffer.from(result.bytes).toString()).toBe("honk attachment payload");
    const echoPart = textParts(result.detail).find((part) => part.text === "Echo: see attachment");
    expect(echoPart?.metadata).toMatchObject({ images: 1 });
  });

  /** Queued promotion re-materializes image bytes from the attachment store (they were never held in memory). */
  it("delivers images on a queued message at promotion", async () => {
    const threadId = ThreadId.make("thread_queue_image_test");
    const png = Buffer.from("queued png bytes");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_qi_running"),
            text: "one two three four five six seven eight",
          },
        });
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_qi_queued"),
            text: "queued with image",
            attachments: [
              {
                name: "queued.png",
                mimeType: "image/png",
                sizeBytes: png.length,
                dataUrl: `data:image/png;base64,${png.toString("base64")}`,
              },
            ],
          },
        });
        return yield* waitForIdle(client, threadId);
      }),
    );
    const promoted = textParts(result).find((part) => part.text === "Echo: queued with image");
    expect(promoted).toBeDefined();
    expect(promoted?.metadata).toMatchObject({ images: 1 });
  });

  it("drains two queued messages in order, parenting each reply on the active path", async () => {
    const threadId = ThreadId.make("thread_multi_queue_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_mq_running"),
            text: "one two three four five six seven eight",
          },
        });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_mq_q1"), text: "first queued" },
        });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_mq_q2"), text: "second queued" },
        });
        return yield* waitForIdle(client, threadId);
      }),
    );
    const texts = textParts(result).map((part) => part.text);
    const first = texts.indexOf("Echo: first queued");
    const second = texts.indexOf("Echo: second queued");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    // Every message on the wire must sit on the ACTIVE path: 6 messages = 3 user + 3 assistant.
    expect(result.messages).toHaveLength(6);
    const byId = new Map(result.entries.map((entry) => [String(entry.id), entry]));
    let cursor = result.leafId === null ? null : String(result.leafId);
    let pathLength = 0;
    while (cursor !== null) {
      pathLength += 1;
      const entry = byId.get(cursor);
      cursor = entry?.parentId == null ? null : String(entry.parentId);
    }
    expect(pathLength).toBe(result.entries.length);
  });

  it("orders getDetail messages by the active entry chain after two queued sends", async () => {
    const threadId = ThreadId.make("thread_multi_queue_order_test");
    const detail = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_mqo_running"),
            text: "one two three four five six seven eight",
          },
        });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_mqo_q1"), text: "first queued" },
        });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_mqo_q2"), text: "second queued" },
        });
        return yield* waitForIdle(client, threadId);
      }),
    );
    const byId = new Map(detail.entries.map((entry) => [String(entry.id), entry]));
    const chainMessageIds: Array<string> = [];
    let cursor = detail.leafId === null ? null : String(detail.leafId);
    while (cursor !== null) {
      const entry = byId.get(cursor);
      if (entry === undefined) throw new Error(`missing entry ${cursor}`);
      if (entry.messageId !== null) chainMessageIds.unshift(String(entry.messageId));
      cursor = entry.parentId === null ? null : String(entry.parentId);
    }
    expect(detail.messages.map((message) => String(message.id))).toEqual(chainMessageIds);
    expect(chainMessageIds).toHaveLength(6);
    expect(chainMessageIds[0]).toBe("msg_mqo_running");
    expect(chainMessageIds[2]).toBe("msg_mqo_q1");
    expect(chainMessageIds[4]).toBe("msg_mqo_q2");
  });

  it("interrupt reports the turn it aborted and respects a stale turnId", async () => {
    const threadId = ThreadId.make("thread_interrupt_id_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        const receipt = yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_interrupt_id"),
            text: "one two three four five six seven eight nine ten",
          },
        });
        const stale = yield* client.messages.interrupt({
          params: { threadId },
          payload: { turnId: TurnId.make("turn_not_current") },
        });
        const real = yield* client.messages.interrupt({ params: { threadId }, payload: {} });
        yield* waitForIdle(client, threadId);
        return { receipt, stale, real };
      }),
    );
    expect(result.stale.turnId).toBeNull();
    expect(result.real.turnId).toBe(result.receipt.turnId);
  });

  it("sweeps crashed running threads to an aborted settlement on recover", async () => {
    const threadId = ThreadId.make("thread_recover_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        const detail = yield* client.threads.get({ params: { threadId } });
        // Simulate a crash mid-turn: durable state says running, no fiber exists.
        core.store.updateThread(
          { ...detail.summary, status: "running" },
          detail.leafId === null ? null : String(detail.leafId),
        );
        yield* core.recover();
        const watch = yield* client.threads.watchThread({
          params: { threadId },
          query: { after: 0 },
          responseMode: "response-only",
        });
        const events = yield* collectEvents(watch, (event) => event._tag === "turn.settled");
        const after = yield* client.threads.get({ params: { threadId } });
        return { events, after };
      }),
    );
    const settled = result.events.find((event) => event._tag === "turn.settled");
    expect(settled).toMatchObject({ _tag: "turn.settled", state: "aborted" });
    expect(result.after.summary.status).toBe("idle");
  });

  /**
   * The session-continuity circuit (grill 2026-07-02): the harness records
   * its opaque ref once and a leaf per turn; the Core hands back the nearest
   * mapped ancestor as resumeLeaf — linear turns chain, a branch from the
   * first exchange resumes the root.
   */
  it("round-trips the harness session ref and resume leaves across turns and branches", async () => {
    const threadId = ThreadId.make("thread_session_map_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        const first = yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_sm_first"), text: "first exchange" },
        });
        yield* waitForIdle(client, threadId);
        const second = yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_sm_second"), text: "second exchange" },
        });
        const afterSecond = yield* waitForIdle(client, threadId);
        const firstUserEntry = afterSecond.entries.find((entry) => entry.parentId === null);
        if (firstUserEntry === undefined) return yield* Effect.die(new Error("no root entry"));
        yield* client.messages.send({
          params: { threadId },
          payload: {
            messageId: MessageId.make("msg_sm_branch"),
            text: "branched from root",
            parentEntryId: firstUserEntry.id,
          },
        });
        const detail = yield* waitForIdle(client, threadId);
        return { first, second, afterSecond, detail };
      }),
    );
    const tid = String(threadId);
    const thread = core.store.getThread(tid);
    expect(thread._tag).toBe("Some");
    if (thread._tag === "Some") {
      expect(thread.value.harnessSession).toBe(`echo/${tid}`);
    }
    // The branch moved the leaf, so the linear parts come from the pre-branch
    // snapshot (getDetail serves the active path only — by design).
    const linear = textParts(result.afterSecond);
    const firstPart = linear.find((part) => part.text === "Echo: first exchange");
    const secondPart = linear.find((part) => part.text === "Echo: second exchange");
    const branchPart = textParts(result.detail).find(
      (part) => part.text === "Echo: branched from root",
    );
    expect(firstPart?.metadata).toMatchObject({ resumeLeaf: null, hadSessionRef: false });
    // Linear continuation resumes the previous turn's recorded leaf.
    expect(secondPart?.metadata).toMatchObject({
      resumeLeaf: `leaf_${String(result.first.turnId)}`,
      hadSessionRef: true,
    });
    // Branching from the first user entry has no mapped ancestor: root resume.
    expect(branchPart?.metadata).toMatchObject({ resumeLeaf: null, hadSessionRef: true });
  });

  it("returns typed 404s for unknown questions", async () => {
    const threadId = ThreadId.make("thread_question_test");
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.threads.create({ payload: createPayload(threadId, tempHome) });
        return yield* client.interactions
          .answerQuestion({
            params: { threadId, questionId: QuestionId.make("q_nope") },
            payload: { answers: {} },
          })
          .pipe(Effect.flip);
      }),
    );
    expect(result).toMatchObject({ _tag: "QuestionNotFoundError" });
  });

  /**
   * The codex-oauth login is deliberately untested here: it drives a real
   * device-code flow against auth.openai.com. The cursor key path exercises
   * the store→snapshot circuit without any network. The catalog does NOT
   * light up on the stored key alone: effective availability is the auth
   * route AND a landed harness arm (grill 2026-07-02), and the cursor arm
   * lands in its own round — a stored key with no arm is still no route.
   */
  it("stores a cursor key unvalidated; the catalog stays honest without an arm (ADR 0016)", async () => {
    const result = await withClient((client) =>
      Effect.gen(function* () {
        const zero = yield* client.auth.get();
        const zeroCatalog = yield* client.models.catalog();
        const loggedIn = yield* client.auth.login({
          payload: { kind: "cursor-api-key", apiKey: "key_test_1" },
        });
        const keyedCatalog = yield* client.models.catalog();
        const loggedOut = yield* client.auth.logout({ payload: { kind: "cursor-api-key" } });
        return { zero, zeroCatalog, loggedIn, keyedCatalog, loggedOut };
      }),
    );
    const cursorRow = (snapshot: typeof result.zero) =>
      snapshot.credentials.find((row) => row.kind === "cursor-api-key");
    expect(cursorRow(result.zero)).toMatchObject({ state: "missing" });
    expect(result.zero.flow).toBeNull();
    // pi is in-process — the one harness alive before the other adapter rounds.
    expect(result.zero.harnesses).toContainEqual({ harness: "pi", available: true, detail: null });
    const composer = (catalog: typeof result.zeroCatalog) =>
      catalog.models.find((model) => model.provider === "cursor");
    expect(composer(result.zeroCatalog)).toMatchObject({ available: false });
    // Stored as-is, never validated: the credential row lights, label stays null.
    expect(cursorRow(result.loggedIn)).toMatchObject({ state: "available", label: null });
    expect(composer(result.keyedCatalog)).toMatchObject({ available: false });
    expect(cursorRow(result.loggedOut)).toMatchObject({ state: "missing" });
  });

  /** For a provider WITH an arm, the credential IS the route: logout flips the catalog and create rejects. */
  it("flips openai-codex availability with the credential and enforces it at create", async () => {
    const result = await withClient((client) =>
      Effect.gen(function* () {
        yield* client.auth.logout({ payload: { kind: "codex-oauth" } });
        const downCatalog = yield* client.models.catalog();
        const rejected = yield* client.threads
          .create({ payload: { cwd: tempHome, model: PINNED_MODEL } })
          .pipe(Effect.flip);
        core.auth.storage.set("openai-codex", { type: "api_key", key: "test-key" });
        const upCatalog = yield* client.models.catalog();
        return { downCatalog, rejected, upCatalog };
      }),
    );
    const gpt = (catalog: typeof result.downCatalog) =>
      catalog.models.find((model) => model.provider === "openai-codex");
    expect(gpt(result.downCatalog)).toMatchObject({ available: false });
    expect(result.rejected).toMatchObject({
      _tag: "ModelUnavailableError",
      reason: "no-available-route",
    });
    expect(gpt(result.upCatalog)).toMatchObject({ available: true });
  });

  it("cancelFlow is idempotent when no flow is pending", async () => {
    const result = await withClient((client) =>
      Effect.gen(function* () {
        return yield* client.auth.cancelFlow();
      }),
    );
    expect(result.flow).toBeNull();
  });

  it("serves the three-model catalog with the pinned default and effective availability", async () => {
    const catalog = await withClient((client) => client.models.catalog());
    expect(catalog.models.map((model) => String(model.id))).toEqual([
      "openai-codex/gpt-5.5",
      "anthropic/claude-fable-5",
      "cursor/composer-2.5",
    ]);
    expect(String(catalog.defaultModel)).toBe("anthropic/claude-fable-5");
    // The one wired arm with a stored credential is the one available model.
    const byProvider = new Map(catalog.models.map((model) => [model.provider, model.available]));
    expect(byProvider.get("openai-codex")).toBe(true);
    expect(byProvider.get("anthropic")).toBe(false);
    expect(byProvider.get("cursor")).toBe(false);
  });

  /**
   * The awaitAnswer seam (harness round): the turn suspends on a question
   * Part until a client answers — the circuit the legacy adapters broke by
   * auto-answering Cursor's ask_question empty.
   */
  it("suspends a turn on awaitAnswer and resumes with the client's answers", async () => {
    const questionId = QuestionId.make("q_seam");
    const askingHarness: Harness = {
      capabilities: { steer: true },
      runTurn: (ctx) =>
        Effect.gen(function* () {
          const questionPartId = ctx.newPartId();
          yield* ctx.createPart({
            _tag: "question",
            id: questionPartId,
            messageId: ctx.assistantMessageId,
            turnId: ctx.turnId,
            origin: "honk",
            state: "active",
            questionId,
            title: "Pick one",
            status: "pending",
            questions: [
              { id: questionId, text: "Pick one", options: [{ label: "a" }, { label: "b" }] },
            ],
          });
          const answers = yield* ctx.awaitAnswer(questionId);
          const textPartId = ctx.newPartId();
          yield* ctx.createPart({
            _tag: "text",
            id: textPartId,
            messageId: ctx.assistantMessageId,
            turnId: ctx.turnId,
            origin: "honk",
            state: "active",
            text: `picked: ${String(answers["choice"])}`,
          });
          yield* ctx.completePart(textPartId);
        }),
    };
    const askingHome = mkdtempSync(join(tmpdir(), "honk-core-ask-test-"));
    const askingCoreHome = resolveCoreHome(askingHome);
    const askingAuth = makeAuth(askingCoreHome);
    askingAuth.storage.set("openai-codex", { type: "api_key", key: "test-key" });
    const askingCore = makeCore(
      askingCoreHome,
      askingAuth,
      { "openai-codex": askingHarness },
      makeCheckpoints(),
    );
    let askingOrigin: string | null = null;
    const askingSessions = makeSessions(askingCoreHome, askingCore.store, () => askingOrigin);
    askingSessions.publishSecret();
    const askingSecret = readFileSync(askingSessions.secretPath, "utf8");
    const askingTerminals = makeTerminals();
    const AskingLayer = Layer.mergeAll(
      makeServerLayer(askingCore, askingSessions, askingTerminals, { port: 0 }),
      FetchHttpClient.layer,
    );
    try {
      const threadId = ThreadId.make("thread_ask_seam_test");
      const result = await Effect.gen(function* () {
        const port = yield* boundPort;
        askingOrigin = `http://127.0.0.1:${port}`;
        const client = yield* makeApiClient(askingOrigin, askingSecret);
        yield* client.threads.create({ payload: createPayload(threadId, askingHome) });
        yield* client.messages.send({
          params: { threadId },
          payload: { messageId: MessageId.make("msg_ask_seam"), text: "ask me" },
        });
        // The turn is now suspended on the pending question.
        for (let i = 0; i < 200; i++) {
          const detail = yield* client.threads.get({ params: { threadId } });
          const pending = detail.parts.find(
            (part) => part._tag === "question" && part.status === "pending",
          );
          if (pending !== undefined) break;
          yield* Effect.sleep(25);
        }
        yield* client.interactions.answerQuestion({
          params: { threadId, questionId },
          payload: { answers: { choice: "b" } },
        });
        for (let i = 0; i < 200; i++) {
          const detail = yield* client.threads.get({ params: { threadId } });
          if (detail.summary.status === "idle") return detail;
          yield* Effect.sleep(25);
        }
        return yield* Effect.die(new Error("asking turn never settled"));
      }).pipe(Effect.provide(AskingLayer), Effect.runPromise);
      const question = result.parts.find((part) => part._tag === "question");
      expect(question).toMatchObject({ status: "answered", state: "complete" });
      const texts = result.parts.flatMap((part) => (part._tag === "text" ? [part.text] : []));
      expect(texts).toContain("picked: b");
    } finally {
      await Effect.runPromise(askingTerminals.dispose());
      await Effect.runPromise(askingCore.dispose());
      rmSync(askingHome, { recursive: true, force: true });
    }
  });
});
