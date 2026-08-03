import type {
  ManagedEnvironmentDiscoveryRow,
  ManagedEnvironmentDiscoveryState,
} from "./managed-environment-discovery";

export interface ManagedEnvironmentRowPresentation {
  readonly title: string;
  readonly detail: string;
  readonly tone: "error" | "muted" | "success" | "warning";
}

export function presentManagedEnvironmentRow(
  row: ManagedEnvironmentDiscoveryRow,
): ManagedEnvironmentRowPresentation {
  switch (row.availability) {
    case "checking":
      return {
        title: "Checking…",
        detail: "Checking whether this computer is available.",
        tone: "muted",
      };
    case "online":
      return {
        title: "Online",
        detail: "This computer is available through your Honk account.",
        tone: "success",
      };
    case "offline":
      return {
        title: "Offline",
        detail: "This computer is not reachable right now.",
        tone: "muted",
      };
    case "unknown":
      return {
        title: "Status unavailable",
        detail: "Honk could not confirm whether this computer is online.",
        tone: "warning",
      };
    case "error":
      return {
        title: "Could not check",
        detail: row.error.message,
        tone: "error",
      };
  }
}

export function additionalManagedEnvironmentRows(
  state: ManagedEnvironmentDiscoveryState,
  savedEnvironmentIds: ReadonlySet<string>,
): readonly ManagedEnvironmentDiscoveryRow[] {
  return Object.freeze(
    [...state.environments.values()].filter(
      (row) => !savedEnvironmentIds.has(row.environment.environmentId),
    ),
  );
}
