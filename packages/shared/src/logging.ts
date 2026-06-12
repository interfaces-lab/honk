// In-house rotating NDJSON file sink for Effect.Logger output (`makeHonkEffectLogger`).
import fs from "node:fs";
import path from "node:path";

import { Cause, Logger, References } from "effect";

export const HONK_RUN_ID_ENV = "HONK_RUN_ID";
export const HONK_PROCESS_ROLE_ENV = "HONK_PROCESS_ROLE";
export const HONK_PROCESS_INSTANCE_ID_ENV = "HONK_PROCESS_INSTANCE_ID";

export type HonkProcessRole =
  | "app-renderer"
  | "desktop-main"
  | "desktop-renderer"
  | "dev-runner"
  | "provider"
  | "runtime"
  | "server"
  | "terminal";

export type HonkLogLevel = "debug" | "info" | "warn" | "error";

export interface HonkProcessMetadata {
  readonly runId: string;
  readonly processInstanceId: string;
  readonly processRole: HonkProcessRole;
}

export interface ConfigureHonkEvlogOptions {
  readonly filePath: string;
  readonly service: string;
  readonly environment: string;
  readonly minLevel?: HonkLogLevel;
  readonly maxFiles?: number;
  readonly maxSizePerFile?: number;
}

export interface HonkLogEventInput {
  readonly level: HonkLogLevel;
  readonly message: string;
  readonly service?: string;
  readonly fields?: Record<string, unknown>;
}

export interface RotatingFileSinkOptions {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly throwOnError?: boolean;
}

const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_LOG_MAX_FILES = 10;
const IGNORABLE_STDIO_WRITE_ERROR_CODES = new Set([
  "EIO",
  "EPIPE",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
]);

const SECRET_FIELD_PATTERN =
  /(^|[_\-.])(auth|authorization|bearer|cookie|credential|password|secret|sessiontoken|token|api[_\-.]?key)([_\-.]|$)/i;
const REDACTED = "[redacted]";
const MAX_SANITIZE_DEPTH = 6;

const LOG_LEVEL_RANK: Record<HonkLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let processMetadata: HonkProcessMetadata | undefined;
let logSink: RotatingFileSink | undefined;
let logConfig:
  | {
      readonly service: string;
      readonly environment: string;
      readonly minLevel: HonkLogLevel;
    }
  | undefined;

export class RotatingFileSink {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly throwOnError: boolean;
  private currentSize = 0;

  constructor(options: RotatingFileSinkOptions) {
    if (options.maxBytes < 1) {
      throw new Error(`maxBytes must be >= 1 (received ${options.maxBytes})`);
    }
    if (options.maxFiles < 1) {
      throw new Error(`maxFiles must be >= 1 (received ${options.maxFiles})`);
    }

    this.filePath = options.filePath;
    this.maxBytes = options.maxBytes;
    this.maxFiles = options.maxFiles;
    this.throwOnError = options.throwOnError ?? false;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.pruneOverflowBackups();
    this.currentSize = this.readCurrentSize();
  }

  write(chunk: string | Buffer): void {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (buffer.length === 0) return;

    try {
      if (this.currentSize > 0 && this.currentSize + buffer.length > this.maxBytes) {
        this.rotate();
      }

      fs.appendFileSync(this.filePath, buffer);
      this.currentSize += buffer.length;

      if (this.currentSize > this.maxBytes) {
        this.rotate();
      }
    } catch {
      this.currentSize = this.readCurrentSize();
      if (this.throwOnError) {
        throw new Error(`Failed to write log chunk to ${this.filePath}`);
      }
    }
  }

  private rotate(): void {
    try {
      const oldest = this.withSuffix(this.maxFiles);
      if (fs.existsSync(oldest)) {
        fs.rmSync(oldest, { force: true });
      }

      for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
        const source = this.withSuffix(index);
        const target = this.withSuffix(index + 1);
        if (fs.existsSync(source)) {
          fs.renameSync(source, target);
        }
      }

      if (fs.existsSync(this.filePath)) {
        fs.renameSync(this.filePath, this.withSuffix(1));
      }

      this.currentSize = 0;
    } catch {
      this.currentSize = this.readCurrentSize();
      if (this.throwOnError) {
        throw new Error(`Failed to rotate log file ${this.filePath}`);
      }
    }
  }

  private pruneOverflowBackups(): void {
    try {
      const dir = path.dirname(this.filePath);
      const baseName = path.basename(this.filePath);
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.startsWith(`${baseName}.`)) continue;
        const suffix = Number(entry.slice(baseName.length + 1));
        if (!Number.isInteger(suffix) || suffix <= this.maxFiles) continue;
        fs.rmSync(path.join(dir, entry), { force: true });
      }
    } catch {
      if (this.throwOnError) {
        throw new Error(`Failed to prune log backups for ${this.filePath}`);
      }
    }
  }

  private readCurrentSize(): number {
    try {
      return fs.statSync(this.filePath).size;
    } catch {
      return 0;
    }
  }

  private withSuffix(index: number): string {
    return `${this.filePath}.${index}`;
  }
}

export function configureHonkProcessMetadata(processRole: HonkProcessRole): HonkProcessMetadata {
  if (processMetadata?.processRole === processRole) {
    return processMetadata;
  }

  const runId = process.env[HONK_RUN_ID_ENV] || crypto.randomUUID();
  const processInstanceId = process.env[HONK_PROCESS_INSTANCE_ID_ENV] || crypto.randomUUID();
  process.env[HONK_RUN_ID_ENV] = runId;
  process.env[HONK_PROCESS_ROLE_ENV] = processRole;
  process.env[HONK_PROCESS_INSTANCE_ID_ENV] = processInstanceId;
  processMetadata = {
    runId,
    processInstanceId,
    processRole,
  };
  return processMetadata;
}

export function configureHonkEvlog(options: ConfigureHonkEvlogOptions): void {
  logSink = new RotatingFileSink({
    filePath: options.filePath,
    maxBytes: options.maxSizePerFile ?? DEFAULT_LOG_MAX_BYTES,
    maxFiles: options.maxFiles ?? DEFAULT_LOG_MAX_FILES,
  });
  logConfig = {
    service: options.service,
    environment: options.environment,
    minLevel: options.minLevel ?? "debug",
  };
}

export function writeHonkLogEvent(input: HonkLogEventInput): void {
  if (!logSink || !logConfig) {
    return;
  }
  if (LOG_LEVEL_RANK[input.level] < LOG_LEVEL_RANK[logConfig.minLevel]) {
    return;
  }

  const event: Record<string, unknown> = {
    time: new Date().toISOString(),
    level: input.level,
    message: input.message,
    service: input.service ?? logConfig.service,
    environment: logConfig.environment,
  };

  const runId = process.env[HONK_RUN_ID_ENV];
  const processRole = process.env[HONK_PROCESS_ROLE_ENV];
  const processInstanceId = process.env[HONK_PROCESS_INSTANCE_ID_ENV];
  if (runId) event.runId = runId;
  if (processRole) event.processRole = processRole;
  if (processInstanceId) event.processInstanceId = processInstanceId;

  if (input.fields) {
    Object.assign(event, redactLogFields(input.fields));
  }

  try {
    logSink.write(`${JSON.stringify(event)}\n`);
  } catch {
    return;
  }
}

export function makeHonkEffectLogger(input: { readonly defaultService: string }) {
  return Logger.make((options) => {
    const annotations = sanitizeRecord(
      options.fiber.getRef(References.CurrentLogAnnotations),
      new WeakSet<object>(),
      0,
    );
    const fields: Record<string, unknown> = { ...annotations };
    const now = options.date.getTime();
    for (const [key, start] of options.fiber.getRef(References.CurrentLogSpans)) {
      fields[`logSpan.${key}`] = `${now - start}ms`;
    }
    if (options.cause.reasons.length > 0) {
      fields.cause = Cause.pretty(options.cause);
    }

    const service = readService(fields) ?? input.defaultService;
    delete fields.service;

    writeHonkLogEvent({
      level: effectLogLevel(options.logLevel),
      message: text(options.message),
      service,
      fields,
    });
  });
}

export function makeSafeConsolePrettyLogger(
  options?: Parameters<typeof Logger.consolePretty>[0],
): Logger.Logger<unknown, void> {
  const logger = Logger.consolePretty(options);

  return Logger.make((loggerOptions) => {
    try {
      logger.log(loggerOptions);
    } catch (error) {
      if (!isIgnorableStdioWriteError(error)) {
        throw error;
      }
    }
  });
}

export function isIgnorableStdioWriteError(error: unknown): boolean {
  const code = readStringProperty(error, "code");
  if (code !== undefined && IGNORABLE_STDIO_WRITE_ERROR_CODES.has(code)) {
    return true;
  }

  return (
    readStringProperty(error, "syscall") === "write" &&
    readStringProperty(error, "message")?.includes("EIO") === true
  );
}

export function effectLogLevel(level: unknown): HonkLogLevel {
  switch (String(level)) {
    case "Trace":
    case "Debug":
      return "debug";
    case "Warning":
    case "Warn":
      return "warn";
    case "Error":
    case "Fatal":
      return "error";
    default:
      return "info";
  }
}

export function redactLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return sanitizeRecord(fields, new WeakSet<object>(), 0);
}

function text(input: unknown): string {
  if (input === undefined) return "";
  if (Array.isArray(input)) return input.map((item) => String(item)).join(" ");
  if (input instanceof Error) return input.message;
  if (typeof input === "object" && input !== null) {
    try {
      return JSON.stringify(input);
    } catch {
      return String(input);
    }
  }
  return String(input);
}

function readService(fields: Record<string, unknown>): string | undefined {
  const service = fields.service;
  if (typeof service === "string" && service.trim().length > 0) return service;
  return undefined;
}

function readStringProperty(input: unknown, property: string): string | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const value = Reflect.get(input, property);
  return typeof value === "string" ? value : undefined;
}

function sanitizeRecord(
  fields: Readonly<Record<string, unknown>>,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    output[key] = SECRET_FIELD_PATTERN.test(key) ? REDACTED : sanitizeValue(value, seen, depth + 1);
  }
  return output;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return String(value);
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }
  if (depth > MAX_SANITIZE_DEPTH) return "[truncated-depth]";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, depth + 1));
  }
  return sanitizeRecord(value as Record<string, unknown>, seen, depth + 1);
}
