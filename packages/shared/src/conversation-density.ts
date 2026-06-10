import {
  DEFAULT_CONVERSATION_DENSITY,
  type ConversationDensity,
  type UserConversationDensity,
} from "@multi/contracts/settings";

const COMPACT_EDIT_DENSITIES = new Set<ConversationDensity>([
  "compact-ungrouped",
  "compact-grouped",
  "compact-all-grouped",
]);

const GROUPED_DENSITIES = new Set<ConversationDensity>(["compact-grouped", "compact-all-grouped"]);

export function normalizeConversationDensity(
  density: ConversationDensity | "verbose" | "minimal",
): ConversationDensity {
  if (density === "verbose") {
    return "detailed";
  }
  if (density === "minimal") {
    return DEFAULT_CONVERSATION_DENSITY;
  }
  if (density === "compact-shells") {
    return "compact-ungrouped";
  }
  if (density === "compact-grouped") {
    return "compact-all-grouped";
  }
  return density;
}

export function shouldGroupToolCalls(density: ConversationDensity): boolean {
  return GROUPED_DENSITIES.has(density);
}

export function toUserConversationDensity(density: ConversationDensity): UserConversationDensity {
  switch (density) {
    case "compact-shells":
      return "compact-ungrouped";
    case "compact-grouped":
      return "compact-all-grouped";
    case "detailed":
    case "compact-ungrouped":
    case "compact-all-grouped":
      return density;
  }
}

export function shouldUseCompactEdits(density: ConversationDensity): boolean {
  return COMPACT_EDIT_DENSITIES.has(density);
}

export function shouldUseCompactShells(density: ConversationDensity): boolean {
  return density !== "detailed";
}

export function shouldGroupEdits(density: ConversationDensity): boolean {
  return GROUPED_DENSITIES.has(density);
}

export function shouldGroupShells(density: ConversationDensity): boolean {
  return shouldGroupEdits(density);
}
