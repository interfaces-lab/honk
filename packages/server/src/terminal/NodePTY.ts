import { createRequire } from "node:module";
import path from "node:path";

import type { IPty } from "@lydell/node-pty";
import { Effect, FileSystem, Layer, Path } from "effect";
import {
  PtyAdapter,
  PtyAdapterShape,
  PtyExitEvent,
  PtyProcess,
  PtySpawnError,
} from "./PTY.service";

let didEnsureSpawnHelperExecutable = false;

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

const resolveNodePtySpawnHelperPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const packageDir = resolvePlatformPackageDir();
  if (!packageDir) {
    return null;
  }
  const candidates = [
    path.join(packageDir, "build", "Release", "spawn-helper"),
    path.join(packageDir, "build", "Debug", "spawn-helper"),
    path.join(packageDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
  ];

  for (const candidate of candidates) {
    if (yield* fs.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}).pipe(Effect.orElseSucceed(() => null));

export const ensureNodePtySpawnHelperExecutable = Effect.fn(function* (explicitPath?: string) {
  const fs = yield* FileSystem.FileSystem;
  if (process.platform === "win32") return;
  if (!explicitPath && didEnsureSpawnHelperExecutable) return;

  const helperPath = explicitPath ?? (yield* resolveNodePtySpawnHelperPath);
  if (!helperPath) return;
  if (!explicitPath) {
    didEnsureSpawnHelperExecutable = true;
  }

  if (!(yield* fs.exists(helperPath))) {
    return;
  }

  // Best-effort: avoid FileSystem.stat in packaged mode where some fs metadata can be missing.
  yield* fs.chmod(helperPath, 0o755).pipe(Effect.orElseSucceed(() => undefined));
});

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
        exitCode: event.exitCode,
        signal: event.signal ?? null,
      });
    });
    return () => {
      disposable.dispose();
    };
  }
}

export const layer = Layer.effect(
  PtyAdapter,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const nodePty = yield* Effect.promise(() => import("@lydell/node-pty"));

    const ensureNodePtySpawnHelperExecutableCached = yield* Effect.cached(
      ensureNodePtySpawnHelperExecutable().pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.orElseSucceed(() => undefined),
      ),
    );

    return {
      spawn: Effect.fn(function* (input) {
        yield* ensureNodePtySpawnHelperExecutableCached;
        // Intentionally omit node-pty's `name` option: on Unix it would
        // override TERM, and terminal identity is owned by the Manager's
        // spawn-env builder (TERM=xterm-256color, COLORTERM=truecolor), with
        // input.env as the per-call override channel.
        const ptyProcess = yield* Effect.try({
          try: () =>
            nodePty.spawn(input.shell, input.args ?? [], {
              cwd: input.cwd,
              cols: input.cols,
              rows: input.rows,
              env: input.env,
            }),
          catch: (cause) =>
            new PtySpawnError({
              adapter: "node-pty",
              message: "Failed to spawn node-pty process.",
              cause,
            }),
        });
        return new NodePtyProcess(ptyProcess);
      }),
    } satisfies PtyAdapterShape;
  }),
);
