import { createOpenCodeServer, openCodeSessionRef, type OpenCodeSessionInfo } from "@honk/opencode";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RemoteSession } from "./remote-context";
import {
  EMPTY_SESSION_CACHE,
  replaceSessionCacheServer,
  SESSION_CACHE_SCHEMA,
} from "./session-cache-store";

const native = vi.hoisted(() => ({
  mmkv: new Map<string, string>(),
  failWrites: false,
}));

vi.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: (key: string): string | undefined => native.mmkv.get(key),
    set: (key: string, value: string): void => {
      if (native.failWrites) throw new Error("storage full");
      native.mmkv.set(key, value);
    },
    remove: (key: string): boolean => {
      if (native.failWrites) throw new Error("storage unavailable");
      return native.mmkv.delete(key);
    },
  }),
}));

const {
  SESSION_CACHE_STORAGE_KEY,
  persistSessionCacheServer,
  readSessionCache,
  writeSessionCache,
} = await import("./session-cache-storage");

const server = createOpenCodeServer({
  origin: "https://studio.example.com",
  label: "Studio Mac",
  kind: "cloud",
});

function session(): RemoteSession {
  const info = {
    id: "session-1",
    projectID: "project-honk",
    agent: "build",
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: { created: 1_000, updated: 2_000 },
    title: "Reconnect Honk",
    location: { directory: "/Users/me/Developer/honk" },
  } satisfies OpenCodeSessionInfo;
  return {
    ref: openCodeSessionRef(server.key, info.id),
    server,
    info,
    projectDirectory: info.location.directory,
    status: "idle",
    needsAttention: false,
    cached: false,
  };
}

beforeEach(() => {
  native.mmkv.clear();
  native.failWrites = false;
});

describe("mobile session cache MMKV storage", () => {
  it("reads an empty cache when no snapshot has been saved", () => {
    expect(readSessionCache()).toBe(EMPTY_SESSION_CACHE);
  });

  it("writes and restores cached session shells", () => {
    writeSessionCache(
      replaceSessionCacheServer(EMPTY_SESSION_CACHE, {
        server,
        sessions: [session()],
      }),
    );

    expect(native.mmkv.get(SESSION_CACHE_STORAGE_KEY)).toContain(SESSION_CACHE_SCHEMA);
    expect(readSessionCache().servers[0]?.sessions[0]).toMatchObject({
      ref: { server: server.key, sessionID: "session-1" },
      cached: true,
    });
  });

  it("removes the MMKV value when pruning leaves no rows", () => {
    native.mmkv.set(SESSION_CACHE_STORAGE_KEY, "stale");

    writeSessionCache(EMPTY_SESSION_CACHE);

    expect(native.mmkv.has(SESSION_CACHE_STORAGE_KEY)).toBe(false);
  });

  it("drops a corrupt cache without blocking restore", () => {
    native.mmkv.set(SESSION_CACHE_STORAGE_KEY, "{not json");

    expect(readSessionCache()).toBe(EMPTY_SESSION_CACHE);
    expect(native.mmkv.has(SESSION_CACHE_STORAGE_KEY)).toBe(false);
  });

  it("keeps storage failures out of live connection paths", () => {
    native.failWrites = true;
    const cache = replaceSessionCacheServer(EMPTY_SESSION_CACHE, {
      server,
      sessions: [session()],
    });

    expect(writeSessionCache(cache)).toEqual(cache);
    expect(readSessionCache()).toBe(EMPTY_SESSION_CACHE);
  });

  it("keeps invalid server metadata out of live connection paths", () => {
    const live = session();
    const invalid = {
      ...live,
      info: { ...live.info, title: "" },
    };

    expect(
      persistSessionCacheServer(EMPTY_SESSION_CACHE, {
        server,
        sessions: [invalid],
      }),
    ).toBe(EMPTY_SESSION_CACHE);
    expect(native.mmkv.has(SESSION_CACHE_STORAGE_KEY)).toBe(false);
  });
});
