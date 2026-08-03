import {
  openCodeServerKey,
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeSessionRef,
} from "@honk/opencode";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  mmkv: new Map<string, string>(),
  keychain: new Map<string, string>(),
  getItem: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: (key: string): string | undefined => native.mmkv.get(key),
    set: (key: string, value: string): void => {
      native.mmkv.set(key, value);
    },
    remove: (key: string): boolean => native.mmkv.delete(key),
  }),
}));

vi.mock("expo-secure-store", () => ({
  getItem: (key: string): string | null => {
    native.getItem(key);
    return native.keychain.get(key) ?? null;
  },
  deleteItemAsync: async (key: string): Promise<void> => {
    native.deleteItemAsync(key);
    native.keychain.delete(key);
  },
}));

const { clearComposerDraft, composerDraftKey, readComposerDraft, writeComposerDraft } =
  await import("./draft-store");

const session = openCodeSessionRef(openCodeServerKey("https://studio.example.com"), "ses_alpha");
const otherSession = openCodeSessionRef(
  openCodeServerKey("https://laptop.example.com"),
  "ses_alpha",
);

// Duplicated from the store on purpose: the exact Keychain key IS the migration contract, so a
// change to either copy has to be a deliberate one.
function legacyKey(ref: OpenCodeSessionRef): string {
  let hash = 0x811c9dc5;
  for (const character of openCodeSessionKey(ref)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `honk.mobile.opencode.draft.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

beforeEach(() => {
  native.mmkv.clear();
  native.keychain.clear();
  native.getItem.mockClear();
  native.deleteItemAsync.mockClear();
});

describe("composer draft store", () => {
  it("restores an unsent draft when the thread is reopened", () => {
    writeComposerDraft(session, "ship the queue tray");

    expect(readComposerDraft(session)).toBe("ship the queue tray");
  });

  it("reports no draft for a session that has never been typed in", () => {
    expect(readComposerDraft(session)).toBe("");
  });

  it("keys drafts by server as well as session so two servers cannot share one", () => {
    writeComposerDraft(session, "studio draft");

    expect(readComposerDraft(otherSession)).toBe("");
    expect(composerDraftKey(session)).not.toBe(composerDraftKey(otherSession));
  });

  it("stores the draft under a readable session key rather than a hash", () => {
    expect(composerDraftKey(session)).toBe(
      `honk.mobile.composer.draft.${openCodeSessionKey(session)}`,
    );
  });

  it("drops the saved draft once the message is sent", () => {
    writeComposerDraft(session, "sent");
    clearComposerDraft(session);

    expect(readComposerDraft(session)).toBe("");
    expect(native.mmkv.has(composerDraftKey(session))).toBe(false);
  });

  it("drops the saved draft when the composer is emptied by hand", () => {
    writeComposerDraft(session, "typed then deleted");
    writeComposerDraft(session, "");

    expect(native.mmkv.has(composerDraftKey(session))).toBe(false);
  });
});

describe("composer draft migration off the Keychain", () => {
  it("moves a draft written by the SecureStore composer and forgets the Keychain entry", () => {
    native.keychain.set(
      legacyKey(session),
      JSON.stringify({ sessionKey: openCodeSessionKey(session), text: "half-written reply" }),
    );

    expect(readComposerDraft(session)).toBe("half-written reply");
    expect(native.mmkv.get(composerDraftKey(session))).toBe("half-written reply");
    expect(native.deleteItemAsync).toHaveBeenCalledWith(legacyKey(session));
    expect(native.keychain.size).toBe(0);
  });

  it("leaves a legacy entry recorded against a different session for that session to claim", () => {
    // The legacy key folded the session key into 32 bits, so a collision could point one session at
    // another's draft. The stored session key is the guard, and the entry must survive the miss.
    native.keychain.set(
      legacyKey(session),
      JSON.stringify({ sessionKey: openCodeSessionKey(otherSession), text: "someone else's" }),
    );

    expect(readComposerDraft(session)).toBe("");
    expect(native.mmkv.has(composerDraftKey(session))).toBe(false);
    expect(native.keychain.size).toBe(1);
  });

  it("discards a legacy entry that is not a readable draft", () => {
    native.keychain.set(legacyKey(session), "{not json");

    expect(readComposerDraft(session)).toBe("");
    expect(native.mmkv.has(composerDraftKey(session))).toBe(false);
    expect(native.keychain.size).toBe(0);
  });

  it("does not touch the Keychain once the draft lives in MMKV", () => {
    writeComposerDraft(session, "already migrated");

    expect(readComposerDraft(session)).toBe("already migrated");
    expect(native.getItem).not.toHaveBeenCalled();
  });
});
