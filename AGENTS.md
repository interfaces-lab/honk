# Agent Rules

## Style

- Keep answers short, technical, and direct.
- No emojis in commits, issues, PR comments, or code.
- No fluff or cheerful filler.
- Write comments like the reader is new to the codebase but familiar with the goal of the project
## Code

- Read the relevant files before editing. Do not rely on search snippets for broad changes.
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
- Import icons from `central-icons`.

## Design reference (`.design/`)

- Any design or UI work starts at `.design/README.md` — the agent-facing design system (principles, exemplars, deterministic checks: `node .design/lint.mjs`).
- Cross-platform `@honk/ui` work must also read `packages/ui/AGENTS.md` and use `.agents/skills/honk-ui`; one logical component API serves web and native through platform-resolved implementations.
- Decision hierarchy: `.agents/skills/honk-ui` (platform routing) → `.agents/skills/stylex` + `.agents/skills/styling-tokens` (web authoring mechanics) → `packages/ui/src/theme.ts` for shared values and the generated `platform-tokens.stylex.ts` web binding, with `tokens.stylex.ts` retaining web-only values → `.design/principles.md` + `.design/exemplars.md` (product judgment).
- Skills are first-party in `.agents/skills/` (`.claude/skills/*` are symlinks into it).
- The HonkKit rules below apply to the old app (`packages/app` + `packages/honkkit`). The rewrite (`packages/ui`) follows `.design/` and the skills instead.

## HonkKit (design system)

- **HonkKit** is Honk's design system. Primitives live in `@honk/honkkit/`\*; tokens in `@honk/honkkit/styles.css` and app Tailwind theme exports in `packages/app/src/index.css`.
- Browse and tweak components in dev at `/dev/honkkit` (Cmd+K → "Open HonkKit"). DialKit panel adjusts the active preview.
- Prefer existing HonkKit primitives over one-off markup. Product UI mostly uses typography utilities (`text-body`, `text-detail`, `text-caption`) on native elements; `<Text>` from `@honk/honkkit/text` is for settings and structured copy.
- Stack: Base UI headless + CVA variants + Tailwind v4. Icons: `central-icons` only.
- `cn()` / `tailwind-merge` must treat `text-honk-*` size utilities separately from `text-honk-fg-*` color utilities (see `packages/honkkit/src/utils.ts`).

## Commands

- For code changes, prefer `pnpm run typecheck` as the verifier. Get full output.
- Do not use tests as the verifier unless the task is creating, modifying, or debugging tests.
- If you create or modify a test, run that specific test from its package root and iterate until it passes.
- Never run `pnpm run dev`, `pnpm run build`, or broad test commands unless the user asks.
- Never commit unless the user asks.

## Git

- Commit message format: `{feat,fix,refactor,docs,test,chore,ci}[(app,desktop,runtime,server,contracts,honkkit)]: concise summary`. Use the primary affected package as scope; keep the subject informative and one line. No `Co-authored-by` trailers unless the user asks.

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
