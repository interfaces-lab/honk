import {
  createOpenCodeServer,
  openCodeSessionRef,
  type OpenCodeServerDescriptor,
  type OpenCodeSessionInfo,
} from "@honk/opencode";
import { describe, expect, it } from "vitest";

import type { RemoteSession } from "./remote-context";
import {
  EMPTY_SESSION_CACHE,
  SESSION_CACHE_SCHEMA,
  SESSION_CACHE_SERVER_LIMIT,
  SESSION_CACHE_SESSIONS_PER_SERVER_LIMIT,
  SESSION_CACHE_VERSION,
  decodeSessionCache,
  encodeSessionCache,
  mergeSessionCacheServer,
  pruneSessionCache,
  removeSessionCacheServer,
  replaceSessionCacheServer,
  sessionCacheRows,
} from "./session-cache-store";

const studio = createOpenCodeServer({
  origin: "https://studio.example.com",
  label: "Studio Mac",
  kind: "cloud",
});
const laptop = createOpenCodeServer({
  origin: "https://laptop.example.com",
  label: "Laptop",
});

function remoteSession(
  server: OpenCodeServerDescriptor,
  id: string,
  updated: number,
  input: {
    readonly title?: string;
    readonly projectID?: string;
    readonly projectDirectory?: string;
    readonly status?: RemoteSession["status"];
    readonly needsAttention?: boolean;
    readonly archived?: number;
    readonly parentID?: string;
  } = {},
): RemoteSession {
  const directory = input.projectDirectory ?? "/Users/me/Developer/honk";
  const info = {
    id,
    ...(input.parentID === undefined ? {} : { parentID: input.parentID }),
    projectID: input.projectID ?? "project-honk",
    agent: "build",
    model: { id: "gpt-5", providerID: "openai", variant: "high" },
    cost: 12.5,
    tokens: {
      input: 1_000,
      output: 200,
      reasoning: 100,
      cache: { read: 500, write: 10 },
    },
    time: {
      created: Math.max(0, updated - 100),
      updated,
      ...(input.archived === undefined ? {} : { archived: input.archived }),
    },
    title: input.title ?? `Session ${id}`,
    location: { directory, workspaceID: "workspace-honk" },
    subpath: "packages/mobile",
  } satisfies OpenCodeSessionInfo;
  return {
    ref: openCodeSessionRef(server.key, id),
    server,
    info,
    projectDirectory: directory,
    status: input.status ?? "idle",
    needsAttention: input.needsAttention ?? false,
    cached: false,
  };
}

describe("mobile session cache storage", () => {
  it("uses an immutable empty cache for a missing value", () => {
    expect(decodeSessionCache(null)).toBe(EMPTY_SESSION_CACHE);
  });

  it("round-trips the metadata used by Home without serializing usage or credentials", () => {
    const session = remoteSession(studio, "session-1", 2_000, {
      status: "running",
      needsAttention: true,
      archived: 2_500,
      parentID: "session-parent",
    });
    const encoded = encodeSessionCache(
      replaceSessionCacheServer(EMPTY_SESSION_CACHE, {
        server: studio,
        sessions: [session],
      }),
    );

    expect(JSON.parse(encoded)).toEqual({
      schema: SESSION_CACHE_SCHEMA,
      version: SESSION_CACHE_VERSION,
      servers: [
        {
          origin: "https://studio.example.com",
          label: "Studio Mac",
          kind: "cloud",
          sessions: [
            {
              id: "session-1",
              parentID: "session-parent",
              projectID: "project-honk",
              agent: "build",
              model: { id: "gpt-5", providerID: "openai", variant: "high" },
              time: { created: 1_900, updated: 2_000, archived: 2_500 },
              title: "Session session-1",
              location: {
                directory: "/Users/me/Developer/honk",
                workspaceID: "workspace-honk",
              },
              projectDirectory: "/Users/me/Developer/honk",
              status: "running",
              needsAttention: true,
            },
          ],
        },
      ],
    });
    expect(encoded).not.toContain("password");
    expect(encoded).not.toContain("token");
    expect(encoded).not.toContain('"cost"');

    const decoded = decodeSessionCache(encoded);
    expect(decoded.servers[0]?.server).toEqual(studio);
    expect(decoded.servers[0]?.sessions[0]).toMatchObject({
      ref: { server: studio.key, sessionID: "session-1" },
      server: studio,
      info: {
        id: "session-1",
        parentID: "session-parent",
        projectID: "project-honk",
        agent: "build",
        model: { id: "gpt-5", providerID: "openai", variant: "high" },
        time: { created: 1_900, updated: 2_000, archived: 2_500 },
        title: "Session session-1",
        location: {
          directory: "/Users/me/Developer/honk",
          workspaceID: "workspace-honk",
        },
      },
      projectDirectory: "/Users/me/Developer/honk",
      status: "running",
      needsAttention: true,
      cached: true,
    });
    expect(decoded.servers[0]?.sessions[0]?.info.cost).toBe(0);
    expect(decoded.servers[0]?.sessions[0]?.info.tokens).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    });
  });

  it("normalizes untrusted strings and optional empty fields", () => {
    const decoded = decodeSessionCache({
      schema: SESSION_CACHE_SCHEMA,
      version: SESSION_CACHE_VERSION,
      servers: [
        {
          origin: " HTTPS://STUDIO.EXAMPLE.COM/ ",
          label: " Studio Mac ",
          kind: "remote",
          sessions: [
            {
              id: " session-1 ",
              parentID: " ",
              projectID: " project-honk ",
              agent: "",
              model: null,
              time: { created: 1_000, updated: 2_000 },
              title: "Untitled draft",
              location: {
                directory: " /Users/me/Developer/honk ",
                workspaceID: " ",
              },
              projectDirectory: " /Users/me/Developer/honk ",
              status: "idle",
              needsAttention: false,
            },
          ],
        },
      ],
    });

    expect(decoded.servers[0]?.server).toMatchObject({
      key: "https://studio.example.com",
      origin: "https://studio.example.com",
      label: "Studio Mac",
    });
    expect(decoded.servers[0]?.sessions[0]).toMatchObject({
      ref: { server: "https://studio.example.com", sessionID: "session-1" },
      info: {
        id: "session-1",
        projectID: "project-honk",
        location: { directory: "/Users/me/Developer/honk" },
      },
      projectDirectory: "/Users/me/Developer/honk",
    });
    expect(decoded.servers[0]?.sessions[0]?.info.parentID).toBeUndefined();
    expect(decoded.servers[0]?.sessions[0]?.info.agent).toBeUndefined();
    expect(decoded.servers[0]?.sessions[0]?.info.model).toBeUndefined();
    expect(decoded.servers[0]?.sessions[0]?.info.location.workspaceID).toBeUndefined();
  });

  it("replaces one computer's complete snapshot and removes empty snapshots", () => {
    const initial = pruneSessionCache({
      schema: SESSION_CACHE_SCHEMA,
      version: SESSION_CACHE_VERSION,
      servers: [
        { server: studio, sessions: [remoteSession(studio, "old", 1_000)] },
        { server: laptop, sessions: [remoteSession(laptop, "laptop", 2_000)] },
      ],
    });
    const replaced = replaceSessionCacheServer(initial, {
      server: studio,
      sessions: [remoteSession(studio, "new", 3_000)],
    });

    expect(sessionCacheRows(replaced).map((session) => session.info.id)).toEqual(["new", "laptop"]);
    expect(
      replaceSessionCacheServer(replaced, { server: studio, sessions: [] }).servers.map(
        (snapshot) => snapshot.server.key,
      ),
    ).toEqual([laptop.key]);
  });

  it("merges by session ID without letting an older row overwrite a newer row", () => {
    const cached = replaceSessionCacheServer(EMPTY_SESSION_CACHE, {
      server: studio,
      sessions: [
        remoteSession(studio, "same", 3_000, { title: "Fresh" }),
        remoteSession(studio, "cached", 1_000),
      ],
    });
    const renamed = createOpenCodeServer({
      origin: studio.origin,
      label: "Office Mac",
      kind: "cloud",
    });
    const merged = mergeSessionCacheServer(cached, {
      server: renamed,
      sessions: [
        remoteSession(renamed, "same", 2_000, { title: "Stale" }),
        remoteSession(renamed, "incoming", 4_000),
      ],
    });

    expect(merged.servers[0]?.server.label).toBe("Office Mac");
    expect(
      merged.servers[0]?.sessions.map((session) => [session.info.id, session.info.title]),
    ).toEqual([
      ["incoming", "Session incoming"],
      ["same", "Fresh"],
      ["cached", "Session cached"],
    ]);
    expect(cached.servers[0]?.server.label).toBe("Studio Mac");
    expect(cached.servers[0]?.sessions.map((session) => session.info.id)).toEqual([
      "same",
      "cached",
    ]);
  });

  it("prunes each computer and the computer list by recency", () => {
    const newestStudioSessions = Array.from(
      { length: SESSION_CACHE_SESSIONS_PER_SERVER_LIMIT + 2 },
      (_, index) => remoteSession(studio, `studio-${index}`, 20_000 + index),
    );
    const servers = Array.from({ length: SESSION_CACHE_SERVER_LIMIT + 2 }, (_, index) => {
      const server = createOpenCodeServer({
        origin: `https://computer-${index}.example.com`,
        label: `Computer ${index}`,
      });
      return {
        server,
        sessions: [remoteSession(server, `session-${index}`, 10_000 + index)],
      };
    });
    const pruned = pruneSessionCache({
      schema: SESSION_CACHE_SCHEMA,
      version: SESSION_CACHE_VERSION,
      servers: [{ server: studio, sessions: newestStudioSessions }, ...servers],
    });

    const studioSnapshot = pruned.servers.find((snapshot) => snapshot.server.key === studio.key);
    expect(studioSnapshot?.sessions).toHaveLength(SESSION_CACHE_SESSIONS_PER_SERVER_LIMIT);
    expect(studioSnapshot?.sessions[0]?.info.id).toBe(
      `studio-${SESSION_CACHE_SESSIONS_PER_SERVER_LIMIT + 1}`,
    );
    expect(studioSnapshot?.sessions.at(-1)?.info.id).toBe("studio-2");
    expect(pruned.servers).toHaveLength(SESSION_CACHE_SERVER_LIMIT);
    expect(pruned.servers.some((snapshot) => snapshot.server.label === "Computer 0")).toBe(false);
  });

  it("removes a computer and returns all rows in deterministic recency order", () => {
    const cache = pruneSessionCache({
      schema: SESSION_CACHE_SCHEMA,
      version: SESSION_CACHE_VERSION,
      servers: [
        { server: studio, sessions: [remoteSession(studio, "studio", 1_000)] },
        { server: laptop, sessions: [remoteSession(laptop, "laptop", 2_000)] },
      ],
    });

    expect(sessionCacheRows(cache).map((session) => session.info.id)).toEqual(["laptop", "studio"]);
    expect(removeSessionCacheServer(cache, studio.key).servers).toHaveLength(1);
    expect(removeSessionCacheServer(cache, studio.key).servers[0]?.server.key).toBe(laptop.key);
  });

  it.each([
    [
      "schema",
      {
        schema: "other",
        version: SESSION_CACHE_VERSION,
        servers: [],
      },
    ],
    [
      "version",
      {
        schema: SESSION_CACHE_SCHEMA,
        version: 2,
        servers: [],
      },
    ],
    [
      "computer kind",
      {
        schema: SESSION_CACHE_SCHEMA,
        version: SESSION_CACHE_VERSION,
        servers: [{ origin: studio.origin, label: studio.label, kind: "phone", sessions: [] }],
      },
    ],
    [
      "embedded credentials",
      {
        schema: SESSION_CACHE_SCHEMA,
        version: SESSION_CACHE_VERSION,
        servers: [
          {
            origin: "https://user:secret@studio.example.com",
            label: studio.label,
            kind: studio.kind,
            sessions: [],
          },
        ],
      },
    ],
  ])("rejects an invalid %s", (_name, value) => {
    expect(() => decodeSessionCache(value)).toThrow();
  });

  it("rejects malformed, duplicate, and over-limit untrusted indexes", () => {
    expect(() => decodeSessionCache("not json")).toThrow();
    expect(() =>
      decodeSessionCache({
        schema: SESSION_CACHE_SCHEMA,
        version: SESSION_CACHE_VERSION,
        servers: [
          { origin: studio.origin, label: studio.label, kind: studio.kind, sessions: [] },
          { origin: `${studio.origin}/`, label: studio.label, kind: studio.kind, sessions: [] },
        ],
      }),
    ).toThrow("duplicate computer");
    expect(() =>
      decodeSessionCache({
        schema: SESSION_CACHE_SCHEMA,
        version: SESSION_CACHE_VERSION,
        servers: Array.from({ length: SESSION_CACHE_SERVER_LIMIT + 1 }),
      }),
    ).toThrow("too many computers");
    expect(() =>
      decodeSessionCache({
        schema: SESSION_CACHE_SCHEMA,
        version: SESSION_CACHE_VERSION,
        servers: [
          {
            origin: studio.origin,
            label: studio.label,
            kind: studio.kind,
            sessions: Array.from({ length: SESSION_CACHE_SESSIONS_PER_SERVER_LIMIT + 1 }),
          },
        ],
      }),
    ).toThrow("too many sessions");
  });

  it("rejects invalid session fields and duplicate IDs", () => {
    const saved = JSON.parse(
      encodeSessionCache(
        replaceSessionCacheServer(EMPTY_SESSION_CACHE, {
          server: studio,
          sessions: [remoteSession(studio, "session-1", 2_000)],
        }),
      ),
    );
    const session = saved.servers[0].sessions[0];

    expect(() =>
      decodeSessionCache({
        ...saved,
        servers: [
          {
            ...saved.servers[0],
            sessions: [{ ...session, status: "queued" }],
          },
        ],
      }),
    ).toThrow("invalid status");
    expect(() =>
      decodeSessionCache({
        ...saved,
        servers: [
          {
            ...saved.servers[0],
            sessions: [{ ...session, needsAttention: "yes" }],
          },
        ],
      }),
    ).toThrow("invalid attention");
    expect(() =>
      decodeSessionCache({
        ...saved,
        servers: [
          {
            ...saved.servers[0],
            sessions: [session, session],
          },
        ],
      }),
    ).toThrow("duplicate session");
  });
});
