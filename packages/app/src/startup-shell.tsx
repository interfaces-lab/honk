import { Shell } from "@honk/ui/shell";
import * as React from "react";

type StartupTheme = "system" | "light" | "dark";

const schemeStyles: Record<StartupTheme, React.CSSProperties> = {
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
};

function readStartupTheme(): StartupTheme {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem("honk:app:appearance") || "null");
    if (typeof stored !== "object" || stored === null) {
      return "system";
    }
    const theme = Reflect.get(stored, "theme");
    return theme === "light" || theme === "dark" ? theme : "system";
  } catch {
    return "system";
  }
}

function StartupShell(): React.ReactElement {
  return (
    <Shell
      material={/^Mac/.test(navigator.platform) ? "glass" : "solid"}
      style={schemeStyles[readStartupTheme()]}
    >
      <Shell.TitleBar />
      <Shell.Stage>
        <Shell.Sheet />
      </Shell.Stage>
    </Shell>
  );
}

export { StartupShell };
