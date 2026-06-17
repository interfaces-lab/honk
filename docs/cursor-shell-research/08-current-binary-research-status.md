# Cursor Workbench Binary Research Status

Date: 2026-06-17

Superseded by `docs/cursor-shell-research/09-chatview-split-dnd-research-review.md`.

## Status

Incomplete. This note captures only an interrupted subagent's local view and is not authoritative.

Five subagents were started from the main thread, but this subagent did not receive the completed bundle findings before it was interrupted. Use the superseding review linked above for verified Cursor bundle findings.

Do not treat this file as evidence of Cursor internals beyond the user-provided target path and the attached visual target.

## User-Provided Target

- Cursor bundle: `/Applications/Cursor.app`
- Main workbench bundle: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- Requested focus areas:
  - chat/editor pane structure
  - content pane shell
  - screen splitting behavior
  - top navbar, especially `content-pane-top-bar`
  - drag handling and drag preview/drop-zone rendering
  - highlight area, border color, and density
  - style system, including suspected StyleX usage
  - chat view correlation with screen size

## Captured Context

- The screenshot supplied with the request shows Honk currently rendering multiple chat/content panes and a right workbench changes panel.
- The visible defect target appears to be drag-zone parity: Honk's drag zone may be too broad and can interfere with tab selection on workbench panels.
- Existing local research files are already present under `docs/cursor-shell-research/`, including notes for shell grid, titlebar/topnav, auxiliarybar/editor composer, fullscreen/maximize state, glass tab system, and Cursor workbench drag/drop. Review those before implementing.

## Missing Binary Findings

Still needs real bundle inspection before implementation:

- exact symbols and minified identifiers near `content-pane-top-bar`
- class-name generation and whether the relevant React surface uses StyleX or static class names
- drag/drop library or workbench-native DnD service involved
- drop target component/function invocation flow
- drag preview DOM shape and highlight styling
- screen-size breakpoints or reflow conditions for chat/editor panes
- ownership boundary between shell layout state, pane registry, editor groups, auxiliary/sidebar parts, and chat view state

## Grep Anchors For Follow-Up

Run these against Cursor's bundle when research resumes:

```sh
CURSOR_JS="/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js"

rg -n "content-pane-top-bar|contentPaneTopBar|content-pane|pane-top-bar|pane top bar" "$CURSOR_JS"
rg -n "chatview|chatView|chat-view|composer|aichat|ai-chat|workbench\\.panel\\.aichat" "$CURSOR_JS"
rg -n "dragover|dragOver|dragenter|dragEnter|dropEffect|DataTransfer|dropTarget|DropTarget|dragAndDrop" "$CURSOR_JS"
rg -n "splitview|split-view|SplitView|GridView|part\\.editor|auxiliarybar|activitybar|sidebar" "$CURSOR_JS"
rg -n "stylex|styleX|xstyle|\\.stylex|createStyleSheet|contentPane" "$CURSOR_JS"
rg -n "highlight|drop-zone|dropzone|drag-zone|dragzone|outline|borderColor|rgba\\(" "$CURSOR_JS"
```

If the bundle is heavily minified, first identify nearby string islands, then inspect a bounded window around each hit:

```sh
rg -n -C 3 "content-pane-top-bar|dropTarget|SplitView|GridView" "$CURSOR_JS"
```

## Implementation Implications For Honk

- Do not implement Cursor parity from memory. Treat drag area sizing, pointer-event boundaries, and pane/tab hit testing as the risky parts.
- The likely product constraint is that drag affordances must not cover selectable tabs or other top-bar controls. Honk should preserve normal click/selection behavior unless a real drag gesture has crossed threshold.
- Keep any new keybindings configurable through existing keybinding maps.
- Prefer existing HonkKit and shell primitives over one-off markup when building the content-pane shell or navbar.
- Any Cursor-derived constants for border color, alpha, drag preview size, or drop-zone density should be copied only after verified from the bundle or measured from screenshots.

## Next Research Pass

When resumed, use five focused workers or threads:

1. Shell/grid structure and part ownership.
2. Chat/editor pane lifecycle and screen-size reflow.
3. `content-pane-top-bar` DOM/classes/props/state.
4. Drag/drop invocation flow and drop-target preview rendering.
5. Styling tokens, StyleX/static CSS, highlight color/density, and parity notes.

Each worker should return identifiers, short source anchors, and implementation implications only. Avoid long proprietary source excerpts.
