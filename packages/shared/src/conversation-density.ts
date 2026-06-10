import { type ConversationDensity } from "@multi/contracts/settings";

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
