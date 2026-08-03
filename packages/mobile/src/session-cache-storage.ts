import { createMMKV } from "react-native-mmkv";

import {
  EMPTY_SESSION_CACHE,
  decodeSessionCache,
  encodeSessionCache,
  pruneSessionCache,
  replaceSessionCacheServer,
  type SessionCache,
  type SessionCacheServerSnapshot,
} from "./session-cache-store";

export const SESSION_CACHE_STORAGE_KEY = "honk.mobile.opencode.sessions.v1";

// Session rows contain no credentials and can be larger than Keychain values. MMKV also gives the
// provider a synchronous restore path, so cached rows are ready before reconnect work starts.
const storage = createMMKV({ id: "honk.mobile" });

export function readSessionCache(): SessionCache {
  const raw = storage.getString(SESSION_CACHE_STORAGE_KEY);
  if (raw === undefined) return EMPTY_SESSION_CACHE;
  try {
    return decodeSessionCache(raw);
  } catch {
    // The cache is disposable. A malformed or unsupported blob must not block saved computers from
    // reconnecting, and removing it prevents every later launch from paying the same failed parse.
    try {
      storage.remove(SESSION_CACHE_STORAGE_KEY);
    } catch {
      // A failed cleanup leaves a harmless blob that the next launch will ignore again.
    }
    return EMPTY_SESSION_CACHE;
  }
}

export function writeSessionCache(cache: SessionCache): SessionCache {
  const pruned = pruneSessionCache(cache);
  try {
    if (pruned.servers.length === 0) {
      storage.remove(SESSION_CACHE_STORAGE_KEY);
      return pruned;
    }
    storage.set(SESSION_CACHE_STORAGE_KEY, encodeSessionCache(pruned));
  } catch {
    // This index is only an offline shell. Storage pressure must not fail a live refresh, pairing,
    // or durable computer removal.
  }
  return pruned;
}

export function persistSessionCacheServer(
  cache: SessionCache,
  snapshot: SessionCacheServerSnapshot,
): SessionCache {
  try {
    return writeSessionCache(replaceSessionCacheServer(cache, snapshot));
  } catch {
    // A server can return a pathological title or path. Keep the last good cache instead of
    // letting optional offline persistence break a successful live refresh.
    return cache;
  }
}
