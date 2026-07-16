import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const STATUS_TIMEOUT_MS = 1_500;
const SERVE_TIMEOUT_MS = 10_000;
const MAX_STATUS_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_HTTPS_PORT = 443;

export interface TailscaleStatus {
  readonly running: boolean;
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
}

export interface TailscaleHttpsEndpoint {
  readonly url: string;
  readonly magicDnsName: string;
  readonly tailnetIpv4Addresses: readonly string[];
}

export interface TailscaleCommandRequest {
  readonly executable: "tailscale" | "tailscale.exe";
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly captureStdout: boolean;
}

export interface TailscaleCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderrLength: number;
}

export type TailscaleCommandRunner = (
  request: TailscaleCommandRequest,
) => Promise<TailscaleCommandResult>;

export interface TailscaleCommandOptions {
  readonly platform?: NodeJS.Platform;
  readonly runner?: TailscaleCommandRunner;
}

export class TailscaleUnavailableError extends Error {
  constructor() {
    super("Tailscale must be installed, connected, and have MagicDNS enabled.");
    this.name = "TailscaleUnavailableError";
  }
}

export class TailscaleStatusError extends Error {
  constructor() {
    super("Tailscale status could not be read.");
    this.name = "TailscaleStatusError";
  }
}

export class TailscaleServeError extends Error {
  constructor() {
    super("Tailscale HTTPS Serve could not be configured.");
    this.name = "TailscaleServeError";
  }
}

class TailscaleCommandFailure extends Error {
  constructor(
    readonly kind: "spawn" | "timeout" | "output",
    readonly executable: "tailscale" | "tailscale.exe",
    readonly argumentCount: number,
  ) {
    super(`Tailscale command failed (${kind}).`);
    this.name = "TailscaleCommandFailure";
  }
}

const tailscaleExecutable = (platform: NodeJS.Platform): "tailscale" | "tailscale.exe" =>
  platform === "win32" ? "tailscale.exe" : "tailscale";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isTailnetIpv4Address = (value: string): boolean => {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const first = octets[0];
  const second = octets[1];
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
};

const normalizedMagicDnsName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\.+$/, "");
  if (normalized.length === 0 || normalized.includes("/") || normalized.includes("@")) return null;
  try {
    const url = new URL(`https://${normalized}`);
    return url.hostname === normalized.toLowerCase() ? normalized.toLowerCase() : null;
  } catch {
    return null;
  }
};

export function parseTailscaleStatus(rawStatusJson: string): TailscaleStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawStatusJson) as unknown;
  } catch {
    throw new TailscaleStatusError();
  }
  if (!isRecord(parsed)) throw new TailscaleStatusError();

  const self = isRecord(parsed.Self) ? parsed.Self : null;
  const magicDnsName = normalizedMagicDnsName(self?.DNSName);
  const rawAddresses = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs : [];
  const tailnetIpv4Addresses = Object.freeze(
    rawAddresses.filter(
      (address): address is string => typeof address === "string" && isTailnetIpv4Address(address),
    ),
  );
  const running = parsed.BackendState === "Running" && self?.Online !== false;

  return Object.freeze({ running, magicDnsName, tailnetIpv4Addresses });
}

export function buildTailscaleHttpsUrl(
  magicDnsName: string,
  httpsPort = DEFAULT_HTTPS_PORT,
): string {
  const normalized = normalizedMagicDnsName(magicDnsName);
  if (normalized === null) throw new TailscaleStatusError();
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65_535) {
    throw new TailscaleServeError();
  }
  const url = new URL(`https://${normalized}`);
  if (httpsPort !== DEFAULT_HTTPS_PORT) url.port = String(httpsPort);
  return url.origin;
}

export const runTailscaleCommand: TailscaleCommandRunner = (request) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderrLength = 0;
    let stdoutLength = 0;

    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      finish();
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(request.executable, [...request.args], {
        stdio: "pipe",
        windowsHide: true,
      });
      child.stdin.end();
    } catch {
      reject(new TailscaleCommandFailure("spawn", request.executable, request.args.length));
      return;
    }

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() =>
        reject(new TailscaleCommandFailure("timeout", request.executable, request.args.length)),
      );
    }, request.timeoutMs);

    child.once("error", () => {
      settle(() =>
        reject(new TailscaleCommandFailure("spawn", request.executable, request.args.length)),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutLength += chunk.byteLength;
      if (stdoutLength > MAX_STATUS_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        settle(() =>
          reject(new TailscaleCommandFailure("output", request.executable, request.args.length)),
        );
        return;
      }
      if (request.captureStdout) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrLength += chunk.byteLength;
    });
    child.once("close", (code) => {
      settle(() =>
        resolve({
          exitCode: typeof code === "number" ? code : -1,
          stdout,
          stderrLength,
        }),
      );
    });
  });

const commandOptions = (
  options: TailscaleCommandOptions | undefined,
): {
  readonly executable: "tailscale" | "tailscale.exe";
  readonly runner: TailscaleCommandRunner;
} => ({
  executable: tailscaleExecutable(options?.platform ?? process.platform),
  runner: options?.runner ?? runTailscaleCommand,
});

export async function readTailscaleStatus(
  options?: TailscaleCommandOptions,
): Promise<TailscaleStatus> {
  const { executable, runner } = commandOptions(options);
  let result: TailscaleCommandResult;
  try {
    result = await runner({
      executable,
      args: ["status", "--json"],
      timeoutMs: STATUS_TIMEOUT_MS,
      captureStdout: true,
    });
  } catch {
    throw new TailscaleUnavailableError();
  }
  if (result.exitCode !== 0) throw new TailscaleUnavailableError();
  return parseTailscaleStatus(result.stdout);
}

export async function resolveTailscaleHttpsEndpoint(
  httpsPort = DEFAULT_HTTPS_PORT,
  options?: TailscaleCommandOptions,
): Promise<TailscaleHttpsEndpoint> {
  const status = await readTailscaleStatus(options);
  if (!status.running || status.magicDnsName === null) throw new TailscaleUnavailableError();
  return Object.freeze({
    url: buildTailscaleHttpsUrl(status.magicDnsName, httpsPort),
    magicDnsName: status.magicDnsName,
    tailnetIpv4Addresses: status.tailnetIpv4Addresses,
  });
}

function normalizedLoopbackTarget(targetOrigin: string): string {
  try {
    const url = new URL(targetOrigin);
    const isLoopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1";
    if (
      url.protocol !== "http:" ||
      !isLoopback ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      throw new TailscaleServeError();
    }
    return url.origin;
  } catch (cause) {
    if (cause instanceof TailscaleServeError) throw cause;
    throw new TailscaleServeError();
  }
}

export async function enableTailscaleHttpsServe(
  targetOrigin: string,
  httpsPort = DEFAULT_HTTPS_PORT,
  options?: TailscaleCommandOptions,
): Promise<void> {
  const target = normalizedLoopbackTarget(targetOrigin);
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65_535) {
    throw new TailscaleServeError();
  }
  const { executable, runner } = commandOptions(options);
  let result: TailscaleCommandResult;
  try {
    result = await runner({
      executable,
      args: ["serve", "--bg", `--https=${httpsPort}`, target],
      timeoutMs: SERVE_TIMEOUT_MS,
      captureStdout: false,
    });
  } catch {
    throw new TailscaleServeError();
  }
  if (result.exitCode !== 0) throw new TailscaleServeError();
}

export async function disableTailscaleHttpsServe(
  httpsPort = DEFAULT_HTTPS_PORT,
  options?: TailscaleCommandOptions,
): Promise<void> {
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65_535) {
    throw new TailscaleServeError();
  }
  const { executable, runner } = commandOptions(options);
  let result: TailscaleCommandResult;
  try {
    result = await runner({
      executable,
      args: ["serve", `--https=${httpsPort}`, "off"],
      timeoutMs: SERVE_TIMEOUT_MS,
      captureStdout: false,
    });
  } catch {
    throw new TailscaleServeError();
  }
  if (result.exitCode !== 0) throw new TailscaleServeError();
}
