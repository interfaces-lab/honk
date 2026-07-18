# Agent Rules

## Development servers

- Never start this repository's persistent development stack. Do not run `pnpm dev`, `pnpm run dev`, `pnpm dev:*`, `pnpm --filter ... dev`, `pnpm start:desktop`, or equivalent long-running app/server commands unless the user explicitly asks for that exact action.
- The user owns development-process lifecycle. Reuse the running app for inspection and QA; if it is absent or stale, ask the user to start or restart it instead of launching another instance.
- Use bounded commands such as targeted tests, typechecks, lints, and builds for verification. Do not turn a persistent process into a background, `tmux`, or detached workaround.

## Backend / OpenCode requests

- Do not make ad-hoc HTTP requests to the OpenCode sidecar, Honk host, or retired Core `/core/v1` APIs (`curl`, shell `fetch`, browser evaluate/fetch, pairing via `~/.honk/core/core-app-secret`) unless the user explicitly asks for that exact action.
- Inspect the running local app UI for QA. If it is absent or stale, ask the user to start or restart it — do not start servers (see Development servers).
- Client code must use `@honk/opencode` / `sdk.v2` only. Do not restore Core v1, compat facades, or call capability-gated ops (`OPEN_CODE_SESSION_CAPABILITIES` / `APP_HOST_CAPABILITIES`) through unsupported endpoints.
- Stale docs that still mention `/core/v1` or `packages/core` are historical. The live boundary is documented in `docs/opencode-shell.md` and enforced by `packages/opencode/scripts/check-protocol-boundary.mjs`.

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

## Product design

- Load `.agents/skills/product-design/SKILL.md` before any user-visible work: shaping or changing UI,
  interaction, copy, accessibility, responsive behavior, or loading/empty/error/permission/destructive
  states, and when reviewing screenshots or user-facing diffs.
- Skip it for backend-only, build/tooling-only, generated-file-only, and behavior-preserving internal
  refactors with no user-visible consequence. If scope becomes user-visible, load it then.
- The skill routes product judgment and focused surface references. Route web authoring mechanics to
  `.agents/skills/stylex` and `.agents/skills/styling-tokens`; shared values remain owned by
  `packages/ui/src/theme.ts`, generated `platform-tokens.stylex.ts`, and web-only `tokens.stylex.ts`.
- Run `pnpm run lint:design` for the deterministic design floor. Rules and coverage gaps live under
  `.agents/skills/product-design/references/`; shipped evidence lives under its `exemplars/` directory.
- Skills are first-party in `.agents/skills/` (`.claude/skills/*` are symlinks into it).

## Releases

- Published versions for `@honk/app` and `@honk/desktop` stay in sync via the release bump workflow.
- Release automation lives in `.github/workflows/release.yml`.
- Inspect or prune GitHub releases/tags with `pnpm run release:manage list` and `pnpm run release:manage prune` (add `--apply` to delete; use `--keep-stable 1` to retain the newest stable tag).

## Command menus

- The global search-and-act engine lives in `packages/app/src/command-menu.tsx`, with ranking in
  `command-menu-model.ts` and durable state in `command-menu-store.ts`. Home, Command-K, and Command-O
  are doors into that engine; do not create a parallel global picker.
- Composer `/` commands and `@` file suggestions are a separate focused composite implemented together
  in `packages/app/src/composer/prompt-editor.tsx`. Keep keyboard focus in Lexical, preserve the shared
  trigger/selection path, and do not split the two suggestions into independent menu implementations.
