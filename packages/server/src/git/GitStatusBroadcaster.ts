import { realpathSync } from "node:fs";

import {
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  PubSub,
  Ref,
  Scope,
  Stream,
  SynchronizedRef,
} from "effect";
import type {
  GitStatusInput,
  GitStatusLocalResult,
  GitStatusRemoteResult,
  GitStatusStreamEvent,
} from "@honk/contracts";
import { mergeGitStatusParts } from "@honk/shared/git";
import { normalizePathSeparators } from "@honk/shared/paths";

import {
  GitStatusBroadcaster,
  type GitStatusBroadcasterShape,
} from "./GitStatusBroadcaster.service.ts";
import { GitManager } from "./GitManager.service.ts";

const GIT_STATUS_REFRESH_INTERVAL = Duration.minutes(5);
const GIT_STATUS_REFRESH_FAILURE_BASE_DELAY = Duration.minutes(1);
const GIT_STATUS_REFRESH_FAILURE_MAX_DELAY = Duration.minutes(15);

export interface GitStatusBroadcasterOptions {
  readonly remoteRefreshInterval?: Duration.Duration;
  readonly remoteRefreshFailureBaseDelay?: Duration.Duration;
  readonly remoteRefreshFailureMaxDelay?: Duration.Duration;
}

interface GitStatusChange {
  readonly cwd: string;
  readonly event: GitStatusStreamEvent;
}

interface CachedValue<T> {
  readonly fingerprint: string;
  readonly value: T;
}

interface CachedGitStatus {
  readonly local: CachedValue<GitStatusLocalResult> | null;
  readonly remote: CachedValue<GitStatusRemoteResult | null> | null;
}

interface ActiveRemotePoller {
  readonly fiber: Fiber.Fiber<void, never>;
  readonly subscriberCount: number;
}

const normalizeCwd = (cwd: string): Effect.Effect<string> =>
  Effect.try({
    try: () => normalizePathSeparators(realpathSync.native(cwd)),
    catch: () => cwd,
  }).pipe(Effect.catch((fallback) => Effect.succeed(fallback)));

function fingerprintStatusPart(status: unknown): string {
  return JSON.stringify(status);
}

export function remoteRefreshFailureDelay(
  consecutiveFailures: number,
  configuredInterval: Duration.Duration,
  options?: {
    readonly baseDelay?: Duration.Duration;
    readonly maxDelay?: Duration.Duration;
  },
) {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const backoffMs =
    Duration.toMillis(options?.baseDelay ?? GIT_STATUS_REFRESH_FAILURE_BASE_DELAY) *
    Math.pow(2, exponent);
  const cappedBackoff = Duration.min(
    Duration.millis(backoffMs),
    options?.maxDelay ?? GIT_STATUS_REFRESH_FAILURE_MAX_DELAY,
  );
  return Duration.max(configuredInterval, cappedBackoff);
}

export const makeGitStatusBroadcasterLive = (options: GitStatusBroadcasterOptions = {}) =>
  Layer.effect(
    GitStatusBroadcaster,
    Effect.gen(function* () {
      const remoteRefreshInterval = options.remoteRefreshInterval ?? GIT_STATUS_REFRESH_INTERVAL;
      const remoteRefreshFailureBaseDelay =
        options.remoteRefreshFailureBaseDelay ?? GIT_STATUS_REFRESH_FAILURE_BASE_DELAY;
      const remoteRefreshFailureMaxDelay =
        options.remoteRefreshFailureMaxDelay ?? GIT_STATUS_REFRESH_FAILURE_MAX_DELAY;
      const gitManager = yield* GitManager;
      const changesPubSub = yield* Effect.acquireRelease(
        PubSub.unbounded<GitStatusChange>(),
        (pubsub) => PubSub.shutdown(pubsub),
      );
      const broadcasterScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const cacheRef = yield* Ref.make(new Map<string, CachedGitStatus>());
      const pollersRef = yield* SynchronizedRef.make(new Map<string, ActiveRemotePoller>());

      const getCachedStatus = Effect.fn("getCachedStatus")(function* (cwd: string) {
        return yield* Ref.get(cacheRef).pipe(Effect.map((cache) => cache.get(cwd) ?? null));
      });

      const updateCachedLocalStatus = Effect.fn("updateCachedLocalStatus")(function* (
        cwd: string,
        local: GitStatusLocalResult,
        options?: { publish?: boolean },
      ) {
        const nextLocal = {
          fingerprint: fingerprintStatusPart(local),
          value: local,
        } satisfies CachedValue<GitStatusLocalResult>;
        const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
          const previous = cache.get(cwd) ?? { local: null, remote: null };
          const nextCache = new Map(cache);
          nextCache.set(cwd, {
            ...previous,
            local: nextLocal,
          });
          return [previous.local?.fingerprint !== nextLocal.fingerprint, nextCache] as const;
        });

        if (options?.publish && shouldPublish) {
          yield* PubSub.publish(changesPubSub, {
            cwd,
            event: {
              _tag: "localUpdated",
              local,
            },
          });
        }

        return local;
      });

      const updateCachedRemoteStatus = Effect.fn("updateCachedRemoteStatus")(function* (
        cwd: string,
        remote: GitStatusRemoteResult | null,
        options?: { publish?: boolean },
      ) {
        const nextRemote = {
          fingerprint: fingerprintStatusPart(remote),
          value: remote,
        } satisfies CachedValue<GitStatusRemoteResult | null>;
        const shouldPublish = yield* Ref.modify(cacheRef, (cache) => {
          const previous = cache.get(cwd) ?? { local: null, remote: null };
          const nextCache = new Map(cache);
          nextCache.set(cwd, {
            ...previous,
            remote: nextRemote,
          });
          return [previous.remote?.fingerprint !== nextRemote.fingerprint, nextCache] as const;
        });

        if (options?.publish && shouldPublish) {
          yield* PubSub.publish(changesPubSub, {
            cwd,
            event: {
              _tag: "remoteUpdated",
              remote,
            },
          });
        }

        return remote;
      });

      const loadLocalStatus = Effect.fn("loadLocalStatus")(function* (cwd: string) {
        const local = yield* gitManager.localStatus({ cwd });
        return yield* updateCachedLocalStatus(cwd, local);
      });

      const loadRemoteStatus = Effect.fn("loadRemoteStatus")(function* (cwd: string) {
        const remote = yield* gitManager.remoteStatus({ cwd });
        return yield* updateCachedRemoteStatus(cwd, remote);
      });

      const getOrLoadLocalStatus = Effect.fn("getOrLoadLocalStatus")(function* (cwd: string) {
        const cached = yield* getCachedStatus(cwd);
        if (cached?.local) {
          return cached.local.value;
        }
        return yield* loadLocalStatus(cwd);
      });

      const getOrLoadRemoteStatus = Effect.fn("getOrLoadRemoteStatus")(function* (cwd: string) {
        const cached = yield* getCachedStatus(cwd);
        if (cached?.remote) {
          return cached.remote.value;
        }
        return yield* loadRemoteStatus(cwd);
      });

      const getStatus: GitStatusBroadcasterShape["getStatus"] = Effect.fn("getStatus")(function* (
        input: GitStatusInput,
      ) {
        const normalizedCwd = yield* normalizeCwd(input.cwd);
        const local = yield* getOrLoadLocalStatus(normalizedCwd);
        const remote =
          local.isRepo && local.hasOriginRemote
            ? yield* getOrLoadRemoteStatus(normalizedCwd)
            : null;
        return mergeGitStatusParts(local, remote);
      });

      const refreshLocalStatus: GitStatusBroadcasterShape["refreshLocalStatus"] = Effect.fn(
        "refreshLocalStatus",
      )(function* (cwd) {
        const normalizedCwd = yield* normalizeCwd(cwd);
        yield* gitManager.invalidateLocalStatus(normalizedCwd);
        const local = yield* gitManager.localStatus({ cwd: normalizedCwd });
        return yield* updateCachedLocalStatus(normalizedCwd, local, { publish: true });
      });

      const refreshRemoteStatus: GitStatusBroadcasterShape["refreshRemoteStatus"] = Effect.fn(
        "refreshRemoteStatus",
      )(function* (cwd) {
        const normalizedCwd = yield* normalizeCwd(cwd);
        yield* gitManager.invalidateRemoteStatus(normalizedCwd);
        const remote = yield* gitManager.remoteStatus({ cwd: normalizedCwd });
        return yield* updateCachedRemoteStatus(normalizedCwd, remote, { publish: true });
      });

      const makeRemoteRefreshLoop = (cwd: string) => {
        return Effect.gen(function* () {
          const consecutiveFailuresRef = yield* Ref.make(0);
          const refreshRemoteStatusWithDelay = Effect.gen(function* () {
            const exit = yield* refreshRemoteStatus(cwd).pipe(Effect.exit);
            if (Exit.isSuccess(exit)) {
              yield* Ref.set(consecutiveFailuresRef, 0);
              return remoteRefreshInterval;
            }

            const consecutiveFailures = yield* Ref.updateAndGet(
              consecutiveFailuresRef,
              (count) => count + 1,
            );
            const nextDelay = remoteRefreshFailureDelay(
              consecutiveFailures,
              remoteRefreshInterval,
              {
                baseDelay: remoteRefreshFailureBaseDelay,
                maxDelay: remoteRefreshFailureMaxDelay,
              },
            );
            yield* Effect.logWarning("git remote status refresh failed", {
              cwd,
              detail: exit.cause.toString(),
              consecutiveFailures,
              nextDelayMs: Duration.toMillis(nextDelay),
            });
            return nextDelay;
          });

          let nextDelay = yield* refreshRemoteStatusWithDelay;
          while (true) {
            yield* Effect.sleep(nextDelay);
            nextDelay = yield* refreshRemoteStatusWithDelay;
          }
        });
      };

      const refreshStatus: GitStatusBroadcasterShape["refreshStatus"] = Effect.fn("refreshStatus")(
        function* (cwd) {
          const normalizedCwd = yield* normalizeCwd(cwd);
          const local = yield* refreshLocalStatus(normalizedCwd);
          const remote =
            local.isRepo && local.hasOriginRemote
              ? yield* refreshRemoteStatus(normalizedCwd)
              : null;
          return mergeGitStatusParts(local, remote);
        },
      );

      const retainRemotePoller = Effect.fn("retainRemotePoller")(function* (cwd: string) {
        yield* SynchronizedRef.modifyEffect(pollersRef, (activePollers) => {
          const existing = activePollers.get(cwd);
          if (existing) {
            const nextPollers = new Map(activePollers);
            nextPollers.set(cwd, {
              ...existing,
              subscriberCount: existing.subscriberCount + 1,
            });
            return Effect.succeed([undefined, nextPollers] as const);
          }

          return makeRemoteRefreshLoop(cwd).pipe(
            Effect.forkIn(broadcasterScope),
            Effect.map((fiber) => {
              const nextPollers = new Map(activePollers);
              nextPollers.set(cwd, {
                fiber,
                subscriberCount: 1,
              });
              return [undefined, nextPollers] as const;
            }),
          );
        });
      });

      const releaseRemotePoller = Effect.fn("releaseRemotePoller")(function* (cwd: string) {
        const pollerToInterrupt = yield* SynchronizedRef.modify(pollersRef, (activePollers) => {
          const existing = activePollers.get(cwd);
          if (!existing) {
            return [null, activePollers] as const;
          }

          if (existing.subscriberCount > 1) {
            const nextPollers = new Map(activePollers);
            nextPollers.set(cwd, {
              ...existing,
              subscriberCount: existing.subscriberCount - 1,
            });
            return [null, nextPollers] as const;
          }

          const nextPollers = new Map(activePollers);
          nextPollers.delete(cwd);
          return [existing.fiber, nextPollers] as const;
        });

        if (pollerToInterrupt) {
          yield* Fiber.interrupt(pollerToInterrupt).pipe(Effect.ignore);
        }
      });

      const streamStatus: GitStatusBroadcasterShape["streamStatus"] = (input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const normalizedCwd = yield* normalizeCwd(input.cwd);
            const subscription = yield* PubSub.subscribe(changesPubSub);
            const initialLocal = yield* getOrLoadLocalStatus(normalizedCwd);
            const initialRemote = (yield* getCachedStatus(normalizedCwd))?.remote?.value ?? null;
            const shouldPollRemote = initialLocal.isRepo && initialLocal.hasOriginRemote;
            if (shouldPollRemote) {
              yield* retainRemotePoller(normalizedCwd);
            }

            const release = shouldPollRemote
              ? releaseRemotePoller(normalizedCwd).pipe(Effect.ignore, Effect.asVoid)
              : Effect.void;

            return Stream.concat(
              Stream.make({
                _tag: "snapshot" as const,
                local: initialLocal,
                remote: initialRemote,
              }),
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((event) => event.cwd === normalizedCwd),
                Stream.map((event) => event.event),
              ),
            ).pipe(Stream.ensuring(release));
          }),
        );

      return {
        getStatus,
        refreshLocalStatus,
        refreshRemoteStatus,
        refreshStatus,
        streamStatus,
      } satisfies GitStatusBroadcasterShape;
    }),
  );

export const GitStatusBroadcasterLive = makeGitStatusBroadcasterLive();
