#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

const baseServerPort = 13773;
const baseRendererPort = 5733;
const maxHashOffset = 3_000;
const maxPort = 65_535;
const desktopDevLoopbackHost = "127.0.0.1";
const devPortProbeHosts = ["127.0.0.1", "0.0.0.0", "::1", "::"] as const;
const staleProcessTerminateGraceMs = 2_000;
const staleProcessPollIntervalMs = 50;
const forcedDevShutdownTimeoutMs = 3_000;
const desktopBootstrapTokenEnv = "HONK_DESKTOP_BOOTSTRAP_TOKEN";
const shutdownSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

type ShutdownSignal = (typeof shutdownSignals)[number];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseOptionalPort(value: string | undefined): number | undefined {
  const parsed = parseOptionalInteger(value);
  if (parsed === undefined || parsed < 1 || parsed > maxPort) {
    return undefined;
  }
  return parsed;
}

function createDesktopBootstrapToken(): string {
  return randomBytes(24).toString("hex");
}

function buildBrowserBootstrapUrl(input: {
  readonly baseUrl: string;
  readonly bootstrapToken: string;
}): string {
  const url = new URL("/", input.baseUrl);
  url.searchParams.delete("token");
  url.hash = new URLSearchParams([["token", input.bootstrapToken]]).toString();
  return url.toString();
}

function resolveOffset(env: NodeJS.ProcessEnv): {
  readonly offset: number;
  readonly source: string;
} {
  const explicitOffset = parseOptionalInteger(env.HONK_PORT_OFFSET);
  if (explicitOffset !== undefined) {
    if (explicitOffset < 0) {
      throw new Error(`Invalid HONK_PORT_OFFSET: ${explicitOffset}`);
    }
    return { offset: explicitOffset, source: `HONK_PORT_OFFSET=${explicitOffset}` };
  }

  const seed = env.HONK_DEV_INSTANCE?.trim();
  if (!seed) {
    return { offset: 0, source: "default ports" };
  }

  if (/^\d+$/.test(seed)) {
    return { offset: Number(seed), source: `numeric HONK_DEV_INSTANCE=${seed}` };
  }

  const offset = (hashString(seed) % maxHashOffset) + 1;
  return { offset, source: `hashed HONK_DEV_INSTANCE=${seed}` };
}

function canListenOnHost(port: number, host: string): Promise<boolean> {
  return new Promise((resolveCheck) => {
    const server = createServer();
    server.once("error", () => {
      resolveCheck(false);
    });
    server.listen(port, host, () => {
      server.close(() => {
        resolveCheck(true);
      });
    });
  });
}

async function canListenOnPort(port: number): Promise<boolean> {
  for (const host of devPortProbeHosts) {
    if (!(await canListenOnHost(port, host))) {
      return false;
    }
  }
  return true;
}

async function findFirstAvailableOffset(input: {
  readonly startOffset: number;
  readonly hasExplicitBackendPort: boolean;
  readonly hasExplicitRendererUrl: boolean;
}): Promise<number> {
  for (let offset = input.startOffset; ; offset += 1) {
    const backendPort = baseServerPort + offset;
    const rendererPort = baseRendererPort + offset;
    if (backendPort > maxPort || rendererPort > maxPort) {
      break;
    }

    const backendAvailable = input.hasExplicitBackendPort || (await canListenOnPort(backendPort));
    const rendererAvailable = input.hasExplicitRendererUrl || (await canListenOnPort(rendererPort));
    if (backendAvailable && rendererAvailable) {
      return offset;
    }
  }

  throw new Error(
    `No available desktop dev ports found from offset ${input.startOffset}. Tried backend=${baseServerPort}+n renderer=${baseRendererPort}+n up to port ${maxPort}.`,
  );
}

function resolveDevUserDataDir() {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "honk-dev");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "honk-dev");
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "honk-dev");
}

async function createDesktopDevEnv(baseEnv: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const explicitBackendPort = parseOptionalPort(baseEnv.HONK_PORT);
  const explicitRendererUrl = baseEnv.VITE_DEV_SERVER_URL?.trim() || undefined;
  const { offset, source } = resolveOffset(baseEnv);
  const selectedOffset = await findFirstAvailableOffset({
    startOffset: offset,
    hasExplicitBackendPort: explicitBackendPort !== undefined,
    hasExplicitRendererUrl: explicitRendererUrl !== undefined,
  });
  const backendPort = explicitBackendPort ?? baseServerPort + selectedOffset;
  const rendererPort = parseOptionalPort(baseEnv.PORT) ?? baseRendererPort + selectedOffset;
  const honkHome = resolve(baseEnv.HONK_HOME?.trim() || join(homedir(), ".honk"));
  const bootstrapToken = baseEnv[desktopBootstrapTokenEnv]?.trim() || createDesktopBootstrapToken();
  const rendererUrl = explicitRendererUrl ?? `http://${desktopDevLoopbackHost}:${rendererPort}`;

  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ELECTRON_EXEC_PATH: resolveElectronPath(),
    HOST: desktopDevLoopbackHost,
    PORT: String(rendererPort),
    VITE_DEV_SERVER_URL: rendererUrl,
    HONK_HOME: honkHome,
    HONK_PORT: String(backendPort),
    [desktopBootstrapTokenEnv]: bootstrapToken,
  };

  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_HTTP_URL;
  delete env.VITE_WS_URL;
  delete env.HONK_MODE;
  delete env.HONK_NO_BROWSER;
  delete env.HONK_HOST;
  delete env.HONK_DESKTOP_WS_URL;

  const selectionSuffix =
    selectedOffset === offset ? "" : ` selectedOffset=${String(selectedOffset)}`;
  console.log(
    `[desktop-dev] source=${source}${selectionSuffix} backendPort=${env.HONK_PORT} rendererUrl=${env.VITE_DEV_SERVER_URL} baseDir=${env.HONK_HOME}`,
  );
  console.log(
    `[desktop-dev] Browser bootstrap URL: ${buildBrowserBootstrapUrl({
      baseUrl: rendererUrl,
      bootstrapToken,
    })}`,
  );

  return env;
}

const devUserDataDir = resolveDevUserDataDir();
mkdirSync(devUserDataDir, { recursive: true });
const devSupervisorPidPath = join(devUserDataDir, "dev-electron.pid");

function findDescendantPids(pid: number | undefined): number[] {
  if (process.platform === "win32" || typeof pid !== "number") {
    return [];
  }

  const result = spawnSync("ps", ["-axo", "pid=,ppid="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return [];
  }

  const childrenByParent = new Map<number, number[]>();
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const childPid = Number.parseInt(match[1], 10);
    const parentPid = Number.parseInt(match[2], 10);
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(childPid);
    childrenByParent.set(parentPid, children);
  }

  const descendants: number[] = [];
  const stack = [...(childrenByParent.get(pid) ?? [])];
  while (stack.length > 0) {
    const nextPid = stack.pop();
    if (nextPid === undefined) {
      continue;
    }
    descendants.push(nextPid);
    stack.push(...(childrenByParent.get(nextPid) ?? []));
  }
  return descendants;
}

function killChildTreeByPid(pid: number | undefined, signal: NodeJS.Signals): void {
  for (const childPid of findDescendantPids(pid).reverse()) {
    try {
      process.kill(childPid, signal);
    } catch {
      // Process already exited.
    }
  }
}

function parsePid(value: string): number | null {
  const pid = Number.parseInt(value.trim(), 10);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

function readSupervisorPid(): number | null {
  try {
    return parsePid(readFileSync(devSupervisorPidPath, "utf8"));
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && Reflect.get(error, "code") === "EPERM";
  }
}

function signalProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (pid === process.pid || pid <= 1) {
    return;
  }

  try {
    process.kill(pid, signal);
  } catch {
    return;
  }
  killChildTreeByPid(pid, signal);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms).unref();
  });
}

async function waitForPidsToExit(pids: readonly number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidAlive(pid))) {
      return;
    }
    await sleep(staleProcessPollIntervalMs);
  }
}

async function stopPids(pids: readonly number[]): Promise<void> {
  const targets = [...new Set(pids)].filter((pid) => pid !== process.pid && pid > 1);
  if (targets.length === 0) {
    return;
  }

  for (const pid of targets) {
    signalProcessTree(pid, "SIGTERM");
  }
  await waitForPidsToExit(targets, staleProcessTerminateGraceMs);

  for (const pid of targets) {
    if (isPidAlive(pid)) {
      signalProcessTree(pid, "SIGKILL");
    }
  }
}

function findStaleDevProcessPids(): { readonly appPids: number[]; readonly ownerPids: number[] } {
  if (process.platform === "win32") {
    return { appPids: [], ownerPids: [] };
  }

  const result = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return { appPids: [], ownerPids: [] };
  }

  const marker = `--honk-dev-root=${desktopDir}`;
  const appPids = new Set<number>();
  const ownerPids = new Set<number>();

  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const command = match[3];
    if (!command.includes(marker)) {
      continue;
    }

    const pid = Number.parseInt(match[1], 10);
    const ppid = Number.parseInt(match[2], 10);
    if (pid !== process.pid && pid > 1) {
      appPids.add(pid);
    }
    if (ppid !== process.pid && ppid > 1) {
      ownerPids.add(ppid);
    }
  }

  return {
    appPids: [...appPids],
    ownerPids: [...ownerPids],
  };
}

async function cleanupStaleDevProcesses(): Promise<void> {
  const supervisorPid = readSupervisorPid();
  await stopPids(supervisorPid === null ? [] : [supervisorPid]);

  const staleProcesses = findStaleDevProcessPids();
  await stopPids(staleProcesses.ownerPids);

  const remainingProcesses = findStaleDevProcessPids();
  await stopPids(remainingProcesses.appPids);
}

function writeSupervisorPid(): void {
  writeFileSync(devSupervisorPidPath, `${process.pid}\n`);
}

function removeSupervisorPid(): void {
  const supervisorPid = readSupervisorPid();
  if (supervisorPid !== process.pid) {
    return;
  }

  try {
    unlinkSync(devSupervisorPidPath);
  } catch {
    // The pid file is advisory. Shutdown should not fail if another process already removed it.
  }
}

await cleanupStaleDevProcesses();
writeSupervisorPid();
process.once("exit", removeSupervisorPid);

const childEnv = await createDesktopDevEnv(process.env);

const child = spawn(
  "pnpm",
  ["exec", "electron-vite", "dev", "--", `--honk-dev-root=${desktopDir}`],
  {
    cwd: desktopDir,
    env: childEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

let childExited = false;
let shuttingDown = false;
let shutdownSignal: ShutdownSignal | undefined;
let forcedShutdownTimer: ReturnType<typeof setTimeout> | undefined;

function exitCodeForSignal(signal: ShutdownSignal): number {
  switch (signal) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    case "SIGHUP":
      return 129;
  }
}

function forceExit(signal: ShutdownSignal): never {
  if (child.pid !== undefined) {
    signalProcessTree(child.pid, "SIGKILL");
  }
  process.exit(exitCodeForSignal(signal));
}

function shutdownFromSignal(signal: ShutdownSignal): void {
  if (shuttingDown) {
    forceExit(signal);
  }

  shuttingDown = true;
  shutdownSignal = signal;
  for (const nextSignal of shutdownSignals) {
    process.once(nextSignal, () => {
      forceExit(nextSignal);
    });
  }

  if (child.pid !== undefined) {
    signalProcessTree(child.pid, signal);
  }

  if (childExited) {
    process.exit(exitCodeForSignal(signal));
  }

  forcedShutdownTimer = setTimeout(() => {
    forceExit(signal);
  }, forcedDevShutdownTimeoutMs);
  forcedShutdownTimer.unref();
}

for (const signal of shutdownSignals) {
  process.once(signal, () => {
    shutdownFromSignal(signal);
  });
}

child.once("exit", (code, signal) => {
  childExited = true;
  if (forcedShutdownTimer !== undefined) {
    clearTimeout(forcedShutdownTimer);
    forcedShutdownTimer = undefined;
  }

  if (shutdownSignal !== undefined) {
    process.exit(exitCodeForSignal(shutdownSignal));
    return;
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
