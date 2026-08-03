import { honkTheme } from "@honk/ui/theme";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

type Monaco = typeof import("monaco-editor/editor/editor.api");

const TRANSPARENT = "#00000000";

const state: { promise?: Promise<Monaco> } = {};

function loadMonaco(): Promise<Monaco> {
  const environment = globalThis as typeof globalThis & {
    MonacoEnvironment?: { getWorker: () => Worker };
  };
  environment.MonacoEnvironment ??= {
    getWorker: () => new EditorWorker(),
  };
  state.promise ??= importMonaco();
  return state.promise;
}

async function importMonaco(): Promise<Monaco> {
  const monaco = await import("monaco-editor/editor/editor.api");
  // Basic tokenizers provide path-based language detection and syntax color without registering
  // the JSON/CSS/HTML/TypeScript language services that require their own workers.
  await import("monaco-editor/basic-languages/monaco.contribution");

  // Syntax stays on the base vs / vs-dark token rules: Cursor's Glass bundle carries no syntax
  // palette to copy, and inventing one here would fork honk's highlighting from the rest of the app.
  monaco.editor.defineTheme("honk-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: editorColors("light"),
  });
  monaco.editor.defineTheme("honk-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: editorColors("dark"),
  });

  return monaco;
}

// Monaco resolves theme colors to literal hex, so each surface is read off the shared token source
// rather than retyped; `light-dark()` cannot reach in here.
function editorColors(mode: "light" | "dark"): Record<string, string> {
  const palette = honkTheme.colors[mode];
  return {
    // The panel owns the surface. Painting neither the editor nor its gutter is what lets the
    // breadcrumbs row and the code read as one background, matching Cursor's `breadcrumb.background`
    // resolving to editorBackground (spec JS 882955).
    "editor.background": TRANSPARENT,
    "editorGutter.background": TRANSPARENT,
    // Cursor overrides stock Monaco's gutter on its own surfaces: idle line numbers at
    // `--cursor-text-tertiary` = color-mix(base 60%, transparent) and the active one at
    // `--cursor-text-primary` = the base text color (spec CSS 40037 / JS 18367589). `99` is that
    // 60% as an alpha byte, applied to honk's text color instead of Cursor's.
    "editorLineNumber.foreground": `${palette.textPrimary.slice(0, 7)}99`,
    "editorLineNumber.activeForeground": palette.textPrimary,
    // `renderLineHighlight` ships as "line" (spec JS 1018574). The spec carries no color for the
    // band, so it borrows honk's hover state and drops the inherited border to stay a flat block.
    "editor.lineHighlightBackground": palette.stateHover,
    "editor.lineHighlightBorder": TRANSPARENT,
    // Sticky headers are on by default (spec JS 979232) and must be opaque here: with a transparent
    // editor background the scrolled code would otherwise show through them. Cursor detaches them
    // with a 1px bottom border and a `0 4px 2px -2px` shadow (spec CSS 115517).
    "editorStickyScroll.background": palette.bgBase,
    "editorStickyScrollHover.background": palette.layer01,
    "editorStickyScroll.border": palette.borderBase,
    "editorStickyScroll.shadow": palette.borderStrong,
  };
}

export { loadMonaco };
