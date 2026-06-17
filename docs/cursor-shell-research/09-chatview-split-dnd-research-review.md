# Cursor Chatview Split / Drag-Drop Research Review

Date: 2026-06-17

Status: consolidated research review for the implementation pass. This supersedes the incomplete handoff notes created during the interrupted subagent runs.

## Sources Inspected

Cursor bundle sources:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.css`

Honk local sources read for implementation fit:

- `packages/app/src/components/shell/shell/app.tsx`
- `packages/app/src/components/shell/shell/right-workbench-header.tsx`
- `packages/app/src/components/shell/shell/right-workbench-layout.tsx`
- `packages/app/src/components/shell/shell/right-workbench-tool-island.tsx`
- `packages/app/src/components/shell/shell/shell-layout-service.tsx`
- `packages/app/src/components/shell/shell/shell-layout.ts`
- `packages/app/src/stores/workbench-tab-store.ts`
- `packages/app/src/stores/workspace-editor-store.ts`
- `packages/app/src/styles/shell.css`
- `packages/honkkit/src/workbench-chrome-row.tsx`
- `packages/app/src/components/chat/view/chat-view.tsx`

Supporting notes produced or reviewed:

- `docs/cursor-shell-research/05-fullscreen-maximize-state.md`
- `docs/cursor-shell-research/06-glass-workbench-tab-system.md`
- `docs/cursor-shell-research/07-chat-pane-dnd-flow.md`
- `docs/cursor-shell-research/07-cursor-workbench-dnd.md`
- `docs/cursor-shell-research/08-chat-view-responsive-findings.md`

## Bundle Boundary Correction

The requested desktop bundle is necessary but not sufficient.

`content-pane-top-bar`, the active Glass chat pane shell, responsive pane model, and tiled agent layout live in the Glass bundle:

- `workbench.glass.main.js`
- `workbench.glass.main.css`

The desktop bundle still matters for shared Cursor/VS Code workbench behavior:

- native editor group drag/drop overlays
- tab and tiling drag primitives
- shared composer constants
- `cursor.chatMaxWidth`
- `--composer-max-width`
- `workbench.action.maximizeChatSize`
- `agentChatMaximized`

Implementation should treat both bundles as evidence. Do not expect every chat shell identifier to appear in `workbench.desktop.main.js`.

## Subagent Split

Five subagents were started for the requested reverse-engineering split. Results were mixed:

- DnD/library slice produced `07-cursor-workbench-dnd.md`.
- Chat pane mutation flow slice produced `07-chat-pane-dnd-flow.md`.
- Responsive/chat sizing slice produced `08-chat-view-responsive-findings.md`.
- Style/top-bar slice was interrupted and produced an incomplete note.
- Shell/status slice was interrupted and produced an incomplete note.

The incomplete notes are useful only as context. This file is the source of truth for the implementation pass.

## High-Level Cursor Model

Cursor does not model split chats as regular editor tabs. Glass chat splits are a separate persisted tiling system with stable identities:

- `tilesetId`: persisted group of tiled agent/draft panes.
- `panelId`: leaf id inside the tiling manager, usually `panel-1`, `panel-2`, etc.
- `agentId`: real chat/agent id.
- `draftId`: empty composer tile id.
- leaf data: `kind: "agent" | "empty" | "loading"`.

Important storage and mutation anchors:

- `agentLayout.shared.v6`
- `__glass_new_agent_tile__`
- `dropAgentOnPanel`
- `dropAgentOnSelectedAgent`
- `splitTile`
- `splitActiveTile`
- `closeFocusedTile`
- `agent_layout.tileset_created`
- `agent_layout.tileset_mutated`

Practical implication for Honk: chat split state needs explicit pane identities. Do not derive split behavior from DOM order, visible tab order, or the currently hovered panel.

## Top Bar Structure

`content-pane-top-bar` is in `workbench.glass.main.js/css`.

Verified anchors:

- `content-pane-top-bar`
- `content-pane-top-bar__action-group`
- `content-pane-top-bar__scroll-area`
- `content-pane-top-bar__trailing-wrap`
- `GWP` top bar component vicinity in the Glass bundle

Observed structure:

- Root top bar owns the draggable titlebar/background region via `WebkitAppRegion: "drag"`.
- Action groups opt out with no-drag behavior and keep pointer events enabled.
- Leading actions, central scroll area, and trailing actions are separate zones.
- Trailing actions are pushed with auto margin.
- The scroll area hides scrollbars and adjusts spacing when system/sidebar controls are visible.

Practical implication for Honk: the drag affordance should belong to the non-interactive top bar/background. Interactive tabs, buttons, menus, close buttons, and tool islands must explicitly opt out of shell dragging.

## Drag And Drop Library

Cursor bundles `@dnd-kit` symbols, including `DndContext` and `DragOverlay`, but the inspected shell tab and chat tiling paths use Cursor's own native HTML5 drag wrapper.

Important identifiers:

- `application/x-cursor-draggable`
- `AFt(...)` typed payload factory
- `v3e=AFt("tab", ...)`
- `x8d=AFt("tiling-panel", ...)`
- `u4n` / `useDraggable`
- `DFt` / `useDroppable`
- Glass equivalents: `odt` draggable and `ldt` droppable
- `data-no-drag`

The wrapper behavior:

- `useDraggable` sets a typed payload in a singleton transfer store and mirrors it into `DataTransfer`.
- `useDroppable` validates payload type/schema, prevents default only for valid drops, sets `dropEffect = "move"`, and throttles drag-over handling.
- Global pointer handling checks `[data-no-drag]` so nested controls can prevent drag initiation.

Practical implication for Honk: native drag events are enough for parity. The critical detail is not the library; it is the hit-testing contract around tabs and headers.

## Tab Drag Contract

Cursor tab behavior:

- Tab item itself is draggable.
- Pointer down still activates/selects the tab before a drag starts.
- Close/copy/menu controls carry `data-no-drag` and stop pointer propagation.
- Drag preview and drop indicators are visual-only overlays with `pointer-events: none`.
- Tab insertion preview is a 2px absolute bar.

Cursor avoids a permanent broad drag layer over the tab strip. That is the key parity requirement for the current Honk bug: dragging cannot block tab selection.

Honk already has partial native HTML5 tab drag in `right-workbench-header.tsx` with:

- `WORKBENCH_TAB_DRAG_MIME_TYPE = "application/x-honk-workbench-tab"`
- `draggable` tabs
- `data-no-drag` / `data-shell-no-drag` on close affordances
- `.ui-tab-system-drop-indicator`

Implementation should tighten this existing path instead of replacing it with a separate overlay.

## Tiled Chat Drag Contract

Cursor tiled panels use a different contract from tabs:

- Header is the drag handle.
- Whole panel is the drop target.
- Drops across different tiling managers are rejected by `managerId`.
- Panel root tracks focused/dragging/drop-active state.
- Pointer/focus entry sets focused panel.
- Drop preview is rendered by the panel target, not by a blocking overlay that intercepts controls.

Important identifiers:

- `TilingSystemManager`
- `TilingSystemSlot`
- `TilingSystemDropOverlay`
- `calculateDropZone`
- `getDropOverlayBounds`
- `ui-tiling-panel`
- `ui-tiling-drop-overlay-highlight`
- `glass-agent-conversation-tiling`
- `glass-agent-conversation-tiling__header`
- `glass-agent-drop-target`

Observed tiling constants:

- `minPanelSize: 50`
- `sashLayoutSize: 1`
- `sashSize: 4`
- `sashHoverSize: 12`
- `edgeThreshold: 0.375`

Practical implication for Honk: use panel-wide drop targets, but only the header/title region should initiate pane dragging.

## Drop Zone Geometry

Zones:

- `left`
- `right`
- `top`
- `bottom`
- `center`

Cursor maps edge zones to half-panel overlays:

- `left`: left half
- `right`: right half
- `top`: top half
- `bottom`: bottom half
- `center`: full panel

Split mapping:

- `left` => horizontal split before target
- `right` => horizontal split after target
- `top` => vertical split before target
- `bottom` => vertical split after target
- `center` => replace/retarget, with helper fallback to horizontal after in some paths

Practical implication for Honk: `center` is not another visual split. It should be a replace/retarget path or be disallowed where replacement is not supported.

## Drop Preview Styling

Cursor's tiled split preview is subtle and visual-only:

- overlay root: absolute, inset slightly, high z-index, `pointer-events: none`
- highlight background: accent mixed at roughly 28%
- highlight outline: 1px solid accent mixed at roughly 62%
- outline offset: `-1px`
- radius: small radius token
- transition: top/left/width/height with fast duration/easing

VS Code editor-group overlays in the desktop bundle are separate:

- `monaco-workbench-editor-drop-overlay`
- `editor-group-overlay-indicator`
- dark fallback around `#53595D` at 50% alpha
- light fallback around `#2677CB` at 18% alpha
- optional 2px dashed outline

Practical implication for Honk: chat split preview should use the Cursor Glass tiling style, not the heavier VS Code editor-group overlay.

## Chat Tile Render Flow

The Glass tile render path:

- `qJP`: renders the whole tileset root.
- `RJP`: renders the tile header and receives the drag handle ref.
- `OJP`: renders an agent tile.
- `BJP`: renders an empty tile.
- `ywp`: chat view component used inside tiles.

Important tiled props observed:

- `manager`
- `composerMaxWidthPx`
- `editorPanelFocusedRef`
- `selectedAgentRef`
- `onActivateAgent`
- `onSplitPanel`
- `onClosePanel`
- `onDropAgent`
- `onExpandAgent`
- `onHandleChange`
- `showFilesButtonOnTopRightTile`
- `showPanelButtonOnTopRightTile`
- `topLeftLeadingControls`
- `rootWorkspace`

Important tiled chat props into `ywp`:

- `agentRef`
- `agentWorkspace`
- `composerMaxWidthPx`
- `conversationRadius: 0`
- `editorPanelFocusedRef`
- `focusPromptOnActivate`
- `isActiveSurface`
- `selectedAgent`
- `selectedAgentId`
- `scrollRestoreStore`
- `rootWorkspace`

Standalone chat also uses `ywp`, but keeps standalone affordances such as sidecar/status bar and nonzero conversation radius.

Practical implication for Honk: tiled panes should move shell controls into the tile header and remove standalone card-like conversation radius from tile bodies.

## Mutation Flow

Cursor controller callbacks:

- `dropAgentOnPanel`: drop onto an existing tiled panel.
- `dropAgentOnSelectedAgent`: drop onto standalone/selected agent.
- `splitTile`: split a specific panel id.
- `splitActiveTile`: split the active/standalone surface.
- `closeTile` / `closeFocusedTile`: close panels and collapse out of tileset mode when only one real agent remains.

Behavior summary:

- Dropping the new-agent payload creates an empty draft tile and focuses it.
- Dropping an existing draft places the draft into the target.
- Dropping an existing agent moves/replaces/splits depending on zone.
- Cross-tileset moves prompt before removing from the source.
- Splits create empty draft tiles by default.
- Splitting focuses the new panel.
- Moving an existing agent focuses the moved panel.

Practical implication for Honk: focus and selection should be updated as part of the mutation, not as an afterthought in hover handlers.

## Focus And Selection

Cursor has three distinct focus layers:

- tiling manager focus: focused `panelId`
- selected agent: shell/chat selection
- prompt/editor focus: composer/input focus refs

Observed behavior:

- Panel focus is set on mouse/focus capture.
- Focused panel data syncs selected agent.
- Empty focused panels can keep draft selection or clear selected agent.
- Selection marks unread agents read before selecting.
- Closing a panel re-focuses another available agent panel.

Practical implication for Honk: selection should be derived from focused panel data. Do not infer selected chat from drag hover or from the last tab clicked if panel focus has changed.

## Responsive Chat / Screen Size Correlation

Cursor does not key chat mode directly from `window.innerWidth`.

The responsive model computes state from the available center/fill pane after accounting for adjacent panes such as sidebar and editor panel.

Verified anchors:

- `computeResponsivePaneLayout`
- `U8C=448`
- `narrowThreshold`
- `editorPanelDisallowed`
- `editorPanelVisible`
- `isNarrow`
- `sidebarOverlayMode`
- `sidebarVisible`

Behavior:

- `isNarrow` becomes true below a computed center-pane width of `448px`.
- A wide desktop window can still enter narrow chat mode if the sidebar/editor panel consumes enough width.
- Sidebar overlay mode is chosen when fixed sidebar plus required center/editor widths cannot fit.
- Empty-state project selector moves into the top bar only in empty-state + narrow mode.
- Empty-state "Open Editor Window" is direct on wide panes and menu-only on narrow panes.
- Mini sidebar rail is considered only for standalone agent mode when editor panel is not visible/disallowed and tileset mode is inactive.

Practical implication for Honk: responsive decisions should live in shell layout state and use available center pane width, not viewport width alone.

## Width Constants

Relevant Cursor sizing:

- `cursor.chatMaxWidth` default: `840`
- CSS variable: `--composer-max-width`
- Glass content path fallback: roughly `780`, with a `16px` adjustment in the viewport/content calculation
- Composer/editor group preferred split width: `450`
- Composer editor minimum width: roughly `300`
- Floating composer minimum geometry: `320 x 320`
- Auxiliary chat initial width path: about `min(400, windowWidth / 2.5)`

Practical implication for Honk: chat content width, shell pane width, and split preferred width are separate concepts. Do not make split pane width equal to message max width.

## Maximize / Fullscreen

Cursor exposes:

- `workbench.action.maximizeChatSize`
- `toggleUnifiedMaximizeState`
- `setUnifiedMaximizeState`
- context key `agentChatMaximized`

Cursor maximize behavior is grid reflow:

- hides editor
- hides panel
- hides primary sidebar by default
- keeps unified sidebar and auxiliary/chat surfaces visible
- resizes chat/auxiliary area to fill remaining width
- restores cached sizes/visibility on exit

Honk already has a related right-workbench fullscreen path:

- `workspace-editor-store.ts` stores `fullscreenByWorkspaceKey`
- `getWorkspaceFullscreenTarget(workspaceKey)` reads workspace-only state
- `shell-layout-service.tsx` computes `editorPanelFullscreen` using `getWorkspaceFullscreenTarget(config.workspaceKey)`
- `app.tsx` toggles/exits fullscreen using `props.workspaceKey`
- `ShellLayoutConfig` already carries `routeThreadId`

New user requirement: fullscreen mode must be per thread too.

Implementation requirement:

- Scope fullscreen by workspace and thread, not workspace alone.
- Switching threads in the same workspace must not inherit another thread's right-workbench fullscreen state.
- Escape and fullscreen keybinding handlers must exit/toggle only the active workspace/thread scope.
- Shell layout service should read fullscreen with both `workspaceKey` and `routeThreadId`.
- A null thread should have an explicit fallback scope, not accidentally share state with all threads.
- New-thread handling should exit only the relevant thread scope or intentionally clear the source scope; it should not blanket-clear workspace fullscreen unless that is a product decision.

Suggested local design:

- Replace `fullscreenByWorkspaceKey` with a scoped record such as `fullscreenByScopeKey`.
- Add a resolver like `resolveWorkspaceThreadFullscreenKey(workspaceKey, threadId)`.
- Thread scope can be `${resolvedWorkspaceKey}:${threadId ?? "__no_thread__"}` or a small structured helper that cannot collide with workspace ids.
- Update `enterFullscreen`, `exitFullscreen`, `toggleFullscreen`, `useWorkspaceFullscreenTarget`, `getWorkspaceFullscreenTarget`, and `workspaceEditorActions` to accept `threadId`.
- Update call sites in `app.tsx`, `shell-layout-service.tsx`, and `use-handle-new-thread.ts`.

## Honk Implementation Checklist

1. Keep tab dragging on the tab element and preserve pointer-down selection.
2. Ensure every tab action/control has `data-no-drag` / `data-shell-no-drag` and stops pointer down propagation.
3. Do not place a permanent absolute drag layer over tab labels.
4. Use panel-wide drop targets for split panes, with header-only drag handles.
5. Reject invalid/cross-manager drops using typed payload metadata.
6. Compute drop zone from pointer position and target rect.
7. Render split preview as `pointer-events:none` half/full highlight rectangles.
8. Use subtle accent fill and a 1px accent outline for previews.
9. Treat `center` drops as replacement/retarget or disallow them where unsupported.
10. Focus the resulting panel immediately after split/drop.
11. Sync selected chat from focused panel data.
12. Drive responsive chat state from center pane width, starting with the `448px` threshold.
13. Keep content max width separate from pane/split width.
14. Scope fullscreen by workspace and thread.
15. Keep fullscreen as shell layout reflow, not CSS-only hiding of children.

## Follow-up Sidebar Chat Drag Cross-check

Latest bundle pass focused on dragging a sidebar chat row into the chat surface.

Cursor anchors:

- Drag payload class: `dAb=sdt("glass-agent", ...)` near byte `60668137`.
- New-agent marker: `SOC="__glass_new_agent_tile__"` near byte `60668106`.
- Existing sidebar row path creates `new dAb({ agentId: t.id })` near byte `61030893`.
- Native drag wrapper writes MIME `application/x-cursor-draggable`; the native data stores the payload type and the typed payload is retained by Cursor's drag transfer registry.
- Agent drop wrapper `kOC` accepts the `glass-agent` payload, rejects self-drops, computes zone via `aci`, renders `oih({ zone })`, then calls `onDropAgent(draggedAgentId, zone)`.
- Standalone pane passes `new Set(["center"])`, so center drops are disallowed and the pointer resolves to a nearest edge.
- Tiled panes do not pass disallowed zones, so center drops are accepted.
- Center semantics:
  - external agent + center replaces the target panel data;
  - existing same-manager agent + center moves/swaps through the manager path;
  - new-agent/draft helpers use center to reuse empty targets and otherwise fall back to a split-after direction.
- Sidebar row drag uses a custom cloned drag preview with `setDragImage(...)`, plus source-row dragging opacity.

Implementation implication for Honk:

- The sidebar chat row itself should be draggable; no separate dragger should be introduced.
- Standalone chat surfaces should reject center and show edge-only tile previews.
- Already tiled chat panes should accept center drops for replace/move, while edge drops create or move tiles.
- Use a native custom MIME in Honk for now; there is no shared typed drag registry equivalent in the local code path.
- Keep the drop overlay pointer-transparent with accent fill around `28%`, accent outline around `62%`, small radius, and a short position transition.
- The sidebar-selected chat should come from focused tile data while a route tileset is active; clicking a sidebar chat that already exists in the current tileset should focus that tile instead of navigating away from the tileset.

## Open Risks

- Exact compact/wide UI differences beyond the `448px` narrow threshold were not replayed interactively in Cursor.
- StyleX hash class names are not stable implementation targets; use semantic classes, tokens, and behavior instead.
- The desktop bundle contains VS Code editor DnD overlays that are visually different from Glass chat tiling overlays. Use the Glass path for chat parity.
- Honk's current worktree has unrelated existing changes. The implementation pass must avoid reverting or rewriting those changes.
