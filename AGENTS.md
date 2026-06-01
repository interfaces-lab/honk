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
- No `any` types unless there is no better option.
- Check installed dependency types instead of guessing external APIs.
- Use top-level imports. Do not use inline imports such as `await import("./x")`, `import("pkg").Type`, or dynamic type imports.
- Do not remove or downgrade functionality to satisfy type errors. Fix the cause or ask.
- Do not preserve backward compatibility unless the user asks for it.
- Ask before removing intentional-looking behavior or large code paths.
- Keybindings must be configurable. Do not hardcode checks like `matchesKey(keyData, "ctrl+x")`; add defaults to the relevant keybinding map.
- Keep Tailwind utilities on elements or in `cva` variants. Do not create decorative `*_CLASSNAME` buckets unless needed as a real CSS/test selector.

## Icons

- Use `central-icons`; do not add Lucide.
- Browse available icons in `node_modules/central-icons/icons-index.json`.
- Import icons from `central-icons`.

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

- Published versions for `usemulti`, `@multi/app`, `@multi/desktop`, and `@multi/contracts` stay in sync via `scripts/update-release-package-versions.ts`.
- Release automation lives in `.github/workflows/release.yml`.

## Composer command menu (`/` and `@`)

Both menus share `ComposerCommandMenuPositioned` in `packages/app/src/components/chat/composer/slash-menu.tsx`. Read that file before changing placement or sizing.

**Anchor (caret tracking)**

- The 1×1 span lives in `prompt-editor.tsx` (`data-composer-menu-anchor`), positioned from `coordsAtPos(selection.from)` with `coords.top` for `side="top"`.
- `input.tsx` passes a live virtual anchor via `composerMenuPopoverAnchorFromElement(() => composerMenuAnchorRef.current)` — do not cache anchor rects in React state.
- Bump `composerMenuAnchorRevision` when the anchor span's `style` changes (MutationObserver) or when async menu results change item count.

**Popover placement**

- Use `side="top"`, `align="start"`, `positionMethod="fixed"`, `instant`, and `COMPOSER_MENU_COLLISION_AVOIDANCE` (`shift` + `fallbackAxisSide: "none"`). Do not use default Base UI popover collision (`fallbackAxisSide: "end"`) — tall menus flip to a side axis and land off-screen.
- Do not remount the popover on anchor updates (`key={anchorRevision}` causes jitter). Parent re-renders from `anchorRevision` are enough.
