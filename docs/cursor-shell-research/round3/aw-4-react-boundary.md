# Round 3 AW-4: React boundary and layout decoupling

## Scope

This report answers where React appears in Cursor's bundled workbench, whether the agent/composer area is mounted inside a VS Code part, and whether shell layout changes call back into React.

Target files:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

throughput checkpoint: n/a, read-only investigation.

Source discipline:

- The JavaScript bundle was not opened, read wholesale, or dumped.
- Every anchor was counted first with `rg --count-matches -F`.
- Evidence came from small `rg -oN -P` windows or prior bounded notes in `docs/cursor-shell-research`.

## Findings

### 1. React is bundled, but it is not the workbench layout owner

React DOM is present. The useful counts were:

| Anchor                 | JS count |
| ---------------------- | -------: |
| `createRoot`           |       20 |
| `.createRoot(`         |        7 |
| `react-dom`            |        9 |
| `react-dom/client`     |        1 |
| `ReactDOM`             |        0 |
| `jsx-runtime`          |       17 |
| `useState`             |       69 |
| `useReducer`           |       11 |
| `useSyncExternalStore` |       10 |
| `react-bridge.js`      |        1 |
| `solid-js`             |        5 |
| `renderComposerPane`   |        1 |

The bundle includes React DOM internals:

```js
BKt = {
  bundleType: 0,
  version: "19.2.0",
  rendererPackageName: "react-dom",
  currentDispatcherRef: ie,
  reconcilerVersion: "19.2.0",
};
```

It also includes Solid's runtime:

```js
pi=Ie({"node_modules/solid-js/dist/solid.js"(){...}})
Be=Ie({"node_modules/solid-js/web/dist/web.js"(){...}})
```

That matters because the agent/composer code is not simply "the whole workbench is React." Cursor bundles a fine-grained UI runtime and a separate React bridge. React exists, but the workbench shell and grid are still the VS Code imperative workbench.

### 2. React mounts through a leaf bridge

The preserved source name `react-bridge.js` exposes the boundary clearly. It takes a component and props, creates a React element, and mounts it into a DOM node with `createRoot`.

```js
Xb=Ie({"out-build/vs/workbench/contrib/controlCommon/browser/react-bridge.js"(){...const a=()=>{const m=Lc.createElement(n.reactComponent,n.reactProps);return n.portalRoot!==void 0?Lc.createElement(zEe,{root:n.portalRoot,children:m}):m}
```

```js
f?(i=f,...t=f.register(n.reactComponent,n.reactProps,m,n.portalRoot)):(e=V2i.createRoot(m),...c())
```

The bridge only schedules a render when its own inputs change:

```js
Tn(Dg(()=>[n.reactComponent,n.reactProps,n.portalRoot],()=>{const m=n.reactComponent!==s,h=!YsT(n.reactProps,r),f=n.portalRoot!==o;(m||h||f)&&(...t.update(n.reactComponent,n.reactProps,n.portalRoot):c())},{defer:!0}))
```

Unmount is also local to the bridge:

```js
di(()=>{if(t)t.dispose(),t=void 0,i=void 0;else if(e){const m=e;e=void 0,queueMicrotask(()=>{m.unmount()})}...})
```

This is the React boundary. React gets a host element and a prop bag. It does not own the workbench grid, part registry, titlebar, activity bar, side bar, or auxiliary bar.

### 3. Composer lives in workbench parts, not above them

Prior rounds established the composer/chat pane in the auxiliary bar:

- `workbench.parts.auxiliarybar` is the right-side part.
- AI view ids use `workbench.panel.aichat*`.
- Composer URI/input ids include `cursor.composer`, `cursor.aichat`, and `workbench.editor.composer.input`.

The same bundle constants show the AI view container and storage keys:

```js
uXv="aichat-container",...rUp="workbench.panel.aichat.view",W9C=rUp+".aichat.chatdata",e3r="composer.composerData"
```

The composer pane render path is a leaf UI renderer, not the shell layout service:

```js
var NqS=(n,e,t,i)=>Tw(()=>{try{...const s=r.u(Sse("renderComposerPane")),o=Fr(),[a,c]=dt(!1);Hc(()=>{...
```

It writes composer-specific DOM attributes on the composer element:

```js
(Ar(bs, "data-composer-id", (qr.t = Pm)),
  Ou !== qr.a && Ar(bs, "data-composer-location", (qr.a = Ou)),
  bp !== qr.o && Ar(bs, "data-composer-status", (qr.o = bp)));
```

CSS then styles that leaf:

```css
.composer-bar[data-composer-location="bar"] {
  margin: 0 auto;
  max-width: var(--composer-max-width, 840px);
}
```

```css
.composer-bar.editor,
.composer-bar.editor .composer-human-message-container,
... {
  background: var(--composer-pane-background) !important;
}
```

Verdict for the content area: the composer/chat UI is mounted inside a VS Code part or editor surface. It may use Solid and React bridge leaves. It is not the thing laying out the workbench chrome.

### 4. Workbench layout is imperative DOM plus grid

The workbench layout creates stable part views and deserializes them into the grid:

```js
createWorkbenchLayout(){const e=this.getPart("workbench.parts.titlebar"),...o=this.getPart("workbench.parts.auxiliarybar"),a=this.getPart("workbench.parts.unifiedsidebar"),c=this.getPart("workbench.parts.sidebar")
```

```js
const m={"workbench.parts.activitybar":this.activityBarPartView,...,"workbench.parts.auxiliarybar":this.auxiliaryBarPartView,"workbench.parts.unifiedsidebar":this.unifiedSidebarPartView},...this.mainContainer.prepend(f.element),this.mainContainer.setAttribute("role","application"),this.workbenchGrid=f
```

Generic layout is a grid operation followed by layout events:

```js
(this.workbenchGrid.layout(c, d),
  (this.initialized = !0),
  this.handleContainerDidLayout(this.mainContainer, this._mainContainerDimension));
```

```js
handleContainerDidLayout(e,t){e===this.mainContainer&&this._onDidLayoutMainContainer.fire(t),deb(e)&&this._onDidLayoutActiveContainer.fire(t),this._onDidLayoutContainer.fire({container:e,dimension:t})}
```

Sizing is also direct grid mutation:

```js
setSize(e,t){this.workbenchGrid.resizeView(this.getPart(e),t)}
```

These snippets have no React root, no `reactComponent`, no `reactProps`, and no call into the React bridge.

### 5. Part visibility changes do not render React

Auxiliary bar hide writes state, toggles a root class, hides or restores pane composites, then calls the grid:

```js
setAuxiliaryBarHidden(e,t,i){...this.stateModel.setRuntimeValue(Bu.AUXILIARYBAR_HIDDEN,e),this.stateModel.save(!0,!1),e?this.mainContainer.classList.add("noauxiliarybar"):this.mainContainer.classList.remove("noauxiliarybar")
```

```js
if(this.workbenchGrid.setViewVisible(this.auxiliaryBarPartView,!e),o!==void 0&&this.workbenchGrid.isViewVisible(this.unifiedSidebarPartView)){...this.workbenchGrid.resizeView(this.unifiedSidebarPartView,...)}
```

Editor hide does the same shape and resizes the auxiliary bar when unified mode is active:

```js
setEditorHidden(e,t){this.stateModel.setRuntimeValue(Bu.EDITOR_HIDDEN,e),this.isUnifiedMode()&&(this.agentChatMaximizedContext?.set(e),...e?this.mainContainer.classList.add("agentmode"):this.mainContainer.classList.remove("agentmode"))
```

```js
(e
  ? this.mainContainer.classList.add("nomaineditorarea")
  : this.mainContainer.classList.remove("nomaineditorarea"),
  this.workbenchGrid &&
    this.editorPartView &&
    this.workbenchGrid.setViewVisible(this.editorPartView, !e));
```

Sidebar and panel follow the same imperative pattern:

```js
setSideBarHidden(e,t){...this.stateModel.setRuntimeValue(Bu.SIDEBAR_HIDDEN,e),this.stateModel.save(!0,!1);...this.mainContainer.classList.add("nosidebar")
```

```js
setPanelHidden(e,t){...this.stateModel.setRuntimeValue(Bu.PANEL_HIDDEN,e),this.stateModel.save(!0,!1),e?this.mainContainer.classList.add("nopanel"):this.mainContainer.classList.remove("nopanel")
```

The CSS backstop is plain display/visibility hiding:

```css
.monaco-workbench.noauxiliarybar .part.auxiliarybar,
... {
  display: none !important;
  visibility: hidden !important;
}
```

```css
.monaco-workbench.nosidebar > .part.sidebar {
  display: none !important;
  visibility: hidden !important;
}
```

The exact hide-method windows contain state writes, class changes, pane-composite calls, `setViewVisible`, `resizeView`, context-key writes, and layout events. They do not contain a React render call.

### 6. The only coupling is through environment, not ownership

Layout changes can still be observed by leaf content in normal web ways:

- CSS selectors change because root classes change.
- The browser reflows the DOM because grid sizes change.
- Leaf content can subscribe to its own stores, context keys, layout events, or `ResizeObserver`.

That is not the same as the layout service setting React state. The layout service does not pass a new width prop into the composer React tree. It changes the container and the grid. If composer UI reacts, it reacts as content inside a resized container.

## Verdict

Cursor's shell layout is outside React. The workbench root, titlebar, activity bar, sidebar, editor, panel, auxiliary bar, and unified sidebar are VS Code part views registered in an imperative grid. Visibility and maximize transitions write layout state, flip classes on `.monaco-workbench`, call `workbenchGrid.setViewVisible(...)`, call `resizeView(...)`, and emit layout events.

React is present as a leaf runtime. The explicit `react-bridge.js` creates and updates React roots from `reactComponent`, `reactProps`, and `portalRoot`. Composer/chat content sits inside the auxiliary bar or editor as leaf UI. It may include Solid-rendered surfaces and React bridge islands, but it does not own the chrome.

Therefore a shell resize, hide, or maximize does not re-render React chrome. There is no React chrome tree to re-render. The workbench mutates DOM/grid state, and content leaves see a changed container. React only renders when its own bridge props, stores, or internal subscriptions change.
