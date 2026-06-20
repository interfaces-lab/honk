import { hasVisibleActiveOrchestrationTurn } from "./session-logic";
import { selectSidebarThreadsAcrossEnvironments, type AppState } from "./stores/thread-store";

export function countRunningThreadsWithServerState(state: AppState): number {
  const serverEnvironmentIds = new Set(
    Object.entries(state.environmentStateById).flatMap(([environmentId, environmentState]) =>
      environmentState.snapshotSource === "server" ? [environmentId] : [],
    ),
  );

  return selectSidebarThreadsAcrossEnvironments(state).filter(
    (summary) =>
      serverEnvironmentIds.has(summary.environmentId) &&
      hasVisibleActiveOrchestrationTurn(summary.latestTurn, summary.session),
  ).length;
}
