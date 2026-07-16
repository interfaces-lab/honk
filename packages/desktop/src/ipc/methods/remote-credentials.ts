import { safeStorage } from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

function requireSecureStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable on this device.");
  }
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    throw new Error("A Linux secret store is required to persist remote credentials.");
  }
}

export const protectRemoteCredential = makeIpcMethod({
  channel: IpcChannels.PROTECT_REMOTE_CREDENTIAL_CHANNEL,
  payload: Schema.String,
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.remoteCredential.protect")((credential) =>
    Effect.try({
      try: () => {
        requireSecureStorage();
        if (credential.length === 0) throw new Error("The remote credential is empty.");
        return safeStorage.encryptString(credential).toString("base64");
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  ),
});

export const revealRemoteCredential = makeIpcMethod({
  channel: IpcChannels.REVEAL_REMOTE_CREDENTIAL_CHANNEL,
  payload: Schema.String,
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.remoteCredential.reveal")((protectedCredential) =>
    Effect.try({
      try: () => {
        requireSecureStorage();
        if (protectedCredential.length === 0) {
          throw new Error("The protected remote credential is empty.");
        }
        return safeStorage.decryptString(Buffer.from(protectedCredential, "base64"));
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
  ),
});
