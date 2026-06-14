# Scope

This slice answers one identity question: whether Cursor's agent window, Glass shell, and `agentmode` workbench chrome are the same thing, and whether their chrome is React or VS Code's imperative workbench parts.

Evidence comes from bounded probes of:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

Context discipline:

- Counts came first with `rg --count-matches -F`.
- Bundle snippets came from `rg -oN -P '.{0,300}ANCHOR.{0,1800}' "$BIN" | head -c 6000`.
- The minified JS bundle was not opened in an editor, read with `ReadFile`, or dumped wholesale.

Useful counts:

```text
isGlass js=492; environmentService.isGlass js=132; agentmode js=4; agent-mode js=18; unifiedMode js=254
```

```text
data-component="root" js=9; data-fullscreen js=3; createRoot js=20; .createRoot( js=7; react-dom js=9; ReactDOM js=0
```

# Findings w/ evidence

## 1. Regular workbench chrome is still imperative VS Code workbench parts.

The normal workbench startup calls `renderWorkbench`, then creates the grid layout, then lays it out and restores it.

```text
this.renderWorkbench(n,c,i,r),this.createWorkbenchLayout(),this.layout(),this.restore(t)
```

`renderWorkbench` builds the `.monaco-workbench` root, applies layout classes, and then creates part DOM with a literal part list.

```text
renderWorkbench(n,e,t,i){Xeb(this.mainContainer),...const s=Op(["monaco-workbench",...,...this.getLayoutClasses(),...]);this.mainContainer.classList.add(...s)
```

```text
for(const{id:D,role:M,classes:B,options:F}of[...]){const J=this.createPart(D,M,B);...this.getPart(D).create(J,F)
```

The part factory is direct DOM allocation, not a React root.

```text
createPart(n,e,t){const i=document.createElement(e==="status"?"footer":"div");return i.classList.add("part",...t),i.id=n,i.setAttribute("role",e)
```

Verdict for regular workbench `agentmode`: titlebar, sidebar frame, auxiliarybar frame, panel frame, statusbar, and grid layout are imperative VS Code workbench parts.

## 2. GlassWorkbench is a different shell path.

The Glass workbench startup still calls `renderWorkbench`, but it does not call `createWorkbenchLayout()` in this window. Its override only creates and appends a `.monaco-workbench` root.

```text
throw this._logService.error("GlassWorkbench startup failed",n),Ra(n),n}}_createInstantiationService(n){return new _Hg(n,!0,void 0,void 0,!0)}
```

```text
renderWorkbench(n,e,t,i){Xeb(this.mainContainer);const s=Op(["monaco-workbench",...,...this.getLayoutClasses(),...]);this.mainContainer.classList.add(...s),this.parent.appendChild(this.mainContainer)
```

The startup call sequence goes straight from `renderWorkbench` to `restore`.

```text
this.renderWorkbench(n,c,i,r),this.restore(t);try{const d=n.createInstance(K5h);d.useSimpleTrustAction=!0}
```

That means Glass is not the same chrome stack as the regular workbench grid. It keeps the `.monaco-workbench` identity/class vocabulary, but skips the part creation and grid-deserialize path in this startup branch.

## 3. `agentmode` is a regular workbench layout class, not the Glass shell.

Inside the regular workbench, `agentmode` is set when the editor part is hidden while unified mode is active.

```text
setEditorHidden(e,t){this.stateModel.setRuntimeValue(Bu.EDITOR_HIDDEN,e),this.isUnifiedMode()&&(this.agentChatMaximizedContext?.set(e),this.wasMaximized=e,e?this.mainContainer.classList.add("agentmode"):this.mainContainer.classList.remove("agentmode"))
```

The same method hides the editor by grid visibility and resizes the auxiliary bar around the visible sidebars.

```text
e?this.mainContainer.classList.add("nomaineditorarea"):this.mainContainer.classList.remove("nomaineditorarea"),this.workbenchGrid&&this.editorPartView&&this.workbenchGrid.setViewVisible(this.editorPartView,!e)
```

```text
const o=this.isVisible("workbench.parts.sidebar")?this.getSize("workbench.parts.sidebar").width:0,a=this.isVisible("workbench.parts.unifiedsidebar")?this.getSize("workbench.parts.unifiedsidebar").width:0,...;this.setSize("workbench.parts.auxiliarybar",{width:d,...})
```

CSS also treats `.monaco-workbench.agentmode` as an auxiliarybar title/chrome state.

```text
body .monaco-workbench.agentmode .part.auxiliarybar .composite.title.auxiliary-bar-title--agent-mode{max-width:none}
```

So `agentmode` is not a React shell name. It is a class on the regular workbench root that changes VS Code part layout and auxiliarybar chrome.

## 4. The Glass agent window root is React-rendered chrome.

The Glass agent window has a React-compiled root element with `data-component="root"`, `data-fullscreen`, and `data-system`.

```text
f=$("div",{className:"absolute inset-0 flex size-full flex-col outline-none","data-color-bucket":s,"data-component":"root","data-fullscreen":d,"data-system":k8n,ref:o,style:c,children:h})
```

Another Glass root variant marks presentation with a `glass/didPresentShell` performance mark.

```text
f=$("div",{className:"flex flex-col size-full absolute inset-0 outline-none","data-color-bucket":s,"data-component":"root","data-fullscreen":h,"data-system":k8n,ref:m,style:o,children:r})
```

```text
function yDI(){performance.mark("glass/didPresentShell")}
```

Glass CSS is scoped to `[data-component=root]`, including root typography, focus rings, surfaces, fullscreen border behavior, and in-app menubar chrome.

```text
[data-component=root],[data-component=root] button,[data-component=root] input,[data-component=root] select,[data-component=root] textarea,body[data-cursor-glass-mode=true]{font-family:var(--cursor-font-family-sans,sans-serif)
```

```text
[data-component=root][data-system=linux]:not([data-fullscreen=true]):after,[data-component=root][data-system=windows]:not([data-fullscreen=true]):after{box-shadow:inset 0 0 0 1px var(--glass-window-border-color)}
```

```text
.glass-in-app-menubar{align-items:stretch;background:var(--vscode-sideBar-background,var(--vscode-editor-background));border-bottom:1px solid var(--cursor-stroke-tertiary,var(--vscode-widget-border));display:flex;flex-shrink:0;height:32px}
```

That is real Glass chrome. It is not `workbench.parts.titlebar` or `workbench.parts.sidebar`.

## 5. React is present, but the mount sites point to content and Glass shells.

The bundle includes React DOM and React 19.2.0.

```text
BKt={bundleType:0,version:"19.2.0",rendererPackageName:"react-dom",currentDispatcherRef:ie,reconcilerVersion:"19.2.0"}
```

One generic mount path creates React roots for explicit `reactComponent` payloads.

```text
e=V2i.createRoot(m),pa(()=>{c(),r=n.reactProps,s=n.reactComponent,o=n.portalRoot})
```

```text
Tn(Dg(()=>[n.reactComponent,n.reactProps,n.portalRoot],()=>{const m=n.reactComponent!==s,h=!YsT(n.reactProps,r),f=n.portalRoot!==o;(m||h||f)&&(...:c())}
```

Another content mount renders a React editor into a created div.

```text
const r=V2i.createRoot(i),s=t.ownerDocument.defaultView&&ule.get(t.ownerDocument.defaultView)?ule.get(t.ownerDocument.defaultView):null,o=Lc.createElement(n,e);return r.render($(zEe,{root:s,children:o}))
```

The React export table includes many agent and composer surfaces.

```text
AgentConversationProvider:()=>X5r,AgentEnvironmentIcon:()=>bUt,AgentStatusIcon:()=>$jb,AgentTranscriptActivityGroup:()=>orf
```

But the regular workbench chrome evidence above never crosses through `createRoot`. It uses `document.createElement`, part instances, workbench grid visibility, and class toggles.

## 6. Glass fullscreen and panel controls call a service, not the workbench part toggle path.

Glass agent panel header handlers call `setEditorPanelFullscreen(...)` on a layout service.

```text
Dxe=tt(()=>{Rne(),M.setEditorPanelFullscreen(!0,{entrypoint:"agent_panel_header"})},[Rne,M])
```

Overlay close/select handlers reverse it through the same service.

```text
d.setEditorPanelFullscreen(!1,{entrypoint:"agent_conversation_overlay"})
```

Opening routes can also enter editor-panel fullscreen through the service.

```text
t.openEditorPanelFullscreen===!0&&r.kind==="file"&&!n.layoutService.getSnapshot().editorPanelDisallowed&&n.layoutService.setEditorPanelFullscreen(!0,{entrypoint:"service"})
```

`glass.enterEditorPanelFullscreen` as an exact command id was not found in this build.

```text
glass.enterEditorPanelFullscreen js=0
```

# Verdict

There are two shells, and mixing them produces the wrong conclusion.

Regular Cursor workbench `agentmode` is imperative VS Code chrome. It is `renderWorkbench` plus `createPart` plus workbench grid views. React is confined to content mounted inside parts, such as composer/chat/editor React payloads, and to generic React bridge mount sites.

The separate Glass agent window is React-rendered chrome. Its `GlassWorkbench` path only appends a `.monaco-workbench` root. The visible Glass window root is `[data-component="root"]` with `data-fullscreen` and `data-system`, and CSS under that root owns Glass surfaces, window border, and in-app menubar chrome.

So the crisp answer is:

- `agentmode` in the normal workbench: imperative VS Code parts.
- Glass agent window: React shell chrome.
- React is confined to Glass shell roots and agent/composer content in the normal workbench. It does not own the classic VS Code titlebar/sidebar/panel chrome there.
