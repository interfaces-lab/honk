import { createFsDrain } from "evlog/fs";
import { initLogger, log as evlog, type LoggerConfig } from "evlog";
import { Cause, Logger, References } from "effect";

export const MULTI_RUN_ID_ENV = "MULTI_RUN_ID";
export const MULTI_PROCESS_ROLE_ENV = "MULTI_PROCESS_ROLE";
export const MULTI_PROCESS_INSTANCE_ID_ENV = "MULTI_PROCESS_INSTANCE_ID";

export type MultiProcessRole =
  | "app-renderer"
  | "desktop-main"
  | "desktop-renderer"
  | "dev-runner"
  | "provider"
  | "runtime"
  | "server"
  | "terminal";

export type MultiLogLevel = "debug" | "info" | "warn" | "error";

export interface MultiProcessMetadata {
  readonly runId: string;
  readonly processInstanceId: string;
  readonly processRole: MultiProcessRole;
}

export interface ConfigureMultiEvlogOptions {
  readonly logsDir: string;
  readonly service: string;
  readonly environment: string;
  readonly minLevel?: LoggerConfig["minLevel"];
  readonly maxFiles?: number;
  readonly maxSizePerFile?: number;
}

export interface MultiLogEventInput {
  readonly level: MultiLogLevel;
  readonly message: string;
  readonly service?: string;
  readonly fields?: Record<string, unknown>;
}

const SECRET_FIELD_PATTERN =
  /(^|[_\-.])(auth|authorization|bearer|cookie|credential|password|secret|sessiontoken|token|api[_\-.]?key)([_\-.]|$)/i;
const REDACTED = "[redacted]";
const MAX_SANITIZE_DEPTH = 6;
let processMetadata: MultiProcessMetadata | undefined;

export function configureMultiProcessMetadata(
  processRole: MultiProcessRole,
): MultiProcessMetadata {
  if (processMetadata?.processRole === processRole) {
    return processMetadata;
  }

  const runId = process.env[MULTI_RUN_ID_ENV] || crypto.randomUUID();
  const processInstanceId = process.env[MULTI_PROCESS_INSTANCE_ID_ENV] || crypto.randomUUID();
  process.env[MULTI_RUN_ID_ENV] = runId;
  process.env[MULTI_PROCESS_ROLE_ENV] = processRole;
  process.env[MULTI_PROCESS_INSTANCE_ID_ENV] = processInstanceId;
  processMetadata = {
    runId,
    processInstanceId,
    processRole,
  };
  return processMetadata;
}

export function configureMultiEvlog(options: ConfigureMultiEvlogOptions): void {
  initLogger({
    env: {
      service: options.service,
      environment: options.environment,
    },
    ...(options.minLevel ? { minLevel: options.minLevel } : {}),
    pretty: false,
    silent: true,
    redact: true,
    plugins: [
      {
        name: "multi-process-metadata",
        enrich: ({ event }) => {
          const runId = process.env[MULTI_RUN_ID_ENV];
          const processRole = process.env[MULTI_PROCESS_ROLE_ENV];
          const processInstanceId = process.env[MULTI_PROCESS_INSTANCE_ID_ENV];
          if (runId) event.runId = runId;
          if (processRole) event.processRole = processRole;
          if (processInstanceId) event.processInstanceId = processInstanceId;
        },
      },
    ],
    drain: createFsDrain({
      dir: options.logsDir,
      ...(options.maxFiles ? { maxFiles: options.maxFiles } : {}),
      ...(options.maxSizePerFile ? { maxSizePerFile: options.maxSizePerFile } : {}),
      pretty: false,
    }),
  });
}

export function writeMultiLogEvent(input: MultiLogEventInput): void {
  evlog[input.level]({
    ...(input.fields ? redactLogFields(input.fields) : {}),
    message: input.message,
    ...(input.service ? { service: input.service } : {}),
  });
}

export function makeMultiEffectLogger(input: { readonly defaultService: string }) {
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
    delete fields.component;

    writeMultiLogEvent({
      level: effectLogLevel(options.logLevel),
      message: text(options.message),
      service,
      fields,
    });
  });
}

export function effectLogLevel(level: unknown): MultiLogLevel {
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
  const component = fields.component;
  if (typeof component === "string" && component.trim().length > 0) return component;
  return undefined;
}

function sanitizeRecord(
  fields: Readonly<Record<string, unknown>>,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    output[key] = SECRET_FIELD_PATTERN.test(key)
      ? REDACTED
      : sanitizeValue(value, seen, depth + 1);
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
