# 1 Scope

This report covers Cursor's bundled workbench shell container, grid layout, registered parts, and generic part visibility mechanism. It uses only bounded string and byte-window extraction from:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

Evidence discipline:

- The JavaScript bundle is one minified 61MB line. It was never opened with `ReadFile`, `cat`, `head`, or an editor.
- Terms were counted first with `rg --count-matches -F`.
- Small slices were extracted around counted anchors and byte offsets.

Out of scope:

- Titlebar contents.
- Auxiliary-bar contents and composer internals.
- Fullscreen or maximize state machine internals beyond the shell classes they affect.

# 2 Mechanism

Cursor builds the workbench once, registers each part by id, and then hides or shows parts through layout state, root classes, and `workbenchGrid.setViewVisible(...)`.

Root creation is one pass through a literal part list. The root receives platform and layout classes, then each part gets a `div` or `footer` with id, role, and `.part` classes.

Evidence:

```text
const s=Op(["monaco-workbench",_c?"windows":A_?"linux":"mac",Ad?"web":void 0,k9t?"chromium":Wz?"firefox":oCe?"safari":void 0,...this.getLayoutClasses()
```

```text
for(const{id:D,role:M,classes:B,options:F}of[{id:"workbench.parts.titlebar",role:"none",classes:["titlebar"]},{id:"workbench.parts.banner",role:"banner",classes:["banner"]}
```

```text
createPart(n,e,t){const i=document.createElement(e==="status"?"footer":"div");return i.classList.add("part",...t),i.id=n,i.setAttribute("role",e),e==="status"&&i.setAttribute("aria-live","off"),i}
```

The grid owns geometry. `createWorkbenchLayout()` maps part ids to view objects, deserializes a grid descriptor, prepends the grid element, and sets the root role.

Evidence:

```text
const m={"workbench.parts.activitybar":this.activityBarPartView,"workbench.parts.banner":this.bannerPartView,"workbench.parts.titlebar":this.titleBarPartView,"workbench.parts.editor":this.editorPartView
```

```text
f=Aqg.deserialize(this.createGridDescriptor(),{fromJSON:h},{proportionalLayout:!1});this.mainContainer.prepend(f.element),this.mainContainer.setAttribute("role","application"),this.workbenchGrid=f
```

The visibility path is not React-style remounting. Registered parts stay addressable through `getPart(...)` and `getContainer(...)`; visibility changes update state, classes, and the grid.

Evidence:

```text
registerPart(e){const t=e.getId();return this.parts.set(t,e),or(()=>this.parts.delete(t))}getPart(e){const t=this.parts.get(e);if(!t){...throw new Error(`Unknown part ${e}
```

```text
getContainer(e,t){...if(e===ci)return this.getPart(t).getContainer()
```

The public dispatcher is `setPartHidden(e,t,i=ci)`. It calls per-part methods and enforces that at least one main content part remains visible.

Evidence:

```text
setPartHidden(e,t,i=ci){if(!(e&&this.wouldLeaveOnlyStatusBarVisible(t))&&!(!this.isUnifiedMode()&&e&&t==="workbench.parts.editor")){switch(t){case"workbench.parts.activitybar":this.setActivityBarHidden(e);break;
```

```text
e&&(t==="workbench.parts.editor"||t==="workbench.parts.panel"||t==="workbench.parts.auxiliarybar")&&this.ensureMainContentAreaVisibleInvariant()
```

# 3 Exact identifiers

| kind | literal | meaning |
| --- | --- | --- |
| root class | `monaco-workbench` | Main workbench container class. Evidence: `["monaco-workbench",_c?"windows":A_?"linux":"mac"` |
| root role | `role="application"` | Set on the root after the grid is prepended. Evidence: `this.mainContainer.setAttribute("role","application")` |
| grid class | `monaco-grid-view` | Top grid element class. Evidence: `.monaco-grid-view{overflow:hidden;position:relative}` |
| grid class | `monaco-grid-branch-node` | Grid branch node class. Evidence: `.monaco-grid-branch-node,.monaco-grid-view{height:100%;width:100%}` |
| part class | `part` | Base class on every workbench part. Evidence: `i.classList.add("part",...t)` |
| part id | `workbench.parts.titlebar` | Titlebar leaf. Evidence: `{id:"workbench.parts.titlebar",role:"none",classes:["titlebar"]}` |
| part id | `workbench.parts.banner` | Banner leaf. Evidence: `{id:"workbench.parts.banner",role:"banner",classes:["banner"]}` |
| part id | `workbench.parts.activitybar` | Activity bar leaf when activity bar location is vertical. Evidence: `{id:"workbench.parts.activitybar",role:"none",classes:["activitybar",A?"left":"right"]}` |
| part id | `workbench.parts.sidebar` | Primary sidebar leaf. Evidence: `{id:"workbench.parts.sidebar",role:"none",classes:["sidebar",A?"left":"right"]}` |
| part id | `workbench.parts.unifiedsidebar` | Cursor agent/unified sidebar leaf. Evidence: `{id:"workbench.parts.unifiedsidebar",role:"none",classes:["unifiedsidebar",R?"left":"right"]}` |
| part id | `workbench.parts.editor` | Main editor leaf. Evidence: `{id:"workbench.parts.editor",role:"main",classes:["editor"]}` |
| part id | `workbench.parts.panel` | Panel leaf. Evidence: `{id:"workbench.parts.panel",role:"none",classes:["panel","basepanel",D4e(this.getPanelPosition())]}` |
| part id | `workbench.parts.auxiliarybar` | Auxiliary bar leaf. Evidence: `{id:"workbench.parts.auxiliarybar",role:"none",classes:["auxiliarybar","basepanel",A?"right":"left"]}` |
| part id | `workbench.parts.statusbar` | Statusbar footer leaf. Evidence: `{id:"workbench.parts.statusbar",role:"status",classes:["statusbar"]}` |
| hide class | `nosidebar` | Root class when primary sidebar is hidden. Evidence: `e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible"))` |
| show class | `sidebarvisible` | Root class when primary sidebar is visible. Evidence: `this.mainContainer.classList.remove("nosidebar"),this.mainContainer.classList.add("sidebarvisible")` |
| hide class | `nopanel` | Root class when panel is hidden. Evidence: `e?this.mainContainer.classList.add("nopanel"):this.mainContainer.classList.remove("nopanel")` |
| hide class | `noauxiliarybar` | Root class when auxiliary bar is hidden. Evidence: `e?this.mainContainer.classList.add("noauxiliarybar"):this.mainContainer.classList.remove("noauxiliarybar")` |
| hide class | `nostatusbar` | Root class when statusbar is hidden. Evidence: `e?this.mainContainer.classList.add("nostatusbar"):this.mainContainer.classList.remove("nostatusbar")` |
| hide class | `nomaineditorarea` | Root class when editor part is hidden. Evidence: `e?this.mainContainer.classList.add("nomaineditorarea"):this.mainContainer.classList.remove("nomaineditorarea")` |
| state class | `panelmaximized` | Root class when panel occupies the main editor area. Evidence: `this.isPanelMaximized()?this.mainContainer.classList.add("panelmaximized")` |
| state class | `fullscreen` | Initial layout class when the main window is fullscreen. Evidence: `this.state.runtime.mainWindowFullscreen?"fullscreen":void 0` |
| state class | `native-titlebar` | Initial layout class when native titlebar layout is active. Evidence: `gX(this.configurationService)?"native-titlebar":void 0` |
| body class | `no-titlebar-layout` | Cursor body class for no-titlebar layout. Evidence: `ci.document.body.classList.toggle("no-titlebar-layout",f)` |
| setting key | `workbench.statusBar.visible` | Statusbar setting mirrored from hidden state. Evidence: `this.configurationService.updateValue("workbench.statusBar.visible",!e)` |
| setting key | `workbench.activityBar.location` | Activity-bar hidden state maps to `hidden`. Evidence: `this.configurationService.updateValue("workbench.activityBar.location",t?"hidden":void 0)` |
| setting key | `workbench.sideBar.location` | Sidebar position legacy setting. Evidence: `this.configurationService.updateValue("workbench.sideBar.location",D4e(t))` |
| setting key | `window.titleBarStyle` | Titlebar style setting. Evidence: `const s=t.titleBarStyle;if(s==="native"||s==="custom")return"custom"` |
| not found | `noactivitybar` | No JS or CSS hits found. Evidence: `noactivitybar js=0 css=0` |
| not found | `part-hidden` | No generic `part-hidden` shell class found. Evidence: `part-hidden js=0 css=0` |

# 4 DOM/component hierarchy

The root DOM is created by `renderWorkbench(...)`; the part tree is created from the grid descriptor. The exact visual order can change with sidebar side, panel position, banner order, titlebar mode, unified mode, and activity-bar orientation.

Evidence:

```text
const X={root:{type:"branch",size:e,data:[...this.shouldShowBannerFirst()?D.reverse():D,{type:"branch",data:ie,size:R},{type:"leaf",data:{type:"workbench.parts.statusbar"},size:E,visible:!this.stateModel.getRuntimeValue(Bu.STATUSBAR_HIDDEN)}]},orientation:vC.VERTICAL,width:e,height:t}
```

ASCII tree:

```text
div.monaco-workbench.mac|windows|linux.web?.chromium|firefox|safari?
  role="application"
  classes from getLayoutClasses()
  div.monaco-grid-view
    branch vertical
      leaf titlebar
        div#workbench.parts.titlebar.part.titlebar role="none"
      leaf banner
        div#workbench.parts.banner.part.banner role="banner"
      branch middle
        leaf activitybar
          div#workbench.parts.activitybar.part.activitybar.left|right role="none"
        leaf sidebar
          div#workbench.parts.sidebar.part.sidebar.left|right role="none"
        leaf unifiedsidebar
          div#workbench.parts.unifiedsidebar.part.unifiedsidebar.left|right role="none"
        leaf editor
          div#workbench.parts.editor.part.editor role="main"
        leaf panel
          div#workbench.parts.panel.part.panel.basepanel.left|right|top|bottom role="none"
        leaf auxiliarybar
          div#workbench.parts.auxiliarybar.part.auxiliarybar.basepanel.left|right role="none"
      leaf statusbar
        footer#workbench.parts.statusbar.part.statusbar role="status" aria-live="off"
  notifications center and toast overlays
```

Part internals use a generic title/content/header/footer layout, not unique root structures per part.

Evidence:

```text
create(n,e){this.parent=n,this.titleArea=this.createTitleArea(n,e),this.contentArea=this.createContentArea(n,e),this.partLayout=new bLx(this.options,this.contentArea)
```

```text
.monaco-workbench .part>.header-or-footer,.monaco-workbench .part>.title{box-sizing:border-box;display:none;display:flex;height:35px;overflow:hidden}
```

```text
.monaco-workbench .part>.content{font-size:13px}
```

# 5 Geometry & tokens

## Grid and sizing

The workbench lays out a real grid. It computes the container size, applies insets, sizes the root, and calls `workbenchGrid.layout(width,height)`.

Evidence:

```text
const e=yhe(this.state.runtime.mainWindowFullscreen?ci.document.body:this.parent,kf0),{top:t,right:i,bottom:r,left:s}=this.state.runtime.workbenchInsets,o=Math.max(0,e.width-s-i),a=Math.max(0,e.height-t-r)
```

```text
ceb(this.mainContainer,t,i,r,s,"relative"),SMn(this.mainContainer,o,a),this.workbenchGrid.layout(c,d)
```

Initial persisted sizes are explicit state keys. Defaults in the state table are 200px for sidebars and auxiliary bar, and 300px for panel size.

Evidence:

```text
SIDEBAR_SIZE:new i8h("sideBar.size",0,1,200),UNIFIED_SIDEBAR_SIZE:new i8h("unifiedSidebar.size",0,1,200),AUXILIARYBAR_SIZE:new i8h("auxiliaryBar.size",0,1,200),PANEL_SIZE:new i8h("panel.size",0,1,300)
```

Startup adjusts defaults against the actual window size.

Evidence:

```text
Bu.SIDEBAR_SIZE.defaultValue=Math.min(300,e.width/4),Bu.UNIFIED_SIDEBAR_SIZE.defaultValue=Math.min(300,e.width/4),Bu.AUXILIARYBAR_SIZE.defaultValue=Math.min(400,e.width/2.5)
```

The title/header/footer part layout token is 35px.

Evidence:

```text
H3h.HEADER_HEIGHT=35,H3h.TITLE_HEIGHT=35,H3h.Footer_HEIGHT=35
```

The statusbar is 22px in no-titlebar layout.

Evidence:

```text
body.no-titlebar-layout .monaco-workbench .part.statusbar{height:22px!important}
```

## Sashes

Sashes are absolute, not part-specific React elements. The CSS size token is 4px and the sash z-index is 35.

Evidence:

```text
:root{--vscode-sash-size:4px;--vscode-sash-hover-size:4px}.monaco-sash{contain:layout style paint;position:absolute;touch-action:none;will-change:transform;z-index:35}
```

Vertical sashes fill height and horizontal sashes fill width.

Evidence:

```text
.monaco-sash.vertical{cursor:ew-resize;height:100%;top:0;width:var(--vscode-sash-size)}
```

```text
.monaco-sash.horizontal{cursor:ns-resize;height:var(--vscode-sash-size);left:0;width:100%}
```

## Root, shell, and glass

The generic root styling is plain and clipped.

Evidence:

```text
.monaco-workbench{color:var(--vscode-foreground);font-size:13px;line-height:1.4em;overflow:hidden;z-index:1}
```

Classic bordered mac windows use radius on `.monaco-workbench.border`.

Evidence:

```text
.monaco-workbench.border:not(.fullscreen){border:1px solid var(--window-border-color);box-sizing:border-box}.monaco-workbench.border.mac{border-radius:10px}.monaco-workbench.border.mac.macos-tahoe{border-radius:16px}
```

The layout service also exposes the mac border radius as runtime layout info.

Evidence:

```text
getMainWindowBorderRadius(){return this.state.runtime.mainWindowBorder&&$s?"10px":void 0}
```

Cursor's glass chrome has a separate `data-component="root"` layer with fullscreen and system attributes.

Evidence:

```text
$("div",{className:"absolute inset-0 flex size-full flex-col outline-none","data-color-bucket":s,"data-component":"root","data-fullscreen":d,"data-system":k8n,ref:o,style:c,children:h})
```

Glass variables include surface backgrounds and window border color.

Evidence:

```text
--glass-surface-background:var(--cursor-bg-editor);--glass-sidebar-surface-background:var(--cursor-bg-sidebar);--glass-chat-surface-background:var(--cursor-bg-chrome)
```

```text
--glass-window-border-color:var(--vscode-foreground)
```

On Linux and Windows glass roots, the window border is drawn by a pseudo-element unless fullscreen.

Evidence:

```text
[data-component=root][data-system=linux]:not([data-fullscreen=true]):after,[data-component=root][data-system=windows]:not([data-fullscreen=true]):after{box-shadow:inset 0 0 0 1px var(--glass-window-border-color)}
```

## No-titlebar layout

`no-titlebar-layout` is a body class, not a part unmount. It changes the grid and part padding.

Evidence:

```text
ci.document.body.classList.toggle("no-titlebar-layout",f),this.updateWorkbenchInsets({top:f?sXm:0})
```

```text
body.no-titlebar-layout .monaco-workbench>.monaco-grid-view{height:100%!important;position:relative!important;top:0!important}
```

Sidebars and auxiliary panels receive 35px top compensation in selected no-titlebar states.

Evidence:

```text
body.no-titlebar-layout:not(.auxiliary-window) .monaco-workbench .part.sidebar:has(>.composite.title){padding-top:35px!important}
```

```text
body.no-titlebar-layout .monaco-workbench .part.auxiliarybar>.content .split-view-view{box-sizing:border-box;padding-top:35px}
```

When the statusbar is visible, sidebar content receives a 22px bottom inset.

Evidence:

```text
body.no-titlebar-layout:not(.auxiliary-window) .monaco-workbench:not(.nostatusbar) .part.sidebar.left>.content{padding-bottom:22px!important}
```

# 6 State & connectivity

## Visibility state

`isVisible(e,t)` reads grid state for titlebar, banner, and unifiedsidebar in initialized mode. For sidebar, panel, auxiliarybar, statusbar, activitybar, and editor, it reads runtime hidden state.

Evidence:

```text
case"workbench.parts.titlebar":return this.workbenchGrid.isViewVisible(this.titleBarPartView);case"workbench.parts.sidebar":return!this.stateModel.getRuntimeValue(Bu.SIDEBAR_HIDDEN)
```

```text
case"workbench.parts.statusbar":return!this.stateModel.getRuntimeValue(Bu.STATUSBAR_HIDDEN);case"workbench.parts.activitybar":return!this.stateModel.getRuntimeValue(Bu.ACTIVITYBAR_HIDDEN)
```

The state keys are structured, persisted, and mirrored back to legacy settings for some parts.

Evidence:

```text
ACTIVITYBAR_HIDDEN:new Pfe("activityBar.hidden",1,1,!1,!0),SIDEBAR_HIDDEN:new Pfe("sideBar.hidden",1,1,!1),EDITOR_HIDDEN:new Pfe("editor.hidden",1,1,!1)
```

```text
e===Bu.ACTIVITYBAR_HIDDEN?this.configurationService.updateValue("workbench.activityBar.location",t?"hidden":void 0):e===Bu.STATUSBAR_HIDDEN?this.configurationService.updateValue("workbench.statusBar.visible",!t)
```

## Class toggle plus grid reflow

Sidebar:

```text
e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible")):(this.mainContainer.classList.remove("nosidebar"),this.mainContainer.classList.add("sidebarvisible"))
```

```text
const c=this.workbenchGrid.isViewVisible(this.sideBarPartView);this.workbenchGrid.setViewVisible(this.sideBarPartView,!e);const d=this.workbenchGrid.isViewVisible(this.sideBarPartView);if(c!==d&&this._onDidChangePartVisibility.fire()
```

Panel:

```text
e?this.mainContainer.classList.add("nopanel"):this.mainContainer.classList.remove("nopanel")
```

```text
r!==e&&(this.workbenchGrid.setViewVisible(this.panelPartView,!e),!e&&r&&this.restorePanelSizeAfterRevealIfNeeded()
```

Auxiliary bar:

```text
e?this.mainContainer.classList.add("noauxiliarybar"):this.mainContainer.classList.remove("noauxiliarybar")
```

```text
this.workbenchGrid.setViewVisible(this.auxiliaryBarPartView,!e)
```

Statusbar:

```text
e?this.mainContainer.classList.add("nostatusbar"):this.mainContainer.classList.remove("nostatusbar"),this.workbenchGrid&&this.statusBarPartView&&this.workbenchGrid.setViewVisible(this.statusBarPartView,!e)
```

```text
this._onDidChangePartVisibility.fire(),this.handleContainerDidLayout(this.mainContainer,this._mainContainerDimension)
```

Editor:

```text
e?this.mainContainer.classList.add("nomaineditorarea"):this.mainContainer.classList.remove("nomaineditorarea"),this.workbenchGrid&&this.editorPartView&&this.workbenchGrid.setViewVisible(this.editorPartView,!e)
```

Activity bar:

```text
setActivityBarHidden(e,t){this.activityBarPartView&&(this.stateModel.setRuntimeValue(Bu.ACTIVITYBAR_HIDDEN,e),this.workbenchGrid.setViewVisible(this.activityBarPartView,!e))}
```

CSS hides some parts redundantly by root class. The grid is still the geometry authority.

Evidence:

```text
.monaco-workbench.nosidebar>.part.sidebar{display:none!important;visibility:hidden!important}
```

```text
.monaco-workbench.noeditorregion .part.editor,.monaco-workbench.noeditorregion .part.panel,.monaco-workbench.nopanel .part.panel{display:none!important;visibility:hidden!important}
```

```text
.monaco-workbench.noauxiliarybar .part.auxiliarybar{display:none!important;visibility:hidden!important}
```

Activity bar has no `noactivitybar` CSS or JS class. It is hidden by state and grid only.

Evidence:

```text
noactivitybar js=0 css=0
```

## What re-renders

The shell root and parts are created during `renderWorkbench(...)`. Later changes call class toggles, state writes, grid visibility changes, `resizeView(...)`, `moveView(...)`, and layout events. The extracted shell visibility paths do not recreate the part nodes.

Evidence:

```text
for(const{id:D,role:M,classes:B,options:F}of[...]){const J=this.createPart(D,M,B);...this.getPart(D).create(J,F)}
```

```text
setSize(e,t){this.workbenchGrid.resizeView(this.getPart(e),t)}resizePart(e,t,i){...this.workbenchGrid.resizeView(this.sideBarPartView,{width:o.width+r,height:o.height})
```

# 7 Honk mapping

Honk should copy the mechanism, not the whole implementation.

Honk already has a shell root with stable data attributes. The right shape is to add root-level layout state that CSS can consume, then reflow widths from that state.

Honk evidence:

```text
className="agent-window relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-row overflow-x-clip bg-transparent"
data-component="root"
```

```text
data-shell-left-intent={leftOpen ? "expanded" : "collapsed"}
data-shell-right-open={shellRightOpen ? "true" : "false"}
```

For bug (a), Cursor does not solve fullscreen by returning titlebar controls to null. Honk currently does.

Honk evidence:

```text
if (fullscreen) {
  return null;
}
```

Cursor's equivalent pattern is a root/body class plus CSS repositioning and insets. The useful fix is to keep Honk's titlebar controls mounted and move or hide them with selectors under `data-shell-fullscreen-target="right-workbench"` or a more explicit `data-shell-right-fullscreen="true"`.

Cursor evidence:

```text
ci.document.body.classList.toggle("no-titlebar-layout",f),this.updateWorkbenchInsets({top:f?sXm:0})
```

```text
body.no-titlebar-layout .monaco-workbench>.monaco-grid-view{height:100%!important;position:relative!important;top:0!important}
```

For bug (b), Cursor's sidebar collapse is not a visual-only hide. It writes hidden state, toggles root classes, and calls `workbenchGrid.setViewVisible(sideBarPartView,!e)`. Honk should make fullscreen derive the effective left width as zero in the same layout pass that sets fullscreen, not wait for `shellPanelsActions.toggleLeft()` or user interaction.

Cursor evidence:

```text
this.stateModel.setRuntimeValue(Bu.SIDEBAR_HIDDEN,e),this.stateModel.save(!0,!1)
```

```text
this.workbenchGrid.setViewVisible(this.sideBarPartView,!e)
```

Honk evidence that fullscreen is already known at the side panel:

```text
const fullscreen = props.rightOpen && fullscreenTarget === "right-workbench";
const hidden = fullscreen || !leftOpen;
```

The mapping:

- Add a single root attribute for right-workbench fullscreen. Honk already writes `data-shell-fullscreen-target` imperatively, so prefer using that as the class-equivalent signal.
- Define effective geometry from root attributes. Example meaning, not code: `--honk-shell-left-effective-width: 0px` when right fullscreen is active, while preserving the stored left width.
- Keep titlebar controls mounted. Change opacity, pointer-events, transform, or inset with CSS.
- Keep sidebars mounted. Toggle `aria-hidden` and `inert` as Honk already does, but make layout width follow the hidden state in the same render or imperative root update.
- Treat the right workbench as Cursor treats `workbench.parts.auxiliarybar` or `workbench.parts.panel`: a registered part whose visibility changes update shell geometry without rebuilding content.

# 8 Open questions/not-found

- `noactivitybar` was not found in JS or CSS. Evidence: `noactivitybar js=0 css=0`.
- `workbench.parts.activitybar` does hide and show, but only through `ACTIVITYBAR_HIDDEN` and `workbenchGrid.setViewVisible(...)`. Evidence: `setActivityBarHidden(e,t){...this.workbenchGrid.setViewVisible(this.activityBarPartView,!e)}`.
- `workbench.parts.banner` has a `setBannerHidden(e)` grid path but no root hide class was found in the requested class family. Evidence: `setBannerHidden(e){!this.workbenchGrid||!this.bannerPartView||this.workbenchGrid.setViewVisible(this.bannerPartView,!e)}`.
- `workbench.parts.titlebar` visibility is controlled by `shouldShowTitleBar(...)` and grid visibility, not a `notitlebar` workbench class in the extracted mechanism. Evidence: `updateCustomTitleBarVisibility(){const e=this.shouldShowTitleBar(...),t=this.isVisible("workbench.parts.titlebar");this.workbenchGrid&&e!==t&&this.workbenchGrid.setViewVisible(this.titleBarPartView,e)}`.
- `part-hidden` was not found as a shell mechanism. Evidence: `part-hidden js=0 css=0`. The actual generic mechanism is per-part methods plus `workbenchGrid.setViewVisible(...)`.
- The CSS selector `.monaco-workbench.noeditorregion` exists, but no JS hit for `noeditorregion` was found in the bundle count. Evidence: `noeditorregion js=0 css=2`.
- Some grid internals are named through minified symbols such as `Aqg.deserialize` and `vC.VERTICAL`. The preserved evidence is the serialized descriptor literals and DOM classes, not symbol names.
