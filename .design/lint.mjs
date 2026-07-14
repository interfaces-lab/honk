#!/usr/bin/env node
// .design/lint.mjs — honk's deterministic design-system checker.
//
// The Vercel method (vercel.com/blog/teaching-agents-product-design-at-vercel) splits guidance
// into three layers: prose for judgment, exemplars for canon, and a LINTER for the rules a machine
// can enforce reliably. This file is that linter — the deterministic FLOOR under principles.md.
// It proves nothing about taste; it only catches the mechanical charter violations (the
// stylex / styling-tokens skills) so agents and humans get feedback while they type.
//
// Run:   node .design/lint.mjs        (zero deps, plain node; exit 1 on any violation)
//
// HONEST-MATCHER CONTRACT (read before trusting a green run):
//   • Line-based regex over a comment-STRIPPED copy of each file, plus a little state
//     ("inside-a-stylex-block" tracking) that is deliberately APPROXIMATE.
//   • Comments are stripped first on purpose: the doctrine files are full of prose like
//     "ZERO useEffect" and "not a hand-written style=" — matching those would be a false positive.
//   • The bias is FALSE-NEGATIVES over false-positives: when the cheap matcher can't be sure, it
//     stays quiet. A clean run is necessary, not sufficient — principles.md still owns judgment.
//   • Add a directory to DIRS to widen coverage (app-next is the rewrite client).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// ── Config (extend here) ─────────────────────────────────────────────────────────────────────
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["packages/ui/src", "packages/ui/dev", "packages/app-next/src"];
const EXTENSIONS = [".ts", ".tsx"];
// Generated or hand-authored token binding files are sanctioned homes for raw design values.
const TOKENS_FILE = "tokens.stylex.ts";
// no-raw-values whitelist — mirrored EXACTLY from the stylex skill ("Allowed literals at call
// sites"). None of these are hex or number+px/ms/rem, so the value detectors below never emit
// them anyway; the set is kept literal so the rule reads faithfully and extends cleanly.
const RAW_VALUE_WHITELIST = new Set(["0", "0s", "100%", "auto", "none", "transparent", "currentColor", "inherit"]);
// Package specifiers that must never be imported anywhere in packages/ui (StyleX-only charter).
const BANNED_IMPORT_BASES = ["zustand", "styled-components", "@emotion", "tailwindcss", "tailwind"];

// ── File discovery ───────────────────────────────────────────────────────────────────────────
function walk(absDir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return out; // a configured dir that doesn't exist yet is not an error
  }
  for (const name of entries) {
    if (name === "node_modules") continue;
    const abs = join(absDir, name);
    if (statSync(abs).isDirectory()) out = out.concat(walk(abs));
    else if (EXTENSIONS.some((ext) => name.endsWith(ext))) out.push(abs);
  }
  return out;
}

// ── Comment stripping ────────────────────────────────────────────────────────────────────────
// Replace every comment character with a space, preserving line count and column positions so
// finding line:col stays accurate. A tiny scanner that also tracks string literals, so a "//" or
// "/*" living inside a string never trips comment mode. Approximate by design (regex literals,
// template-expression nesting are not modeled) — errs toward blanking, i.e. false-negatives.
function stripComments(source) {
  let out = "";
  let quote = null; // active string delimiter: ' " ` or null
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLine) {
      if (ch === "\n") { inLine = false; out += ch; } else { out += " "; }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") { inBlock = false; out += "  "; i++; } else { out += ch === "\n" ? "\n" : " "; }
      continue;
    }
    if (quote) {
      out += ch;
      if (ch === "\\") { out += source[i + 1] ?? ""; i++; } // skip escaped char
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { inLine = true; out += "  "; i++; continue; }
    if (ch === "/" && next === "*") { inBlock = true; out += "  "; i++; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; out += ch; continue; }
    out += ch;
  }
  return out;
}

// ── "Inside a stylex style-object block" per line (approximate) ────────────────────────────────
// A value belongs to a "call site" only when it sits inside stylex.create / createTheme / keyframes.
// Track the paren opened by each such call and mark every line touched while that paren is open.
function computeInCreate(strippedLines) {
  const text = strippedLines.join("\n");
  const openParenIndex = new Set();
  for (const m of text.matchAll(/stylex\.(?:create|createTheme|keyframes)\s*\(/g)) {
    openParenIndex.add(m.index + m[0].length - 1); // index of the opening '('
  }
  const inCreate = new Array(strippedLines.length).fill(false);
  let paren = 0;
  const stack = []; // paren-depths at which a stylex block opened
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") { line++; continue; }
    if (ch === "(") {
      paren++;
      if (openParenIndex.has(i)) stack.push(paren);
    } else if (ch === ")") {
      if (stack.length && paren === stack[stack.length - 1]) stack.pop();
      paren--;
    }
    if (stack.length) inCreate[line] = true;
  }
  return inCreate;
}

// ── Rules ────────────────────────────────────────────────────────────────────────────────────
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const UNIT = /\b(\d*\.?\d+)(px|ms|rem)\b/g;

function lintFile(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  const isTokens = absPath.endsWith(TOKENS_FILE);
  const inSrc = rel.includes("packages/ui/src");
  const isNativeRenderer = /\.(?:native|ios|android)\.[tj]sx?$/.test(rel);
  const rawLines = readFileSync(absPath, "utf8").split("\n");
  const lines = stripComments(rawLines.join("\n")).split("\n");
  const inCreate = computeInCreate(lines);
  const found = [];
  const add = (i, col, code, message) => found.push({ rel, line: i + 1, col: col + 1, code, message });

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];

    // no-use-effect — effects are banned outright; state lives in external stores.
    for (const m of L.matchAll(/\buse(?:Layout)?Effect\b/g)) {
      add(i, m.index, "no-use-effect", "useEffect/useLayoutEffect are banned in packages/ui — external store + useSyncExternalStore, callback refs, or CSS.");
    }

    // no-cross-element — StyleX 0.19 has no ancestor/sibling selectors; compute cross-element in JS.
    for (const m of L.matchAll(/\bwhen\.(?:ancestor|descendant|sibling)\b|\b(?:defineMarker|defaultMarker)\b/g)) {
      add(i, m.index, "no-cross-element", "cross-element selectors (when.*/defineMarker) are unavailable here — parent-sets-a-var or JS-resolved styles (stylex skill §5).");
    }

    // no-container-queries — unverified on this StyleX pin; measure in JS instead.
    for (const m of L.matchAll(/@container\b/g)) {
      add(i, m.index, "no-container-queries", "@container is unverified on this StyleX pin — JS measurement via a callback-ref ResizeObserver.");
    }

    // no-banned-imports — StyleX-only; no rival styling/state systems anywhere in ui.
    for (const m of L.matchAll(/(?:from|import|require\s*\(?)\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      if (BANNED_IMPORT_BASES.some((b) => spec === b || spec.startsWith(`${b}/`))) {
        add(i, m.index, "no-banned-imports", `banned import "${spec}" — packages/ui is StyleX-only, no rival styling/state libraries.`);
      }
    }

    // no-classname-style — src elements style via {...stylex.props(...)}; xstyle carries overrides.
    // Lookbehind excludes xstyle (word char before) and data-*-style (hyphen before).
    if (inSrc && !isNativeRenderer) {
      for (const m of L.matchAll(/(?<![\w-])(className|style)\s*=/g)) {
        add(i, m.index, "no-classname-style", `literal ${m[1]}= attribute — style DOM elements with {...stylex.props(...)} and components with xstyle.`);
      }
    }

    // Rules scoped to stylex style-object call sites.
    if (inCreate[i]) {
      // no-border-shorthand — longhands only; "border: none" reset is allowed.
      const borderMatch = /\bborder\s*:/.exec(L);
      if (borderMatch && !/\bborder\s*:\s*["']?none/.test(L)) {
        add(i, borderMatch.index, "no-border-shorthand", "border shorthand — use borderWidth/borderStyle/borderColor longhands (stylex skill §4).");
      }

      // no-raw-values — hex/px/ms/rem literals belong ONLY in tokens.stylex.ts (values), never at
      // a call site. Named non-tokenized intrinsics (module consts with a justification comment)
      // live OUTSIDE these blocks and are referenced by name, so they are honestly not flagged.
      if (!isTokens) {
        for (const m of L.matchAll(HEX)) {
          if (!RAW_VALUE_WHITELIST.has(m[0])) {
            add(i, m.index, "no-raw-values", `raw color "${m[0]}" at a call site — reference a token from tokens.stylex.ts (styling-tokens skill).`);
          }
        }
        for (const m of L.matchAll(UNIT)) {
          if (RAW_VALUE_WHITELIST.has(m[0]) || Number(m[1]) === 0) continue; // 0/0s and 0-with-unit are fine
          add(i, m.index, "no-raw-values", `raw value "${m[0]}" at a call site — reference a token (or a justified named intrinsic const), never an inline literal (styling-tokens skill).`);
        }
      }
    }
  }
  return found;
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────
const files = DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
const findings = files.flatMap(lintFile).sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel.localeCompare(b.rel)));

if (findings.length === 0) {
  console.log(`.design lint: ${files.length} files, 0 violations.`);
  process.exit(0);
}
for (const f of findings) {
  console.log(`${f.rel}:${f.line}:${f.col}  ${f.code}  ${f.message}`);
}
console.log(`\n.design lint: ${findings.length} violation(s) across ${files.length} files.`);
process.exit(1);
