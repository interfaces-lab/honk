import * as React from "react";
import { createMMKV } from "react-native-mmkv";
import { deleteItemAsync, getItem } from "expo-secure-store";
import { openCodeSessionKey, type OpenCodeSessionRef } from "@honk/opencode";

const DRAFT_KEY_PREFIX = "honk.mobile.composer.draft.";
const LEGACY_DRAFT_KEY_PREFIX = "honk.mobile.opencode.draft.";

// Keys are namespaced so this instance can be shared with other mobile stores.
const storage = createMMKV({ id: "honk.mobile" });

export function composerDraftKey(ref: OpenCodeSessionRef): string {
  // MMKV keys are unconstrained, so the server-qualified session key goes in verbatim. The
  // Keychain-era FNV hash survives only in legacyDraftKey, to find drafts written before the move.
  return `${DRAFT_KEY_PREFIX}${openCodeSessionKey(ref)}`;
}

export function readComposerDraft(ref: OpenCodeSessionRef): string {
  const saved = storage.getString(composerDraftKey(ref));
  if (saved !== undefined) return saved;
  return adoptLegacyDraft(ref);
}

export function writeComposerDraft(ref: OpenCodeSessionRef, text: string): void {
  if (text === "") {
    clearComposerDraft(ref);
    return;
  }
  storage.set(composerDraftKey(ref), text);
}

export function clearComposerDraft(ref: OpenCodeSessionRef): void {
  storage.remove(composerDraftKey(ref));
}

/**
 * Composer text for a session, persisted on every keystroke. MMKV writes are synchronous and
 * effectively free, so there is no debounce and no hydration gate — the first render already has
 * the saved draft.
 */
export function useComposerDraft(
  ref: OpenCodeSessionRef | null,
): readonly [string, (text: string) => void] {
  const key = ref === null ? null : composerDraftKey(ref);
  const [entry, setEntry] = React.useState(() => ({
    key,
    text: ref === null ? "" : readComposerDraft(ref),
  }));
  // Switching sessions without remounting must not carry the previous draft across. Deriving during
  // render avoids a frame where the composer shows the wrong session's text.
  const current =
    entry.key === key ? entry : { key, text: ref === null ? "" : readComposerDraft(ref) };
  if (current !== entry) setEntry(current);
  return [
    current.text,
    (text: string) => {
      if (ref !== null) writeComposerDraft(ref, text);
      setEntry({ key, text });
    },
  ];
}

// Drafts written while SecureStore backed the composer are moved to MMKV on first read and then
// dropped from the Keychain, so an in-progress draft survives the upgrade. Only a session with no
// MMKV draft reaches the Keychain, and reads happen when a thread opens rather than per keystroke.
function adoptLegacyDraft(ref: OpenCodeSessionRef): string {
  const key = legacyDraftKey(ref);
  const raw = getItem(key);
  if (raw === null) return "";
  const legacy = decodeLegacyDraft(raw);
  // The legacy key folded the session key into 32 bits, so two sessions could collide on it. A
  // draft that names another session is left in place for that session to claim.
  if (legacy !== null && legacy.sessionKey !== openCodeSessionKey(ref)) return "";
  deleteItemAsync(key).catch(() => {
    // A failed Keychain delete costs one more migration pass; adoption is idempotent.
  });
  if (legacy === null || legacy.text === "") return "";
  storage.set(composerDraftKey(ref), legacy.text);
  return legacy.text;
}

function legacyDraftKey(ref: OpenCodeSessionRef): string {
  // SecureStore restricts key characters, so the Keychain-era key was an FNV-1a hash of the session
  // key. Reproduced exactly, or an upgrade cannot find the entry it wrote.
  let hash = 0x811c9dc5;
  for (const character of openCodeSessionKey(ref)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${LEGACY_DRAFT_KEY_PREFIX}${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function decodeLegacyDraft(raw: string): { sessionKey: string; text: string } | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const sessionKey = Reflect.get(value, "sessionKey");
    const text = Reflect.get(value, "text");
    if (typeof sessionKey !== "string" || typeof text !== "string") return null;
    return { sessionKey, text };
  } catch {
    return null;
  }
}
