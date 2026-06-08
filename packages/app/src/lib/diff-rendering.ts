import { registerCustomTheme } from "@pierre/diffs";

export const DIFF_THEME_NAMES = {
  light: "multi-cursor-light",
  dark: "multi-cursor-dark",
} as const;

export type DiffThemeName = (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES];
type CustomDiffThemeRegistration = Awaited<ReturnType<Parameters<typeof registerCustomTheme>[1]>>;

const CURSOR_DARK_THEME = {
  name: DIFF_THEME_NAMES.dark,
  type: "dark",
  colors: {
    "diffEditor.insertedLineBackground": "#3FA26633",
    "diffEditor.insertedTextBackground": "#3FA26622",
    "diffEditor.removedLineBackground": "#B8004933",
    "diffEditor.removedTextBackground": "#B8004922",
    "editor.background": "#181818",
    "editor.foreground": "#E4E4E4EB",
    "editorLineNumber.foreground": "#E4E4E442",
    foreground: "#E4E4E4EB",
    "gitDecoration.addedResourceForeground": "#70B489",
    "gitDecoration.deletedResourceForeground": "#FC6B83",
    "gitDecoration.modifiedResourceForeground": "#F1B467",
    "terminal.ansiBlue": "#81A1C1",
    "terminal.ansiCyan": "#88C0D0",
    "terminal.ansiGreen": "#3FA266",
    "terminal.ansiRed": "#FC6B83",
    "terminal.ansiYellow": "#D2943E",
  },
  semanticHighlighting: true,
  semanticTokenColors: {
    "builtinConstant.readonly.builtin:python": "#82D2CE",
    "class.builtin": "#82D2CE",
    "class.typeHint": "#82D2CE",
    "entity.name.function": "#EBC88D",
    enumMember: "#D6D6DD",
    function: "#EBC88D",
    "function.builtin": "#82D2CE",
    "function.declaration": "#EFB080",
    macro: "#A8CC7C",
    "method.declaration": "#EFB080",
    property: "#AAA0FA",
    selfParameter: "#CC7C8A",
    "support.variable.property": "#AAA0FA",
    type: "#87C3FF",
    "variable.constant": "#82D2CE",
    "variable.defaultLibrary": "#D6D6DD",
  },
  settings: [
    {
      name: "Comment",
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: "#E4E4E45E", fontStyle: "italic" },
    },
    {
      name: "Strings",
      scope: ["string", "punctuation.definition.string.begin", "punctuation.definition.string.end"],
      settings: { foreground: "#E394DC" },
    },
    {
      name: "Text",
      scope: ["variable.parameter.function", "punctuation.separator.key-value"],
      settings: { foreground: "#D6D6DD" },
    },
    {
      name: "Keywords",
      scope: "keyword",
      settings: { foreground: "#82D2CE" },
    },
    {
      name: "Storage",
      scope: ["storage", "storage.type", "token.storage"],
      settings: { foreground: "#82D2CE" },
    },
    {
      name: "Special Operators",
      scope: [
        "keyword.operator.expression.delete",
        "keyword.operator.expression.in",
        "keyword.operator.expression.instanceof",
        "keyword.operator.expression.keyof",
        "keyword.operator.expression.of",
        "keyword.operator.expression.typeof",
        "keyword.operator.expression.void",
        "keyword.operator.new",
        "keyword.operator.optional",
        "keyword.operator.ternary",
      ],
      settings: { foreground: "#82D2CE" },
    },
    {
      name: "Operators",
      scope: [
        "keyword.operator",
        "keyword.operator.arithmetic",
        "keyword.operator.assignment",
        "keyword.operator.comparison",
        "keyword.operator.logical",
      ],
      settings: { foreground: "#D6D6DD" },
    },
    {
      name: "Functions",
      scope: ["entity.name.function", "meta.require", "support.function", "variable.function"],
      settings: { foreground: "#EFB080" },
    },
    {
      name: "Constants",
      scope: ["constant", "constant.numeric", "punctuation.definition.constant"],
      settings: { foreground: "#EBC88D" },
    },
    {
      name: "Constant Variables",
      scope: "variable.other.constant",
      settings: { foreground: "#AAA0FA" },
    },
    {
      name: "Readwrite Variables",
      scope: "variable.other.readwrite",
      settings: { foreground: "#87C3FF" },
    },
    {
      name: "Properties",
      scope: ["support.variable.property", "variable.other.property", "variable.other.property.ts"],
      settings: { foreground: "#AAA0FA" },
    },
    {
      name: "Template Punctuation",
      scope: [
        "keyword.other.substitution.begin",
        "keyword.other.substitution.end",
        "keyword.other.template.begin",
        "keyword.other.template.end",
        "punctuation.quasi.element",
      ],
      settings: { foreground: "#E394DC" },
    },
    {
      name: "Embedded Punctuation",
      scope: ["punctuation.section.embedded.begin", "punctuation.section.embedded.end"],
      settings: { foreground: "#82D2CE" },
    },
    {
      name: "Punctuation",
      scope: [
        "punctuation.separator.delimiter",
        "punctuation.section.block.begin",
        "punctuation.section.block.end",
        "punctuation.terminator.statement",
      ],
      settings: { foreground: "#D6D6DD" },
    },
    {
      name: "Diff Inserted",
      scope: ["markup.inserted", "markup.inserted.diff", "meta.diff.header.to-file"],
      settings: { foreground: "#E394DC" },
    },
    {
      name: "Diff Deleted",
      scope: ["markup.deleted", "markup.deleted.diff", "meta.diff.header.from-file"],
      settings: { foreground: "#D6D6DD" },
    },
    {
      name: "Diff Changed",
      scope: ["markup.changed", "markup.changed.diff"],
      settings: { foreground: "#EFB080" },
    },
  ],
} as const satisfies CustomDiffThemeRegistration;

const CURSOR_LIGHT_THEME = {
  name: DIFF_THEME_NAMES.light,
  type: "light",
  colors: {
    "diffEditor.insertedLineBackground": "#1F8A651F",
    "diffEditor.insertedTextBackground": "#1F8A6524",
    "diffEditor.removedLineBackground": "#CF2D5614",
    "diffEditor.removedTextBackground": "#CF2D561F",
    "editor.background": "#FCFCFC",
    "editor.foreground": "#141414EB",
    "editorLineNumber.foreground": "#1414147A",
    foreground: "#141414EB",
    "gitDecoration.addedResourceForeground": "#1F8A65",
    "gitDecoration.deletedResourceForeground": "#B3003F",
    "gitDecoration.modifiedResourceForeground": "#DB704B",
    "terminal.ansiBlue": "#206595",
    "terminal.ansiCyan": "#6F9BA6",
    "terminal.ansiGreen": "#1F8A65",
    "terminal.ansiRed": "#CF2D56",
    "terminal.ansiYellow": "#A33900",
  },
  semanticHighlighting: true,
  semanticTokenColors: {
    "builtinConstant.readonly.builtin:python": "#6F9BA6",
    "class.builtin": "#6F9BA6",
    "class.typeHint": "#6F9BA6",
    "function.builtin": "#6F9BA6",
    function: "#DB704B",
    "function.declaration": "#DB704B",
    macro: "#1F8A65",
    "method.declaration": "#DB704B",
    property: "#6049B3",
    selfParameter: "#B8448B",
    type: "#206595",
    "variable.constant": "#206595",
  },
  settings: [
    {
      name: "Comments",
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: "#141414AD", fontStyle: "italic" },
    },
    {
      name: "Strings",
      scope: ["string", "punctuation.definition.string.begin", "punctuation.definition.string.end"],
      settings: { foreground: "#9E94D5" },
    },
    {
      name: "Keywords",
      scope: "keyword",
      settings: { foreground: "#B3003F" },
    },
    {
      name: "Storage",
      scope: ["storage", "storage.type"],
      settings: { foreground: "#B3003F" },
    },
    {
      name: "Special Operators",
      scope: [
        "keyword.operator.expression.delete",
        "keyword.operator.expression.in",
        "keyword.operator.expression.instanceof",
        "keyword.operator.expression.keyof",
        "keyword.operator.expression.of",
        "keyword.operator.expression.typeof",
        "keyword.operator.expression.void",
        "keyword.operator.new",
        "keyword.operator.optional",
        "keyword.operator.ternary",
      ],
      settings: { foreground: "#206595" },
    },
    {
      name: "Operators",
      scope: ["keyword.operator.arithmetic", "keyword.operator.assignment"],
      settings: { foreground: "#141414EB" },
    },
    {
      name: "Functions",
      scope: ["entity.name.function", "meta.require", "support.function", "variable.function"],
      settings: { foreground: "#DB704B" },
    },
    {
      name: "Numbers",
      scope: "constant.numeric",
      settings: { foreground: "#B8448B" },
    },
    {
      name: "Variables",
      scope: "variable.other.readwrite",
      settings: { foreground: "#206595" },
    },
    {
      name: "Properties",
      scope: ["support.variable.property", "variable.other.property", "variable.other.property.ts"],
      settings: { foreground: "#6049B3" },
    },
    {
      name: "Punctuation",
      scope: "punctuation.separator.delimiter",
      settings: { foreground: "#141414EB" },
    },
  ],
} as const satisfies CustomDiffThemeRegistration;

type DiffThemeRegistrationGlobal = typeof globalThis & {
  __multiCursorDiffThemesRegistered?: boolean;
};

const diffThemeRegistrationGlobal = globalThis as DiffThemeRegistrationGlobal;

if (diffThemeRegistrationGlobal.__multiCursorDiffThemesRegistered !== true) {
  registerCustomTheme(DIFF_THEME_NAMES.dark, () => Promise.resolve(CURSOR_DARK_THEME));
  registerCustomTheme(DIFF_THEME_NAMES.light, () => Promise.resolve(CURSOR_LIGHT_THEME));
  diffThemeRegistrationGlobal.__multiCursorDiffThemesRegistered = true;
}

export function resolveDiffThemeName(theme: "light" | "dark"): DiffThemeName {
  return theme === "dark" ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light;
}

export const WORKBENCH_DIFF_LINE_HEIGHT = 20;

export const WORKBENCH_CODE_UNSAFE_CSS = `
  :host {
    min-width: 0;
    max-width: 100%;
  }

  [data-file],
  [data-diff] {
    min-width: 0;
    max-width: 100%;
  }

  [data-code],
  [data-content],
  [data-gutter] {
    min-width: 0;
  }

  [data-code] {
    line-height: ${WORKBENCH_DIFF_LINE_HEIGHT}px;
  }

  [data-line] {
    min-height: ${WORKBENCH_DIFF_LINE_HEIGHT}px;
  }

  [data-background] [data-line-type='change-addition'][data-line],
  [data-background] [data-line-type='change-addition'][data-no-newline],
  [data-background] [data-line-type='change-addition'][data-gutter-buffer] {
    background-color: var(--diffs-bg-addition);
  }

  [data-background] [data-line-type='change-deletion'][data-line],
  [data-background] [data-line-type='change-deletion'][data-no-newline],
  [data-background] [data-line-type='change-deletion'][data-gutter-buffer] {
    background-color: var(--diffs-bg-deletion);
  }

  [data-line-type='change-addition']:is([data-column-number], [data-gutter-buffer]) {
    background:
      linear-gradient(
        to right,
        var(
          --multi-git-diff-addition-gutter,
          var(--multi-git-diff-addition, var(--diffs-addition-base))
        ) 0 2px,
        var(--diffs-bg-addition) 2px 100%
      );
  }

  [data-line-type='change-deletion']:is([data-column-number], [data-gutter-buffer]) {
    background:
      linear-gradient(
        to right,
        var(
          --multi-git-diff-deletion-gutter,
          var(--multi-git-diff-deletion, var(--diffs-deletion-base))
        ) 0 2px,
        var(--diffs-bg-deletion) 2px 100%
      );
  }
`;

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

export function buildPatchCacheKey(patch: string, scope = "diff-rendering"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}
