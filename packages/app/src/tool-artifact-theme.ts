import { registerCustomTheme } from "@pierre/diffs";
import { honkTheme, type ThemeMode } from "@honk/ui/theme";

const TOOL_DIFF_THEME_NAMES = {
  light: "honk-tool-diff-light",
  dark: "honk-tool-diff-dark",
} as const;

type ToolDiffThemeName = (typeof TOOL_DIFF_THEME_NAMES)[keyof typeof TOOL_DIFF_THEME_NAMES];
type ToolDiffTheme = Awaited<ReturnType<Parameters<typeof registerCustomTheme>[1]>>;

function createToolDiffTheme(mode: ThemeMode): ToolDiffTheme {
  const colors = honkTheme.colors[mode];
  return {
    name: TOOL_DIFF_THEME_NAMES[mode],
    type: mode,
    colors: {
      "diffEditor.insertedLineBackground": colors.okBg,
      "diffEditor.insertedTextBackground": colors.okBg,
      "diffEditor.removedLineBackground": colors.errBg,
      "diffEditor.removedTextBackground": colors.errBg,
      "editor.background": colors.bgBase,
      "editor.foreground": colors.fg,
      "editorLineNumber.foreground": colors.fgTertiary,
      foreground: colors.fg,
      "gitDecoration.addedResourceForeground": colors.diffAddition,
      "gitDecoration.deletedResourceForeground": colors.diffDeletion,
      "gitDecoration.modifiedResourceForeground": colors.warnFg,
      "terminal.ansiBlue": colors.terminalBlue,
      "terminal.ansiCyan": colors.terminalCyan,
      "terminal.ansiGreen": colors.terminalGreen,
      "terminal.ansiRed": colors.terminalRed,
      "terminal.ansiYellow": colors.terminalYellow,
    },
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment", "string.comment"],
        settings: { foreground: colors.syntaxComment, fontStyle: "italic" },
      },
      {
        scope: ["keyword", "storage", "storage.type", "keyword.control"],
        settings: { foreground: colors.syntaxKeyword },
      },
      {
        scope: ["string", "string.quoted", "string.template"],
        settings: { foreground: colors.syntaxString },
      },
      {
        scope: ["constant.numeric", "constant.language", "constant.character"],
        settings: { foreground: colors.syntaxNumber },
      },
      {
        scope: ["entity.name.function", "support.function", "meta.function-call"],
        settings: { foreground: colors.syntaxFunction },
      },
      {
        scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
        settings: { foreground: colors.syntaxType },
      },
      {
        scope: ["variable.other.property", "support.variable.property", "meta.object-literal.key"],
        settings: { foreground: colors.syntaxProperty },
      },
      {
        scope: ["punctuation", "meta.brace", "meta.delimiter"],
        settings: { foreground: colors.syntaxPunctuation },
      },
    ],
  };
}

type ToolDiffThemeGlobal = typeof globalThis & {
  __honkToolDiffThemesRegistered?: boolean;
};

const registrationGlobal = globalThis as ToolDiffThemeGlobal;
if (registrationGlobal.__honkToolDiffThemesRegistered !== true) {
  registerCustomTheme(TOOL_DIFF_THEME_NAMES.light, () =>
    Promise.resolve(createToolDiffTheme("light")),
  );
  registerCustomTheme(TOOL_DIFF_THEME_NAMES.dark, () =>
    Promise.resolve(createToolDiffTheme("dark")),
  );
  registrationGlobal.__honkToolDiffThemesRegistered = true;
}

export { TOOL_DIFF_THEME_NAMES };
export type { ToolDiffThemeName };
