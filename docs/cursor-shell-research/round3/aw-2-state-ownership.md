# Round 3: AW-2 layout state ownership

## Scope

This note answers where Cursor's agent-window panel layout state lives, how the chrome reads it, and how changes propagate.

throughput checkpoint: n/a, read-only investigation.

Source discipline:

- The bundle was not opened with `ReadFile`, `cat`, `head`, or an editor.
- Every binary anchor was counted first with `rg --count-matches -F`.
- Evidence windows used bounded `rg -oN -P` extraction, capped before entering the transcript.
- Prior reports in `docs/cursor-shell-research/01..05*.md` and `round2/*.md` were read first.

## Findings

### 1. The canonical live state is the layout service state model.

The preserved state table defines runtime booleans, runtime mode flags, and initialization sizes in one `Bu` map. The relevant size keys are initialization values; the relevant visibility and mode keys are runtime values.

Evidence:

```js
Bu={MAIN_EDITOR_CENTERED:new Pfe("editor.centered",1,1,!1),ZEN_MODE_ACTIVE:new Pfe("zenMode.active",1,1,!1),ZEN_MODE_EXIT_INFO:new Pfe("zenMode.exitInfo",1,1,{transitionedToCenteredEditorLayout:!1,transitionedToFullScreen:!1,handleNotificationsDoNotDisturbMode:!1,wasVisible:{auxiliaryBar:!1,panel:!1,sideBar:!1}}),SIDEBAR_SIZE:new i8h("sideBar.size",0,1,200),UNIFIED_SIDEBAR_SIZE:new i8h("unifiedSidebar.size",0,1,200),AUXILIARYBAR_SIZE:new i8h("auxiliaryBar.size",0,1,200)
```

```js
ACTIVITYBAR_HIDDEN:new Pfe("activityBar.hidden",1,1,!1,!0),SIDEBAR_HIDDEN:new Pfe("sideBar.hidden",1,1,!1),EDITOR_HIDDEN:new Pfe("editor.hidden",1,1,!1),PANEL_HIDDEN:new Pfe("panel.hidden",1,1,!0),AUXILIARYBAR_HIDDEN:new Pfe("auxiliaryBar.hidden",1,1,!1),STATUSBAR_HIDDEN:new Pfe("statusBar.hidden",1,1,!1,!0)
```

`Pfe` marks runtime state. `i8h` marks initialization state. The state model stores values in `stateCache`, persists keys under `workbench.`, and mirrors selected legacy settings.

Evidence:

```js
save(e,t){let i;const r=this.getRuntimeValue(Bu.ZEN_MODE_ACTIVE);for(i in Bu){const s=Bu[i];if(e&&s.scope===1||t&&s.scope===0){if(r&&s instanceof Pfe&&s.zenModeIgnore)continue;this.saveKeyToStorage(s)}}}getInitializationValue(e){return this.stateCache.get(e.name)}setInitializationValue(e,t){this.stateCache.set(e.name,t)}
```

```js
setRuntimeValue(e,t){this.stateCache.set(e.name,t);const i=this.getRuntimeValue(Bu.ZEN_MODE_ACTIVE);e.scope===0&&(!i||!e.zenModeIgnore)&&(this.saveKeyToStorage(e),this.updateLegacySettingsFromState(e,t))}
```

So the layout state is not owned by React component props or local state. The service writes and reads it directly.

### 2. Agent layout also has Cursor storage namespaces.

Cursor adds agent/editor layout storage namespaces for layout presets and restore state. The agent namespace records visibility, position, and widths for the same workbench parts.

Evidence:

```js
A0=(n=>(n.SIDEBAR_LOCATION="cursor/agentLayout.sidebarLocation",n.SIDEBAR_LOCATION_AGENT_OVERRIDE="cursor/agentLayout.sidebarLocationAgentOverride",n.SIDEBAR_VISIBLE="cursor/agentLayout.sidebarVisible",n.SIDEBAR_WIDTH="cursor/agentLayout.sidebarWidth",n.PANEL_VISIBLE="cursor/agentLayout.panelVisible",n.PANEL_WIDTH="cursor/agentLayout.panelWidth",n.PANEL_HEIGHT="cursor/agentLayout.panelHeight",n.EDITOR_VISIBLE="cursor/agentLayout.editorVisible",n.EDITOR_WIDTH="cursor/agentLayout.editorWidth",n.AUXILIARYBAR_VISIBLE="cursor/agentLayout.auxiliaryBarVisible",n.AUXILIARYBAR_WIDTH="cursor/agentLayout.auxiliaryBarWidth",n.STATUS_BAR_VISIBLE="cursor/agentLayout.statusBarVisible",n))(A0||{})
```

The developer dump/apply command treats those keys as storage, then compares them with current layout service state.

Evidence:

```js
a.currentLayoutState={sidebarPosition:r.getSideBarPosition()===0?"left":"right",sidebarVisible:r.isVisible("workbench.parts.sidebar"),panelVisible:r.isVisible("workbench.parts.panel"),auxiliaryBarVisible:r.isVisible("workbench.parts.auxiliarybar"),unifiedSidebarVisible:r.isVisible("workbench.parts.unifiedsidebar")}
```

```js
d(A0.SIDEBAR_VISIBLE,1,o.agentLayout?.sidebarVisible),d(A0.SIDEBAR_WIDTH,1,o.agentLayout?.sidebarWidth),d(A0.PANEL_VISIBLE,1,o.agentLayout?.panelVisible),d(A0.PANEL_HEIGHT,1,o.agentLayout?.panelHeight),d(A0.EDITOR_VISIBLE,1,o.agentLayout?.editorVisible),d(A0.EDITOR_WIDTH,1,o.agentLayout?.editorWidth),d(A0.AUXILIARYBAR_VISIBLE,1,o.agentLayout?.auxiliaryBarVisible),d(A0.AUXILIARYBAR_WIDTH,1,o.agentLayout?.auxiliaryBarWidth)
```

That makes `cursor/agentLayout.*` persistent restore and preset state, not the direct owner of live DOM layout.

### 3. Chrome reads layout through the service and grid.

Startup builds the grid descriptor from initialization sizes and runtime visibility. Sidebars and auxiliary bars become grid leaves with size and visible fields.

Evidence:

```js
createGridDescriptor(){const{width:e,height:t}=this._mainContainerDimension,i=this.stateModel.getInitializationValue(Bu.SIDEBAR_SIZE),r=this.stateModel.getInitializationValue(Bu.UNIFIED_SIDEBAR_SIZE),s=this.stateModel.getInitializationValue(Bu.AUXILIARYBAR_SIZE),o=this.stateModel.getInitializationValue(Bu.PANEL_SIZE)
```

```js
B=this.stateModel.getRuntimeValue(Bu.SIDEBAR_HIDDEN),F={type:"leaf",data:{type:"workbench.parts.sidebar"},size:i,visible:!B&&!this.environmentService.isGlass},J=this.storageService.get("workbench.unifiedSidebar.hidden",1)==="true",W=this.isUnifiedMode(),H=this.contextService.getWorkbenchState()===1,V={type:"leaf",data:{type:"workbench.parts.unifiedsidebar"},size:r,visible:(W&&!H?!J:!1)&&!this.environmentService.isGlass}
```

The public `isVisible(...)` API reads service state for most parts and grid visibility for titlebar, banner, and initialized unified sidebar.

Evidence:

```js
isVisible(e,t=ci){if(t!==ci&&e==="workbench.parts.editor")return!0;if(!this.stateModel)return!1;if(this.initialized)switch(e){case"workbench.parts.titlebar":return this.workbenchGrid.isViewVisible(this.titleBarPartView);case"workbench.parts.sidebar":return!this.stateModel.getRuntimeValue(Bu.SIDEBAR_HIDDEN);case"workbench.parts.panel":return!this.stateModel.getRuntimeValue(Bu.PANEL_HIDDEN);case"workbench.parts.auxiliarybar":return!this.stateModel.getRuntimeValue(Bu.AUXILIARYBAR_HIDDEN);case"workbench.parts.unifiedsidebar":try{return this.workbenchGrid.isViewVisible(this.unifiedSidebarPartView)}
```

Root classes are derived from the same reads. CSS consumes those classes as chrome state.

Evidence:

```js
getLayoutClasses(){return Op([this.isVisible("workbench.parts.sidebar")?void 0:"nosidebar",this.isVisible("workbench.parts.sidebar")?"sidebarvisible":void 0,this.isVisible("workbench.parts.editor",ci)?void 0:"nomaineditorarea",this.isVisible("workbench.parts.panel")?void 0:"nopanel",this.isPanelMaximized()?"panelmaximized":void 0,this.isVisible("workbench.parts.auxiliarybar")?void 0:"noauxiliarybar",this.isVisible("workbench.parts.statusbar")?void 0:"nostatusbar",this.state.runtime.mainWindowFullscreen?"fullscreen":void 0,gX(this.configurationService)?"native-titlebar":void 0])}
```

```css
.monaco-workbench.noauxiliarybar .part.auxiliarybar,body.no-titlebar-layout .monaco-workbench .part.auxiliarybar:not(.auxiliary-bar-show-agent-tabs)>.title{display:none!important;visibility:hidden!important}
```

### 4. Sizes come from the grid, and hidden widths are remembered by the grid.

The layout service reads live part sizes through `workbenchGrid.getViewSize(...)`. When a part is hidden, it asks for `getViewCachedVisibleSize(...)` and persists that instead of the current zero or invisible size.

Evidence:

```js
const k=this.workbenchGrid.getViewSize(this.sideBarPartView).width,E=this.workbenchGrid.getViewCachedVisibleSize(this.sideBarPartView),A=this.stateModel.getInitializationValue(Bu.SIDEBAR_SIZE),R=this.stateModel.getRuntimeValue(Bu.SIDEBAR_HIDDEN)?E:k
```

```js
this.stateModel.setInitializationValue(Bu.SIDEBAR_SIZE,W);const z=this.stateModel.getRuntimeValue(Bu.PANEL_HIDDEN)?this.workbenchGrid.getViewCachedVisibleSize(this.panelPartView):iG(this.stateModel.getRuntimeValue(Bu.PANEL_POSITION))?this.workbenchGrid.getViewSize(this.panelPartView).height:this.workbenchGrid.getViewSize(this.panelPartView).width
```

Auxiliary bar follows the same rule, and unified sidebar has a separate storage key because it is not represented by `Bu.UNIFIED_SIDEBAR_HIDDEN`.

Evidence:

```js
const V=this.isUnifiedMode(),j=this.stateModel.getRuntimeValue(Bu.AUXILIARYBAR_HIDDEN)?this.workbenchGrid.getViewCachedVisibleSize(this.auxiliaryBarPartView):this.workbenchGrid.getViewSize(this.auxiliaryBarPartView).width;if(this.stateModel.setInitializationValue(Bu.AUXILIARYBAR_SIZE,j),this.workbenchGrid.isViewVisible(this.unifiedSidebarPartView)&&V){const Q=this.workbenchGrid.getViewSize(this.unifiedSidebarPartView).width;typeof Q=="number"&&Number.isFinite(Q)&&Q>0&&this.storageService.store("workbench.unifiedSidebar.size",String(Q),1,1)}
```

The lower grid implementation confirms `setViewVisible(...)` changes visible state, lays out views, and leaves `cachedVisibleSize` available.

Evidence:

```js
setViewVisible(n,e){if(n<0||n>=this.viewItems.length)throw new Error("Index out of bounds");this.viewItems[n].setVisible(e),this.distributeEmptySpace(n),this.layoutViews(),this.saveProportions()}getViewCachedVisibleSize(n){if(n<0||n>=this.viewItems.length)throw new Error("Index out of bounds");return this.viewItems[n].cachedVisibleSize}
```

This is the width-while-hidden mechanism.

### 5. State changes propagate through service writes, grid operations, events, and context keys.

Primary sidebar hide writes runtime state, saves it, toggles root classes, changes grid visibility, and fires `_onDidChangePartVisibility` if the grid visibility changed.

Evidence:

```js
this.stateModel.setRuntimeValue(Bu.SIDEBAR_HIDDEN,e),this.stateModel.save(!0,!1);const s=this.isUnifiedMode();if(e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible")):(this.mainContainer.classList.remove("nosidebar"),this.mainContainer.classList.add("sidebarvisible"))
```

```js
const c=this.workbenchGrid.isViewVisible(this.sideBarPartView);this.workbenchGrid.setViewVisible(this.sideBarPartView,!e);const d=this.workbenchGrid.isViewVisible(this.sideBarPartView);if(c!==d&&this._onDidChangePartVisibility.fire()
```

Auxiliary bar and editor hidden state follow the same service-owned path.

Evidence:

```js
this.stateModel.setRuntimeValue(Bu.AUXILIARYBAR_HIDDEN,e),this.stateModel.save(!0,!1),e?this.mainContainer.classList.add("noauxiliarybar"):this.mainContainer.classList.remove("noauxiliarybar")
```

```js
setEditorHidden(e,t){this.stateModel.setRuntimeValue(Bu.EDITOR_HIDDEN,e),this.isUnifiedMode()&&(this.agentChatMaximizedContext?.set(e),this.wasMaximized=e,e?this.mainContainer.classList.add("agentmode"):this.mainContainer.classList.remove("agentmode")),e?this.mainContainer.classList.add("nomaineditorarea"):this.mainContainer.classList.remove("nomaineditorarea"),this.workbenchGrid&&this.editorPartView&&this.workbenchGrid.setViewVisible(this.editorPartView,!e)
```

Unified sidebar is different. It stores hidden and size in `workbench.unifiedSidebar.*`, then updates grid visibility and context keys.

Evidence:

```js
setUnifiedSidebarHidden(e,t){if(!this.workbenchGrid)return;if(this.agentLayoutService?.isTogglingUnificationMode()||this.storageService.store("workbench.unifiedSidebar.hidden",e?"true":"false",1,1),e&&this.workbenchGrid.isViewVisible(this.unifiedSidebarPartView)){const s=this.workbenchGrid.getViewSize(this.unifiedSidebarPartView).width;typeof s=="number"&&Number.isFinite(s)&&s>0&&this.storageService.store("workbench.unifiedSidebar.size",String(s),1,1)}
```

```js
this.workbenchGrid.setViewVisible(this.unifiedSidebarPartView,!e),this.updateUnifiedSidebarVisibleContextKey()
```

The layout service exposes part visibility as an event.

Evidence:

```js
this._onDidChangePartVisibility=this._register(new lt),this.onDidChangePartVisibility=this._onDidChangePartVisibility.event
```

Consumers subscribe to layout service events and context changes, then imperatively update DOM positions, editor tabs, and toolbars.

Evidence:

```js
this._register(this.layoutService.onDidChangePartVisibility(()=>{V()})),this._register(this.configurationService.onDidChangeConfiguration(Y=>{Y.affectsConfiguration("workbench.sideBar.location")&&V()})),this.editorGroupsService=this.instantiationService.invokeFunction(Y=>Y.get(hl))
```

```js
this._register(a.onDidChangeContext(Y=>{Y.affectsSome(j)&&V(),Y.affectsSome(new Set([r2i.key]))&&so(this.parent).requestAnimationFrame(()=>{V()})}))
```

The context keys include `sideBarVisible`, `auxiliaryBarVisible`, and `agentChatMaximized`. A context-key updater reads the layout service and mirrors state to context keys and body classes.

Evidence:

```js
K4e=new $n("agentChatMaximized",!1,N(4314,null)),XUn=new $n("editorTabsVisible",!0,N(4315,null)),C8e=new $n("sideBarVisible",!1,N(4316,null))
```

```js
updateSideBarContextKeys(){const n=this.layoutService.isVisible("workbench.parts.sidebar");this.sideBarVisibleContext.set(n);const e=this.layoutService.isVisible("workbench.parts.unifiedsidebar"),t=ci.document.body;t&&(n?(t.classList.add("sidebarvisible"),t.setAttribute("sidebarvisible","true")):(t.classList.remove("sidebarvisible"),t.removeAttribute("sidebarvisible")),e?(t.classList.add("unifiedsidebarvisible"),t.classList.remove("unifiedsidebarhidden"),t.setAttribute("unifiedsidebarvisible","true"),t.removeAttribute("unifiedsidebarhidden")):(t.classList.remove("unifiedsidebarvisible"),t.classList.add("unifiedsidebarhidden"),t.removeAttribute("unifiedsidebarvisible"),t.setAttribute("unifiedsidebarhidden","true")))}
```

### 6. I did not find a React subscription owning chrome layout.

React is bundled. `useSyncExternalStore` and `useLayoutEffect` exist, but proximity searches did not find them near `layoutService`, `onDidChangePartVisibility`, or chrome layout subscriptions.

Counts:

- `useSyncExternalStore`: 10.
- `useLayoutEffect`: 11.
- `layoutService.onDidChangePartVisibility`: 12.
- `layoutService.onDidLayout`: 9.
- `useSyncExternalStore.{0,1200}layoutService`: 0.
- `layoutService.{0,1200}useSyncExternalStore`: 0.
- `useLayoutEffect.{0,1200}layoutService`: 0.
- `layoutService.{0,1200}useLayoutEffect`: 0.
- `onDidChangePartVisibility.{0,1200}useSyncExternalStore`: 0.

The `useSyncExternalStore` windows I checked were React export plumbing and a portal helper, not workbench chrome layout.

Evidence:

```js
n.useSyncExternalStore=function(ue,oe,he){return W.H.useSyncExternalStore(ue,oe,he)}
```

```js
J1y=w(({contentComponent:n})=>{const e=cc(n.subscribe,n.getSnapshot,n.getServerSnapshot);return $(Es,{children:Object.values(e)})},"Portals")
```

That does not prove no React code ever reads a layout value. It does prove the observed chrome layout paths are service events, context keys, grid operations, class toggles, and imperative DOM movement, not a React owner re-rendering the workbench chrome.

## Verdict

The agent-window panel layout state lives in the workbench layout service and its state model, with persistent backing in `workbench.*`, `workbench.unifiedSidebar.*`, and Cursor's `cursor/agentLayout.*` storage namespaces.

The chrome reads that state through `layoutService.isVisible(...)`, `getLayoutClasses()`, context keys, the grid descriptor, and `workbenchGrid.getViewSize(...)`. It learns size from the grid. It remembers hidden widths through `workbenchGrid.getViewCachedVisibleSize(...)` during state save.

State changes propagate as imperative service transitions. A hide or maximize path writes `stateModel`, saves where needed, toggles root/body classes, calls `workbenchGrid.setViewVisible(...)` or `resizeView(...)`, fires `onDidChangePartVisibility`, and updates context keys. Toolbars and editor chrome listen to those events and move or refresh existing DOM. I found no evidence that React component state or props own this chrome layout.
