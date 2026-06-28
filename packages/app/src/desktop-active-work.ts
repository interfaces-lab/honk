import { hasVisibleActiveOrchestrationTurn } from "./session-logic";
import { selectSidebarThreadsAcrossEnvironments, type AppState } from "./stores/thread-store";

function formatRunningThreadTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled agent";
}

export function selectRunningThreadTitlesWithServerState(state: AppState): string[] {
  const serverEnvironmentIds = new Set(
    Object.entries(state.environmentStateById).flatMap(([environmentId, environmentState]) =>
      environmentState.snapshotSource === "server" ? [environmentId] : [],
    ),
  );

  return selectSidebarThreadsAcrossEnvironments(state)
    .filter(
      (summary) =>
        serverEnvironmentIds.has(summary.environmentId) &&
        hasVisibleActiveOrchestrationTurn(summary.latestTurn, summary.session),
    )
    .map((summary) => formatRunningThreadTitle(summary.title));
}

export function countRunningThreadsWithServerState(state: AppState): number {
  return selectRunningThreadTitlesWithServerState(state).length;
}
