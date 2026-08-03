import { randomUUID, timingSafeEqual } from "node:crypto";

import { Context, Effect, FileSystem, Layer, Option, Path, PlatformError, Schema } from "effect";

import { DesktopEnvironment } from "../app/desktop-environment";

const MAX_SECRET_BYTES = 16 * 1024;
const SECRET_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const ManagedEndpointSecretKind = Schema.Literals([
  "environment_signing_key",
  "host_enrollment",
  "tunnel_secret",
]);
export type ManagedEndpointSecretKind = typeof ManagedEndpointSecretKind.Type;

const ManagedEndpointSecretEnvelope = Schema.Struct({
  version: Schema.Literal(1),
  kind: ManagedEndpointSecretKind,
  ciphertext: Schema.String,
});
type ManagedEndpointSecretEnvelope = typeof ManagedEndpointSecretEnvelope.Type;

const decodeEnvelope = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ManagedEndpointSecretEnvelope),
);

export class ManagedEndpointSecretInvalidInputError extends Schema.TaggedErrorClass<ManagedEndpointSecretInvalidInputError>()(
  "ManagedEndpointSecretStore.InvalidInput",
  {},
) {}

export class ManagedEndpointSecretStoreUnavailableError extends Schema.TaggedErrorClass<ManagedEndpointSecretStoreUnavailableError>()(
  "ManagedEndpointSecretStore.Unavailable",
  {},
) {}

export class ManagedEndpointSecretNotFoundError extends Schema.TaggedErrorClass<ManagedEndpointSecretNotFoundError>()(
  "ManagedEndpointSecretStore.NotFound",
  {},
) {}

export class ManagedEndpointSecretConflictError extends Schema.TaggedErrorClass<ManagedEndpointSecretConflictError>()(
  "ManagedEndpointSecretStore.Conflict",
  {},
) {}

export class ManagedEndpointSecretStoreError extends Schema.TaggedErrorClass<ManagedEndpointSecretStoreError>()(
  "ManagedEndpointSecretStore.Failure",
  {},
) {}

export type ManagedEndpointSecretStoreFailure =
  | ManagedEndpointSecretInvalidInputError
  | ManagedEndpointSecretStoreUnavailableError
  | ManagedEndpointSecretNotFoundError
  | ManagedEndpointSecretConflictError
  | ManagedEndpointSecretStoreError;

export interface ManagedEndpointSecretInput {
  readonly reference: string;
  readonly kind: ManagedEndpointSecretKind;
}

export interface ManagedEndpointSecretPutInput extends ManagedEndpointSecretInput {
  readonly value: string;
}

export interface ManagedEndpointSecretStoreShape {
  readonly put: (
    input: ManagedEndpointSecretPutInput,
  ) => Effect.Effect<
    void,
    | ManagedEndpointSecretInvalidInputError
    | ManagedEndpointSecretStoreUnavailableError
    | ManagedEndpointSecretConflictError
    | ManagedEndpointSecretStoreError
  >;
  readonly get: (
    input: ManagedEndpointSecretInput,
  ) => Effect.Effect<
    string,
    | ManagedEndpointSecretInvalidInputError
    | ManagedEndpointSecretStoreUnavailableError
    | ManagedEndpointSecretNotFoundError
    | ManagedEndpointSecretStoreError
  >;
  readonly remove: (
    reference: string,
  ) => Effect.Effect<
    void,
    ManagedEndpointSecretInvalidInputError | ManagedEndpointSecretStoreError
  >;
}

export class ManagedEndpointSecretStore extends Context.Service<
  ManagedEndpointSecretStore,
  ManagedEndpointSecretStoreShape
>()("honk/desktop/ManagedEndpointSecretStore") {}

export interface ManagedEndpointSecretEncryptionShape {
  readonly protect: (
    value: string,
  ) => Effect.Effect<
    Uint8Array,
    ManagedEndpointSecretStoreUnavailableError | ManagedEndpointSecretStoreError
  >;
  readonly reveal: (
    value: Uint8Array,
  ) => Effect.Effect<
    string,
    ManagedEndpointSecretStoreUnavailableError | ManagedEndpointSecretStoreError
  >;
}

export class ManagedEndpointSecretEncryption extends Context.Service<
  ManagedEndpointSecretEncryption,
  ManagedEndpointSecretEncryptionShape
>()("honk/desktop/ManagedEndpointSecretEncryption") {}

export interface SafeStorageShape {
  readonly isEncryptionAvailable: () => boolean;
  readonly getSelectedStorageBackend: () => string;
  readonly encryptString: (value: string) => Buffer;
  readonly decryptString: (value: Buffer) => string;
}

export const safeStorageEncryptionLayer = (
  safeStorage: SafeStorageShape,
  platform: NodeJS.Platform,
) =>
  Layer.succeed(
    ManagedEndpointSecretEncryption,
    ManagedEndpointSecretEncryption.of({
      protect: (value) =>
        Effect.try({
          try: () => {
            requireSecureStorage(safeStorage, platform);
            return safeStorage.encryptString(value);
          },
          catch: classifySafeStorageError,
        }),
      reveal: (value) =>
        Effect.try({
          try: () => {
            requireSecureStorage(safeStorage, platform);
            return safeStorage.decryptString(Buffer.from(value));
          },
          catch: classifySafeStorageError,
        }),
    }),
  );

export const layerAt = (directory: string, platform: NodeJS.Platform) =>
  Layer.effect(
    ManagedEndpointSecretStore,
    Effect.gen(function* () {
      const encryption = yield* ManagedEndpointSecretEncryption;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      if (!path.isAbsolute(directory)) {
        return yield* new ManagedEndpointSecretStoreError({});
      }

      const read = Effect.fnUntraced(function* (
        input: ManagedEndpointSecretInput,
      ): Effect.fn.Return<
        Option.Option<string>,
        ManagedEndpointSecretStoreUnavailableError | ManagedEndpointSecretStoreError
      > {
        const result = yield* Effect.result(
          fileSystem.readFileString(secretPath(path, directory, input.reference)),
        );
        if (result._tag === "Failure") {
          if (isFileSystemError(result.failure, "NotFound")) return Option.none();
          return yield* new ManagedEndpointSecretStoreError({});
        }

        const decoded = yield* decodeEnvelope(result.success).pipe(
          Effect.mapError(() => new ManagedEndpointSecretStoreError({})),
        );
        if (
          decoded.kind !== input.kind ||
          decoded.ciphertext.length === 0 ||
          !BASE64_PATTERN.test(decoded.ciphertext)
        ) {
          return yield* new ManagedEndpointSecretStoreError({});
        }

        const protectedValue = Buffer.from(decoded.ciphertext, "base64");
        if (protectedValue.toString("base64") !== decoded.ciphertext) {
          return yield* new ManagedEndpointSecretStoreError({});
        }
        const value = yield* encryption.reveal(protectedValue);
        const byteLength = Buffer.byteLength(value, "utf8");
        if (byteLength === 0 || byteLength > MAX_SECRET_BYTES) {
          return yield* new ManagedEndpointSecretStoreError({});
        }
        return Option.some(value);
      });

      const requireInput = (
        input: ManagedEndpointSecretInput,
      ): Effect.Effect<void, ManagedEndpointSecretInvalidInputError> => {
        if (
          !SECRET_REFERENCE_PATTERN.test(input.reference) ||
          !ManagedEndpointSecretKind.literals.includes(input.kind)
        ) {
          return Effect.fail(new ManagedEndpointSecretInvalidInputError({}));
        }
        return Effect.void;
      };

      const requirePutInput = (
        input: ManagedEndpointSecretPutInput,
      ): Effect.Effect<void, ManagedEndpointSecretInvalidInputError> => {
        const byteLength = Buffer.byteLength(input.value, "utf8");
        if (byteLength === 0 || byteLength > MAX_SECRET_BYTES) {
          return Effect.fail(new ManagedEndpointSecretInvalidInputError({}));
        }
        return requireInput(input);
      };

      const requireSameValue = Effect.fnUntraced(function* (
        existing: string,
        value: string,
      ): Effect.fn.Return<void, ManagedEndpointSecretConflictError> {
        if (!sameSecret(existing, value)) {
          return yield* new ManagedEndpointSecretConflictError({});
        }
      });

      const put = Effect.fn("desktop.managedEndpointSecretStore.put")(function* (
        input: ManagedEndpointSecretPutInput,
      ) {
        yield* requirePutInput(input);
        const existing = yield* read(input);
        if (Option.isSome(existing)) {
          yield* requireSameValue(existing.value, input.value);
          return;
        }

        const protectedValue = Buffer.from(yield* encryption.protect(input.value));
        if (protectedValue.byteLength === 0) {
          return yield* new ManagedEndpointSecretStoreError({});
        }
        const ciphertext = protectedValue.toString("base64");
        const envelope: ManagedEndpointSecretEnvelope = {
          version: 1,
          kind: input.kind,
          ciphertext,
        };
        const target = secretPath(path, directory, input.reference);
        const temporary = path.join(
          directory,
          `.${input.reference}.${process.pid}.${randomUUID()}.tmp`,
        );

        yield* fileSystem
          .makeDirectory(directory, { recursive: true, mode: 0o700 })
          .pipe(Effect.mapError(() => new ManagedEndpointSecretStoreError({})));
        if (platform !== "win32") {
          yield* fileSystem
            .chmod(directory, 0o700)
            .pipe(Effect.mapError(() => new ManagedEndpointSecretStoreError({})));
        }

        yield* Effect.gen(function* () {
          yield* fileSystem
            .writeFileString(temporary, `${JSON.stringify(envelope)}\n`, {
              flag: "wx",
              mode: 0o600,
            })
            .pipe(Effect.mapError(() => new ManagedEndpointSecretStoreError({})));
          const linked = yield* Effect.result(fileSystem.link(temporary, target));
          if (linked._tag === "Success") return;
          if (!isFileSystemError(linked.failure, "AlreadyExists")) {
            return yield* new ManagedEndpointSecretStoreError({});
          }
          const winner = yield* read(input);
          if (Option.isNone(winner)) {
            return yield* new ManagedEndpointSecretStoreError({});
          }
          yield* requireSameValue(winner.value, input.value);
        }).pipe(Effect.ensuring(fileSystem.remove(temporary, { force: true }).pipe(Effect.ignore)));
      });

      const get = Effect.fn("desktop.managedEndpointSecretStore.get")(function* (
        input: ManagedEndpointSecretInput,
      ) {
        yield* requireInput(input);
        return yield* Option.match(yield* read(input), {
          onNone: () => new ManagedEndpointSecretNotFoundError({}),
          onSome: Effect.succeed,
        });
      });

      const remove = Effect.fn("desktop.managedEndpointSecretStore.remove")(function* (
        reference: string,
      ) {
        yield* requireInput({ reference, kind: "tunnel_secret" });
        yield* fileSystem
          .remove(secretPath(path, directory, reference), { force: true })
          .pipe(Effect.mapError(() => new ManagedEndpointSecretStoreError({})));
      });

      return ManagedEndpointSecretStore.of({ put, get, remove });
    }),
  );

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment;
    return layerAt(
      environment.path.join(environment.stateDir, "managed-endpoint-secrets"),
      environment.platform,
    );
  }),
);

function requireSecureStorage(safeStorage: SafeStorageShape, platform: NodeJS.Platform): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new ManagedEndpointSecretStoreUnavailableError({});
  }
  if (platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    throw new ManagedEndpointSecretStoreUnavailableError({});
  }
}

function classifySafeStorageError(
  cause: unknown,
): ManagedEndpointSecretStoreUnavailableError | ManagedEndpointSecretStoreError {
  if (cause instanceof ManagedEndpointSecretStoreUnavailableError) return cause;
  return new ManagedEndpointSecretStoreError({});
}

function secretPath(path: Path.Path, directory: string, reference: string): string {
  return path.join(directory, `${reference}.json`);
}

function isFileSystemError(
  error: PlatformError.PlatformError,
  tag: PlatformError.SystemErrorTag,
): boolean {
  return error.reason._tag === tag;
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}
