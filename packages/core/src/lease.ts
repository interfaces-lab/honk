/**
 * The writer lease: one live host per data directory.
 *
 * Pi session files and the trust store have no cross-process coordination, so
 * the host that owns them must be alone. The lease is a file under the data
 * directory whose freshness is the liveness signal: the owning host rewrites
 * it on a heartbeat, and a lease older than {@link staleMilliseconds} belongs
 * to a host that crashed and may be taken over. No pid, no platform API —
 * mtime is the whole protocol, which keeps this module on the injected
 * `ExecutionEnv` like everything else in core.
 *
 * The takeover check is read-then-write, not atomic. Two hosts racing the
 * same stale lease in the same instant can both win; the lease protects
 * against the real accident — starting a second copy of the app — not an
 * adversary.
 *
 * @module
 */

import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import { Clock, Effect, Schedule, Schema } from "effect";

/** A lease this old without a heartbeat is stale on sight: its owner is dead. */
const staleMilliseconds = 6_000;

/** How often the owning host refreshes the lease file's mtime. */
const heartbeatInterval = "2 seconds";

/**
 * How long a contender watches a fresh lease before deciding.
 *
 * Long enough to span two heartbeats, so a live owner is guaranteed to move
 * the mtime inside the window; short enough that recovering from a killed
 * host — a crashed app, a dev server restarting its main process — costs
 * seconds, not a lockout.
 */
const observeMilliseconds = 5_000;

const leaseFile = "lease";

/**
 * Another live Honk Core owns this data directory.
 *
 * Raised at construction: `createHonkCore` rejects with it and nothing is
 * left running. The remedy is to use the running host or close it.
 *
 * @category errors
 */
export class LeaseError extends Schema.TaggedErrorClass<LeaseError>()("HonkLeaseError", {
  code: Schema.tag("core.lease_conflict"),
  message: Schema.tag("Another Honk Core already owns this data directory."),
  dataDirectory: Schema.NonEmptyString,
}) {}

/**
 * Acquires the lease for the calling scope, or fails with {@link LeaseError}.
 *
 * A missing or stale lease is taken immediately. A fresh lease is *observed*
 * for {@link observeMilliseconds}: a live owner's heartbeat moves the mtime
 * inside that window and the contender fails; an unmoved mtime means the
 * owner died without cleaning up — the ordinary shape of a killed dev server
 * or a crashed app — and the lease is taken over. Liveness is proven by
 * observation, not claimed by a pid, so the protocol needs nothing from the
 * platform.
 *
 * The scope owns the heartbeat and the release: closing it stops the refresh
 * and removes the lease file, so a clean shutdown frees the directory with no
 * wait at all.
 */
export const acquire = (storage: ExecutionEnv, dataDirectory: string) =>
  Effect.gen(function* () {
    // The lease is the first thing a fresh host ever writes, so it also
    // brings the data directory into existence. A failure here surfaces
    // through the write below rather than separately.
    yield* Effect.promise(() => storage.createDir(".", { recursive: true }));

    const existing = yield* Effect.promise(() => storage.fileInfo(leaseFile));
    if (existing.ok) {
      const age = (yield* Clock.currentTimeMillis) - existing.value.mtimeMs;
      if (age < staleMilliseconds) {
        yield* Effect.sleep(observeMilliseconds);
        const observed = yield* Effect.promise(() => storage.fileInfo(leaseFile));
        // A heartbeat moved the file: the owner is alive. A vanished file is
        // an owner that closed cleanly mid-observation; an unmoved one is an
        // owner that died. Both leave the lease free to take.
        if (observed.ok && observed.value.mtimeMs !== existing.value.mtimeMs) {
          return yield* new LeaseError({ dataDirectory });
        }
      }
    }

    const write = Effect.promise(() => storage.writeFile(leaseFile, crypto.randomUUID()));
    const written = yield* write;
    if (!written.ok) {
      // Could not claim the directory at all — unreadable and unwritable are
      // both "not ours", and construction must refuse rather than run
      // storage-less.
      return yield* new LeaseError({ dataDirectory });
    }

    // Registered before the heartbeat fork so it runs after the fiber is
    // interrupted: the last act of the scope is releasing the file.
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => storage.remove(leaseFile, { recursive: false, force: true })).pipe(
        Effect.ignore,
      ),
    );

    // The heartbeat only refreshes mtime; a failed beat is retried on the
    // next tick, and staleness gives other hosts the honest signal either way.
    yield* Effect.forkScoped(
      write.pipe(Effect.ignore, Effect.repeat(Schedule.spaced(heartbeatInterval))),
    );
  });

// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Lease from "./lease";
