import type { SelectConfig, TextConfig } from "dialkit";

export function dialSelect<T extends string>(
  options: readonly T[],
  defaultValue: T,
): SelectConfig {
  return { type: "select", options: [...options], default: defaultValue };
}

export function dialText(defaultValue: string, placeholder?: string): TextConfig {
  if (placeholder) {
    return { type: "text", default: defaultValue, placeholder };
  }
  return { type: "text", default: defaultValue };
}

export function pickDialSelect<T extends string>(value: string, options: readonly T[]): T {
  return (options.includes(value as T) ? value : options[0]) as T;
}
