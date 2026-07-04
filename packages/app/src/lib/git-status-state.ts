import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@honk/shared/environment";
import {
  GitManagerError,
  type GitManagerServiceError,
  type GitStatusResult,
} from "@honk/shared/git";
import { Cause } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { useSyncExternalStore } from "react";

import { appAtomRegistry } from "../rpc/atom-registry";
import { subscribeCoreEnvironmentConnections } from "../environments/core";
import { readResolvedEnvironmentGitApi, type EnvironmentGitApi } from "./environment-git-api";
import { isTransportConnectionErrorMessage } from "../rpc/transport-error";

interface GitStatusState {
  readonly data: GitStatusResult | null;
  readonly error: GitManagerServiceError | null;
  readonly cause: Cause.Cause<GitManagerServiceError> | null;
  readonly isPending: boolean;
}

type GitStatusRefreshClient = Pick<EnvironmentGitApi, "refreshStatus">;
type GitStatusClient = Pick<EnvironmentGitApi, "onStatus" | "refreshStatus">;
interface ResolvedGitStatusClient {
  readonly clientIdentity: string;
  readonly client: GitStatusClient;
}

interface WatchedGitStatus {
  refCount: number;
  unsubscribe: () => void;
}

interface GitStatusTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}

interface RefreshGitStatusOptions {
  readonly force?: boolean;
  readonly scope?: "full" | "local";
}

const EMPTY_GIT_STATUS_STATE = Object.freeze<GitStatusState>({
  data: null,
  error: null,
  cause: null,
  isPending: false,
});
const INITIAL_GIT_STATUS_STATE = Object.freeze<GitStatusState>({
  ...EMPTY_GIT_STATUS_STATE,
  isPending: true,
});
const EMPTY_GIT_STATUS_ATOM = Atom.make(EMPTY_GIT_STATUS_STATE).pipe(
  Atom.keepAlive,
  Atom.withLabel("git-status:null"),
);

const NOOP: () => void = () => undefined;
const watchedGitStatuses = new Map<string, WatchedGitStatus>();
const knownGitStatusKeys = new Set<string>();
const gitStatusRefreshInFlight = new Map<string, Promise<GitStatusResult | null>>();
const gitStatusQueuedForceRefresh = new Map<string, Promise<GitStatusResult | null>>();
const gitStatusLastRefreshAtByKey = new Map<string, number>();

const GIT_STATUS_REFRESH_DEBOUNCE_MS = 1_000;
const GIT_STATUS_REFRESH_TIMEOUT_MS = 8_000;

const gitStatusStateAtom = Atom.family((key: string) => {
  knownGitStatusKeys.add(key);
  return Atom.make(INITIAL_GIT_STATUS_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`git-status:${key}`),
  );
});

function getGitStatusTargetKey(target: GitStatusTarget): string | null {
  if (target.environmentId === null || target.cwd === null) {
    return null;
  }

  return `${target.environmentId}:${target.cwd}`;
}

function readResolvedGitStatusClient(target: GitStatusTarget): ResolvedGitStatusClient | null {
  if (target.environmentId === null) {
    return null;
  }
  const resolved = readResolvedEnvironmentGitApi(target.environmentId);
  return resolved ? { clientIdentity: resolved.clientIdentity, client: resolved.git } : null;
}

export function getGitStatusSnapshot(target: GitStatusTarget): GitStatusState {
  const targetKey = getGitStatusTargetKey(target);
  if (targetKey === null) {
    return EMPTY_GIT_STATUS_STATE;
  }

  return appAtomRegistry.get(gitStatusStateAtom(targetKey));
}

export function watchGitStatus(target: GitStatusTarget): () => void {
  const targetKey = getGitStatusTargetKey(target);
  if (targetKey === null) {
    return NOOP;
  }

  const watched = watchedGitStatuses.get(targetKey);
  if (watched) {
    watched.refCount += 1;
    return () => unwatchGitStatus(targetKey);
  }

  watchedGitStatuses.set(targetKey, {
    refCount: 1,
    unsubscribe: subscribeToGitStatusTarget(targetKey, target),
  });

  return () => unwatchGitStatus(targetKey);
}

export function refreshGitStatus(
  target: GitStatusTarget,
  client?: GitStatusRefreshClient,
  options?: RefreshGitStatusOptions,
): Promise<GitStatusResult | null> {
  const targetKey = getGitStatusTargetKey(target);
  if (targetKey === null || target.cwd === null) {
    return Promise.resolve(null);
  }

  const resolvedClient = client ?? readResolvedGitStatusClient(target)?.client;
  if (!resolvedClient) {
    return Promise.resolve(getGitStatusSnapshot(target).data);
  }

  const currentInFlight = gitStatusRefreshInFlight.get(targetKey);
  if (currentInFlight) {
    if (options?.force) {
      const queuedForceRefresh = gitStatusQueuedForceRefresh.get(targetKey);
      if (queuedForceRefresh) {
        return queuedForceRefresh;
      }

      const nextForceRefresh = currentInFlight
        .catch(() => null)
        .then(() =>
          refreshGitStatus(target, resolvedClient, {
            force: true,
            ...(options.scope ? { scope: options.scope } : {}),
          }),
        )
        .finally(() => {
          gitStatusQueuedForceRefresh.delete(targetKey);
        });
      gitStatusQueuedForceRefresh.set(targetKey, nextForceRefresh);
      return nextForceRefresh;
    }

    return currentInFlight;
  }

  const lastRequestedAt = gitStatusLastRefreshAtByKey.get(targetKey) ?? 0;
  if (!options?.force && Date.now() - lastRequestedAt < GIT_STATUS_REFRESH_DEBOUNCE_MS) {
    return Promise.resolve(getGitStatusSnapshot(target).data);
  }

  gitStatusLastRefreshAtByKey.set(targetKey, Date.now());
  const refreshError = (detail: string) =>
    new GitManagerError({
      operation: "refreshStatus",
      detail,
    });
  const updateSuccess = (data: GitStatusResult) => {
    appAtomRegistry.set(gitStatusStateAtom(targetKey), {
      data,
      error: null,
      cause: null,
      isPending: false,
    });
    return data;
  };
  const updateError = (error: GitManagerServiceError) => {
    appAtomRegistry.set(gitStatusStateAtom(targetKey), {
      data: getGitStatusSnapshot(target).data,
      error,
      cause: null,
      isPending: false,
    });
    return error;
  };
  const sourcePromise = resolvedClient
    .refreshStatus({
      cwd: target.cwd,
      ...(options?.scope ? { scope: options.scope } : {}),
    })
    .then(updateSuccess);
  const timeoutPromise = new Promise<GitStatusResult>((_, reject) => {
    window.setTimeout(() => {
      reject(refreshError(`Timed out after ${GIT_STATUS_REFRESH_TIMEOUT_MS}ms for ${target.cwd}.`));
    }, GIT_STATUS_REFRESH_TIMEOUT_MS);
  });
  const refreshPromise = Promise.race([sourcePromise, timeoutPromise])
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      if (isTransportConnectionErrorMessage(detail)) {
        const data = getGitStatusSnapshot(target).data;
        appAtomRegistry.set(gitStatusStateAtom(targetKey), {
          data,
          error: null,
          cause: null,
          isPending: false,
        });
        return data;
      }
      const gitError = error instanceof GitManagerError ? error : refreshError(detail);
      updateError(gitError);
      throw gitError;
    })
    .finally(() => {
      gitStatusRefreshInFlight.delete(targetKey);
    });
  gitStatusRefreshInFlight.set(targetKey, refreshPromise);
  return refreshPromise;
}

export function resetGitStatusStateForTests(): void {
  for (const watched of watchedGitStatuses.values()) {
    watched.unsubscribe();
  }
  watchedGitStatuses.clear();
  gitStatusRefreshInFlight.clear();
  gitStatusQueuedForceRefresh.clear();
  gitStatusLastRefreshAtByKey.clear();

  for (const key of knownGitStatusKeys) {
    appAtomRegistry.set(gitStatusStateAtom(key), INITIAL_GIT_STATUS_STATE);
  }
  knownGitStatusKeys.clear();
}

export function useGitStatus(target: GitStatusTarget): GitStatusState {
  const targetKey = getGitStatusTargetKey(target);
  const subscribe = () => watchGitStatus({ environmentId: target.environmentId, cwd: target.cwd });

  useSyncExternalStore(
    subscribe,
    () => targetKey,
    () => null,
  );

  const state = useAtomValue(
    targetKey !== null ? gitStatusStateAtom(targetKey) : EMPTY_GIT_STATUS_ATOM,
  );
  return targetKey === null ? EMPTY_GIT_STATUS_STATE : state;
}

function unwatchGitStatus(targetKey: string): void {
  const watched = watchedGitStatuses.get(targetKey);
  if (!watched) {
    return;
  }

  watched.refCount -= 1;
  if (watched.refCount > 0) {
    return;
  }

  watched.unsubscribe();
  watchedGitStatuses.delete(targetKey);
}

function subscribeToGitStatusTarget(targetKey: string, target: GitStatusTarget): () => void {
  if (target.cwd === null) {
    return NOOP;
  }

  const cwd = target.cwd;
  let currentClientIdentity: string | null = null;
  let currentUnsubscribe = NOOP;

  const syncClientSubscription = () => {
    const resolved = readResolvedGitStatusClient(target);

    if (!resolved) {
      if (currentClientIdentity !== null) {
        currentUnsubscribe();
        currentUnsubscribe = NOOP;
        currentClientIdentity = null;
      }
      markGitStatusPending(targetKey);
      return;
    }

    if (currentClientIdentity === resolved.clientIdentity) {
      return;
    }

    currentUnsubscribe();
    currentClientIdentity = resolved.clientIdentity;
    currentUnsubscribe = subscribeToGitStatus(targetKey, cwd, resolved.client);
  };

  const unsubscribeRegistry = subscribeCoreEnvironmentConnections(syncClientSubscription);
  syncClientSubscription();

  return () => {
    unsubscribeRegistry();
    currentUnsubscribe();
  };
}

function subscribeToGitStatus(targetKey: string, cwd: string, client: GitStatusClient): () => void {
  markGitStatusPending(targetKey);
  return client.onStatus(
    { cwd },
    (status: GitStatusResult) => {
      appAtomRegistry.set(gitStatusStateAtom(targetKey), {
        data: status,
        error: null,
        cause: null,
        isPending: false,
      });
    },
    {
      onResubscribe: () => {
        markGitStatusPending(targetKey);
      },
    },
  );
}

function markGitStatusPending(targetKey: string): void {
  const atom = gitStatusStateAtom(targetKey);
  const current = appAtomRegistry.get(atom);
  const next =
    current.data === null
      ? INITIAL_GIT_STATUS_STATE
      : {
          ...current,
          error: null,
          cause: null,
          isPending: true,
        };

  if (
    current.data === next.data &&
    current.error === next.error &&
    current.cause === next.cause &&
    current.isPending === next.isPending
  ) {
    return;
  }

  appAtomRegistry.set(atom, next);
}
