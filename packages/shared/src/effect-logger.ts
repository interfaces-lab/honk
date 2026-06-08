import { Effect } from "effect";

type Fields = Record<string, unknown>;

export interface Handle {
  readonly debug: (msg?: unknown, extra?: Fields) => Effect.Effect<void>;
  readonly info: (msg?: unknown, extra?: Fields) => Effect.Effect<void>;
  readonly warn: (msg?: unknown, extra?: Fields) => Effect.Effect<void>;
  readonly error: (msg?: unknown, extra?: Fields) => Effect.Effect<void>;
  readonly with: (extra: Fields) => Handle;
}

const clean = (input?: Fields): Fields =>
  Object.fromEntries(
    Object.entries(input ?? {}).filter((entry) => entry[1] !== undefined && entry[1] !== null),
  );

const call = (
  run: (msg?: unknown) => Effect.Effect<void>,
  base: Fields,
  msg?: unknown,
  extra?: Fields,
) => {
  const ann = clean({ ...base, ...extra });
  const fx = run(msg);
  return Object.keys(ann).length > 0 ? Effect.annotateLogs(fx, ann) : fx;
};

export const create = (base: Fields = {}): Handle => ({
  debug: (msg, extra) => call((item) => Effect.logDebug(item), base, msg, extra),
  info: (msg, extra) => call((item) => Effect.logInfo(item), base, msg, extra),
  warn: (msg, extra) => call((item) => Effect.logWarning(item), base, msg, extra),
  error: (msg, extra) => call((item) => Effect.logError(item), base, msg, extra),
  with: (extra) => create({ ...base, ...extra }),
});
