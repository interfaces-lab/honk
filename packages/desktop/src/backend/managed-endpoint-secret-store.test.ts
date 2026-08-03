import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Layer, Result } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  ManagedEndpointSecretConflictError,
  ManagedEndpointSecretInvalidInputError,
  ManagedEndpointSecretNotFoundError,
  ManagedEndpointSecretStore,
  ManagedEndpointSecretStoreError,
  ManagedEndpointSecretStoreUnavailableError,
  layerAt,
  safeStorageEncryptionLayer,
  type SafeStorageShape,
} from "./managed-endpoint-secret-store";

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const makeSafeStorage = () => {
  const calls = { decrypt: 0, encrypt: 0 };
  const safeStorage: SafeStorageShape = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "keychain",
    encryptString: (value) => {
      calls.encrypt += 1;
      return Buffer.from(`protected:${value}`, "utf8");
    },
    decryptString: (value) => {
      calls.decrypt += 1;
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("protected:")) throw new Error("invalid ciphertext");
      return decoded.slice("protected:".length);
    },
  };
  return { calls, safeStorage };
};

async function makeHarness(input?: {
  readonly platform?: NodeJS.Platform;
  readonly safeStorage?: SafeStorageShape;
}) {
  const directory = await mkdtemp(join(tmpdir(), "honk-managed-secret-store-"));
  testDirectories.push(directory);
  const encryption = input?.safeStorage === undefined ? makeSafeStorage() : null;
  const safeStorage = input?.safeStorage ?? encryption?.safeStorage;
  if (safeStorage === undefined) throw new Error("safe storage is required");
  const NodeServices = await import("@effect/platform-node/NodeServices");
  return {
    directory,
    encryption,
    storeLayer: layerAt(directory, input?.platform ?? process.platform).pipe(
      Layer.provide(
        Layer.merge(
          NodeServices.layer,
          safeStorageEncryptionLayer(safeStorage, input?.platform ?? process.platform),
        ),
      ),
    ),
  };
}

describe("managed endpoint secret store", () => {
  it("persists only encrypted bytes in owner-only state and reads them back", async () => {
    const harness = await makeHarness({ platform: "darwin" });
    const secret = "tunnel-secret-that-must-not-appear-on-disk";

    const revealed = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* ManagedEndpointSecretStore;
        yield* store.put({
          reference: "tunnel_6ff42ae1",
          kind: "tunnel_secret",
          value: secret,
        });
        return yield* store.get({
          reference: "tunnel_6ff42ae1",
          kind: "tunnel_secret",
        });
      }).pipe(Effect.provide(harness.storeLayer)),
    );

    expect(revealed).toBe(secret);
    const raw = await readFile(join(harness.directory, "tunnel_6ff42ae1.json"), "utf8");
    expect(raw).not.toContain(secret);
    expect(JSON.parse(raw)).toMatchObject({
      version: 1,
      kind: "tunnel_secret",
    });
    if (process.platform !== "win32") {
      expect((await stat(harness.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(harness.directory, "tunnel_6ff42ae1.json"))).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it("makes identical writes idempotent and rejects replacement through the same reference", async () => {
    const harness = await makeHarness();
    const conflict = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* ManagedEndpointSecretStore;
        const input = {
          reference: "host_enrollment_01",
          kind: "host_enrollment" as const,
          value: "first-secret",
        };
        yield* store.put(input);
        yield* store.put(input);
        return yield* Effect.result(store.put({ ...input, value: "replacement-secret" }));
      }).pipe(Effect.provide(harness.storeLayer)),
    );

    expect(harness.encryption?.calls.encrypt).toBe(1);
    expect(Result.isFailure(conflict)).toBe(true);
    if (Result.isSuccess(conflict)) return;
    expect(conflict.failure).toEqual(new ManagedEndpointSecretConflictError({}));
    expect(JSON.stringify(conflict.failure)).not.toContain("replacement-secret");
  });

  it("atomically chooses one value when conflicting writers race", async () => {
    const harness = await makeHarness();
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* ManagedEndpointSecretStore;
        const results = yield* Effect.all(
          ["secret-a", "secret-b"].map((value) =>
            Effect.result(
              store.put({
                reference: "environment_signing_key_01",
                kind: "environment_signing_key",
                value,
              }),
            ),
          ),
          { concurrency: "unbounded" },
        );
        const value = yield* store.get({
          reference: "environment_signing_key_01",
          kind: "environment_signing_key",
        });
        return { results, value };
      }).pipe(Effect.provide(harness.storeLayer)),
    );

    expect(outcome.results.filter(Result.isSuccess)).toHaveLength(1);
    expect(outcome.results.filter(Result.isFailure)).toHaveLength(1);
    const failed = outcome.results.find(Result.isFailure);
    expect(failed?.failure).toEqual(new ManagedEndpointSecretConflictError({}));
    const first = outcome.results[0];
    if (first === undefined) throw new Error("expected two write results");
    expect(outcome.value).toBe(Result.isSuccess(first) ? "secret-a" : "secret-b");
  });

  it("rejects path traversal, empty values, and oversized values before writing", async () => {
    const harness = await makeHarness();
    const failures = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* ManagedEndpointSecretStore;
        return yield* Effect.all([
          Effect.result(
            store.put({
              reference: "../outside",
              kind: "tunnel_secret",
              value: "secret",
            }),
          ),
          Effect.result(
            store.put({
              reference: "empty_secret",
              kind: "tunnel_secret",
              value: "",
            }),
          ),
          Effect.result(
            store.put({
              reference: "large_secret",
              kind: "tunnel_secret",
              value: "x".repeat(16 * 1024 + 1),
            }),
          ),
        ]);
      }).pipe(Effect.provide(harness.storeLayer)),
    );

    failures.forEach((failure) => {
      expect(Result.isFailure(failure)).toBe(true);
      if (Result.isSuccess(failure)) return;
      expect(failure.failure).toEqual(new ManagedEndpointSecretInvalidInputError({}));
    });
  });

  it("fails closed when secure OS storage is unavailable or Linux falls back to plaintext", async () => {
    const unavailable = await makeHarness({
      platform: "darwin",
      safeStorage: {
        ...makeSafeStorage().safeStorage,
        isEncryptionAvailable: () => false,
      },
    });
    const plaintextLinux = await makeHarness({
      platform: "linux",
      safeStorage: {
        ...makeSafeStorage().safeStorage,
        getSelectedStorageBackend: () => "basic_text",
      },
    });

    const failures = await Promise.all(
      [unavailable, plaintextLinux].map((harness) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const store = yield* ManagedEndpointSecretStore;
            return yield* Effect.result(
              store.put({
                reference: "tunnel_secret_01",
                kind: "tunnel_secret",
                value: "must-remain-private",
              }),
            );
          }).pipe(Effect.provide(harness.storeLayer)),
        ),
      ),
    );

    failures.forEach((failure) => {
      expect(Result.isFailure(failure)).toBe(true);
      if (Result.isSuccess(failure)) return;
      expect(failure.failure).toEqual(new ManagedEndpointSecretStoreUnavailableError({}));
      expect(JSON.stringify(failure.failure)).not.toContain("must-remain-private");
    });
  });

  it("maps corrupt or confused-kind envelopes to payload-free failures", async () => {
    const harness = await makeHarness();
    const path = join(harness.directory, "corrupt_secret.json");
    await writeFile(path, '{"version":1,"kind":"tunnel_secret","ciphertext":"not base64!"}\n', {
      mode: 0o600,
    });

    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* ManagedEndpointSecretStore;
        return yield* Effect.result(
          store.get({
            reference: "corrupt_secret",
            kind: "host_enrollment",
          }),
        );
      }).pipe(Effect.provide(harness.storeLayer)),
    );

    expect(Result.isFailure(failure)).toBe(true);
    if (Result.isSuccess(failure)) return;
    expect(failure.failure).toEqual(new ManagedEndpointSecretStoreError({}));
    expect(JSON.stringify(failure.failure)).not.toContain("not base64");
  });

  it("removes a secret idempotently and returns a typed miss", async () => {
    const harness = await makeHarness();
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* ManagedEndpointSecretStore;
        yield* store.put({
          reference: "tunnel_secret_to_remove",
          kind: "tunnel_secret",
          value: "secret",
        });
        yield* store.remove("tunnel_secret_to_remove");
        yield* store.remove("tunnel_secret_to_remove");
        return yield* Effect.result(
          store.get({
            reference: "tunnel_secret_to_remove",
            kind: "tunnel_secret",
          }),
        );
      }).pipe(Effect.provide(harness.storeLayer)),
    );

    expect(Result.isFailure(failure)).toBe(true);
    if (Result.isSuccess(failure)) return;
    expect(failure.failure).toEqual(new ManagedEndpointSecretNotFoundError({}));
  });
});
