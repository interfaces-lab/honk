"use client";

import { useNavigate } from "@tanstack/react-router";
import { createContext, useContext, useRef, type ReactNode } from "react";

import { DEFAULT_SETTINGS_ROUTE } from "~/components/settings/settings-sections";

const ShellSettingsContext = createContext<{
  openSettings: () => void;
} | null>(null);

export function ShellSettingsProvider(props: { children: ReactNode }) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const contextValueRef = useRef({
    openSettings: () => {
      void navigateRef.current({ to: DEFAULT_SETTINGS_ROUTE });
    },
  });

  return (
    <ShellSettingsContext.Provider value={contextValueRef.current}>
      {props.children}
    </ShellSettingsContext.Provider>
  );
}

export function useShellSettings() {
  const ctx = useContext(ShellSettingsContext);
  if (!ctx) throw new Error("useShellSettings must be used within ShellSettingsProvider");
  return ctx;
}
