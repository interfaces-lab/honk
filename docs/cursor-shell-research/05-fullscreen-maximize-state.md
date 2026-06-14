# 05. Fullscreen, maximize, centered layout state

## 1. Scope

This slice covers Cursor's bundled workbench layout state transitions for native fullscreen, editor-group maximize, Zen Mode, centered layout, and Cursor's "unified" chat/editor maximize path. The focus is the transition chain: command or host event -> state mutation -> class or attribute flip -> grid visibility or editor-grid resize -> CSS/chrome effect.

Evidence comes from bounded windows in:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

The bundle was not opened or read wholesale. Anchors were counted first, then small byte windows were extracted.

## 2. Mechanism

### Native window fullscreen

Native fullscreen is not the same state as editor maximize. It enters from host/fullscreen notifications and lands in the browser fullscreen observable.

Evidence:

```js
registerFullScreenListeners(n){this._register(this.hostService.onDidChangeFullScreen(({windowId:e,fullscreen:t})=>{if(e===n){const i=vEe(n);i&&hFr(t,i.window)}}))}
```

```js
function hFr(n,e){GRt.INSTANCE.setFullscreen(n,e)}function Nee(n){return GRt.INSTANCE.isFullscreen(n)}
```

`hFr` writes a window-scoped map and fires `onDidChangeFullscreen`.

Evidence:

```js
setFullscreen(e,t){if(this.isFullscreen(t)===e)return;const i=this.getWindowId(t);this.mapWindowIdToFullScreen.set(i,e),this._onDidChangeFullscreen.fire(i)}
isFullscreen(e){return!!this.mapWindowIdToFullScreen.get(this.getWindowId(e))}
```

The layout service subscribes to that event, then flips `.fullscreen` on the main `.monaco-workbench` container. It also toggles grid edge snapping and, when the custom titlebar policy applies, recomputes titlebar visibility.

Evidence:

```js
this._register(sCe(i=>this.onFullscreenChanged(i))),Gqg(ci,Nee(ci)),this._register(w9t(()=>{Gqg(ci,Nee(ci))})),this._register(sCe(()=>{Gqg(ci,Nee(ci))}))
```

```js
onFullscreenChanged(e){e===ci.vscodeWindowId&&(this.state.runtime.mainWindowFullscreen=Nee(ci),this.state.runtime.mainWindowFullscreen?this.mainContainer.classList.add("fullscreen"):(this.mainContainer.classList.remove("fullscreen"),...))
```

In CSS, `.fullscreen` hides workbench-owned titlebar app chrome. It does not require React to unmount anything.

Evidence:

```css
.monaco-workbench.fullscreen .part.titlebar>.titlebar-container>.titlebar-left>.window-appicon{display:none}
.monaco-workbench.fullscreen .part.titlebar .window-controls-container{background-color:transparent;display:none}
```

Traffic-light geometry is also class/state driven. On macOS fullscreen, Cursor zeros the adjusted traffic-light CSS variable; outside fullscreen it computes an offset from current layout state.

Evidence:

```js
function Gqg(n,e){const t=n.document.documentElement;if(!$s||e){t.style.setProperty($qg,"0px");return}const i=Lee(n),r=qtg(i);t.style.setProperty($qg,`${r}px`)}
```

### Maximize editor group

There are two separate editor maximize concepts:

- `workbench.action.toggleMaximizeEditorGroup` maximizes the active editor group inside the editor part.
- `workbench.action.maximizeEditorHideSidebar` hides side bars and maximizes the active editor group. This is the closest preserved command to "real full screen" for the editor over the side bars. A standalone `workbench.action.maximizeEditor` string was not found as a separate command id; the counted match is the prefix of `workbench.action.maximizeEditorHideSidebar`.

Evidence:

```js
tMo="workbench.action.toggleMaximizeEditorGroup"
```

```js
id:"workbench.action.maximizeEditorHideSidebar",title:At(3581,"Maximize Editor Group and Hide Side Bars")
```

The hide-sidebars action calls the layout service first, then the editor group service.

Evidence:

```js
n.get(Hi).activeEditor&&(e.setPartHidden(!0,"workbench.parts.sidebar"),e.setPartHidden(!0,"workbench.parts.auxiliarybar"),t.arrangeGroups(0))
```

The editor group service maximizes through the grid widget, not by re-rendering editor DOM.

Evidence:

```js
arrangeGroups(n,e=this.activeGroup){...case 0:if(this.groups.length<2)return;this.gridWidget.maximizeView(t),t.focus();break;case 1:this.gridWidget.expandView(t);break}
toggleMaximizeGroup(n=this.activeGroup){this.hasMaximizedGroup()?this.unmaximizeGroup():this.arrangeGroups(0,n)}
```

Part hiding goes through `setPartHidden`, which dispatches to part-specific methods.

Evidence:

```js
case"workbench.parts.sidebar":this.setSideBarHidden(e);break;case"workbench.parts.auxiliarybar":this.setAuxiliaryBarHidden(e);break;case"workbench.parts.panel":this.setPanelHidden(e);break
```

`setSideBarHidden` flips state, classes, active composite visibility, then grid visibility.

Evidence:

```js
this.stateModel.setRuntimeValue(Bu.SIDEBAR_HIDDEN,e),this.stateModel.save(!0,!1);...e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible")):(...)
```

```js
const c=this.workbenchGrid.isViewVisible(this.sideBarPartView);this.workbenchGrid.setViewVisible(this.sideBarPartView,!e);const d=this.workbenchGrid.isViewVisible(this.sideBarPartView)
```

`setAuxiliaryBarHidden` follows the same shape.

Evidence:

```js
this.stateModel.setRuntimeValue(Bu.AUXILIARYBAR_HIDDEN,e),this.stateModel.save(!0,!1),e?this.mainContainer.classList.add("noauxiliarybar"):this.mainContainer.classList.remove("noauxiliarybar")
```

```js
if(this.workbenchGrid.setViewVisible(this.auxiliaryBarPartView,!e),o!==void 0&&this.workbenchGrid.isViewVisible(this.unifiedSidebarPartView)){...this.workbenchGrid.resizeView(...)}
```

The CSS backstop for the hidden classes is direct and small.

Evidence:

```css
.monaco-workbench.nosidebar>.part.sidebar{display:none!important;visibility:hidden!important}
.monaco-workbench.noauxiliarybar .part.auxiliarybar,...{display:none!important;visibility:hidden!important}
```

### Zen Mode

The command is a thin wrapper around the layout service.

Evidence:

```js
id:"workbench.action.toggleZenMode",title:{...At(3149,"Toggle Zen Mode"),...}
run(n){return n.get(lm).toggleZenMode()}
```

`toggleZenMode` flips `ZEN_MODE_ACTIVE`, records exit info, then hides parts through the same class/grid paths used elsewhere. It optionally hides activity/status bars, enters native fullscreen, and centers the editor based on configuration.

Evidence:

```js
toggleZenMode(e,t=!1){const i=this._getFocusedPart();this.setZenModeActive(!this.isZenModeActive()),this.state.runtime.zenMode.transitionDisposables.clearAndDisposeAll()
```

```js
this.setPanelHidden(!0,!0),this.setAuxiliaryBarHidden(!0,!0),this.setSideBarHidden(!0,!0),o.hideActivityBar&&this.setActivityBarHidden(!0,!0),o.hideStatusBar&&this.setStatusBarHidden(!0,!0)
```

On exit, it restores the saved visibility state and exits fullscreen if Zen entered it.

Evidence:

```js
a.wasVisible.panel&&this.setPanelHidden(!1,!0),a.wasVisible.auxiliaryBar&&this.setAuxiliaryBarHidden(!1,!0),a.wasVisible.sideBar&&this.setSideBarHidden(!1,!0)
```

```js
s=a.transitionedToFullScreen&&this.state.runtime.mainWindowFullscreen),e||this.layout(),s&&this.hostService.toggleFullScreen(ci)
```

### Centered layout

Centered layout is a command and runtime state, but I did not find a `.centered` CSS selector in `workbench.desktop.main.css`.

Evidence:

```js
id:"workbench.action.toggleCenteredLayout",title:{...At(3113,"Toggle Centered Layout"),...}
run(n){const e=n.get(lm),t=n.get(hl);e.centerMainEditorLayout(!e.isMainEditorLayoutCentered()),t.activeGroup.focus()}
```

The layout service stores `MAIN_EDITOR_CENTERED`, delegates to the editor main part, then calls `layout()` unless the caller requests a silent transition.

Evidence:

```js
centerMainEditorLayout(e,t){this.stateModel.setRuntimeValue(Bu.MAIN_EDITOR_CENTERED,e);...this.editorGroupService.mainPart.isLayoutCentered()!==e&&(this.editorGroupService.mainPart.centerLayout(e),t||this.layout())
```

```js
centerLayout(n){this.centeredLayoutWidget.activate(n)}isLayoutCentered(){return this.centeredLayoutWidget?this.centeredLayoutWidget.isActive():!1}
```

### Unified chat/editor maximize

Cursor also has a unified layout maximize path that is close to Honk's right-workbench fullscreen: it stores pre-maximize sizes, hides sidebars/panel/editor through layout service methods, and restores sizes on exit.

Evidence:

```js
async toggleUnifiedMaximizeState(){const e=this.agentChatMaximizedContext?.get()??this.wasMaximized??!this.isVisible("workbench.parts.editor");await this.setUnifiedMaximizeState(!e)}
```

```js
await this.chatEditorGroupService.ensureChatVisibleOrCreate(),t?.skipHideSidebar||this.setSideBarHidden(!0,!0),this.setPanelHidden(!0,!0),this.setEditorHidden(!0,!0)
```

On exit, it sets editor visible, restores panel/sidebar visibility, and restores widths/heights from percentages.

Evidence:

```js
this.setEditorHidden(!1,!0);...this.setSize("workbench.parts.auxiliarybar",{width:f,height:this.getSize("workbench.parts.auxiliarybar").height})
```

```js
if(i||(this.sidebarVisibleBeforeMaximize??!1))if(this.setSideBarHidden(!1,!0),i)this.setSize("workbench.parts.sidebar",{width:r,height:this.getSize("workbench.parts.sidebar").height})
```

## 3. Exact identifiers

| Identifier | Kind | Element or owner | Effect |
|---|---|---|---|
| `workbench.action.toggleMaximizeEditorGroup` | command id | editor group service | Toggles `gridWidget.maximizeView(...)` for active editor group. |
| `workbench.action.maximizeEditorHideSidebar` | command id | layout service + editor group service | Hides primary sidebar and auxiliary bar, then maximizes editor group. |
| `workbench.action.minimizeOtherEditors` | command id | editor group service | Calls `arrangeGroups(1)`, which expands the active group. |
| `workbench.action.minimizeOtherEditorsHideSidebar` | command id | layout service + editor group service | Hides primary sidebar and auxiliary bar, then expands the active editor group. |
| `workbench.action.toggleZenMode` | command id | layout service | Toggles `ZEN_MODE_ACTIVE`, hides/restores parts, may enter native fullscreen, may center layout. |
| `workbench.action.toggleCenteredLayout` | command id | layout service + editor main part | Toggles `MAIN_EDITOR_CENTERED`, activates `centeredLayoutWidget`. |
| `.monaco-workbench` | root class | `mainContainer` | Main workbench container; all layout classes sit here. |
| `.fullscreen` | class | `.monaco-workbench` | Native fullscreen marker; hides app icon/window controls via CSS and changes edge snapping/titlebar visibility. |
| `.nosidebar` | class | `.monaco-workbench` | Marks primary sidebar hidden; CSS hides `.part.sidebar`; grid also sets sidebar view invisible. |
| `.sidebarvisible` | class | `.monaco-workbench` | Marks primary sidebar visible. I did not find a direct `.monaco-workbench.sidebarvisible` CSS rule. |
| `.noauxiliarybar` | class | `.monaco-workbench` | Marks auxiliary bar hidden; CSS hides `.part.auxiliarybar`; grid also sets view invisible. |
| `.nomaineditorarea` | class | `.monaco-workbench` | Marks editor part hidden. Used by unified maximize. |
| `.nopanel` | class | `.monaco-workbench` | Marks panel hidden; grid sets panel view invisible. |
| `.panelmaximized` | class | `.monaco-workbench` | Marks panel maximized when editor part is hidden and panel alignment/position allow it. |
| `.nostatusbar` | class | `.monaco-workbench` | Marks status bar hidden; grid sets status bar view invisible. |
| `.agentmode` | class | `.monaco-workbench` | Cursor unified layout marker when editor is hidden in unified mode. |
| `body.no-titlebar-layout` | body class | `document.body` | Makes titlebar fixed/transparent and keeps titlebar controls mounted with pointer-event overrides. |
| `--traffic-lights-offset-adjusted` | CSS custom property | `documentElement` | Updated on fullscreen/zoom; pads no-titlebar auxiliary/editor-tab chrome around mac traffic lights. |

Evidence for `.monaco-workbench` root:

```js
const s=Op(["monaco-workbench",_c?"windows":A_?"linux":"mac",Ad?"web":void 0,...this.getLayoutClasses(),...])
this.mainContainer.classList.add(...s)
```

Evidence for startup layout classes:

```js
getLayoutClasses(){return Op([this.isVisible("workbench.parts.sidebar")?void 0:"nosidebar",this.isVisible("workbench.parts.sidebar")?"sidebarvisible":void 0,...this.state.runtime.mainWindowFullscreen?"fullscreen":void 0,...])}
```

## 4. Normal vs maximized part-state table

| Part | Normal | Toggle maximize editor group | Maximize editor and hide side bars | Native window fullscreen | Zen Mode |
|---|---|---|---|---|---|
| Titlebar | Visible if titlebar policy says so. | Unchanged. | Unchanged. | `.fullscreen` on `.monaco-workbench`; titlebar view may be hidden by policy; app icon and window controls hidden by CSS. | Follows titlebar/native fullscreen settings; not the primary Zen hide target. |
| Activity bar | Visible unless user/config hides it. | Unchanged. | Unchanged by the command found. | Unchanged. | Hidden if `zenMode.hideActivityBar` is true through `setActivityBarHidden`. |
| Sidebar | Visible when `SIDEBAR_HIDDEN` false. | Unchanged. | Hidden by `setPartHidden(true,"workbench.parts.sidebar")`: `.nosidebar`, active composite hide, `workbenchGrid.setViewVisible(false)`. | Unchanged. | Hidden by `setSideBarHidden(true,true)`. |
| Editor | Visible. | Active editor group maximized inside editor part using `gridWidget.maximizeView`; other editor groups collapse inside the editor grid. | Editor part stays visible; active group maximized. | Unchanged. | Visible, unless other unified logic applies; can be centered. |
| Auxiliary bar | Visible when `AUXILIARYBAR_HIDDEN` false. | Unchanged. | Hidden by `setPartHidden(true,"workbench.parts.auxiliarybar")`: `.noauxiliarybar`, active composite hide, `workbenchGrid.setViewVisible(false)`. | Unchanged. | Hidden by `setAuxiliaryBarHidden(true,true)`. |
| Panel | Visible/hidden by panel state. | Unchanged. | Unchanged by this command. | Unchanged. | Hidden by `setPanelHidden(true,true)`, restored from Zen exit info. |
| Statusbar | Visible when `STATUSBAR_HIDDEN` false. | Unchanged. | Unchanged. | Unchanged, but mac focus radius rule only applies to `.mac:not(.fullscreen)`. | Hidden if `zenMode.hideStatusBar` is true through `setStatusBarHidden`. |

## 5. Geometry changes

The decisive geometry change is grid visibility. Classes are applied synchronously on `.monaco-workbench`, but the actual width reclamation comes from `workbenchGrid.setViewVisible(...)`, `gridWidget.maximizeView(...)`, `gridWidget.expandView(...)`, `resizeView(...)`, and `layout()`.

Evidence:

```js
this.workbenchGrid.setViewVisible(this.sideBarPartView,!e)
```

```js
this.workbenchGrid.layout(c,d),this.initialized=!0,this.handleContainerDidLayout(this.mainContainer,this._mainContainerDimension)
```

CSS still matters for chrome:

- `.fullscreen` hides workbench-managed titlebar app icon and window control container.
- `.nosidebar` and `.noauxiliarybar` provide hard display/visibility hiding for those part nodes.
- `body.no-titlebar-layout` fixes the titlebar at the top, makes the shell transparent to pointer events, and re-enables pointer events on action containers.
- `--traffic-lights-offset-adjusted` adds padding when titlebar chrome moves into editor/auxiliary tabs.
- `.mac:not(.fullscreen)` keeps statusbar focus radius; fullscreen removes that radius path.

Evidence:

```css
body.no-titlebar-layout .monaco-workbench .part.titlebar{background:transparent!important;border:none!important;height:34px!important;left:0!important;pointer-events:none!important;position:fixed!important;right:0!important;top:0!important;z-index:10000!important}
```

```css
body.no-titlebar-layout .monaco-workbench .part.titlebar>.titlebar-container>.titlebar-left{display:flex!important;flex-grow:0!important;min-width:0!important;pointer-events:auto!important;position:relative!important;width:auto!important;z-index:10001!important}
```

```css
body.no-titlebar-layout.unifiedsidebarhidden[data-sidebar-position=right] .monaco-workbench .part.auxiliarybar.auxiliary-bar-show-agent-tabs>.title{padding-left:var(--traffic-lights-offset-adjusted,0)}
```

```css
.monaco-workbench.mac:not(.fullscreen) .part.statusbar:focus{border-bottom-left-radius:10px;border-bottom-right-radius:10px}
```

## 6. State and connectivity

The state source is the layout service plus its state model:

- Native fullscreen: `GRt.INSTANCE` window fullscreen map -> `sCe` / `onDidChangeFullscreen` -> `onFullscreenChanged`.
- Part visibility: `stateModel.setRuntimeValue(Bu.*_HIDDEN, e)` -> class flip on `mainContainer` -> `workbenchGrid.setViewVisible(...)` -> `_onDidChangePartVisibility.fire()`.
- Centered layout: `Bu.MAIN_EDITOR_CENTERED` -> `editorGroupService.mainPart.centerLayout(e)` -> optional `layout()`.
- Zen Mode: `Bu.ZEN_MODE_ACTIVE` plus `Bu.ZEN_MODE_EXIT_INFO` -> existing part visibility methods -> restore on exit.
- Editor group maximize: editor group service -> editor part grid widget -> `maximizeView`, `expandView`, `exitMaximizedView`.

Evidence:

```js
this.stateModel.setRuntimeValue(Bu.STATUSBAR_HIDDEN,e),this.configurationService.updateValue("workbench.statusBar.visible",!e),e?this.mainContainer.classList.add("nostatusbar"):this.mainContainer.classList.remove("nostatusbar")
```

```js
this._onDidChangePartVisibility.fire(),this.handleContainerDidLayout(this.mainContainer,this._mainContainerDimension)
```

What re-renders: the workbench grid and editor grid lay out existing views. The root `.monaco-workbench` element and part containers stay mounted. CSS classes and custom properties move chrome. There is no React-style "render null" for the titlebar controls in these paths.

## 7. Honk mapping

Honk's `right-workbench fullscreen` should copy Cursor's canonical mechanism:

1. Treat fullscreen/maximize as a layout state on the shell root, not as a reason to unmount chrome.
2. Flip one root class or data attribute synchronously with the state change.
3. Let CSS collapse sibling columns and move titlebar/traffic-light chrome.
4. Keep titlebar controls, sidebars, center, and right-workbench mounted. Use `inert`/`aria-hidden` for interaction semantics, not `return null` for chrome that needs to visually move.

Current Honk evidence:

```tsx
if (fullscreen) {
  return null;
}
```

```tsx
useEffect(() => {
  const node = props.rootRef.current;
  ...
  node.dataset.shellFullscreenTarget = active ? "right-workbench" : "none";
```

The `return null` explains bug (a): titlebar controls disappear because React removes them from the tree on fullscreen. Cursor keeps controls mounted and changes layout through `.fullscreen`, `body.no-titlebar-layout`, and CSS variables.

The `useEffect` explains bug (b): the root `data-shell-fullscreen-target` write happens after commit and after the browser may have painted one frame of the old layout. During that frame, CSS selectors like:

```css
.agent-window[data-shell-fullscreen-target="right-workbench"] .agent-window__sidebar{width:0;min-width:0;overflow:hidden}
```

do not match yet, so the left sidebar can keep its previous width until another user action forces a render/reflow. Cursor avoids that class of bug by flipping `mainContainer.classList` inside the same imperative layout transition that updates the grid. The grid visibility call and class flip are contiguous:

```js
e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible")):(...)
```

```js
this.workbenchGrid.setViewVisible(this.sideBarPartView,!e)
```

For Honk, the closest equivalent is: when `workspaceEditorActions.toggleFullscreen(...)` changes the store, have the shell root receive `data-shell-fullscreen-target` in render or via a synchronous store subscription before paint. If avoiding `AppShell` re-render is still required, use a layout-synchronous external-store bridge or `useLayoutEffect`, not `useEffect`. The visual target is still Cursor's model: one root state marker, CSS-driven collapse, all chrome mounted.

## 8. Open questions and not found

- Standalone command id `workbench.action.maximizeEditor` was not found. The preserved match is `workbench.action.maximizeEditorHideSidebar`.
- A CSS selector `.centered` was not found in `workbench.desktop.main.css`. Centered layout appears to be implemented by `centeredLayoutWidget.activate(...)` inside the editor part.
- I did not deep-dive static grid descriptor ownership. This slice only records transition calls and observable class/grid effects.
- I did not prove the exact native macOS traffic-light DOM because native traffic lights are OS chrome. The workbench evidence shows Cursor calculating CSS offsets and hiding workbench-owned window controls/app icon under `.fullscreen`.
