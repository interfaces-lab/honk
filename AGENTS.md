# Development Rules

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Code Quality

- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Do not preserve backward compatibility unless the user explicitly asks for it
- Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)
- **Tailwind `className`**: No decorative kebab-case labels or constants (including `AGENT_*_CLASSNAME`) used only as utility buckets unless the string is a required CSS or test selector; put Tailwind on the element or use `cva` (`class-variance-authority`) for variants and conditionals.

t## Icons

UI icons use **Central Icons** (`central-icons`, resolved to `@central-icons-react/round-outlined-radius-2-stroke-1.5`). Do not add Lucide or import from `lucide-react`.

**Browse names and categories:** open `node_modules/central-icons/icons-index.json` after install (lists every export under `categories` plus metadata). **Types:** `node_modules/central-icons/index.d.ts` exports all `Icon*` components. **Usage:** `import { IconName } from "central-icons"` (or `import type { CentralIconBaseProps } from "central-icons"`). Product site: [iconists.co/central](https://iconists.co/central).

## Commands

- After code changes (not documentation changes): `bun run typecheck` (get full output, no tail). Fix all errors, warnings, and infos before committing.
- Note: `bun run typecheck` does not run tests.
- NEVER run: `bun run dev`, `bun run build`, `bun run test`
- Only run specific tests if user instructs: `bunx vitest --run test/specific.test.ts`
- Run tests from the package root, not the repo root.
- If you create or modify a test file, you MUST run that test file and iterate until it passes.
- When writing tests, run them, identify issues in either the test or implementation, and iterate until fixed.
- NEVER commit unless user asks

Multiple agents may work on different files in the same worktree simultaneously. You MUST follow these rules:

### Committing

- **ONLY commit files YOU changed in THIS session**
- ALWAYS include `fixes #<number>` or `closes #<number>` in the commit message when there is a related issue or PR
- NEVER use `git add -A` or `git add .` - these sweep up changes from other agents
- ALWAYS use `git add <specific-file-paths>` listing only files you modified
- Before committing, run `git status` and verify you are only staging YOUR files
- Track which files you created/modified/deleted during the session

### Forbidden Git Operations

These commands can destroy other agents' work:

- `git reset --hard` - destroys uncommitted changes
- `git checkout .` - destroys uncommitted changes
- `git clean -fd` - deletes untracked files
- `git stash` - stashes ALL changes including other agents' work
- `git add -A` / `git add .` - stages other agents' uncommitted work
- `git commit --no-verify` - bypasses required checks and is never allowed

### Safe Workflow

```bash
# 1. Check status first
git status

# 2. Add ONLY your specific files
git add packages/ai/src/providers/transform-messages.ts
git add packages/ai/CHANGELOG.md

# 3. Commit
git commit -m "fix(ai): description"

# 4. Push (pull --rebase if needed, but NEVER reset/checkout)
git pull --rebase && git push
```

### If Rebase Conflicts Occur

- Resolve conflicts in YOUR files only
- If conflict is in a file you didn't modify, abort and ask the user
- NEVER force push

### User override

If the user instructions co
nflict with rules set out here, ask for confirmation that they want to override the rules. Only then execute their instructions.

## Docs

- Codex App Server docs: [https://developers.openai.com/codex/sdk/#app-server](https://developers.openai.com/codex/sdk/#app-server)
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): [https://github.com/Dimillian/CodexMonitor](https://github.com/Dimillian/CodexMonitor)
