import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type HonkRuntimeHostEvent,
  type HonkRuntimeHostSnapshot,
  type RuntimeIngestionRecord,
  RuntimeIngestionRecord as RuntimeIngestionRecordSchema,
} from "@honk/contracts";
import { formatSchemaError, formatSchemaIssues } from "@honk/shared/schema-json";
import * as EffectLogger from "@honk/shared/effect-logger";
import { Exit, Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as DesktopAppIdentity from "../app/desktop-app-identity";
import * as DesktopBackendManager from "../backend/desktop-backend-manager";
import {
  createDesktopOrchestrationClient,
  type DesktopOrchestrationClient,
  type DesktopOrchestrationClientConfig,
} from "./desktop-orchestration-client";

const decodeRuntimePersistenceRecord = Schema.decodeUnknownExit(RuntimeIngestionRecordSchema);
const elog = EffectLogger.create({ service: "desktop.runtime.ingestion" });

interface RuntimeIngestionClientConfig extends DesktopOrchestrationClientConfig {
  readonly runtimeRecordOutboxPath?: string;
}

let installedClientConfig: RuntimeIngestionClientConfig | null = null;

// These dedup sets are module-singleton and live for the whole app lifetime. Bound them so a long
// session with heavy event volume cannot grow them without limit. Eviction is FIFO; re-dispatching an
// evicted (very old) key is harmless — backend persistence is keyed by commandId.
const MAX_PERSISTED_KEYS = 5000;
const MAX_OUTBOX_RECORDS = 5000;
const CONTEXT_WINDOW_PERSISTENCE_MIN_INTERVAL_MS = 15_000;
const RUNTIME_RECORD_RETRY_DELAY_MS = 5_000;

interface PendingContextWindowDispatch {
  readonly record: RuntimeIngestionRecord;
  readonly persistenceKey: string;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

interface UnrefableTimer {
  unref: () => void;
}

type RuntimeRecordOutboxStatus = "pending" | "acked" | "failed";

interface RuntimeRecordOutboxRecord {
  readonly record: RuntimeIngestionRecord;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attempts: number;
  readonly status: RuntimeRecordOutboxStatus;
  readonly lastError?: string;
  readonly ackSequence?: number;
}

function unrefTimer(timeoutId: ReturnType<typeof setTimeout>): void {
  if (
    typeof timeoutId === "object" &&
    timeoutId !== null &&
    "unref" in timeoutId &&
    typeof timeoutId.unref === "function"
  ) {
    (timeoutId as UnrefableTimer).unref();
  }
}

function rememberPersistedKey(set: Set<string>, key: string): void {
  set.add(key);
  if (set.size > MAX_PERSISTED_KEYS) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) {
      set.delete(oldest);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function isRuntimeRecordOutboxStatus(value: unknown): value is RuntimeRecordOutboxStatus {
  return value === "pending" || value === "acked" || value === "failed";
}

function decodeOutboxRecord(value: unknown): RuntimeRecordOutboxRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const decodedRecord = decodeRuntimePersistenceRecord(record.record, {
    errors: "all",
    propertyOrder: "original",
  });
  if (Exit.isFailure(decodedRecord)) {
    return null;
  }
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : null;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;
  const attempts = typeof record.attempts === "number" && Number.isFinite(record.attempts)
    ? Math.max(0, Math.floor(record.attempts))
    : 0;
  if (!createdAt || !updatedAt || !isRuntimeRecordOutboxStatus(record.status)) {
    return null;
  }
  return {
    record: decodedRecord.value,
    createdAt,
    updatedAt,
    attempts,
    status: record.status,
    ...(typeof record.lastError === "string" ? { lastError: record.lastError } : {}),
    ...(typeof record.ackSequence === "number" && Number.isFinite(record.ackSequence)
      ? { ackSequence: Math.max(0, Math.floor(record.ackSequence)) }
      : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class RuntimeIngestionState {
  private readonly persistedRuntimeEventKeys = new Set<string>();
  private readonly persistedRuntimeAssistantEntryKeys = new Set<string>();
  private readonly contextWindowLastDispatchAtByScope = new Map<string, number>();
  private readonly pendingContextWindowDispatchByScope = new Map<
    string,
    PendingContextWindowDispatch
  >();
  private readonly outboxRecordsByRecordId = new Map<string, RuntimeRecordOutboxRecord>();
  private client: DesktopOrchestrationClient | null = null;
  private configurePromise: Promise<void> | null = null;
  private configuredClientConfig: RuntimeIngestionClientConfig | null = null;
  private outboxPath: string | null = null;
  private outboxLoaded = false;
  private outboxFlushPromise: Promise<void> | null = null;
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  configureForTests(config: RuntimeIngestionClientConfig): void {
    this.configuredClientConfig = config;
    this.outboxPath = config.runtimeRecordOutboxPath ?? null;
    this.outboxLoaded = false;
    this.outboxRecordsByRecordId.clear();
    this.client = null;
    this.configurePromise = null;
  }

  async ensureConfigured(): Promise<DesktopOrchestrationClient> {
    if (this.client && !this.configurePromise) {
      return this.client;
    }
    if (this.configurePromise) {
      await this.configurePromise;
      if (!this.client) {
        throw new Error("Desktop runtime ingestion client failed to configure.");
      }
      return this.client;
    }

    this.configurePromise = this.configureClient();
    try {
      await this.configurePromise;
    } finally {
      this.configurePromise = null;
    }
    if (!this.client) {
      throw new Error("Desktop runtime ingestion client failed to configure.");
    }
    return this.client;
  }

  private async configureClient(): Promise<void> {
    const configuredClientConfig = this.configuredClientConfig;
    if (configuredClientConfig) {
      const client = createDesktopOrchestrationClient();
      await client.configure(configuredClientConfig);
      this.client = client;
      await this.loadOutbox();
      void this.flushOutbox();
      return;
    }

    if (!installedClientConfig) {
      throw new Error("Desktop backend is not configured for runtime ingestion.");
    }

    const client = createDesktopOrchestrationClient();
    await client.configure(installedClientConfig);
    this.client = client;
    this.outboxPath = installedClientConfig.runtimeRecordOutboxPath ?? null;
    await this.loadOutbox();
    void this.flushOutbox();
  }

  resetClient(): void {
    this.clearPendingContextWindowDispatches();
    this.clearRetryTimer();
    this.client?.reset();
    this.client = null;
    this.configurePromise = null;
    this.configuredClientConfig = null;
    this.outboxPath = null;
    this.outboxLoaded = false;
    this.outboxFlushPromise = null;
    this.outboxRecordsByRecordId.clear();
  }

  private async loadOutbox(): Promise<void> {
    if (this.outboxLoaded) {
      return;
    }
    this.outboxLoaded = true;
    const outboxPath = this.outboxPath;
    if (!outboxPath) {
      return;
    }

    try {
      const raw = await readFile(outboxPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      for (const value of parsed) {
        const record = decodeOutboxRecord(value);
        if (record) {
          this.outboxRecordsByRecordId.set(record.record.recordId, record);
        }
      }
    } catch (error: unknown) {
      if (asRecord(error)?.code === "ENOENT") {
        return;
      }
      void Effect.runPromise(
        elog.warn("Failed to load runtime record outbox", {
          outboxPath,
          cause: errorMessage(error),
        }),
      );
    }
  }

  private async persistOutbox(): Promise<void> {
    const outboxPath = this.outboxPath;
    if (!outboxPath) {
      return;
    }
    this.pruneOutboxRecords();
    await mkdir(dirname(outboxPath), { recursive: true });
    const tmpPath = `${outboxPath}.tmp`;
    await writeFile(
      tmpPath,
      `${JSON.stringify([...this.outboxRecordsByRecordId.values()], null, 2)}\n`,
      "utf8",
    );
    await rename(tmpPath, outboxPath);
  }

  private pruneOutboxRecords(): void {
    if (this.outboxRecordsByRecordId.size <= MAX_OUTBOX_RECORDS) {
      return;
    }
    const ackedRecords = [...this.outboxRecordsByRecordId.values()]
      .filter((record) => record.status === "acked")
      .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    for (const record of ackedRecords) {
      if (this.outboxRecordsByRecordId.size <= MAX_OUTBOX_RECORDS) {
        return;
      }
      this.outboxRecordsByRecordId.delete(record.record.recordId);
    }
  }

  private async queueRecord(record: RuntimeIngestionRecord): Promise<void> {
    await this.loadOutbox();
    const existing = this.outboxRecordsByRecordId.get(record.recordId);
    if (existing?.status === "acked") {
      return;
    }
    const now = new Date().toISOString();
    this.outboxRecordsByRecordId.set(record.recordId, {
      record,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      attempts: existing?.attempts ?? 0,
      status: "pending",
      ...(existing?.lastError ? { lastError: existing.lastError } : {}),
      ...(existing?.ackSequence !== undefined ? { ackSequence: existing.ackSequence } : {}),
    });
    await this.persistOutbox();
  }

  private async flushOutbox(): Promise<void> {
    if (this.outboxFlushPromise) {
      return this.outboxFlushPromise;
    }
    this.outboxFlushPromise = this.flushOutboxNow().finally(() => {
      this.outboxFlushPromise = null;
    });
    return this.outboxFlushPromise;
  }

  private async flushOutboxNow(): Promise<void> {
    await this.loadOutbox();
    const client = await this.ensureConfigured();
    for (const record of [...this.outboxRecordsByRecordId.values()]) {
      if (record.status === "acked") {
        continue;
      }

      const attemptStartedAt = new Date().toISOString();
      this.outboxRecordsByRecordId.set(record.record.recordId, {
        ...record,
        attempts: record.attempts + 1,
        updatedAt: attemptStartedAt,
        status: "pending",
      });
      await this.persistOutbox();

      try {
        const result = await client.ingestRuntimeRecords([record.record]);
        const ack = result.acks.find((item) => item.recordId === record.record.recordId);
        this.outboxRecordsByRecordId.set(record.record.recordId, {
          ...record,
          attempts: record.attempts + 1,
          updatedAt: new Date().toISOString(),
          status: "acked",
          ...(ack ? { ackSequence: ack.sequence } : {}),
        });
        await this.persistOutbox();
      } catch (error: unknown) {
        this.outboxRecordsByRecordId.set(record.record.recordId, {
          ...record,
          attempts: record.attempts + 1,
          updatedAt: new Date().toISOString(),
          status: "failed",
          lastError: errorMessage(error),
        });
        await this.persistOutbox();
        this.scheduleRetry();
        void Effect.runPromise(
          elog.error("Runtime record ingestion failed", {
            recordKind: record.record.kind,
            recordId: record.record.recordId,
            cause: errorMessage(error),
          }),
        );
        return;
      }
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimeoutId) {
      return;
    }
    const timeoutId = setTimeout(() => {
      if (this.retryTimeoutId !== timeoutId) {
        return;
      }
      this.retryTimeoutId = null;
      void this.flushOutbox().catch((error: unknown) => {
        void Effect.runPromise(
          elog.error("Runtime record outbox retry failed", {
            cause: errorMessage(error),
          }),
        );
      });
    }, RUNTIME_RECORD_RETRY_DELAY_MS);
    unrefTimer(timeoutId);
    this.retryTimeoutId = timeoutId;
  }

  private clearRetryTimer(): void {
    if (!this.retryTimeoutId) {
      return;
    }
    clearTimeout(this.retryTimeoutId);
    this.retryTimeoutId = null;
  }

  ingestHostEvent(event: HonkRuntimeHostEvent): void {
    switch (event.type) {
      case "snapshot":
        this.ingestSnapshot(event.snapshot);
        return;
      case "runtime-ingestion-records":
        for (const record of event.records) {
          this.dispatchRuntimeRecord(record);
        }
        return;
      default:
        return;
    }
  }

  ingestSnapshot(snapshot: HonkRuntimeHostSnapshot): void {
    void snapshot;
  }

  private dispatchRuntimeRecord(record: RuntimeIngestionRecord): void {
    const persistedKeys =
      record.kind === "assistant.completion"
        ? this.persistedRuntimeAssistantEntryKeys
        : this.persistedRuntimeEventKeys;
    if (persistedKeys.has(record.recordId)) {
      return;
    }
    if (
      record.kind === "thread.activity" &&
      record.payload.activity.kind === "context-window.updated"
    ) {
      this.dispatchContextWindowRecord({
        record,
        persistenceKey: record.recordId,
        persistedKeys,
      });
      return;
    }
    this.dispatchRecord({
      record,
      persistenceKey: record.recordId,
      persistedKeys,
    });
  }

  private dispatchContextWindowRecord(input: {
    readonly record: RuntimeIngestionRecord;
    readonly persistenceKey: string;
    readonly persistedKeys: Set<string>;
  }): void {
    const scopeKey = `${input.record.threadId}:${input.record.runtimeSessionId}`;
    const now = Date.now();
    const lastDispatchAt = this.contextWindowLastDispatchAtByScope.get(scopeKey) ?? 0;
    const elapsedMs = now - lastDispatchAt;
    if (
      elapsedMs >= CONTEXT_WINDOW_PERSISTENCE_MIN_INTERVAL_MS &&
      !this.pendingContextWindowDispatchByScope.has(scopeKey)
    ) {
      this.contextWindowLastDispatchAtByScope.set(scopeKey, now);
      this.dispatchRecord({
        record: input.record,
        persistenceKey: input.persistenceKey,
        persistedKeys: input.persistedKeys,
      });
      return;
    }

    const existingPending = this.pendingContextWindowDispatchByScope.get(scopeKey);
    if (existingPending) {
      clearTimeout(existingPending.timeoutId);
    }
    const delayMs = Math.max(0, CONTEXT_WINDOW_PERSISTENCE_MIN_INTERVAL_MS - elapsedMs);
    const timeoutId = setTimeout(() => {
      const pending = this.pendingContextWindowDispatchByScope.get(scopeKey);
      if (!pending || pending.timeoutId !== timeoutId) {
        return;
      }
      this.pendingContextWindowDispatchByScope.delete(scopeKey);
      this.contextWindowLastDispatchAtByScope.set(scopeKey, Date.now());
      this.dispatchRecord({
        record: pending.record,
        persistenceKey: pending.persistenceKey,
        persistedKeys: input.persistedKeys,
      });
    }, delayMs);
    unrefTimer(timeoutId);
    this.pendingContextWindowDispatchByScope.set(scopeKey, {
      record: input.record,
      persistenceKey: input.persistenceKey,
      timeoutId,
    });
  }

  private dispatchRecord(input: {
    readonly record: Parameters<DesktopOrchestrationClient["ingestRuntimeRecords"]>[0][number];
    readonly persistenceKey: string;
    readonly persistedKeys: Set<string>;
  }): void {
    const decoded = decodeRuntimePersistenceRecord(input.record, {
      errors: "all",
      propertyOrder: "original",
    });
    if (Exit.isFailure(decoded)) {
      input.persistedKeys.delete(input.persistenceKey);
      void Effect.runPromise(
        elog.error("Runtime orchestration persistence command failed schema validation", {
          issue: formatSchemaError(decoded.cause),
          issues: formatSchemaIssues(decoded.cause),
          recordKind: input.record.kind,
          recordId: input.record.recordId,
        }),
      );
      return;
    }

    rememberPersistedKey(input.persistedKeys, input.persistenceKey);
    void this.queueRecord(decoded.value)
      .then(() => this.flushOutbox())
      .catch((error: unknown) => {
        input.persistedKeys.delete(input.persistenceKey);
        void Effect.runPromise(
          elog.error("Runtime orchestration persistence failed", {
            recordKind: input.record.kind,
            recordId: input.record.recordId,
            cause: errorMessage(error),
          }),
        );
      });
  }

  private clearPendingContextWindowDispatches(): void {
    for (const pending of this.pendingContextWindowDispatchByScope.values()) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingContextWindowDispatchByScope.clear();
    this.contextWindowLastDispatchAtByScope.clear();
  }
}

let ingestionState: RuntimeIngestionState | null = null;

function getIngestionState(): RuntimeIngestionState {
  if (!ingestionState) {
    ingestionState = new RuntimeIngestionState();
  }
  return ingestionState;
}

export function ingestRuntimeHostEvent(event: HonkRuntimeHostEvent): void {
  getIngestionState().ingestHostEvent(event);
}

export const installRuntimeIngestion = Effect.acquireRelease(
  Effect.gen(function* () {
    const backendManager = yield* DesktopBackendManager.DesktopBackendManager;
    const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
    const config = yield* backendManager.currentConfig;
    if (Option.isNone(config)) {
      return yield* Effect.die(
        new Error("Desktop backend must be configured before runtime ingestion is installed."),
      );
    }
    const userDataPath = yield* appIdentity.resolveUserDataPath;
    installedClientConfig = {
      httpBaseUrl: config.value.httpBaseUrl,
      bootstrapToken: config.value.bootstrap.desktopBootstrapToken,
      runtimeRecordOutboxPath: join(userDataPath, "runtime-record-outbox.json"),
    };
    getIngestionState().resetClient();
    return () => {
      installedClientConfig = null;
      getIngestionState().resetClient();
    };
  }),
  (cleanup) => Effect.sync(cleanup),
);

export function __resetRuntimeIngestionForTests(): void {
  ingestionState?.resetClient();
  ingestionState = null;
}

export function __configureRuntimeIngestionForTests(
  config: RuntimeIngestionClientConfig,
): void {
  getIngestionState().configureForTests(config);
}
