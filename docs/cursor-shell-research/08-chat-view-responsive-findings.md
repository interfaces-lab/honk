# Cursor Chat View Responsive Findings

Date: 2026-06-17

Superseded by `docs/cursor-shell-research/09-chatview-split-dnd-research-review.md`.

Status: incomplete. The requested five-subagent binary pass was interrupted before those agents returned. This note synthesizes the existing verified notes in `docs/cursor-shell-research`; I did not continue reverse-engineering the Cursor bundle after the interruption.

Primary requested source:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`

Important correction from prior notes:

- The active Glass chat pane, tiled agent layout, `content-pane-top-bar`, and responsive pane model were found in the sibling Glass bundle:
  - `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.js`
  - `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.css`
- The desktop bundle still has shared composer constants, editor sizing behavior, commands, and upstream VS Code workbench grid behavior.

## Screen Size Correlation

Cursor does not appear to key chat view mode directly from `window.innerWidth`. The responsive chat shell computes state from the available center/fill pane after accounting for adjacent panes such as the sidebar and editor panel.

Verified anchors from existing notes:

- `workbench.glass.main.js:61597605` `computeResponsivePaneLayout`
- `workbench.glass.main.js:61600515` `U8C=448`
- `workbench.glass.main.js:61600905` `narrowThreshold: U8C`
- `workbench.glass.main.js:61600995` `function VrD`
- `workbench.glass.main.js:61601276` `function KrD`
- `workbench.glass.main.js:61601845` `function YrD`
- `workbench.glass.main.js:60784300` `function izP`

Observed snapshot fields consumed by the chat shell:

- `editorPanelDisallowed`
- `editorPanelVisible`
- `isNarrow`
- `sidebarOverlayMode`
- `sidebarVisible`

Behavior summary:

- `isNarrow` becomes true when the computed center pane width is below `448px`.
- A large desktop window can still enter narrow chat behavior if sidebar/editor widths leave the center pane below `448px`.
- Sidebar overlay mode is entered when fixed sidebar plus required center/editor widths cannot fit.
- Empty-state project selector moves into the top bar only when empty-state and `isNarrow`.
- Empty-state "Open Editor Window" is a direct CTA on wide panes and menu-only on narrow panes.
- Mini sidebar rail is considered only in standalone agent panel mode when editor panel is not visible/disallowed and tileset mode is inactive.

## Width And Height Thresholds

Workbench / auxiliary chat pane:

- Auxiliary bar minimum width: `300px`.
- Auxiliary bar maximum width: unbounded.
- Preferred height: `mainContainerDimension.height * 0.4`.
- Preferred width: active pane optimal width with a `540px` floor.
- Initial auxiliary size default: `Math.min(400, windowWidth / 2.5)` from workbench grid state.

Composer and chat content:

- `cursor.chatMaxWidth` default: `840`.
- CSS variable: `--composer-max-width`, fallback `840px`.
- Glass path fallback: `Kew=780`, with a `16px` adjustment in the viewport/content calculation path.
- Composer editor group preferred split width: `450px`.
- Composer editor minimum width: about `300px`.
- Floating composer minimum geometry: `320px` width and `320px` height.

Relevant anchors:

- `workbench.desktop.main.js:467211` shared constants including `workbench.panel.aichat.view`, `composer.composerData`, `agentLayout.shared.v6`
- `workbench.desktop.main.js` grep anchor: `cursor.chatMaxWidth`
- `workbench.desktop.main.js` grep anchor: `workbench.editor.composer.input`
- `workbench.desktop.main.js` grep anchor: `_on=450`
- `workbench.desktop.main.js` grep anchor: `conversationMaxWidth`
- `workbench.desktop.main.js` grep anchor: `--composer-max-width`
- `docs/cursor-shell-research/04-auxiliarybar-editor-composer.md:171`
- `docs/cursor-shell-research/04-auxiliarybar-editor-composer.md:199`

## Split / Tiled Chat Model

Cursor treats split chats as an agent tiling system, not regular editor groups.

Stable identities:

- `tilesetId`: persisted tiled chat group.
- `panelId`: tiling leaf id, usually `panel-1`, `panel-2`, etc.
- `agentId`: real chat/agent id.
- `draftId`: empty-state composer id.
- Leaf data: `kind: "agent" | "empty" | "loading"`.

Primary storage / mutation anchors:

- `workbench.glass.main.js:61409274` storage schemas for tilesets/layout
- `workbench.glass.main.js:61417966` `agent_layout.tileset_created`
- `workbench.glass.main.js:61418310` `agent_layout.tileset_mutated`
- `workbench.glass.main.js:61435606` `dropAgentOnPanel`
- `workbench.glass.main.js:61435626` `dropAgentOnSelectedAgent`
- `workbench.glass.main.js:61435667` `splitActiveTile`
- `workbench.glass.main.js:61435699` `closeFocusedTile`

Tile rendering path:

- `qJP` renders the tileset root.
- `OJP` renders an agent tile.
- `ywp` is the chat view component used inside the tile.
- `RJP` renders the tiled header and receives the drag handle ref.
- Empty tiles render `BJP`.

Important props observed on `qJP` / tiled chat rendering:

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

Important props passed into tiled `ywp` through `OJP`:

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

Standalone chat also calls `ywp`, but with standalone-only affordances such as `conversationSidecar`, usage status bar, and nonzero conversation radius.

## Split Mapping

Drop zones:

- `left`
- `right`
- `top`
- `bottom`
- `center`

Mapping:

- `left` => horizontal split before target.
- `right` => horizontal split after target.
- `top` => vertical split before target.
- `bottom` => vertical split after target.
- `center` => replace/retarget; fallback mapping is horizontal after in helper paths.

Layout helpers:

- `VAR(initialAgentIds)` creates the initial tree; multiple agents reduce into horizontal branches.
- `ee0(...)` initializes the manager and focuses the matching panel.
- `w8t(manager, agentId)` finds a panel id for an agent.
- `te0(manager, draftId)` finds a panel id for a draft.
- `EYv(zone)` maps drop zone to split direction and before/after position.
- `se0(...)` is the core agent drop/move helper.

Anchors:

- `workbench.glass.main.js:47733308` `VAR`, `ee0`, panel lookup helpers
- `workbench.glass.main.js:47735000` `EYv`
- `workbench.glass.main.js:47735546` `se0`

## Drag, Drop, And Preview

Cursor has two relevant DnD paths:

- Local React/StyleX hook layer for tabs, tiled panels, and agent drops.
- `@dnd-kit` symbols exist in the bundle, but the inspected chat pane tiling path uses Cursor's local hooks, not that sortable layer.

Key identifiers:

- `odt`: draggable hook in Glass notes.
- `ldt`: droppable hook in Glass notes.
- `u4n`: desktop bundle `useDraggable`.
- `DFt`: desktop bundle `useDroppable`.
- `AFt(...)`: typed payload factory.
- `x8d=AFt("tiling-panel", ...)`: panel payload.
- `v3e=AFt("tab", ...)`: tab payload.
- `dAb`: agent drag payload.
- `SOC="__glass_new_agent_tile__"`: new-agent tile payload marker.

Tiling behavior:

- Panel root is the drop target.
- Header is the drag handle.
- Cross-manager panel drops are rejected by `managerId`.
- `minPanelSize` is `50`.
- `edgeThreshold` is `.375`.
- Pointer position is normalized against the target rect.
- Edge zones render half-panel previews; center renders full-panel preview.

Preview visual:

- Overlay root is absolute and `pointer-events:none`.
- Highlight uses accent background around 28% opacity and a 1px accent outline around 62% opacity.
- Radius is the small Cursor radius token.
- Transition applies to top/left/width/height.

Anchors:

- `workbench.glass.main.js:4862772` drop-zone computation
- `workbench.glass.main.js:4870255` `dropOverlay`
- `workbench.glass.main.js:4870602` `ui-tiling-drop-overlay-highlight`
- `workbench.glass.main.js:4871878` `TilingSystemDropOverlay`
- `workbench.glass.main.js:4872600` `TilingSystemSlot`
- `workbench.glass.main.js:17388081` StyleX overlay/panel styles
- `workbench.glass.main.css:1602073` `.glass-agent-conversation-tiling`
- `workbench.glass.main.css:1602132` `.glass-agent-drop-target`
- `workbench.glass.main.css:1602320` `.ui-tiling-panel`
- `workbench.glass.main.css:1602627` `.glass-agent-conversation-tiling__header`

## Maximize And Reflow

Command:

- `workbench.action.maximizeChatSize`

Path:

- `toggleUnifiedMaximizeState()`
- `setUnifiedMaximizeState(...)`
- Context key: `agentChatMaximized`

Enter maximized:

- Hides editor.
- Hides panel.
- Hides primary sidebar by default.
- Does not hide `workbench.parts.auxiliarybar`.
- Does not hide `workbench.parts.unifiedsidebar`.
- Activity bar, titlebar, statusbar, and unified sidebar remain visible.
- Auxiliary/chat width is explicitly resized to fill remaining width after fixed neighbors.

Width formula from notes:

- `auxWidth = max(auxiliaryBarPartView.minimumWidth, mainWidth - sidebarWidth - unifiedSidebarWidth - activityBarWidth)`

Exit maximized:

- Restores editor.
- Restores panel and primary sidebar from cached pre-maximize visibility/size.
- Resizes auxiliary bar back toward cached percentage.
- Unified sidebar stayed visible, so only its width ratio participates in redistribution.

Anchors:

- `workbench.action.maximizeChatSize`
- `toggleUnifiedMaximizeState`
- `setUnifiedMaximizeState`
- `agentChatMaximized`
- `getViewCachedVisibleSize`
- `setEditorHidden`
- `setPanelHidden`
- `setSideBarHidden`
- `workbench.parts.auxiliarybar`
- `workbench.parts.unifiedsidebar`

## Top Bar / Shell Structure

`content-pane-top-bar` was found in the Glass bundle, not the desktop bundle.

Anchors:

- `workbench.glass.main.js:60739117` top bar style object with `WebkitAppRegion`
- `workbench.glass.main.js:60740226` action group component
- `workbench.glass.main.js:60740396` `GWP` top bar component vicinity
- `workbench.glass.main.js:60784369` `GWP` invocation from agent panel shell
- `workbench.glass.main.css:1692549` `.content-pane-top-bar`
- `workbench.glass.main.css:1692617` `.content-pane-top-bar__action-group`
- `workbench.glass.main.css:1692828` `.content-pane-top-bar__trailing-wrap`
- `workbench.glass.main.css:1692946` `.content-pane-top-bar__scroll-area`

Behavior:

- Top bar root uses app-region drag.
- Interactive groups use no-drag and pointer events.
- Left and right action groups are separate from the center scroll area.
- Trailing group is pushed right with `margin-left: auto`.
- Scroll area hides its scrollbar.
- The drag region belongs to the bar/background, not controls.

## Implementation Implications For Honk

1. Derive responsive chat state from available center pane width, not global viewport width. The first hard threshold to mirror is `448px`.
2. Keep chat content max width separate from shell pane width. Cursor has an `840px` content cap, a `450px` chat editor-group preferred split width, and a `300px` pane/editor minimum path.
3. Model split chats as a tiling tree with stable `tilesetId`, `panelId`, `agentId`, and `draftId`. Do not map chat splits to editor tab groups.
4. Use panel-wide drop targets but header-only drag handles.
5. Render split previews as `pointer-events:none` overlays with half/full highlight rectangles, not as blocking drag zones.
6. Treat `center` drops as replacement/retarget behavior, not another split.
7. Sync selected chat from focused panel data. Do not infer selection from hover or drag-over state.
8. Keep shell reflow in the shell layout service/store. Collapse and maximize should resize/remove grid tracks, not hide leaf components with CSS while preserving dead space.
9. Preserve hidden pane widths for restore. Cursor uses grid cached visible size and explicit persisted width fields.
10. Top bar drag should be applied to the shell background; every button/tab/action group should opt out with no-drag semantics.
11. Split action surfaces differ by context: standalone top bar/menu splits the active surface; tiled header menu splits an explicit panel id.

## Gaps

- The current turn did not complete the requested five-subagent pass.
- I did not freshly verify the exact current Cursor bundle after the interruption.
- Runtime resizing behavior was not replayed in Cursor; this is static bundle/notes synthesis.
- Exact compact/wide UI differences beyond the known `448px` narrow threshold are incomplete.
- Some verified responsive/chat identifiers live in `workbench.glass.main.js`, not the user-specified desktop bundle.
