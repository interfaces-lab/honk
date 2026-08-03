import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";

const CONNECTED_MARKER = "Registered tunnel connection";
const MAX_BUFFERED_OUTPUT_CHARACTERS = 64 * 1024;
const READY_TIMEOUT_MS = 30_000;
const CLOSE_GRACE_MS = 5_000;

export type ManagedCloudflaredOutputLevel = "connected" | "warning" | "debug";

export interface ManagedCloudflaredOutput {
  readonly level: ManagedCloudflaredOutputLevel;
  readonly stream: "stdout" | "stderr";
  readonly message: string;
}

export interface ManagedCloudflaredExit {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface ManagedCloudflaredConnector {
  readonly pid: number | null;
  readonly startedAt: string;
  readonly connected: boolean;
  readonly ready: Promise<void>;
  readonly exited: Promise<ManagedCloudflaredExit>;
  readonly close: () => Promise<void>;
}

export interface ManagedCloudflaredSpawnRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  readonly stdio: "pipe";
  readonly windowsHide: true;
}

export type ManagedCloudflaredSpawner = (
  request: ManagedCloudflaredSpawnRequest,
) => ChildProcessWithoutNullStreams;

export interface ManagedCloudflaredTimers {
  readonly setTimeout: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface ManagedCloudflaredConnectorOptions {
  readonly executable: string;
  readonly configPath: string;
  readonly tunnelId: string;
  readonly redactValues?: readonly string[];
  readonly spawner?: ManagedCloudflaredSpawner;
  readonly timers?: ManagedCloudflaredTimers;
  readonly readyTimeoutMs?: number;
  readonly closeGraceMs?: number;
  readonly platform?: NodeJS.Platform;
  readonly now?: () => number;
  readonly onOutput?: (output: ManagedCloudflaredOutput) => void;
}

export class ManagedCloudflaredConfigurationError extends Error {
  constructor() {
    super("A verified cloudflared executable, absolute config path, and tunnel UUID are required.");
    this.name = "ManagedCloudflaredConfigurationError";
  }
}

export class ManagedCloudflaredStartError extends Error {
  constructor() {
    super("Honk could not start its managed Cloudflare Tunnel connector.");
    this.name = "ManagedCloudflaredStartError";
  }
}

export class ManagedCloudflaredTimeoutError extends Error {
  constructor() {
    super("The managed Cloudflare Tunnel connector was not ready in time.");
    this.name = "ManagedCloudflaredTimeoutError";
  }
}

export class ManagedCloudflaredExitError extends Error {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(exit: ManagedCloudflaredExit) {
    super("The managed Cloudflare Tunnel connector exited before it connected.");
    this.name = "ManagedCloudflaredExitError";
    this.exitCode = exit.exitCode;
    this.signal = exit.signal;
  }
}

export function startManagedCloudflaredConnector(
  options: ManagedCloudflaredConnectorOptions,
): ManagedCloudflaredConnector {
  const executable = options.executable;
  const configPath = options.configPath;
  const tunnelId = options.tunnelId;
  const redactValues = [...new Set(options.redactValues ?? [])].sort(
    (left, right) => right.length - left.length,
  );
  const timestamp = (options.now ?? Date.now)();
  const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const closeGraceMs = options.closeGraceMs ?? CLOSE_GRACE_MS;
  if (
    !isAbsolute(executable) ||
    !isAbsolute(configPath) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tunnelId) ||
    redactValues.some(
      (value) =>
        value.length === 0 || value.includes("\0") || value.includes("\r") || value.includes("\n"),
    ) ||
    !Number.isFinite(timestamp) ||
    Math.abs(timestamp) > 8_640_000_000_000_000 ||
    !Number.isFinite(readyTimeoutMs) ||
    readyTimeoutMs < 0 ||
    !Number.isFinite(closeGraceMs) ||
    closeGraceMs < 0
  ) {
    throw new ManagedCloudflaredConfigurationError();
  }

  const timers = options.timers ?? managedCloudflaredTimers;
  const onOutput = options.onOutput;
  const spawner = options.spawner ?? spawnManagedCloudflared;
  const platform = options.platform ?? process.platform;
  const startedAt = new Date(timestamp).toISOString();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("TUNNEL_")),
  );
  const child = (() => {
    try {
      return spawner({
        executable,
        args: [
          "tunnel",
          "--no-autoupdate",
          "--loglevel",
          "info",
          "--transport-loglevel",
          "info",
          "--metrics",
          "127.0.0.1:0",
          "--config",
          configPath,
          "run",
          tunnelId,
        ],
        env,
        shell: false,
        stdio: "pipe",
        windowsHide: true,
      });
    } catch {
      throw new ManagedCloudflaredStartError();
    }
  })();

  const state = {
    connected: false,
    terminal: false,
    closing: false,
    readySettled: false,
    readyTimer: null as unknown,
    closeTimer: null as unknown,
    closePromise: null as Promise<void> | null,
    exit: null as ManagedCloudflaredExit | null,
    readinessFailure: null as Error | null,
    stdout: {
      pending: "",
      discarding: false,
      readinessTail: "",
    },
    stderr: {
      pending: "",
      discarding: false,
      readinessTail: "",
    },
  };
  const exitResolution: {
    resolve: ((exit: ManagedCloudflaredExit) => void) | null;
  } = { resolve: null };
  const exited = new Promise<ManagedCloudflaredExit>((resolve) => {
    exitResolution.resolve = resolve;
  });
  const readyResolution: {
    resolve: (() => void) | null;
    reject: ((error: Error) => void) | null;
  } = { resolve: null, reject: null };
  const ready = new Promise<void>((resolve, reject) => {
    readyResolution.resolve = resolve;
    readyResolution.reject = reject;
  });

  const clearReadyTimer = (): void => {
    if (state.readyTimer === null) return;
    try {
      timers.clearTimeout(state.readyTimer);
    } catch {
      // A timer adapter cannot change connector cleanup or expose its error.
    }
    state.readyTimer = null;
  };
  const clearCloseTimer = (): void => {
    if (state.closeTimer === null) return;
    try {
      timers.clearTimeout(state.closeTimer);
    } catch {
      // The child has already closed.
    }
    state.closeTimer = null;
  };
  const emitOutput = (stream: ManagedCloudflaredOutput["stream"], message: string): void => {
    if (onOutput === undefined || message.length === 0) return;
    const sanitized = redactValues
      .reduce(
        (output, value) =>
          output
            .split(value)
            .join("[credential redacted]".includes(value) ? "" : "[credential redacted]"),
        message,
      )
      .slice(0, MAX_BUFFERED_OUTPUT_CHARACTERS);
    const level =
      state.connected && message.includes(CONNECTED_MARKER)
        ? "connected"
        : /(?:^|[\s,{])(?:ERR|WRN)(?=[\s,:}]|$)|"level"\s*:\s*"(?:error|warn|warning)"/i.test(
              message,
            )
          ? "warning"
          : "debug";
    try {
      onOutput(Object.freeze({ level, stream, message: sanitized }));
    } catch {
      // Logging is observational. It cannot take down the connector.
    }
  };
  const flushOutput = (stream: ManagedCloudflaredOutput["stream"]): void => {
    const output = state[stream];
    if (output.discarding) {
      emitOutput(stream, "[cloudflared output omitted]");
    } else {
      emitOutput(stream, output.pending.replace(/\r$/, ""));
    }
    output.pending = "";
    output.discarding = false;
  };
  const finishClose = (exit: ManagedCloudflaredExit): void => {
    if (state.terminal) return;
    state.terminal = true;
    state.closing = false;
    state.connected = false;
    clearReadyTimer();
    clearCloseTimer();
    flushOutput("stdout");
    flushOutput("stderr");
    exitResolution.resolve?.(exit);
    if (state.readySettled) return;
    state.readySettled = true;
    readyResolution.reject?.(state.readinessFailure ?? new ManagedCloudflaredExitError(exit));
  };
  const close = (): Promise<void> => {
    if (state.closePromise !== null) return state.closePromise;
    state.closePromise = exited.then(() => undefined);
    clearReadyTimer();
    if (
      state.terminal ||
      state.exit !== null ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      return state.closePromise;

    state.closing = true;
    if (platform === "win32") {
      try {
        child.kill("SIGKILL");
      } catch {
        // The close event remains the source of truth.
      }
      return state.closePromise;
    }

    try {
      child.kill("SIGTERM");
    } catch {
      // The exit listeners remain the source of truth.
    }
    try {
      state.closeTimer = timers.setTimeout(() => {
        if (state.terminal) return;
        try {
          child.kill("SIGKILL");
        } catch {
          // The exit listeners remain the source of truth.
        }
      }, closeGraceMs);
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // The exit listeners remain the source of truth.
      }
    }
    return state.closePromise;
  };
  const failReadiness = (error: Error): void => {
    if (state.readySettled || state.readinessFailure !== null) return;
    state.readinessFailure = error;
    clearReadyTimer();
    void close();
  };
  const markConnected = (): void => {
    if (
      state.connected ||
      state.terminal ||
      state.closing ||
      state.exit !== null ||
      state.readySettled ||
      state.readinessFailure !== null
    )
      return;
    state.connected = true;
    state.readySettled = true;
    clearReadyTimer();
    readyResolution.resolve?.();
  };
  const acceptOutput = (
    stream: ManagedCloudflaredOutput["stream"],
    chunk: Buffer | string,
  ): void => {
    const output = state[stream];
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    const readiness = output.readinessTail + text;
    if (readiness.includes(CONNECTED_MARKER)) markConnected();
    output.readinessTail = readiness.slice(-(CONNECTED_MARKER.length - 1));

    let cursor = 0;
    while (cursor < text.length) {
      const newline = text.indexOf("\n", cursor);
      const end = newline === -1 ? text.length : newline;
      if (
        !output.discarding &&
        output.pending.length + end - cursor <= MAX_BUFFERED_OUTPUT_CHARACTERS
      ) {
        output.pending += text.slice(cursor, end);
      } else {
        output.pending = "";
        output.discarding = true;
      }
      if (newline === -1) return;
      flushOutput(stream);
      cursor = newline + 1;
    }
  };
  const connector: ManagedCloudflaredConnector = Object.freeze({
    pid: child.pid ?? null,
    startedAt,
    get connected() {
      return state.connected;
    },
    ready,
    exited,
    close,
  });

  child.stdout.on("data", (chunk: Buffer | string) => acceptOutput("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer | string) => acceptOutput("stderr", chunk));
  child.stdin.on("error", () => undefined);
  child.stdout.on("error", () => undefined);
  child.stderr.on("error", () => undefined);
  child.on("error", () => {
    failReadiness(new ManagedCloudflaredStartError());
  });
  child.once("exit", (exitCode, signal) => {
    state.exit = { exitCode, signal };
    state.connected = false;
    if (!state.readySettled && state.readinessFailure === null) {
      state.readinessFailure = new ManagedCloudflaredExitError(state.exit);
      clearReadyTimer();
    }
  });
  child.once("close", (exitCode, signal) => finishClose(state.exit ?? { exitCode, signal }));

  try {
    state.readyTimer = timers.setTimeout(() => {
      failReadiness(new ManagedCloudflaredTimeoutError());
    }, readyTimeoutMs);
  } catch {
    failReadiness(new ManagedCloudflaredStartError());
  }
  try {
    child.stdin.end();
  } catch {
    failReadiness(new ManagedCloudflaredStartError());
  }

  return connector;
}

const spawnManagedCloudflared: ManagedCloudflaredSpawner = (request) =>
  spawn(request.executable, [...request.args], {
    env: request.env,
    shell: request.shell,
    stdio: request.stdio,
    windowsHide: request.windowsHide,
  });

const managedCloudflaredTimers: ManagedCloudflaredTimers = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
