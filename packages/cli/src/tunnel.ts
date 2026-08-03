import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix, win32 } from "node:path";

const TUNNEL_READY_TIMEOUT_MS = 30_000;
const MAX_TUNNEL_OUTPUT_BYTES = 256 * 1024;
const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;
const CLOSE_GRACE_MS = 5_000;
const PROBE_TIMEOUT_MS = 1_500;
const STAGED_VALIDATION_TIMEOUT_MS = 30_000;
const PROCESS_START_TOLERANCE_MS = 60_000;
const PROCESS_INSPECTION_TIMEOUT_MS = 2_000;
const MAX_PROCESS_INSPECTION_OUTPUT_BYTES = 16 * 1024;
const INSTALL_LOCK_RETRY_COUNT = 100;
const INSTALL_LOCK_RETRY_DELAY_MS = 100;
const INSTALL_LOCK_STALE_MS = 5 * 60 * 1_000;
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1_000;
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;

export const CLOUDFLARED_VERSION = "2026.7.2";

export interface CloudflaredReleaseAsset {
  readonly url: string;
  // GitHub's release-asset digest. For macOS this covers the tgz, not its contents.
  readonly sha256: string;
  readonly archive: "binary" | "tgz";
  readonly executableSha256?: string;
}

const CLOUDFLARED_RELEASE_ASSETS: Readonly<
  Partial<Record<`${NodeJS.Platform}-${string}`, CloudflaredReleaseAsset>>
> = {
  "darwin-arm64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.7.2/cloudflared-darwin-arm64.tgz",
    sha256: "2086e51c61d6565781d84117a5007d0c826d03ffdc74acb91c08c167f9f8cd7c",
    archive: "tgz",
    executableSha256: "0588df58494a6cadd38b9deb6078908a5054063c80784d92fdb8d4a5f3de1c67",
  },
  "darwin-x64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.7.2/cloudflared-darwin-amd64.tgz",
    sha256: "4ee0d3b48a990a2f9b5faec5838f73ec1f400aa8e0a4864be576adfafec406cb",
    archive: "tgz",
    executableSha256: "a5afb0ba3da859da47bebc9a918d5b196bf7e4aec23589419b46356731bcc75f",
  },
  "linux-arm64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.7.2/cloudflared-linux-arm64",
    sha256: "405df476437e027fc6d18729a5a77155c0a33a6082aeee60a799a688f3052e66",
    archive: "binary",
  },
  "linux-x64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.7.2/cloudflared-linux-amd64",
    sha256: "ec905ea7b7e327ff8abdde8cb64697a2152de74dbcdbf6aec9db8364eb3886cd",
    archive: "binary",
  },
  "win32-x64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.7.2/cloudflared-windows-amd64.exe",
    sha256: "cdb5d4432f6ae1595654a692a51308b69d2bf7af961f5578d9391837cf072df9",
    archive: "binary",
  },
};

export type CloudflaredDownloader = (url: string) => Promise<Uint8Array>;

export type CloudflaredArchiveExtractor = (input: {
  readonly archivePath: string;
  readonly destinationDirectory: string;
  readonly executablePath: string;
}) => Promise<void>;

export interface CloudflaredAcquisitionOptions {
  readonly stateDirectory: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly executableOverride?: string;
  readonly systemExecutable?: string | null;
  readonly pathExists?: (path: string) => boolean;
  readonly spawner?: CloudflaredSpawner;
  readonly download?: CloudflaredDownloader;
  readonly extractArchive?: CloudflaredArchiveExtractor;
  readonly releaseAsset?: CloudflaredReleaseAsset | null;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly lockRetryCount?: number;
  readonly lockRetryDelayMs?: number;
  readonly downloadTimeoutMs?: number;
  readonly maxDownloadBytes?: number;
}

export type CloudflaredAcquisitionFailureReason =
  | "download_failed"
  | "install_locked"
  | "invalid_checksum"
  | "override_unavailable"
  | "unsupported_platform"
  | "validation_failed"
  | "write_failed";

export class CloudflaredAcquisitionError extends Error {
  readonly reason: CloudflaredAcquisitionFailureReason;

  constructor(reason: CloudflaredAcquisitionFailureReason, message: string) {
    super(message);
    this.name = "CloudflaredAcquisitionError";
    this.reason = reason;
  }
}

const cloudflaredInstallations = new Map<string, Promise<string>>();

export interface CloudflaredQuickTunnel {
  readonly url: string;
  readonly hostname: string;
  readonly pid: number | null;
  readonly startedAt: string;
  readonly exited: Promise<void>;
  readonly close: () => Promise<void>;
}

export type CloudflaredSpawner = (input: {
  readonly executable: string;
  readonly args: readonly string[];
}) => ChildProcessWithoutNullStreams;

export interface CloudflaredOptions {
  readonly platform?: NodeJS.Platform;
  readonly executable?: string;
  readonly spawner?: CloudflaredSpawner;
  readonly readyTimeoutMs?: number;
  readonly closeGraceMs?: number;
}

export interface CloudflaredTunnelRecord {
  readonly pid: number;
  readonly executable: string;
  readonly startedAt: string;
}

export type CloudflaredProcessInspector = (pid: number) => Promise<{
  readonly command: string;
  readonly executable?: string;
  readonly startedAtMs: number;
} | null>;

export class CloudflaredUnavailableError extends Error {
  constructor() {
    super("cloudflared must be installed before Honk can open a temporary link.");
    this.name = "CloudflaredUnavailableError";
  }
}

export class CloudflaredTunnelError extends Error {
  constructor() {
    super("Honk could not open a temporary link.");
    this.name = "CloudflaredTunnelError";
  }
}

export class CloudflaredTunnelTimeoutError extends Error {
  constructor() {
    super("The temporary link was not ready in time.");
    this.name = "CloudflaredTunnelTimeoutError";
  }
}

export function resolveCloudflaredExecutable(
  platform: NodeJS.Platform,
  pathExists: (path: string) => boolean = existsSync,
  pathValue = process.env.PATH,
): string {
  const executable = platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const known =
    platform === "darwin" ? ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"] : [];
  const pathCandidates = (pathValue ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter((directory) => directory.length > 0)
    .map((directory) =>
      platform === "win32" ? win32.join(directory, executable) : posix.join(directory, executable),
    );
  // Finder launches inherit a minimal PATH, so macOS package-manager locations stay first.
  return [...known, ...pathCandidates].find(pathExists) ?? executable;
}

export function resolveCloudflaredReleaseAsset(
  platform: NodeJS.Platform,
  arch: string,
): CloudflaredReleaseAsset | null {
  return CLOUDFLARED_RELEASE_ASSETS[`${platform}-${arch}`] ?? null;
}

export function managedCloudflaredExecutablePath(
  stateDirectory: string,
  platform: NodeJS.Platform,
  arch: string,
): string {
  return join(
    stateDirectory,
    "tools",
    "cloudflared",
    CLOUDFLARED_VERSION,
    `${platform}-${arch}`,
    platform === "win32" ? "cloudflared.exe" : "cloudflared",
  );
}

export async function acquireCloudflaredExecutable(
  options: CloudflaredAcquisitionOptions,
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const managedPath = managedCloudflaredExecutablePath(options.stateDirectory, platform, arch);
  const override = options.executableOverride?.trim();
  if (override !== undefined && override.length > 0) {
    if (
      isAbsoluteCloudflaredPath(override, platform) &&
      (await reportsPinnedCloudflaredVersion(override, options.spawner))
    ) {
      return override;
    }
    throw new CloudflaredAcquisitionError(
      "override_unavailable",
      `The configured cloudflared executable did not report required version ${CLOUDFLARED_VERSION}. Check its path and permissions.`,
    );
  }
  if (
    existsSync(managedPath) &&
    (await reportsPinnedCloudflaredVersion(
      managedPath,
      options.spawner,
      STAGED_VALIDATION_TIMEOUT_MS,
    ))
  ) {
    return managedPath;
  }
  const systemExecutable =
    options.systemExecutable === undefined
      ? resolveCloudflaredExecutable(platform, options.pathExists)
      : options.systemExecutable;
  if (
    systemExecutable !== null &&
    isAbsoluteCloudflaredPath(systemExecutable, platform) &&
    (await reportsPinnedCloudflaredVersion(systemExecutable, options.spawner))
  ) {
    return systemExecutable;
  }
  const releaseAsset =
    options.releaseAsset === undefined
      ? resolveCloudflaredReleaseAsset(platform, arch)
      : options.releaseAsset;
  if (releaseAsset === null) {
    throw new CloudflaredAcquisitionError(
      "unsupported_platform",
      `Honk does not provide managed cloudflared for ${platform}-${arch}. Install cloudflared and configure its executable path.`,
    );
  }
  const activeInstallation = cloudflaredInstallations.get(managedPath);
  if (activeInstallation !== undefined) return activeInstallation;
  const installation = installCloudflared(managedPath, platform, releaseAsset, options);
  cloudflaredInstallations.set(managedPath, installation);
  return installation.finally(() => {
    if (cloudflaredInstallations.get(managedPath) === installation) {
      cloudflaredInstallations.delete(managedPath);
    }
  });
}

function isAbsoluteCloudflaredPath(path: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? win32.isAbsolute(path) : posix.isAbsolute(path);
}

// Only a validated trycloudflare.com origin may reach users. Raw process output never does.
export function parseCloudflaredQuickTunnelUrl(output: string): string | null {
  const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=$|[^a-z0-9.-])/i);
  if (match === null || !URL.canParse(match[0])) return null;
  const url = new URL(match[0]);
  return url.hostname.endsWith(".trycloudflare.com") ? url.origin : null;
}

export async function probeCloudflaredExecutable(options?: CloudflaredOptions): Promise<void> {
  const executable =
    options?.executable ?? resolveCloudflaredExecutable(options?.platform ?? process.platform);
  const spawner = options?.spawner ?? spawnCloudflared;
  const child = await Promise.resolve()
    .then(() => spawner({ executable, args: ["--version"] }))
    .catch(() => {
      throw new CloudflaredUnavailableError();
    });
  child.stdin.end();

  return new Promise((resolve, reject) => {
    const state = { settled: false };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => reject(new CloudflaredUnavailableError()));
    }, PROBE_TIMEOUT_MS);
    const settle = (finish: () => void): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(timeout);
      finish();
    };
    const finish = (code: number | null): void => {
      settle(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new CloudflaredUnavailableError());
      });
    };

    if (child.exitCode !== null || child.signalCode !== null) {
      finish(child.exitCode);
      return;
    }
    child.once("error", () => settle(() => reject(new CloudflaredUnavailableError())));
    child.once("exit", finish);
    child.once("close", finish);
  });
}

export async function startCloudflaredQuickTunnel(
  targetOrigin: string,
  options?: CloudflaredOptions,
): Promise<CloudflaredQuickTunnel> {
  const target = normalizedLoopbackTarget(targetOrigin);
  const executable =
    options?.executable ?? resolveCloudflaredExecutable(options?.platform ?? process.platform);
  const child = await Promise.resolve()
    .then(() =>
      (options?.spawner ?? spawnCloudflared)({
        executable,
        args: ["tunnel", "--no-autoupdate", "--url", target],
      }),
    )
    .catch(() => {
      throw new CloudflaredUnavailableError();
    });
  child.stdin.end();
  const startedAt = new Date().toISOString();
  const exited = childExit(child);
  const closeState: { promise: Promise<void> | null } = { promise: null };
  const close = (): Promise<void> => {
    if (closeState.promise !== null) return closeState.promise;
    closeState.promise = closeChild(child, exited, options?.closeGraceMs ?? CLOSE_GRACE_MS);
    return closeState.promise;
  };

  return new Promise((resolve, reject) => {
    const state = {
      output: "",
      ready: false,
      settled: false,
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => reject(new CloudflaredTunnelTimeoutError()));
    }, options?.readyTimeoutMs ?? TUNNEL_READY_TIMEOUT_MS);
    const settle = (finish: () => void): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(timeout);
      finish();
    };
    const accept = (chunk: Buffer): void => {
      if (state.ready) return;
      state.output = (state.output + chunk.toString("utf8")).slice(-MAX_TUNNEL_OUTPUT_BYTES);
      const url = parseCloudflaredQuickTunnelUrl(state.output);
      if (url === null) return;
      state.ready = true;
      child.removeListener("error", unavailable);
      settle(() =>
        resolve(
          Object.freeze({
            url,
            hostname: new URL(url).hostname,
            pid: child.pid ?? null,
            startedAt,
            exited,
            close,
          }),
        ),
      );
    };
    const unavailable = (): void => settle(() => reject(new CloudflaredUnavailableError()));

    child.stdout.on("data", accept);
    child.stderr.on("data", accept);
    child.once("error", unavailable);
    void exited.then(() => {
      if (state.ready) return;
      settle(() => reject(new CloudflaredTunnelError()));
    });
  });
}

export async function readCloudflaredTunnelRecord(
  path: string,
): Promise<CloudflaredTunnelRecord | null> {
  return readFile(path, "utf8").then(
    (raw) => decodeCloudflaredTunnelRecord(raw),
    () => null,
  );
}

export async function writeCloudflaredTunnelRecord(
  path: string,
  record: CloudflaredTunnelRecord,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function clearCloudflaredTunnelRecord(path: string): Promise<void> {
  await unlink(path).catch((cause: unknown) => {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") {
      return;
    }
    throw cause;
  });
}

export async function reclaimOrphanedCloudflaredTunnel(
  path: string,
  options?: {
    readonly inspect?: CloudflaredProcessInspector;
    readonly inspectSpawner?: CloudflaredSpawner;
    readonly inspectTimeoutMs?: number;
    readonly maxInspectionOutputBytes?: number;
    readonly isProcessAlive?: (pid: number) => boolean;
    readonly kill?: (pid: number, signal: NodeJS.Signals) => void;
    readonly platform?: NodeJS.Platform;
  },
): Promise<boolean> {
  const record = await readCloudflaredTunnelRecord(path);
  if (record === null) return false;
  const platform = options?.platform ?? process.platform;
  const inspected = await Promise.resolve()
    .then(() =>
      options?.inspect === undefined
        ? inspectCloudflaredProcess(record.pid, {
            maxOutputBytes: Math.min(
              options?.maxInspectionOutputBytes ?? MAX_PROCESS_INSPECTION_OUTPUT_BYTES,
              MAX_PROCESS_INSPECTION_OUTPUT_BYTES,
            ),
            platform,
            spawner: options?.inspectSpawner,
            timeoutMs: Math.min(
              options?.inspectTimeoutMs ?? PROCESS_INSPECTION_TIMEOUT_MS,
              PROCESS_INSPECTION_TIMEOUT_MS,
            ),
          })
        : options.inspect(record.pid),
    )
    .catch(() => null);
  if (inspected === null) {
    const alive = await Promise.resolve()
      .then(() => (options?.isProcessAlive ?? isCloudflaredInstallProcessAlive)(record.pid))
      .catch(() => null);
    if (alive !== false) return false;
    await clearCloudflaredTunnelRecord(path);
    return false;
  }
  // PowerShell reports an explicit executable path. `ps` only reports a command string, so its
  // exact first token remains the strictest available check on POSIX.
  const inspectedExecutable =
    inspected.executable ?? inspected.command.trimStart().split(/\s+/, 1)[0] ?? "";
  const matches =
    inspectedExecutable.length > 0 &&
    executableMatches(inspectedExecutable, record.executable, platform, inspected.executable) &&
    Math.abs(inspected.startedAtMs - Date.parse(record.startedAt)) <= PROCESS_START_TOLERANCE_MS;
  if (!matches) {
    await clearCloudflaredTunnelRecord(path);
    return false;
  }
  const killed = await Promise.resolve()
    .then(() => {
      (options?.kill ?? killCloudflaredProcess)(record.pid, "SIGTERM");
      return true;
    })
    .catch(() => false);
  if (!killed) return false;
  await clearCloudflaredTunnelRecord(path);
  return true;
}

const spawnCloudflared: CloudflaredSpawner = (input) =>
  spawn(input.executable, [...input.args], { stdio: "pipe", windowsHide: true });

async function reportsPinnedCloudflaredVersion(
  executable: string,
  spawner?: CloudflaredSpawner,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const child = await Promise.resolve()
    .then(() => (spawner ?? spawnCloudflared)({ executable, args: ["--version"] }))
    .catch(() => null);
  if (child === null) return false;
  child.stdin.end();

  return new Promise((resolve) => {
    const state = { settled: false, stdout: "", stderr: "" };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle(false);
    }, timeoutMs);
    const settle = (matches: boolean): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(timeout);
      resolve(matches);
    };
    const accept = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      if (state[stream].length >= MAX_VERSION_OUTPUT_BYTES) return;
      state[stream] += chunk
        .toString("utf8")
        .slice(0, MAX_VERSION_OUTPUT_BYTES - state[stream].length);
    };
    const finish = (code: number | null): void => {
      settle(code === 0 && parsesPinnedCloudflaredVersion(`${state.stdout}\n${state.stderr}`));
    };

    child.stdout.on("data", (chunk: Buffer) => accept("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => accept("stderr", chunk));
    child.once("error", () => settle(false));
    child.once("close", finish);
    if (child.exitCode !== null || child.signalCode !== null) {
      setImmediate(() => finish(child.exitCode));
    }
  });
}

function parsesPinnedCloudflaredVersion(output: string): boolean {
  return (
    output.match(/(?:^|[\r\n])\s*cloudflared version ([0-9]+\.[0-9]+\.[0-9]+)(?=\s|$)/i)?.[1] ===
    CLOUDFLARED_VERSION
  );
}

async function installCloudflared(
  managedPath: string,
  platform: NodeJS.Platform,
  releaseAsset: CloudflaredReleaseAsset,
  options: CloudflaredAcquisitionOptions,
): Promise<string> {
  await mkdir(dirname(managedPath), { recursive: true, mode: 0o700 }).catch(() => {
    throw new CloudflaredAcquisitionError(
      "write_failed",
      "Honk could not create its managed cloudflared directory.",
    );
  });
  const lockPath = `${managedPath}.lock`;
  const lockOwner = JSON.stringify({
    pid: process.pid,
    token: randomBytes(16).toString("hex"),
  });
  await acquireCloudflaredInstallLock(lockPath, lockOwner, options);
  return installCloudflaredWithLock(managedPath, platform, releaseAsset, options).finally(() =>
    releaseCloudflaredInstallLock(lockPath, lockOwner),
  );
}

async function acquireCloudflaredInstallLock(
  lockPath: string,
  lockOwner: string,
  options: CloudflaredAcquisitionOptions,
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (
    let attempt = 0;
    attempt < (options.lockRetryCount ?? INSTALL_LOCK_RETRY_COUNT);
    attempt += 1
  ) {
    const acquired = await writeFile(lockPath, lockOwner, {
      flag: "wx",
      mode: 0o600,
    }).then(
      () => true,
      (cause: unknown) => {
        if (errorCode(cause) === "EEXIST") return false;
        throw new CloudflaredAcquisitionError(
          "write_failed",
          "Honk could not lock its managed cloudflared installation.",
        );
      },
    );
    if (acquired) return;
    const observedOwner = await readFile(lockPath, "utf8").catch(() => null);
    if (observedOwner === null) continue;
    const ownerPid = cloudflaredInstallLockPid(observedOwner);
    const reclaimable =
      ownerPid === null
        ? await stat(lockPath).then(
            (lockInfo) => now() - lockInfo.mtimeMs > INSTALL_LOCK_STALE_MS,
            () => false,
          )
        : !(options.isProcessAlive ?? isCloudflaredInstallProcessAlive)(ownerPid);
    if (reclaimable && (await reclaimCloudflaredInstallLock(lockPath, observedOwner))) {
      continue;
    }
    await sleep(options.lockRetryDelayMs ?? INSTALL_LOCK_RETRY_DELAY_MS);
  }
  throw new CloudflaredAcquisitionError(
    "install_locked",
    "Another cloudflared installation is still in progress. Try again shortly.",
  );
}

async function releaseCloudflaredInstallLock(lockPath: string, lockOwner: string): Promise<void> {
  const currentOwner = await readFile(lockPath, "utf8").catch(() => null);
  if (currentOwner !== lockOwner) return;
  await unlink(lockPath).catch(() => undefined);
}

async function reclaimCloudflaredInstallLock(
  lockPath: string,
  observedOwner: string,
): Promise<boolean> {
  const claimPath = join(
    dirname(lockPath),
    `.reclaim-${createHash("sha256").update(observedOwner).digest("hex").slice(0, 32)}`,
  );
  const claimed = await link(lockPath, claimPath).then(
    () => true,
    (cause: unknown) => {
      if (errorCode(cause) === "EEXIST" || errorCode(cause) === "ENOENT") return false;
      throw new CloudflaredAcquisitionError(
        "write_failed",
        "Honk could not reclaim its managed cloudflared installation lock.",
      );
    },
  );
  if (!claimed) return false;
  try {
    if ((await readFile(claimPath, "utf8").catch(() => null)) !== observedOwner) return false;
    return unlink(lockPath).then(
      () => true,
      (cause: unknown) => {
        if (errorCode(cause) === "ENOENT") return false;
        throw new CloudflaredAcquisitionError(
          "write_failed",
          "Honk could not reclaim its managed cloudflared installation lock.",
        );
      },
    );
  } finally {
    await unlink(claimPath).catch(() => undefined);
  }
}

async function installCloudflaredWithLock(
  managedPath: string,
  platform: NodeJS.Platform,
  releaseAsset: CloudflaredReleaseAsset,
  options: CloudflaredAcquisitionOptions,
): Promise<string> {
  if (
    existsSync(managedPath) &&
    (await reportsPinnedCloudflaredVersion(
      managedPath,
      options.spawner,
      STAGED_VALIDATION_TIMEOUT_MS,
    ))
  ) {
    return managedPath;
  }
  const download = await (
    options.download === undefined
      ? downloadCloudflared(
          releaseAsset.url,
          options.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS,
          options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES,
        )
      : options.download(releaseAsset.url)
  ).catch((cause: unknown) => {
    if (cause instanceof CloudflaredAcquisitionError) throw cause;
    throw new CloudflaredAcquisitionError(
      "download_failed",
      "Honk could not download cloudflared. Check your internet connection and try again.",
    );
  });
  if (download.byteLength > (options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES)) {
    throw new CloudflaredAcquisitionError(
      "download_failed",
      "The cloudflared download exceeded Honk's size limit.",
    );
  }
  if (createHash("sha256").update(download).digest("hex") !== releaseAsset.sha256.toLowerCase()) {
    throw new CloudflaredAcquisitionError(
      "invalid_checksum",
      "Downloaded cloudflared did not match Honk's pinned release checksum.",
    );
  }
  const temporaryDirectory = await mkdtemp(join(dirname(managedPath), ".install-")).catch(() => {
    throw new CloudflaredAcquisitionError(
      "write_failed",
      "Honk could not stage its managed cloudflared installation.",
    );
  });
  const executablePath = join(
    temporaryDirectory,
    platform === "win32" ? "cloudflared.exe" : "cloudflared",
  );
  const archivePath = join(temporaryDirectory, "cloudflared.tgz");
  const stagedPath = `${managedPath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    if (releaseAsset.archive === "tgz") {
      await writeFile(archivePath, download, { mode: 0o600 }).catch(() => {
        throw new CloudflaredAcquisitionError(
          "write_failed",
          "Honk could not write the cloudflared download.",
        );
      });
      await (options.extractArchive ?? extractCloudflaredArchive)({
        archivePath,
        destinationDirectory: temporaryDirectory,
        executablePath,
      }).catch(() => {
        throw new CloudflaredAcquisitionError(
          "write_failed",
          "Honk could not extract the cloudflared download.",
        );
      });
      const executableSha256 = releaseAsset.executableSha256;
      if (
        executableSha256 !== undefined &&
        createHash("sha256")
          .update(
            await readFile(executablePath).catch(() => {
              throw new CloudflaredAcquisitionError(
                "write_failed",
                "Honk could not read the extracted cloudflared executable.",
              );
            }),
          )
          .digest("hex") !== executableSha256.toLowerCase()
      ) {
        throw new CloudflaredAcquisitionError(
          "invalid_checksum",
          "Extracted cloudflared did not match Honk's pinned executable checksum.",
        );
      }
    } else {
      await writeFile(executablePath, download, {
        mode: platform === "win32" ? 0o600 : 0o700,
      }).catch(() => {
        throw new CloudflaredAcquisitionError(
          "write_failed",
          "Honk could not write the cloudflared executable.",
        );
      });
    }
    if (platform !== "win32") {
      await chmod(executablePath, 0o755).catch(() => {
        throw new CloudflaredAcquisitionError(
          "write_failed",
          "Honk could not make cloudflared executable.",
        );
      });
    }
    if (
      !(await reportsPinnedCloudflaredVersion(
        executablePath,
        options.spawner,
        STAGED_VALIDATION_TIMEOUT_MS,
      ))
    ) {
      throw new CloudflaredAcquisitionError(
        "validation_failed",
        `The downloaded cloudflared executable did not report required version ${CLOUDFLARED_VERSION}.`,
      );
    }
    await rename(executablePath, stagedPath).catch(() => {
      throw new CloudflaredAcquisitionError(
        "write_failed",
        "Honk could not stage the verified cloudflared executable.",
      );
    });
    // The locked target already failed exact-version validation. Keep it until the replacement is
    // ready, then remove it because Windows cannot rename over an existing executable.
    await unlink(managedPath).catch((cause: unknown) => {
      if (errorCode(cause) === "ENOENT") return;
      throw new CloudflaredAcquisitionError(
        "write_failed",
        "Honk could not replace its invalid managed cloudflared executable.",
      );
    });
    await rename(stagedPath, managedPath).catch(() => {
      throw new CloudflaredAcquisitionError(
        "write_failed",
        "Honk could not atomically activate its managed cloudflared executable.",
      );
    });
    return managedPath;
  } finally {
    await unlink(stagedPath).catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function downloadCloudflared(
  url: string,
  timeoutMs: number,
  maxDownloadBytes: number,
): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new CloudflaredAcquisitionError(
      "download_failed",
      "Honk could not download cloudflared. Check your internet connection and try again.",
    );
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxDownloadBytes) {
    throw new CloudflaredAcquisitionError(
      "download_failed",
      "The cloudflared download exceeded Honk's size limit.",
    );
  }
  if (response.body === null) {
    throw new CloudflaredAcquisitionError(
      "download_failed",
      "The cloudflared download returned no data.",
    );
  }
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  const state = { size: 0 };
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    state.size += next.value.byteLength;
    if (state.size > maxDownloadBytes) {
      await reader.cancel();
      throw new CloudflaredAcquisitionError(
        "download_failed",
        "The cloudflared download exceeded Honk's size limit.",
      );
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(state.size);
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return bytes;
}

function extractCloudflaredArchive(input: {
  readonly archivePath: string;
  readonly destinationDirectory: string;
}): Promise<void> {
  const child = spawn(
    "/usr/bin/tar",
    ["-xzf", input.archivePath, "-C", input.destinationDirectory],
    { stdio: "ignore", windowsHide: true },
  );
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error("cloudflared archive extraction failed"));
    });
  });
}

function errorCode(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null) return null;
  return Reflect.get(cause, "code");
}

function cloudflaredInstallLockPid(raw: string): number | null {
  try {
    const decoded: unknown = JSON.parse(raw);
    if (typeof decoded !== "object" || decoded === null) return null;
    const pid = Reflect.get(decoded, "pid");
    return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isCloudflaredInstallProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return errorCode(cause) === "EPERM";
  }
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
      throw new CloudflaredTunnelError();
    }
    return url.origin;
  } catch (cause) {
    if (cause instanceof CloudflaredTunnelError) throw cause;
    throw new CloudflaredTunnelError();
  }
}

function childExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      child.removeListener("exit", finish);
      child.removeListener("close", finish);
      child.removeListener("error", finish);
      resolve();
    };
    child.once("exit", finish);
    child.once("close", finish);
    child.once("error", finish);
  });
}

function closeChild(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<void>,
  graceMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return exited;
  child.kill("SIGTERM");
  const escalation = setTimeout(() => child.kill("SIGKILL"), graceMs);
  return exited.finally(() => clearTimeout(escalation));
}

function decodeCloudflaredTunnelRecord(raw: string): CloudflaredTunnelRecord | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const pid = Reflect.get(value, "pid");
    const executable = Reflect.get(value, "executable");
    const startedAt = Reflect.get(value, "startedAt");
    if (
      typeof pid !== "number" ||
      !Number.isInteger(pid) ||
      pid < 1 ||
      typeof executable !== "string" ||
      executable.length === 0 ||
      typeof startedAt !== "string" ||
      !Number.isFinite(Date.parse(startedAt))
    ) {
      return null;
    }
    return { pid, executable, startedAt };
  } catch {
    return null;
  }
}

function inspectCloudflaredProcess(
  pid: number,
  options: {
    readonly maxOutputBytes: number;
    readonly platform: NodeJS.Platform;
    readonly spawner: CloudflaredSpawner | undefined;
    readonly timeoutMs: number;
  },
): ReturnType<CloudflaredProcessInspector> {
  if (!Number.isSafeInteger(pid) || pid < 1) return Promise.resolve(null);
  const request =
    options.platform === "win32"
      ? {
          executable: win32.join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          ),
          args: [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            windowsProcessInspectionScript(pid),
          ],
        }
      : {
          executable: "ps",
          args: ["-p", String(pid), "-o", "lstart=,command="],
        };
  const child = (options.spawner ?? spawnCloudflared)(request);
  return new Promise((resolve) => {
    const state = { output: Buffer.alloc(0), settled: false };
    const settle = (inspection: Awaited<ReturnType<CloudflaredProcessInspector>>): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(timeout);
      resolve(inspection);
    };
    const timeout = setTimeout(
      () => {
        child.kill("SIGKILL");
        settle(null);
      },
      Math.max(0, options.timeoutMs),
    );
    child.stdin.end();
    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, options.maxOutputBytes - state.output.byteLength);
      if (remaining === 0) return;
      state.output = Buffer.concat([state.output, chunk.subarray(0, remaining)]);
    });
    child.stderr.resume();
    child.once("error", () => settle(null));
    child.once("close", (code) => {
      if (code !== 0) {
        settle(null);
        return;
      }
      settle(
        options.platform === "win32"
          ? parseWindowsCloudflaredProcessInspection(state.output.toString("utf8"))
          : parsePosixCloudflaredProcessInspection(state.output.toString("utf8")),
      );
    });
  });
}

function windowsProcessInspectionScript(pid: number): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    `$targetPid = ${pid}`,
    "$target = Get-Process -Id $targetPid -ErrorAction SilentlyContinue",
    "if ($null -eq $target) { exit 3 }",
    "try { $path = $target.Path; $startedAt = $target.StartTime.ToUniversalTime().ToString('O', [Globalization.CultureInfo]::InvariantCulture) } catch { exit 4 }",
    "[Console]::Out.Write((@{ path = $path; startedAt = $startedAt } | ConvertTo-Json -Compress))",
  ].join("; ");
}

function parseWindowsCloudflaredProcessInspection(
  output: string,
): Awaited<ReturnType<CloudflaredProcessInspector>> {
  try {
    const value: unknown = JSON.parse(output);
    if (typeof value !== "object" || value === null) return null;
    const executable = Reflect.get(value, "path");
    const startedAt = Reflect.get(value, "startedAt");
    const startedAtMs = typeof startedAt === "string" ? Date.parse(startedAt) : Number.NaN;
    if (
      typeof executable !== "string" ||
      !win32.isAbsolute(executable) ||
      !Number.isFinite(startedAtMs)
    ) {
      return null;
    }
    return { command: executable, executable, startedAtMs };
  } catch {
    return null;
  }
}

function parsePosixCloudflaredProcessInspection(
  output: string,
): Awaited<ReturnType<CloudflaredProcessInspector>> {
  const match = output
    .trim()
    .match(/^(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/s);
  const startedAtMs = match === null ? Number.NaN : Date.parse(match[1] ?? "");
  if (match === null || !Number.isFinite(startedAtMs)) return null;
  return { command: match[2] ?? "", startedAtMs };
}

function executableMatches(
  inspected: string,
  recorded: string,
  platform: NodeJS.Platform,
  exact: string | undefined,
): boolean {
  if (exact === undefined) {
    return inspected === recorded || basename(inspected) === basename(recorded);
  }
  if (platform === "win32") {
    if (win32.basename(recorded) === recorded) {
      return win32.basename(inspected).toLowerCase() === recorded.toLowerCase();
    }
    return win32.normalize(inspected).toLowerCase() === win32.normalize(recorded).toLowerCase();
  }
  return posix.normalize(inspected) === posix.normalize(recorded);
}

function killCloudflaredProcess(pid: number, signal: NodeJS.Signals): void {
  if (!process.kill(pid, signal)) throw new Error("cloudflared did not accept the signal");
}
