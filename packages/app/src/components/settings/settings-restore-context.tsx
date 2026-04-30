import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { useSettingsRestore } from "./settings-panels";

interface SettingsRestoreContextValue {
  readonly changedSettingLabels: ReadonlyArray<string>;
  readonly restoreDefaults: () => Promise<void>;
  readonly restoreSignal: number;
}

const SettingsRestoreContext = createContext<SettingsRestoreContextValue | null>(null);

export function SettingsRestoreProvider(props: { children: ReactNode }) {
  const [restoreSignal, setRestoreSignal] = useState(0);
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(() =>
    setRestoreSignal((value) => value + 1),
  );
  const value = useMemo(
    () => ({ changedSettingLabels, restoreDefaults, restoreSignal }),
    [changedSettingLabels, restoreDefaults, restoreSignal],
  );

  return (
    <SettingsRestoreContext.Provider value={value}>
      {props.children}
    </SettingsRestoreContext.Provider>
  );
}

export function useSettingsRestoreState(): SettingsRestoreContextValue {
  const context = useContext(SettingsRestoreContext);
  if (!context) {
    throw new Error("useSettingsRestoreState must be used within SettingsRestoreProvider");
  }
  return context;
}
