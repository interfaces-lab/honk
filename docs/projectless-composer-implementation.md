# Projectless Composer Implementation

Status: Draft
Date: 2026-05-05

## Summary

The blank screen after the splash screen was caused by stale local SQLite state from before the Project canonicalization refactor. The local projection table still had `workspace_root`, while the current code queries `project_root` in `ThreadProjection.getSnapshot`. That crashed shell snapshot loading and left Electron on a blank renderer surface.

After moving the stale local stores aside, Electron booted with a fresh canonical database. The new empty state exposed a second issue: the home route renders an empty center because `/` does not render a composer and there are no existing Projects, Threads, or drafts to redirect to.

The desired behavior should be: the home route always offers a usable composer after bootstrap. A user should be able to ask general AI questions with no folder selected, and can optionally attach/open a Project when they want codebase context.

## Findings

### Local Store Regression

- Previous stale dev DB: `projection_projects.workspace_root` existed, but `projection_projects.project_root` did not.
- Current code is canonical and expects `project_root` in `packages/server/src/orchestration/ThreadProjection.ts`.
- Fresh DBs are canonical because `packages/server/src/persistence/migrations/005_Projections.ts` now creates `project_root`.
- Stale DBs were moved aside rather than adding compatibility code, because this is unreleased and the code should stay canonical.

### Empty Home Regression

- `packages/app/src/app/routes/chat-index-route.tsx` currently returns `null`.
- `EventRouter` in `packages/app/src/app/routes/root-route.tsx` only redirects from `/` when `resolveInitialChatTarget` finds an existing server Thread or draft.
- A fresh store with zero Projects and zero Threads has no redirect target, so the shell center remains empty.
- The hero composer currently appears only inside `ChatView` when the active route is a local draft Thread and `threadHasStarted(activeThread)` is false.

### Project Is Currently Required

A truly projectless composer is not a small route-only fix today. Project identity is required across the current Thread model:

- `OrchestrationThread`, `ThreadCreateCommand`, and `ThreadTurnStartBootstrapCreateThread` require `projectId` in `packages/contracts/src/orchestration.ts`.
- `projection_threads.project_id` is `TEXT NOT NULL` in `packages/server/src/persistence/migrations/005_Projections.ts`.
- App types require `Thread.projectId`, `ThreadShell.projectId`, and `SidebarThreadSummary.projectId` in `packages/app/src/types.ts`.
- Draft state requires `DraftThreadState.projectId` in `packages/app/src/composer-draft-store.ts`.
- `ChatView.onSend` returns early when `activeProject` is missing, and first-send bootstrap uses `activeProject.id`, `activeProject.cwd`, and `activeProject.defaultModelSelection`.
- Sidebar state indexes Threads by Project through `threadIdsByProjectId` in `packages/app/src/thread-sync.ts`.

### Do Not Use A Hidden Fake Project

A fake built-in Project like `General Chat` would avoid many schema changes, but it would violate the domain model:

- A Project is a user-configured code root.
- A general AI question has no code root.
- Hiding a Project would make sidebar grouping, Project settings, scripts, files, Git, and worktree behavior ambiguous.

The canonical model should allow a Thread to have no Project context.

## Proposed Product Behavior

### Home Route

After auth and environment bootstrap, `/` should render a hero composer instead of an empty center.

The composer has two context states:

- No Project selected: general AI chat, no files/Git/worktree/terminal context.
- Project selected: normal Project-backed Thread behavior.

If existing Threads or drafts exist, current resume behavior can stay: `/` redirects to the best initial Thread or draft. If there is no resume target, `/` shows the hero composer directly.

### Project Context Control

The hero composer should include an explicit Project context control:

- Default label: `No project` or `Ask without a project`.
- Secondary action: `Open Project`.
- If Projects exist, the control can pick an existing Project before first send.
- If no Project is selected, Project-specific controls are hidden or disabled.

### Projectless Thread

A projectless Thread is a durable Thread with `projectId: null`. It can contain messages, provider sessions, model selection, runtime mode, activity, and title. It cannot have Project scripts, file tree, Git status, worktree setup, or Project diffs.

Provider execution should use an internal scratch cwd, not the user home directory and not a fake Project root. A safe default is a server-managed directory under Multi state, for example `~/.multi/<environment>/projectless-chat`.

## Implementation Plan

### 1. Update Domain Documentation

Update `CONTEXT.md` relationships before code changes:

- Current: `A Thread belongs to exactly one Project`.
- New: `A Thread may be projectless for general chat, or belong to exactly one Project for codebase-scoped work`.

Keep `Project` as the canonical name for a user-configured code root. Do not reintroduce `Workspace`.

### 2. Update Contracts

In `packages/contracts/src/orchestration.ts`:

- Change Thread project references from `ProjectId` to `Schema.NullOr(ProjectId)` where a projectless Thread is valid.
- Include at least `OrchestrationThread`, `ThreadCreatedPayload`, `ThreadCreateCommand`, and `ThreadTurnStartBootstrapCreateThread`.
- Keep Project-specific commands requiring `ProjectId`.
- Keep worktree bootstrap requiring a Project-backed Thread.

Expected shape:

```ts
projectId: Schema.NullOr(ProjectId);
```

### 3. Update Persistence Schema

Because this is unreleased, update the canonical migration instead of preserving legacy compatibility:

- In `packages/server/src/persistence/migrations/005_Projections.ts`, make `projection_threads.project_id` nullable.
- Keep `idx_projection_threads_project_id`; SQLite indexes nullable columns.
- Review queries that assume an inner join to `projection_projects`. Projectless Threads must not disappear from shell snapshots.

Known query to adjust:

- `getThreadCheckpointContextThreadRow` currently inner joins `projection_projects`; it should return no checkpoint context for projectless Threads or use a left join with null handling.

### 4. Update Server Projection And Decider

In server orchestration:

- Allow `projectId: null` on `thread.create` and `thread.created`.
- Reject `worktreePath` or worktree bootstrap when `projectId` is null.
- Map projectless Thread rows into shell snapshots and thread snapshots.
- Ensure `getFirstActiveThreadIdByProjectId` remains Project-only.
- Add a Project-independent query path if needed for home resume ordering.

Provider startup:

- Update `coerceThreadProjectCwd` usage in `ProviderCommandReactor` for null Project context.
- For projectless Threads, use a dedicated scratch cwd from server config/state.
- Do not fall back to `OS.homedir()` in desktop packaged mode for projectless provider execution.

### 5. Update App State Types And Sync

In `packages/app/src/types.ts`:

- Change `Thread.projectId`, `ThreadShell.projectId`, and `SidebarThreadSummary.projectId` to `ProjectId | null`.

In `packages/app/src/thread-sync.ts`:

- Preserve projectless Threads in `threadIds`.
- Do not write projectless Threads into `threadIdsByProjectId`.
- Add explicit projectless grouping state if the sidebar needs stable grouping, for example `projectlessThreadIds`.
- Ensure project deletion does not delete projectless Threads.

### 6. Update Draft State

In `packages/app/src/composer-draft-store.ts`:

- Allow `DraftThreadState.projectId` to be `ProjectId | null`.
- Add a projectless draft lookup keyed by Environment, not by Project.
- Keep existing Project draft reuse keyed by logical Project key.
- Add a storage version migration, or because unreleased, rewrite the persisted schema canonically if local storage can be cleared.

Recommended draft identities:

- Project-backed draft: existing logical Project key.
- Projectless draft: `projectless:<environmentId>`.

### 7. Render Home Composer

Replace `ChatIndexRouteView` returning `null` with a real home composer surface.

Preferred architecture:

- Extract the reusable hero composer orchestration from `ChatView` so the home route can render a composer without a full Thread timeline.
- Or create a projectless draft on first render and route to `/draft/$draftId`.

The second path is faster but still requires `DraftThreadState.projectId: null` and `ChatView` support for `activeProject === undefined`.

Home route behavior:

- If `resolveInitialChatTarget` finds a server Thread or draft, keep current redirect behavior.
- If no target exists, render the hero composer with project context set to null.
- If the user picks a Project before first send, update the draft context to that Project before dispatch.

### 8. Update ChatView For Optional Project

In `packages/app/src/components/chat-view.tsx`:

- Remove the early `if (!activeProject) return;` from `onSend` and replace it with project-aware branching.
- For projectless first send, bootstrap a Thread with `projectId: null`.
- For projectless first send, do not prepare a worktree.
- Use selected composer model, provider defaults, or global provider defaults when there is no `activeProject.defaultModelSelection`.
- Hide or disable Project-only controls: scripts, terminal launch, files, Git, worktree mode, Project diff, and Project opener.
- Keep model picker, attachments, prompt editing, runtime mode, and plan mode available if provider capabilities allow them without Project context.

### 9. Update Sidebar And Resume Logic

In `packages/app/src/app/routes/chat-index-route.logic.ts`:

- Include projectless Threads as resume candidates.
- Do not require `projectCwdByProjectId` for `projectId: null` candidates.
- Stored Project cwd should only bias Project-backed candidates.

In sidebar view models:

- Add a `General` or `No project` section for projectless Threads.
- Keep Project sections unchanged.
- Avoid placing projectless Threads under a fake Project.

### 10. Tests

Required tests:

- `resolveInitialChatTarget` returns a projectless Thread candidate when no Project-backed candidates exist.
- Fresh bootstrap with no Projects renders the hero composer on `/`.
- Sending from projectless hero composer dispatches `thread.turn.start` with `bootstrap.createThread.projectId: null`.
- Projectless send does not dispatch `prepareWorktree`.
- Projectless Thread route renders after server shell upsert.
- Projectless Thread does not show files/Git/worktree/script controls.
- Selecting a Project before first send produces a normal Project-backed Thread.
- `bun run typecheck` passes.

## Risks

- This is a domain model change, not just a UI empty state.
- Many selectors assume `projectId` is non-null.
- Project deletion and sidebar grouping need careful handling to avoid dropping projectless Threads.
- Provider adapters may still require a cwd; use a safe scratch cwd rather than user home or repo cwd.
- Checkpointing and diff features must be disabled for projectless Threads unless a Project is later attached.

## Non-Goals

- Do not add a hidden Project to represent general chat.
- Do not restore `workspace_*` compatibility paths.
- Do not create a Project automatically just because the user asks a general question.
- Do not show Project tools when no Project context is selected.

## Verification From Current Session

- `bun run typecheck` passed before any implementation edits.
- Runtime logs showed `no such column: project_root`, confirming stale local schema as the splash-screen blank cause.
- Fresh dev state currently has zero Projects, confirming the empty home route is the visible second issue.
- Temporary route-only behavior was backed out; this doc describes the canonical implementation instead.
