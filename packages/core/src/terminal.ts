import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { IPty } from "@lydell/node-pty";
import * as nodePty from "@lydell/node-pty";
import { Effect, Option, Queue, Scope } from "effect";
import * as Socket from "effect/unstable/socket/Socket";
import {
  TERMINAL_CONNECT_TICKET_TTL_MS,
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_HISTORY_LINE_LIMIT,
  TerminalId,
  TerminalNotFoundError,
  decodeTerminalClientFrame,
  type ConnectTicket,
  type CreateTerminalInput,
  type Terminal,
  type TerminalClientFrame,
  type TerminalList,
  type TerminalServerFrame,
} from "@honk/api/core/v1";

const TERMINAL_ENV_BLOCKLIST = new Set([
  "PORT",
  "ELECTRON_RENDERER_PORT",
  "ELECTRON_RUN_AS_NODE",
  "TERM",
  "COLORTERM",
]);

interface ShellCandidate {
  readonly shell: string;
  readonly args?: ReadonlyArray<string>;
}

interface PtyExitEvent {
  readonly exitCode: number | null;
  readonly signal: number | null;
}

interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  clear(): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): () => void;
  onExit(callback: (event: PtyExitEvent) => void): () => void;
}

/**
 * One outbound message to a socket. The effect Socket writer must be driven by
 * a SINGLE fiber that owns it — writing from many detached fibers (one per
 * frame) serializes and never flushes. So every connection has an unbounded
 * mailbox that one drain fiber (forked in attach) empties in order, and the
 * PTY's onData callback just offers frames without touching the socket.
 */
export type OutboundMessage =
  | { readonly _tag: "frame"; readonly frame: TerminalServerFrame }
  | { readonly _tag: "close"; readonly code: number; readonly reason: string };

interface TerminalConnection {
  readonly id: string;
  readonly outbound: Queue.Queue<OutboundMessage>;
}

interface TerminalState {
  terminal: Terminal;
  process: PtyProcess | null;
  history: string;
  connections: Map<string, TerminalConnection>;
  unsubscribeData: (() => void) | null;
  unsubscribeExit: (() => void) | null;
}

interface TerminalTicketState {
  readonly terminalId: TerminalId;
  readonly expiresAt: number;
}

export interface Terminals {
  readonly list: () => Effect.Effect<TerminalList>;
  readonly create: (input: CreateTerminalInput) => Effect.Effect<Terminal>;
  readonly issueTicket: (
    terminalId: TerminalId,
  ) => Effect.Effect<ConnectTicket, TerminalNotFoundError>;
  readonly consumeTicket: (ticket: string) => TerminalId | null;
  readonly attach: (
    terminalId: TerminalId,
    socket: Socket.Socket,
  ) => Effect.Effect<void, TerminalNotFoundError, Scope.Scope>;
  readonly write: (
    terminalId: TerminalId,
    data: string,
  ) => Effect.Effect<void, TerminalNotFoundError>;
  readonly resize: (
    terminalId: TerminalId,
    cols: number,
    rows: number,
  ) => Effect.Effect<void, TerminalNotFoundError>;
  readonly clear: (terminalId: TerminalId) => Effect.Effect<void, TerminalNotFoundError>;
  readonly restart: (terminalId: TerminalId) => Effect.Effect<Terminal, TerminalNotFoundError>;
  readonly close: (terminalId: TerminalId) => Effect.Effect<void, TerminalNotFoundError>;
  readonly dispose: () => Effect.Effect<void>;
}

let didEnsureSpawnHelperExecutable = false;

class NodePtyProcess implements PtyProcess {
  constructor(private readonly process: IPty) {}

  get pid(): number {
    return this.process.pid;
  }

  write(data: string): void {
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    this.process.resize(cols, rows);
  }

  clear(): void {
    this.process.clear();
  }

  kill(signal?: string): void {
    this.process.kill(signal);
  }

  onData(callback: (data: string) => void): () => void {
    const disposable = this.process.onData(callback);
    return () => {
      disposable.dispose();
    };
  }

  onExit(callback: (event: PtyExitEvent) => void): () => void {
    const disposable = this.process.onExit((event) => {
      callback({
        exitCode: Number.isInteger(event.exitCode) ? event.exitCode : null,
        signal: event.signal ?? null,
      });
    });
    return () => {
      disposable.dispose();
    };
  }
}

function resolvePlatformPackageDir(): string | null {
  try {
    const requireFromSource = createRequire(import.meta.url);
    const nodePtyEntry = requireFromSource.resolve("@lydell/node-pty");
    const requireFromNodePty = createRequire(nodePtyEntry);
    const platformPackage = `@lydell/node-pty-${process.platform}-${process.arch}`;
    const platformEntry = requireFromNodePty.resolve(platformPackage);
    return path.join(path.dirname(platformEntry), "..");
  } catch {
    return null;
  }
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform === "win32" || didEnsureSpawnHelperExecutable) return;
  didEnsureSpawnHelperExecutable = true;

  const packageDir = resolvePlatformPackageDir();
  if (packageDir === null) return;

  const candidates = [
    path.join(packageDir, "build", "Release", "spawn-helper"),
    path.join(packageDir, "build", "Debug", "spawn-helper"),
    path.join(packageDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      chmodSync(candidate, 0o755);
    } catch {
      // Best effort: packaged builds can expose incomplete fs metadata.
    }
    return;
  }
}

function defaultShellResolver(): string | undefined {
  if (process.platform === "win32") {
    return process.env.ComSpec ?? "cmd.exe";
  }
  return process.env.SHELL;
}

function normalizeShellCommand(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (process.platform === "win32") {
    return trimmed;
  }

  const firstToken = trimmed.split(/\s+/g)[0]?.trim();
  if (firstToken === undefined || firstToken.length === 0) return null;
  return firstToken.replace(/^['"]|['"]$/g, "");
}

function shellCandidateFromCommand(command: string | null): ShellCandidate | null {
  if (command === null || command.length === 0) return null;
  const shellName = path.basename(command).toLowerCase();
  if (process.platform !== "win32") {
    if (shellName === "zsh") {
      return { shell: command, args: ["-l", "-i", "-o", "nopromptsp"] };
    }
    if (shellName === "bash") {
      return { shell: command, args: ["--login", "-i"] };
    }
    if (shellName === "fish") {
      return { shell: command, args: ["--login", "--interactive"] };
    }
  }
  return { shell: command };
}

function formatShellCandidate(candidate: ShellCandidate): string {
  if (candidate.args === undefined || candidate.args.length === 0) return candidate.shell;
  return `${candidate.shell} ${candidate.args.join(" ")}`;
}

function uniqueShellCandidates(
  candidates: ReadonlyArray<ShellCandidate | null>,
): Array<ShellCandidate> {
  const seen = new Set<string>();
  const ordered: Array<ShellCandidate> = [];
  for (const candidate of candidates) {
    if (candidate === null) continue;
    const key = formatShellCandidate(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(candidate);
  }
  return ordered;
}

function resolveShellCandidates(): Array<ShellCandidate> {
  const requested = shellCandidateFromCommand(normalizeShellCommand(defaultShellResolver()));

  if (process.platform === "win32") {
    return uniqueShellCandidates([
      requested,
      shellCandidateFromCommand(process.env.ComSpec ?? null),
      shellCandidateFromCommand("powershell.exe"),
      shellCandidateFromCommand("cmd.exe"),
    ]);
  }

  return uniqueShellCandidates([
    requested,
    shellCandidateFromCommand("/bin/fish"),
    shellCandidateFromCommand("/bin/zsh"),
    shellCandidateFromCommand("/bin/bash"),
    shellCandidateFromCommand("/bin/sh"),
    shellCandidateFromCommand("fish"),
    shellCandidateFromCommand("zsh"),
    shellCandidateFromCommand("bash"),
    shellCandidateFromCommand("sh"),
  ]);
}

function isRetryableShellSpawnError(cause: unknown): boolean {
  const queue: Array<unknown> = [cause];
  const seen = new Set<unknown>();
  const messages: Array<string> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === "string") {
      messages.push(current);
      continue;
    }

    if (current instanceof Error) {
      messages.push(current.message);
      if (current.cause !== undefined) queue.push(current.cause);
      continue;
    }

    if (typeof current === "object" && current !== null) {
      const value = current as { readonly message?: unknown; readonly cause?: unknown };
      if (typeof value.message === "string") messages.push(value.message);
      if (value.cause !== undefined) queue.push(value.cause);
    }
  }

  const message = messages.join(" ").toLowerCase();
  return (
    message.includes("posix_spawnp failed") ||
    message.includes("enoent") ||
    message.includes("not found") ||
    message.includes("file not found") ||
    message.includes("no such file")
  );
}

function shouldExcludeTerminalEnvKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  if (normalizedKey.startsWith("HONK_")) return true;
  if (normalizedKey.startsWith("VITE_")) return true;
  return TERMINAL_ENV_BLOCKLIST.has(normalizedKey);
}

function createTerminalSpawnEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const spawnEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (shouldExcludeTerminalEnvKey(key)) continue;
    spawnEnv[key] = value;
  }
  spawnEnv.TERM = "xterm-256color";
  spawnEnv.COLORTERM = "truecolor";
  return spawnEnv;
}

function capHistory(history: string): string {
  if (history.length === 0) return history;
  const hasTrailingNewline = history.endsWith("\n");
  const lines = history.split("\n");
  if (hasTrailingNewline) {
    lines.pop();
  }
  if (lines.length <= TERMINAL_HISTORY_LINE_LIMIT) return history;
  const capped = lines.slice(lines.length - TERMINAL_HISTORY_LINE_LIMIT).join("\n");
  return hasTrailingNewline ? `${capped}\n` : capped;
}

function resolveCwd(cwd: string | undefined): string {
  const resolved = path.resolve(cwd ?? process.cwd());
  const stats = statSync(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`Terminal cwd is not a directory: ${resolved}`);
  }
  return resolved;
}

function spawnPty(input: {
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
}): PtyProcess {
  ensureNodePtySpawnHelperExecutable();
  const env = createTerminalSpawnEnv(process.env);
  const candidates = resolveShellCandidates();
  let lastError: unknown = new Error("No terminal shell candidates were available.");

  for (const candidate of candidates) {
    try {
      const pty = nodePty.spawn(candidate.shell, [...(candidate.args ?? [])], {
        cwd: input.cwd,
        cols: input.cols,
        rows: input.rows,
        env,
      });
      return new NodePtyProcess(pty);
    } catch (error) {
      lastError = error;
      if (!isRetryableShellSpawnError(error)) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to spawn terminal PTY.");
}

function now(): string {
  return new Date().toISOString();
}

function randomTicket(): string {
  return randomBytes(32).toString("base64url");
}

function sendFrame(connection: TerminalConnection, frame: TerminalServerFrame): void {
  Queue.offerUnsafe(connection.outbound, { _tag: "frame", frame });
}

function closeConnection(connection: TerminalConnection, code = 1000, reason = "closed"): void {
  Queue.offerUnsafe(connection.outbound, { _tag: "close", code, reason });
}

export const drainOutbound = (
  writer: (chunk: Uint8Array | string | Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>,
  outbound: Queue.Queue<OutboundMessage>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    while (true) {
      const message = yield* Queue.take(outbound);
      yield* (message._tag === "close"
        ? writer(new Socket.CloseEvent(message.code, message.reason))
        : writer(JSON.stringify(message.frame))
      ).pipe(Effect.ignore);
      if (message._tag === "close") return;
    }
  });

function cleanupProcessHandles(state: TerminalState): void {
  state.unsubscribeData?.();
  state.unsubscribeData = null;
  state.unsubscribeExit?.();
  state.unsubscribeExit = null;
}

function killProcess(processToKill: PtyProcess): void {
  let signaled = false;
  try {
    processToKill.kill("SIGTERM");
    signaled = true;
  } catch {
    try {
      processToKill.kill();
      signaled = true;
    } catch {
      signaled = false;
    }
  }

  if (!signaled) return;
  const timer = setTimeout(() => {
    try {
      processToKill.kill("SIGKILL");
    } catch {
      // Process already exited or the platform does not support SIGKILL.
    }
  }, 1_000);
  timer.unref();
}

export const makeTerminals = (): Terminals => {
  const terminals = new Map<string, TerminalState>();
  const tickets = new Map<string, TerminalTicketState>();

  const terminalKey = (terminalId: TerminalId): string => String(terminalId);

  const sweepTickets = (at = Date.now()): void => {
    for (const [ticket, state] of tickets) {
      if (state.expiresAt <= at) tickets.delete(ticket);
    }
  };

  const snapshot = (state: TerminalState): Terminal => state.terminal;

  const requireState = (
    terminalId: TerminalId,
  ): Effect.Effect<TerminalState, TerminalNotFoundError> =>
    Effect.sync(() => terminals.get(terminalKey(terminalId))).pipe(
      Effect.flatMap((state) =>
        state === undefined
          ? Effect.fail(new TerminalNotFoundError({ terminalId }))
          : Effect.succeed(state),
      ),
    );

  const fanout = (state: TerminalState, frame: TerminalServerFrame): void => {
    for (const connection of state.connections.values()) {
      sendFrame(connection, frame);
    }
  };

  const onData = (terminalId: TerminalId, expectedPid: number, data: string): void => {
    const state = terminals.get(terminalKey(terminalId));
    if (state === undefined) return;
    if (state.process === null || state.process.pid !== expectedPid) return;
    state.history = capHistory(`${state.history}${data}`);
    fanout(state, { type: "output", data });
  };

  const onExit = (terminalId: TerminalId, expectedPid: number, event: PtyExitEvent): void => {
    const state = terminals.get(terminalKey(terminalId));
    if (state === undefined) return;
    if (state.process === null || state.process.pid !== expectedPid) return;
    cleanupProcessHandles(state);
    state.process = null;
    state.terminal = {
      ...state.terminal,
      status: "exited",
      exitCode: event.exitCode,
    };
    fanout(state, { type: "exit", exitCode: event.exitCode });
  };

  const startProcess = (state: TerminalState): Effect.Effect<void, unknown> =>
    Effect.try({
      try: () => {
        const pty = spawnPty({
          cwd: state.terminal.cwd,
          cols: state.terminal.cols,
          rows: state.terminal.rows,
        });
        state.process = pty;
        state.terminal = {
          ...state.terminal,
          status: "running",
          exitCode: null,
        };
        state.unsubscribeData = pty.onData((data) => {
          onData(state.terminal.id, pty.pid, data);
        });
        state.unsubscribeExit = pty.onExit((event) => {
          onExit(state.terminal.id, pty.pid, event);
        });
      },
      catch: (cause) => cause,
    });

  const stopProcess = (state: TerminalState): void => {
    const current = state.process;
    cleanupProcessHandles(state);
    state.process = null;
    if (current !== null) {
      killProcess(current);
    }
  };

  const handleFrame = (
    terminalId: TerminalId,
    frame: TerminalClientFrame,
  ): Effect.Effect<void, TerminalNotFoundError> => {
    if (frame.type === "write") {
      return write(terminalId, frame.data);
    }
    return resize(terminalId, frame.cols, frame.rows);
  };

  const list = (): Effect.Effect<TerminalList> =>
    Effect.sync(() => ({
      terminals: [...terminals.values()]
        .map(snapshot)
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
    }));

  const create = (input: CreateTerminalInput): Effect.Effect<Terminal> =>
    Effect.gen(function* () {
      const cwd = yield* Effect.try({
        try: () => resolveCwd(input.cwd),
        catch: (cause) => cause,
      }).pipe(Effect.orDie);
      const terminalId = TerminalId.make(`terminal_${randomUUID()}`);
      const terminal: Terminal = {
        id: terminalId,
        threadId: input.threadId ?? null,
        title: (input.title ?? path.basename(cwd)) || "Terminal",
        cwd,
        cols: input.cols ?? TERMINAL_DEFAULT_COLS,
        rows: input.rows ?? TERMINAL_DEFAULT_ROWS,
        createdAt: now(),
        status: "running",
        exitCode: null,
      };
      const state: TerminalState = {
        terminal,
        process: null,
        history: "",
        connections: new Map(),
        unsubscribeData: null,
        unsubscribeExit: null,
      };
      terminals.set(terminalKey(terminalId), state);
      yield* startProcess(state).pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            terminals.delete(terminalKey(terminalId));
          }).pipe(Effect.flatMap(() => Effect.fail(cause))),
        ),
        Effect.orDie,
      );
      return snapshot(state);
    });

  const issueTicket = (
    terminalId: TerminalId,
  ): Effect.Effect<ConnectTicket, TerminalNotFoundError> =>
    Effect.gen(function* () {
      yield* requireState(terminalId);
      const at = Date.now();
      sweepTickets(at);
      const ticket = randomTicket();
      const expiresAt = at + TERMINAL_CONNECT_TICKET_TTL_MS;
      tickets.set(ticket, { terminalId, expiresAt });
      return { ticket, expiresAt: new Date(expiresAt).toISOString() };
    });

  const consumeTicket = (ticket: string): TerminalId | null => {
    const at = Date.now();
    sweepTickets(at);
    const state = tickets.get(ticket);
    if (state === undefined) return null;
    tickets.delete(ticket);
    if (state.expiresAt <= at) return null;
    if (!terminals.has(terminalKey(state.terminalId))) return null;
    return state.terminalId;
  };

  const attach = (
    terminalId: TerminalId,
    socket: Socket.Socket,
  ): Effect.Effect<void, TerminalNotFoundError, Scope.Scope> =>
    Effect.gen(function* () {
      const state = yield* requireState(terminalId);
      const writer = yield* socket.writer;
      const outbound = yield* Queue.unbounded<OutboundMessage>();
      const connection: TerminalConnection = {
        id: randomUUID(),
        outbound,
      };
      state.connections.set(connection.id, connection);

      // One fiber owns the writer and drains the mailbox in order; it dies with
      // the attach scope when runString returns (socket closed).
      yield* Effect.forkScoped(drainOutbound(writer, outbound));

      sendFrame(connection, { type: "history", data: state.history });
      if (state.terminal.status === "exited") {
        sendFrame(connection, { type: "exit", exitCode: state.terminal.exitCode });
      }

      yield* socket
        .runString((raw) => {
          const frame = decodeTerminalClientFrame(raw);
          if (Option.isNone(frame)) return;
          return handleFrame(terminalId, frame.value).pipe(Effect.ignore);
        })
        .pipe(
          Effect.catch(() => Effect.void),
          Effect.ensuring(
            Effect.sync(() => {
              const current = terminals.get(terminalKey(terminalId));
              current?.connections.delete(connection.id);
            }),
          ),
        );
    });

  const write = (
    terminalId: TerminalId,
    data: string,
  ): Effect.Effect<void, TerminalNotFoundError> =>
    Effect.gen(function* () {
      const state = yield* requireState(terminalId);
      if (state.process === null || state.terminal.status !== "running") return;
      yield* Effect.sync(() => {
        const current = state.process;
        if (current !== null) current.write(data);
      }).pipe(Effect.orDie);
    });

  const resize = (
    terminalId: TerminalId,
    cols: number,
    rows: number,
  ): Effect.Effect<void, TerminalNotFoundError> =>
    Effect.gen(function* () {
      const state = yield* requireState(terminalId);
      state.terminal = { ...state.terminal, cols, rows };
      if (state.process === null || state.terminal.status !== "running") return;
      yield* Effect.sync(() => {
        const current = state.process;
        if (current !== null) current.resize(cols, rows);
      }).pipe(Effect.orDie);
    });

  const clear = (terminalId: TerminalId): Effect.Effect<void, TerminalNotFoundError> =>
    Effect.gen(function* () {
      const state = yield* requireState(terminalId);
      state.history = "";
      const current = state.process;
      if (current !== null) {
        yield* Effect.sync(() => {
          current.clear();
        }).pipe(Effect.ignore);
      }
      fanout(state, { type: "history", data: "" });
    });

  const restart = (terminalId: TerminalId): Effect.Effect<Terminal, TerminalNotFoundError> =>
    Effect.gen(function* () {
      const state = yield* requireState(terminalId);
      stopProcess(state);
      state.history = "";
      state.terminal = {
        ...state.terminal,
        status: "running",
        exitCode: null,
      };
      fanout(state, { type: "history", data: "" });
      yield* startProcess(state).pipe(Effect.orDie);
      return snapshot(state);
    });

  const close = (terminalId: TerminalId): Effect.Effect<void, TerminalNotFoundError> =>
    Effect.gen(function* () {
      const state = yield* requireState(terminalId);
      terminals.delete(terminalKey(terminalId));
      stopProcess(state);
      for (const connection of state.connections.values()) {
        sendFrame(connection, { type: "exit", exitCode: state.terminal.exitCode });
        closeConnection(connection);
      }
      state.connections.clear();
    });

  const dispose = (): Effect.Effect<void> =>
    Effect.sync(() => {
      tickets.clear();
      for (const [terminalId, state] of terminals) {
        terminals.delete(terminalId);
        stopProcess(state);
        for (const connection of state.connections.values()) {
          closeConnection(connection);
        }
        state.connections.clear();
      }
    });

  return {
    list,
    create,
    issueTicket,
    consumeTicket,
    attach,
    write,
    resize,
    clear,
    restart,
    close,
    dispose,
  };
};
