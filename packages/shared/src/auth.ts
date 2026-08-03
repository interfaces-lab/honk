import { Schema } from "effect";

/**
 * Declares the server's overall authentication posture.
 *
 * This is a high-level policy label that tells clients how the environment is
 * expected to be accessed, not a transport detail and not an exhaustive list
 * of every accepted credential.
 */
export const ServerAuthPolicy = Schema.Literals([
  "desktop-managed-local",
  "loopback-browser",
  "remote-reachable",
  "unsafe-no-auth",
]);
export type ServerAuthPolicy = typeof ServerAuthPolicy.Type;

/**
 * A credential type that can be exchanged for a real authenticated session.
 *
 * Bootstrap methods are for establishing trust at the start of a connection or
 * pairing flow. They are not the long-lived credential used for ordinary
 * authenticated HTTP traffic after pairing succeeds.
 */
export const ServerAuthBootstrapMethod = Schema.Literals(["desktop-bootstrap", "one-time-token"]);
export type ServerAuthBootstrapMethod = typeof ServerAuthBootstrapMethod.Type;

/**
 * A credential type accepted for steady-state authenticated requests after a
 * client has already paired.
 */
export const ServerAuthSessionMethod = Schema.Literal("bearer-session-token");
export type ServerAuthSessionMethod = typeof ServerAuthSessionMethod.Type;

/**
 * Server-advertised auth capabilities for a specific execution environment.
 */
export const ServerAuthDescriptor = Schema.Struct({
  policy: ServerAuthPolicy,
  bootstrapMethods: Schema.Array(ServerAuthBootstrapMethod),
  sessionMethods: Schema.Array(ServerAuthSessionMethod),
});
export type ServerAuthDescriptor = typeof ServerAuthDescriptor.Type;
