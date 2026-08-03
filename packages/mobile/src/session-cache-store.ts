import {
  createOpenCodeServer,
  openCodeSessionRef,
  type OpenCodeServerDescriptor,
  type OpenCodeServerKey,
  type OpenCodeSessionInfo,
} from "@honk/opencode";

import type { RemoteSession } from "./remote-context";

export const SESSION_CACHE_SCHEMA = "honk.mobile.opencode.sessions";
export const SESSION_CACHE_VERSION = 1;
export const SESSION_CACHE_SERVER_LIMIT = 16;
export const SESSION_CACHE_SESSIONS_PER_SERVER_LIMIT = 128;

const ORIGIN_LENGTH_LIMIT = 2_048;
const LABEL_LENGTH_LIMIT = 256;
const IDENTIFIER_LENGTH_LIMIT = 512;
const TITLE_LENGTH_LIMIT = 4_096;
const DIRECTORY_LENGTH_LIMIT = 8_192;

export interface SessionCacheServerSnapshot {
  readonly server: OpenCodeServerDescriptor;
  readonly sessions: readonly RemoteSession[];
}

export interface SessionCache {
  readonly schema: typeof SESSION_CACHE_SCHEMA;
  readonly version: typeof SESSION_CACHE_VERSION;
  readonly servers: readonly SessionCacheServerSnapshot[];
}

export const EMPTY_SESSION_CACHE: SessionCache = Object.freeze({
  schema: SESSION_CACHE_SCHEMA,
  version: SESSION_CACHE_VERSION,
  servers: Object.freeze([]),
});

export function decodeSessionCache(raw: string | object | null): SessionCache {
  if (raw === null) return EMPTY_SESSION_CACHE;
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  const cache = requireObject(value, "The saved Honk session cache is invalid.");
  if (
    Reflect.get(cache, "schema") !== SESSION_CACHE_SCHEMA ||
    Reflect.get(cache, "version") !== SESSION_CACHE_VERSION
  ) {
    throw new Error("The saved Honk session cache uses an unsupported format.");
  }
  const servers = Reflect.get(cache, "servers");
  if (!Array.isArray(servers)) {
    throw new Error("The saved Honk session cache is incomplete.");
  }
  if (servers.length > SESSION_CACHE_SERVER_LIMIT) {
    throw new Error("The saved Honk session cache contains too many computers.");
  }
  const decoded = servers.map(decodeServerSnapshot);
  if (new Set(decoded.map((snapshot) => snapshot.server.key)).size !== decoded.length) {
    throw new Error("The saved Honk session cache contains a duplicate computer.");
  }
  return pruneSessionCache({
    schema: SESSION_CACHE_SCHEMA,
    version: SESSION_CACHE_VERSION,
    servers: decoded,
  });
}

export function encodeSessionCache(cache: SessionCache): string {
  // Select fields explicitly. A future RemoteSession field cannot accidentally put credentials,
  // transcripts, or other connection state into this index.
  return JSON.stringify({
    schema: SESSION_CACHE_SCHEMA,
    version: SESSION_CACHE_VERSION,
    servers: pruneSessionCache(cache).servers.map((snapshot) => ({
      origin: snapshot.server.origin,
      label: snapshot.server.label,
      kind: snapshot.server.kind,
      sessions: snapshot.sessions.map((session) => ({
        id: session.info.id,
        ...(session.info.parentID === undefined ? {} : { parentID: session.info.parentID }),
        projectID: session.info.projectID,
        ...(session.info.agent === undefined ? {} : { agent: session.info.agent }),
        ...(session.info.model === undefined ? {} : { model: session.info.model }),
        time: session.info.time,
        title: session.info.title,
        location: session.info.location,
        projectDirectory: session.projectDirectory,
        status: session.status,
        needsAttention: session.needsAttention,
      })),
    })),
  });
}

export function replaceSessionCacheServer(
  cache: SessionCache,
  snapshot: SessionCacheServerSnapshot,
): SessionCache {
  const server = normalizeServer(snapshot.server);
  return pruneSessionCache({
    schema: SESSION_CACHE_SCHEMA,
    version: SESSION_CACHE_VERSION,
    servers: [
      ...cache.servers.filter((candidate) => candidate.server.key !== server.key),
      { server, sessions: snapshot.sessions },
    ],
  });
}

export function mergeSessionCacheServer(
  cache: SessionCache,
  snapshot: SessionCacheServerSnapshot,
): SessionCache {
  const server = normalizeServer(snapshot.server);
  const existing = cache.servers.find((candidate) => candidate.server.key === server.key);
  return replaceSessionCacheServer(cache, {
    server,
    sessions:
      existing === undefined ? snapshot.sessions : [...existing.sessions, ...snapshot.sessions],
  });
}

export function removeSessionCacheServer(
  cache: SessionCache,
  server: OpenCodeServerKey,
): SessionCache {
  return pruneSessionCache({
    schema: SESSION_CACHE_SCHEMA,
    version: SESSION_CACHE_VERSION,
    servers: cache.servers.filter((snapshot) => snapshot.server.key !== server),
  });
}

export function pruneSessionCache(cache: SessionCache): SessionCache {
  const snapshots = cache.servers.reduce((byServer, snapshot) => {
    const server = normalizeServer(snapshot.server);
    const existing = byServer.get(server.key);
    byServer.set(server.key, {
      server,
      sessions:
        existing === undefined ? snapshot.sessions : [...existing.sessions, ...snapshot.sessions],
    });
    return byServer;
  }, new Map<OpenCodeServerKey, SessionCacheServerSnapshot>());

  return Object.freeze({
    schema: SESSION_CACHE_SCHEMA,
    version: SESSION_CACHE_VERSION,
    servers: Object.freeze(
      [...snapshots.values()]
        .map(normalizeServerSnapshot)
        .filter((snapshot) => snapshot.sessions.length > 0)
        .sort((left, right) => {
          const byUpdated =
            (right.sessions[0]?.info.time.updated ?? 0) -
            (left.sessions[0]?.info.time.updated ?? 0);
          return byUpdated !== 0 ? byUpdated : left.server.key.localeCompare(right.server.key);
        })
        .slice(0, SESSION_CACHE_SERVER_LIMIT),
    ),
  });
}

export function sessionCacheRows(cache: SessionCache): readonly RemoteSession[] {
  return Object.freeze(
    pruneSessionCache(cache)
      .servers.flatMap((snapshot) => snapshot.sessions)
      .sort(compareSessions),
  );
}

function decodeServerSnapshot(value: unknown): SessionCacheServerSnapshot {
  const snapshot = requireObject(value, "A saved Honk computer session cache is invalid.");
  const sessions = Reflect.get(snapshot, "sessions");
  if (!Array.isArray(sessions)) {
    throw new Error("A saved Honk computer session cache is incomplete.");
  }
  if (sessions.length > SESSION_CACHE_SESSIONS_PER_SERVER_LIMIT) {
    throw new Error("A saved Honk computer session cache contains too many sessions.");
  }
  const server = createOpenCodeServer({
    origin: requireString(snapshot, "origin", ORIGIN_LENGTH_LIMIT),
    label: requireString(snapshot, "label", LABEL_LENGTH_LIMIT),
    kind: requireServerKind(Reflect.get(snapshot, "kind")),
  });
  const decoded = sessions.map((session) => decodeSession(server, session));
  if (new Set(decoded.map((session) => session.info.id)).size !== decoded.length) {
    throw new Error("A saved Honk computer session cache contains a duplicate session.");
  }
  return Object.freeze({ server, sessions: Object.freeze(decoded) });
}

function decodeSession(server: OpenCodeServerDescriptor, value: unknown): RemoteSession {
  const session = requireObject(value, "A saved Honk session is invalid.");
  const id = requireString(session, "id", IDENTIFIER_LENGTH_LIMIT);
  const parentID = optionalString(session, "parentID", IDENTIFIER_LENGTH_LIMIT);
  const agent = optionalString(session, "agent", IDENTIFIER_LENGTH_LIMIT);
  const model = decodeModel(Reflect.get(session, "model"));
  const time = decodeTime(Reflect.get(session, "time"));
  const location = decodeLocation(Reflect.get(session, "location"));
  const status = requireSessionStatus(Reflect.get(session, "status"));
  const needsAttention = Reflect.get(session, "needsAttention");
  if (typeof needsAttention !== "boolean") {
    throw new Error("A saved Honk session has an invalid attention state.");
  }
  const info = {
    id,
    ...(parentID === undefined ? {} : { parentID }),
    projectID: requireString(session, "projectID", IDENTIFIER_LENGTH_LIMIT),
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
    // Home does not use billing or token counters, but OpenCode's session type requires them.
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time,
    title: requireString(session, "title", TITLE_LENGTH_LIMIT, false),
    location,
  } satisfies OpenCodeSessionInfo;
  return Object.freeze({
    ref: openCodeSessionRef(server.key, id),
    server,
    info: Object.freeze(info),
    projectDirectory: requireString(session, "projectDirectory", DIRECTORY_LENGTH_LIMIT),
    status,
    needsAttention,
    cached: true,
  });
}

function normalizeServerSnapshot(snapshot: SessionCacheServerSnapshot): SessionCacheServerSnapshot {
  const sessions = snapshot.sessions
    .reduce((byID, session) => {
      const normalized = normalizeSession(snapshot.server, session);
      const existing = byID.get(normalized.info.id);
      if (existing === undefined || normalized.info.time.updated >= existing.info.time.updated) {
        byID.set(normalized.info.id, normalized);
      }
      return byID;
    }, new Map<string, RemoteSession>())
    .values();
  return Object.freeze({
    server: snapshot.server,
    sessions: Object.freeze(
      [...sessions].sort(compareSessions).slice(0, SESSION_CACHE_SESSIONS_PER_SERVER_LIMIT),
    ),
  });
}

function normalizeSession(server: OpenCodeServerDescriptor, session: RemoteSession): RemoteSession {
  return decodeSession(server, {
    id: session.info.id,
    parentID: session.info.parentID,
    projectID: session.info.projectID,
    agent: session.info.agent,
    model: session.info.model,
    time: session.info.time,
    title: session.info.title,
    location: session.info.location,
    projectDirectory: session.projectDirectory,
    status: session.status,
    needsAttention: session.needsAttention,
  });
}

function normalizeServer(server: OpenCodeServerDescriptor): OpenCodeServerDescriptor {
  return createOpenCodeServer({
    origin: boundedString(server.origin, "origin", ORIGIN_LENGTH_LIMIT),
    label: boundedString(server.label, "label", LABEL_LENGTH_LIMIT),
    kind: server.kind,
  });
}

function compareSessions(left: RemoteSession, right: RemoteSession): number {
  const byUpdated = right.info.time.updated - left.info.time.updated;
  if (byUpdated !== 0) return byUpdated;
  const byServer = left.ref.server.localeCompare(right.ref.server);
  return byServer !== 0 ? byServer : left.ref.sessionID.localeCompare(right.ref.sessionID);
}

function decodeModel(value: unknown): OpenCodeSessionInfo["model"] {
  if (value === undefined || value === null) return undefined;
  const model = requireObject(value, "A saved Honk session has an invalid model.");
  const variant = optionalString(model, "variant", IDENTIFIER_LENGTH_LIMIT);
  return Object.freeze({
    id: requireString(model, "id", IDENTIFIER_LENGTH_LIMIT),
    providerID: requireString(model, "providerID", IDENTIFIER_LENGTH_LIMIT),
    ...(variant === undefined ? {} : { variant }),
  });
}

function decodeTime(value: unknown): OpenCodeSessionInfo["time"] {
  const time = requireObject(value, "A saved Honk session has invalid timestamps.");
  const archived = optionalTimestamp(time, "archived");
  return Object.freeze({
    created: requireTimestamp(time, "created"),
    updated: requireTimestamp(time, "updated"),
    ...(archived === undefined ? {} : { archived }),
  });
}

function decodeLocation(value: unknown): OpenCodeSessionInfo["location"] {
  const location = requireObject(value, "A saved Honk session has an invalid location.");
  const workspaceID = optionalString(location, "workspaceID", IDENTIFIER_LENGTH_LIMIT);
  return Object.freeze({
    directory: requireString(location, "directory", DIRECTORY_LENGTH_LIMIT),
    ...(workspaceID === undefined ? {} : { workspaceID }),
  });
}

function requireSessionStatus(value: unknown): RemoteSession["status"] {
  if (value === "running" || value === "idle" || value === "failed") return value;
  throw new Error("A saved Honk session has an invalid status.");
}

function requireServerKind(value: unknown): OpenCodeServerDescriptor["kind"] {
  if (value === "local" || value === "remote" || value === "cloud") return value;
  throw new Error("A saved Honk computer session cache has an invalid kind.");
}

function requireTimestamp(value: object, field: string): number {
  const timestamp = Reflect.get(value, field);
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`A saved Honk session has an invalid ${field} timestamp.`);
  }
  return timestamp;
}

function optionalTimestamp(value: object, field: string): number | undefined {
  const timestamp = Reflect.get(value, field);
  return timestamp === undefined ? undefined : requireTimestamp(value, field);
}

function requireObject(value: unknown, message: string): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value;
}

function requireString(value: object, field: string, limit: number, trim = true): string {
  const candidate = Reflect.get(value, field);
  if (typeof candidate !== "string") {
    throw new Error(`A saved Honk session cache has an invalid ${field}.`);
  }
  return boundedString(trim ? candidate.trim() : candidate, field, limit);
}

function optionalString(value: object, field: string, limit: number): string | undefined {
  const candidate = Reflect.get(value, field);
  if (candidate === undefined || candidate === null) return undefined;
  if (typeof candidate !== "string") {
    throw new Error(`A saved Honk session cache has an invalid ${field}.`);
  }
  const normalized = candidate.trim();
  return normalized.length === 0 ? undefined : boundedString(normalized, field, limit);
}

function boundedString(value: string, field: string, limit: number): string {
  if (value.length === 0 || value.length > limit) {
    throw new Error(`A saved Honk session cache has an invalid ${field}.`);
  }
  return value;
}
