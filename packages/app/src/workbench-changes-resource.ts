import {
  openCodeSessionKey,
  type OpenCodeClient,
  type OpenCodeServerKey,
  type OpenCodeSessionRef,
  type OpenCodeVcsFileDiff,
  type OpenCodeVcsFileStatus,
} from "@honk/opencode";
import * as React from "react";

import { errorMessage } from "./error-message";
import { getOpenCodeClient } from "./watch-registry";

const CHANGES_RESOURCE_GRACE_MS = 30_000;

// The three comparisons OpenCode V2 can actually answer: `vcs.diff` mode "git"
// (working tree vs HEAD), mode "branch" (merge-base of the default branch vs the
// working tree), and the session's newest user turn via `sessions.lastTurnDiff`.
// Cursor's staged/unstaged/per-commit scopes have no route here and are omitted.
type ChangesScope = "git" | "branch" | "lastTurn";

type ChangesReady = {
  readonly branch: string | null;
  readonly defaultBranch: string | null;
  readonly files: readonly OpenCodeVcsFileStatus[];
  readonly diffs: ReadonlyMap<string, OpenCodeVcsFileDiff>;
  // The file list paints from info+status immediately; patches stream in after. While true,
  // an absent patch means "still loading" rather than "binary/oversized".
  readonly diffsPending: boolean;
};

type ChangesSnapshot =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | ({ readonly phase: "ready" } & ChangesReady);

type ChangesResource = {
  readonly getSnapshot: () => ChangesSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: () => void;
  readonly observeThreadRunning: (isRunning: boolean) => void;
};

type ChangesClient = Pick<OpenCodeClient, "vcs"> & {
  readonly sessions: Pick<OpenCodeClient["sessions"], "lastTurnDiff">;
};
type ChangesClientResolver = (server: OpenCodeServerKey) => ChangesClient | null;

const changesResources = new Map<string, ChangesResource>();
const INITIAL_CHANGES_SNAPSHOT: ChangesSnapshot = Object.freeze({ phase: "loading" });

function indexDiffs(
  diffs: readonly OpenCodeVcsFileDiff[],
): ReadonlyMap<string, OpenCodeVcsFileDiff> {
  return new Map(diffs.map((diff) => [diff.file, Object.freeze(diff)]));
}

function createChangesResource(
  sessionRef: OpenCodeSessionRef,
  directory: string,
  scope: ChangesScope,
  resolveClient: ChangesClientResolver = getOpenCodeClient,
): ChangesResource {
  let snapshot = INITIAL_CHANGES_SNAPSHOT;
  let requested = false;
  let inFlight = false;
  let refreshQueued = false;
  let sequence = 0;
  let lastThreadRunning: boolean | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const key = changesResourceKey(sessionRef, directory, scope);

  const publish = (next: ChangesSnapshot): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const load = async (client: ChangesClient, current: number): Promise<void> => {
    const info = await client.vcs.info({ directory });
    if (sequence !== current) return;
    const branch = info.branch ?? null;
    const defaultBranch = info.default_branch ?? null;

    if (scope === "git") {
      // The working tree is the one scope with a status route, so its file list can
      // paint before the heavy per-file `diff` call returns every patch.
      const files = await client.vcs.status({ directory });
      if (sequence !== current) return;
      publish({
        phase: "ready",
        branch,
        defaultBranch,
        files: Object.freeze([...files]),
        diffs: new Map(),
        diffsPending: true,
      });
      const diffs = await client.vcs.diff({ directory, mode: "git" });
      if (sequence !== current || snapshot.phase !== "ready") return;
      publish({ ...snapshot, diffs: indexDiffs(diffs), diffsPending: false });
      return;
    }

    // Every other scope has no status equivalent: its file list is whatever the diff
    // reported, so there is nothing to paint early.
    const diffs =
      scope === "branch"
        ? await client.vcs.diff({ directory, mode: "branch" })
        : await client.sessions.lastTurnDiff(sessionRef);
    if (sequence !== current) return;
    publish({
      phase: "ready",
      branch,
      defaultBranch,
      files: Object.freeze(
        diffs.map((diff) => ({
          file: diff.file,
          additions: diff.additions,
          deletions: diff.deletions,
          status: diff.status ?? "modified",
        })),
      ),
      diffs: indexDiffs(diffs),
      diffsPending: false,
    });
  };

  const refresh = (): void => {
    requested = true;
    if (inFlight) {
      refreshQueued = true;
      return;
    }
    const client = resolveClient(sessionRef.server);
    if (client === null) {
      publish({ phase: "error", message: "Honk is not connected to OpenCode." });
      return;
    }

    inFlight = true;
    const currentSequence = ++sequence;
    void load(client, currentSequence)
      .catch((error: unknown) => {
        if (sequence !== currentSequence) return;
        publish({ phase: "error", message: errorMessage(error) });
      })
      .finally(() => {
        if (sequence !== currentSequence) return;
        inFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          refresh();
        }
      });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      listeners.add(listener);
      if (!requested) refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          releaseTimer = setTimeout(() => {
            if (listeners.size === 0) changesResources.delete(key);
          }, CHANGES_RESOURCE_GRACE_MS);
        }
      };
    },
    refresh,
    observeThreadRunning(isRunning) {
      if (lastThreadRunning === true && !isRunning) refresh();
      lastThreadRunning = isRunning;
    },
  };
}

function changesResourceKey(
  sessionRef: OpenCodeSessionRef,
  directory: string,
  scope: ChangesScope,
): string {
  return `${openCodeSessionKey(sessionRef)}:${directory}:${scope}`;
}

// One resource per scope: switching scopes swaps the resource rather than mutating a
// shared one, so the grace timer keeps the previous scope warm for an instant switch back.
function changesResourceFor(
  sessionRef: OpenCodeSessionRef,
  directory: string,
  scope: ChangesScope,
): ChangesResource {
  const key = changesResourceKey(sessionRef, directory, scope);
  const existing = changesResources.get(key);
  if (existing !== undefined) return existing;
  const created = createChangesResource(sessionRef, directory, scope);
  changesResources.set(key, created);
  return created;
}

function useWorkbenchChangesSnapshot(
  sessionRef: OpenCodeSessionRef,
  directory: string,
  scope: ChangesScope,
  isThreadRunning: boolean,
): ChangesSnapshot {
  const resource = changesResourceFor(sessionRef, directory, scope);
  const snapshot = React.useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  React.useEffect(() => {
    resource.observeThreadRunning(isThreadRunning);
  }, [isThreadRunning, resource]);
  return snapshot;
}

function fileStatusGlyph(status: OpenCodeVcsFileStatus["status"]): "A" | "D" | "M" {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

export { changesResourceFor, createChangesResource, fileStatusGlyph, useWorkbenchChangesSnapshot };
export type { ChangesResource, ChangesScope, ChangesSnapshot };
