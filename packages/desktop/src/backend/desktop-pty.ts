import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import * as NodePath from "node:path";

import type { IPty } from "@lydell/node-pty";
import * as nodePty from "@lydell/node-pty";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

import type { DesktopPtyOpenOptions } from "@honk/shared/desktop-api";
import * as EffectLogger from "@honk/shared/effect-logger";
import type { TerminalSessionSnapshot } from "@honk/shared/terminal";

import * as IpcChannels from "../ipc/channels";
import {
  appendTerminalOutput,
  createTerminalOutputBuffer,
  readTerminalOutput,
  type TerminalOutputBuffer,
} from "./desktop-pty-buffer";

// PTY bridge for the terminal panel. Spawn a login shell, pump output, no leaks.
// Foreground sessions belong to one renderer and die with it. Background jobs are
// agent-started, owned by main, and survive reloads until the user closes the tab.

const elog = EffectLogger.create({ service: "desktop-pty" });

const TERMINAL_NAME = "xterm-256color";

// Strip Electron vars that confuse a fresh login shell. Preserve the rest of the user's shell
// environment so prompt tooling such as Starship can initialize normally.
const ENV_BLOCKLIST = new Set([
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_RENDERER_PORT",
  "TERM",
  "COLORTERM",
]);

/** Background jobs carry a caller-supplied id so the tab and the agent agree on it. */
export interface DesktopPtyBackgroundOptions {
  readonly id: string;
  readonly threadId: string;
  readonly command: string;
  readonly cwd: string;
}

export interface DesktopPtyShape {
  readonly open: (options: DesktopPtyOpenOptions) => Effect.Effect<void>;
  readonly openBackground: (
    options: DesktopPtyBackgroundOptions,
  ) => Effect.Effect<TerminalSessionSnapshot>;
  /** Snapshot of a background job, or null when main owns no such session. */
  readonly attach: (
    id: string,
    options?: { readonly maxHistorySize?: number },
  ) => Effect.Effect<TerminalSessionSnapshot | null>;
  readonly list: (threadId: string) => Effect.Effect<readonly TerminalSessionSnapshot[]>;
  readonly write: (id: string, data: string) => Effect.Effect<void>;
  readonly resize: (id: string, cols: number, rows: number) => Effect.Effect<void>;
  /** Stop a background job while retaining its output for the tab and agent. */
  readonly stop: (id: string) => Effect.Effect<void>;
  /** Close and forget a renderer-owned shell or background job. */
  readonly close: (id: string) => Effect.Effect<void>;
}

export class DesktopPty extends Context.Service<DesktopPty, DesktopPtyShape>()(
  "honk/desktop/Pty",
) {}

interface BackgroundJob {
  readonly threadId: string;
  readonly output: TerminalOutputBuffer;
}

interface SessionExit {
  readonly code: number | null;
  readonly signal: number | null;
  readonly at: string;
}

interface PtySession {
  readonly pty: IPty;
  readonly disposeData: () => void;
  readonly disposeExit: () => void;
  readonly cwd: string;
  readonly background: BackgroundJob | null;
  // Retained after exit for background jobs so a late attach renders "exited with code N".
  exit: SessionExit | null;
}

// Background jobs open without a renderer, so they need a grid before the tab attaches.
const BACKGROUND_COLS = 120;
const BACKGROUND_ROWS = 40;

let didEnsureSpawnHelperExecutable = false;

// Ensure spawn-helper is +x. Some packaging strips the bit.
function resolvePlatformPackageDir(): string | null {
  try {
    const requireFromSource = createRequire(import.meta.url);
    const nodePtyEntry = requireFromSource.resolve("@lydell/node-pty");
    const requireFromNodePty = createRequire(nodePtyEntry);
    const platformPackage = `@lydell/node-pty-${process.platform}-${process.arch}`;
    const platformEntry = requireFromNodePty.resolve(platformPackage);
    return NodePath.join(NodePath.dirname(platformEntry), "..");
  } catch {
    return null;
  }
}

function ensureSpawnHelperExecutable(): void {
  if (process.platform === "win32" || didEnsureSpawnHelperExecutable) return;
  didEnsureSpawnHelperExecutable = true;

  const packageDir = resolvePlatformPackageDir();
  if (packageDir === null) return;

  const candidates = [
    NodePath.join(packageDir, "build", "Release", "spawn-helper"),
    NodePath.join(packageDir, "build", "Debug", "spawn-helper"),
    NodePath.join(packageDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      chmodSync(candidate, 0o755);
    } catch {
      // Packaged builds can expose incomplete fs metadata; best effort.
    }
    return;
  }
}

function resolveShell(): { readonly shell: string; readonly args: readonly string[] } {
  if (process.platform === "win32") {
    return { shell: process.env.ComSpec ?? "cmd.exe", args: [] };
  }

  const requested = process.env.SHELL?.trim();
  const shell =
    requested !== undefined && requested.length > 0
      ? requested
      : process.platform === "darwin"
        ? "/bin/zsh"
        : "/bin/bash";

  // Login + interactive so profile and prompt match a normal terminal.
  const name = NodePath.basename(shell).toLowerCase();
  if (name === "bash") return { shell, args: ["--login", "-i"] };
  if (name === "zsh" || name === "fish") return { shell, args: ["-l", "-i"] };
  return { shell, args: ["-l"] };
}

function resolveCwd(cwd: string): string {
  try {
    const resolved = NodePath.resolve(cwd);
    if (statSync(resolved).isDirectory()) return resolved;
  } catch {}
  return homedir();
}

function buildSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (ENV_BLOCKLIST.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  env.TERM = TERMINAL_NAME;
  env.COLORTERM = "truecolor";
  env.HONK_TERMINAL = "1";
  return env;
}

// Sync fan-out on the node-pty hot path. Skip the Effect runtime here.
function broadcast(channel: string, payload: unknown): void {
  for (const window of Electron.BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(channel, payload);
  }
}

const make = Effect.gen(function* () {
  const sessions = new Map<string, PtySession>();

  const disposeSession = (session: PtySession): void => {
    session.disposeData();
    session.disposeExit();
  };

  const killSession = (session: PtySession): void => {
    disposeSession(session);
    try {
      session.pty.kill();
    } catch {}
  };

  // Foreground sessions are renderer-owned and must not outlive a reload or crash;
  // background jobs are main-owned and only the user (or quit) may end them.
  const killSessions = (scope: "all" | "foreground"): Effect.Effect<void> =>
    Effect.sync(() => {
      for (const [id, session] of sessions) {
        if (scope === "foreground" && session.background !== null) continue;
        sessions.delete(id);
        killSession(session);
      }
    });

  const killAll = killSessions("all");

  const spawnSession = (options: {
    readonly id: string;
    readonly cwd: string;
    readonly cols: number;
    readonly rows: number;
    readonly background: BackgroundJob | null;
  }): PtySession => {
    // Reusing an id replaces the session; without this the old pty would be orphaned.
    const replaced = sessions.get(options.id);
    if (replaced !== undefined) killSession(replaced);
    ensureSpawnHelperExecutable();
    const { shell, args } = resolveShell();
    const cwd = resolveCwd(options.cwd);
    const pty = nodePty.spawn(shell, [...args], {
      name: TERMINAL_NAME,
      cwd,
      cols: Math.max(1, Math.trunc(options.cols)),
      rows: Math.max(1, Math.trunc(options.rows)),
      env: buildSpawnEnv(),
    });

    const background = options.background;
    // Buffer before fan-out: a background job usually produces its first output
    // with no renderer listening at all.
    const dataDisposable = pty.onData((data) => {
      if (background !== null) appendTerminalOutput(background.output, data);
      broadcast(IpcChannels.PTY_DATA_CHANNEL, { id: options.id, data });
    });
    const exitDisposable = pty.onExit((event) => {
      const code = Number.isInteger(event.exitCode) ? event.exitCode : 0;
      const existing = sessions.get(options.id);
      if (existing !== undefined) {
        disposeSession(existing);
        existing.exit = {
          code,
          signal: typeof event.signal === "number" ? event.signal : null,
          at: new Date().toISOString(),
        };
        // Only a background job's record outlives its process, so a tab opened after
        // the fact can still render "exited with code N".
        if (existing.background === null) sessions.delete(options.id);
      }
      broadcast(IpcChannels.PTY_EXIT_CHANNEL, { id: options.id, code });
    });

    const session: PtySession = {
      pty,
      disposeData: () => dataDisposable.dispose(),
      disposeExit: () => exitDisposable.dispose(),
      cwd,
      background,
      exit: null,
    };
    sessions.set(options.id, session);
    return session;
  };

  const snapshotOf = (
    id: string,
    session: PtySession,
    background: BackgroundJob,
    maxHistorySize?: number,
  ): TerminalSessionSnapshot => ({
    threadId: background.threadId,
    terminalId: id,
    cwd: session.cwd,
    worktreePath: null,
    status: session.exit === null ? "running" : "exited",
    pid: session.exit === null && session.pty.pid > 0 ? session.pty.pid : null,
    history: readTerminalOutput(background.output, maxHistorySize),
    exitCode: session.exit?.code ?? null,
    exitSignal: session.exit?.signal ?? null,
    updatedAt: session.exit?.at ?? new Date().toISOString(),
  });

  const open = (options: DesktopPtyOpenOptions): Effect.Effect<void> =>
    Effect.sync(() => {
      spawnSession({ ...options, background: null });
    }).pipe(
      Effect.tapError((cause) =>
        elog.error("failed to open pty session", { cause: String(cause) }),
      ),
      Effect.orDie,
    );

  const openBackground = (
    options: DesktopPtyBackgroundOptions,
  ): Effect.Effect<TerminalSessionSnapshot> =>
    Effect.sync(() => {
      const background: BackgroundJob = {
        threadId: options.threadId,
        output: createTerminalOutputBuffer(),
      };
      const session = spawnSession({
        id: options.id,
        cwd: options.cwd,
        cols: BACKGROUND_COLS,
        rows: BACKGROUND_ROWS,
        background,
      });
      // Type the command into the shell rather than exec it, so the tab the user
      // adopts behaves like one they typed in: Ctrl+C works, and so does the prompt
      // that survives the command.
      session.pty.write(`${options.command}\n`);
      return snapshotOf(options.id, session, background);
    }).pipe(
      Effect.tapError((cause) =>
        elog.error("failed to open background pty session", { cause: String(cause) }),
      ),
      Effect.orDie,
    );

  const attach = (
    id: string,
    options?: { readonly maxHistorySize?: number },
  ): Effect.Effect<TerminalSessionSnapshot | null> =>
    Effect.sync(() => {
      const session = sessions.get(id);
      const background = session?.background ?? null;
      if (session === undefined || background === null) return null;
      return snapshotOf(id, session, background, options?.maxHistorySize);
    });

  const list = (threadId: string): Effect.Effect<readonly TerminalSessionSnapshot[]> =>
    Effect.sync(() =>
      [...sessions].flatMap(([id, session]) =>
        session.background !== null && session.background.threadId === threadId
          ? [snapshotOf(id, session, session.background)]
          : [],
      ),
    );

  const write = (id: string, data: string): Effect.Effect<void> =>
    Effect.sync(() => {
      const session = sessions.get(id);
      if (session === undefined) return;
      try {
        session.pty.write(data);
      } catch {}
    });

  const resize = (id: string, cols: number, rows: number): Effect.Effect<void> =>
    Effect.sync(() => {
      const session = sessions.get(id);
      if (session === undefined) return;
      try {
        session.pty.resize(Math.max(1, Math.trunc(cols)), Math.max(1, Math.trunc(rows)));
      } catch {}
    });

  const close = (id: string): Effect.Effect<void> =>
    Effect.sync(() => {
      const session = sessions.get(id);
      if (session === undefined) return;
      sessions.delete(id);
      killSession(session);
    });

  const stop = (id: string): Effect.Effect<void> =>
    Effect.sync(() => {
      const session = sessions.get(id);
      if (session === undefined || session.background === null || session.exit !== null) return;
      killSession(session);
      session.exit = { code: null, signal: null, at: new Date().toISOString() };
      // Agent stop is not a successful process exit. Keep the record for status and
      // tell an adopted tab that the process ended without inventing an exit code.
      broadcast(IpcChannels.PTY_EXIT_CHANNEL, { id, code: null });
    });

  // macOS keeps the process after the last window. Reap orphan sessions here.
  const onWindowAllClosed = (): void => {
    Effect.runFork(killAll);
  };
  Electron.app.on("window-all-closed", onWindowAllClosed);

  // Reload/crash drops preload listeners without pty.close. Kill foreground shells on
  // main-frame nav or renderer death; background jobs are main-owned and must survive a
  // reload. Skip non-window contents so browser navigation keeps shells.
  const guardWindowContents = (contents: Electron.WebContents): void => {
    if (contents.getType() !== "window") return;
    contents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      Effect.runFork(killSessions("foreground"));
    });
    contents.on("render-process-gone", () => {
      Effect.runFork(killSessions("foreground"));
    });
  };
  const onWebContentsCreated = (_event: Electron.Event, contents: Electron.WebContents): void => {
    guardWindowContents(contents);
  };
  Electron.app.on("web-contents-created", onWebContentsCreated);
  for (const window of Electron.BrowserWindow.getAllWindows()) {
    guardWindowContents(window.webContents);
  }

  // Quit teardown. Per-contents listeners die with webContents.
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      Electron.app.removeListener("window-all-closed", onWindowAllClosed);
      Electron.app.removeListener("web-contents-created", onWebContentsCreated);
    }).pipe(Effect.andThen(killAll)),
  );

  return DesktopPty.of({ open, openBackground, attach, list, write, resize, stop, close });
});

export const layer = Layer.effect(DesktopPty, make);
