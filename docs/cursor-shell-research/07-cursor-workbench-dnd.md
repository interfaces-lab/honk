# Cursor Workbench Drag/Drop Research

Source inspected: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`

Constraint: this is a behavior/identifier summary only. Do not copy bundled source into Honk.

## Executive Summary

Cursor has three drag/drop layers in the workbench bundle:

1. VS Code/Monaco native workbench DND for editor groups, panes, lists, trees, and terminals. It uses browser drag events (`dragstart`, `dragenter`, `dragover`, `drop`, `dragend`) plus VS Code transfer registries.
2. Cursor's React/StyleX drag wrappers for product UI tab systems and tiling panels. The important APIs are `useDraggable` (`u4n`), `useDroppable` (`DFt`), `DragTransfer` (`mXl`/`Hoe`), `GlobalDragStateProvider`, and typed payload classes created with `AFt(...)`.
3. `@dnd-kit`-style symbols are bundled (`DndContext`, sortable context/sensors around line anchors near `20410`), but the shell tab/panel DND I inspected does not use that path. It uses Cursor's own wrapper over native HTML5 DND.

The key parity detail for tab usability: Cursor does not make a permanent broad dragzone over the tab strip. The tab itself is draggable, but close/copy/inner controls carry `data-no-drag` and stop pointer down propagation. Drop previews are separate overlays with `pointer-events:none`.

## Grep Anchors

Use bounded greps because the bundle has very long lines:

```sh
rg -n --pcre2 -o '.{0,120}(application/x-cursor-draggable|data-no-drag|function u4n|function DFt).{0,220}' /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
rg -n --pcre2 -o '.{0,120}(v3e=AFt\\(\"tab\"|x8d=AFt\\(\"tiling-panel\"|A8d=\\{minPanelSize|function Ikd|function F3f|function V3f|function K3f).{0,260}' /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
rg -n --pcre2 -o '.{0,120}(dropIndicator:\\{|contentDropOverlay:\\{|ui-tab-system|ui-tiling-panel|ui-tiling-drop-overlay).{0,260}' /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
rg -n --pcre2 -o '.{0,120}(editor-group-overlay-indicator|pane-overlay-indicator|monaco-workbench-editor-drop-overlay|monaco-pane-drop-overlay|DefaultDragOverBackgroundColor).{0,260}' /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
rg -n --pcre2 -o '.{0,120}(cursor.chatMaxWidth|workbench.editor.composer.input|_on=450|conversationMaxWidth|--composer-max-width).{0,260}' /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
```

Literal `content-pane-top-bar` and `content-pane` did not appear in this bundle. Closest workbench shell anchors are `ui-tab-system-bar`, `ui-sidebar-top-bar`, `ui-tiling-panel`, and VS Code editor group title/tab classes.

## Cursor React Drag Layer

`DragTransfer` (`mXl`, singleton alias `Hoe`) stores one active typed payload. `useDraggable` (`u4n`) sets `draggable` on the element and, on `dragstart`, writes the payload into `DragTransfer` plus `dataTransfer` with the MIME type `application/x-cursor-draggable`.

Important behavior:

- `useDraggable` sets `aria-grabbed` according to active drag state.
- `effectAllowed` is `move` in Electron and `copyMove` elsewhere.
- It optionally sets a custom drag image with a provided offset.
- It applies the global dragging class; resolved CSS includes `cursor: grabbing`.
- A capture-phase global pointerdown checks for closest `[data-no-drag]`. If present, the following dragstart is prevented and propagation stopped.

`useDroppable` (`DFt`) accepts typed payload classes. It tracks nested drag enter/leave with a counter, validates active payload type/schema, calls `preventDefault()` on valid `dragover`, sets `dropEffect="move"`, and throttles `onDragOver` through `requestAnimationFrame`.

Blocked drop styling resolves to:

- `.ui-byyjgo`: `opacity:.5`
- `.ui-1h6gzvc`: `cursor:not-allowed`
- Tab-scrollable blocked state also has `[data-drop-blocked]` opacity and not-allowed cursor classes.

## Tab System

The tab payload type is `v3e=AFt("tab", ...)` with payload fields: `tabId`, `groupId`, `kind`, `props`.

Core identifiers:

- `TabGroupManager`
- `TabSystemManager`
- `useDraggable` on each `ui-tab-system-tab`
- `useDroppable` on tab strip/content
- `moveTab(...)`
- `transferTab(...)`
- `yOe(...)` for pointer-to-insertion computation

Tab DOM:

- Tab strip: `role="tablist"`, `aria-orientation="horizontal"`.
- Tab item: `role="tab"`, `aria-selected`, `aria-controls`, active tab `tabIndex=0`, inactive tabs `tabIndex=-1`.
- Tab panel: `role="tabpanel"`, hidden when inactive.

Tab usability details:

- A tab's `pointerdown` activates the tab before drag begins.
- `pointerup` can focus the tab content via the registered focus target.
- Enter/Space route focus into the tab content when `focusOnActivation` is enabled.
- Stable tabs and label-editing tabs disable dragging.
- Close/copy-link controls are wrapped in elements with `data-no-drag` and have `onPointerDown`/click handlers that stop propagation. This is the direct mechanism that keeps tab buttons selectable while the parent tab remains draggable.

Tab drop preview:

- `dropIndicator` is an absolute bar.
- Width is `--tab-drop-indicator-width`; the bundle sets `cic=2`, so this is a 2px indicator.
- It spans from `var(--cursor-spacing-2-5)` top to bottom, uses `var(--cursor-text-primary)`, has full radius, `pointer-events:none`, and z-index 10.
- The tab content area has a separate `contentDropOverlay`: absolute inset `0`, `background-color: var(--cursor-bg-focused)`, z-index 100, `pointer-events:none`.

## Tiling/Panel Drag Layer

The panel payload type is `x8d=AFt("tiling-panel", ...)` with fields: `panelId`, `managerId`.

Core identifiers:

- `TilingSystemManager`
- `TilingSystemSlot` (`K3f`)
- `TilingSystemDropOverlay` (`V3f`)
- `calculateDropZone` (`Ikd`)
- `getDropOverlayBounds` (`F3f`)
- `getDisallowedDropZones(...)`

Panel config:

- `minPanelSize: 50`
- `sashLayoutSize: 1`
- `sashSize: 4`
- `sashHoverSize: 12`
- `edgeThreshold: .375`

Drop-zone computation:

- Pointer position is normalized against the target panel rect.
- Candidate edge distances are checked in `["bottom","top","left","right"]`.
- If the closest edge distance is within `0.375`, that edge is selected.
- Otherwise the drop zone is `center`.
- Overlay bounds are simple halves: left/right/top/bottom use 50% of the target; center covers 100%.
- Moving a panel onto its sibling disallows the axis that would produce a no-op: horizontal siblings disallow left/right; vertical siblings disallow top/bottom.

Panel DOM and state:

- Panel root is `role="group"` with `aria-label="Panel <id>"`.
- Root data attributes include `data-focused`, `data-dragging`, and `data-drop-active`.
- `onMouseDown` and `onFocusCapture` set focused panel.
- Drag opacity uses `[data-dragging] { opacity:.5 }`.
- Focus outline uses `[data-focused]` with `var(--cursor-stroke-focused)`.

Panel overlay style:

- Overlay root: absolute, inset by `var(--cursor-spacing-0-5)`, z-index 1000, `pointer-events:none`.
- Highlight: `background-color: color-mix(in srgb, var(--cursor-bg-accent) 28%, transparent)`.
- Highlight outline: 1px solid `color-mix(in srgb, var(--cursor-bg-accent) 62%, transparent)`, outline offset `-1px`.
- Radius: `var(--cursor-radius-sm)`.
- Transition: top/left/width/height, fast duration, default easing.

This is the strongest Cursor parity target for Honk's split preview: a translucent accent rectangle with a 1px accent outline, not a heavy border or opaque overlay.

## VS Code Workbench DND

The legacy workbench layer is still present and important for editor-group splitting.

Core identifiers:

- `m9e.INSTANCE.registerDraggable(...)`
- `m9e.INSTANCE.registerTarget(...)`
- `R8(...)` drag observer
- `EA.getInstance()` transfer store
- `Iwt(dataTransfer, "move", allowed)` for drop effect
- `monaco-workbench-global-dragged-over`

Editor group overlay:

- Overlay id: `monaco-workbench-editor-drop-overlay`.
- Indicator class: `editor-group-overlay-indicator`.
- Container gets `dragged-over`.
- Uses theme token `editorGroup.dropBackground`.
- Default token values observed: dark `#53595D` at 50% alpha; light `#2677CB` at 18% alpha.
- If outline color exists, it uses a 2px dashed outline with offset `-2px`.
- Drop-into-editor prompt exists as `editor-group-overlay-drop-into-prompt`.

Pane overlay:

- Overlay id: `monaco-pane-drop-overlay`.
- Indicator class: `pane-overlay-indicator`.
- Pane `dropBackground` falls back to `rgba(128,128,128,.5)`.
- View panes expose `draggableElement` as the pane header and `dropTargetElement` as the pane body/root.

Editor/tab handling:

- VS Code editor tabs and tab containers are native draggable DOM nodes with `role="tab"` / `role="tablist"`.
- Tab insertion uses `drop-target-left` and `drop-target-right`, chosen by whether the pointer is in the left or right half of the tab.
- Editor groups containing only composer editors are special-cased.

## Chat Editor Sizing

Cursor's chat/editor sizing has two separate concepts:

1. Chat content width cap.
2. Chat editor group split width.

Content width:

- Setting key: `cursor.chatMaxWidth`.
- Configuration schema default: `840`.
- `AyS(...)` reads the setting and `IyS(...)` writes `--composer-max-width` on `.monaco-workbench`.
- Conversation/message surfaces use `var(--composer-max-width, 840px)`.

Glass/agent panel variation:

- There is a second glass path with fallback `Kew=780`.
- It subtracts `ztC=16` via `YtC(...)`.
- When `composer_viewport_virtualization` is enabled, it adds `VtC*2` before subtracting, effectively restoring 16px.
- This appears to be a glass panel viewport/content calculation, not the general chat message max width.

Split/editor group width:

- `_on=450` is used as the preferred width for groups that only contain composer editor inputs.
- `groupOnlyContainsComposerEditors(...)` returns true when every editor in the group is a composer editor.
- `preferredWidth` returns `_on` for those groups.
- When a split yields two groups, chat-only groups wider than `_on` are resized back to `_on`.
- Drops/splits involving chat editor groups call `trackChatPaneSplitIfNeeded(...)`.
- Composer editor pane minimum width also appears as `300`.

Floating composer geometry:

- `o0i=320` and `a0i=320` are minimum floating composer width/height.
- `fpt=20` is used as viewport edge padding/clamp margin.

## Implementation Notes For Honk

- Keep tab hit testing native: tabs should activate on pointer down and drag only after browser drag threshold. Do not cover tabs with a broad always-on dragzone.
- Add `data-no-drag` to close, copy, menu, and any tab action controls. Capture pointerdown on those controls and stop propagation.
- Use typed drag payloads for tabs and panels. Reject cross-manager panel drops by manager id.
- Make drop previews `pointer-events:none`.
- Use a 2px insertion bar for tab reordering.
- Use a translucent split highlight: accent background around 28%, 1px accent outline around 62%, small radius, fast transition.
- Treat chat group width separately from chat content max width: content cap is 840px by default, editor group preferred split width is 450px.
