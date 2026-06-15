# Round 2 — C4 reflow yield on unified chat/editor maximize

## Scope

Focused re-check of `setUnifiedMaximizeState` / `toggleUnifiedMaximizeState` in Cursor's bundled workbench. Question: when editor/composer maximizes, which grid views shrink and which keep their width?

Source: bounded `rg` windows on `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` (bundle not opened wholesale).

Anchor counts: `setUnifiedMaximizeState` 18, `toggleUnifiedMaximizeState` 2, `getViewCachedVisibleSize` 18, `sidebarVisibleBeforeMaximize` 4, `setEditorHidden` 8, `agentChatMaximized` 11.

Entry command: `workbench.action.maximizeChatSize` → `toggleUnifiedMaximizeState()` → `setUnifiedMaximizeState(!e)`.

Context key: `agentChatMaximized` (`K4e`).

---

## Mechanism summary

Unified maximize is **not** “hide everything except chat.” It hides **editor** and **panel**, optionally hides **primary sidebar**, and **never hides** `workbench.parts.auxiliarybar` or `workbench.parts.unifiedsidebar`.

The conversation pane (`auxiliarybar`) **expands** into reclaimed space. The agent list (`unifiedsidebar`), activity bar, titlebar, and status bar **keep their grid slots**; agent-list width is not collapsed.

Width math on enter runs inside `setEditorHidden(true)` when unified mode and panel are already hidden:

```js
d=Math.max(auxiliaryBarPartView.minimumWidth, mainContainerDimension.width - sidebarWidth - unifiedSidebarWidth - activityBarWidth)
this.setSize("workbench.parts.auxiliarybar",{width:d,height:...})
```

Hidden parts use grid `setViewVisible(..., false)`, which caches size via `getViewCachedVisibleSize` on save (`SIDEBAR_HIDDEN ? getViewCachedVisibleSize(sideBarPartView) : getViewSize(...).width`).

---

## ENTER — ordered operations (default: `skipHideSidebar` false)

Applies to `setUnifiedMaximizeState(true)` unless caller passes `{ skipHideSidebar: true }`.

| #   | Operation                                                                                                                                              | Part id                          | Effect                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | `getViewSize(panelPartView)` → `panelHeightPercentageBeforeMaximize`                                                                                   | `workbench.parts.panel`          | Cache only                                                                              |
| 2   | `panelVisibleBeforeMaximize = isVisible(panel)`                                                                                                        | `workbench.parts.panel`          | Cache only                                                                              |
| 3   | `sidebarVisibleBeforeMaximize = isVisible(sidebar)`; cache width %                                                                                     | `workbench.parts.sidebar`        | Cache only                                                                              |
| 4   | If aux visible: cache `auxiliaryBarWidthPercentageBeforeMaximize`                                                                                      | `workbench.parts.auxiliarybar`   | Cache only                                                                              |
| 5   | If unified sidebar visible: cache `unifiedSidebarWidthPercentageBeforeMaximize`; else `undefined`                                                      | `workbench.parts.unifiedsidebar` | Cache only                                                                              |
| 6   | `chatEditorGroupService.ensureChatVisibleOrCreate()`                                                                                                   | `workbench.parts.auxiliarybar`   | Ensure chat/composer pane exists                                                        |
| 7   | `setSideBarHidden(true, true)`                                                                                                                         | `workbench.parts.sidebar`        | **Yields** — `.nosidebar`, `setViewVisible(sideBarPartView, false)`, cached width       |
| 8   | `setPanelHidden(true, true)`                                                                                                                           | `workbench.parts.panel`          | **Yields** — `.nopanel`, `setViewVisible(panelPartView, false)`                         |
| 9   | `setEditorHidden(true, true)`                                                                                                                          | `workbench.parts.editor`         | **Yields** — `.nomaineditorarea`, `.agentmode`, `setViewVisible(editorPartView, false)` |
| 10  | Inside step 9 (unified mode, editor+panel hidden): ensure aux visible; `setSize(auxiliarybar, width = total − sidebar − unifiedsidebar − activitybar)` | `workbench.parts.auxiliarybar`   | **Grows** into freed space                                                              |
| 11  | `wasMaximized = true`; `agentChatMaximizedContext.set(true)`; `stateModel.save()`                                                                      | —                                | State persist                                                                           |

**Not called on ENTER:** `setAuxiliaryBarHidden`, `setUnifiedSidebarHidden`, `setActivityBarHidden`, `setPartHidden(..., "workbench.parts.unifiedsidebar")`.

### ENTER variant — `{ skipHideSidebar: true }`

Steps 7 and 10 differ:

| #   | Operation                                                                            | Part id                        | Effect                       |
| --- | ------------------------------------------------------------------------------------ | ------------------------------ | ---------------------------- |
| 7′  | Skip `setSideBarHidden`                                                              | `workbench.parts.sidebar`      | **Keeps width**              |
| 7″  | `setSize(sidebar, current width)` if sidebar still visible                           | `workbench.parts.sidebar`      | Pin width during maximize    |
| 10′ | Aux width = `total − sidebar − unifiedsidebar − activitybar` (sidebar term non-zero) | `workbench.parts.auxiliarybar` | Grows into editor+panel only |

Used by: panel toggle while chat-maximized, layout switcher, mac close-window path, panel-unhide while maximized.

---

## EXIT — ordered operations

`setUnifiedMaximizeState(false)` (often with `{ skipHideSidebar: true }` when restoring panel).

| #   | Operation                                                                                                                                                  | Part id                        | Effect                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| 1   | Read current sidebar visible + width `r`; panel visible `s`; unified sidebar width ratio `o`                                                               | sidebar, panel, unifiedsidebar | Snapshot                                                                                      |
| 2   | `c = (unifiedSidebarWidthPercentageBeforeMaximize ?? 0) − o`                                                                                               | unifiedsidebar                 | Delta for width redistribution                                                                |
| 3   | `setEditorHidden(false, true)`                                                                                                                             | `workbench.parts.editor`       | **Restore** — remove `.nomaineditorarea`/`.agentmode`, `setViewVisible(editorPartView, true)` |
| 4   | `d = (auxiliaryBarWidthPercentageBeforeMaximize ?? 0.4) + c/2`; if aux visible: `setSize(auxiliarybar, floor(width * d))`                                  | `workbench.parts.auxiliarybar` | Shrink aux back toward pre-maximize %                                                         |
| 5   | If panel was visible OR `panelVisibleBeforeMaximize`: `setSize(panel, height from panelHeightPercentageBeforeMaximize)` then `setPanelHidden(false, true)` | `workbench.parts.panel`        | Restore panel                                                                                 |
| 5′  | Else: `setPanelHidden(true, true)`                                                                                                                         | `workbench.parts.panel`        | Stay hidden                                                                                   |
| 6   | If sidebar currently visible OR `sidebarVisibleBeforeMaximize`: `setSideBarHidden(false, true)` then `setSize(sidebar, r or percentage×width)`             | `workbench.parts.sidebar`      | Restore sidebar                                                                               |
| 6′  | Else: `setSideBarHidden(true, true)`                                                                                                                       | `workbench.parts.sidebar`      | Stay hidden                                                                                   |
| 7   | `wasMaximized = false`; `agentChatMaximizedContext.set(false)`; `stateModel.save()`                                                                        | —                              | State persist                                                                                 |

**Not called on EXIT:** `setUnifiedSidebarHidden` — agent list visibility unchanged; only aux width adjusted by `c/2`.

---

## Parts: remain vs yield (visible grid)

| Part id                                                | On ENTER (default)  | Width behavior                                                     |
| ------------------------------------------------------ | ------------------- | ------------------------------------------------------------------ |
| `workbench.parts.activitybar`                          | **Remains visible** | Unchanged                                                          |
| `workbench.parts.unifiedsidebar` (agent list)          | **Remains visible** | **Keeps width** — not hidden, not resized by maximize              |
| `workbench.parts.sidebar` (primary)                    | **Hidden** (yields) | Cached via `getViewCachedVisibleSize`; restored from % on exit     |
| `workbench.parts.editor`                               | **Hidden** (yields) | Full column reclaimed                                              |
| `workbench.parts.panel`                                | **Hidden** (yields) | Height % cached; restored on exit if was visible                   |
| `workbench.parts.auxiliarybar` (conversation/composer) | **Remains visible** | **Expands** — explicit `setSize` to fill `total − fixed neighbors` |
| `workbench.parts.titlebar`                             | **Remains visible** | Unchanged                                                          |
| `workbench.parts.statusbar`                            | **Remains visible** | Unchanged                                                          |

With `skipHideSidebar: true`, primary sidebar moves from “hidden/yields” to “remains visible / keeps width.”

---

## Width caching evidence

On state save, hidden parts read cached invisible size; visible parts read live size:

```js
SIDEBAR_HIDDEN ? workbenchGrid.getViewCachedVisibleSize(sideBarPartView) : getViewSize(sideBarPartView).width
PANEL_HIDDEN ? getViewCachedVisibleSize(panelPartView) : ...
AUXILIARYBAR_HIDDEN ? getViewCachedVisibleSize(auxiliaryBarPartView) : getViewSize(auxiliaryBarPartView).width
```

Unified maximize ENTER does **not** set `AUXILIARYBAR_HIDDEN` or `UNIFIEDSIDEBAR_HIDDEN`; aux is resized live, unified sidebar untouched.

Pre-maximize percentages stored on layout service instance: `panelHeightPercentageBeforeMaximize`, `sidebarWidthPercentageBeforeMaximize`, `auxiliaryBarWidthPercentageBeforeMaximize`, `unifiedSidebarWidthPercentageBeforeMaximize`, plus boolean `sidebarVisibleBeforeMaximize`, `panelVisibleBeforeMaximize`.

---

## VERDICT

**The active conversation region (`auxiliarybar`) grows; the agent list (`unifiedsidebar`) keeps its width.** Default maximize hides editor, panel, and primary sidebar; activity bar, unified sidebar, titlebar, and statusbar stay mounted. Only `skipHideSidebar` preserves the primary sidebar width too — it is not an “everything but editor collapses” layout.
