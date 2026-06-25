import { create } from "zustand";

const STORAGE_KEY = "honk.local-feature-flags.v1";

interface PersistedLocalFeatureFlags {
  readonly multitaskModeEnabled?: boolean;
}

interface LocalFeatureFlagsState {
  readonly multitaskModeEnabled: boolean;
  readonly setMultitaskModeEnabled: (enabled: boolean) => void;
  readonly toggleMultitaskModeEnabled: () => boolean;
}

function readPersistedLocalFeatureFlags(): PersistedLocalFeatureFlags {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const multitaskModeEnabled =
      "multitaskModeEnabled" in parsed && typeof parsed.multitaskModeEnabled === "boolean"
        ? parsed.multitaskModeEnabled
        : undefined;
    return multitaskModeEnabled === undefined ? {} : { multitaskModeEnabled };
  } catch {
    return {};
  }
}

function persistLocalFeatureFlags(state: Pick<LocalFeatureFlagsState, "multitaskModeEnabled">): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ multitaskModeEnabled: state.multitaskModeEnabled }),
    );
  } catch {
    // Ignore local storage failures; feature flags remain active for this tab.
  }
}

const initialFlags = readPersistedLocalFeatureFlags();

export const useLocalFeatureFlagsStore = create<LocalFeatureFlagsState>()((set, get) => ({
  multitaskModeEnabled: initialFlags.multitaskModeEnabled ?? false,
  setMultitaskModeEnabled: (enabled) => {
    set((state) => {
      if (state.multitaskModeEnabled === enabled) {
        return state;
      }
      const nextState = { ...state, multitaskModeEnabled: enabled };
      persistLocalFeatureFlags(nextState);
      return nextState;
    });
  },
  toggleMultitaskModeEnabled: () => {
    const next = !get().multitaskModeEnabled;
    get().setMultitaskModeEnabled(next);
    return next;
  },
}));

export function readLocalFeatureFlags(): Pick<LocalFeatureFlagsState, "multitaskModeEnabled"> {
  return { multitaskModeEnabled: useLocalFeatureFlagsStore.getState().multitaskModeEnabled };
}
