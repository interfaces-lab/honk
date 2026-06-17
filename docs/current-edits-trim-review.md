# Current edits trim review

Review date: 2026-06-17  
Source transcript: HonkKit Cursor parity session (design tokens, StyleX, browser/workbench tabs, no Cursor token naming)  
Diff scope: 103 files, ~4.6k insertions / ~1.5k deletions

Three parallel review passes were requested. All hit API limits before producing output. This document consolidates one manual pass across wrappers, jargon, and decision trace.

---

## Executive summary

The worktree mixes two unrelated efforts. The transcript is almost entirely UI and design parity. The diff also carries a large Pi runtime hardening stack (orchestration boundaries, ingestion HTTP, projection pipeline, archive lifecycle, git status atoms, thread sync). Split those before trimming or shipping.

Within the UI work, settings search is useful but was not in the transcript. It is well-shaped overall. The preference index file is long but declarative. A few duplicate exports and a seven-line route search parser can go.

Within the runtime work, the direction matches `docs/pi-runtime-hardening-implementation-plan.md`. The risk is layer count and naming noise, not wrong architecture. `ProjectionPipeline.ts` alone is ~1.6k changed lines. That file earns a dedicated read before any further extraction.

Functions that return functions are mostly legitimate here (ref-count watchers, Pi extension factories, React effect cleanups). The bad-signal pattern to watch is thin aliases and one-caller indirection, not lifecycle teardown.

---

## 1. Decision trace (transcript vs code)

| Transcript decision | Where it landed | Verdict |
|---|---|---|
| Full @anysphere design spec in HTML notes | `docs/cursor-agent-window-implementation-notes.html` (not in current diff stat; may be committed) | Keep if still accurate |
| Do not migrate HonkKit to StyleX for the app | App still Tailwind + HonkKit | Keep |
| StyleX OK for compile-time marketing site | `packages/marketing/src/styles/*.stylex.ts`, deleted `styles.css` | Keep. Scope is correct |
| No Cursor-related token naming | Marketing tokens use `honkTokens`, not `--cursor-*` | Keep |
| HonkKit Cursor parity tightening plan | Shell CSS, browser panel, appearance controls, workbench menus | Keep. Continue incrementally |
| Browser panel should match files `panel.tsx` pattern | `browser-panel.tsx` touched (+44 lines) | Keep direction. Not fully unified yet |
| Workbench tab stack spec (terminal, browser, DnD, call order) | Partial shell changes only | **Defer or finish**. Spec work in transcript; draggable multi-tab stack not evident in diff |
| Settings search with deep-link | New: `settings-preference-index.ts`, `settings-search-context.tsx`, nav-rail | **Trim or split PR**. Useful product surface, not in transcript |
| Pi runtime command boundary + ingestion | contracts, server, desktop, runtime packages | **Split PR**. Correct per hardening plan, unrelated to transcript |
| Archive lifecycle with visible cleanup failures | `archive-lifecycle.ts` | Keep in runtime PR |
| Git status debounce / atom family | `git-status-state.ts` | Keep in runtime PR if git UX was broken |

**Core transcript goal (plain language):** Make Honk look and feel closer to Cursor's agent window and workbench chrome, using Honk's own token names, without rewriting HonkKit in StyleX.

**Scope creep (safe to defer or split out):**

- Entire Pi runtime hardening stack (~60+ files outside marketing/shell/settings)
- Settings search (unless you want it in the same release)
- `docs/pi-runtime-hardening-implementation-plan.md` as implementation artifact (keep the doc; don't mix with parity PR)

---

## 2. Wrapper and abstraction audit

### Trim now (high)

| Location | Issue | Action |
|---|---|---|
| `settings-preference-index.ts` | `SETTINGS_PREFERENCE_ENTRIES_TYPED` is a typed alias of `SETTINGS_PREFERENCE_ENTRIES` | Delete alias. Export one const with `satisfies` and use it everywhere |
| `settings-preference-index.ts` | `SETTINGS_PREFERENCE_IDS` array + `SETTINGS_PREFERENCE_ID_SET` + `isSettingsPreferenceId` | Keep `isSettingsPreferenceId` only. Derive the set lazily inside it or drop exported ID list if unused outside tests |
| `-settings-route-search.ts` | Seven-line `parseSettingsRouteSearch` in its own file | Inline into `-settings-route.tsx` unless a second route imports it |
| `settings-search-context.tsx` | `useSettingsRowHighlight` is a two-line context read | Inline at the one or two call sites, or fold into `useSettingsSearch` return shape |

### Review before touching (medium)

| Location | Issue | Action |
|---|---|---|
| `thread-timeline-projector.ts` | `turnOccurrenceCounter()` returns `(turnId) => number` | **Keep.** Stateful closure during a single projection pass. Not a gratuitous factory |
| `git-status-state.ts` | `watchGitStatus` / `subscribeToGitStatusTarget` return teardown fns | **Keep.** Ref-count + resubscribe on client identity change is real logic |
| `chat-view-lifecycle-sync.tsx` | Five helpers that return effect cleanups (`acquireRuntimeThreadFocus`, `scheduleRuntimeHydrationAfterFirstPaint`, etc.) | Consider one module-level `FocusLease` type instead of scattered registry helpers. Do not inline cleanups into components |
| `runtime-ingestion-http.ts` | `runtimeRecordToCommand` switch | **Keep.** Boundary adapter belongs here |
| `archive-lifecycle.ts` | `appendCleanupFailureActivity` | **Keep.** One archive flow, one file |
| Pi extensions (`thread-agent-runtime.ts`, `subagent-extension.ts`) | `return (pi) => { ... }` | **Keep.** Pi extension API shape |

### Do not trim (low / false positives)

- React `useEffect` / `useMountEffect` cleanup returns
- `useCallback` wrappers in event handlers
- Test mocks returning teardown functions

### Top 5 trims (ordered)

1. **Split the PR.** Parity UI vs Pi runtime hardening. Biggest win for reviewability.
2. **Collapse settings preference exports** (alias + redundant ID exports).
3. **Inline `-settings-route-search.ts`** if single consumer.
4. **Finish or drop workbench tab stack spec.** Transcript spent many turns on draggable tab order. Diff does not show that implementation. Either cut the spec doc churn or land a minimal vertical slice.
5. **`ProjectionPipeline.ts` pass.** Before adding helpers, read the diff holistically. A 1.6k-line churn file often hides duplicate projection paths that can merge.

---

## 3. Jargon and naming audit

### Glossary (consider simplifying in new code only)

| Current | Plain alternative | Notes |
|---|---|---|
| Runtime ingestion | Runtime write path / runtime persist | "Ingestion" is accurate at the HTTP boundary; avoid repeating in UI copy |
| Projection pipeline | Thread state builder | Internal server name can stay if team knows it; don't leak to settings |
| Display timeline projection | Chat timeline builder | Runtime package name; OK if bounded to runtime |
| Orchestration dispatch | Command dispatch | Already domain term in Honk; keep in server/contracts |
| Materialization (timeline) | Build timeline entries | Used in projector comments; prefer "build" in new comments |
| Hydration (runtime) | Load runtime state | Fine internally; reads as React hydration to newcomers |
| Pi runtime (settings section) | Agents / Model defaults | User-facing label in preference index. "Pi runtime" is insider jargon |

### File-level notes

- **`settings-preference-index.ts`**: Section title `"Pi runtime"` for agent mode settings. Rename to `"Agents"` or `"Model"` in user-facing strings.
- **`runtime-turn-dispatch.ts` / `turn-send-coordinator`**: Names match existing Honk vocabulary. No rename unless you rename the feature everywhere.
- **`desktop-observability.ts`**: "Observability" is standard for tracing. Keep.
- **Marketing StyleX tokens**: `honkTokens`, `bgQuinary`, etc. Match HonkKit ladder. Good. No Cursor naming leak found.

### User-facing strings to soften

- "Default reasoning depth for new Pi sessions in this agent mode" → "Reasoning depth for new chats in this mode"
- "Adjust how much detail is shown for tool calls" → already plain. Keep.

---

## 4. Recommended phased trim plan

### Phase 1 (safe, no behavior change)

- Remove `SETTINGS_PREFERENCE_ENTRIES_TYPED` duplicate export
- Trim unused `SETTINGS_PREFERENCE_IDS` export if only tests use it
- Inline `parseSettingsRouteSearch` if single route consumer
- Rename settings section `"Pi runtime"` → `"Agents"` in preference index labels only

### Phase 2 (structural, split PRs)

- **PR A:** Marketing StyleX + shell/browser/appearance parity (transcript-aligned)
- **PR B:** Settings search (product surface, optional)
- **PR C:** Pi runtime hardening per implementation plan (orchestration boundary, ingestion, archive, projection, git status)

### Phase 3 (only if continuing parity transcript)

- Unify `browser-panel.tsx` with `files/panel.tsx` shell pattern (transcript explicitly asked)
- Implement or delete workbench multi-tab / DnD spec from transcript
- Re-read `ProjectionPipeline.ts` for duplicate projection paths after split

---

## 5. What looks fine (do not trim)

- **`settings-search-results.tsx`**: Small presentational component. No wrapper smell.
- **`settings-search-context.tsx` focus/retry loop**: Retry scroll until DOM mount is real UX. Keep `SettingsPreferenceFocusSync`.
- **`archive-lifecycle.ts`**: Focused module extracted from engine. Good boundary.
- **`orchestration-command-boundary.test.ts`**: Tests match P0.1 acceptance. Keep.
- **Marketing StyleX migration**: Scoped to marketing package. Matches transcript conclusion.
- **`turnOccurrenceCounter`**: Correct pattern for stable turn indices during ordered walk.

---

## 6. Open questions for you

1. Should settings search ship with parity UI or as its own PR?
2. Is Pi runtime hardening intentionally in this branch, or accidental worktree mixing?
3. Workbench draggable tab stack: still in scope, or defer until browser panel unification lands?

---

## Appendix: subagent status

| Pass | Agent | Status |
|---|---|---|
| Wrappers | [Wrapper/abstraction trim audit](28f42167-edab-4fcd-9aa7-4b54e99deda0) | Failed (API limit). No artifact |
| Jargon | [Jargon and naming audit](7a7000b9-1184-42e4-bf95-d99101393cd3) | Failed (API limit). No artifact |
| Decisions | [Transcript vs code decisions](09aab020-3e7e-4dc0-91d3-bc95f28442ce) | Failed (API limit). No artifact |

This document replaces the three planned `docs/trim-review-*.md` files.
