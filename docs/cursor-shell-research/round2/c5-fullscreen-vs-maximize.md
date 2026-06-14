# Round 2 — C5: Native fullscreen vs editor maximize vs Zen

## Scope

Focused re-check of three distinct layout states in Cursor's bundled workbench. Question: what each state does to the **left sidebar** (primary `workbench.parts.sidebar`) and **titlebar**, and whether they are the same mechanism.

Evidence: bounded `rg` windows on:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

Binary never opened wholesale. Counts first, then `rg -oN` windows capped at 5000 bytes.

## Anchor counts

| Anchor | Count |
|---|---:|
| `workbench.action.toggleFullScreen` | 6 |
| `onFullscreenChanged` | 2 |
| `workbench.action.maximizeEditorHideSidebar` | 1 |
| `workbench.action.maximizeChatSize` | 5 |
| `toggleUnifiedMaximizeState` | 2 |
| `workbench.action.toggleZenMode` | 2 |
| `setSideBarHidden` | 9 |
| `nosidebar` | 3 |
| `nomaineditorarea` / `agentmode` | 3 / 4 |
| `Shift+Cmd+M` literal string | **0 (not found)** |
| `primary:3115` (decoded Shift+Cmd+M) | 4 |

---

## Three-state table

| State | Trigger / command | Class or attribute | Element | Left sidebar (`workbench.parts.sidebar`) | Titlebar | Traffic lights / window chrome | **Left sidebar collapses?** |
|---|---|---|---|---|---|---|---|
| **(1) Native window fullscreen** | `workbench.action.toggleFullScreen` → `hostService.toggleFullScreen()`; mac **Ctrl+Cmd+F** (`mac:{primary:2340}` = KeyMod.CtrlCmd+WinCtrl+KeyF), Win/Linux **F11** (`primary:69`). Not Shift+Cmd+M. | `.fullscreen` | `.monaco-workbench` (`mainContainer`) | **Unchanged.** `onFullscreenChanged` only flips `.fullscreen` and `mainWindowFullscreen`; no `setSideBarHidden` call. | May hide titlebar **grid view** via `setViewVisible(titleBarPartView, shouldShowTitleBar(...))`. CSS under `.fullscreen` hides workbench-owned app icon and window-controls container. `body.no-titlebar-layout` (separate, persistent Cursor mode) keeps titlebar mounted `position:fixed;pointer-events:none`. | `Gqg` zeros `--traffic-lights-offset-adjusted` when fullscreen. CSS: `.monaco-workbench.fullscreen .part.titlebar … .window-appicon{display:none}` and `.window-controls-container{display:none}`. OS traffic lights remain (native chrome). | **no** |
| **(2) Editor / agent maximize** | **Expand chevron / chat maximize:** `workbench.action.maximizeChatSize` → `toggleUnifiedMaximizeState()` → `setUnifiedMaximizeState(!e)`. **Explicit hide-sidebars variant:** `workbench.action.maximizeEditorHideSidebar` → `setPartHidden(true,"workbench.parts.sidebar")` + auxiliary bar + `arrangeGroups(0)`. **In-editor group only (no sidebar hide):** `workbench.action.toggleMaximizeEditorGroup` → `toggleMaximizeGroup()` / `gridWidget.maximizeView` only. **Cursor Glass chevron / Shift+Cmd+M:** `glass.enterEditorPanelFullscreen` (`primary:3115` = Shift+Cmd+M) → `setEditorPanelFullscreen(true)` — editor-panel semantics, not `workbench.action.toggleFullScreen`. | `.nomaineditorarea`, `.agentmode`; optionally `.nosidebar`, `.nopanel` | `.monaco-workbench` | **Yes (conditional).** `setUnifiedMaximizeState(true)` calls `setSideBarHidden(!0,!0)` unless `{skipHideSidebar:true}` (agent layout call sites often pass skip). `maximizeEditorHideSidebar` always hides primary + auxiliary sidebars. `toggleMaximizeEditorGroup` alone does **not** hide sidebar. Agent list (`workbench.parts.unifiedsidebar`) stays visible during unified maximize (not found in hide path). | **Unchanged** — titlebar grid slot stays; no `.fullscreen` flip. `body.no-titlebar-layout` titlebar pinning still applies. | Unchanged (not native fullscreen). `--traffic-lights-offset-adjusted` still computed by `Gqg` when not fullscreen. | **yes** (unified maximize default; always for `maximizeEditorHideSidebar`; **no** for `toggleMaximizeEditorGroup` alone) |
| **(3) Zen mode** | `workbench.action.toggleZenMode` → `layoutService.toggleZenMode()`; mac **Cmd+Z** (`ql(Bg,56)`). | Runtime `ZEN_MODE_ACTIVE`; part classes via hide helpers (`.nosidebar`, `.nopanel`, `.noauxiliarybar`, optional `.nostatusbar`) | `.monaco-workbench` + state model | **Hidden.** `setSideBarHidden(!0,!0)` on enter; restored from `ZEN_MODE_EXIT_INFO.wasVisible.sideBar` on exit. | Not primary hide target. May **chain** into native fullscreen when `zenMode.fullScreen` config set: `hostService.toggleFullScreen(ci)` on enter, reversed on exit if `transitionedToFullScreen`. | If Zen enters native fullscreen, same as (1). Otherwise unchanged. | **yes** |

---

## Evidence (≤2 lines per claim)

### (1) Native fullscreen — sidebar untouched, `.fullscreen` on workbench root

```js
onFullscreenChanged(e){e===ci.vscodeWindowId&&(this.state.runtime.mainWindowFullscreen=Nee(ci),this.state.runtime.mainWindowFullscreen?this.mainContainer.classList.add("fullscreen"):(this.mainContainer.classList.remove("fullscreen"),...),this.workbenchGrid&&(this.workbenchGrid.edgeSnapping=this.state.runtime.mainWindowFullscreen),...this.workbenchGrid.setViewVisible(this.titleBarPartView,this.shouldShowTitleBar(...)))}
```

No `setSideBarHidden` in `onFullscreenChanged` window (2 matches total; both quoted above or zen-exit branch only).

Keybinding — native fullscreen is **not** Shift+Cmd+M:

```js
id:"workbench.action.toggleFullScreen",...keybinding:{weight:200,primary:69,mac:{primary:2340}}
```

Decode: `69` = F11; `2340` = KeyMod.CtrlCmd + KeyMod.WinCtrl + KeyF → **Ctrl+Cmd+F** on macOS.

CSS chrome hide under `.fullscreen`:

```css
.monaco-workbench.fullscreen .part.titlebar>.titlebar-container>.titlebar-left>.window-appicon{display:none}
.monaco-workbench.fullscreen .part.titlebar .window-controls-container{background-color:transparent;display:none}
```

Traffic-light offset zeroed when fullscreen (`Gqg` + `Nee`):

```js
function Gqg(n,e){const t=n.document.documentElement;if(!$s||e){t.style.setProperty($qg,"0px");return}...}
```

`body.no-titlebar-layout` titlebar pin (orthogonal to fullscreen; keeps titlebar mounted):

```css
body.no-titlebar-layout .monaco-workbench .part.titlebar{background:transparent!important;...position:fixed!important;pointer-events:none!important;...}
```

### (2) Editor / agent maximize — sidebar hide via `setSideBarHidden`, not native fullscreen

Unified maximize (expand chevron / `maximizeChatSize`) hides primary sidebar by default:

```js
t?.skipHideSidebar||this.setSideBarHidden(!0,!0),this.setPanelHidden(!0,!0),this.setEditorHidden(!0,!0)
```

Explicit HideSidebar command:

```js
id:"workbench.action.maximizeEditorHideSidebar",...run(n){...e.setPartHidden(!0,"workbench.parts.sidebar"),e.setPartHidden(!0,"workbench.parts.auxiliarybar"),t.arrangeGroups(0)}
```

`setSideBarHidden` flips `.nosidebar` on workbench root + grid visibility:

```js
setSideBarHidden(e,t){...e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible")):...;...this.workbenchGrid.setViewVisible(this.sideBarPartView,!e)}
```

`toggleMaximizeEditorGroup` — editor grid only, no sidebar hide:

```js
id:tMo,...async run(n,...e){...t.toggleMaximizeGroup(s.groupedEditors[0].group)}
```

Shift+Cmd+M maps to **Glass editor-panel fullscreen**, not workbench native fullscreen:

```js
id:JCg,title:"Enter Full Screen",...keybinding:{weight:u_,primary:3115,when:E9v},run:n=>{...e.setEditorPanelFullscreen(!0,{entrypoint:"command"})}
```

Decode: `3115` = KeyMod.CtrlCmd + KeyMod.Shift + KeyM → **Shift+Cmd+M**. Literal `Shift+Cmd+M` string: not found.

Expand chevron in editor panel header uses same Glass API:

```js
setEditorPanelFullscreen(!0,{entrypoint:"editor_panel_header"})
```

### (3) Zen mode — explicit sidebar hide, optional native fullscreen chain

```js
toggleZenMode(e,t=!1){...this.isZenModeActive()?(...this.setPanelHidden(!0,!0),this.setAuxiliaryBarHidden(!0,!0),this.setSideBarHidden(!0,!0),o.hideActivityBar&&this.setActivityBarHidden(!0,!0),o.hideStatusBar&&this.setStatusBarHidden(!0,!0)...
```

Zen may enter native fullscreen (separate from sidebar hide):

```js
s=a.transitionedToFullScreen&&this.state.runtime.mainWindowFullscreen),e||this.layout(),s&&this.hostService.toggleFullScreen(ci)
```

Exiting native fullscreen while Zen had entered it re-toggles Zen:

```js
...classList.remove("fullscreen"),this.stateModel.getRuntimeValue(Bu.ZEN_MODE_EXIT_INFO).transitionedToFullScreen&&this.isZenModeActive()&&this.toggleZenMode())
```

---

## Disambiguation verdicts

| Claim | Verdict |
|---|---|
| Native fullscreen collapses left sidebar? | **no** — only window chrome / titlebar policy / traffic-light CSS |
| Editor maximize can hide left sidebar? | **yes** — via `setSideBarHidden` in `setUnifiedMaximizeState` (default) or `workbench.action.maximizeEditorHideSidebar`; not via `toggleMaximizeEditorGroup` alone |
| Zen mode collapses left sidebar? | **yes** — direct `setSideBarHidden(!0,!0)` |
| Only editor maximize hides sidebars (among these three)? | **no** — Zen also hides; native fullscreen does not |
| Among native fullscreen vs editor maximize only, sidebar hide is exclusive to editor maximize? | **yes** |

---

## Honk `Shift+Cmd+M` / expand button mapping

Honk binds the shortcut and chevron to **editor-panel maximize**, matching Cursor Glass — not native window fullscreen.

| Surface | Honk | Cursor bundled |
|---|---|---|
| Shortcut | `mod+shift+m` → `editorPanel.toggleFullscreen` (`packages/server/src/keybindings.ts`) | `primary:3115` → `glass.enterEditorPanelFullscreen` → `setEditorPanelFullscreen(true)` |
| Button title | `Toggle editor panel fullscreen (${shortcut})` (`app.tsx`) | `Enter Full Screen` (Glass command); keywords `editor,panel,fullscreen` |
| Handler | `workspaceEditorActions.toggleFullscreen(workspaceKey, "right-workbench")` | `setEditorPanelFullscreen(!0,{entrypoint:"command"})` or `"editor_panel_header"` for chevron |
| Native OS fullscreen | not this path | `workbench.action.toggleFullScreen` — **Ctrl+Cmd+F** (mac) / **F11** |

**Conclusion:** Honk's label and shortcut align with Cursor's **editor/agent panel fullscreen** semantics (`setEditorPanelFullscreen` / unified maximize family), **not** `workbench.action.toggleFullScreen`. The misleading part is only if one expects Shift+Cmd+M to mean macOS native fullscreen; in Cursor it means editor-panel expand.

---

## Related round-2 slices

- Agent list stays on unified maximize: `round2/c2-agent-sidebar-maximize.md`
- Grid reflow on maximize enter/exit: `round2/c4-reflow-yield.md`
- Round-1 baseline: `05-fullscreen-maximize-state.md`
