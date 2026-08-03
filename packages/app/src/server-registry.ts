import { normalizeRemoteOpenCodeOrigin } from "@honk/opencode";
import { decodeJsonResult } from "@honk/shared/schema-json";
import { Option, Result, Schema } from "effect";

const STORAGE_KEY = "honk:opencode:servers";
const STORAGE_VERSION = 1;

export type StoredRemotePairing =
  | {
      readonly phase: "exchange";
      readonly requestId: string;
      readonly protectedCredential: string | null;
    }
  | {
      readonly phase: "confirm";
      readonly requestId: string;
      readonly expiresAt: string;
      readonly protectedCredential: string | null;
    };

export type StoredRemoteServer = {
  readonly origin: string;
  readonly label: string;
  readonly protectedCredential: string | null;
  readonly pendingPairing: StoredRemotePairing | null;
  readonly paired: boolean;
  readonly removing: boolean;
};

export type StoredRemoteRegistry = {
  readonly version: typeof STORAGE_VERSION;
  readonly selectedRemoteOrigin: string | null;
  readonly servers: readonly StoredRemoteServer[];
};

type RegistryStorage = Pick<Storage, "getItem" | "setItem">;

const StoredRemotePairingSchema = Schema.Union([
  Schema.Struct({
    phase: Schema.Literal("exchange"),
    requestId: Schema.String,
    protectedCredential: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    phase: Schema.Literal("confirm"),
    requestId: Schema.String,
    expiresAt: Schema.String,
    protectedCredential: Schema.NullOr(Schema.String),
  }),
]);

const StoredRemoteServerSchema = Schema.Struct({
  origin: Schema.String,
  label: Schema.String,
  protectedCredential: Schema.NullOr(Schema.String),
  pendingPairing: Schema.optional(Schema.NullOr(StoredRemotePairingSchema)),
  paired: Schema.optional(Schema.Boolean),
  removing: Schema.optional(Schema.Boolean),
});

const StoredRemoteRegistrySchema = Schema.Struct({
  version: Schema.Literal(STORAGE_VERSION),
  // Decode these fields independently so one malformed value cannot discard valid servers.
  selectedRemoteOrigin: Schema.optionalKey(Schema.Unknown),
  servers: Schema.Array(Schema.Unknown),
});

const decodeStoredRegistryJson = decodeJsonResult(StoredRemoteRegistrySchema);
const decodeStoredRemoteServer = Schema.decodeUnknownOption(StoredRemoteServerSchema);
const decodeSelectedRemoteOrigin = Schema.decodeUnknownOption(Schema.NullOr(Schema.String));

export function readRemoteServerRegistry(
  storage: RegistryStorage | null = typeof window === "undefined" ? null : window.localStorage,
): StoredRemoteRegistry {
  if (storage === null) return emptyRemoteServerRegistry();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return emptyRemoteServerRegistry();
    const parsed = decodeStoredRegistryJson(raw);
    if (Result.isFailure(parsed)) return emptyRemoteServerRegistry();

    const servers = parsed.success.servers.flatMap((item) => {
      const decoded = decodeStoredRemoteServer(item);
      if (Option.isNone(decoded)) return [];
      try {
        return [
          {
            origin: normalizeRemoteOpenCodeOrigin(decoded.value.origin),
            label: decoded.value.label.trim(),
            protectedCredential: decoded.value.protectedCredential,
            pendingPairing: decoded.value.pendingPairing ?? null,
            paired: decoded.value.paired === true,
            removing: decoded.value.removing === true,
          },
        ];
      } catch {
        return [];
      }
    });
    const selected = decodeSelectedRemoteOrigin(parsed.success.selectedRemoteOrigin);
    if (Option.isNone(selected) || selected.value === null) {
      return { version: STORAGE_VERSION, selectedRemoteOrigin: null, servers };
    }
    try {
      const selectedRemoteOrigin = normalizeRemoteOpenCodeOrigin(selected.value);
      return {
        version: STORAGE_VERSION,
        selectedRemoteOrigin: servers.some((server) => server.origin === selectedRemoteOrigin)
          ? selectedRemoteOrigin
          : null,
        servers,
      };
    } catch {
      return { version: STORAGE_VERSION, selectedRemoteOrigin: null, servers };
    }
  } catch {
    return emptyRemoteServerRegistry();
  }
}

export function writeRemoteServerRegistry(
  registry: Omit<StoredRemoteRegistry, "version">,
  storage: RegistryStorage | null = typeof window === "undefined" ? null : window.localStorage,
): string | null {
  if (storage === null) return null;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...registry }));
    return null;
  } catch (cause) {
    return cause instanceof Error && cause.message.trim().length > 0
      ? cause.message
      : "Honk could not save the server list.";
  }
}

function emptyRemoteServerRegistry(): StoredRemoteRegistry {
  return { version: STORAGE_VERSION, selectedRemoteOrigin: null, servers: [] };
}
