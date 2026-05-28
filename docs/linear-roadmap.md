# Multi — Linear roadmap (interface-lab)

Use this when setting up the **interface-lab** Linear workspace. The Cursor Linear plugin must be authenticated to `linear.app/interface-lab` (not `good-nyte`).

**Repo:** https://github.com/interfaces-lab/multi  
**North star:** Branchable agent chat (`/tree`), git worktrees, Cursor-like composer timeline.

---

## Project

| Field | Value |
|-------|--------|
| **Name** | Multi |
| **Summary** | Local-first desktop agent workbench — multi-provider, git-native, branchable chat. |
| **Lead** | You |
| **Status** | In Progress |

### Description (paste into Linear project)

Desktop app around a local server: agent runs, approvals, and live updates over WebSockets. Electron wraps a local UI. Providers: Codex, Claude, OpenCode, Cursor.

Launch direction: fork chat → **branch conversations in chat** (`/tree`), git-aware worktrees, composer timeline parity with Cursor.

Implementation plan for composer: `composer-chat-document-fix.md` in repo.

---

## Milestones

| ID | Name | Theme |
|----|------|--------|
| M0 | **Now** | Ship-stoppers, git/draft UX |
| M1 | **Composer P0** | Work groups, subagent tray, runtime coalescing |
| M2 | **Composer P1–P2** | Work-log derivation, shell rows, motion |
| M3 | **Git & worktrees** | Branch toolbar, worktree lifecycle |
| M4 | **Thread tree** | Fork/branch UI, tree panel |
| M5 | **Rich text & plans** | Lexical, human bubbles, in-chat plans |
| M6 | **Platform** | Desktop, releases, providers |

---

## Epics → issues

### M0 — Now

| Type | Title | Notes |
|------|--------|--------|
| **Issue** | Fix chat view when remote branch is deleted | `branch-toolbar.tsx`, `chat-view.tsx`, `branch-selection.ts`. Unavailable label, picker copy, block worktree send until valid branch. |
| Issue | Composer `/` and `@` menu anchor stability | `prompt-editor.tsx`, `slash-menu.tsx` — caret anchor, no popover jitter. |
| Issue | Subagent preview tray restored on collapse | Dim mask, focus store; no 2.5s poll as primary path (see M1). |

### M1 — Composer P0

| Type | Title | Acceptance |
|------|--------|------------|
| Epic | Composer timeline — P0 | Parent for P0-A…F |
| Issue | P0-A: Expanded work groups show all steps while running | Expand "Working · N steps" → N rows, not preview-only |
| Issue | P0-B: Durable subagent focus across composer collapse | `subagentFocus` store; same selection after expand |
| Issue | P0-C: Virtualize subagent tray scroll | 100+ steps scroll smoothly |
| Issue | P0-D: Subagent transcript from `subagent.*` activities | Coalesce deltas; snapshot poll reconcile-only |
| Issue | P0-E: Single `isCommandWorkEntry` helper | Export from `timeline-rows.ts`, remove duplicate |
| Issue | P0-F: Extract `coalesceOrchestrationUiEvents` + microbatch | `service.ts` &lt;1000 lines; ≤1 commit/frame on bursts |

### M2 — Composer P1–P2

| Type | Title | Acceptance |
|------|--------|------------|
| Epic | Composer timeline — P1–P2 | |
| Issue | P1: Work-log derivation from `OrchestrationThreadActivity` | Stable `itemId` collapse, `tool.summary`, less noise |
| Issue | P2: Shell/task labels + output preview | "Running command" / "Ran command" |
| Issue | P2-M: Chat motion + reduced-motion | Motion tokens; no shimmer when reduced motion |
| Issue | P3: Extra timeline rows (local activities only) | No Cursor cloud-only row kinds |
| Issue | P5: Tool spacing / CSS token audit | `tool-call.css`, `conversation.css` |

### M3 — Git & worktrees

| Type | Title | Notes |
|------|--------|--------|
| Epic | Git & worktree UX | |
| Issue | Branch picker: active draft session only | Regression: stale drafts unchanged |
| Issue | New worktree on send: base branch required | Clear error when missing |
| Issue | Checkout PR from branch search | `parsePullRequestReference` |
| Issue | Worktree draft cwd + project scripts | `chat-view.browser` harness patterns |
| Issue | Orphaned worktree cleanup on thread delete | `worktree-cleanup` |

### M4 — Thread tree

| Type | Title | Notes |
|------|--------|--------|
| Epic | Thread tree & fork chat | Launch: "/tree on the chat" |
| Issue | Thread tree panel: navigate branch entries | `thread-tree-panel.tsx`, `deriveThreadBranchView` |
| Issue | `/tree` composer command | Slash menu integration |
| Issue | Branch summary rows in timeline | `branch-summary` entry kind |
| Issue | `thread.tree-navigated` / label UX | `thread-sync.ts` events |

### M5 — Rich text & plans

| Type | Title | Acceptance |
|------|--------|------------|
| Epic | Rich text & plans | |
| Issue | P4-A: Lexical composer + `richText` on send | Persist text + richText |
| Issue | P4-B: Readonly human bubbles (TipTap + Lexical) | Cursor-exported content renders |
| Issue | P4-C: Editable in-chat plan body | `proposed-plan-message.tsx` |
| Issue | Migration: projection `richText` column | `028_ProjectionThreadMessageRichText` |

### M6 — Platform

| Type | Title | Notes |
|------|--------|--------|
| Epic | Platform & quality | |
| Issue | Provider adapters: Codex, Claude, OpenCode, Cursor | Settings + auth flows |
| Issue | Runtime modes: full / auto-accept / supervised | `specs/runtime-permissions.md` |
| Issue | Desktop release pipeline | `.github/workflows/release.yml` |
| Issue | Orchestration ingestion contract tests | `ProviderRuntimeIngestion`, decider tests |

---

## Suggested start order

1. **M0** — Remote branch deleted (first ship fix)
2. **M1 P0-A, P0-B, P0-D** — Visible composer regressions
3. **M3** — Git toolbar hardening in parallel
4. **M4** — Thread tree (product differentiator)
5. **M5** — Rich text after timeline stable

---

## Reconnect Linear MCP to interface-lab

1. Cursor → **Settings** → **Plugins** / **MCP** → **Linear**
2. Disconnect or sign out, then authenticate again
3. Select workspace **interface-lab** (URL: `linear.app/interface-lab`)
4. Confirm team list shows your Multi team (not `Nyte` / `NYT`)

After reconnect, ask the agent to "import `docs/linear-roadmap.md` into Linear" — it can create the project, milestones, epics, and issues via MCP.
