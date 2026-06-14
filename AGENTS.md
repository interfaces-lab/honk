# Agent Rules

## Product Direction

- Product surface first: durable backend concepts need a clear, loved UI surface.
- Opinionated by default: keep the good parts close and delete surfaces we do not use and love.
- Less is better: fewer panels, fewer modes, fewer contracts, and sharper orchestration.

## Style

- Keep answers short, technical, and direct.
- No emojis in commits, issues, PR comments, or code.
- No fluff or cheerful filler.

## Code

- Read the relevant files before editing. Do not rely on search snippets for broad changes.
- When writing Effect code, read `docs/effect-llms.md` first (idiomatic guide: `Effect.gen`/`Effect.fn`, `Context.Service`, errors, `Scope`, `Stream`).
- No `any` types unless there is no better option.
- Check installed dependency types instead of guessing external APIs.
- Use top-level imports. Do not use inline imports such as `await import("./x")`, `import("pkg").Type`, or dynamic type imports.
- Do not remove or downgrade functionality to satisfy type errors. Fix the cause or ask.
- Do not preserve backward compatibility unless the user asks for it.
- Ask before removing intentional-looking behavior or large code paths.
- Keybindings must be configurable. Do not hardcode checks like `matchesKey(keyData, "ctrl+x")`; add defaults to the relevant keybinding map.
- Keep Tailwind utilities on elements or in `cva` variants. Do not create decorative `*ClassName` / `*_CLASSNAME` buckets unless needed as a real CSS/test selector.
- For shared UI styling, prefer a small component when callers need markup composition, or a `cva` recipe when callers need conditional/reusable class composition. Inline one-off static classes at the element.

## Icons

- Use `central-icons`; do not add Lucide.
- Browse available icons in `node_modules/central-icons/icons-index.json`.
- Import icons from `central-icons`.

## HonkKit (design system)

- **HonkKit** is Honk's design system. Primitives live in `@honk/honkkit/*`; tokens in `@honk/honkkit/styles.css` and app Tailwind theme exports in `packages/app/src/index.css`.
- Browse and tweak components in dev at `/dev/honkkit` (Cmd+K → "Open HonkKit"). DialKit panel adjusts the active preview.
- Prefer existing HonkKit primitives over one-off markup. Product UI mostly uses typography utilities (`text-body`, `text-detail`, `text-caption`) on native elements; `<Text>` from `@honk/honkkit/text` is for settings and structured copy.
- Stack: Base UI headless + CVA variants + Tailwind v4. Icons: `central-icons` only.
- `cn()` / `tailwind-merge` must treat `text-honk-*` size utilities separately from `text-honk-fg-*` color utilities (see `packages/honkkit/src/utils.ts`).

## Commands

- Do not upgrade Bun past `1.3.14`; this repository pins `bun` and `@types/bun` there because it is the latest Bun tag that still uses the Zig binary.
- For code changes, prefer `pnpm run typecheck` as the verifier. Get full output.
- Do not use tests as the verifier unless the task is creating, modifying, or debugging tests.
- If you create or modify a test, run that specific test from its package root and iterate until it passes.
- Never run `pnpm run dev`, `pnpm run build`, or broad test commands unless the user asks.
- Never commit unless the user asks.

## Git

- Multiple agents may share this worktree. Do not touch unrelated changes.
- Only stage files you changed in this session.
- Never use `git add -A` or `git add .`.
- Never use destructive commands: `git reset --hard`, `git checkout .`, `git clean -fd`, or `git stash`.
- Before committing, inspect `git status` and stage explicit paths.
- If rebasing conflicts in files you did not edit, abort and ask.

## Releases

- Published versions for `usehonk`, `@honk/app`, `@honk/desktop`, and `@honk/contracts` stay in sync via `scripts/update-release-package-versions.ts`.
- Release automation lives in `.github/workflows/release.yml`.

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

## Browser Automation

Use agent-browser for web automation. Run agent-browser --help for all commands.

Core workflow:

agent-browser open <url> - Navigate to page
agent-browser snapshot -i - Get interactive elements with refs (@e1, @e2)
agent-browser click @e1 / fill @e2 "text" - Interact using refs
Re-snapshot after page changes
