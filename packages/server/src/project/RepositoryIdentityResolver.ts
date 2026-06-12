import type { RepositoryIdentity } from "@honk/contracts";
import { Cache, Duration, Effect, Exit, Layer, Schema } from "effect";
import { detectGitHostingProviderFromRemoteUrl, normalizeGitRemoteUrl } from "@honk/shared/git";

import { runProcess } from "../process-runner.ts";
import {
  RepositoryIdentityResolver,
  type RepositoryIdentityResolverShape,
} from "./RepositoryIdentityResolver.service.ts";

function parseRemoteFetchUrls(stdout: string): Map<string, string> {
  const remotes = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
    if (!match) continue;
    const [, remoteName = "", remoteUrl = "", direction = ""] = match;
    if (direction !== "fetch" || remoteName.length === 0 || remoteUrl.length === 0) {
      continue;
    }
    remotes.set(remoteName, remoteUrl);
  }
  return remotes;
}

function pickPrimaryRemote(
  remotes: ReadonlyMap<string, string>,
): { readonly remoteName: string; readonly remoteUrl: string } | null {
  for (const preferredRemoteName of ["upstream", "origin"] as const) {
    const remoteUrl = remotes.get(preferredRemoteName);
    if (remoteUrl) {
      return { remoteName: preferredRemoteName, remoteUrl };
    }
  }

  const [remoteName, remoteUrl] =
    [...remotes.entries()].toSorted(([left], [right]) => left.localeCompare(right))[0] ?? [];
  return remoteName && remoteUrl ? { remoteName, remoteUrl } : null;
}

function buildRepositoryIdentity(input: {
  readonly remoteName: string;
  readonly remoteUrl: string;
}): RepositoryIdentity {
  const canonicalKey = normalizeGitRemoteUrl(input.remoteUrl);
  const hostingProvider = detectGitHostingProviderFromRemoteUrl(input.remoteUrl);
  const repositoryPath = canonicalKey.split("/").slice(1).join("/");
  const repositoryPathSegments = repositoryPath.split("/").filter((segment) => segment.length > 0);
  const [owner] = repositoryPathSegments;
  const repositoryName = repositoryPathSegments.at(-1);

  return {
    canonicalKey,
    locator: {
      source: "git-remote",
      remoteName: input.remoteName,
      remoteUrl: input.remoteUrl,
    },
    ...(repositoryPath ? { displayName: repositoryPath } : {}),
    ...(hostingProvider ? { provider: hostingProvider.kind } : {}),
    ...(owner ? { owner } : {}),
    ...(repositoryName ? { name: repositoryName } : {}),
  };
}

const DEFAULT_REPOSITORY_IDENTITY_CACHE_CAPACITY = 512;
const DEFAULT_POSITIVE_CACHE_TTL = Duration.minutes(1);
const DEFAULT_NEGATIVE_CACHE_TTL = Duration.seconds(10);

interface RepositoryIdentityResolverOptions {
  readonly cacheCapacity?: number;
  readonly positiveCacheTtl?: Duration.Input;
  readonly negativeCacheTtl?: Duration.Input;
}

class RepositoryIdentityResolverGitError extends Schema.TaggedErrorClass<RepositoryIdentityResolverGitError>()(
  "RepositoryIdentityResolverGitError",
  {
    operation: Schema.String,
    cwd: Schema.String,
    cause: Schema.Defect,
  },
) {}

const toRepositoryIdentityResolverGitError =
  (operation: string, cwd: string) =>
  (cause: unknown): RepositoryIdentityResolverGitError =>
    new RepositoryIdentityResolverGitError({
      operation,
      cwd,
      cause,
    });

function resolveRepositoryIdentityCacheKey(cwd: string): Effect.Effect<string> {
  return Effect.tryPromise({
    try: () =>
      runProcess("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
        allowNonZeroExit: true,
      }),
    catch: toRepositoryIdentityResolverGitError("git.rev-parse.show-toplevel", cwd),
  }).pipe(
    Effect.map((topLevelResult) => {
      if (topLevelResult.code !== 0) {
        return cwd;
      }

      const candidate = topLevelResult.stdout.trim();
      return candidate.length > 0 ? candidate : cwd;
    }),
    Effect.catch((cause) =>
      Effect.logDebug("repository identity cache key resolution failed", {
        cwd,
        cause,
      }).pipe(Effect.as(cwd)),
    ),
  );
}

function resolveRepositoryIdentityFromCacheKey(
  cacheKey: string,
): Effect.Effect<RepositoryIdentity | null> {
  return Effect.tryPromise({
    try: () =>
      runProcess("git", ["-C", cacheKey, "remote", "-v"], {
        allowNonZeroExit: true,
      }),
    catch: toRepositoryIdentityResolverGitError("git.remote.list", cacheKey),
  }).pipe(
    Effect.map((remoteResult) => {
      if (remoteResult.code !== 0) {
        return null;
      }

      const remote = pickPrimaryRemote(parseRemoteFetchUrls(remoteResult.stdout));
      return remote ? buildRepositoryIdentity(remote) : null;
    }),
    Effect.catch((cause) =>
      Effect.logDebug("repository identity remote resolution failed", {
        cacheKey,
        cause,
      }).pipe(Effect.as(null)),
    ),
  );
}

export const makeRepositoryIdentityResolver = Effect.fn("makeRepositoryIdentityResolver")(
  function* (options: RepositoryIdentityResolverOptions = {}) {
    const repositoryIdentityCache = yield* Cache.makeWith<string, RepositoryIdentity | null>(
      (cacheKey) => resolveRepositoryIdentityFromCacheKey(cacheKey),
      {
        capacity: options.cacheCapacity ?? DEFAULT_REPOSITORY_IDENTITY_CACHE_CAPACITY,
        timeToLive: Exit.match({
          onSuccess: (value) =>
            value === null
              ? (options.negativeCacheTtl ?? DEFAULT_NEGATIVE_CACHE_TTL)
              : (options.positiveCacheTtl ?? DEFAULT_POSITIVE_CACHE_TTL),
          onFailure: () => Duration.zero,
        }),
      },
    );

    const resolve: RepositoryIdentityResolverShape["resolve"] = Effect.fn(
      "RepositoryIdentityResolver.resolve",
    )(function* (cwd) {
      const cacheKey = yield* resolveRepositoryIdentityCacheKey(cwd);
      return yield* Cache.get(repositoryIdentityCache, cacheKey);
    });

    return {
      resolve,
    } satisfies RepositoryIdentityResolverShape;
  },
);

export const RepositoryIdentityResolverLive = Layer.effect(
  RepositoryIdentityResolver,
  makeRepositoryIdentityResolver(),
);
