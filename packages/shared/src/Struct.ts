import * as P from "effect/Predicate";

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? readonly DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function mergeRecordValues(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    const existing = next[key];
    next[key] =
      P.isObject(existing) && P.isObject(value) ? mergeRecordValues(existing, value) : value;
  }
  return next;
}

export function deepMerge<T extends Record<string, unknown>>(current: T, patch: DeepPartial<T>): T {
  if (!P.isObject(patch)) {
    return current;
  }

  if (!P.isObject(current)) {
    return mergeRecordValues({}, patch) as unknown as T;
  }

  return mergeRecordValues(current, patch) as unknown as T;
}
