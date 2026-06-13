import type * as monaco from "monaco-editor";

import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";

// The file editor uses Pierre's native VS Code themes directly (full `colors`
// chrome + TextMate `tokenColors`), rather than the Cursor diff palettes in
// `~/lib/diff-rendering` that drive the @pierre/diffs viewer. These names live
// in Monaco's own theme registry, separate from the diff renderer's.
export const MONACO_THEME_NAMES = {
  light: "honk-pierre-light",
  dark: "honk-pierre-dark",
} as const;

type PierreTheme = typeof pierreDark;

let themesDefined = false;

function stripHash(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

function toMonacoTheme(theme: PierreTheme): monaco.editor.IStandaloneThemeData {
  const rules: monaco.editor.ITokenThemeRule[] = [];
  for (const entry of theme.tokenColors) {
    // The root scope-less entry just restates the default fg/bg, which the
    // `colors` map below already carries.
    if (entry.scope === undefined) {
      continue;
    }
    const scopes = Array.isArray(entry.scope)
      ? entry.scope
      : entry.scope.split(",").map((scope) => scope.trim());
    for (const scope of scopes) {
      if (!scope) {
        continue;
      }
      const rule: monaco.editor.ITokenThemeRule = { token: scope };
      if (entry.settings.foreground !== undefined) {
        rule.foreground = stripHash(entry.settings.foreground);
      }
      if (entry.settings.background !== undefined) {
        rule.background = stripHash(entry.settings.background);
      }
      if (entry.settings.fontStyle !== undefined) {
        rule.fontStyle = entry.settings.fontStyle;
      }
      rules.push(rule);
    }
  }

  return {
    base: theme.type === "dark" ? "vs-dark" : "vs",
    inherit: true,
    // Monaco reads the editor.* / selection / cursor keys it knows and ignores
    // the rest of the VS Code workbench colors, so the full map is safe to pass.
    colors: { ...theme.colors },
    rules,
  };
}

export function defineHonkMonacoThemes(monacoNamespace: typeof monaco): void {
  if (themesDefined) {
    return;
  }

  monacoNamespace.editor.defineTheme(MONACO_THEME_NAMES.light, toMonacoTheme(pierreLight));
  monacoNamespace.editor.defineTheme(MONACO_THEME_NAMES.dark, toMonacoTheme(pierreDark));
  themesDefined = true;
}

export function resolveMonacoThemeName(theme: "light" | "dark"): string {
  return theme === "dark" ? MONACO_THEME_NAMES.dark : MONACO_THEME_NAMES.light;
}
