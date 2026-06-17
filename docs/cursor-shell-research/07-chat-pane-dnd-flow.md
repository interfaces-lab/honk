# Cursor Chat Pane Drag, Drop, Split Research

Date: 2026-06-17

Scope: reverse-engineer Cursor's bundled workbench behavior for creating, moving, splitting, focusing, and rendering chat/content panes. Primary requested file was `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`; the active Glass chat pane implementation and `content-pane-top-bar` live in the sibling Glass bundle:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.css`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` still contains shared composer constants and command registrations.

This note intentionally records identifiers, byte-offset grep anchors, behavior, and short labels only. It does not paste long proprietary source.

## Research Split

This note is one slice of a five-subagent research pass. The consolidated implementation handoff is `docs/cursor-shell-research/09-chatview-split-dnd-research-review.md`.

The pass was split into five workstreams:

1. bundle/module anchors and command ids
2. top bar and app-region structure
3. drag/drop hooks, payloads, and overlay preview
4. tileset layout state and mutation callbacks
5. responsive layout, chat props, focus, and selection sync

## High-Level Architecture

Cursor does not treat split chats as ordinary editor groups. The Glass chat area has its own tiling system and persists a separate `agentLayout.shared.v6` state tree.

The key identities are:

- `tilesetId`: persisted group of tiled agents/drafts
- `panelId`: leaf id inside the tiling manager, usually `panel-1`, `panel-2`, etc.
- `agentId`: real chat/agent id
- `draftId`: empty-state composer id used for "New Agent" panes
- layout leaf data: `kind: "agent" | "empty" | "loading"`

The main mutation surface returned by the controller is:

- `dropAgentOnPanel`
- `dropAgentOnSelectedAgent`
- `splitTile`
- `splitActiveTile`
- `closeTile`
- `closeFocusedTile`
- `focusAdjacentTile`
- `navigateToAgent`
- `expandAgent`
- `exitToStandalone`

Grep anchors:

- `workbench.glass.main.js:61409274` storage schemas for tilesets/layout
- `workbench.glass.main.js:61417966` `agent_layout.tileset_created`
- `workbench.glass.main.js:61418310` `agent_layout.tileset_mutated`
- `workbench.glass.main.js:61435606` `dropAgentOnPanel`
- `workbench.glass.main.js:61435626` `dropAgentOnSelectedAgent`
- `workbench.glass.main.js:61435667` `splitActiveTile`
- `workbench.glass.main.js:61435699` `closeFocusedTile`
- `workbench.desktop.main.js:467211` shared constants including `workbench.panel.aichat.view`, `composer.composerData`, `agentLayout.shared.v6`

## Drag And Drop Library / Hooks

Cursor uses two DnD systems in the Glass bundle:

- Chat pane and tiling drag/drop use local hook abstractions named `odt` for draggable and `ldt` for droppable.
- Sidebar section sorting also includes `@dnd-kit`/`DndContext`/`DragOverlay`, but that is not the core chat pane drop path.

Relevant grep anchors:

- `workbench.glass.main.js:61031404` sidebar row creates `new dAb({ agentId })`
- `workbench.glass.main.js:61141909` sidebar "new agent" item creates `new dAb({ agentId: SOC })`
- `workbench.glass.main.js:60668622` `SOC="__glass_new_agent_tile__"` and `dAb` payload type
- `workbench.glass.main.js:60668744` `function kOC` agent drop target
- `workbench.glass.main.js:4862772` `aci` drop-zone computation
- `workbench.glass.main.js:4870255` `dropOverlay`
- `workbench.glass.main.js:4870602` `ui-tiling-drop-overlay-highlight`
- `workbench.glass.main.js:17388081` StyleX object `Ivg` for tiling overlay/panel styles
- `workbench.glass.main.js:31003872` `DndContext`
- `workbench.glass.main.js:31043515` `DragOverlay`

## Agent Drop Target Flow

`kOC` is the drop-target wrapper used around standalone and tiled agent panes.

Props observed:

- `agentId`
- `children`
- `className`
- `disabled`
- `disallowedZones`
- `onDropAgent`

Behavior:

1. It stores the DOM node and current hover zone in refs/state.
2. It rejects self-drops by comparing dragged payload `agentId` with the target `agentId`.
3. On drag-over it reads the target `getBoundingClientRect()`.
4. It calls `aci(clientX, clientY, rect, edgeThreshold, disallowedZones)`.
5. It stores the current zone and renders `oih({ zone })` while active.
6. On drop it calls `onDropAgent(draggedAgentId, zone)`.

The drop-zone algorithm chooses the nearest allowed edge if the pointer is within the edge threshold; otherwise it uses `center` if allowed. Zones are:

- `left`
- `right`
- `top`
- `bottom`
- `center`

`center` means replacement/retarget in several paths; edges mean split before/after.

## Drop Preview / Highlight

Cursor's preview is a full overlay with a child highlight rectangle. The overlay is rendered by `oih`, and the highlight rectangle is computed by `WGf(zone)`:

- `left`: left half
- `right`: right half
- `top`: top half
- `bottom`: bottom half
- `center`: whole pane

The semantic highlight class is `ui-tiling-drop-overlay-highlight`, with StyleX classes generated from `Ivg.highlight`. Because StyleX hashes the final class names, the stable grep anchors are the JS identifiers rather than readable CSS selectors.

Panel and tile CSS anchors:

- `workbench.glass.main.css:1602073` `.glass-agent-conversation-tiling`
- `workbench.glass.main.css:1602132` `.glass-agent-drop-target`
- `workbench.glass.main.css:1602320` `.ui-tiling-panel` under the agent tiling shell
- `workbench.glass.main.css:1602627` `.glass-agent-conversation-tiling__header`
- `workbench.glass.main.css:1604300` header action visibility rules

Important visual details:

- The tiling root uses `background: var(--glass-chat-surface-background)`.
- `.ui-tiling-panel` border radius is `0`; focus outline color is transparent.
- Inactive tiles are visually dimmed via `--glass-agent-panel-inactive-tile-filter`.
- Header actions are hidden with `opacity: 0` and `pointer-events: none` until the panel is focused, the header is hovered, or the menu is open.
- The header cursor is `grab`/`grabbing`; the whole pane is not the drag handle.

## Internal Tiling Drag Flow

The generic tiling component renders each leaf through a slot function, anchored around `enw`.

Key behavior:

1. `enw` receives `node`, `manager`, `registerSlot`, and `renderPanelHeader`.
2. It creates a panel drag payload with `{ panelId, managerId }`.
3. It wires `odt({ id: "tiling-panel-" + panelId, data })` to a `dragHandleRef`.
4. It wires `ldt({ accept: phh, onDragOver, onDrop })` to the panel slot.
5. It only accepts panel drags from the same manager.
6. On drop it calls `manager.move(sourcePanelId, targetPanelId, zone)`.
7. It calls `manager.setFocusedPanel(panelId)` on pointer/focus entry.

This is the main parity point for our implementation: drag initiation is scoped to the header handle, while drop targeting is panel-wide.

Grep anchors:

- `workbench.glass.main.js:4871878` `TilingSystemDropOverlay`
- `workbench.glass.main.js:4872600` `TilingSystemSlot` vicinity
- `workbench.glass.main.js:17388081` StyleX panel styles `Qa_`, `Za_`, `Xa_`

## Agent Tile Rendering Flow

`qJP` renders a whole tileset.

Props observed on `qJP`:

- `manager`
- `onActivateAgent`
- `onSelectAgentForFollowupSlash`
- `onNewAgentWithContent`
- `onDidSendFollowupUserMessage`
- `onActivePromptInputChange`
- `onExpandAgent`
- `onSplitPanel`
- `onClosePanel`
- `onDropAgent`
- `composerMaxWidthPx`
- `editorPanelFocusedRef`
- `selectedAgentRef`
- `onHandleChange`
- `onCopyToClipboard`
- `pinnedAgentIds`
- `onPinAgent`
- `onUnpinAgent`
- `onRenameAgent`
- `onOpenFilesPanel`
- `onEnterEditorPanelFullscreen`
- `onOpenExternal`
- `showDevOptions`
- `showFilesButtonOnTopRightTile`
- `showPanelButtonOnTopRightTile`
- `topLeftLeadingControls`
- `onShowPanel`
- `rootWorkspace`
- empty-state modal/connect handlers

Render path:

1. `qJP` renders `Pwp.Root` with class `glass-agent-conversation-tiling`.
2. Each panel content is wrapped with `kOC` using class `glass-agent-conversation-tiling__drop-target`.
3. Empty tiles render `BJP`.
4. Agent tiles render `OJP`.
5. `OJP` renders the chat view component `ywp`.
6. Header rendering goes through `RJP`, which receives the `dragHandleRef`.

Grep anchors:

- `workbench.glass.main.js:60678839` `function RJP`
- `workbench.glass.main.js:60687125` `function OJP`
- `workbench.glass.main.js:60690206` `function qJP`
- `workbench.glass.main.js:60675381` tiled header menu "Split Down"
- `workbench.glass.main.js:60675498` tiled header menu "Split Right"

## Chat View Props

Tiled agent panes call `ywp` through `OJP` with these important props:

- `agentRef`
- `agentWorkspace`
- `composerMaxWidthPx`
- `conversationRadius: 0`
- `editorPanelFocusedRef`
- `focusPromptOnActivate`
- `isActiveSurface`
- `onActivePromptInputChange`
- `onDidSendFollowupUserMessage`
- `onNewAgentWithContent`
- `onSelectAgent`
- `scrollRestoreStore`
- `selectedAgent`
- `selectedAgentId`
- `onHandleChange`
- `rootWorkspace`

Standalone agent mode also calls `ywp`, but with `conversationSidecar`, `showUsageStatusBar`, and a nonzero conversation radius token. In tiled mode the tile surface removes the conversation radius and uses the tileset header for shell controls.

## Creating / Moving / Splitting Flow

The layout helpers near the controller are the most important implementation model:

- `VAR(initialAgentIds)`: creates an initial tree. No agents creates one empty draft leaf; multiple agents reduce into horizontal branches.
- `ee0({ initialAgentIds, focusedAgentId })`: initializes `Pwp` manager and focuses the matching panel.
- `w8t(manager, agentId)`: find panel id for an agent.
- `te0(manager, draftId)`: find panel id for a draft.
- `nZn(manager)`: focused panel id, else first panel.
- `ten(manager)`: focused agent id, else first agent in panel order.
- `EYv(zone)`: maps `left/right/top/bottom/center` to split direction and before/after position.
- `se0({ manager, agentId, targetPanelId, zone, isDraftId })`: core agent drop/move helper.

`EYv` mapping:

- `left` => horizontal before
- `right` => horizontal after
- `top` => vertical before
- `bottom` => vertical after
- `center` => horizontal after fallback

`se0` behavior:

1. Ignore draft ids.
2. If the agent already exists in the manager, move that source panel to the target/zone and focus the source panel.
3. If target zone is `center`, replace the target panel data with `{ kind: "agent", agentId }`.
4. Otherwise split the target panel in the mapped direction/position and focus the new panel.

Grep anchors:

- `workbench.glass.main.js:47733308` `VAR`, `ee0`, panel lookup helpers
- `workbench.glass.main.js:47735000` `EYv`
- `workbench.glass.main.js:47735546` `se0`

## Controller Mutation Callbacks

The main controller function is around `ciD`.

Drop on an existing tiled panel: `He`

- Entry point defaults to `tileset_drop_target`.
- Normalizes dragged id through `V5C` into `new-agent`, `draft`, `agent`, or `unknown`.
- `new-agent`: creates/focuses an empty draft tile via `_e`, tracks `drop_new_agent`.
- `draft`: uses `Re` to place the draft into the target/zone, tracks `drop_draft`.
- `agent`: uses `se0`, optionally prompts when moving from another tileset, removes it from the old tileset via `ye`, then selects/focus-syncs it.

Drop on standalone/selected agent: `Be`

- Entry point defaults to `standalone_drop_target`.
- If no current selected agent exists, it creates a two-panel tileset directly via `Pe`.
- If current selected agent exists but is not in a tileset, it creates a tileset from that agent via `xe`, then applies the drop.
- If selected agent is already in a tileset, it routes the drop into that tileset.
- Cross-tileset agent moves prompt with "Move ...?" semantics before removal from the source tileset.

Split a specific tile: `je`

- Resolves provided panel id or focused panel.
- Default split data is a new empty draft.
- Calls `manager.split(panelId, direction, "after", data)`.
- Focuses the new panel and tracks `action: "split"`.

Split active tile or standalone surface: `De`

- If a tileset is active, delegates to `je`.
- If a standalone selected agent exists, creates a tileset from that agent first, then splits.
- If no selected agent exists, creates a two-empty-panel tileset.

Close tile: `Ke` / close focused tile: `Ye`

- Calls `manager.close(panelId)`.
- Disposes empty draft data when needed.
- Tracks `remove_tile`.
- If the tileset collapses to a single real agent, exits tileset mode and restores the standalone agent selection.

Relevant controller anchors:

- `workbench.glass.main.js:61422000` mutation callback cluster starts
- `workbench.glass.main.js:61423558` cross-tileset remove/move prompt vicinity
- `workbench.glass.main.js:61426000` `He` tile drop path vicinity
- `workbench.glass.main.js:61428000` `Be` standalone drop path vicinity
- `workbench.glass.main.js:61431000` `je` / `De` split path vicinity
- `workbench.glass.main.js:61433000` close/focus cleanup vicinity

## Focus And Selection Handling

Focus has three layers:

1. Tiling manager focus: `manager.focusedPanelId`.
2. Agent selection: `selectedAgentId` passed down from the agent panel shell.
3. Prompt/editor focus: `editorPanelFocusedRef`, `focusPromptOnActivate`, and sidecar/editor visibility state.

Observed behavior:

- `enw` calls `manager.setFocusedPanel(panelId)` on mouse/focus capture.
- `qJP` subscribes to `panel-focused`; when focused panel data is an agent it calls `onActivateAgent(agentId)`.
- The controller watches focused panel data and syncs `onSelectAgent` when the focused panel changes.
- If the focused panel is empty, it may select the draft id or clear selected agent while preserving editor panel visibility.
- Selection marks unread agents read before calling `onSelectAgent`.
- Closing a panel re-focuses another agent panel when possible.
- Splitting focuses the new panel.
- Moving an existing agent focuses the moved source panel.

Grep anchors:

- `workbench.glass.main.js:60691000` `qJP` panel-focused subscription vicinity
- `workbench.glass.main.js:61434000` focused staged tile and focus-adjacent logic
- `workbench.glass.main.js:61436000` focused panel data sync effect vicinity
- `workbench.glass.main.js:60773911` mark-read/select-agent path vicinity

Implementation implication for Honk: focus should be panel-id first, selection second. Do not infer selected chat solely from hover/drop state.

## Top Bar / Shell Structure

`content-pane-top-bar` lives in the Glass bundle, not the desktop bundle.

Grep anchors:

- `workbench.glass.main.js:60739117` top bar style object with `WebkitAppRegion`
- `workbench.glass.main.js:60740226` action group component
- `workbench.glass.main.js:60740396` `GWP` top bar component vicinity
- `workbench.glass.main.js:60784369` `GWP` invocation from agent panel shell
- `workbench.glass.main.css:1692549` `.content-pane-top-bar`
- `workbench.glass.main.css:1692617` `.content-pane-top-bar__action-group`
- `workbench.glass.main.css:1692828` `.content-pane-top-bar__trailing-wrap`
- `workbench.glass.main.css:1692946` `.content-pane-top-bar__scroll-area`

Observed structure:

- Top bar root uses `-webkit-app-region: drag`.
- Action groups use `-webkit-app-region: no-drag` and `pointer-events: auto`.
- Left and right action groups are separate from a central scroll area.
- When sidebar/system controls are visible, the bar sets `data-show-system-buttons`.
- `content-pane-top-bar__trailing-wrap` is pushed right with `margin-left: auto`.
- `content-pane-top-bar__scroll-area` hides its scrollbar and has responsive left padding when system buttons are present.

This is why Cursor's top nav remains draggable without blocking buttons or tabs. Any local parity implementation should give the drag region to the bar/background, not to the interactive controls.

## Responsive Chat/Screen Size Correlation

Cursor computes narrow state from the center/fill pane after subtracting sidebar and editor panel widths, not directly from the whole window.

Responsive layout anchors:

- `workbench.glass.main.js:61597605` `computeResponsivePaneLayout`
- `workbench.glass.main.js:61600515` `U8C=448`
- `workbench.glass.main.js:61600905` `narrowThreshold: U8C`
- `workbench.glass.main.js:61600995` `function VrD`
- `workbench.glass.main.js:61601276` `function KrD`
- `workbench.glass.main.js:61601845` `function YrD`
- `workbench.glass.main.js:60784300` `function izP`

Pane model:

- docked pane: sidebar, fixed sizing
- fill pane: center/chat, fill sizing
- ratio pane: editor panel, ratio sizing

Snapshot fields consumed by the chat shell:

- `editorPanelDisallowed`
- `editorPanelVisible`
- `isNarrow`
- `sidebarOverlayMode`
- `sidebarVisible`

Observed UI correlations:

- `isNarrow` turns true when the computed center pane width drops below `448px`.
- Sidebar overlay mode is entered when the fixed sidebar plus required center/editor widths cannot fit.
- Empty-state project selector moves into the top bar only when empty-state and `isNarrow`.
- Empty-state "Open Editor Window" is direct CTA on wide center panes and menu-only on narrow center panes.
- Split actions are available from standalone agent/loading/empty-state surfaces, but hidden once already in tileset mode; tiled panes use tile header menus.
- Mini sidebar rail is only considered for standalone agent panel mode when the editor panel is not visible/disallowed and tileset mode is inactive.

Important nuance: a large desktop window can still produce narrow chat behavior if the sidebar/editor panel leaves the center pane under the threshold.

## Commands And Menus

Shared composer command constants in desktop bundle:

- `workbench.desktop.main.js:18726528` `composer.openAsPane`
- `workbench.desktop.main.js:18726554` `composer.openAsBar`
- `workbench.desktop.main.js:18726579` `composer.openChatAsEditor`
- `workbench.desktop.main.js:18727117` `composer.toggleChatAsEditor`
- `workbench.desktop.main.js:18728067` `composer.createNewComposerTab`
- `workbench.desktop.main.js:30432477` `composer.split`
- `workbench.desktop.main.js:36845791` menu label "Split Down"
- `workbench.desktop.main.js:36846077` menu label "Split Right"

Glass action path:

- `workbench.glass.main.js:60769442` `splitActiveTile`
- `workbench.glass.main.js:60771116` `closeFocusedTile`
- `workbench.glass.main.js:60768400` top-bar action callbacks call horizontal/vertical split
- `workbench.glass.main.js:60673000` `Naf` menu model includes `split-down` and `split-right`

Top-bar/menu commands call `splitActiveTile(direction, data, metadata)`. Tile header menus call `splitTile(panelId, direction)`.

## Sidebar Drag Preview

The sidebar agent row uses `odt` with a `dAb` payload and sets a custom native drag image on drag start.

CSS anchors:

- `workbench.glass.main.css:1762213` sidebar section drop indicator
- `workbench.glass.main.css:1769592` `.glass-sidebar-agent-menu-btn[data-drag-over=true]`
- `workbench.glass.main.css:1769800` `.glass-sidebar-agent-drag-preview`

Important distinction:

- Sidebar row drag preview uses styled DOM/custom drag image.
- Chat pane target preview uses the tiling overlay/highlight, not the sidebar preview.

## Practical Parity Notes For Honk

1. Model chat splitting as a separate tiling tree, not as editor tabs.
2. Keep stable ids for tileset, panel, agent, and draft; never infer them from DOM order.
3. Use panel-wide drop targets but header-only drag handles.
4. During drag-over, compute `left/right/top/bottom/center` from pointer position and target rect.
5. Render the drop preview as an overlay with half/full highlight rectangles.
6. Treat `center` as replacement/retarget, not a split.
7. On cross-group agent moves, remove from the source group only after confirmation.
8. Focus the resulting/moved/new panel immediately after split/drop.
9. Sync selected agent from focused panel data, not from drag hover.
10. Top bar should use app-region drag on the shell and no-drag on every interactive group.
11. Responsive decisions should use available center pane width, not global viewport width.
12. Keep split actions split by context: standalone top bar/menu uses active tile; tiled header menu uses explicit panel id.
