# Cursor Content Pane and Drag/Drop Styling Research

Superseded by `docs/cursor-shell-research/09-chatview-split-dnd-research-review.md`.

Status: incomplete. The requested Cursor bundle inspection was interrupted before any substantive reverse engineering completed. This file preserves the useful current context, the intended grep anchors, and implementation implications without claiming verified source findings.

## Scope

- Target bundle: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- User focus:
  - StyleX usage and generated class names
  - `content-pane-top-bar`
  - content pane shell/surface styling
  - drag/drop handlers and drop-zone preview
  - highlight area geometry
  - border color, opacity, and density
  - chat view behavior across screen sizes/split layouts
  - CSS injection/token functions

## Confirmed Context

- Cursor stores the main compiled workbench in a large bundled JS file at the path above.
- The screenshot shows a workbench with:
  - left nav/sidebar
  - central chat/content area split into multiple panes
  - right SCM/files panel
  - pane top bars labeled with chat titles such as `New Agent`
  - visible pane separators and subtle border density
  - chat composer surfaces inside panes
- The user goal is parity for Honk drag zones and pane tabs, specifically avoiding a drag layer that blocks tab selection.

## Incomplete Items

- No verified StyleX function names or generated class names were extracted before interruption.
- No verified Cursor drag/drop library or handler call graph was extracted before interruption.
- No verified CSS variable names, opacity values, or border token values were extracted before interruption.
- No verified screen-size thresholds for chat view layout were extracted before interruption.
- No subagent findings were available to consolidate before interruption.

## Grep Anchors

Use these as first-pass anchors against:

```sh
/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
```

High-signal literal anchors:

- `content-pane-top-bar`
- `content-pane`
- `pane-top-bar`
- `drop`
- `drag`
- `dragOver`
- `dragenter`
- `dragleave`
- `dropZone`
- `drop-zone`
- `highlight`
- `StyleX`
- `stylex`
- `stylex.create`
- `stylex.props`
- `insertRule`
- `createStyleSheet`
- `CSSStyleSheet`
- `workbench.colorCustomizations`
- `editorGroupHeader`
- `sideBar`
- `panel.border`
- `focusBorder`
- `activeBorder`
- `editorGroup.border`
- `split-view`
- `sash`
- `content-pane-container`

Likely screen/layout anchors:

- `minWidth`
- `maxWidth`
- `innerWidth`
- `clientWidth`
- `ResizeObserver`
- `layout`
- `split`
- `orientation`
- `horizontal`
- `vertical`
- `editorGroups`
- `partService`
- `auxiliarybar`
- `sidebar`

Cursor/chat-specific anchors:

- `composer`
- `Composer`
- `chat`
- `Chat`
- `agent`
- `newAgent`
- `New Agent`
- `contentPane`
- `ContentPane`
- `contentPaneTopBar`

## Recommended Extraction Method

Do not paste long proprietary source into notes. Extract only identifiers, nearby call names, and short fragments needed to find the same code again.

Suggested commands:

```sh
rg -n "content-pane-top-bar|contentPaneTopBar|content-pane|drop-zone|dropZone|stylex|StyleX|dragOver|dragenter|ResizeObserver" /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
```

```sh
rg -n "insertRule|createStyleSheet|CSSStyleSheet|panel.border|editorGroup.border|focusBorder|sash|split-view" /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
```

When a minified function is identified, extract a bounded window around the hit and summarize:

- owning symbol/function name if visible
- DOM class or data attribute names
- event names registered
- style keys used
- CSS variables referenced
- state flags controlling drop preview visibility
- geometry inputs used for split targets

## Implementation Implications for Honk

- Drag zones should not be broad absolute overlays that steal pointer events from pane tabs. Prefer a small draggable handle area or a drag listener attached to the intended shell/header element, with tab buttons allowed to receive normal pointer events.
- Drop preview should be state-driven from actual drag-over geometry, not always-present hit layers. The preview element can be `pointer-events: none`; the active drop target should be determined by event handlers on stable pane containers.
- Top bar markup should keep tab/title controls and drag affordance separate. If a full top bar is draggable, interactive descendants need explicit escape behavior.
- Pane separators should use existing shell border tokens instead of one-off opacity guesses. Match density by using the same token family for top bars, split dividers, and preview outlines.
- For screen-size parity, collect actual Cursor thresholds before implementation. Do not hardcode behavior from the screenshot alone; derive whether chat panes reflow from viewport width, pane width, editor group layout state, or a combination.
- For drop preview parity, capture:
  - outline/border color token
  - fill/background tint token
  - opacity
  - inset or gap from pane edges
  - radius
  - whether preview covers full pane, half pane, edge strip, or insertion region

## Next Research Pass

The next pass should inspect the bundle directly and fill in:

1. Verified StyleX runtime functions and generated CSS class conventions.
2. `content-pane-top-bar` owning component/function and applied style object.
3. Drag/drop event registrations and library/runtime used.
4. Drop preview DOM/classes/styles and CSS token references.
5. Chat pane layout thresholds and split behavior by pane/container width.
