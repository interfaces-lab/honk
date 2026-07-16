# Agent Rules

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.
- In Effect generators, bind services to named variables before calling methods. Do not use nested service yields such as `yield* (yield* Foo.Service).bar()`.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json();

// Bad
const journalPath = path.join(dir, "journal.json");
const journal = await Bun.file(journalPath).json();
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a;
obj.b;

// Bad
const { a, b } = obj;
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2;

// Bad
let foo;
if (condition) foo = 1;
else foo = 2;
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1;
  return 2;
}

// Bad
function foo() {
  if (condition) return 1;
  else return 2;
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

## Icons

- Use `central-icons`; do not add Lucide.
- Import icons from `central-icons`.

## Design reference (`.design/`)

- Any design or UI work starts with `.agents/skills/design/SKILL.md`, then `.design/README.md`
  (principles, exemplars, and the deterministic check: `node .design/lint.mjs`).
- Decision hierarchy: `.agents/skills/design` (product judgment and platform routing) → `.agents/skills/stylex` + `.agents/skills/styling-tokens` (web authoring mechanics) → `packages/ui/src/theme.ts` for shared values and the generated `platform-tokens.stylex.ts` web binding, with `tokens.stylex.ts` retaining web-only values → `.design/principles.md` + `.design/exemplars.md` (Honk-specific judgment).
- Skills are first-party in `.agents/skills/` (`.claude/skills/*` are symlinks into it).
- All client UI follows `.design/`, the local skills, and the shared `packages/ui` component system.

## Releases

- Published versions for `@honk/app` and `@honk/desktop` stay in sync via the release bump workflow.
- Release automation lives in `.github/workflows/release.yml`.
- Inspect or prune GitHub releases/tags with `pnpm run release:manage list` and `pnpm run release:manage prune` (add `--apply` to delete; use `--keep-stable 1` to retain the newest stable tag).

## Composer command menu (`/` and `@`)

Both menus share `ComposerCommandMenuPositioned` in `packages/app/src/components/chat/composer/command-menu/menu.tsx` (anchor helper in `command-menu/anchor.ts`). Read that file before changing placement or sizing.

**Anchor (caret tracking)**

- The 1×1 span lives in `prompt-editor/index.tsx` (`data-composer-menu-anchor`), positioned from the live DOM selection caret rect inside the Lexical editor (not ProseMirror `coordsAtPos`).
- `input.tsx` passes a live virtual anchor via `composerMenuPopoverAnchorFromElement(() => composerMenuAnchorRef.current)` — do not cache anchor rects in React state.
- Bump `composerMenuAnchorRevision` when the anchor span's `style` changes (MutationObserver) or when async menu results change item count.

**Popover placement**

- Use `side="top"`, `align="start"`, `positionMethod="fixed"`, `instant`, and `COMPOSER_MENU_COLLISION_AVOIDANCE` (`shift` + `fallbackAxisSide: "none"`). Do not use default Base UI popover collision (`fallbackAxisSide: "end"`) — tall menus flip to a side axis and land off-screen.
- Do not remount the popover on anchor updates (`key={anchorRevision}` causes jitter). Parent re-renders from `anchorRevision` are enough.

**Path preview side panel**

- `command-menu/path-preview.tsx` renders a pierre-tree staircase for the active `@` path item as an absolutely positioned sibling of the menu shell inside the popup (the popup className includes `relative`). It must stay inside the `[data-composer-command-menu-root]` subtree (outside-pointer dismissal exemption) and carry `data-variant="surface"` (glass-mode CSS).
- The panel root keeps pointer-events auto with `onMouseDown` preventDefault (clicks must not blur the Lexical editor or fall through to UI behind it); the tree content is `pointer-events-none`. It must never take focus — keyboard stays in Lexical.
- Placement flips from `left-full` to `right-full` (class-set swap) when the viewport right edge lacks room, and hides when neither side fits; re-measure is driven by a MutationObserver on the positioner's `style` attribute.
