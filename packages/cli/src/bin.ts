#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { hostname as machineHostname } from "node:os";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  buildHonkOpencodeConfig,
  HONK_OPENCODE_PLUGIN_DIRECTORY,
  HONK_OPENCODE_PLUGIN_ENTRY_FILE,
  HONK_OPENCODE_PLUGIN_MODULES,
} from "@honk/opencode/host";
import open from "open";

import { startHonkHost, type HonkHost, type PairingLink } from "./host";
import { renderTerminalQrCode } from "./qr";
import { freshAdminSecret, readHostState, resolveStatePath, type HostState } from "./state";
import {
  disableTailscaleHttpsServe,
  enableTailscaleHttpsServe,
  resolveTailscaleHttpsEndpoint,
  type TailscaleHttpsEndpoint,
} from "./tailscale";

const VERSION = "0.6.2";
const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 3773;
const MAX_PORT = 65_535;

type Command = "start" | "serve" | "pair" | "devices" | "revoke" | "stop";

interface CliOptions {
  readonly command: Command;
  readonly hostname: string;
  readonly port: number;
  readonly publicUrl?: string;
  readonly tailscaleServe: boolean;
  readonly tailscaleServePort: number;
  readonly cwd: string;
  readonly appDist?: string;
  readonly opencodeBin?: string;
  readonly label?: string;
  readonly deviceId?: string;
  readonly openBrowser: boolean;
}

const HELP = `honk ${VERSION}

Run Honk and its managed OpenCode host.

Usage:
  honk [start] [options]       Start Honk and open the web shell
  honk serve [options]        Start headless and print a mobile pairing QR code
  honk pair [--label name]    Issue web/mobile links and a mobile QR code
  honk devices                List paired devices
  honk revoke <device-id>     Revoke one device
  honk stop                   Stop the running host

Options:
  --hostname <host>           Listener host (default: 127.0.0.1)
  --port <port>               Listener port (default: 3773; 0 chooses a free port)
  --public-url <https-url>    URL exposed by your HTTPS tunnel or reverse proxy
  --tailscale-serve           Configure a private HTTPS endpoint with Tailscale Serve
  --tailscale-serve-port <n>  Tailscale HTTPS port (default: 443)
  --cwd <path>                OpenCode working directory (default: current directory)
  --app-dist <path>           Honk web build override
  --opencode-bin <path>       OpenCode executable override
  --no-open                   Do not open a browser
  --help                      Show this help
  --version                   Print the version
`;

const parsePort = (value: string): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
};

const parseRequiredPort = (value: string): number => {
  const port = parsePort(value);
  if (port === 0) throw new Error(`Invalid port: ${value}`);
  return port;
};

const valueAfter = (args: readonly string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
};

function parseArgs(args: readonly string[]): CliOptions | "help" | "version" {
  let command: Command = "start";
  let cursor = 0;
  const first = args[0];
  if (first === "--help" || first === "-h") return "help";
  if (first === "--version" || first === "-v") return "version";
  if (
    first === "start" ||
    first === "serve" ||
    first === "pair" ||
    first === "devices" ||
    first === "revoke" ||
    first === "stop"
  ) {
    command = first;
    cursor = 1;
  }

  let hostname = LOOPBACK_HOST;
  let port = DEFAULT_PORT;
  let publicUrl: string | undefined;
  let tailscaleServe = false;
  let tailscaleServePort = 443;
  let cwd = process.cwd();
  let appDist: string | undefined;
  let opencodeBin: string | undefined;
  let label: string | undefined;
  let deviceId: string | undefined;
  let openBrowser = command === "start";

  while (cursor < args.length) {
    const argument = args[cursor];
    switch (argument) {
      case "--help":
      case "-h":
        return "help";
      case "--version":
      case "-v":
        return "version";
      case "--hostname":
        hostname = valueAfter(args, cursor, argument);
        cursor += 2;
        break;
      case "--port":
        port = parsePort(valueAfter(args, cursor, argument));
        cursor += 2;
        break;
      case "--public-url":
        publicUrl = valueAfter(args, cursor, argument);
        cursor += 2;
        break;
      case "--tailscale-serve":
        tailscaleServe = true;
        cursor += 1;
        break;
      case "--tailscale-serve-port":
        tailscaleServe = true;
        tailscaleServePort = parseRequiredPort(valueAfter(args, cursor, argument));
        cursor += 2;
        break;
      case "--cwd":
        cwd = resolve(valueAfter(args, cursor, argument));
        cursor += 2;
        break;
      case "--app-dist":
        appDist = resolve(valueAfter(args, cursor, argument));
        cursor += 2;
        break;
      case "--opencode-bin":
        opencodeBin = resolve(valueAfter(args, cursor, argument));
        cursor += 2;
        break;
      case "--label":
        label = valueAfter(args, cursor, argument);
        cursor += 2;
        break;
      case "--no-open":
        openBrowser = false;
        cursor += 1;
        break;
      default:
        if (command === "revoke" && deviceId === undefined && argument !== undefined) {
          deviceId = argument;
          cursor += 1;
          break;
        }
        throw new Error(`Unknown argument: ${argument ?? ""}`);
    }
  }

  return {
    command,
    hostname,
    port,
    tailscaleServe,
    tailscaleServePort,
    cwd,
    openBrowser,
    ...(publicUrl !== undefined ? { publicUrl } : {}),
    ...(appDist !== undefined ? { appDist } : {}),
    ...(opencodeBin !== undefined ? { opencodeBin } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(deviceId !== undefined ? { deviceId } : {}),
  };
}

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname.startsWith("127.") ||
  hostname === "::1" ||
  hostname === "[::1]";

const validatePublicUrl = (options: CliOptions): void => {
  if (options.tailscaleServe && options.publicUrl !== undefined) {
    throw new Error("Use either --tailscale-serve or --public-url, not both.");
  }
  if (options.tailscaleServe && !isLoopback(options.hostname)) {
    throw new Error("Tailscale Serve requires a loopback --hostname.");
  }
  const isRemoteListener = !isLoopback(options.hostname);
  if (isRemoteListener && options.publicUrl === undefined) {
    throw new Error(
      "A non-loopback listener requires --public-url with the HTTPS URL devices will use.",
    );
  }
  if (options.publicUrl === undefined) return;
  const url = new URL(options.publicUrl);
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("The public Honk URL cannot contain credentials.");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error("The public Honk URL cannot contain query parameters or a fragment.");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error("The public Honk URL must be an origin without a path.");
  }
  if (url.protocol !== "https:" && (isRemoteListener || !isLoopback(url.hostname))) {
    throw new Error("Remote Honk URLs must use HTTPS.");
  }
};

const reserveLoopbackPort = (): Promise<number> =>
  new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close((error) => (error ? rejectPort(error) : resolvePort(port)));
    });
  });

const resolveOpenCodeBinary = async (override?: string): Promise<string> => {
  if (override !== undefined) {
    await access(override);
    return override;
  }
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("opencode-ai/package.json");
  const parsed: unknown = JSON.parse(await readFile(packagePath, "utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The installed opencode-ai package is invalid.");
  }
  const bin = Reflect.get(parsed, "bin");
  const relativeBin =
    typeof bin === "object" && bin !== null ? Reflect.get(bin, "opencode") : undefined;
  if (typeof relativeBin !== "string") {
    throw new Error("The installed opencode-ai package does not expose its CLI binary.");
  }
  return resolve(dirname(packagePath), relativeBin);
};

const firstExisting = async (candidates: readonly string[]): Promise<string | null> => {
  for (const candidate of candidates) {
    try {
      await access(resolve(candidate, "index.html"));
      return candidate;
    } catch {}
  }
  return null;
};

const resolveAppDist = async (override?: string): Promise<string> => {
  if (override !== undefined) return override;
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const fromEnvironment = process.env.HONK_APP_DIST?.trim();
  const candidates = [
    ...(fromEnvironment && fromEnvironment.length > 0 ? [resolve(fromEnvironment)] : []),
    resolve(moduleDirectory, "../web"),
    resolve(moduleDirectory, "../../app/dist"),
  ];
  const selected = await firstExisting(candidates);
  if (selected === null) {
    throw new Error("Honk web assets are missing. Build @honk/app or pass --app-dist.");
  }
  return selected;
};

const mergeNoProxy = (value: string | undefined): string => {
  const entries = new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  entries.add("127.0.0.1");
  entries.add("localhost");
  return [...entries].join(",");
};

const writeHonkOpencodeConfig = async (statePath: string): Promise<string> => {
  const configDirectory = resolve(dirname(statePath), "opencode");
  const pluginDirectory = resolve(configDirectory, HONK_OPENCODE_PLUGIN_DIRECTORY);
  const pluginPath = resolve(pluginDirectory, HONK_OPENCODE_PLUGIN_ENTRY_FILE);
  const configPath = resolve(configDirectory, "opencode.json");
  await mkdir(pluginDirectory, { recursive: true, mode: 0o700 });
  await Promise.all(
    HONK_OPENCODE_PLUGIN_MODULES.map(({ fileName, source }) =>
      writeFile(resolve(pluginDirectory, fileName), source),
    ),
  );
  await writeFile(configPath, `${JSON.stringify(buildHonkOpencodeConfig(pluginPath), null, 2)}\n`);
  return configPath;
};

const spawnOpenCode = (
  binary: string,
  port: number,
  password: string,
  cwd: string,
  configPath: string,
): ChildProcess =>
  spawn(binary, ["serve", "--hostname", LOOPBACK_HOST, "--port", String(port)], {
    cwd,
    env: {
      ...process.env,
      OPENCODE_CONFIG: configPath,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_CLIENT: "honk-cli",
      OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
      NO_PROXY: mergeNoProxy(process.env.NO_PROXY),
      no_proxy: mergeNoProxy(process.env.no_proxy),
    },
    stdio: "inherit",
  });

const requestAdmin = async (
  state: HostState,
  path: string,
  init?: RequestInit,
): Promise<Response> =>
  fetch(new URL(path, `${state.origin}/`), {
    ...init,
    headers: {
      authorization: `Bearer ${state.adminSecret}`,
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(2_000),
  });

const runningHost = async (): Promise<HostState | null> => {
  const state = await readHostState();
  if (state === null) return null;
  try {
    const response = await requestAdmin(state, "/honk/admin/status");
    return response.ok ? state : null;
  } catch {
    return null;
  }
};

const decodePairing = async (response: Response): Promise<PairingLink> => {
  const body: unknown = await response.json();
  const url = typeof body === "object" && body !== null ? Reflect.get(body, "url") : undefined;
  const mobileUrl =
    typeof body === "object" && body !== null ? Reflect.get(body, "mobileUrl") : undefined;
  const expiresAt =
    typeof body === "object" && body !== null ? Reflect.get(body, "expiresAt") : undefined;
  if (
    !response.ok ||
    typeof url !== "string" ||
    typeof mobileUrl !== "string" ||
    typeof expiresAt !== "string"
  ) {
    throw new Error(`The Honk host could not issue a pairing link (HTTP ${response.status}).`);
  }
  return { url, mobileUrl, expiresAt };
};

const issueFromRunningHost = async (state: HostState, label?: string): Promise<PairingLink> =>
  decodePairing(
    await requestAdmin(state, "/honk/admin/pairings", {
      method: "POST",
      body: JSON.stringify({ label: label ?? `${machineHostname()} browser` }),
    }),
  );

const printPairing = (pairing: PairingLink, publicUrl: string, includeQr: boolean): void => {
  process.stdout.write(
    [
      "Honk host is ready.",
      `Web: ${publicUrl}`,
      `Web attach: ${pairing.url}`,
      `Mobile attach: ${pairing.mobileUrl}`,
      `Expires: ${pairing.expiresAt}`,
      ...(includeQr ? ["", "Scan with your phone:", renderTerminalQrCode(pairing.mobileUrl)] : []),
      "",
    ].join("\n"),
  );
};

const runAdminCommand = async (options: CliOptions, state: HostState): Promise<boolean> => {
  switch (options.command) {
    case "pair": {
      const pairing = await issueFromRunningHost(state, options.label);
      printPairing(pairing, state.publicUrl, true);
      return true;
    }
    case "devices": {
      const response = await requestAdmin(state, "/honk/admin/devices");
      const body: unknown = await response.json();
      if (!response.ok || !Array.isArray(body)) {
        throw new Error(`The Honk host could not list devices (HTTP ${response.status}).`);
      }
      if (body.length === 0) {
        process.stdout.write("No devices are paired.\n");
        return true;
      }
      for (const value of body) {
        if (typeof value !== "object" || value === null) continue;
        const id = Reflect.get(value, "id");
        const label = Reflect.get(value, "label");
        const createdAt = Reflect.get(value, "createdAt");
        const revokedAt = Reflect.get(value, "revokedAt");
        if (typeof id !== "string" || typeof label !== "string" || typeof createdAt !== "string") {
          continue;
        }
        process.stdout.write(
          `${id}  ${label}  ${revokedAt === null ? "active" : "revoked"}  ${createdAt}\n`,
        );
      }
      return true;
    }
    case "revoke": {
      if (options.deviceId === undefined) throw new Error("honk revoke requires a device id.");
      const response = await requestAdmin(
        state,
        `/honk/admin/devices/${encodeURIComponent(options.deviceId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(`Device ${options.deviceId} was not found.`);
      process.stdout.write(`Revoked ${options.deviceId}.\n`);
      return true;
    }
    case "stop": {
      const response = await requestAdmin(state, "/honk/admin/shutdown", { method: "POST" });
      if (!response.ok) throw new Error(`The Honk host refused to stop (HTTP ${response.status}).`);
      process.stdout.write("Honk host is stopping.\n");
      return true;
    }
    case "start":
    case "serve":
      return false;
  }
};

const superviseOpenCode = (
  binary: string,
  port: number,
  password: string,
  cwd: string,
  configPath: string,
  isStopping: () => boolean,
): { readonly stop: () => void; readonly done: Promise<void> } => {
  let child: ChildProcess | null = null;
  let restartDelay = 500;
  let finishDelay: (() => void) | null = null;
  let forceKillTimer: NodeJS.Timeout | null = null;
  const done = (async () => {
    while (!isStopping()) {
      child = spawnOpenCode(binary, port, password, cwd, configPath);
      const startedAt = Date.now();
      const result = await new Promise<{
        readonly code: number | null;
        readonly error: Error | null;
      }>((resolveExit) => {
        let settled = false;
        const finish = (code: number | null, error: Error | null): void => {
          if (settled) return;
          settled = true;
          resolveExit({ code, error });
        };
        child?.once("error", (error) => finish(null, error));
        child?.once("exit", (code) => finish(code, null));
      });
      if (forceKillTimer !== null) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      child = null;
      if (isStopping()) return;
      if (Date.now() - startedAt >= 30_000) restartDelay = 500;
      const reason = result.error?.message ?? `exit code ${String(result.code)}`;
      process.stderr.write(`OpenCode stopped (${reason}); restarting in ${restartDelay}ms.\n`);
      await new Promise<void>((resolveDelay) => {
        const timeout = setTimeout(() => {
          finishDelay = null;
          resolveDelay();
        }, restartDelay);
        finishDelay = () => {
          clearTimeout(timeout);
          finishDelay = null;
          resolveDelay();
        };
      });
      restartDelay = Math.min(restartDelay * 2, 10_000);
    }
  })();
  return {
    stop() {
      finishDelay?.();
      if (child !== null) {
        child.kill("SIGTERM");
        forceKillTimer ??= setTimeout(() => child?.kill("SIGKILL"), 5_000);
      }
    },
    done,
  };
};

const waitForSignal = (): Promise<NodeJS.Signals> =>
  new Promise((resolveSignal) => {
    const finish = (signal: NodeJS.Signals): void => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      resolveSignal(signal);
    };
    const onSigint = (): void => finish("SIGINT");
    const onSigterm = (): void => finish("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  });

const start = async (options: CliOptions): Promise<void> => {
  validatePublicUrl(options);
  const tailscaleEndpoint: TailscaleHttpsEndpoint | null = options.tailscaleServe
    ? await resolveTailscaleHttpsEndpoint(options.tailscaleServePort)
    : null;
  const existing = await runningHost();
  if (existing !== null) {
    if (tailscaleEndpoint !== null) {
      throw new Error("Stop the running Honk host before enabling managed Tailscale Serve.");
    }
    if (await runAdminCommand(options, existing)) return;
    const pairing = await issueFromRunningHost(existing, options.label);
    printPairing(pairing, existing.publicUrl, options.command === "serve" || !options.openBrowser);
    if (options.openBrowser) await open(pairing.url);
    return;
  }

  if (
    options.command === "pair" ||
    options.command === "devices" ||
    options.command === "revoke" ||
    options.command === "stop"
  ) {
    throw new Error("No Honk host is running. Start one with `honk` or `honk serve`.");
  }

  const previous = await readHostState();
  const appDist = await resolveAppDist(options.appDist);
  const binary = await resolveOpenCodeBinary(options.opencodeBin);
  const upstreamPort = await reserveLoopbackPort();
  const upstreamPassword = randomBytes(32).toString("base64url");
  const upstreamOrigin = `http://${LOOPBACK_HOST}:${upstreamPort}`;
  const statePath = resolveStatePath();
  const opencodeConfigPath = await writeHonkOpencodeConfig(statePath);
  let host: HonkHost | null = null;
  let tailscaleConfigured = false;
  let stopping = false;
  try {
    host = await startHonkHost({
      hostname: options.hostname,
      port: options.port,
      ...(tailscaleEndpoint !== null
        ? { publicUrl: tailscaleEndpoint.url }
        : options.publicUrl !== undefined
          ? { publicUrl: options.publicUrl }
          : {}),
      upstreamOrigin,
      upstreamPassword,
      cwd: options.cwd,
      appDist,
      adminSecret: previous?.adminSecret ?? freshAdminSecret(),
      devices: previous?.devices ?? [],
      statePath,
    });
    if (tailscaleEndpoint !== null) {
      await enableTailscaleHttpsServe(host.origin, options.tailscaleServePort);
      tailscaleConfigured = true;
    }
    const supervisor = superviseOpenCode(
      binary,
      upstreamPort,
      upstreamPassword,
      options.cwd,
      opencodeConfigPath,
      () => stopping,
    );
    const pairing = host.issuePairing(options.label ?? `${machineHostname()} browser`);
    printPairing(pairing, host.publicUrl, options.command === "serve" || !options.openBrowser);
    if (options.openBrowser) await open(pairing.url);
    await waitForSignal();
    stopping = true;
    supervisor.stop();
    await host.close();
    if (tailscaleConfigured) {
      await disableTailscaleHttpsServe(options.tailscaleServePort).catch(() => undefined);
      tailscaleConfigured = false;
    }
    await supervisor.done;
  } finally {
    stopping = true;
    await host?.close().catch(() => undefined);
    if (tailscaleConfigured) {
      await disableTailscaleHttpsServe(options.tailscaleServePort).catch(() => undefined);
    }
  }
};

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    process.stdout.write(HELP);
  } else if (parsed === "version") {
    process.stdout.write(`${VERSION}\n`);
  } else {
    await start(parsed);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Honk failed."}\n`);
  process.exitCode = 1;
}
