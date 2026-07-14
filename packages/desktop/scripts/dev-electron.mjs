import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";

const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
if (!devServerUrl) {
  throw new Error("VITE_DEV_SERVER_URL is required for desktop development.");
}

const devServer = new URL(devServerUrl);
const port = Number.parseInt(devServer.port, 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${devServerUrl}`);
}

const requiredFiles = ["out/main/index.js", "out/preload/index.js", "../server/dist/bin.mjs"];
const watchedDirectories = [
  { directory: "out/main", files: new Set(["index.js"]), extensions: [".js", ".cjs"] },
  { directory: "out/preload", files: new Set(["index.js"]), extensions: [".js", ".cjs"] },
  { directory: "../server/dist", files: new Set(["bin.mjs"]) },
];
const forcedShutdownTimeoutMs = 1_500;
const restartDebounceMs = 120;
const childTreeGracePeriodMs = 1_200;
const staleProcessTerminateGraceMs = 2_000;
const staleProcessPollIntervalMs = 50;

await waitForResources({
  baseDir: desktopDir,
  files: requiredFiles,
  tcpHost: devServer.hostname,
  tcpPort: port,
});

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

function resolveDevUserDataDir() {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "honk-dev");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "honk-dev");
  }

  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "honk-dev");
}

const devUserDataDir = resolveDevUserDataDir();
mkdirSync(devUserDataDir, { recursive: true });
const devSupervisorPidPath = join(devUserDataDir, "dev-electron.pid");

let shuttingDown = false;
let restartTimer = null;
let currentApp = null;
let restartQueue = Promise.resolve();
const expectedExits = new WeakSet();
const watchers = [];

function findDescendantPids(pid) {
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

  const childrenByParent = new Map();
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

  const descendants = [];
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

function killChildTreeByPid(pid, signal) {
  for (const childPid of findDescendantPids(pid).reverse()) {
    try {
      process.kill(childPid, signal);
    } catch {
      // Process already exited.
    }
  }
}

function parsePid(value) {
  const pid = Number.parseInt(value.trim(), 10);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

function readSupervisorPid() {
  try {
    return parsePid(readFileSync(devSupervisorPidPath, "utf8"));
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function signalProcessTree(pid, signal) {
  if (pid === process.pid || !Number.isInteger(pid) || pid <= 1) {
    return;
  }

  try {
    process.kill(pid, signal);
  } catch {
    return;
  }
  killChildTreeByPid(pid, signal);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

async function waitForPidsToExit(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidAlive(pid))) {
      return;
    }
    await sleep(staleProcessPollIntervalMs);
  }
}

async function stopPids(pids) {
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

function findStaleDevProcessPids() {
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
  const appPids = new Set();
  const ownerPids = new Set();

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

async function cleanupStaleDevProcesses() {
  await stopPids([readSupervisorPid()].filter((pid) => pid !== null));

  const staleProcesses = findStaleDevProcessPids();
  await stopPids(staleProcesses.ownerPids);

  const remainingProcesses = findStaleDevProcessPids();
  await stopPids(remainingProcesses.appPids);
}

function writeSupervisorPid() {
  writeFileSync(devSupervisorPidPath, `${process.pid}\n`);
}

function removeSupervisorPid() {
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

function startApp() {
  if (shuttingDown || currentApp !== null) {
    return;
  }

  const app = spawn(
    resolveElectronPath({ isDevelopment: true }),
    [
      "--trace-warnings",
      `--user-data-dir=${devUserDataDir}`,
      `--honk-dev-root=${desktopDir}`,
      "out/main/index.js",
    ],
    {
      cwd: desktopDir,
      env: childEnv,
      stdio: "inherit",
    },
  );

  currentApp = app;

  app.once("error", () => {
    if (currentApp === app) {
      currentApp = null;
    }

    if (!shuttingDown) {
      scheduleRestart();
    }
  });

  app.once("exit", (code, signal) => {
    if (currentApp === app) {
      currentApp = null;
    }

    const exitedAbnormally = signal !== null || code !== 0;
    if (!shuttingDown && !expectedExits.has(app) && exitedAbnormally) {
      scheduleRestart();
    }
  });
}

async function stopApp() {
  const app = currentApp;
  if (!app) {
    return;
  }

  currentApp = null;
  expectedExits.add(app);

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    app.once("exit", finish);
    app.kill("SIGTERM");
    killChildTreeByPid(app.pid, "SIGTERM");

    setTimeout(() => {
      if (settled) {
        return;
      }

      app.kill("SIGKILL");
      killChildTreeByPid(app.pid, "SIGKILL");
      finish();
    }, forcedShutdownTimeoutMs).unref();
  });
}

function scheduleRestart() {
  if (shuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        await stopApp();
        if (!shuttingDown) {
          startApp();
        }
      });
  }, restartDebounceMs);
}

function startWatchers() {
  for (const { directory, files, extensions = [] } of watchedDirectories) {
    const watcher = watch(
      join(desktopDir, directory),
      { persistent: true },
      (_eventType, filename) => {
        if (
          typeof filename !== "string" ||
          (!files.has(filename) && !extensions.some((extension) => filename.endsWith(extension)))
        ) {
          return;
        }

        scheduleRestart();
      },
    );

    watchers.push(watcher);
  }
}

function killChildTree(signal) {
  killChildTreeByPid(process.pid, signal);
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  await stopApp();
  killChildTree("SIGTERM");
  await new Promise((resolve) => {
    setTimeout(resolve, childTreeGracePeriodMs);
  });
  killChildTree("SIGKILL");

  process.exit(exitCode);
}

startWatchers();
await cleanupStaleDevProcesses();
writeSupervisorPid();
startApp();
process.once("exit", removeSupervisorPid);

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
process.once("SIGHUP", () => {
  void shutdown(129);
});
