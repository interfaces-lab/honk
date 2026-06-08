import {
  type AuthBootstrapResult,
  type AuthClientSession,
  type AuthPairingCredentialResult,
  type AuthSessionState,
} from "@multi/contracts";
import * as EffectLogger from "@multi/shared/effect-logger";
import { DateTime, Effect, Layer } from "effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { AuthControlPlane } from "./AuthControlPlane.service.ts";
import { ServerAuthPolicyLive } from "./ServerAuthPolicy.ts";
import { BootstrapCredentialService } from "./BootstrapCredentialService.service.ts";
import { BootstrapCredentialError } from "./BootstrapCredentialService.service.ts";
import { ServerAuthPolicy } from "./ServerAuthPolicy.service.ts";
import {
  ServerAuth,
  type AuthenticatedSession,
  AuthError,
  type ServerAuthShape,
} from "./ServerAuth.service.ts";
import {
  SessionCredentialError,
  SessionCredentialService,
} from "./SessionCredentialService.service.ts";
import { AuthControlPlaneLive, AuthCoreLive } from "./AuthControlPlane.ts";

const elog = EffectLogger.create({ service: "server.auth" });

const AUTHORIZATION_PREFIX = "Bearer ";

export function toBootstrapExchangeAuthError(cause: BootstrapCredentialError): AuthError {
  if (cause.status === 500) {
    return new AuthError({
      message: "Failed to validate bootstrap credential.",
      status: 500,
      cause,
    });
  }

  return new AuthError({
    message: "Invalid bootstrap credential.",
    status: 401,
    cause,
  });
}

function parseBearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith(AUTHORIZATION_PREFIX)) {
    return null;
  }
  const token = header.slice(AUTHORIZATION_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

function parseWebSocketAccessToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const url = new URL(request.url, "http://localhost");
  const token = url.searchParams.get("access_token")?.trim() ?? "";
  return token.length > 0 ? token : null;
}

export const makeServerAuth = Effect.gen(function* () {
  const policy = yield* ServerAuthPolicy;
  const bootstrapCredentials = yield* BootstrapCredentialService;
  const authControlPlane = yield* AuthControlPlane;
  const sessions = yield* SessionCredentialService;
  const descriptor = yield* policy.getDescriptor();

  const authenticateToken = (token: string): Effect.Effect<AuthenticatedSession, AuthError> =>
    sessions.verify(token).pipe(
      Effect.tapError((cause: SessionCredentialError) =>
        elog.warn("Rejected authenticated session credential.", {
          reason: cause.message,
        }),
      ),
      Effect.map((session) => ({
        sessionId: session.sessionId,
        subject: session.subject,
        method: session.method,
        role: session.role,
        ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
      })),
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Unauthorized request.",
            status: 401,
            cause,
          }),
      ),
    );

  const authenticateRequest = (
    request: HttpServerRequest.HttpServerRequest,
    options?: { allowWebSocketQueryToken?: boolean },
  ) => {
    const bearerToken =
      parseBearerToken(request) ??
      (options?.allowWebSocketQueryToken ? parseWebSocketAccessToken(request) : null);
    if (!bearerToken) {
      return Effect.fail(
        new AuthError({
          message: "Authentication required.",
          status: 401,
        }),
      );
    }
    return authenticateToken(bearerToken);
  };

  const getSessionState: ServerAuthShape["getSessionState"] = (request) =>
    authenticateRequest(request).pipe(
      Effect.map(
        (session) =>
          ({
            authenticated: true,
            auth: descriptor,
            role: session.role,
            sessionMethod: session.method,
            ...(session.expiresAt ? { expiresAt: DateTime.toUtc(session.expiresAt) } : {}),
          }) satisfies AuthSessionState,
      ),
      Effect.catchTag("AuthError", () =>
        Effect.succeed({
          authenticated: false,
          auth: descriptor,
        } satisfies AuthSessionState),
      ),
    );

  const exchangeBootstrapCredential: ServerAuthShape["exchangeBootstrapCredential"] = (
    credential,
    requestMetadata,
  ) =>
    bootstrapCredentials.consume(credential).pipe(
      Effect.mapError(toBootstrapExchangeAuthError),
      Effect.flatMap((grant) =>
        sessions
          .issue({
            subject: grant.subject,
            role: grant.role,
            client: {
              ...requestMetadata,
              ...(grant.label ? { label: grant.label } : {}),
            },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({
                  message: "Failed to issue authenticated session.",
                  cause,
                }),
            ),
          ),
      ),
      Effect.map(
        (session) =>
          ({
            authenticated: true,
            role: session.role,
            sessionMethod: "bearer-session-token",
            expiresAt: DateTime.toUtc(session.expiresAt),
            sessionToken: session.token,
          }) satisfies AuthBootstrapResult,
      ),
    );

  const issuePairingCredential: ServerAuthShape["issuePairingCredential"] = (input) =>
    authControlPlane
      .createPairingLink({
        role: input?.role ?? "client",
        subject: input?.role === "owner" ? "owner-bootstrap" : "one-time-token",
        ...(input?.label ? { label: input.label } : {}),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Failed to issue pairing credential.",
              cause,
            }),
        ),
        Effect.map(
          (issued) =>
            ({
              id: issued.id,
              credential: issued.credential,
              ...(issued.label ? { label: issued.label } : {}),
              expiresAt: issued.expiresAt,
            }) satisfies AuthPairingCredentialResult,
        ),
      );

  const listPairingLinks: ServerAuthShape["listPairingLinks"] = () =>
    authControlPlane
      .listPairingLinks({
        role: "client",
        excludeSubjects: ["owner-bootstrap"],
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Failed to load pairing links.",
              cause,
            }),
        ),
      );

  const revokePairingLink: ServerAuthShape["revokePairingLink"] = (id) =>
    authControlPlane.revokePairingLink(id).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Failed to revoke pairing link.",
            cause,
          }),
      ),
    );

  const listClientSessions: ServerAuthShape["listClientSessions"] = (currentSessionId) =>
    authControlPlane.listSessions().pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Failed to load paired clients.",
            cause,
          }),
      ),
      Effect.map((clientSessions) =>
        clientSessions.map(
          (clientSession): AuthClientSession => ({
            ...clientSession,
            current: clientSession.sessionId === currentSessionId,
          }),
        ),
      ),
    );

  const revokeClientSession: ServerAuthShape["revokeClientSession"] = (
    currentSessionId,
    targetSessionId,
  ) =>
    Effect.gen(function* () {
      if (currentSessionId === targetSessionId) {
        return yield* new AuthError({
          message: "Use revoke other clients to keep the current owner session active.",
          status: 403,
        });
      }
      return yield* authControlPlane.revokeSession(targetSessionId).pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({
              message: "Failed to revoke client session.",
              cause,
            }),
        ),
      );
    });

  const revokeOtherClientSessions: ServerAuthShape["revokeOtherClientSessions"] = (
    currentSessionId,
  ) =>
    authControlPlane.revokeOtherSessionsExcept(currentSessionId).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Failed to revoke other client sessions.",
            cause,
          }),
      ),
    );

  const issueStartupPairingUrl: ServerAuthShape["issueStartupPairingUrl"] = (baseUrl) =>
    issuePairingCredential({ role: "owner" }).pipe(
      Effect.map((issued) => {
        const url = new URL(baseUrl);
        url.pathname = "/";
        url.searchParams.delete("token");
        url.hash = new URLSearchParams([["token", issued.credential]]).toString();
        return url.toString();
      }),
    );

  const authenticateWebSocketUpgrade: ServerAuthShape["authenticateWebSocketUpgrade"] =
    (request) => authenticateRequest(request, { allowWebSocketQueryToken: true });

  return {
    getDescriptor: () => Effect.succeed(descriptor),
    getSessionState,
    exchangeBootstrapCredential,
    issuePairingCredential,
    listPairingLinks,
    revokePairingLink,
    listClientSessions,
    revokeClientSession,
    revokeOtherClientSessions,
    authenticateHttpRequest: authenticateRequest,
    authenticateWebSocketUpgrade,
    issueStartupPairingUrl,
  } satisfies ServerAuthShape;
});

export const ServerAuthLive = Layer.effect(ServerAuth, makeServerAuth).pipe(
  Layer.provideMerge(AuthControlPlaneLive),
  Layer.provideMerge(AuthCoreLive),
  Layer.provideMerge(ServerAuthPolicyLive),
);
