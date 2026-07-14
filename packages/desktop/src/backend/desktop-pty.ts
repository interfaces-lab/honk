import { randomUUID } from "node:crypto";
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

import * as EffectLogger from "@honk/shared/effect-logger";

import * as IpcChannels from "../ipc/channels";

// A minimal PTY bridge for the renderer's terminal panel.
//
// honk's Core already owns the "real" websocket-multiplexed terminal
// (`@honk/core` terminal.ts). This service is deliberately smaller: the new
// app's terminal panel owns its own xterm buffer and talks to the desktop host
// directly over the bridge, so all this needs to do is spawn a login shell,
// keep a Map of live sessions, pump PTY output to the renderer, and make sure
// nothing leaks when the window closes or the app quits.

const elog = EffectLogger.create({ service: "desktop-pty" });

const TERMINAL_NAME = "xterm-256color";

// Vars that would confuse a freshly-spawned interactive login shell. We spread
// the rest of process.env so the user's PATH/tooling is intact.
const ENV_BLOCKLIST = new Set(["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_PORT", "TERM", "COLORTERM"]);

export interface DesktopPtyOpenOptions {
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
}

export interface DesktopPtyShape {
  readonly open: (options: DesktopPtyOpenOptions) => Effect.Effect<{ readonly id: string }>;
  readonly write: (id: string, data: string) => Effect.Effect<void>;
  readonly resize: (id: string, cols: number, rows: number) => Effect.Effect<void>;
  readonly close: (id: string) => Effect.Effect<void>;
}

export class DesktopPty extends Context.Service<DesktopPty, DesktopPtyShape>()(
  "honk/desktop/Pty",
) {}

interface PtySession {
  readonly id: string;
  readonly pty: IPty;
  readonly disposeData: () => void;
  readonly disposeExit: () => void;
}

let didEnsureSpawnHelperExecutable = false;

// @lydell/node-pty ships prebuilt N-API binaries per platform. On macOS the
// posix spawn path also needs the `spawn-helper` binary to be executable; some
// packaging pipelines strip the +x bit, so mirror @honk/core's terminal.ts and
// re-assert it once. Best-effort — a working dev checkout already has it.
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

  // Login + interactive so the user's profile loads and the prompt renders the
  // way it does in a normal terminal.
  const name = NodePath.basename(shell).toLowerCase();
  if (name === "bash") return { shell, args: ["--login", "-i"] };
  if (name === "zsh" || name === "fish") return { shell, args: ["-l", "-i"] };
  return { shell, args: ["-l"] };
}

function resolveCwd(cwd: string): string {
  try {
    const resolved = NodePath.resolve(cwd);
    if (statSync(resolved).isDirectory()) return resolved;
  } catch {
    // Fall through to the home directory below.
  }
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

// Mirrors ElectronWindow.sendAll: fan a message out to every live renderer. The
// bridge is not scoped to a single window, and this runs from node-pty's raw
// data callback (hot path), so it stays a plain synchronous loop rather than
// routing through the Effect runtime.
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
    } catch {
      // Already exited or the platform rejected the signal.
    }
  };

  const killAll = Effect.sync(() => {
    for (const [id, session] of sessions) {
      sessions.delete(id);
      killSession(session);
    }
  });

  const open = (options: DesktopPtyOpenOptions): Effect.Effect<{ readonly id: string }> =>
    Effect.sync(() => {
      ensureSpawnHelperExecutable();
      const { shell, args } = resolveShell();
      const id = `pty_${randomUUID()}`;
      const pty = nodePty.spawn(shell, [...args], {
        name: TERMINAL_NAME,
        cwd: resolveCwd(options.cwd),
        cols: Math.max(1, Math.trunc(options.cols)),
        rows: Math.max(1, Math.trunc(options.rows)),
        env: buildSpawnEnv(),
      });

      const dataDisposable = pty.onData((data) => {
        broadcast(IpcChannels.PTY_DATA_CHANNEL, { id, data });
      });
      const exitDisposable = pty.onExit((event) => {
        const code = Number.isInteger(event.exitCode) ? event.exitCode : 0;
        const existing = sessions.get(id);
        if (existing !== undefined) {
          sessions.delete(id);
          disposeSession(existing);
        }
        broadcast(IpcChannels.PTY_EXIT_CHANNEL, { id, code });
      });

      sessions.set(id, {
        id,
        pty,
        disposeData: () => dataDisposable.dispose(),
        disposeExit: () => exitDisposable.dispose(),
      });
      return { id };
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
      } catch {
        // Session exited between the renderer's send and now.
      }
    });

  const resize = (id: string, cols: number, rows: number): Effect.Effect<void> =>
    Effect.sync(() => {
      const session = sessions.get(id);
      if (session === undefined) return;
      try {
        session.pty.resize(Math.max(1, Math.trunc(cols)), Math.max(1, Math.trunc(rows)));
      } catch {
        // Session exited or the dimensions were rejected.
      }
    });

  const close = (id: string): Effect.Effect<void> =>
    Effect.sync(() => {
      const session = sessions.get(id);
      if (session === undefined) return;
      sessions.delete(id);
      killSession(session);
    });

  // Leak guard: when the last renderer window closes, tear down any sessions
  // the renderer did not explicitly close. On macOS the app process outlives
  // the window, so this must not wait for the quit finalizer below.
  const onWindowAllClosed = (): void => {
    Effect.runFork(killAll);
  };
  Electron.app.on("window-all-closed", onWindowAllClosed);

  // Reload guard: a renderer reload (⌘R, dev HMR full reload, crash) destroys the preload
  // listeners without ever invoking pty.close, stranding live shells in `sessions` until the
  // window closes. The invoke framework doesn't carry the sender, and honk is a single-window
  // app — so any WINDOW webContents starting a main-frame navigation, or losing its renderer
  // process, kills every session. Webview guests (the future browser panel) are excluded:
  // their navigations must never reap the user's terminals.
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

  // Kill everything on app quit (layer scope teardown) and drop the app hooks. The per-contents
  // listeners die with their webContents — no manual removal needed.
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      Electron.app.removeListener("window-all-closed", onWindowAllClosed);
      Electron.app.removeListener("web-contents-created", onWebContentsCreated);
    }).pipe(Effect.andThen(killAll)),
  );

  return DesktopPty.of({ open, write, resize, close });
});

export const layer = Layer.effect(DesktopPty, make);
