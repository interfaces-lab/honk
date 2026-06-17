import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearch } from "@tanstack/react-router";

import {
  findSettingsPreferenceEntry,
  settingsPreferenceDomId,
} from "./settings-preference-index";

interface SettingsSearchContextValue {
  readonly focusPreference: (preferenceId: string) => void;
}

const SettingsSearchContext = createContext<SettingsSearchContextValue | null>(null);

function scrollToPreference(preferenceId: string): boolean {
  const element = document.getElementById(settingsPreferenceDomId(preferenceId));
  if (!element) {
    return false;
  }
  element.scrollIntoView({ block: "center", behavior: "instant" });
  return true;
}

export function SettingsSearchProvider(props: { children: ReactNode }) {
  const router = useRouter();
  const { section } = useSearch({ from: "/settings" });
  const [pendingPreferenceId, setPendingPreferenceId] = useState<string | null>(null);

  const focusPreference = useCallback(
    (preferenceId: string) => {
      const entry = findSettingsPreferenceEntry(preferenceId);
      if (!entry) {
        return;
      }

      setPendingPreferenceId(preferenceId);
      if (router.state.location.search.section !== entry.section) {
        void router.navigate({
          to: "/settings",
          search: { section: entry.section },
          replace: true,
        });
      }
    },
    [router],
  );

  useEffect(() => {
    if (!pendingPreferenceId) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let retryTimeoutId: number | undefined;

    const tryFocus = () => {
      if (cancelled) {
        return;
      }

      if (scrollToPreference(pendingPreferenceId)) {
        setPendingPreferenceId(null);
        return;
      }

      attempts += 1;
      if (attempts < 20) {
        retryTimeoutId = window.setTimeout(tryFocus, 50);
      } else {
        setPendingPreferenceId(null);
      }
    };

    tryFocus();

    return () => {
      cancelled = true;
      if (retryTimeoutId !== undefined) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [pendingPreferenceId, section]);

  const value = useMemo(() => ({ focusPreference }), [focusPreference]);

  return (
    <SettingsSearchContext.Provider value={value}>{props.children}</SettingsSearchContext.Provider>
  );
}

export function useSettingsSearch(): SettingsSearchContextValue {
  const context = useContext(SettingsSearchContext);
  if (!context) {
    throw new Error("useSettingsSearch must be used within SettingsSearchProvider");
  }
  return context;
}
