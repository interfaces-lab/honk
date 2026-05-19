# React Effect Callsite Inventory

This is the read ledger for existing React effects. It refines
[react.md](./react.md) from counts into migration categories.

Status rule:

- `[x]` means the listed callsites were read and classified.
- `[ ]` means the file is still count-only and must be read before editing.

## Categories

- `external-sync`: DOM, browser API, terminal/editor runtime, observer,
  subscription, worker, global listener, or cleanup.
- `reset-by-key`: local state reset that should become a keyed boundary when
  possible.
- `derived-state`: state mirrors props/store/query data and should become
  render-time derivation or owned store state.
- `action-relay`: state flag drives an effect that performs an action.
- `route-sync`: route/search/store synchronization that should belong to route
  actions, loaders, or explicit navigation handlers.
- `resource-cleanup`: cleanup of blob URLs, timers, subscriptions, or runtime
  resources.

## Chat View

File: `packages/app/src/components/chat/view/chat-view.tsx`

- [x] `284`: `derived-state` / `action-relay`; local dispatch reset now happens
      at the local dispatch owner when server acknowledgement is derived.
- [x] `552`: `derived-state`; mounted terminal thread reconciliation now lives
      in a keyed mount-only lifecycle child.
- [x] `580`: `external-sync`; server thread detail retention now lives in a
      keyed mount-only lifecycle child.
- [x] `675`: `route-sync`; settled-turn visited marking now lives in a keyed
      mount-only lifecycle child.
- [x] `828`: `resource-cleanup`; optimistic user message preview cleanup now
      lives in a mount-only cleanup child.
- [x] `1526`: `reset-by-key`; pull request dialog and scroll pill reset now
      lives in a keyed mount-only child.
- [x] `1533`: `reset-by-key`; checkpoint revert reset now lives in a keyed
      mount-only child.
- [x] `1537`: `external-sync`; composer focus after active thread changes now
      lives in a keyed mount-only child.
- [x] `1547`: `derived-state` plus `resource-cleanup`; optimistic message
      removal and preview handoff now live in a keyed mount-only child.
- [x] `1575`: `reset-by-key` plus `resource-cleanup`; thread/draft optimistic
      message, handoff, local dispatch, and expanded image reset now lives in a
      keyed mount-only child.
- [x] `1617`: deleted; server-thread env override state was removed when
      branch/worktree controls became draft-only.
- [x] `1622`: deleted; the pending env override capability cleanup disappeared
      with the server-thread override path.
- [x] `1630`: `route-sync`; terminal launch context active-thread
      reconciliation now lives in a keyed mount-only child.
- [x] `1732`: `route-sync`; local terminal launch context settled-cwd cleanup
      now lives in a keyed mount-only child.
- [x] `1763`: `route-sync`; stored terminal launch context settled-cwd cleanup
      now lives in a keyed mount-only child.
- [x] `1788`: `route-sync`; terminal-close launch context cleanup now lives in a
      keyed mount-only child.
- [x] `1803`: `external-sync`; terminal open focus handling now lives in a keyed
      mount-only child.
- [x] `1825`: `external-sync`; global configurable shortcut listener now lives
      in a keyed mount-only child.

Target:

- [x] Extract optimistic-message lifecycle into a focused hook or keyed child.
- [x] Move terminal launch-context reconciliation behind focused lifecycle
      children.
- [x] Replace active-thread reset effects with keyed child boundaries where the
      child owns the local state being reset.
- [x] Keep thread subscription, focus, blob URL cleanup, and global keybinding
      listeners as explicit external sync.

## Composer Input

File: `packages/app/src/components/chat/composer/input.tsx`

- [x] `1117`: `derived-state`; `promptRef` now updates during render and cursor
      clamping lives in a keyed mount-only child.
- [x] `1122`: `derived-state`; image ref now updates during render.
- [x] `1126`: `derived-state`; terminal-context ref now updates during render.
- [x] `1133`: `derived-state`; highlighted menu item/search key sync now lives
      in a keyed mount-only child.
- [x] `1152`: `route-sync` / `reset-by-key`; pending user-input custom-answer
      hydration now lives in a keyed mount-only child.
- [x] `1196`: `reset-by-key`; composer cursor, trigger, and dismissal reset now
      lives in a keyed mount-only child.
- [x] `1371`: `external-sync`; outside pointer listener now lives in a
      mount-only menu dismissal child.
- [x] `use-image-attachments.ts:70`: removed `derived-state`; drag-over depth
      and visual state now reset through render-time target ownership.
- [x] `use-image-attachments.ts:75`: `external-sync`; image `File`
      serialization to persisted draft data URLs now lives in a rendered
      mount-only lifecycle child with a cancellation guard.

Target:

- [x] Keep outside-pointer listener as external sync.
- [x] Replace thread/draft reset with keyed composer state.
- [x] Move ref synchronization out of direct effects.
- [x] Treat pending-user-input prompt hydration as a composer mode boundary, not
      a generic effect.
- [x] Move image attachment persistence out of direct effects; promote it into
      the draft store if another caller
      needs the same serialization invariant.

## Prompt Editor

File: `packages/app/src/components/chat/composer/prompt-editor.tsx`

- [x] `1083`: removed `derived-state`; `onChange` callback ref updates during
      render.
- [x] `1087`: removed `derived-state`; `onCommandKeyDown` callback ref updates
      during render.
- [x] `1091`: removed `derived-state`; `onPaste` callback ref updates during
      render.
- [x] `1095`: removed `derived-state`; skill metadata ref updates from memoized
      render state.
- [x] `1237`: `external-sync`; TipTap editable state now syncs through a keyed
      mount-only child.
- [x] `1241`: `external-sync`; reconciles controlled prompt/cursor/contexts
      into TipTap editor state.
- [x] `1298`: `external-sync`; observes editor size and reports multiline
      measurement.

Target:

- [ ] Keep TipTap editor reconciliation in an editor-owned integration hook.
- [ ] Prefer `useEffectEvent` or event-time ref writes for callback refs where
      React support allows it.
- [ ] Keep `ResizeObserver` as external sync.

## Thread Terminal Drawer

File: `packages/app/src/components/thread-terminal-drawer.tsx`

- [x] `293`: `external-sync`; xterm, addons, terminal event subscription, host
      subscription, selection handlers, copy/paste handlers, and cleanup now
      live in a mount-only viewport session boundary.
- [x] `785`: `external-sync`; terminal focus now lives in a keyed mount-only
      focus child.
- [x] `797`: `external-sync`; fit-and-resize now lives in a keyed mount-only
      resize child.
- [x] `1032`: `derived-state`; `onHeightChange` callback ref now updates during
      render.
- [x] `1036`: `derived-state`; `drawerHeight` ref now updates during render.
- [x] `1047`: `reset-by-key`; drawer height reset now lives in a keyed
      mount-only child.
- [x] `1111`: `external-sync`; visible window resize listener now lives in a
      mount-only listener child.
- [x] `1125`: `external-sync`; visible resize epoch bump now lives in a
      mount-only child.
- [x] `1132`: `resource-cleanup`; unmount height sync now lives in a mount-only
      cleanup child.

Target:

- [x] Keep xterm lifecycle in this integration component.
- [x] Move height refs into render-time/ref owner synchronization where
      possible.
- [x] Keep window resize and unmount height sync as terminal drawer external
      sync.

## Messages Timeline

File: `packages/app/src/components/chat/timeline/messages-timeline.tsx`

- [x] `180`: `derived-state`; worked-header override pruning now lives in a
      keyed mount-only sync child.
- [x] `331`: `external-sync`; imperative timeline controller exposure now
      lives in a keyed mount-only sync child.
- [x] `345`: `resource-cleanup`; programmatic scroll cleanup now lives in a
      mount-only cleanup child.
- [x] `365`: `external-sync`; virtualized scroll pinning after row changes now
      lives in a keyed mount-only sync child.
- [x] `384`: `external-sync`; active turn/work scroll pinning now lives in a
      keyed mount-only sync child.

Target:

- [x] Keep virtualized scroll effects in the timeline integration component
      behind focused lifecycle children.
- [ ] Replace override pruning with reducer-owned state if the timeline state
      grows further.

## Diff Panel

File: `packages/app/src/components/diff-panel.tsx`

- [x] `280`: `route-sync`; diff word wrap reset on panel open now lives in a
      keyed mount-only sync child.
- [x] `287`: `external-sync`; selected-file scroll now lives in a keyed
      mount-only sync child.
- [x] `384`: `external-sync`; turn-strip scroll listener and
      `ResizeObserver` now live in a mount-only observer child.
- [x] `403`: `external-sync`; turn-strip scroll-state recalculation after diff
      summary/selection changes now lives in a keyed mount-only sync child.
- [x] `410`: `external-sync`; selected-turn tab scroll now lives in a keyed
      mount-only sync child.

Target:

- [ ] Decide whether diff word-wrap reset belongs to open handler or persisted
      panel state.
- [ ] Keep DOM scroll and observer effects in the diff panel.

## Model Picker

Files:

- `packages/app/src/components/chat/picker/model-picker.tsx`
- `packages/app/src/components/chat/picker/model-content.tsx`

Classified:

- [x] `model-picker.tsx:108`: deleted; the shared model picker open store had
      no readers, so the popover now keeps only local/controlled open state.
- [x] `model-content.tsx:108`: `external-sync`; on popover open, focuses search
      and initializes rail/search state.
- [x] `model-content.tsx:381`: `external-sync`; global keydown listener for
      model jump shortcuts now uses the mount-only effect wrapper with
      render-time refs.

Target:

- [x] Keep global shortcut listener in picker integration.
- [x] Re-evaluate model picker open-state sharing when composer/model resolver
      state is simplified.

## Routes

Files:

- `packages/app/src/app/routes/chat-index-route.tsx`
- `packages/app/src/app/routes/chat-draft-route.tsx`
- `packages/app/src/app/routes/chat-thread-route.tsx`
- `packages/app/src/app/routes/chat-route.tsx`
- `packages/app/src/app/routes/settings-route.tsx`
- `packages/app/src/app/routes/root-route.tsx`

Classified:

- [x] `chat-index-route.tsx:25`: `route-sync`; reads last chat target,
      creates/selects draft when needed, applies sticky draft state, and redirects.
      Keep while route dependencies are client-store/local-storage backed after
      bootstrap. The action now runs through a keyed mount-only child once the
      active environment is bootstrapped.
- [x] `chat-draft-route.tsx:40`: `route-sync`; redirects promoted/canonical
      draft to server thread and persists last route target through a keyed
      mount-only child.
- [x] `chat-draft-route.tsx:52`: `route-sync`; writes draft target or clears
      stale target and redirects home through keyed mount-only children.
- [x] `chat-thread-route.tsx:59`: `route-sync`; writes valid server target or
      clears stale target and redirects home through a keyed mount-only child.
- [x] `chat-thread-route.tsx:87`: `action-relay`; finalizes a promoted draft
      once the backing server thread starts through a keyed mount-only child.
      Keep only while this route owns that lifecycle transition.
- [x] `chat-route.tsx:83`: `external-sync`; global keydown listener for route
      shortcuts. Selected-thread Escape cleanup resolves through the configurable
      `threadSelection.clear` keybinding and the mount-only effect wrapper.
- [x] `settings-route.tsx:34`: `external-sync`; global keydown listener for
      route back action. The back shortcut resolves through the configurable
      `route.back` keybinding and the mount-only effect wrapper.
- [x] `root-route.tsx:50`: `external-sync`; DOM/theme sync through
      `requestAnimationFrame` now uses a keyed mount-only owner for auth status.
- [x] `root-route.tsx:96`: `external-sync`; syncs button cursor CSS
      variable/attribute from settings through a keyed mount-only owner.
- [x] `root-route.tsx:221`: `external-sync`; starts server state sync through
      the mount-only effect wrapper and returns unsubscribe.
- [x] `root-route.tsx:229`: `external-sync`; starts environment connection
      service bound to query client through the mount-only effect wrapper.
- [x] `root-route.tsx:329`: `external-sync`; primary environment/active
      environment descriptor sync plus async bootstrap now lives in a keyed
      mount-only bootstrap child. Keep while root route owns app bootstrap; move
      to environment runtime service if this grows.
- [x] `root-route.tsx:358`: `resource-cleanup`; disposed-ref guard for async
      callbacks now uses the mount-only effect wrapper. Prefer cancellation from
      the async owner when available.

Target:

- [ ] Keep route navigation effects until route dependencies are synchronously
      available to loaders/guards.
- [x] Move hardcoded Escape handling through configurable keybindings.
- [ ] Move promoted-draft finalization into a store/service owner if another
      caller needs the same invariant.

## Shell And App Hooks

Files:

- `packages/app/src/components/shell-host.tsx`
- `packages/app/src/components/shell/shell/app.tsx`
- `packages/app/src/components/web-socket-connection-surface.tsx`
- `packages/app/src/hooks/use-theme.ts`
- `packages/app/src/hooks/use-local-storage.ts`
- `packages/app/src/hooks/use-copy-to-clipboard.ts`

Classified:

- [x] `shell-host.tsx:1000`: `derived-state`; clears
      `gitAgentOrchestrationHandoff` when active run starts or thread reaches
      terminal/failure states. Target is source-state derivation or cleanup inside
      the mutation/store transition.
- [x] `shell/shell/app.tsx:192`: `route-sync`; syncs route search to shell
      panel state through a keyed mount-only child. Keep but watch for loops
      with tab-change handlers.
- [x] `shell/shell/app.tsx:425`: `external-sync`; applies and cleans up
      `document.body[data-cursor-glass-mode]` through the mount-only effect
      wrapper.
- [x] `web-socket-connection-surface.tsx`: moved browser online/focus
      listeners, reconnect countdown, stalled reconnect watchdog, websocket
      status toast, pending toast-reset cleanup, and slow RPC toast sync into
      keyed mount-only coordinator children.
- [x] `use-theme.ts:210`: `external-sync`; applying the current theme is now
      owned by the theme external-store subscription instead of a component
      effect.
- [x] `use-local-storage.ts:103`: removed `reset-by-key`; key changes now create
      a local-storage external store snapshot owner.
- [x] `use-local-storage.ts:115`: moved browser `storage` and custom
      local-storage event subscriptions into the `useSyncExternalStore` owner.
- [x] `use-copy-to-clipboard.ts:57`: `resource-cleanup`; clears a pending copy
      reset timer on unmount through the mount-only effect wrapper.
- [x] `thread-sidebar.ts:121`: deleted with the unused jump-hint helper surface
      after caller inventory showed no production consumer.

Target:

- [x] Replace `shell-host.tsx` handoff cleanup with derived/source-owned state.
- [x] Keep websocket, theme, body attribute, and storage subscription effects as
      external sync behind focused lifecycle owners.
- [x] Rework `use-local-storage` only if callsites can remount by key or the
      hook moves to `useSyncExternalStore`.

## Count-Only Files Still Pending

Read before editing:

- [x] `packages/app/src/app/toast.tsx`: `external-sync`; scoped toast
      auto-dismiss and toast-list pruning now live in keyed mount-only sync
      components.
- [x] `packages/app/src/components/chat/markdown/chat-markdown.tsx`:
      `external-sync`; async Shiki highlighting now populates the highlight
      cache through a keyed mount-only loader child.
- [x] `packages/app/src/components/chat/message/changed-files-tree.tsx`: removed
      two `derived-state` ref-copy effects and the selected-path reset effect;
      tree model initialization now lives in a keyed child instead of a reset
      effect.
- [x] `packages/app/src/components/chat/message/thinking-indicator.tsx`: replaced
      the word-rotation interval effect with a private `useSyncExternalStore`
      timer store.
- [x] `packages/app/src/components/chat/message/tool-renderer.tsx`: removed the
      await-details timer effect with a private `useSyncExternalStore` timer;
      Shell tool approval collapse now uses render-time expansion-state
      reconciliation instead of an effect.
- [x] `packages/app/src/components/chat/view/attachment-preview-handoff.ts`:
      removed the ref-copy effect, moved unmount cleanup to `useMountEffect`,
      and moved image-preload promotion into a rendered mount-only lifecycle
      child.
- [x] `packages/app/src/components/chat/view/branch-toolbar.tsx`: removed the
      branch input focus `external-sync` effect; the branch search input now
      focuses/selects through its callback ref when the picker opens.
- [x] `packages/app/src/components/command-palette.tsx`: moved the global
      shortcut listener and unmount-only close cleanup to `useMountEffect` with
      render-time refs; project-open intent is now a keyed palette session
      input, and Add Project is routed through the mounted palette controller.
- [x] `packages/app/src/components/diff-worker-pool-provider.tsx`:
      removed focused worker-pool theme bridge effect; the worker pool now
      remounts on diff theme changes so initial render options own the theme.
- [x] `packages/app/src/components/pull-request-thread-dialog.tsx`: removed the
      open/reset `derived-state` effect with a keyed dialog session and replaced
      the input focus `external-sync` effect with an input callback ref.
- [x] `packages/app/src/components/settings/draft-input.tsx`: removed
      `derived-state`; the input now displays the committed prop while unfocused
      and snapshots it on focus before committing local edits on blur.
- [x] `packages/app/src/components/settings/provider-instance-card.tsx`: removed
      two `derived-state` effects; accent color derives committed vs editing
      display state during render, and environment variable drafts reset through
      a keyed draft-row owner.
- [x] `packages/app/src/components/settings/settings-layout.tsx`: removed the
      unused exported relative-time interval hook instead of preserving a
      one-off helper.
- [x] `packages/app/src/components/settings/settings-panels.tsx`: removed two
      `derived-state` effects; font inputs rely on keyed draft owners, and the
      code font preview draft now lives in a keyed row component.
- [x] `packages/app/src/components/shell/agents/list.tsx`: removed the
      selected-row visibility and stale-section pruning `derived-state` effects;
      sidebar prefetch, visible thread ref reporting, and retained detail
      subscriptions now use keyed mount-only sync children.
- [x] `packages/app/src/components/shell/agents/row.tsx`: removed focus
      `external-sync` effect; the rename input now focuses/selects through the
      input callback ref when the rename field mounts.
- [x] `packages/app/src/components/shell/files/project-file-tree.tsx`: removed
      cwd/environment reset effect after `ProjectFilesPanel` became the keyed
      owner; tree-model, directory loading, selection, and git-status
      integration now use keyed mount-only sync children.
- [x] `packages/app/src/components/shell/files/project-files-panel.tsx`: replaced
      preview-history reset effect with a keyed panel owner for
      environment/cwd changes.
- [x] `packages/app/src/components/shell/git/git-changes-file-tree.tsx`: moved
      tree-model path reset, git status, and external selection integration to
      keyed mount-only sync children.
- [x] `packages/app/src/components/shell/git/git-diff-card.tsx`:
      moved `IntersectionObserver` prefetch into a keyed expanded-card child
      with the mount-only effect wrapper.
- [x] `packages/app/src/components/shell/git/panel.tsx`: removed selected-file
      `derived-state` effect with render-time selection reconciliation; retained
      expand-on-selection and scroll-into-view in a keyed mount-only sync child.
- [x] `packages/app/src/components/shell/shell/use-column-resize.ts`: moved
      mount-only animation-frame/body-style cleanup to `useMountEffect`.
- [x] `packages/app/src/components/shell/terminal/panel.tsx`: `external-sync`;
      xterm session creation/event wiring and `ResizeObserver` sizing now live
      in a keyed terminal session that uses the mount-only wrapper.
- [x] `packages/app/src/hooks/use-environment-git.ts`: `external-sync`; git row
      patch cache invalidation/removal now lives in a rendered mount-only
      lifecycle child; focus/visibility revalidation uses the mount-only effect
      wrapper with current refs.
- [x] `packages/app/src/lib/desktop-update-react-query.ts`: `external-sync`;
      subscribes to the desktop bridge update stream through the mount-only
      effect wrapper and writes React Query cache state.
- [x] `packages/app/src/lib/git-status-state.ts`: `external-sync`; watches git
      status for the selected environment/cwd through `useSyncExternalStore`
      lifecycle ownership and maintains the atom-backed shared status snapshot.
- [x] `packages/app/src/notifications/taskCompletion.tsx`: `external-sync`;
      compares previous and current thread summaries through a mount-time store
      subscription to emit browser notifications and thread toasts.
