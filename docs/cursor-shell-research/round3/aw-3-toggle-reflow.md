# AW-3: toggle to reflow without re-render

## Scope

This note traces Cursor's bundled workbench toggle and maximize paths for:

- Primary sidebar, `workbench.parts.sidebar`.
- Agent list or unified sidebar, `workbench.parts.unifiedsidebar`.
- Chat maximize, `workbench.action.maximizeChatSize`.

The target bundle was treated as read-only:

- JS: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`.
- CSS: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`.

Source discipline:

- The 61 MB JS bundle was not opened with `ReadFile`, `cat`, or an editor.
- Every anchor was counted first with `rg --count-matches -F`.
- Evidence windows were extracted with bounded `rg -oN -P` slices and capped output.

throughput checkpoint: n/a, read-only investigation.

Important correction:

`nosidebar`, `agentmode`, and `nomaineditorarea` are flipped on `.monaco-workbench`. In this build, `unifiedsidebarhidden` and `unifiedsidebarvisible` are flipped on `document.body`, not on `mainContainer`.

Evidence:

```text
mainContainer.classList.add("unifiedsidebarhidden") js=0
classList.add("unifiedsidebarhidden") js=1
```

```js
t=ci.document.body;t&&(n?(t.classList.add("sidebarvisible")...e?(t.classList.add("unifiedsidebarvisible"),t.classList.remove("unifiedsidebarhidden")...):(t.classList.remove("unifiedsidebarvisible"),t.classList.add("unifiedsidebarhidden")...))
```

## Anchor counts

Key JS counts:

- `workbench.action.toggleSidebarVisibility`: 3.
- `workbench.action.toggleUnifiedSidebar`: 4.
- `workbench.action.maximizeChatSize`: 5.
- `toggleUnifiedMaximizeState`: 2.
- `setUnifiedMaximizeState`: 18.
- `setPartHidden`: 105.
- `setSideBarHidden`: 9.
- `setUnifiedSidebarHidden`: 3.
- `setEditorHidden`: 8.
- `workbench.parts.unifiedsidebar`: 74.
- `unifiedSidebarPartView`: 31.
- `setViewVisible`: 29.
- `resizeView`: 47.
- `getPart(`: 72.
- `getContainer(`: 104.
- `registerPart(`: 17.
- `createPart(`: 2.

Relevant CSS counts:

- `nosidebar`: 1.
- `unifiedsidebarhidden`: 9.
- `unifiedsidebarvisible`: 5.
- `agentmode`: 15.
- `nomaineditorarea`: 6.

Not found:

- `workbench.action.toggleAgentsSideBar`: JS 0, CSS 0.
- `UNIFIEDSIDEBAR_HIDDEN`: JS 0, CSS 0.

## Stable part identity

Workbench parts are registered once. `getPart` and `getContainer` keep returning the same registered part object and its container. Toggle paths call these accessors, not a constructor.

Evidence:

```js
registerPart(e){const t=e.getId();return this.parts.set(t,e),or(()=>this.parts.delete(t))}getPart(e){const t=this.parts.get(e);if(!t){...throw new Error(`Unknown part ${e}
```

```js
getContainer(e,t){if(typeof t>"u")return this.getContainerFromDocument(e.document);if(e===ci)return this.getPart(t).getContainer();
```

The DOM part root is created once during workbench creation from the part list.

Evidence:

```js
for(const{id:D,role:M,classes:B,options:F}of[...]){const J=this.createPart(D,M,B);...this.getPart(D).create(J,F),...}
```

```js
createPart(n,e,t){const i=document.createElement(e==="status"?"footer":"div");return i.classList.add("part",...t),i.id=n,i.setAttribute("role",e),...}
```

## Primary sidebar toggle

### Enter hidden

1. The command calls the layout service with the current visibility inverted.

Evidence:

```js
run(e){const t=e.get(lm);t.setPartHidden(t.isVisible("workbench.parts.sidebar"),"workbench.parts.sidebar")}};PUg.ID="workbench.action.toggleSidebarVisibility"
```

2. The generic dispatcher routes the part id to `setSideBarHidden`.

Evidence:

```js
setPartHidden(e,t,i=ci){...switch(t){case"workbench.parts.activitybar":this.setActivityBarHidden(e);break;case"workbench.parts.sidebar":this.setSideBarHidden(e);break;...
```

```js
case"workbench.parts.unifiedsidebar":this.setUnifiedSidebarHidden(e);break}e&&(t==="workbench.parts.editor"||t==="workbench.parts.panel"||t==="workbench.parts.auxiliarybar")&&this.ensureMainContentAreaVisibleInvariant()
```

3. The sidebar method writes runtime state and persists it.

Evidence:

```js
setSideBarHidden(e,t){...this.stateModel.setRuntimeValue(Bu.SIDEBAR_HIDDEN,e),this.stateModel.save(!0,!1);
```

4. The workbench root class flips synchronously.

Evidence:

```js
e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible")):(this.mainContainer.classList.remove("nosidebar"),this.mainContainer.classList.add("sidebarvisible"))
```

5. The active pane composite is hidden. The part container is not destroyed.

Evidence:

```js
e&&this.paneCompositeService.getActivePaneComposite(0)?this.paneCompositeService.hideActivePaneComposite(0),s||this.isVisible("workbench.parts.unifiedsidebar")||this.focusPanelOrEditor()
```

6. The grid hides the existing sidebar view.

Evidence:

```js
const c=this.workbenchGrid.isViewVisible(this.sideBarPartView);this.workbenchGrid.setViewVisible(this.sideBarPartView,!e);const d=this.workbenchGrid.isViewVisible(this.sideBarPartView);
```

7. If unified mode is active, Cursor preserves unified-sidebar width around that reflow.

Evidence:

```js
const o=this.workbenchGrid.isViewVisible(this.unifiedSidebarPartView);let a;if(s&&o){const m=this.workbenchGrid.getViewSize(this.unifiedSidebarPartView);...a=m.width}
```

```js
a!==void 0&&this.workbenchGrid.isViewVisible(this.unifiedSidebarPartView)){const m=this.workbenchGrid.getViewSize(this.unifiedSidebarPartView);Math.abs(m.width-a)>1&&this.workbenchGrid.resizeView(this.unifiedSidebarPartView,{width:a,height:m.height})}
```

8. CSS backs up the root class by hard-hiding the same `.part.sidebar` node.

Evidence:

```css
.monaco-workbench.nosidebar>.part.sidebar{display:none!important;visibility:hidden!important}
```

### Exit hidden

1. The same command computes `isVisible(sidebar)` again and calls `setPartHidden(false, "workbench.parts.sidebar")`.

Evidence:

```js
run(e){const t=e.get(lm);t.setPartHidden(t.isVisible("workbench.parts.sidebar"),"workbench.parts.sidebar")}};PUg.ID="workbench.action.toggleSidebarVisibility"
```

2. The method removes `nosidebar`, adds `sidebarvisible`, and reopens the last active pane composite if needed.

Evidence:

```js
e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible")):(this.mainContainer.classList.remove("nosidebar"),this.mainContainer.classList.add("sidebarvisible"))
```

```js
else if(!e&&!this.paneCompositeService.getActivePaneComposite(0)){const o=this.paneCompositeService.getLastActivePaneCompositeId(0);o&&(...openPaneComposite...)}
```

3. The grid makes the same sidebar view visible again.

Evidence:

```js
this.workbenchGrid.setViewVisible(this.sideBarPartView,!e);const d=this.workbenchGrid.isViewVisible(this.sideBarPartView);
```

## Unified sidebar toggle

### Enter hidden

1. The actual command id is `workbench.action.toggleUnifiedSidebar`.

Evidence:

```js
var NzT="cursor.toggleAgentWindowIDEUnification",rFt="workbench.action.toggleUnifiedSidebar",U3g="workbench.action.toggleAgents"
```

2. The command checks current visibility, then calls `setPartHidden(true, "workbench.parts.unifiedsidebar")`.

Evidence:

```js
const h=i.isVisible("workbench.parts.unifiedsidebar");let f;h?(i.setPartHidden(!0,"workbench.parts.unifiedsidebar"),r.store("workbench.unifiedSidebar.hidden","true",1,1),f=!1)
```

3. The dispatcher routes the part id to `setUnifiedSidebarHidden`.

Evidence:

```js
case"workbench.parts.unifiedsidebar":this.setUnifiedSidebarHidden(e);break
```

4. `setUnifiedSidebarHidden(true)` stores hidden state and the current width, then changes grid visibility.

Evidence:

```js
setUnifiedSidebarHidden(e,t){if(!this.workbenchGrid)return;if(...this.storageService.store("workbench.unifiedSidebar.hidden",e?"true":"false",1,1),e&&this.workbenchGrid.isViewVisible(this.unifiedSidebarPartView)){const s=this.workbenchGrid.getViewSize(this.unifiedSidebarPartView).width;...
```

```js
this.workbenchGrid.setViewVisible(this.unifiedSidebarPartView,!e),this.updateUnifiedSidebarVisibleContextKey()
```

5. Body classes reflect the visibility for CSS.

Evidence:

```js
e?(t.classList.add("unifiedsidebarvisible"),t.classList.remove("unifiedsidebarhidden"),...):(t.classList.remove("unifiedsidebarvisible"),t.classList.add("unifiedsidebarhidden"),...)
```

6. CSS changes chrome around the existing auxiliary and composer DOM when unified sidebar is hidden.

Evidence:

```css
body.no-titlebar-layout.unifiedsidebarhidden .monaco-workbench .part.auxiliarybar>.content .split-view-view{padding-top:0}
```

```css
body.no-titlebar-layout.unifiedsidebarhidden[data-sidebar-position=right] .monaco-workbench .part.auxiliarybar.auxiliary-bar-show-agent-tabs>.title{padding-left:var(--traffic-lights-offset-adjusted,0)}
```

### Exit hidden

1. The command calls `setPartHidden(false, "workbench.parts.unifiedsidebar")`.

Evidence:

```js
h?...:(i.setPartHidden(!1,"workbench.parts.unifiedsidebar"),r.store("workbench.unifiedSidebar.hidden","false",1,1),f=!0)
```

2. The same registered `unifiedSidebarPartView` becomes visible again.

Evidence:

```js
this.workbenchGrid.setViewVisible(this.unifiedSidebarPartView,!e),this.updateUnifiedSidebarVisibleContextKey()
```

3. Body classes switch back to `unifiedsidebarvisible`.

Evidence:

```js
e?(t.classList.add("unifiedsidebarvisible"),t.classList.remove("unifiedsidebarhidden"),...)
```

## Chat maximize

### Enter maximized

1. The chat maximize command is `workbench.action.maximizeChatSize`.

Evidence:

```js
RUg=class F7v extends yn{constructor(){super({id:F7v.ID,title:F7v.LABEL,icon:it.minimize,toggled:{condition:ze.equals(K4e.key,!0),...}})}
```

```js
await i.toggleUnifiedMaximizeState()}};RUg.ID="workbench.action.maximizeChatSize",RUg.LABEL=At(3117,"Maximize Chat Size")
```

2. `toggleUnifiedMaximizeState` flips the desired state and delegates to `setUnifiedMaximizeState`.

Evidence:

```js
async toggleUnifiedMaximizeState(){const e=this.agentChatMaximizedContext?.get()??this.wasMaximized??!this.isVisible("workbench.parts.editor");await this.setUnifiedMaximizeState(!e)}
```

3. Enter caches current panel, sidebar, auxiliary-bar, and unified-sidebar sizes.

Evidence:

```js
if(this.isVisible("workbench.parts.unifiedsidebar")){const a=this.workbenchGrid.getViewSize(this.unifiedSidebarPartView);this.mainContainerDimension.width>0&&(this.unifiedSidebarWidthPercentageBeforeMaximize=a.width/this.mainContainerDimension.width)}
```

4. It ensures chat exists, then hides only the primary sidebar unless skipped, plus panel and editor.

Evidence:

```js
await this.chatEditorGroupService.ensureChatVisibleOrCreate(),t?.skipHideSidebar||this.setSideBarHidden(!0,!0),this.setPanelHidden(!0,!0),this.setEditorHidden(!0,!0)
```

5. It does not call `setUnifiedSidebarHidden`. The unified sidebar is read and measured, not hidden.

Evidence:

```text
Any setUnifiedMaximizeState window containing setUnifiedSidebarHidden: not found.
```

6. `setEditorHidden(true)` writes editor-hidden state, toggles `agentmode` and `nomaineditorarea`, and hides the editor grid view.

Evidence:

```js
setEditorHidden(e,t){this.stateModel.setRuntimeValue(Bu.EDITOR_HIDDEN,e),this.isUnifiedMode()&&(this.agentChatMaximizedContext?.set(e),this.wasMaximized=e,e?this.mainContainer.classList.add("agentmode"):this.mainContainer.classList.remove("agentmode"))
```

```js
e?this.mainContainer.classList.add("nomaineditorarea"):this.mainContainer.classList.remove("nomaineditorarea"),this.workbenchGrid&&this.editorPartView&&this.workbenchGrid.setViewVisible(this.editorPartView,!e)
```

7. When editor and panel are hidden in unified mode, the auxiliary bar is resized to fill the container minus fixed neighbors.

Evidence:

```js
const o=this.isVisible("workbench.parts.sidebar")?this.getSize("workbench.parts.sidebar").width:0,a=this.isVisible("workbench.parts.unifiedsidebar")?this.getSize("workbench.parts.unifiedsidebar").width:0,c=this.isVisible("workbench.parts.activitybar")?this.getSize("workbench.parts.activitybar").width:0
```

```js
d=Math.max(this.auxiliaryBarPartView.minimumWidth,this.mainContainerDimension.width-o-a-c);this.setSize("workbench.parts.auxiliarybar",{width:d,height:this.getSize("workbench.parts.auxiliarybar").height})
```

8. `setSize` is a grid resize over the existing part object.

Evidence:

```js
setSize(e,t){this.workbenchGrid.resizeView(this.getPart(e),t)}resizePart(e,t,i){...this.workbenchGrid.resizeView(this.sideBarPartView,{width:o.width+r,height:o.height})
```

9. The maximize state ends by setting the context key and saving layout state.

Evidence:

```js
this.wasMaximized=e,this.agentChatMaximizedContext?.set(e),this.stateModel.save(!0,!1),queueMicrotask(()=>{this.isTogglingUnifiedMaximization=!1})
```

### Exit maximized

1. Exit snapshots current sidebar, panel, and unified-sidebar ratios before restoring editor.

Evidence:

```js
const i=this.isVisible("workbench.parts.sidebar"),r=this.getSize("workbench.parts.sidebar").width,s=this.isVisible("workbench.parts.panel"),o=this.isVisible("workbench.parts.unifiedsidebar")?this.getSize("workbench.parts.unifiedsidebar").width/this.mainContainerDimension.width:0
```

2. It calls `setEditorHidden(false, true)`, which removes `agentmode` and `nomaineditorarea`, then makes the same editor view visible.

Evidence:

```js
this.setEditorHidden(!1,!0);const d=(this.auxiliaryBarWidthPercentageBeforeMaximize??.4)+c/2;
```

```js
e?this.mainContainer.classList.add("nomaineditorarea"):this.mainContainer.classList.remove("nomaineditorarea"),this.workbenchGrid&&this.editorPartView&&this.workbenchGrid.setViewVisible(this.editorPartView,!e)
```

3. It resizes auxiliary bar back toward the stored percentage.

Evidence:

```js
if(this.isVisible("workbench.parts.auxiliarybar")&&d){const f=Math.floor(this.mainContainerDimension.width*d);this.setSize("workbench.parts.auxiliarybar",{width:f,height:this.getSize("workbench.parts.auxiliarybar").height})}
```

4. It restores or keeps hidden the panel and primary sidebar from pre-maximize state.

Evidence:

```js
if(s||(this.panelVisibleBeforeMaximize??!1)){...this.setPanelHidden(!1,!0)}else this.setPanelHidden(!0,!0);
```

```js
if(i||(this.sidebarVisibleBeforeMaximize??!1))if(this.setSideBarHidden(!1,!0),i)this.setSize("workbench.parts.sidebar",{width:r,height:this.getSize("workbench.parts.sidebar").height})
```

5. It does not restore the unified sidebar through hide/show. The unified sidebar stayed visible, so only its width ratio participates in auxiliary-bar redistribution.

Evidence:

```js
const o=this.isVisible("workbench.parts.unifiedsidebar")?this.getSize("workbench.parts.unifiedsidebar").width/this.mainContainerDimension.width:0,c=(this.unifiedSidebarWidthPercentageBeforeMaximize??0)-o;
```

## Layout and visual changes

The visual change has two layers.

First, CSS reacts to root and body classes:

```css
.monaco-workbench.nosidebar>.part.sidebar{display:none!important;visibility:hidden!important}
```

```css
body .monaco-workbench.agentmode .part.auxiliarybar .composite.title.auxiliary-bar-title--agent-mode{max-width:none}
```

Second, the grid changes visibility and geometry:

```js
this.workbenchGrid.setViewVisible(this.sideBarPartView,!e)
```

```js
this.workbenchGrid.setViewVisible(this.unifiedSidebarPartView,!e)
```

Global layout is still the workbench grid layout pass:

```js
ceb(this.mainContainer,t,i,r,s,"relative"),SMn(this.mainContainer,o,a),this.workbenchGrid.layout(c,d),this.initialized=!0,this.handleContainerDidLayout(...)
```

## No teardown found

Positive evidence:

- The shell has stable part registration through `registerPart`.
- The DOM part containers are made by `createPart`.
- Toggle paths call `setViewVisible`, `resizeView`, `setSize`, and `layout`.
- `getPart` and `getContainer` still address the same part and container after toggles.

Negative evidence:

```text
removeChild(this.sideBarPartView              js=0
removeChild(this.unifiedSidebarPartView       js=0
```

```text
this.sideBarPartView.remove                   js=0
this.unifiedSidebarPartView.remove            js=0
```

```text
this.sideBarPartView.dispose                  js=0
this.unifiedSidebarPartView.dispose           js=0
```

`disposePart` exists, but the extracted windows put it on embedded auxiliary editor-part service cleanup, not on the primary-sidebar or unified-sidebar toggle paths.

Evidence:

```js
disposePart(){this._part&&this._part.close(),this._partDisposables?.dispose(),...this._embeddedPartHostContainer&&(this._embeddedPartHostContainer.remove(),...)}
```

```js
disposeEmbeddedPart(){this._isProgrammaticHide=!0;try{this.embeddedAuxBarEditorPartService.disposePart()}finally{this._isProgrammaticHide=!1}}
```

## Verdict

Cursor does not rebuild the chrome or content tree when the primary sidebar, unified sidebar, or chat maximize state changes. It preserves registered workbench parts and their DOM containers.

The transition is imperative:

1. Command dispatch.
2. `setPartHidden` or `toggleUnifiedMaximizeState`.
3. Runtime state and storage updates.
4. Root or body class flips.
5. `workbenchGrid.setViewVisible(...)`.
6. `workbenchGrid.resizeView(...)` or `setSize(...)` where width must be restored or expanded.
7. `layout()` for the current container size.

The chrome and content DOM are preserved. The visible change is CSS plus grid geometry. The only recreated nodes observed in adjacent research were toolbar menu items during menu refreshes, not the shell parts or the agent/sidebar content containers.
