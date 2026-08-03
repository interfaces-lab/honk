import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Effect, Schema } from "effect";

import { GET_CLAUDE_AUTH_STATUS_CHANNEL } from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

// The Claude Code CLI keeps its OAuth credentials in its own store, invisible to
// the OpenCode sidecar: a login-keychain item on macOS, ~/.claude/.credentials.json
// elsewhere. Reading keychain item *metadata* (no `-w`) never touches the secret's
// ACL, so it cannot raise a macOS Keychain permission prompt.
const KEYCHAIN_SERVICE = "Claude Code-credentials";
// errSecItemNotFound. Any other nonzero exit is treated as unknown, not disconnected.
const KEYCHAIN_ITEM_NOT_FOUND_EXIT = 44;
const PROBE_TIMEOUT_MS = 2_000;
const PROBE_CACHE_TTL_MS = 5_000;

type ClaudeAuthStatus = "connected" | "disconnected" | "unknown";

let cachedProbe: { readonly status: ClaudeAuthStatus; readonly at: number } | null = null;

export const getClaudeAuthStatus = makeIpcMethod({
  channel: GET_CLAUDE_AUTH_STATUS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Literals(["connected", "disconnected", "unknown"]),
  handler: Effect.fn("desktop.ipc.claudeAuth.get")(() =>
    Effect.promise(async () => {
      if (cachedProbe !== null && Date.now() - cachedProbe.at < PROBE_CACHE_TTL_MS) {
        return cachedProbe.status;
      }
      const status = await probeClaudeAuthStatus();
      cachedProbe = { status, at: Date.now() };
      return status;
    }),
  ),
});

async function probeClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
  if (process.platform !== "darwin") return probeCredentialsFile();
  const keychain = await probeKeychainMetadata();
  if (keychain === "connected") return "connected";
  // Claude Code falls back to the credentials file when the keychain is unusable.
  const file = await probeCredentialsFile();
  if (file === "connected") return "connected";
  return keychain;
}

function probeKeychainMetadata(): Promise<ClaudeAuthStatus> {
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE],
      { timeout: PROBE_TIMEOUT_MS },
      (error) => {
        if (error === null) return resolve("connected");
        if (error.killed === true) return resolve("unknown");
        if (error.code === KEYCHAIN_ITEM_NOT_FOUND_EXIT) return resolve("disconnected");
        resolve("unknown");
      },
    );
  });
}

function probeCredentialsFile(): Promise<ClaudeAuthStatus> {
  // Existence only. Never read the file; its contents are the secret.
  return access(join(homedir(), ".claude", ".credentials.json")).then(
    () => "connected",
    (cause: NodeJS.ErrnoException) => (cause.code === "ENOENT" ? "disconnected" : "unknown"),
  );
}
