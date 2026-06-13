# Normalize Once

**Goal**: every normalization concern in honk has exactly one definition, applied at the value's entry boundary (schema decode, service entry, or store write). Downstream code never re-normalizes — the type or the data flow carries the proof. The net diff of this work must be negative: this is a deletion task, not an abstraction task.

**The principle** (from the pi study, `pi-codebase-patterns.md` §4): defensive re-normalization exists only when nothing proves normalization already happened. Provide the proof once — a branded type whose decode _is_ the normalization, or a single producer that owns the boundary — then delete every later re-application. Verb taxonomy: `normalize*` canonicalizes form, `clamp*` snaps to a range, `resolve*` picks from a source chain. One function per concern, named for its job.

Line numbers below are from June 2026 (`bigrefactor` branch, pre-rename survey). **Verify each site before editing; do not trust the numbers.**

---

## Inventory

### Entry 1 — Project root / cwd (server)

- **Canonical owner**: `ProjectPaths.normalizeProjectRoot` — `packages/server/src/project/ProjectPaths.ts:31`.
- **Duplicates to delete**:
  - `packages/server/src/project/ProjectEntries.ts:404` — local `normalizeProjectRoot` that calls the service and remaps the error to stamp `operation: "projectEntries.normalizeProjectRoot"`.
  - `packages/server/src/project/ProjectFileSystem.ts:27` — same wrapper, `operation: "projectFileSystem.normalizeProjectRoot"`.
  - ~10 `normalizedCwd` re-derivations across service methods (`ProjectEntries.ts:467,519,555`, `ProjectFileSystem.ts:47,132`, …).
- **Why it must not be normalized again**: commands entering through ws dispatch are _already_ normalized at the dispatch boundary (`orchestration/Normalizer.ts` calls `ProjectPaths` during `normalizeDispatchCommand`) — services re-normalizing per method is repeated work on every request. The wrappers' only payload is error attribution, which `Effect.fn("ProjectEntries.normalizeProjectRoot")` spans already record; attribution-by-error-remap pays twice for the same information.
- **Change**: call `projectPaths.normalizeProjectRoot` directly where a raw path genuinely enters (and only there); delete the wrappers. Where the same request value is normalized at dispatch _and_ again in a service, keep only the dispatch-boundary call and pass the normalized value through.

### Entry 2 — Thread key (app)

- **Canonical owner**: `normalizeThreadKey` — `packages/app/src/stores/chat-send-queue.ts:54` (trim, empty→null).
- **Duplicates to delete**: ~12 `normalizedThreadKey` re-derivations within the same file/store paths.
- **Why it must not be normalized again**: thread keys enter the send queue from a small set of producers; once normalized at enqueue, every internal consumer holds an already-canonical key. The re-calls exist only because the parameter type is raw `string`.
- **Change**: normalize once at each public entry point of the store (enqueue/lookup APIs); internal functions take the already-normalized key and do not re-call. A type alias or brand is optional — do **not** introduce a brand if deleting the re-calls plus a parameter rename (`threadKey` → `normalizedThreadKey`) is sufficient.

### Entry 3 — Search text (app vs shared)

- **Canonical owner**: `normalizeSearchQuery` — `packages/shared/src/search-ranking.ts` (its ranking function already documents "expects pre-normalized inputs").
- **Duplicates to delete**:
  - `packages/app/src/components/command-palette-model.ts:50` — `normalizeSearchText` (`trim().toLowerCase().replace(/\s+/g, " ")`).
  - Inline `query.trim().toLowerCase()` in `honkkit-gallery.tsx:29`, `project-files-panel.tsx:63`, `workspace-toolbar.tsx:179–181`.
- **Why it must not be normalized again**: there is already a single shared home with documented pre-normalization contract; the app-side copies drifted (whitespace-collapse exists only in the app copy). Two near-equal canonicalizers guarantee eventual mismatch between what's ranked and what's displayed.
- **Change**: reconcile the two behaviors into the `shared` function (decide once whether whitespace-collapse is part of the contract), import it everywhere, delete the app copy and the inline trims. Normalize where the query state is _set_, not where it is consumed.

### Entry 4 — Filesystem path canonicalization (app + server fragments)

- **Fragments (each currently its own rule-set)**:
  - `normalizeTreePath` — `packages/app/src/components/tree.tsx:155`.
  - `canonicalizeWindowsDrivePath` — `packages/app/src/components/chat/shared/file-path-display.ts` (drive-letter casing), plus a separate Windows-drive regex in `chat/markdown/file-links.ts:63`.
  - Home-tilde handling in `shell/agents/sidebar/view-model.ts:32,42`; tilde expansion server-side in `packages/server/src/path-expansion.ts`.
  - Inline slash-normalization `path.replace(...)` in `browser-workbench-panel.tsx:70`, `chat-markdown.tsx:655`, `command-palette.tsx:110–111`.
  - `normalizeCwd` — `packages/server/src/git/GitStatusBroadcaster.ts`. (`normalizeWorktreePath` in `app/src/git/worktree-cleanup.ts` was initially listed here but is a non-entry: trim-or-null on an optional string, single definition, not a path-canonicalization concern.)
- **Why it must not be normalized again**: these are 3 distinct concerns (separator/segment canonicalization, Windows drive-letter casing, home-dir display contraction) implemented ~9 times with slight drift. Display paths are derived data: derive once where server data enters the app (store/view-model boundary), not per component render.
- **Change**: one `packages/shared/src/paths.ts` exposing the three named concerns (e.g. `normalizePathSeparators`, `canonicalizeWindowsDrive`, `contractHomeDir`); replace all fragments with imports. Server keeps `path-expansion.ts` (tilde _expansion_ is a server concern; display _contraction_ is a client concern — do not merge those two).

### Entry 5 — Misnamed clamps (rename only, no consolidation)

- `normalizeUsagePercentage` — `context-window-ring.tsx:28` → `clampUsagePercentage`.
- `normalizeToastHeight` — `app/toast.tsx:88` → `clampToastHeight`.
- `chat-loader.tsx:303–307` locals (`positiveNumber`/`nonNegativeNumber` patterns) — fine as-is; rename only if touched.
- **Why**: these snap numbers into ranges; calling them `normalize*` is how "normalize" became the junk-drawer verb. Single definitions each — nothing to consolidate, just name by job.

### Non-entries (verified single-definition; leave alone)

`normalizeThinkingLevel`, `normalizePlanMarkdownForExport`, `normalizePlanEditorMarkdown`, `normalizeBrowserNavigationInput`, `normalizeMarkdownLinkHrefKey`, `normalizeRuntimeSubagentThreadState` — one definition each, callers share it correctly. Do not touch as part of this task.

---

## Execution constraints

- Subtract before add: no new abstraction layers; `shared/paths.ts` is the only new file permitted.
- No behavior changes. Where two duplicate implementations _differ_ (Entry 3 whitespace-collapse), surface the difference and pick one explicitly in the diff description.
- Verifier: `pnpm run typecheck` (full output), per `AGENTS.md`. Do not run dev/build/broad tests. If a touched file has an existing co-located test, run that one test.
- Brands: only consider a `Schema.transform` brand where a value crosses the wire through `contracts` (Entry 1's project root is the candidate); skip brands for app-local strings.
- Respect multi-agent worktree rules in `AGENTS.md`: touch only files this task requires; never commit.
