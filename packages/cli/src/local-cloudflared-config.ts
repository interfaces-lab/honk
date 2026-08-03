import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isIP } from "node:net";
import { isAbsolute, join, resolve } from "node:path";

const ACCOUNT_TAG_PATTERN = /^[0-9a-f]{32}$/;
const TUNNEL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOOPBACK_ORIGIN_PATTERN = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})$/;
const MAX_TUNNEL_SECRET_BYTES = 4 * 1024;
const ARTIFACT_DIRECTORY = "managed-cloudflared";
const ARTIFACT_VERSION = "v1";
const CONFIG_FILE = "config.yml";
const CREDENTIALS_FILE = "credentials.json";
const tunnelOperations = new Map<string, Promise<unknown>>();

export interface WindowsOwnerProtectionInput {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly operation: "protect" | "verify";
}

/**
 * Protecting a directory must install an owner-only ACL whose inheritance
 * protects new children before the promise resolves. Verification must reject
 * a path that is not already owner-only without changing its ACL.
 */
export type WindowsOwnerProtection = (input: WindowsOwnerProtectionInput) => Promise<void>;

export interface LocalCloudflaredMaterializationOptions {
  readonly stateDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly accountTag: string;
  readonly tunnelId: string;
  readonly tunnelSecret: string;
  readonly hostname: string;
  readonly localOrigin: string;
  readonly protectWindowsOwnerOnly?: WindowsOwnerProtection;
}

export interface LocalCloudflaredMaterialization {
  readonly configPath: string;
  readonly credentialsPath: string;
  readonly tunnelId: string;
  readonly redactValues: readonly string[];
}

export interface LocalCloudflaredCleanupOptions {
  readonly stateDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly tunnelId: string;
  readonly protectWindowsOwnerOnly?: WindowsOwnerProtection;
}

export type LocalCloudflaredMaterializationFailureReason =
  | "cleanup_failed"
  | "conflict"
  | "invalid_configuration"
  | "protection_failed"
  | "state_directory_unavailable"
  | "write_failed";

export class LocalCloudflaredMaterializationError extends Error {
  readonly reason: LocalCloudflaredMaterializationFailureReason;

  constructor(reason: LocalCloudflaredMaterializationFailureReason) {
    super(
      reason === "invalid_configuration"
        ? "A valid local Cloudflare Tunnel allocation is required."
        : "Honk could not prepare protected local Cloudflare Tunnel credentials.",
    );
    this.name = "LocalCloudflaredMaterializationError";
    this.reason = reason;
  }
}

export class LocalCloudflaredCleanupError extends Error {
  constructor() {
    super("Honk could not remove its local Cloudflare Tunnel credentials.");
    this.name = "LocalCloudflaredCleanupError";
  }
}

export async function materializeLocalCloudflaredConfiguration(
  options: LocalCloudflaredMaterializationOptions,
): Promise<LocalCloudflaredMaterialization> {
  validateMaterializationOptions(options);
  return serializeTunnelOperation(operationKey(options), () =>
    materializeLocalCloudflaredConfigurationUnlocked(options),
  );
}

async function materializeLocalCloudflaredConfigurationUnlocked(
  options: LocalCloudflaredMaterializationOptions,
): Promise<LocalCloudflaredMaterialization> {
  const materialDirectory = join(
    options.stateDirectory,
    ARTIFACT_DIRECTORY,
    ARTIFACT_VERSION,
    options.tunnelId,
  );
  const configPath = join(materialDirectory, CONFIG_FILE);
  const credentialsPath = join(materialDirectory, CREDENTIALS_FILE);
  const credentials = `${JSON.stringify({
    AccountTag: options.accountTag,
    TunnelID: options.tunnelId,
    TunnelSecret: options.tunnelSecret,
  })}\n`;
  const config = [
    `tunnel: ${JSON.stringify(options.tunnelId)}`,
    `credentials-file: ${JSON.stringify(credentialsPath)}`,
    "ingress:",
    `  - hostname: ${JSON.stringify(options.hostname)}`,
    `    service: ${JSON.stringify(options.localOrigin)}`,
    `  - service: ${JSON.stringify("http_status:404")}`,
    "",
  ].join("\n");

  await requireOwnedStateDirectory(
    options.stateDirectory,
    options.platform,
    options.protectWindowsOwnerOnly,
  );
  await ensurePrivateDirectory(
    join(options.stateDirectory, ARTIFACT_DIRECTORY),
    options.platform,
    options.protectWindowsOwnerOnly,
  );
  await ensurePrivateDirectory(
    join(options.stateDirectory, ARTIFACT_DIRECTORY, ARTIFACT_VERSION),
    options.platform,
    options.protectWindowsOwnerOnly,
  );

  if (
    await existingMaterializationMatches(
      materialDirectory,
      configPath,
      credentialsPath,
      config,
      credentials,
      options,
    )
  ) {
    return materializationResult(configPath, credentialsPath, options);
  }

  const stagingDirectory = await mkdtemp(
    join(
      options.stateDirectory,
      ARTIFACT_DIRECTORY,
      ARTIFACT_VERSION,
      `.${options.tunnelId}.stage-${process.pid}-`,
    ),
  ).catch(() => {
    throw new LocalCloudflaredMaterializationError("write_failed");
  });
  const stagingConfigPath = join(stagingDirectory, CONFIG_FILE);
  const stagingCredentialsPath = join(stagingDirectory, CREDENTIALS_FILE);

  const activated = await (async () => {
    await protectDirectory(stagingDirectory, options.platform, options.protectWindowsOwnerOnly);
    await writeProtectedFile(
      stagingCredentialsPath,
      credentials,
      options.platform,
      options.protectWindowsOwnerOnly,
    );
    await writeProtectedFile(
      stagingConfigPath,
      config,
      options.platform,
      options.protectWindowsOwnerOnly,
    );
    const destination = await lstat(materialDirectory).catch((cause: unknown) => {
      if (errorCode(cause) === "ENOENT") return null;
      throw new LocalCloudflaredMaterializationError("write_failed");
    });
    if (destination !== null) return false;
    return rename(stagingDirectory, materialDirectory).then(
      () => true,
      () => false,
    );
  })().catch(async (cause: unknown) => {
    await removeStagingDirectory(stagingDirectory);
    if (cause instanceof LocalCloudflaredMaterializationError) throw cause;
    throw new LocalCloudflaredMaterializationError("write_failed");
  });

  if (activated) return materializationResult(configPath, credentialsPath, options);

  await removeStagingDirectory(stagingDirectory);
  if (
    await existingMaterializationMatches(
      materialDirectory,
      configPath,
      credentialsPath,
      config,
      credentials,
      options,
    )
  ) {
    return materializationResult(configPath, credentialsPath, options);
  }
  throw new LocalCloudflaredMaterializationError("write_failed");
}

export async function cleanupLocalCloudflaredConfiguration(
  options: LocalCloudflaredCleanupOptions,
): Promise<void> {
  validateCleanupOptions(options);
  return serializeTunnelOperation(operationKey(options), () =>
    cleanupLocalCloudflaredConfigurationUnlocked(options),
  );
}

async function cleanupLocalCloudflaredConfigurationUnlocked(
  options: LocalCloudflaredCleanupOptions,
): Promise<void> {
  await requireOwnedStateDirectory(
    options.stateDirectory,
    options.platform,
    options.protectWindowsOwnerOnly,
  ).catch(() => {
    throw new LocalCloudflaredCleanupError();
  });

  const materialDirectory = join(
    options.stateDirectory,
    ARTIFACT_DIRECTORY,
    ARTIFACT_VERSION,
    options.tunnelId,
  );
  const directory = await lstat(materialDirectory).catch((cause: unknown) => {
    if (errorCode(cause) === "ENOENT") return null;
    throw new LocalCloudflaredCleanupError();
  });
  if (directory === null) {
    if (await removeOrphanedStagingDirectories(options)) return;
    throw new LocalCloudflaredCleanupError();
  }
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new LocalCloudflaredCleanupError();
  }

  const results = await Promise.allSettled([
    removeRegularFile(join(materialDirectory, CREDENTIALS_FILE)),
    removeRegularFile(join(materialDirectory, CONFIG_FILE)),
  ]);
  const removedMaterialDirectory = await rmdir(materialDirectory).then(
    () => true,
    (cause: unknown) => {
      if (errorCode(cause) === "ENOENT") return true;
      if (errorCode(cause) === "ENOTEMPTY") return false;
      throw new LocalCloudflaredCleanupError();
    },
  );
  const removedStagingDirectories = await removeOrphanedStagingDirectories(options);
  if (
    results.some((result) => result.status === "rejected") ||
    !removedMaterialDirectory ||
    !removedStagingDirectories
  ) {
    throw new LocalCloudflaredCleanupError();
  }
}

function validateMaterializationOptions(options: LocalCloudflaredMaterializationOptions): void {
  if (
    typeof options.stateDirectory !== "string" ||
    typeof options.platform !== "string" ||
    typeof options.accountTag !== "string" ||
    typeof options.tunnelId !== "string" ||
    typeof options.tunnelSecret !== "string" ||
    typeof options.hostname !== "string" ||
    typeof options.localOrigin !== "string" ||
    options.tunnelSecret.length > Math.ceil(MAX_TUNNEL_SECRET_BYTES / 3) * 4 ||
    options.hostname.length > 253 ||
    options.localOrigin.length > 64 ||
    (options.protectWindowsOwnerOnly !== undefined &&
      typeof options.protectWindowsOwnerOnly !== "function")
  ) {
    throw new LocalCloudflaredMaterializationError("invalid_configuration");
  }
  const secret = Buffer.from(options.tunnelSecret, "base64");
  const hostnameLabels = options.hostname.split(".");
  const origin = LOOPBACK_ORIGIN_PATTERN.exec(options.localOrigin);
  if (
    !validStateDirectory(options.stateDirectory) ||
    options.platform !== process.platform ||
    (options.platform !== "darwin" &&
      options.platform !== "linux" &&
      options.platform !== "win32") ||
    !ACCOUNT_TAG_PATTERN.test(options.accountTag) ||
    !TUNNEL_ID_PATTERN.test(options.tunnelId) ||
    secret.length < 32 ||
    secret.length > MAX_TUNNEL_SECRET_BYTES ||
    secret.toString("base64") !== options.tunnelSecret ||
    isIP(options.hostname) !== 0 ||
    hostnameLabels.length < 2 ||
    hostnameLabels.some(
      (label) =>
        label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    ) ||
    origin === null ||
    Number(origin[1]) > 65_535 ||
    (options.platform === "win32" && options.protectWindowsOwnerOnly === undefined)
  ) {
    throw new LocalCloudflaredMaterializationError("invalid_configuration");
  }
}

function validateCleanupOptions(options: LocalCloudflaredCleanupOptions): void {
  if (
    typeof options.stateDirectory !== "string" ||
    typeof options.platform !== "string" ||
    typeof options.tunnelId !== "string" ||
    (options.protectWindowsOwnerOnly !== undefined &&
      typeof options.protectWindowsOwnerOnly !== "function") ||
    !validStateDirectory(options.stateDirectory) ||
    options.platform !== process.platform ||
    (options.platform !== "darwin" &&
      options.platform !== "linux" &&
      options.platform !== "win32") ||
    !TUNNEL_ID_PATTERN.test(options.tunnelId) ||
    (options.platform === "win32" && options.protectWindowsOwnerOnly === undefined)
  ) {
    throw new LocalCloudflaredCleanupError();
  }
}

function validStateDirectory(path: string): boolean {
  return (
    isAbsolute(path) &&
    resolve(path) === path &&
    path.length > 1 &&
    path.length <= 4_096 &&
    !Buffer.from(path, "utf8").some((byte) => byte <= 31 || byte === 127)
  );
}

async function requireOwnedStateDirectory(
  path: string,
  platform: NodeJS.Platform,
  protectWindowsOwnerOnly: WindowsOwnerProtection | undefined,
): Promise<void> {
  const state = await lstat(path).catch(() => null);
  if (
    state === null ||
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    !ownedByCurrentUser(state.uid, platform) ||
    (platform !== "win32" && (state.mode & 0o022) !== 0)
  ) {
    throw new LocalCloudflaredMaterializationError("state_directory_unavailable");
  }
  if (platform !== "win32") return;
  await protectWindowsOwnerOnly?.({
    path,
    kind: "directory",
    operation: "verify",
  }).catch(() => {
    throw new LocalCloudflaredMaterializationError("state_directory_unavailable");
  });
}

async function ensurePrivateDirectory(
  path: string,
  platform: NodeJS.Platform,
  protectWindowsOwnerOnly: WindowsOwnerProtection | undefined,
): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((cause: unknown) => {
    if (errorCode(cause) !== "EEXIST") {
      throw new LocalCloudflaredMaterializationError("write_failed");
    }
  });
  const state = await lstat(path).catch(() => null);
  if (
    state === null ||
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    !ownedByCurrentUser(state.uid, platform)
  ) {
    throw new LocalCloudflaredMaterializationError("protection_failed");
  }
  await protectDirectory(path, platform, protectWindowsOwnerOnly);
}

async function protectDirectory(
  path: string,
  platform: NodeJS.Platform,
  protectWindowsOwnerOnly: WindowsOwnerProtection | undefined,
): Promise<void> {
  if (platform === "win32") {
    await protectWindowsOwnerOnly?.({
      path,
      kind: "directory",
      operation: "protect",
    }).catch(() => {
      throw new LocalCloudflaredMaterializationError("protection_failed");
    });
    return;
  }
  await chmod(path, 0o700).catch(() => {
    throw new LocalCloudflaredMaterializationError("protection_failed");
  });
}

async function writeProtectedFile(
  path: string,
  contents: string,
  platform: NodeJS.Platform,
  protectWindowsOwnerOnly: WindowsOwnerProtection | undefined,
): Promise<void> {
  await writeFile(path, contents, { flag: "wx", mode: 0o600 }).catch(() => {
    throw new LocalCloudflaredMaterializationError("write_failed");
  });
  if (platform === "win32") {
    await protectWindowsOwnerOnly?.({
      path,
      kind: "file",
      operation: "protect",
    }).catch(() => {
      throw new LocalCloudflaredMaterializationError("protection_failed");
    });
    return;
  }
  await chmod(path, 0o600).catch(() => {
    throw new LocalCloudflaredMaterializationError("protection_failed");
  });
}

async function existingMaterializationMatches(
  materialDirectory: string,
  configPath: string,
  credentialsPath: string,
  config: string,
  credentials: string,
  options: LocalCloudflaredMaterializationOptions,
): Promise<boolean> {
  const directory = await lstat(materialDirectory).catch((cause: unknown) => {
    if (errorCode(cause) === "ENOENT") return null;
    throw new LocalCloudflaredMaterializationError("conflict");
  });
  if (directory === null) return false;
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new LocalCloudflaredMaterializationError("conflict");
  }
  await verifyExistingProtection(materialDirectory, "directory", directory.mode, 0o700, options);
  const entries = await readdir(materialDirectory).catch(() => {
    throw new LocalCloudflaredMaterializationError("conflict");
  });
  if (
    entries.length !== 2 ||
    !entries.includes(CONFIG_FILE) ||
    !entries.includes(CREDENTIALS_FILE)
  ) {
    throw new LocalCloudflaredMaterializationError("conflict");
  }
  const files = await Promise.all(
    [configPath, credentialsPath].map(async (path) => {
      const state = await lstat(path).catch(() => null);
      if (
        state === null ||
        !state.isFile() ||
        state.isSymbolicLink() ||
        !ownedByCurrentUser(state.uid, options.platform) ||
        state.size !== Buffer.byteLength(path === configPath ? config : credentials)
      ) {
        throw new LocalCloudflaredMaterializationError("conflict");
      }
      await verifyExistingProtection(path, "file", state.mode, 0o600, options);
      return readFile(path, "utf8").catch(() => {
        throw new LocalCloudflaredMaterializationError("conflict");
      });
    }),
  );
  if (files[0] !== config || files[1] !== credentials) {
    throw new LocalCloudflaredMaterializationError("conflict");
  }
  return true;
}

async function verifyExistingProtection(
  path: string,
  kind: WindowsOwnerProtectionInput["kind"],
  mode: number,
  expectedMode: number,
  options: LocalCloudflaredMaterializationOptions,
): Promise<void> {
  if (options.platform !== "win32") {
    if ((mode & 0o777) !== expectedMode) {
      throw new LocalCloudflaredMaterializationError("conflict");
    }
    return;
  }
  await options
    .protectWindowsOwnerOnly?.({
      path,
      kind,
      operation: "verify",
    })
    .catch(() => {
      throw new LocalCloudflaredMaterializationError("conflict");
    });
}

function materializationResult(
  configPath: string,
  credentialsPath: string,
  options: LocalCloudflaredMaterializationOptions,
): LocalCloudflaredMaterialization {
  return Object.freeze({
    configPath,
    credentialsPath,
    tunnelId: options.tunnelId,
    redactValues: Object.freeze([options.tunnelSecret]),
  });
}

async function removeRegularFile(path: string): Promise<void> {
  const state = await lstat(path).catch((cause: unknown) => {
    if (errorCode(cause) === "ENOENT") return null;
    throw new LocalCloudflaredCleanupError();
  });
  if (state === null) return;
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new LocalCloudflaredCleanupError();
  }
  await unlink(path).catch((cause: unknown) => {
    if (errorCode(cause) === "ENOENT") return;
    throw new LocalCloudflaredCleanupError();
  });
}

async function removeStagingDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => {
    throw new LocalCloudflaredMaterializationError("cleanup_failed");
  });
}

async function removeOrphanedStagingDirectories(
  options: LocalCloudflaredCleanupOptions,
): Promise<boolean> {
  const versionDirectory = join(options.stateDirectory, ARTIFACT_DIRECTORY, ARTIFACT_VERSION);
  const prefix = `.${options.tunnelId}.stage-`;
  const entries = await readdir(versionDirectory).catch((cause: unknown) => {
    if (errorCode(cause) === "ENOENT") return [];
    throw new LocalCloudflaredCleanupError();
  });
  const results = await Promise.all(
    entries
      .filter((entry) => entry.startsWith(prefix))
      .map(async (entry) => {
        const owner = /^([1-9][0-9]*)-.+$/.exec(entry.slice(prefix.length));
        if (owner === null) return false;
        const ownerPid = Number(owner[1]);
        if (!Number.isSafeInteger(ownerPid) || ownerPid > 2_147_483_647) return false;
        if (ownerPid !== process.pid && isProcessAlive(ownerPid)) return false;

        const path = join(versionDirectory, entry);
        const state = await lstat(path).catch(() => null);
        if (
          state === null ||
          !state.isDirectory() ||
          state.isSymbolicLink() ||
          !ownedByCurrentUser(state.uid, options.platform)
        ) {
          return false;
        }
        return rm(path, { recursive: true, force: true }).then(
          () => true,
          () => false,
        );
      }),
  );
  return results.every(Boolean);
}

function errorCode(cause: unknown): unknown {
  return typeof cause === "object" && cause !== null ? Reflect.get(cause, "code") : null;
}

function ownedByCurrentUser(uid: number, platform: NodeJS.Platform): boolean {
  return platform === "win32" || process.getuid === undefined || uid === process.getuid();
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return errorCode(cause) === "EPERM";
  }
}

function operationKey(options: LocalCloudflaredCleanupOptions): string {
  return JSON.stringify([options.stateDirectory, options.tunnelId]);
}

function serializeTunnelOperation<Result>(
  key: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previous = tunnelOperations.get(key);
  const current = (
    previous === undefined ? Promise.resolve() : previous.catch(() => undefined)
  ).then(operation);
  tunnelOperations.set(key, current);
  return current.finally(() => {
    if (tunnelOperations.get(key) === current) tunnelOperations.delete(key);
  });
}
