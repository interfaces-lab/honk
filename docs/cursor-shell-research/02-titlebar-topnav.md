# 1 Scope

This slice covers Cursor's main workbench titlebar and top navigation. It focuses on the mounted DOM, command-center pill, right-side layout controls, native window controls, and the CSS or DOM-node movement that changes geometry in fullscreen and no-titlebar layouts.

throughput checkpoint: n/a, read-only investigation.

Source discipline:

- Binary probes used `rg --count-matches -F` first, then bounded byte windows around exact string offsets in `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`.
- CSS probes mined `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`.
- I did not open the bundle in an editor and did not read the whole bundle into context.

# 2 Mechanism

Cursor keeps VS Code's titlebar part id, then fills it with three flex regions. The titlebar part creates `.titlebar-container`, `.titlebar-left`, `.titlebar-center`, and `.titlebar-right` in one `createContentArea` path.

Evidence.

```js
this.rootContainer=Qt(n,zt(".titlebar-container")),this.leftContent=Qt(this.rootContainer,zt(".titlebar-left")),this.centerContent=Qt(this.rootContainer,zt(".titlebar-center")),this.rightContent=Qt(this.rootContainer,zt(".titlebar-right"))
```

The center region owns `.window-title`. If command center is enabled, Cursor replaces the text title with a `command-center` component. If it is disabled, it renders a text span or a workspace-name button that opens quick access.

Evidence.

```js
if(this.isCommandCenterVisible){const n=this.instantiationService.createInstance(h5v,this.windowTitle,this.hoverDelegate);ug(this.title,n.element)
```

```js
i.className="window-title-text agent-workspace-quickopen",i.type="button",i.textContent=t,...await this.commandService.executeCommand("workbench.action.quickOpenWithModes")
```

The right region owns `.action-toolbar-container` and, when native/custom titlebar rules allow, `.window-controls-container`. The toolbar is not a bespoke React header. It is a workbench `ActionBar`/toolbar fed by menus and editor group actions.

Evidence.

```js
this.actionToolBarElement=Qt(this.rightContent,zt("div.action-toolbar-container")),this.actionToolBarElement.classList.add("in-titlebar"),this.createActionToolBar(),this.createActionToolBarMenus()
```

```js
this.windowControlsContainer=Qt(e==="left"?this.leftContent:this.rightContent,zt("div.window-controls-container"))
```

The left region owns optional app icon, menubar, navigation controls, and other titlebar actions. Cursor creates a separate `.left-action-toolbar-container`, then splits it into `.left-other-actions-container` and `.navigation-actions-container`.

Evidence.

```js
this.leftActionToolBarElement=Qt(this.leftContent,zt("div.left-action-toolbar-container")),this.createLeftActionToolBar()
```

```js
const n=Qt(this.leftActionToolBarElement,zt("div.left-other-actions-container"));...const e=Qt(this.leftActionToolBarElement,zt("div.navigation-actions-container"))
```

The important non-rerender behavior is not that nothing ever updates. Menus and title content can rebuild when configuration changes. The geometry-sensitive controls are kept as DOM nodes and moved between containers, with classes toggled between `in-titlebar` and `in-editor-tabs`.

Evidence.

```js
t&&(n==="titlebar"&&this.windowControlsContainer?.parentElement===t?t.insertBefore(this.actionToolBarElement,this.windowControlsContainer):t.appendChild(this.actionToolBarElement),this.currentActionToolBarMode=n,this.actionToolBarElement.classList.toggle("in-editor-tabs",n==="editor-tabs"),this.actionToolBarElement.classList.toggle("in-titlebar",n==="titlebar"))
```

# 3 Exact identifiers

| Kind | Literal | Meaning |
| --- | --- | --- |
| part id | `workbench.parts.titlebar` | Main titlebar part. Evidence: `super("workbench.parts.titlebar",ci,"main"...` |
| command | `workbench.action.focusTitleBar` | Focuses titlebar controls. Evidence: `id:"workbench.action.focusTitleBar",title:At(3995,"Focus Title Bar")` |
| DOM class | `.part.titlebar` | Workbench titlebar part root. Evidence: `.monaco-workbench .part.titlebar{display:flex;flex-direction:row` |
| DOM class | `.titlebar-container` | Flex container inside titlebar. Evidence: `zt(".titlebar-container")` |
| DOM class | `.titlebar-left` | Left titlebar cluster. Evidence: `zt(".titlebar-left")` |
| DOM class | `.titlebar-center` | Center title/title command area. Evidence: `zt(".titlebar-center")` |
| DOM class | `.titlebar-right` | Right titlebar cluster. Evidence: `zt(".titlebar-right")` |
| DOM class | `.titlebar-drag-region` | Full-size draggable region. Evidence: `zt("div.titlebar-drag-region")` |
| DOM class | `.window-title` | Center title host. Evidence: `this.title=Qt(this.centerContent,zt("div.window-title"))` |
| DOM class | `.window-title-text` | Plain title text or workspace quick-open button. Evidence: `i.className="window-title-text agent-workspace-quickopen"` |
| DOM class | `.command-center` | Command center root. Evidence: `this.element.classList.add("command-center")` |
| DOM class | `.command-center-center` | Primary command-center action item. Evidence: `n.classList.add("command-center-center")` |
| DOM class | `.command-center-quick-pick` | Quick-open button inside command center. Evidence: `m.classList.toggle("command-center-quick-pick")` |
| menu id | `Ct.CommandCenter` | Command-center toolbar menu. Evidence: `t.createInstance(Bhe,this.element,Ct.CommandCenter` |
| menu id | `Ct.CommandCenterCenter` | Center submenu rendered by custom item. Evidence: `o.item.submenu===Ct.CommandCenterCenter` |
| setting | `window.commandCenter` | Enables the command-center title content. Evidence: `n.affectsConfiguration("window.commandCenter")` |
| setting | `workbench.commandCenter` | not found |
| setting | `workbench.layoutControl.enabled` | Enables layout controls. Evidence: `n.affectsConfiguration("workbench.layoutControl.enabled")` |
| setting | `workbench.layoutControl.type` | Switches menu-style layout control. Evidence: `ze.equals("config.workbench.layoutControl.type","menu")` |
| setting | `workbench.navigationControl.enabled` | Enables navigation controls. Evidence: `n.affectsConfiguration("workbench.navigationControl.enabled")` |
| setting | `workbench.agentsWindowButton.enabled` | Cursor titlebar agents button. Evidence: `b2p.SETTING="workbench.agentsWindowButton.enabled"` |
| menu id | `Ct.LayoutControlMenu` | Main layout-control menu. Evidence: `this.menuService.createMenu(Ct.LayoutControlMenu,this.contextKeyService)` |
| menu id | `Ct.LayoutControlMenuSubmenu` | Layout submenu under layout control. Evidence: `submenu:Ct.LayoutControlMenuSubmenu,title:N(3047,null)` |
| command | `workbench.action.customizeLayout` | Opens customize layout menu. Evidence: `id:"workbench.action.customizeLayout",title:At(3163,"Customize Layout...")` |
| command | `workbench.action.openLayoutSettingsMenu` | Layout settings action. Evidence: `ID="workbench.action.openLayoutSettingsMenu"` |
| command | `workbench.action.openAgentLayoutQuickMenu` | Cursor settings quick menu from titlebar. Evidence: `ID="workbench.action.openAgentLayoutQuickMenu"` |
| command | `workbench.action.toggleSidebarVisibility` | Primary sidebar toggle. Evidence: `PUg.ID="workbench.action.toggleSidebarVisibility"` |
| command | `workbench.action.toggleSidebarPosition` | Sidebar left/right position toggle. Evidence: `IUg.ID="workbench.action.toggleSidebarPosition"` |
| command | `workbench.action.togglePanel` | Panel toggle in layout menu, intentionally omitted from titlebar action builder. Evidence: `TUg.ID="workbench.action.togglePanel"` and `case"workbench.action.togglePanel":return` |
| command | `workbench.action.toggleAuxiliaryBar` | Secondary side bar or chat pane toggle. Evidence: `xUg.ID="workbench.action.toggleAuxiliaryBar"` |
| command | `workbench.action.maximizeChatSize` | Maximize chat action. Evidence: `RUg.ID="workbench.action.maximizeChatSize"` |
| command | `workbench.action.toggleFullScreen` | Workbench fullscreen command. Evidence: `executeCommand("workbench.action.toggleFullScreen")` |
| command | `toggleFullScreen` | Cursor/Glass command wrapper that calls workbench fullscreen. Evidence: `id:"toggleFullScreen",title:"Toggle Full Screen"` |
| command | `workbench.action.toggleZenMode` | Layout customization option. Evidence: `Znt("workbench.action.toggleZenMode",ife,N(3103,null),KIx)` |
| command | `workbench.action.toggleCenteredLayout` | Layout customization option. Evidence: `Znt("workbench.action.toggleCenteredLayout",Gdh,N(3104,null),jIx)` |
| command | `workbench.action.splitEditor` | Generic split editor command. Evidence: `eMo="workbench.action.splitEditor"` |
| command | `workbench.action.splitEditorRight` | Split editor right. Evidence: `fBt="workbench.action.splitEditorRight"` |
| command | `workbench.action.splitEditorDown` | Split editor down. Evidence: `pBt="workbench.action.splitEditorDown"` |
| label | `Split Right` | Menubar/editor window label. Evidence: `title:{...At(3507,"Split Right")` and `label:"Split Right"` |
| label | `Split Down` | Menubar/editor window label. Evidence: `title:{...At(3505,"Split Down")` and `label:"Split Down"` |
| label | `Editor Window` | Open editor window CTA. Evidence: `"aria-label":"Editor Window",className:"open-editor-window-cta"` |
| label | `Enter Full Screen` | Fullscreen button label. Evidence: `title:J?"Exit Full Screen":"Enter Full Screen"` |
| label | `Window Controls` | Command title for traffic-light update path. Evidence: `title:{value:"Update Window Controls",original:"Update Window Controls"}` |
| class | `.window-controls-container` | Native/custom window controls host. Evidence: `zt("div.window-controls-container")` |
| class | `.wco-enabled` | Added when window controls overlay is enabled. Evidence: `this.windowControlsContainer.classList.add("wco-enabled")` |
| CSS variable | `--zoom-factor` | Titlebar counter-zoom support. Evidence: `this.element.style.setProperty("--zoom-factor",e.toString())` |
| CSS variable | `--traffic-lights-offset-adjusted` | Runtime macOS traffic-light inset. Evidence: `var $qg="--traffic-lights-offset-adjusted"` |
| literal | `--window-controls` | not found |
| literal | `layout-controls` | not found |
| literal | `TITLE_BAR` | not found |

# 4 DOM/component hierarchy

Observed and inferred hierarchy from constructors and selectors:

```text
.monaco-workbench[.mac][.fullscreen]
  .part.titlebar
    .titlebar-container[.counter-zoom]
      .titlebar-drag-region
      .titlebar-left
        a.window-appicon
        .menubar[role=menubar]
        .left-action-toolbar-container
          .left-other-actions-container
            .monaco-toolbar
              .monaco-action-bar
          .navigation-actions-container
            .monaco-toolbar
              .monaco-action-bar
        .window-controls-container
      .titlebar-center
        .window-title
          .command-center
            .monaco-toolbar
              .monaco-action-bar
                .action-item.command-center-center[.multiple]
                  .action-item.command-center-quick-pick[role=button]
                    .search-icon
                    .search-label
          .window-title-text
      .titlebar-right
        .action-toolbar-container.in-titlebar
          .monaco-toolbar
            .monaco-action-bar
        .window-controls-container[.wco-enabled]
          .window-icon
```

The native controls container can be placed on either side. macOS defaults left. Other platforms default right unless controls are hidden.

Evidence.

```js
let e=$s?"left":"right";...this.windowControlsContainer=Qt(e==="left"?this.leftContent:this.rightContent,zt("div.window-controls-container"))
```

The right action toolbar is inserted before window controls when both share the right content container.

Evidence.

```js
n==="titlebar"&&this.windowControlsContainer?.parentElement===t?t.insertBefore(this.actionToolBarElement,this.windowControlsContainer):t.appendChild(this.actionToolBarElement)
```

# 5 Geometry & tokens

The normal titlebar height constant is `35`. In no-titlebar layout, the titlebar part reports zero minimum height to the layout system, while CSS keeps a fixed overlay shell mounted at `34px`.

Evidence.

```js
mZs={WIDTH:400,...},Ktg="Cursor Agents",Ytg=35,Qtg={width:1280,height:800}
```

```js
get minimumHeight(){if(this.isNoTitlebarLayoutActive())return 0;...let e=Ytg;return n&&(e=Math.max(e,AOC(so(this.element))?.height??0)),e/(this.preventZoom?Lee(so(this.element)):1)}
```

```css
body.no-titlebar-layout .monaco-workbench .part.titlebar{background:transparent!important;border:none!important;height:34px!important;left:0!important;pointer-events:none!important;position:fixed!important;right:0!important;top:0!important;z-index:10000!important}
```

The titlebar container is a 100 percent height flex row. Left and right each default to 20 percent width. Center defaults to 60 percent with a 10px horizontal margin.

Evidence.

```css
.monaco-workbench .part.titlebar>.titlebar-container{align-items:center;box-sizing:border-box;display:flex;flex-grow:1;flex-shrink:1;height:100%;justify-content:space-between;overflow:hidden;user-select:none;-webkit-user-select:none;width:100%}
```

```css
.titlebar-left{flex-grow:2;justify-content:flex-start;min-width:max-content;order:0;width:20%}.monaco-workbench .part.titlebar>.titlebar-container>.titlebar-center{justify-content:center;margin:0 10px;max-width:fit-content;min-width:0;order:1;width:60%}
```

The command center pill is 22px high, `38vw` wide, capped at `600px`, with a 6px radius and a 1px border. It sits inside `.window-title`.

Evidence.

```css
.command-center .action-item.command-center-center{align-items:stretch;background-color:var(--vscode-commandCenter-background);border:1px solid var(--vscode-commandCenter-border);border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top-left-radius:6px;border-top-right-radius:6px;color:var(--vscode-commandCenter-foreground);display:flex;height:22px;margin:0 6px;max-width:600px;overflow:hidden;width:38vw}
```

The center quick-pick label truncates, and the icon is 14px with reduced opacity.

Evidence.

```css
.command-center-quick-pick .search-icon{color:var(--vscode-commandCenter-foreground);font-size:14px;margin:auto 3px;opacity:.8}
```

```css
.command-center-quick-pick .search-label{overflow:hidden;text-overflow:ellipsis}
```

The right action toolbar is hidden when it has no actions, otherwise flexed. It has `padding-right:8px`, `z-index:2500`, and lives above the drag region.

Evidence.

```css
.titlebar-right>.action-toolbar-container{display:none;flex-grow:0;flex-shrink:0;height:100%;margin-left:auto;padding-right:8px;position:relative;text-align:center;z-index:2500}
```

```css
.titlebar-right>.action-toolbar-container:not(.has-no-actions){display:flex;justify-content:center}
```

Native window controls use `.window-controls-container`. Non-web, non-mac platforms reserve `138px`. Non-web mac reserves `70px`. Fullscreen hides the container.

Evidence.

```css
.monaco-workbench:not(.web):not(.mac) .part.titlebar .window-controls-container{width:calc(138px/var(--zoom-factor, 1))}
```

```css
.monaco-workbench:not(.web).mac .part.titlebar .window-controls-container{width:70px}
```

```css
.monaco-workbench.fullscreen .part.titlebar .window-controls-container{background-color:transparent;display:none}
```

Web window controls use the Window Controls Overlay env variables.

Evidence.

```css
.monaco-workbench.web .part.titlebar .titlebar-right .window-controls-container{height:env(titlebar-area-height,35px);width:calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px))}
```

Mac traffic-light offset is written to the document root as `--traffic-lights-offset-adjusted`. CSS then consumes it for no-titlebar auxiliary/editor padding when sidebars are hidden.

Evidence.

```js
var $qg="--traffic-lights-offset-adjusted",AGS=`var(${$qg}, 0px)`;function Gqg(n,e){const t=n.document.documentElement;if(!$s||e){t.style.setProperty($qg,"0px");return}...t.style.setProperty($qg,`${r}px`)}
```

```css
body.no-titlebar-layout.unifiedsidebarhidden[data-sidebar-position=right] .monaco-workbench .part.auxiliarybar.auxiliary-bar-show-agent-tabs>.title{padding-left:var(--traffic-lights-offset-adjusted,0)}
```

The no-titlebar shell disables pointer events on the shell and selectively re-enables them on controls. That lets it sit over the app without blocking editor chrome.

Evidence.

```css
body.no-titlebar-layout .monaco-workbench .part.titlebar{...pointer-events:none!important;position:fixed!important...}
```

```css
body.no-titlebar-layout .monaco-workbench .part.titlebar>.titlebar-container>.titlebar-left>.left-action-toolbar-container{display:flex!important;pointer-events:auto!important;position:relative!important;width:fit-content!important;z-index:10002!important}
```

# 6 State & connectivity

Titlebar text and command-center visibility can rebuild. Geometry updates mostly move existing toolbar nodes. Cursor watches configuration, context keys, editor group changes, visible editors, sidebar layout, panel position, and chat/editor-group state, then schedules titlebar menu and positioning updates.

Evidence.

```js
n.affectsConfiguration("window.commandCenter")&&(this.createTitle(),this.scheduleActionToolBarMenusUpdate({layoutActions:!0}),this._onDidChange.fire(void 0))
```

```js
this.actionToolBarDisposable.add(this.editorGroupsContainer.onDidAddGroup(()=>{e()})),this.actionToolBarDisposable.add(this.editorGroupsContainer.onDidRemoveGroup(()=>{e()})),this.actionToolBarDisposable.add(this.editorGroupsContainer.onDidMoveGroup(()=>{e()})),this.actionToolBarDisposable.add(this.editorService.onDidVisibleEditorsChange(()=>{e()}))
```

`updateActionsPositioning` debounces to the next animation frame, then `doUpdateActionsPositioning` chooses a target container.

Evidence.

```js
updateActionsPositioning(){this.pendingActionsPositioningUpdate!==void 0&&so(this.element).cancelAnimationFrame(this.pendingActionsPositioningUpdate),this.pendingActionsPositioningUpdate=so(this.element).requestAnimationFrame(()=>{this.pendingActionsPositioningUpdate=void 0,this.doUpdateActionsPositioning()})}
```

The layout action cluster targets either the titlebar right region or an editor group's `.layout-actions-container`.

Evidence.

```js
const n=this.getLayoutActionsPositioningMode(),e=this.findTopRightMostGroupIncludingAuxBar(),t=n==="titlebar"?this.rightContent:this.getLayoutActionsTargetContainer(e)
```

Left other actions and navigation controls follow the same pattern, except their fallback target is the top-left editor group's `leftActionsContainer`.

Evidence.

```js
const n=this.getLeftOtherActionsPositioningMode(),e=this.findTopLeftMostGroupIncludingAuxBar(),t=n==="titlebar"?this.leftActionToolBarElement:e?.leftActionsContainer
```

Mode selection is a pure decision over no-titlebar layout, editor visibility, sidebar edge emptiness, chat editor group state, and panel state. It returns only `"titlebar"` or `"editor-tabs"`.

Evidence.

```js
function dNx(n){if(!n.noTitlebarLayoutEnabled)return"titlebar";...return n.isRightSidebarHidden&&!e&&!t?"editor-tabs":"titlebar"}
```

```js
function IGS(n){if(!n.noTitlebarLayoutEnabled)return"titlebar";...return n.isLeftEdgeEmpty&&!e?"editor-tabs":"titlebar"}
```

No-titlebar layout keeps the topbar mounted but outside normal layout. The part reports `minimumHeight` as `0`, while CSS fixes `.part.titlebar` to the viewport top with `z-index:10000`. Fullscreen and no-titlebar state therefore change classes and CSS, not the identity of the titlebar part.

Evidence.

```js
get minimumHeight(){if(this.isNoTitlebarLayoutActive())return 0;...}
```

```css
body.no-titlebar-layout .monaco-workbench .part.titlebar{...position:fixed!important;right:0!important;top:0!important;z-index:10000!important}
```

Fullscreen hides native window controls and app icon by class. The titlebar part remains addressable as `.part.titlebar`.

Evidence.

```css
.monaco-workbench.fullscreen .part.titlebar .window-controls-container{background-color:transparent;display:none}
```

```css
.monaco-workbench.fullscreen .part.titlebar>.titlebar-container>.titlebar-left>.window-appicon{display:none}
```

# 7 Honk mapping

Honk's `ShellHeaderControls` should not `return null` on fullscreen if the goal is Cursor parity. Cursor keeps the titlebar part and its control nodes mounted. It changes layout in three layers.

First, the layout model can assign the titlebar zero height. Cursor does this through the titlebar part getter when no-titlebar layout is active.

Evidence.

```js
get minimumHeight(){if(this.isNoTitlebarLayoutActive())return 0;...}
```

Second, CSS pins the mounted titlebar shell to the viewport top and disables pointer events on the shell. Controls opt back into pointer events.

Evidence.

```css
body.no-titlebar-layout .monaco-workbench .part.titlebar{...pointer-events:none!important;position:fixed!important;right:0!important;top:0!important;z-index:10000!important}
```

```css
body.no-titlebar-layout .monaco-workbench .part.titlebar>.titlebar-container>.titlebar-left>.left-action-toolbar-container{...pointer-events:auto!important...}
```

Third, Cursor moves existing toolbar nodes between titlebar and editor-tab containers. It does not recreate the controls just to change their place.

Evidence.

```js
t&&(t.appendChild(this.navigationActionsContainer),this.navigationActionsContainer.classList.toggle("in-editor-tabs",n==="editor-tabs"),this.navigationActionsContainer.classList.toggle("in-titlebar",n==="titlebar"))
```

For Honk, that maps to:

- Keep `ShellHeaderControls` mounted across fullscreen.
- Put fullscreen/no-titlebar state on a shell root class or data attribute.
- Let CSS change position, height, pointer events, z-index, and visibility.
- If a control cluster must move into editor tabs, move the same DOM subtree or render one stable subtree into a target container. Do not branch it away with `return null`.
- Track macOS traffic-light space as a CSS variable. Cursor's version is `--traffic-lights-offset-adjusted`.

# 8 Open questions/not-found

- `workbench.commandCenter` was not found. The setting used by this build is `window.commandCenter`.
- `--window-controls` was not found. Window-control geometry uses `.window-controls-container`, Window Controls Overlay env variables, and JS calls to `nativeHostService.updateWindowControls(...)`.
- `layout-controls` was not found. The preserved terms are `layoutControl`, `Ct.LayoutControlMenu`, and `Ct.LayoutControlMenuSubmenu`.
- `TITLE_BAR` was not found. The titlebar height constant appears as minified `Ytg=35`.
- Literal shortcut strings `Cmd+D`, `⌘D`, `Shift+Cmd+D`, and `⇧⌘D` were not found. The bundle stores command ids and labels, while displayed shortcut strings appear computed from keybinding services.
- I found `Enter Full Screen` and the `toggleFullScreen` wrapper that calls `workbench.action.toggleFullScreen`. I did not find a preserved `Shift+Cmd+M` string.
- I did not deep-dive the fullscreen or zen state machines. The titlebar-facing evidence is CSS class handling and the mode functions returning `"titlebar"` or `"editor-tabs"`.
