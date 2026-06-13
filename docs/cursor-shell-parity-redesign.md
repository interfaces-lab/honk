# Right-Workbench Shell Layout — Cursor Parity Redesign

Status: design doc (no code changes yet). Source: reverse-engineering of Cursor's
bundled agent window (`/Applications/Cursor.app/.../workbench.desktop.main.js`) +
reading Honk's current shell. Companion memories: `cursor-agent-window-architecture`,
`honk-shell-recomponentization`.

---

## 1. Goal

Make Honk's right-workbench **fullscreen (maximize)** reach parity with Cursor's
agent-window maximize. Two hard requirements:

1. **Zero top-nav re-render on fullscreen.** Toggling fullscreen must not re-render
   the top nav (or any header chrome). In Cursor the bar only _re-positions via CSS_;
   it never re-renders.
2. **Stable, reflow-based layout.** Entering fullscreen must collapse the **left
   sidebar** _and_ the **center/chat region** out of layout so the right workbench
   _reflows_ to fill the window — a genuine push-away, not an absolute overlay sitting
   on top of a still-present sidebar. No layout shift, no flash, smooth transition.

Reported bug this fixes: today, entering fullscreen does **not** push the left
sidebar away — it stays at its width until the user manually toggles fullscreen off.

---

## 2. How Cursor does it (reverse-engineered)

### 2.1 Component hierarchy (agent window — React, React Compiler auto-memo)

```
GlassRoot                         builds ONE stable props object (useMemo), provides context
├─ X1I   left agent switcher / "New Agent"
├─ X5k   AgentPanelBoundary
│  └─ fwI  AgentPanelFrame   div[data-component="agent-panel"]  (reads only layout/visibility)
│     └─ wwI AgentPanelBody  (subscribes to tabManager.subscribeAll itself)
└─ DSI   EditorPanelResizeShell  (drag/width state only)
   └─ PSI EditorPanelContainer   .editor-panel-container
      └─ wUk EditorPanelContent
         └─ BSI EditorPanelMainShell   .editor-panel-inner
            ├─ O7e.Bar             tabs + left controls (.editor-panel-tab-bar-tab-cluster)
            ├─ O7e.TrailingSection status · + NewTabMenu(_SI) · remote · FULLSCREEN · hide(YLp)
            └─ O7e.Content         active panel body
```

Tab system is a single primitive `O7e = Imf(...)` → `{Root, Group, Bar, Tabs,
TrailingSection, Content, StableTab}`. Renderers are registered by panel kind. The
React Compiler memoizes pervasively (`react.memo_cache_sentinel`).

### 2.2 The maximize mechanism — THE KEY PART

- **State:** a VS Code context key `agentChatMaximized` (minified `j4e`). The action
  `workbench.action.maximizeChatSize` calls `layoutService.toggleUnifiedMaximizeState()`.
- **Layout reflow (not overlay):** `setEditorHidden(e)` toggles classes
  `agentmode` / `nomaineditorarea` on `mainContainer` **and** calls
  `workbenchGrid.setViewVisible(editorPartView, !e)` — sibling views are _removed
  from the grid_ so the layout reflows and reclaims the space. Pre-maximize sizes are
  stored as transient fields (`auxiliaryBarWidthPercentageBeforeMaximize`) and restored
  imperatively with a size setter. Hide paths also toggle `nosidebar` / `nopanel` /
  `sidebarvisible`.
- **Top nav never re-renders:** the toolbar subtree does **not** receive the maximized
  boolean as a prop. Only two things react to `agentChatMaximized`:
  1. the aux-bar part updates its title classes imperatively;
  2. the titlebar calls `updateActionsPositioning()` **scheduled in
     `requestAnimationFrame`** off the context-key change — it moves existing toolbar
     containers / toggles placement classes. The React toolbar is untouched.
- **Toggle button:** its `toggled` state is bound declaratively to the context key
  (`toggled: equals(agentChatMaximized, true)`), so the icon swaps **without a remount**.
- **Body never sees the boolean:** the composer body gets only
  `{location, composerId, composerHeader}`.

Takeaway: **fullscreen is an imperative DOM/CSS state transition, driven by a single
flag, with React kept entirely out of the loop** for both the layout reflow and the
toolbar reposition.

---

## 3. Honk's current state

- **Right-workbench shell** (`packages/app/src/components/shell/shell/app.tsx`),
  recently refactored:
  - `RightAside` — `React.memo` root, subscribes to nothing volatile, `useMemo`'s a
    stable `content` element.
  - `RightAsideFrame` — owns the `<aside>`, `useRightOpen` / `useIsMuted` /
    `useWorkspaceFullscreenTarget` / `useRightWidth`, `useColumnResize`, sticky
    `hasOpened`, the resize sash; renders `{children}`.
  - `RightWorkbenchContent` — owns `useActiveTab` / `useSearch`; renders `TabsRoot`
    → `RightWorkbenchHeader` (the memoized **top nav**) + `RightAsidePanels` +
    `RightWorkbenchPanelRuntimeContext`.
  - `RightWorkbenchFullscreenToggle` — isolated `React.memo` leaf that subscribes to
    `useWorkspaceFullscreenTarget` itself and swaps the icon.
- **Fullscreen is imperative-ish:** `ShellFullscreenLayer` (null component) writes
  `data-shell-fullscreen-target="right-workbench"` on the `.agent-window` root via a
  ref — no AppShell re-render. CSS in `packages/app/src/styles/shell.css` (~336-360)
  keys off that attribute:
  - `.agent-window__workbench { position:absolute; inset:0; width:100%; }`
  - `.agent-window__sidebar { width:0; min-width:0; }`
  - `.agent-window__workbench-body { width:100% }`
- `LeftAside` (~line 173) and `ShellCenterRegion` (~line 596) **subscribe to
  `useWorkspaceFullscreenTarget` in React** and set `inert` / `aria-hidden`.

---

## 4. Gap analysis (where Honk diverges from Cursor)

| Concern                         | Cursor                                                    | Honk today                                                                                                                                                                     | Gap                                                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Top-nav re-render on fullscreen | None (CSS reposition only)                                | Bar (`RightWorkbenchHeader`) is memo'd ✓, but the toggle leaf re-renders (icon via React state) and `LeftAside` + `ShellCenterRegion` re-render (they subscribe to fullscreen) | Move all fullscreen visual response to the root attribute + CSS / imperative DOM; no React fullscreen subscription in the chrome path                                                                  |
| Layout on fullscreen            | Reflow — sibling views removed from grid, space reclaimed | Absolute **overlay** (`position:absolute; inset:0`) over the row wrapper; sidebar `width:0` doesn't reliably win                                                               | Replace overlay with reflow; collapse sidebar + center out of flow                                                                                                                                     |
| Left sidebar push-away          | Yes (reflow)                                              | No — stays at width (the reported bug)                                                                                                                                         | Likely the `inset:0` resolves against the intermediate `.relative` flex-row wrapper (not `.agent-window`), and/or `.agent-window__sidebar{width:0}` loses to the inner `w-[min(...)]` div / `shrink-0` |
| Toggle icon swap                | CSS `toggled` (no remount)                                | React state (memo leaf)                                                                                                                                                        | Optional: CSS-swap for true zero-render; leaf is acceptable since it doesn't touch the bar                                                                                                             |

---

## 5. Redesign plan

### 5.1 Fullscreen = pure CSS/DOM off the root attribute (zero re-render)

`ShellFullscreenLayer` already writes `data-shell-fullscreen-target` imperatively.
Derive **all** fullscreen visuals from it:

- **Reflow, not overlay.** Drop `position:absolute; inset:0` on `.agent-window__workbench`.
  Keep it in normal flex flow (`flex:1`/`width:100%`). On
  `[data-shell-fullscreen-target="right-workbench"]`, collapse the siblings out of flow:
  - `.agent-window__sidebar { flex-basis:0; width:0; min-width:0; overflow:hidden; }`
  - center region → same collapse (needs a stable class hook; add one to
    `ShellCenterRegion`'s root, e.g. `agent-window__center`).
  - Transition `width`/`flex-basis` for smoothness; the workbench expands as siblings
    collapse — a clean reflow, no overlay, no shift.
- **`inert` without React.** `inert` can't be set by CSS. To avoid the React
  subscription in `LeftAside`/`ShellCenterRegion`, extend `ShellFullscreenLayer` to
  also toggle `inert`/`aria-hidden` imperatively on the sidebar + center nodes (via
  refs) when it flips the root attribute. This removes their `useWorkspaceFullscreenTarget`
  subscription from the render path (matches Cursor's imperative approach). _(Alt: keep
  the subscription only in those two leaves — they don't render the top nav, so it's a
  smaller win but simpler. Decision below.)_
- **Toggle icon.** Either keep the isolated memo leaf (it never re-renders the bar) or
  render both icons and CSS-show one via the ancestor attribute. Decision below.

Result: a fullscreen toggle re-renders **no** component that renders the top nav.

### 5.2 Fix the positioning-context bug

If any absolute positioning is retained, anchor it to `.agent-window` (ensure the
root is the positioned ancestor) rather than the intermediate `.relative` flex-row
wrapper. Preferred: remove absolute entirely (5.1 reflow makes it unnecessary).

### 5.3 Keep what already works

- The imperative `data-shell-fullscreen-target` write (no AppShell re-render).
- The `RightAside` Frame/Content split and the memoized `RightWorkbenchHeader`.
- The isolated `RightWorkbenchFullscreenToggle` (unless we move to CSS icon-swap).

---

## 6. Decisions to confirm before implementing

1. **`inert` on sidebar/center:** imperative (extend `ShellFullscreenLayer`, zero React
   re-render — Cursor-faithful) **[recommended]** vs keep the local React subscription
   in `LeftAside`/`ShellCenterRegion` only (simpler, those leaves re-render but the top
   nav doesn't).
2. **Toggle icon swap:** keep isolated memo leaf **[recommended, simplest]** vs CSS swap
   (true zero-render).
3. **Center collapse hook:** add a stable class (`agent-window__center`) to the center
   region root so CSS can collapse it.
4. **Design tokens (padding/radius/heights/gaps):** the Cursor design-tokens RE pass was
   stopped before completing. TODO if we want pixel-exact parity — otherwise reuse
   Honk's existing tokens.

---

## 7. Verification plan

- `pnpm run typecheck` (full output).
- Manual (run the app): toggle fullscreen and confirm
  (a) **no top-nav re-render** (React DevTools "highlight updates"),
  (b) left sidebar **and** center collapse and the workbench fills the window, smoothly,
  (c) exiting fullscreen restores prior widths with no jank.
