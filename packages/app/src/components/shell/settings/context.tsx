"use client";

import { useNavigate } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

const ShellSettingsContext = createContext<{
  openSettings: () => void;
} | null>(null);

export function ShellSettingsProvider(props: { children: ReactNode }) {
  const navigate = useNavigate();
  const openSettings = useCallback(() => {
    void navigate({ to: "/settings/general" });
  }, [navigate]);
  const value = useMemo(() => ({ openSettings }), [openSettings]);
  return (
    <ShellSettingsContext.Provider value={value}>{props.children}</ShellSettingsContext.Provider>
  );
}

export function useShellSettings() {
  const ctx = useContext(ShellSettingsContext);
  if (!ctx) throw new Error("useShellSettings must be used within ShellSettingsProvider");
  return ctx;
}
