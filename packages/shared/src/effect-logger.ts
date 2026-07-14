import { Cause, Effect } from "effect";

import { coalesceLogFields, formatLogMessage } from "./logging";

export interface CreateOptions {
  readonly service: string;
}

export type LogFields = Record<string, unknown>;

export type LogExtra = LogFields | Cause.Cause<unknown> | Error;

export interface Handle {
  readonly debug: (message: string, extra?: LogExtra) => Effect.Effect<void>;
  readonly info: (message: string, extra?: LogExtra) => Effect.Effect<void>;
  readonly warn: (message: string, extra?: LogExtra) => Effect.Effect<void>;
  readonly error: (message: string, extra?: LogExtra) => Effect.Effect<void>;
  readonly with: (extra: LogFields) => Handle;
}

const clean = (input: LogFields): LogFields =>
  Object.fromEntries(
    Object.entries(input).filter((entry) => entry[1] !== undefined && entry[1] !== null),
  );

// Causes and Errors ride Effect's log-argument cause channel: `Effect.log*`
// extracts a Cause argument into the log entry's `cause`, where each logger
// applies its own rendering (the honk NDJSON sink pretty-prints it, console
// pretty renders it natively). Plain records become log annotations instead.
const splitExtra = (
  extra?: LogExtra,
): { readonly fields?: LogFields; readonly cause?: Cause.Cause<unknown> } => {
  if (extra === undefined) {
    return {};
  }
  if (Cause.isCause(extra)) {
    return { cause: extra };
  }
  if (extra instanceof Error) {
    return { cause: Cause.fail(extra) };
  }
  return { fields: extra };
};

const makeHandle = (base: LogFields): Handle => {
  const call = (
    run: (...args: ReadonlyArray<unknown>) => Effect.Effect<void>,
    message: string,
    extra?: LogExtra,
  ) => {
    const { fields: extraFields, cause } = splitExtra(extra);
    const fields = clean(coalesceLogFields(base, extraFields));
    const event = formatLogMessage(message);
    const fx = cause === undefined ? run(event) : run(event, cause);
    return Object.keys(fields).length > 0 ? Effect.annotateLogs(fx, fields) : fx;
  };

  return {
    debug: (message, extra) => call(Effect.logDebug, message, extra),
    info: (message, extra) => call(Effect.logInfo, message, extra),
    warn: (message, extra) => call(Effect.logWarning, message, extra),
    error: (message, extra) => call(Effect.logError, message, extra),
    with: (extra) => makeHandle(clean(coalesceLogFields(base, extra))),
  };
};

export const create = (options: CreateOptions): Handle =>
  makeHandle({ service: options.service });
