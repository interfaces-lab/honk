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

import * as IpcChannels from "../ipc/channels";

// PTY bridge for the terminal panel. Spawn a login shell, pump output, no leaks.

const elog = EffectLogger.create({ service: "desktop-pty" });

const TERMINAL_NAME = "xterm-256color";

// Strip Electron vars that confuse a fresh login shell. Keep user PATH.
const ENV_BLOCKLIST = new Set([
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_RENDERER_PORT",
  "TERM",
  "COLORTERM",
]);

export interface DesktopPtyShape {
  readonly open: (options: DesktopPtyOpenOptions) => Effect.Effect<void>;
  readonly write: (id: string, data: string) => Effect.Effect<void>;
  readonly resize: (id: string, cols: number, rows: number) => Effect.Effect<void>;
  readonly close: (id: string) => Effect.Effect<void>;
}

export class DesktopPty extends Context.Service<DesktopPty, DesktopPtyShape>()(
  "honk/desktop/Pty",
) {}

interface PtySession {
  readonly pty: IPty;
  readonly disposeData: () => void;
  readonly disposeExit: () => void;
}

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

  const killAll = Effect.sync(() => {
    for (const [id, session] of sessions) {
      sessions.delete(id);
      killSession(session);
    }
  });

  const open = (options: DesktopPtyOpenOptions): Effect.Effect<void> =>
    Effect.sync(() => {
      ensureSpawnHelperExecutable();
      const { shell, args } = resolveShell();
      const pty = nodePty.spawn(shell, [...args], {
        name: TERMINAL_NAME,
        cwd: resolveCwd(options.cwd),
        cols: Math.max(1, Math.trunc(options.cols)),
        rows: Math.max(1, Math.trunc(options.rows)),
        env: buildSpawnEnv(),
      });

      const dataDisposable = pty.onData((data) => {
        broadcast(IpcChannels.PTY_DATA_CHANNEL, { id: options.id, data });
      });
      const exitDisposable = pty.onExit((event) => {
        const code = Number.isInteger(event.exitCode) ? event.exitCode : 0;
        const existing = sessions.get(options.id);
        if (existing !== undefined) {
          sessions.delete(options.id);
          disposeSession(existing);
        }
        broadcast(IpcChannels.PTY_EXIT_CHANNEL, { id: options.id, code });
      });

      sessions.set(options.id, {
        pty,
        disposeData: () => dataDisposable.dispose(),
        disposeExit: () => exitDisposable.dispose(),
      });
    }).pipe(
      Effect.tapError((cause) =>
        elog.error("failed to open pty session", { cause: String(cause) }),
      ),
      Effect.orDie,
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

  // macOS keeps the process after the last window. Reap orphan sessions here.
  const onWindowAllClosed = (): void => {
    Effect.runFork(killAll);
  };
  Electron.app.on("window-all-closed", onWindowAllClosed);

  // Reload/crash drops preload listeners without pty.close. Kill on main-frame
  // nav or renderer death. Skip non-window contents so browser navigation keeps shells.
  const guardWindowContents = (contents: Electron.WebContents): void => {
    if (contents.getType() !== "window") return;
    contents.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      Effect.runFork(killAll);
    });
    contents.on("render-process-gone", () => {
      Effect.runFork(killAll);
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

  return DesktopPty.of({ open, write, resize, close });
});

export const layer = Layer.effect(DesktopPty, make);
