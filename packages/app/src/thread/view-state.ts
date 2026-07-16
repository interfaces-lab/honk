import type { ThreadViewState } from "../open-code-view";
import type { SessionWatchState } from "../watch-registry";

export function threadViewState(state: SessionWatchState | null): ThreadViewState | null {
  return state === null
    ? null
    : Object.freeze({
        ...state.app,
        attachedDirectories: state.attachedDirectories,
      });
}
