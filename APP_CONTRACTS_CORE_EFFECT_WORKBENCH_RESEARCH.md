# App Contracts, Core, Effect Link, And Workbench Research

Date: 2026-06-04

## Scope

This research covered the app package contracts, runtime/core model-policy path, Effect usage, draft-first composer surface, workspace toolbar, right workbench panels, Cursor workbench references, t3code/opencode references, and Pierre `trees`/`truncate`.

Five subagents were used for distinct data gathering:

- contracts/core/effect/model-mode architecture
- draft page, hero composer, workspace toolbar
- shell panels and selector/global state
- t3code/opencode upstream patterns
- Cursor bundle and Pierre trees/truncate

## Sources

- Multi workspace: `/Users/workgyver/Developer/multi`
- t3code mirror: `/Users/workgyver/.agents/codebases/t3code-full`
- opencode mirror: `/Users/workgyver/.agents/codebases/anomalyco-opencode`
- Effect v4 beta package: `/Users/workgyver/Developer/multi/node_modules/.pnpm/effect@4.0.0-beta.59/node_modules/effect`
- Cursor bundle: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- Pierre focused mirror added for this research: `/Users/workgyver/.agents/codebases/pierre-trees-truncate`

The existing `pierre` codebase mirror is sparse and excludes `packages/trees` and `packages/truncate`, so a focused `codebase-cli` mirror was registered:

```sh
codebase add github:pierrecomputer/pierre --name pierre-trees-truncate --path packages/trees,packages/truncate
```

## Findings

### Model Selection And Mode Selection

Root cause: Multi persists model selection in orchestration, but normal runtime turn start does not use it.

Relevant paths:

- `/Users/workgyver/Developer/multi/packages/contracts/src/orchestration.ts:51`
- `/Users/workgyver/Developer/multi/packages/contracts/src/orchestration.ts:647`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/chat-view.tsx:969`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/chat-view.tsx:1788`
- `/Users/workgyver/Developer/multi/packages/app/src/lib/runtime-turn-dispatch.ts:11`
- `/Users/workgyver/Developer/multi/packages/runtime/src/desktop-runtime-host.ts:372`
- `/Users/workgyver/Developer/multi/packages/runtime/src/desktop-runtime-host.ts:501`
- `/Users/workgyver/Developer/multi/packages/contracts/src/runtime.ts:57`
- `/Users/workgyver/Developer/multi/packages/runtime/src/auth-model-policy.ts:60`

Debug info:

- `ModelSelection` is stored on projects and threads.
- `chat-view.tsx` chooses `threadCreateModelSelection` and sends it when creating a thread.
- `sendRuntimeTurn` sends `threadId`, `cwd`, text, `interactionMode`, plan reference, message id, and images. It does not send `modelSelection` or `policy`.
- `desktop-runtime-host.ts` uses `input.policy ?? this.createDefaultPolicy(input.interactionMode)`.
- `createDefaultPolicy` hardcodes `modelSelection: { type: "pi-managed" }`.

Implication:

The UI can hide model selection, but the backend needs one canonical execution profile. Today persisted model intent, runtime preferences, `AgentModelPolicy`, `AgentInteractionMode`, and `ModelSelection` are competing concepts.

Desired behavior:

- `Rush` resolves to GPT 5.5 with no thinking.
- `Smart` resolves to GPT 5.5 with user-adjustable thinking.
- `Deep` resolves to GPT 5.5 with user-adjustable thinking.
- The user chooses mode and thinking, not a model name. The backend converts that into `AgentModelPolicy`.

Reference contrast:

- opencode keeps provider/model identity explicit and resolves through a catalog service: `/Users/workgyver/.agents/codebases/anomalyco-opencode/packages/core/src/catalog.ts`
- opencode service/layer pattern: `/Users/workgyver/.agents/codebases/anomalyco-opencode/packages/core/src/git.ts`
- t3code service/layer pattern: `/Users/workgyver/.agents/codebases/t3code-full/apps/server/src/vcs/VcsStatusBroadcaster.ts`

### First Open, Draft Page, Hero Composer

Root cause: draft-first exists, but workspace controls are separate from the hero composer and disappear for unresolved/projectless states.

Relevant paths:

- `/Users/workgyver/Developer/multi/packages/app/src/app/routes/chat-index-route.tsx:52`
- `/Users/workgyver/Developer/multi/packages/app/src/app/routes/chat-index-route.tsx:81`
- `/Users/workgyver/Developer/multi/packages/app/src/app/routes/chat-draft-route.tsx:71`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/chat-view.tsx:2287`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/chat-view.tsx:2558`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/chat-view.tsx:2575`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/workspace-toolbar.tsx:232`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/composer/input.tsx:1877`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/composer/input.tsx:1887`

Debug info:

- `/` restores a server thread when route persistence says to, otherwise ensures an empty draft session.
- Hero composer is gated by a local draft thread with no started work.
- `WorkspaceToolbar` is rendered above `ComposerInput`, not as composer chrome.
- `WorkspaceToolbar` returns `null` when `cwd` is missing, so the "Open Folder..." affordance is unreachable in the exact state where it is most needed.
- Composer footer exposes runtime `AgentMode` and thinking level controls. Interaction modes are chips/slash-menu items, not the primary visible mode selection.

Implication:

The desired first open is close, but the UI hierarchy is wrong. The screenshot-like surface should be a single hero composer with workspace, environment, branch, mode, and scripts as one coherent control surface.

### Workspace Toolbar And Project Scripts

Root cause: workspace/project state is derived in `chat-view`, but scripts are shown in `chat-header` only when `activeProjectScripts` is present. The desired rule is tied to `workspaceTarget.project`, not thread route kind. Naming is also split: contracts call them `ProjectScript`, but the current dialog already describes them as "project-scoped commands" and labels creation as "Add Action".

Relevant paths:

- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/workspace-toolbar.tsx`
- `/Users/workgyver/Developer/multi/packages/app/src/components/project-scripts-control.tsx`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/chat-header.tsx:69`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/chat-view.tsx:901`
- `/Users/workgyver/Developer/multi/packages/app/src/lib/workspace-target.ts:195`

Debug info:

- `resolveWorkspaceTarget` derives `cwd`, `project`, `worktreePath`, `rpcEnvironmentId`, and `workspaceKey`.
- The toolbar only renders for local draft threads with `gitCwd !== null` and no active worktree.
- Project scripts are mounted through the header, not through the workspace-aware hero/control row.
- `project-scripts-control.tsx` uses `aria-label="Project scripts"` but visible UI says `Add Action`, `Edit Action`, `Save action`, and "Actions are project-scoped commands you can run from the top bar or keybindings."

Implication:

Scripts should follow `workspaceTarget.project` and render when the active workspace is not the default/projectless state. They should not be coupled to the route header. Product naming should be `Project Actions`; `runOnWorktreeCreate` should be presented as a setup action/hook, not as a separate "script" concept. The persisted contract can remain `ProjectScript` until the implementation pass decides whether the storage migration is worth the churn.

### Right Workbench Panels

Root cause: `rightOpen`, `activeTab`, `muted`, and `rightW` are singleton global state. Only secondary rails and terminal sessions are keyed by `workspaceKey`.

Relevant paths:

- `/Users/workgyver/Developer/multi/packages/app/src/stores/shell-panels-store.ts:139`
- `/Users/workgyver/Developer/multi/packages/app/src/stores/shell-panels-store.ts:294`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/shell/app.tsx:202`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/shell/app.tsx:307`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell-host.tsx:820`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell-host.tsx:880`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell-host.tsx:963`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/git/panel.tsx:297`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/files/project-files-panel.tsx:42`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/terminal/panel.tsx:56`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/shell/right-workbench-tool-island.tsx:12`

Debug info:

- `RightAside` reads global `useRightOpen`, `useActiveTab`, and `useIsMuted`.
- Route search `?panel=` overrides the global active tab, and is not workspace scoped.
- `RightAsidePanels` remounts by `workspaceKey`, so component-local state resets correctly.
- Git/files/terminal panels are not the main source of stale state; global right-workbench selectors are.
- Null/empty `workspaceKey` collapses to `"default"` for rails and terminal sessions.

Implication:

The "all open workspace button" failure is selector ownership. The right workbench needs workspace-keyed view state, not global panel state.

### File Tree And Git Tree Rendering

Root causes:

- `ProjectFileTreeInitialLoadSync` destructures `loadingDirectoriesRef` twice.
- File tree loading is gated by `active`, so inactive panels do not warm/load state.
- Pierre tree model is stable and imperative, but Multi drives it through render-time arrays, string keys, and effect remounts.

Relevant paths:

- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/files/project-file-tree.tsx:284`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/files/project-file-tree.tsx:302`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/files/project-file-tree.tsx:340`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/files/project-file-tree.tsx:352`
- `/Users/workgyver/Developer/multi/packages/app/src/components/shell/git/git-changes-file-tree.tsx:62`
- `/Users/workgyver/Developer/multi/packages/app/src/components/tree.tsx:119`
- `/Users/workgyver/.agents/codebases/pierre-trees-truncate/packages/trees/src/react/useFileTree.ts:17`
- `/Users/workgyver/.agents/codebases/pierre-trees-truncate/packages/trees/src/preparedInput.ts:14`
- `/Users/workgyver/.agents/codebases/pierre-trees-truncate/packages/trees/src/model/gitStatus.ts:14`

Debug info:

- Pierre `useFileTree` creates a model exactly once and expects callers to use model methods like `resetPaths` and `setGitStatus`.
- Multi calls `prepareFileTreeInput(treePaths)` inside reset effects and uses `key={treePathsKey}` to remount sync helpers.
- `GitChangesFileTree` builds sorted rows, maps, sets, paths, prepared input, and git status entries during render, then effects reset the tree.

Implication:

Multi has the right package, but needs a workspace-scoped file/git tree model boundary. React should subscribe to snapshots and issue semantic actions, not rebuild tree inputs as panel render state.

### Git Core And Worktree Lifecycle

Root cause: Multi has substantial t3code-like git core, but worktree/session ownership is fragmented across app send flow, server bootstrap, git status, setup scripts, and thread metadata.

Relevant paths:

- `/Users/workgyver/Developer/multi/packages/server/src/git/GitCore.service.ts`
- `/Users/workgyver/Developer/multi/packages/server/src/git/GitManager.service.ts`
- `/Users/workgyver/Developer/multi/packages/server/src/git/GitStatusBroadcaster.ts`
- `/Users/workgyver/Developer/multi/packages/server/src/ws.ts`
- `/Users/workgyver/Developer/multi/packages/app/src/components/chat/view/chat-view.tsx`
- `/Users/workgyver/.agents/codebases/t3code-full/apps/server/src/vcs/GitVcsDriver.ts`
- `/Users/workgyver/.agents/codebases/t3code-full/apps/server/src/vcs/VcsStatusBroadcaster.ts`
- `/Users/workgyver/.agents/codebases/t3code-full/apps/server/src/ws.ts`
- `/Users/workgyver/.agents/codebases/anomalyco-opencode/packages/core/src/git.ts`
- `/Users/workgyver/.agents/codebases/anomalyco-opencode/packages/opencode/src/worktree/index.ts`

Debug info:

- t3code keeps worktree creation, metadata update, status refresh, setup script launch, and bootstrap turn dispatch in one Effect program.
- opencode makes worktree lifecycle a service with create/list/remove/reset style operations and explicit ready/failed events.
- Multi git status already has local/remote split, streaming, caching, and refresh behavior, but remote refresh freshness is weaker than t3code's configurable polling/backoff.

Implication:

Do not rewrite git core first. Extract workspace/session/worktree ownership first, then tighten git freshness semantics.

### Effect V4

Root cause: Effect is present but used inconsistently. Contracts use `Schema`, parts of server git use services, app state uses Zustand/query/atoms, and runtime policy is plain class fallback logic.

Relevant paths:

- `/Users/workgyver/Developer/multi/packages/contracts/src/runtime.ts`
- `/Users/workgyver/Developer/multi/packages/contracts/src/orchestration.ts`
- `/Users/workgyver/Developer/multi/packages/server/src/git/GitStatusBroadcaster.ts`
- `/Users/workgyver/Developer/multi/packages/runtime/src/desktop-runtime-host.ts`
- `/Users/workgyver/.agents/codebases/anomalyco-opencode/packages/core/src/location-layer.ts`
- `/Users/workgyver/.agents/codebases/anomalyco-opencode/packages/core/src/filesystem.ts`
- `/Users/workgyver/.agents/codebases/t3code-full/apps/server/src/vcs/VcsDriverRegistry.ts`

Implication:

Effect should become the backend boundary for workspace session, model policy resolution, git status/worktree lifecycle, and truncation/tree data preparation. React should consume snapshots and commands.

### Truncation

Root cause: Multi has scattered string/UI truncation helpers and does not depend on standalone `@pierre/truncate`.

Relevant paths:

- `/Users/workgyver/Developer/multi/packages/server/src/git/GitCore.ts:44`
- `/Users/workgyver/Developer/multi/packages/server/src/git/GitManager.ts:289`
- `/Users/workgyver/Developer/multi/packages/server/src/git/Utils.ts:28`
- `/Users/workgyver/Developer/multi/packages/server/src/process-runner.ts:121`
- `/Users/workgyver/Developer/multi/packages/app/src/session-logic.ts:2557`
- `/Users/workgyver/.agents/codebases/pierre-trees-truncate/packages/truncate/src/react/components/OverflowText.tsx`
- `/Users/workgyver/.agents/codebases/pierre-trees-truncate/packages/truncate/src/lib/splits.ts`
- `/Users/workgyver/.agents/codebases/pierre-trees-truncate/packages/truncate/README.md`

Debug info:

- `@pierre/truncate/react` exposes `Truncate`, `Fruncate`, and `MiddleTruncate`.
- CSS import is required: `@pierre/truncate/style.css`.
- `MiddleTruncate` supports `split="leaf-path"` and `split="extension"`, which fits file/workspace labels.

Implication:

Use `@pierre/truncate` for UI label/path truncation. Do not use it for byte-safe process output truncation without a separate backend-safe helper.

## The Plan

1. Make `AgentModelPolicy` the runtime contract.

   Use the existing Multi names: `ModelSelection` remains persisted orchestration state, and `AgentModelPolicy` remains the runtime input. `sendRuntimeTurn` must pass `ModelSelection` or a resolved `AgentModelPolicy` into `ThreadAgentRuntimeSendTurnInput.policy` before runtime thread creation. Remove the silent normal-start fallback to `{ type: "pi-managed" }`. User-facing UI exposes `AgentMode`, `AgentInteractionMode`, and thinking level only; model naming and resolution stay backend-owned. The default policy mapping is: `Rush` -> GPT 5.5 with no thinking; `Smart` and `Deep` -> GPT 5.5 with adjustable thinking.

2. Move worktree/session ownership into `GitVcsDriver` and `GitManager`.

   Keep Multi's existing `GitCore.service.ts`, `GitManager.service.ts`, and `GitStatusBroadcaster.ts`, but make the ownership follow t3code's `GitVcsDriver`, `GitManager`, and `VcsStatusBroadcaster` shape. Worktree creation, thread workspace metadata, setup-script launch, and status refresh should run as one Effect program instead of being split across `chat-view.tsx`, websocket bootstrap, and thread metadata writes. Use opencode's exact worktree operation names where they fit: `worktreeCreate`, `worktreeList`, `worktreeRemove`, and `worktreeReset`.

3. Key right workbench state by workspace.

   Keep the existing `shell-panels-store.ts` naming, but change ownership: `rightOpen`, `activeTab`, `muted`, and secondary rails should live under `workspaceKey`, like terminal sessions already do. Existing selectors such as `useRightOpen`, `useActiveTab`, and `useIsMuted` should read the active workspace entry instead of singleton fields. Keep left sidebar global. Keep right width global only if product wants a shared width. Scope or clear `?panel=` after applying it to the current workspace. Make shell boundary `workspaceKey` non-null by deriving a projectless key instead of using the `"default"` fallback.

4. Move draft-first controls into the hero composer chrome.

   Keep first-open as a draft route, but render workspace folder, environment, branch, mode, project actions, attach, and send as one composer surface. `WorkspaceToolbar` should always render a projectless/open-folder state. Branch and local/worktree controls remain conditional on git repo state. `ProjectScriptsControl` should follow `workspaceTarget.project`, not header route shape, and the visible/ARIA naming should become `Project Actions`. Keep `runOnWorktreeCreate` visible as a setup action/hook.

5. Use Pierre `FileTree` as the file/git tree model.

   Keep the canonical model name from Pierre: `FileTree` from `@pierre/trees/react` via `useFileTree`. Multi should stop remounting sync helpers with `key={treePathsKey}` and instead drive the stable `FileTree` model with its methods: `resetPaths`, `setGitStatus`, selection APIs, and search APIs. Use `prepareFileTreeInput` centrally and `applyGitStatusPatch` where appropriate. Fix the duplicate `loadingDirectoriesRef` destructuring in `project-file-tree.tsx`.

6. Tighten git status freshness without replacing git core.

   Keep Multi's current git core. Add t3code `VcsStatusBroadcaster`-style remote polling options and failure backoff. Make branch/worktree actions await fresh local status, and await fresh remote status where ahead/behind/PR state is displayed.

7. Adopt `@pierre/truncate` for workbench/UI labels.

   Add `@pierre/truncate` and import `@pierre/truncate/style.css` once in app CSS. Use the reference component names directly: `MiddleTruncate split="leaf-path"` for paths/workspace labels and `MiddleTruncate split="extension"` for file names. Keep backend byte/output truncation as a separate non-React helper.

## Verification

Recommended verification after implementation:

- Run `pnpm run typecheck`.
- Add focused tests for `resolveWorkspaceTarget`, workspace-keyed `shell-panels-store`, `ModelSelection` to `AgentModelPolicy` resolution, and Pierre `FileTree` updates.
- For UI, verify first-open draft hero, workspace picker, non-default workspace scripts, Git/Files/Terminal panel switches, and workspace switching with a git repo and a projectless/default state.
