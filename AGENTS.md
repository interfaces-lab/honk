# Development Rules

## Style

- Keep answers short, technical, and direct.
- No emojis in commits, issues, PR comments, or code.
- No fluff or cheerful filler.

## Code

- Read the relevant files before editing. Do not rely on search snippets for broad changes.
- No `any` types unless there is no better option.
- Check installed dependency types instead of guessing external APIs.
- No inline imports: no `await import("./x")`, no `import("pkg").Type`, no dynamic type imports. Use top-level imports.
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
- Before committing, inspect `git status` and stage explicit paths only.
- If rebasing conflicts in files you did not edit, abort and ask.

## Releases

- Published versions for `usemulti`, `@multi/app`, `@multi/desktop`, and `@multi/contracts` stay in sync via `scripts/update-release-package-versions.ts`.
- Release automation lives in `.github/workflows/release.yml`.
