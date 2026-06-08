import {
  AuthSessionId,
  type AuthClientMetadata,
  type AuthClientSession,
  type ServerAuthSessionMethod,
} from "@multi/contracts";
import * as EffectLogger from "@multi/shared/effect-logger";
import { Clock, DateTime, Duration, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect";
import { Option } from "effect";

import { AuthSessionRepositoryLive } from "../persistence/AuthSessions.ts";
import { AuthSessionRepository } from "../persistence/AuthSessions.service.ts";
import { ServerSecretStore } from "./ServerSecretStore.service.ts";
import {
  SessionCredentialError,
  SessionCredentialService,
  type IssuedSession,
  type SessionCredentialChange,
  type SessionCredentialServiceShape,
  type VerifiedSession,
} from "./SessionCredentialService.service.ts";
import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "./utils.ts";

const elog = EffectLogger.create({ service: "server.auth.session" });

const SIGNING_SECRET_NAME = "server-signing-key";
const DEFAULT_SESSION_TTL = Duration.days(30);
const PUBLIC_SESSION_METHOD: ServerAuthSessionMethod = "bearer-session-token";

const SessionClaims = Schema.Struct({
  v: Schema.Literal(1),
  kind: Schema.Literal("session"),
  sid: AuthSessionId,
  sub: Schema.String,
  role: Schema.Literals(["owner", "client"]),
  method: Schema.Literal("bearer-session-token"),
  iat: Schema.Number,
  exp: Schema.Number,
});
type SessionClaims = typeof SessionClaims.Type;

const decodeSessionClaims = Schema.decodeUnknownEffect(Schema.fromJsonString(SessionClaims));

function createDefaultClientMetadata(): AuthClientMetadata {
  return {
    deviceType: "unknown",
  };
}

function toClientMetadata(record: {
  readonly label: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceType: AuthClientMetadata["deviceType"];
  readonly os: string | null;
  readonly browser: string | null;
}): AuthClientMetadata {
  return {
    ...(record.label ? { label: record.label } : {}),
    ...(record.ipAddress ? { ipAddress: record.ipAddress } : {}),
    ...(record.userAgent ? { userAgent: record.userAgent } : {}),
    deviceType: record.deviceType,
    ...(record.os ? { os: record.os } : {}),
    ...(record.browser ? { browser: record.browser } : {}),
  };
}

function toAuthClientSession(input: Omit<AuthClientSession, "current">): AuthClientSession {
  return {
    ...input,
    current: false,
  };
}

const toSessionCredentialError = (message: string) => (cause: unknown) =>
  new SessionCredentialError({
    message,
    cause,
  });

export const makeSessionCredentialService = Effect.gen(function* () {
  const secretStore = yield* ServerSecretStore;
  const authSessions = yield* AuthSessionRepository;
  const signingSecret = yield* secretStore.getOrCreateRandom(SIGNING_SECRET_NAME, 32);
  const connectedSessionsRef = yield* Ref.make(new Map<string, number>());
  const changesPubSub = yield* PubSub.unbounded<SessionCredentialChange>();

  const emitUpsert = (clientSession: AuthClientSession) =>
    PubSub.publish(changesPubSub, {
      type: "clientUpserted",
      clientSession,
    }).pipe(Effect.asVoid);

  const emitRemoved = (sessionId: AuthSessionId) =>
    PubSub.publish(changesPubSub, {
      type: "clientRemoved",
      sessionId,
    }).pipe(Effect.asVoid);

  const loadActiveSession = (sessionId: AuthSessionId) =>
    Effect.gen(function* () {
      const row = yield* authSessions.getById({ sessionId });
      if (Option.isNone(row) || row.value.revokedAt !== null) {
        return Option.none<AuthClientSession>();
      }

      const connectedSessions = yield* Ref.get(connectedSessionsRef);
      return Option.some(
        toAuthClientSession({
          sessionId: row.value.sessionId,
          subject: row.value.subject,
          role: row.value.role,
          method: PUBLIC_SESSION_METHOD,
          client: toClientMetadata(row.value.client),
          issuedAt: row.value.issuedAt,
          expiresAt: row.value.expiresAt,
          lastConnectedAt: row.value.lastConnectedAt,
          connected: connectedSessions.has(row.value.sessionId),
        }),
      );
    });

  const markConnected: SessionCredentialServiceShape["markConnected"] = (sessionId) =>
    Ref.modify(connectedSessionsRef, (current) => {
      const next = new Map(current);
      const wasDisconnected = !next.has(sessionId);
      next.set(sessionId, (next.get(sessionId) ?? 0) + 1);
      return [wasDisconnected, next] as const;
    }).pipe(
      Effect.flatMap((wasDisconnected) =>
        wasDisconnected
          ? DateTime.now.pipe(
              Effect.flatMap((lastConnectedAt) =>
                authSessions.setLastConnectedAt({
                  sessionId,
                  lastConnectedAt,
                }),
              ),
            )
          : Effect.void,
      ),
      Effect.flatMap(() => loadActiveSession(sessionId)),
      Effect.flatMap((session) =>
        Option.isSome(session) ? emitUpsert(session.value) : Effect.void,
      ),
      Effect.catchCause((cause) =>
        elog.error("Failed to publish connected-session auth update.", {
          sessionId,
          cause,
        }),
      ),
    );

  const markDisconnected: SessionCredentialServiceShape["markDisconnected"] = (sessionId) =>
    Ref.update(connectedSessionsRef, (current) => {
      const next = new Map(current);
      const remaining = (next.get(sessionId) ?? 0) - 1;
      if (remaining > 0) {
        next.set(sessionId, remaining);
      } else {
        next.delete(sessionId);
      }
      return next;
    }).pipe(
      Effect.flatMap(() => loadActiveSession(sessionId)),
      Effect.flatMap((session) =>
        Option.isSome(session) ? emitUpsert(session.value) : Effect.void,
      ),
      Effect.catchCause((cause) =>
        elog.error("Failed to publish disconnected-session auth update.", {
          sessionId,
          cause,
        }),
      ),
    );

  const issue: SessionCredentialServiceShape["issue"] = (input) =>
    Effect.gen(function* () {
      const sessionId = AuthSessionId.make(crypto.randomUUID());
      const issuedAt = yield* DateTime.now;
      const expiresAt = DateTime.add(issuedAt, {
        milliseconds: Duration.toMillis(input?.ttl ?? DEFAULT_SESSION_TTL),
      });
      const claims: SessionClaims = {
        v: 1,
        kind: "session",
        sid: sessionId,
        sub: input?.subject ?? "browser",
        role: input?.role ?? "client",
        method: PUBLIC_SESSION_METHOD,
        iat: issuedAt.epochMilliseconds,
        exp: expiresAt.epochMilliseconds,
      };
      const encodedPayload = base64UrlEncode(JSON.stringify(claims));
      const signature = signPayload(encodedPayload, signingSecret);
      const client = input?.client ?? createDefaultClientMetadata();
      yield* authSessions.create({
        sessionId,
        subject: claims.sub,
        role: claims.role,
        method: claims.method,
        client: {
          label: client.label ?? null,
          ipAddress: client.ipAddress ?? null,
          userAgent: client.userAgent ?? null,
          deviceType: client.deviceType,
          os: client.os ?? null,
          browser: client.browser ?? null,
        },
        issuedAt,
        expiresAt,
      });
      yield* emitUpsert(
        toAuthClientSession({
          sessionId,
          subject: claims.sub,
          role: claims.role,
          method: PUBLIC_SESSION_METHOD,
          client,
          issuedAt,
          expiresAt,
          lastConnectedAt: null,
          connected: false,
        }),
      );

      return {
        sessionId,
        token: `${encodedPayload}.${signature}`,
        method: PUBLIC_SESSION_METHOD,
        client,
        expiresAt: expiresAt,
        role: claims.role,
      } satisfies IssuedSession;
    }).pipe(Effect.mapError(toSessionCredentialError("Failed to issue session credential.")));

  const verify: SessionCredentialServiceShape["verify"] = (token) =>
    Effect.gen(function* () {
      const [encodedPayload, signature] = token.split(".");
      if (!encodedPayload || !signature) {
        return yield* new SessionCredentialError({
          message: "Malformed session token.",
        });
      }

      const expectedSignature = signPayload(encodedPayload, signingSecret);
      if (!timingSafeEqualBase64Url(signature, expectedSignature)) {
        return yield* new SessionCredentialError({
          message: "Invalid session token signature.",
        });
      }

      const claims = yield* decodeSessionClaims(base64UrlDecodeUtf8(encodedPayload)).pipe(
        Effect.mapError(
          (cause) =>
            new SessionCredentialError({
              message: "Invalid session token payload.",
              cause,
            }),
        ),
      );

      const now = yield* Clock.currentTimeMillis;
      if (claims.exp <= now) {
        return yield* new SessionCredentialError({
          message: "Session token expired.",
        });
      }

      const row = yield* authSessions.getById({ sessionId: claims.sid });
      if (Option.isNone(row)) {
        return yield* new SessionCredentialError({
          message: "Unknown session token.",
        });
      }
      if (row.value.revokedAt !== null) {
        return yield* new SessionCredentialError({
          message: "Session token revoked.",
        });
      }

      return {
        sessionId: claims.sid,
        token,
        method: PUBLIC_SESSION_METHOD,
        client: toClientMetadata(row.value.client),
        expiresAt: DateTime.makeUnsafe(claims.exp),
        subject: claims.sub,
        role: claims.role,
      } satisfies VerifiedSession;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionCredentialError
          ? cause
          : new SessionCredentialError({
              message: "Failed to verify session credential.",
              cause,
            }),
      ),
    );

  const listActive: SessionCredentialServiceShape["listActive"] = () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const connectedSessions = yield* Ref.get(connectedSessionsRef);
      const rows = yield* authSessions.listActive({ now });

      return rows.map((row) =>
        toAuthClientSession({
          sessionId: row.sessionId,
          subject: row.subject,
          role: row.role,
          method: PUBLIC_SESSION_METHOD,
          client: toClientMetadata(row.client),
          issuedAt: row.issuedAt,
          expiresAt: row.expiresAt,
          lastConnectedAt: row.lastConnectedAt,
          connected: connectedSessions.has(row.sessionId),
        }),
      );
    }).pipe(Effect.mapError(toSessionCredentialError("Failed to list active sessions.")));

  const revoke: SessionCredentialServiceShape["revoke"] = (sessionId) =>
    Effect.gen(function* () {
      const revokedAt = yield* DateTime.now;
      const revoked = yield* authSessions.revoke({
        sessionId,
        revokedAt,
      });
      if (revoked) {
        yield* Ref.update(connectedSessionsRef, (current) => {
          const next = new Map(current);
          next.delete(sessionId);
          return next;
        });
        yield* emitRemoved(sessionId);
      }
      return revoked;
    }).pipe(Effect.mapError(toSessionCredentialError("Failed to revoke session.")));

  const revokeAllExcept: SessionCredentialServiceShape["revokeAllExcept"] = (sessionId) =>
    Effect.gen(function* () {
      const revokedAt = yield* DateTime.now;
      const revokedSessionIds = yield* authSessions.revokeAllExcept({
        currentSessionId: sessionId,
        revokedAt,
      });
      if (revokedSessionIds.length > 0) {
        yield* Ref.update(connectedSessionsRef, (current) => {
          const next = new Map(current);
          for (const revokedSessionId of revokedSessionIds) {
            next.delete(revokedSessionId);
          }
          return next;
        });
        yield* Effect.forEach(
          revokedSessionIds,
          (revokedSessionId) => emitRemoved(revokedSessionId),
          {
            concurrency: "unbounded",
            discard: true,
          },
        );
      }
      return revokedSessionIds.length;
    }).pipe(Effect.mapError(toSessionCredentialError("Failed to revoke other sessions.")));

  return {
    issue,
    verify,
    listActive,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
    revoke,
    revokeAllExcept,
    markConnected,
    markDisconnected,
  } satisfies SessionCredentialServiceShape;
});

export const SessionCredentialServiceLive = Layer.effect(
  SessionCredentialService,
  makeSessionCredentialService,
).pipe(Layer.provideMerge(AuthSessionRepositoryLive));
