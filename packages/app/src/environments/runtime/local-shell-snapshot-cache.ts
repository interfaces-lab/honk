import { EnvironmentId } from "@honk/shared/environment";
import { IsoDateTime } from "@honk/shared/base-schemas";
import {
  OrchestrationShellSnapshot,
  type OrchestrationLatestTurn,
  type OrchestrationProjectShell,
  type OrchestrationSession,
  type OrchestrationShellStreamEvent,
  type OrchestrationThreadShell,
} from "@honk/shared/orchestration";
import { Option, Schema } from "effect";

const CACHE_SCHEMA_VERSION = 1;

const CachedShellSnapshotRecord = Schema.Struct({
  schemaVersion: Schema.Literal(CACHE_SCHEMA_VERSION),
  environmentId: EnvironmentId,
  capturedAt: IsoDateTime,
  snapshot: OrchestrationShellSnapshot,
});
type CachedShellSnapshotRecord = typeof CachedShellSnapshotRecord.Type;

const decodeCachedShellSnapshotRecordOption = Schema.decodeUnknownOption(
  Schema.fromJsonString(CachedShellSnapshotRecord),
);

const liveShellSnapshotByEnvironment = new Map<EnvironmentId, OrchestrationShellSnapshot>();

function getCacheKey(environmentId: EnvironmentId): string {
  return `honk:environment-shell-snapshot:v1:${environmentId}`;
}

function sanitizeSessionForCache(
  session: OrchestrationSession | null,
  capturedAt: string,
): OrchestrationSession | null {
  if (!session || (session.status !== "starting" && session.status !== "running")) {
    return session;
  }

  return {
    ...session,
    status: "stopped",
    activeTurnId: null,
    updatedAt: capturedAt,
  };
}

function sanitizeLatestTurnForCache(
  latestTurn: OrchestrationLatestTurn | null,
  capturedAt: string,
): OrchestrationLatestTurn | null {
  if (!latestTurn) return null;
  const interrupted = latestTurn.state === "running";

  return {
    turnId: latestTurn.turnId,
    state: interrupted ? "interrupted" : latestTurn.state,
    requestedAt: latestTurn.requestedAt,
    startedAt: latestTurn.startedAt,
    completedAt: interrupted ? (latestTurn.completedAt ?? capturedAt) : latestTurn.completedAt,
    assistantMessageId: latestTurn.assistantMessageId,
  };
}

function sanitizeThreadShellForCache(
  thread: OrchestrationThreadShell,
  capturedAt: string,
): OrchestrationThreadShell {
  return {
    ...thread,
    latestTurn: sanitizeLatestTurnForCache(thread.latestTurn, capturedAt),
    session: sanitizeSessionForCache(thread.session, capturedAt),
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function sanitizeShellSnapshotForCache(
  snapshot: OrchestrationShellSnapshot,
  capturedAt: string,
): OrchestrationShellSnapshot {
  return {
    ...snapshot,
    threads: snapshot.threads.map((thread) => sanitizeThreadShellForCache(thread, capturedAt)),
  };
}

function upsertProjectShell(
  projects: readonly OrchestrationProjectShell[],
  project: OrchestrationProjectShell,
): OrchestrationProjectShell[] {
  let replaced = false;
  const nextProjects = projects.map((currentProject) => {
    if (currentProject.id === project.id || currentProject.projectRoot === project.projectRoot) {
      replaced = true;
      return project;
    }
    return currentProject;
  });

  return replaced ? nextProjects : [...nextProjects, project];
}

function upsertThreadShell(
  threads: readonly OrchestrationThreadShell[],
  thread: OrchestrationThreadShell,
): OrchestrationThreadShell[] {
  let replaced = false;
  const nextThreads = threads.map((currentThread) => {
    if (currentThread.id === thread.id) {
      replaced = true;
      return thread;
    }
    return currentThread;
  });

  return replaced ? nextThreads : [...nextThreads, thread];
}

function getEventUpdatedAt(event: OrchestrationShellStreamEvent): string {
  switch (event.kind) {
    case "project-upserted":
      return event.project.updatedAt;
    case "thread-upserted":
      return event.thread.updatedAt;
    case "project-removed":
    case "thread-removed":
      return new Date().toISOString();
    default:
      return new Date().toISOString();
  }
}

function applyShellStreamEventToSnapshot(
  snapshot: OrchestrationShellSnapshot,
  event: OrchestrationShellStreamEvent,
): OrchestrationShellSnapshot {
  const baseSnapshot = {
    ...snapshot,
    snapshotSequence: event.sequence,
    updatedAt: getEventUpdatedAt(event),
  };

  switch (event.kind) {
    case "project-upserted":
      return {
        ...baseSnapshot,
        projects: upsertProjectShell(snapshot.projects, event.project),
      };
    case "project-removed":
      return {
        ...baseSnapshot,
        projects: snapshot.projects.filter((project) => project.id !== event.projectId),
      };
    case "thread-upserted":
      return {
        ...baseSnapshot,
        threads: upsertThreadShell(snapshot.threads, event.thread),
      };
    case "thread-removed":
      return {
        ...baseSnapshot,
        threads: snapshot.threads.filter((thread) => thread.id !== event.threadId),
      };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function readCachedShellSnapshot(
  environmentId: EnvironmentId,
): OrchestrationShellSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(getCacheKey(environmentId));
  if (!raw) {
    return null;
  }

  const record = Option.getOrNull(decodeCachedShellSnapshotRecordOption(raw));
  if (!record || record.environmentId !== environmentId) {
    return null;
  }

  return sanitizeShellSnapshotForCache(record.snapshot, record.capturedAt);
}

export function writeCachedShellSnapshot(
  environmentId: EnvironmentId,
  snapshot: OrchestrationShellSnapshot,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const capturedAt = new Date().toISOString();
  const record: CachedShellSnapshotRecord = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    environmentId,
    capturedAt,
    snapshot: sanitizeShellSnapshotForCache(snapshot, capturedAt),
  };

  try {
    window.localStorage.setItem(getCacheKey(environmentId), JSON.stringify(record));
  } catch {}
}

export function rememberLiveShellSnapshot(
  environmentId: EnvironmentId,
  snapshot: OrchestrationShellSnapshot,
): void {
  liveShellSnapshotByEnvironment.set(environmentId, snapshot);
  writeCachedShellSnapshot(environmentId, snapshot);
}

export function rememberLiveShellEvent(
  environmentId: EnvironmentId,
  event: OrchestrationShellStreamEvent,
): void {
  const currentSnapshot = liveShellSnapshotByEnvironment.get(environmentId);
  if (!currentSnapshot) {
    return;
  }

  const nextSnapshot = applyShellStreamEventToSnapshot(currentSnapshot, event);
  liveShellSnapshotByEnvironment.set(environmentId, nextSnapshot);
  writeCachedShellSnapshot(environmentId, nextSnapshot);
}

export function forgetLiveShellSnapshot(environmentId: EnvironmentId): void {
  liveShellSnapshotByEnvironment.delete(environmentId);
}
