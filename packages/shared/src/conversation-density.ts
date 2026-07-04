import { Schema } from "effect";
import * as SchemaTransformation from "effect/SchemaTransformation";

export const USER_CONVERSATION_DENSITY_VALUES = [
  "detailed",
  "compact-ungrouped",
  "compact-all-grouped",
] as const;
export type ConversationDensity = (typeof USER_CONVERSATION_DENSITY_VALUES)[number];

const LEGACY_CONVERSATION_DENSITY_VALUES = [
  "verbose",
  "minimal",
  "compact-shells",
  "compact-grouped",
] as const;

// Exactly three densities exist at runtime (the settings slider stops). Historical stored
// values migrate at decode; encode only ever writes canonical values, so persisted settings
// converge on the next write.
export const ConversationDensity = Schema.Literals([
  ...USER_CONVERSATION_DENSITY_VALUES,
  ...LEGACY_CONVERSATION_DENSITY_VALUES,
]).pipe(
  Schema.decodeTo(
    Schema.Literals([...USER_CONVERSATION_DENSITY_VALUES]),
    SchemaTransformation.transform({
      decode: (value): ConversationDensity => {
        switch (value) {
          case "verbose":
            return "detailed";
          case "compact-shells":
            return "compact-ungrouped";
          case "minimal":
          case "compact-grouped":
            return "compact-all-grouped";
          default:
            return value;
        }
      },
      encode: (value) => value,
    }),
  ),
);

export const DEFAULT_CONVERSATION_DENSITY: ConversationDensity = "compact-all-grouped";

// Exactly three densities reach runtime code (the settings schema migrates legacy persisted
// values at decode): detailed = full cards, no grouping; compact-ungrouped (Balanced) =
// compact lines, no grouping; compact-all-grouped (Compact) = compact lines, grouped runs.

export function shouldUseCompactEdits(density: ConversationDensity): boolean {
  return density !== "detailed";
}

export function shouldUseCompactShells(density: ConversationDensity): boolean {
  return density !== "detailed";
}

export function shouldGroupToolCalls(density: ConversationDensity): boolean {
  return density === "compact-all-grouped";
}

export function shouldGroupEdits(density: ConversationDensity): boolean {
  return density === "compact-all-grouped";
}

export function shouldGroupShells(density: ConversationDensity): boolean {
  return density === "compact-all-grouped";
}
