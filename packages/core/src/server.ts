import { createServer } from "node:http";
import { Effect, Layer, Queue, Scope } from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Socket from "effect/unstable/socket/Socket";
import {
  type AuthSnapshot,
  CurrentSession,
  ForbiddenError,
  HonkApi,
  SessionNotFoundError,
  UnauthorizedError,
} from "@honk/api/core/v1";
import { modelCatalog } from "./catalog";
import type { Core } from "./core";
import { makeSessionAuthLayer, type Sessions } from "./session";
import { sseResponse } from "./stream";
import { drainOutbound, type OutboundMessage, type Terminals } from "./terminal";

export const CORE_VERSION = "0.0.1";

/**
 * Every handler group closes over the Core instance directly; request-scoped
 * session capability arrives from the HttpApi middleware. Stream endpoints
 * resume with ?after=seq; when ?after is absent they tail from the current
 * high-water mark (the snapshot/list response carries that seq, so a client
 * always has one to resume from).
 */
const requireCoreApp = Effect.gen(function* () {
  const session = yield* CurrentSession;
  if (session.role !== "core-app") {
    return yield* Effect.fail(new ForbiddenError());
  }
  return session;
});

const visibleAuthSnapshot = (snapshot: AuthSnapshot, role: "core-app" | "web"): AuthSnapshot =>
  role === "core-app" ? snapshot : { ...snapshot, flow: null };

const makeGroups = (core: Core, sessionDomain: Sessions, terminalsDomain: Terminals) => {
  const meta = HttpApiBuilder.group(HonkApi, "meta", (handlers) =>
    handlers.handle("health", () =>
      Effect.succeed({
        pid: process.pid,
        version: CORE_VERSION,
        apiVersion: "core/v1" as const,
        startedAt: core.startedAt,
      }),
    ),
  );

  const threads = HttpApiBuilder.group(HonkApi, "threads", (handlers) =>
    handlers
      .handle("list", ({ query }) => Effect.sync(() => core.listThreads(query.archived ?? false)))
      .handleRaw("watch", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const sessionId = String(session.id);
          const bus = yield* core.buses.workspaceBus();
          const after = query.after ?? core.store.workspaceEventHighWater();
          return yield* sseResponse(bus, () => core.store.listWorkspaceEvents(after), {
            sessionId,
            stillValid: () => sessionDomain.isLive(sessionId),
          });
        }),
      )
      .handle("create", ({ payload }) => core.createThread(payload))
      .handle("get", ({ params }) => core.getDetail(params.threadId))
      .handleRaw("watchThread", ({ params, query }) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const sessionId = String(session.id);
          yield* core.getDetail(params.threadId);
          const bus = yield* core.buses.threadBus(String(params.threadId));
          const after = query.after ?? core.store.threadEventHighWater(String(params.threadId));
          return yield* sseResponse(
            bus,
            () => core.store.listThreadEvents(String(params.threadId), after),
            { sessionId, stillValid: () => sessionDomain.isLive(sessionId) },
          );
        }),
      )
      .handle("update", ({ params, payload }) => core.updateThread(params.threadId, payload))
      .handle("archive", ({ params }) => core.archiveThread(params.threadId))
      .handle("unarchive", ({ params }) => core.unarchiveThread(params.threadId))
      .handle("remove", ({ params }) => core.removeThread(params.threadId))
      .handle("navigate", ({ params, payload }) => core.navigate(params.threadId, payload.entryId)),
  );

  const checkpoints = HttpApiBuilder.group(HonkApi, "checkpoints", (handlers) =>
    handlers
      .handle("turnDiff", ({ params }) =>
        Effect.gen(function* () {
          const detail = yield* core.getDetail(params.threadId);
          const files = yield* core.checkpoints.turnDiff(params.threadId, detail.cwd, params.turn);
          return { files };
        }),
      )
      .handle("fullDiff", ({ params }) =>
        Effect.gen(function* () {
          const detail = yield* core.getDetail(params.threadId);
          const files = yield* core.checkpoints.fullDiff(params.threadId, detail.cwd);
          return { files };
        }),
      )
      .handle("revertTurn", ({ params }) =>
        Effect.gen(function* () {
          const detail = yield* core.getDetail(params.threadId);
          yield* core.checkpoints.revert(params.threadId, detail.cwd, params.turn);
          return {};
        }),
      )
      .handle("initRepo", ({ params }) =>
        Effect.gen(function* () {
          const detail = yield* core.getDetail(params.threadId);
          const alreadyRepo = yield* core.checkpoints.isRepo(detail.cwd);
          if (alreadyRepo) return { initialized: false };
          yield* core.checkpoints.initRepo(detail.cwd);
          return { initialized: true };
        }),
      ),
  );

  const messages = HttpApiBuilder.group(HonkApi, "messages", (handlers) =>
    handlers
      .handle("send", ({ params, payload }) => core.admit(params.threadId, payload))
      .handle("interrupt", ({ params, payload }) => core.interrupt(params.threadId, payload.turnId))
      .handle("cancelQueued", ({ params }) => core.cancelQueued(params.threadId, params.messageId)),
  );

  const attachments = HttpApiBuilder.group(HonkApi, "attachments", (handlers) =>
    handlers.handleRaw("bytes", ({ params }) =>
      Effect.gen(function* () {
        const attachment = yield* core.attachmentBytes(params.threadId, params.attachmentId);
        const safeName = attachment.name.replace(/[^\w. -]/g, "_");
        return HttpServerResponse.uint8Array(attachment.bytes, {
          contentType: attachment.mimeType,
          headers: { "content-disposition": `inline; filename="${safeName}"` },
        });
      }),
    ),
  );

  const interactions = HttpApiBuilder.group(HonkApi, "interactions", (handlers) =>
    handlers
      .handle("answerQuestion", ({ params, payload }) =>
        core.answerQuestion(params.threadId, params.questionId, payload.answers),
      )
      .handle("implementPlan", ({ params }) => core.implementPlan(params.threadId, params.planId)),
  );

  /** Effective availability: the auth route AND a landed harness arm (ADR 0016; grill 2026-07-02) — the same gate threads.create enforces. */
  const models = HttpApiBuilder.group(HonkApi, "models", (handlers) =>
    handlers.handle("catalog", () => Effect.sync(() => modelCatalog(core.availability()))),
  );

  /**
   * All fetch-only: mutations return the next snapshot, nothing is pushed.
   * The mutation verbs are Core App capability — web sessions get 403.
   */
  const auth = HttpApiBuilder.group(HonkApi, "auth", (handlers) =>
    handlers
      .handle("get", () =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const snapshot = yield* core.auth.snapshot();
          return visibleAuthSnapshot(snapshot, session.role);
        }),
      )
      .handle("login", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireCoreApp;
          return yield* core.auth.login(payload);
        }),
      )
      .handle("logout", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireCoreApp;
          return yield* core.auth.logout(payload.kind);
        }),
      )
      .handle("cancelFlow", () =>
        Effect.gen(function* () {
          yield* requireCoreApp;
          return yield* core.auth.cancelFlow();
        }),
      ),
  );

  const terminals = HttpApiBuilder.group(HonkApi, "terminals", (handlers) =>
    handlers
      .handle("list", () => terminalsDomain.list())
      .handle("create", ({ payload }) => terminalsDomain.create(payload))
      .handle("ticket", ({ params }) => terminalsDomain.issueTicket(params.terminalId))
      .handle("close", ({ params }) => terminalsDomain.close(params.terminalId))
      .handle("restart", ({ params }) => terminalsDomain.restart(params.terminalId)),
  );

  const sessions = HttpApiBuilder.group(HonkApi, "sessions", (handlers) =>
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          yield* requireCoreApp;
          return { sessions: sessionDomain.list() };
        }),
      )
      .handle("revoke", ({ params }) =>
        Effect.gen(function* () {
          yield* requireCoreApp;
          if (!sessionDomain.revoke(params.sessionId)) {
            return yield* Effect.fail(new SessionNotFoundError({ sessionId: params.sessionId }));
          }
        }),
      )
      .handle("pair", () =>
        Effect.gen(function* () {
          yield* requireCoreApp;
          return sessionDomain.issuePairing();
        }),
      ),
  );

  const pairing = HttpApiBuilder.group(HonkApi, "pairing", (handlers) =>
    handlers.handle("exchange", ({ payload }) =>
      Effect.gen(function* () {
        const grant = sessionDomain.exchange(payload.token);
        if (grant === null) {
          return yield* Effect.fail(new UnauthorizedError());
        }
        return grant;
      }),
    ),
  );

  return Layer.mergeAll(
    meta,
    threads,
    checkpoints,
    messages,
    attachments,
    interactions,
    models,
    auth,
    terminals,
    sessions,
    pairing,
  );
};

export interface ServeOptions {
  readonly port: number;
  readonly host?: string;
}

const attachTicketFromUrl = (url: string): string | null => {
  try {
    return new URL(url, "http://127.0.0.1").searchParams.get("ticket");
  } catch {
    return null;
  }
};

const closeSocket = (
  socket: Socket.Socket,
  code: number,
  reason: string,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const writer = yield* socket.writer;
    const outbound = yield* Queue.unbounded<OutboundMessage>();
    yield* Effect.forkScoped(drainOutbound(writer, outbound));
    Queue.offerUnsafe(outbound, { _tag: "close", code, reason });
    yield* socket.runString(() => Effect.void).pipe(Effect.catch(() => Effect.void));
  });

const makeTerminalAttachRoute = (terminals: Terminals) =>
  HttpRouter.add("GET", "/core/v1/terminals/attach", (request) =>
    Effect.gen(function* () {
      const ticket = attachTicketFromUrl(request.url);
      const terminalId = ticket === null ? null : terminals.consumeTicket(ticket);
      const socket = yield* Effect.orDie(request.upgrade);
      if (terminalId === null) {
        yield* closeSocket(socket, 4401, "Unauthorized");
        return HttpServerResponse.empty();
      }

      yield* terminals
        .attach(terminalId, socket)
        .pipe(
          Effect.catch((error) =>
            error._tag === "TerminalNotFoundError"
              ? closeSocket(socket, 4401, "Unauthorized")
              : Effect.void,
          ),
        );
      return HttpServerResponse.empty();
    }),
  );

/**
 * The whole HTTP surface as one layer. NodeHttpServer.layer supplies
 * HttpPlatform/Etag/FileSystem/Path itself; provideMerge keeps
 * HttpServer.HttpServer in the output so the bound port stays readable
 * (port 0 = ephemeral).
 */
export const makeServerLayer = (
  core: Core,
  sessionDomain: Sessions,
  terminals: Terminals,
  options: ServeOptions,
): Layer.Layer<HttpServer.HttpServer, unknown> =>
  HttpRouter.serve(
    Layer.mergeAll(
      HttpApiBuilder.layer(HonkApi).pipe(
        Layer.provide(
          makeGroups(core, sessionDomain, terminals).pipe(
            Layer.provide(makeSessionAuthLayer(sessionDomain)),
          ),
        ),
      ),
      makeTerminalAttachRoute(terminals),
    ),
    {
      disableLogger: true,
      disableListenLog: true,
      // Bearer-token API with no cookie auth, so any origin may call it (the
      // dev renderer lives on the vite origin, web sessions attach cross-origin
      // per ADR 0002). With no allowedHeaders configured the middleware
      // reflects the preflight's requested headers, which is what we want:
      // clients send authorization plus tracing headers (traceparent, b3, …)
      // and none of them carry origin-scoped privilege.
      middleware: (app) => HttpMiddleware.cors()(HttpMiddleware.logger(app)),
    },
  ).pipe(
    Layer.provideMerge(
      NodeHttpServer.layer(createServer, {
        port: options.port,
        host: options.host ?? "127.0.0.1",
      }),
    ),
  );

export const boundPort: Effect.Effect<number, Error, HttpServer.HttpServer> = Effect.gen(
  function* () {
    const server = yield* HttpServer.HttpServer;
    const address = server.address;
    if (address._tag !== "TcpAddress") {
      return yield* Effect.fail(new Error("expected a TcpAddress"));
    }
    return address.port;
  },
);
