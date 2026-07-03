import {
  ThreadId as CoreApiThreadId,
  type CreateTerminalInput,
  type Terminal as CoreTerminal,
} from "@honk/api/core/v1";
import {
  DEFAULT_TERMINAL_ID,
  type TerminalEvent,
  type TerminalSessionSnapshot,
} from "@honk/shared/terminal";
import type { EnvironmentApi } from "@honk/contracts";
import type { TerminalSession } from "@honk/sdk";

import type { CoreEnvironmentConnection } from "./connection";

type TerminalApi = EnvironmentApi["terminal"];
type TerminalOpenInput = Parameters<TerminalApi["open"]>[0];
type TerminalWriteInput = Parameters<TerminalApi["write"]>[0];
type TerminalResizeInput = Parameters<TerminalApi["resize"]>[0];
type TerminalClearInput = Parameters<TerminalApi["clear"]>[0];
type TerminalRestartInput = Parameters<TerminalApi["restart"]>[0];
type TerminalCloseInput = Parameters<TerminalApi["close"]>[0];
type TerminalEventListener = Parameters<TerminalApi["onEvent"]>[0];

interface AppTerminalRef {
  readonly threadId: string;
  readonly terminalId: string;
}

interface CoreTerminalEntry {
  readonly key: string;
  readonly ref: AppTerminalRef;
  readonly coreTerminalId: CoreTerminal["id"];
  session: TerminalSession | null;
  snapshot: TerminalSessionSnapshot;
  history: string;
  closedByApp: boolean;
  exitEmitted: boolean;
}

const CORE_TERMINAL_CLEAR_UNSUPPORTED_ERROR =
  "Core terminal clear/history is not supported by honk.terminals.";
const CORE_TERMINAL_ENV_UNSUPPORTED_ERROR =
  "Core terminal open/restart does not support per-terminal env overrides.";
const CORE_TERMINAL_WORKTREE_UNSUPPORTED_ERROR =
  "Core terminal open/restart does not support a separate worktreePath.";

function coreThreadId(id: string): CoreApiThreadId {
  return CoreApiThreadId.make(id);
}

function terminalRef(input: {
  readonly threadId: string;
  readonly terminalId?: string | undefined;
}): AppTerminalRef {
  return {
    threadId: input.threadId,
    terminalId: input.terminalId ?? DEFAULT_TERMINAL_ID,
  };
}

function terminalKey(ref: AppTerminalRef): string {
  return `${ref.threadId}\0${ref.terminalId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function terminalSnapshot(input: {
  readonly ref: AppTerminalRef;
  readonly terminal: CoreTerminal;
  readonly history: string;
  readonly status?: TerminalSessionSnapshot["status"] | undefined;
  readonly updatedAt?: string | undefined;
}): TerminalSessionSnapshot {
  return {
    threadId: input.ref.threadId,
    terminalId: input.ref.terminalId,
    cwd: input.terminal.cwd,
    worktreePath: null,
    status: input.status ?? (input.terminal.status === "running" ? "running" : "exited"),
    pid: null,
    history: input.history,
    exitCode: input.terminal.exitCode,
    exitSignal: null,
    updatedAt: input.updatedAt ?? input.terminal.createdAt,
  };
}

function createTerminalInput(input: TerminalOpenInput, ref: AppTerminalRef): CreateTerminalInput {
  return {
    cwd: input.cwd,
    threadId: coreThreadId(ref.threadId),
    title: ref.terminalId,
    ...(input.cols !== undefined ? { cols: input.cols } : {}),
    ...(input.rows !== undefined ? { rows: input.rows } : {}),
  };
}

function ensureCoreSpawnInputSupported(input: TerminalOpenInput | TerminalRestartInput): void {
  if (input.env !== undefined) {
    throw new Error(CORE_TERMINAL_ENV_UNSUPPORTED_ERROR);
  }
  if (input.worktreePath !== undefined && input.worktreePath !== null) {
    throw new Error(CORE_TERMINAL_WORKTREE_UNSUPPORTED_ERROR);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCoreTerminalApi(connection: CoreEnvironmentConnection): TerminalApi {
  const listeners = new Set<TerminalEventListener>();
  const entries = new Map<string, CoreTerminalEntry>();

  const emit = (event: TerminalEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  // Re-adopt a core terminal after a reload wiped the local `entries` map. Core
  // terminals have no rename verb, so `title` is set once at create and doubles
  // as the stable per-thread logical key (the app's terminalId); terminalKey
  // dedups by (threadId, terminalId), so titles never collide within a thread.
  // If core ever adds a rename verb, this needs a dedicated stable ref field.
  const findCoreTerminal = async (ref: AppTerminalRef): Promise<CoreTerminal | null> => {
    const terminals = await connection.honk().terminals.list();
    return (
      terminals.find(
        (terminal) =>
          terminal.threadId !== null &&
          String(terminal.threadId) === ref.threadId &&
          terminal.title === ref.terminalId,
      ) ?? null
    );
  };

  const getOrCreateCoreTerminal = async (
    input: TerminalOpenInput,
    ref: AppTerminalRef,
  ): Promise<CoreTerminal> => {
    const existingEntry = entries.get(terminalKey(ref));
    if (existingEntry) {
      existingEntry.closedByApp = true;
      existingEntry.session?.close();
      entries.delete(existingEntry.key);
      return connection.honk().terminals.restart(existingEntry.coreTerminalId);
    }

    const existingTerminal = await findCoreTerminal(ref);
    if (existingTerminal) {
      return existingTerminal.status === "running"
        ? existingTerminal
        : connection.honk().terminals.restart(existingTerminal.id);
    }

    return connection.honk().terminals.create(createTerminalInput(input, ref));
  };

  const emitStarted = (entry: CoreTerminalEntry, type: "started" | "restarted"): void => {
    const event = {
      type,
      threadId: entry.ref.threadId,
      terminalId: entry.ref.terminalId,
      createdAt: nowIso(),
      snapshot: entry.snapshot,
    } satisfies TerminalEvent;
    emit(event);
  };

  const emitOutput = (entry: CoreTerminalEntry, data: string): void => {
    const updatedAt = nowIso();
    entry.history += data;
    entry.snapshot = {
      ...entry.snapshot,
      history: entry.history,
      updatedAt,
    };
    const event = {
      type: "output",
      threadId: entry.ref.threadId,
      terminalId: entry.ref.terminalId,
      createdAt: updatedAt,
      data,
    } satisfies TerminalEvent;
    emit(event);
  };

  const emitExited = (entry: CoreTerminalEntry, exitCode: number | null): void => {
    if (entry.exitEmitted) {
      return;
    }
    entry.exitEmitted = true;
    const updatedAt = nowIso();
    entry.snapshot = {
      ...entry.snapshot,
      status: "exited",
      exitCode,
      exitSignal: null,
      updatedAt,
    };
    const event = {
      type: "exited",
      threadId: entry.ref.threadId,
      terminalId: entry.ref.terminalId,
      createdAt: updatedAt,
      exitCode,
      exitSignal: null,
    } satisfies TerminalEvent;
    emit(event);
  };

  const emitError = (entry: CoreTerminalEntry, error: unknown): void => {
    const updatedAt = nowIso();
    entry.snapshot = {
      ...entry.snapshot,
      status: "error",
      updatedAt,
    };
    const event = {
      type: "error",
      threadId: entry.ref.threadId,
      terminalId: entry.ref.terminalId,
      createdAt: updatedAt,
      message: errorMessage(error),
    } satisfies TerminalEvent;
    emit(event);
  };

  const attachCoreTerminal = async (input: {
    readonly ref: AppTerminalRef;
    readonly terminal: CoreTerminal;
    readonly eventType: "started" | "restarted";
  }): Promise<CoreTerminalEntry> => {
    const key = terminalKey(input.ref);
    const entry: CoreTerminalEntry = {
      key,
      ref: input.ref,
      coreTerminalId: input.terminal.id,
      session: null,
      snapshot: terminalSnapshot({
        ref: input.ref,
        terminal: input.terminal,
        history: "",
        status: "running",
        updatedAt: nowIso(),
      }),
      history: "",
      closedByApp: false,
      exitEmitted: false,
    };

    const session = await connection.honk().terminals.attach(input.terminal.id, {
      onData: (data) => emitOutput(entry, data),
      onExit: (exitCode) => emitExited(entry, exitCode),
      onClose: () => {
        entries.delete(key);
        entry.session = null;
        if (!entry.closedByApp) {
          emitExited(entry, entry.snapshot.exitCode);
        }
      },
      onError: (error) => emitError(entry, error),
    });

    entry.session = session;
    entries.set(key, entry);
    emitStarted(entry, input.eventType);
    return entry;
  };

  const sessionForInput = (input: TerminalWriteInput | TerminalResizeInput): TerminalSession => {
    const ref = terminalRef(input);
    const entry = entries.get(terminalKey(ref));
    if (!entry || !entry.session) {
      throw new Error(`Core terminal session is not attached: ${ref.threadId}/${ref.terminalId}.`);
    }
    return entry.session;
  };

  const closeEntry = async (entry: CoreTerminalEntry): Promise<void> => {
    entries.delete(entry.key);
    entry.closedByApp = true;
    entry.session?.close();
    entry.session = null;
    await connection.honk().terminals.close(entry.coreTerminalId);
  };

  const closeRef = async (ref: AppTerminalRef): Promise<void> => {
    const key = terminalKey(ref);
    const entry = entries.get(key);
    if (entry) {
      await closeEntry(entry);
      return;
    }

    const terminal = await findCoreTerminal(ref);
    if (!terminal) {
      return;
    }
    await connection.honk().terminals.close(terminal.id);
  };

  const closeThread = async (threadId: string): Promise<void> => {
    const entriesForThread = [...entries.values()].filter(
      (entry) => entry.ref.threadId === threadId,
    );
    const closedTerminalIds = new Set(entriesForThread.map((entry) => entry.coreTerminalId));
    for (const entry of entriesForThread) {
      await closeEntry(entry);
    }

    const terminals = await connection.honk().terminals.list();
    for (const terminal of terminals) {
      if (
        terminal.threadId !== null &&
        String(terminal.threadId) === threadId &&
        !closedTerminalIds.has(terminal.id)
      ) {
        await connection.honk().terminals.close(terminal.id);
      }
    }
  };

  return {
    open: async (input) => {
      ensureCoreSpawnInputSupported(input);
      const ref = terminalRef(input);
      const key = terminalKey(ref);
      const existingEntry = entries.get(key);
      if (existingEntry && existingEntry.session && existingEntry.snapshot.status === "running") {
        if (input.cols !== undefined && input.rows !== undefined) {
          existingEntry.session.resize(input.cols, input.rows);
        }
        return existingEntry.snapshot;
      }

      const terminal = await getOrCreateCoreTerminal(input, ref);
      const entry = await attachCoreTerminal({
        ref,
        terminal,
        eventType: "started",
      });
      if (input.cols !== undefined && input.rows !== undefined) {
        entry.session?.resize(input.cols, input.rows);
      }
      return entry.snapshot;
    },
    write: async (input) => {
      sessionForInput(input).write(input.data);
    },
    resize: async (input) => {
      sessionForInput(input).resize(input.cols, input.rows);
    },
    clear: (_input: TerminalClearInput) =>
      Promise.reject(new Error(CORE_TERMINAL_CLEAR_UNSUPPORTED_ERROR)),
    restart: async (input) => {
      ensureCoreSpawnInputSupported(input);
      const ref = terminalRef(input);
      const key = terminalKey(ref);
      const existingEntry = entries.get(key);
      if (existingEntry) {
        existingEntry.closedByApp = true;
        existingEntry.session?.close();
        existingEntry.session = null;
        entries.delete(key);
      }

      const terminal =
        existingEntry !== undefined
          ? await connection.honk().terminals.restart(existingEntry.coreTerminalId)
          : await findCoreTerminal(ref).then((existingTerminal) =>
              existingTerminal
                ? connection.honk().terminals.restart(existingTerminal.id)
                : connection.honk().terminals.create(createTerminalInput(input, ref)),
            );
      const entry = await attachCoreTerminal({
        ref,
        terminal,
        eventType: "restarted",
      });
      entry.session?.resize(input.cols, input.rows);
      return entry.snapshot;
    },
    close: async (input: TerminalCloseInput) => {
      if (input.terminalId) {
        await closeRef(terminalRef(input));
        return;
      }
      await closeThread(input.threadId);
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
