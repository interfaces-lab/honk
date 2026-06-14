# 1 Scope

This slice covers Cursor's right-side secondary side bar, the editor-area expansion when that side bar disappears, and the Cursor composer or agent pane that usually occupies it.

throughput checkpoint: n/a, read-only investigation.

Source discipline:

- Binary probes used count checks first, then bounded byte windows around exact string literals in `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`.
- CSS probes mined `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`.
- I did not open the bundle in an editor and did not read the whole bundle into context.

# 2 Mechanism

The auxiliary bar is VS Code's secondary side bar location. Cursor keeps the upstream "auxiliarybar" part, then layers its agent/composer UI into that part.

Evidence.

```js
function JJt(n){switch(n){case 0:return"sidebar";case 1:return"panel";case 2:return"auxiliarybar"}}
```

The part identity is `workbench.parts.auxiliarybar`. Hiding it sets a runtime state bit, adds a `noauxiliarybar` class to the workbench root, and then removes the part from the grid. The grid visibility change is the space-reclaiming operation. The CSS class hides the DOM, but `workbenchGrid.setViewVisible(...)` is the editor reflow.

Evidence.

```js
setAuxiliaryBarHidden(e,t,i){...this.stateModel.setRuntimeValue(Bu.AUXILIARYBAR_HIDDEN,e)...e?this.mainContainer.classList.add("noauxiliarybar"):this.mainContainer.classList.remove("noauxiliarybar")...
if(this.workbenchGrid.setViewVisible(this.auxiliaryBarPartView,!e),o!==void 0&&this.workbenchGrid.isViewVisible(this.unifiedSidebarPartView)){...this.workbenchGrid.resizeView(...)}
```

The layout class builder mirrors the same state. That means consumers can observe both `auxiliaryBarVisible` context and the root class.

Evidence.

```js
getLayoutClasses(){return Op([...this.isVisible("workbench.parts.auxiliarybar")?void 0:"noauxiliarybar",...])}
```

The toggle command is overridden in Cursor's AI path. When closed, it tracks `ai_pane.closed`. When opened, it either ensures an existing chat is visible or reveals `workbench.parts.auxiliarybar` and creates a composer with `view:"pane"`.

Evidence.

```js
xUg.ID="workbench.action.toggleAuxiliaryBar",xUg.LABEL=At(3267,"Toggle Secondary Side Bar Visibility")
...i.setPartHidden(!1,"workbench.parts.auxiliarybar"),r.getActivePaneComposite(2)||await o.createComposer({view:"pane",unifiedMode:"agent",openInNewTab:!0})
```

The view-title menu labels this command as the chat-pane toggle when the active view is the AI chat view.

Evidence.

```js
br.appendMenuItem(Ct.ViewTitle,{command:{id:"workbench.action.toggleAuxiliaryBar",title:"Toggle Chat Pane"},group:"0_a_visibility",when:ze.and(ze.regex("view",new RegExp(`^${LB}`))),order:1})
```

`auxiliaryBar.location` was not found. I also did not find `workbench.auxiliaryBar.location` or `secondarySideBar.location`. The only related user setting found in this slice was label visibility.

Evidence.

```js
"workbench.secondarySideBar.showLabels":{type:"boolean",default:!0,markdownDescription:N(4163,null,"`#workbench.activityBar.location#`","`top`")}
```

# 3 Exact identifiers

| Identifier | Kind | Evidence | Notes |
| --- | --- | --- | --- |
| `workbench.parts.auxiliarybar` | part id | `setPartHidden(!1,"workbench.parts.auxiliarybar")` | Grid part toggled for the right side. |
| `auxiliarybar` | part class/location token | `case 2:return"auxiliarybar"` | Location 2 in view container location mapping. |
| `.part.auxiliarybar` | DOM class | `.monaco-workbench .part.auxiliarybar` | Root part selector in CSS. |
| `.noauxiliarybar` | workbench state class | `.monaco-workbench.noauxiliarybar .part.auxiliarybar` | Added when hidden. |
| `workbench.action.toggleAuxiliaryBar` | command | `title:"Toggle Chat Pane"` | Cursor keeps the upstream command id and relabels it in chat title menus. |
| `workbench.action.focusAuxiliaryBar` | command | `i4i.ID="workbench.action.focusAuxiliaryBar"` | Focus command still targets the secondary side bar. |
| `workbench.secondarySideBar.showLabels` | setting | `"workbench.secondarySideBar.showLabels":{type:"boolean"...}` | Found. |
| `auxiliaryBar.location` | setting | not found | No exact string hit. |
| `workbench.auxiliaryBar.location` | setting | not found | No exact string hit. |
| `noauxiliarybar` | class | `this.mainContainer.classList.add("noauxiliarybar")` | Primary hidden marker. |
| `AuxiliaryBarTitle` | menu id | `_s.AuxiliaryBarTitle=new _s("AuxiliaryBarTitle")` | Menu surface preserved from workbench. |
| `AuxiliaryBarHeader` | menu id | `_s.AuxiliaryBarHeader=new _s("AuxiliaryBarHeader")` | Header menu surface preserved. |
| `auxiliaryBarVisible` | context key | `JMt=new $n("auxiliaryBarVisible",!1` | Visibility context. |
| `auxiliaryBarFocus` | context key | `dNo=new $n("auxiliaryBarFocus",!1` | Focus context. |
| `activeAuxiliary` | context key | `KKw=new $n("activeAuxiliary",""` | Active auxiliary view id. |
| `workbench.panel.aichat` | AI view container prefix | `MFe="workbench.panel.aichat"` | Chat/composer view container prefix. |
| `workbench.panel.aichat.view` | AI view id | `rUp="workbench.panel.aichat.view"` | Main AI chat view id. |
| `aichat-container` | class/string constant | `uXv="aichat-container"` | Found in JS constants, not CSS rules. |
| `cursor.aichat` | URI scheme | `n.aiChat="cursor.aichat"` | Cursor URI scheme. |
| `cursor.composer` | URI scheme | `n.composer="cursor.composer"` | Composer URI scheme. |
| `cursor.backgroundcomposer` | URI scheme | `n.backgroundComposer="cursor.backgroundcomposer"` | Background composer URI scheme. |
| `workbench.editor.composer.input` | editor input type | `jj="workbench.editor.composer.input"` | Composer can live as an editor. |
| `workbench.editors.backgroundComposerPeekEditorInput` | editor input type | `vUp="workbench.editors.backgroundComposerPeekEditorInput"` | Background composer peek editor. |
| `.composer-bar.editor` | editor composer class | `.composer-bar.editor...background:var(--composer-pane-background)!important` | Composer in editor mode. |
| `.composer-bar` | composer class | `.composer-bar[data-composer-location=bar]` | Centered composer bar. |
| `.composer-view-pane` | JS selector | `querySelectorAll(".composer-bar, .composer-view-pane")` | Found in JS, not CSS rules. |
| `.background-composer-tab` | aux tab class | `.auxiliarybar .composite-bar-action-tab.background-composer-tab` | Background agent tab class. |
| `.inline-agent-tabs` | agent tab host | `class="inline-agent-tabs inline-agent-tabs--header-host part auxiliarybar auxiliary-bar-show-agent-tabs"` | Cursor detaches aux tabs into agent headers. |

# 4 DOM/component hierarchy

Observed and inferred hierarchy from preserved templates and selectors:

```text
.monaco-workbench[.noauxiliarybar]
  .part.auxiliarybar.pane-composite-part
    .title.composite[.has-composite-bar][.auxiliary-bar-title--agent-mode]
      .title-label
      .composite-bar-container
        .composite-bar
          .monaco-action-bar
            .actions-container
              .action-item.composite-bar-action-tab[.background-composer-tab]
                .action-label
                .remove-button
                .status-indicator
      .title-actions
    .header-or-footer
      .auxiliary-bar-maximize-button-container
    .content
      .pane
        .pane-header
        .pane-body
          .composer-bar[data-composer-location=bar]
          .composer-bar.editor
          .bc-instance-header
          .background-composer-instance-header-root
```

Cursor also creates a detached inline tab host for agent mode:

```text
.inline-agent-tabs.inline-agent-tabs--header-host.part.auxiliarybar.auxiliary-bar-show-agent-tabs
  .title.inline-agent-tabs__title.auxiliary-bar-title--agent-mode
    .inline-agent-tabs__slot
      .composite-bar-container
```

Evidence.

```js
Rxx=et('<div class="inline-agent-tabs inline-agent-tabs--header-host part auxiliarybar auxiliary-bar-show-agent-tabs"><div class="title inline-agent-tabs__title auxiliary-bar-title--agent-mode"><div class=inline-agent-tabs__slot>')
Pxx=".monaco-workbench .part.auxiliarybar > .title .composite-bar-container"
```

The detach logic physically moves the `.composite-bar-container` into another host, tracks a placeholder, and restores it when needed.

Evidence.

```js
n.appendChild(e),yJ={host:n,placeholder:i,parent:t,composite:e}
...m?d?m.replaceChild(r,t):(m.appendChild(r),t.remove()):(i.appendChild(r),t.remove())
```

# 5 Geometry & tokens

The auxiliary bar has a fixed minimum width of 300 px, no finite maximum, a preferred height of 40 percent of the main container, and a preferred width based on active pane optimal width with a 540 px floor.

Evidence.

```js
get minimumWidth(){return 300}get maximumWidth(){return Number.POSITIVE_INFINITY}get preferredHeight(){return this.layoutService.mainContainerDimension.height*.4}
get preferredWidth(){const n=this.getActivePaneComposite();if(!n)return;const e=n.getOptimalWidth();if(typeof e=="number")return Math.max(e,540)}
```

The auxiliary title area hides the stock label in agent mode and makes the composite tab strip fill the title width. Cursor uses an 8 px title edge inset.

Evidence.

```css
body .monaco-workbench .part.auxiliarybar .auxiliary-bar-title--agent-mode .title-label{display:none}
body .monaco-workbench .part.auxiliarybar .composite.title.auxiliary-bar-title--agent-mode{--agent-title-edge-inset:8px;align-items:center;display:flex;margin:0 auto;max-width:none;padding-inline:var(--agent-title-edge-inset);width:100%}
```

Agent/composer content is centered to `--composer-max-width`, with 840 px as the fallback. This shows up in the bar, instance header, model tabs, and inline tabs.

Evidence.

```css
.composer-bar[data-composer-location=bar]{margin:0 auto;max-width:var(--composer-max-width,840px)}
.agent-layout .inline-agent-tabs__slot>.composite-bar-container,body .inline-agent-tabs__slot>.composite-bar-container{margin:0 auto;max-width:var(--composer-max-width,840px)}
```

The composer pane background token is `--composer-pane-background`, usually mapped to the editor background for agent layout.

Evidence.

```css
.agent-layout{--composer-pane-background:var(--vscode-editor-background)}
.composer-bar.editor,.composer-bar.editor .composer-human-message-container,...{background:var(--composer-pane-background)!important}
```

Composite tabs in the auxiliary bar have a compact range, with 60 px minimum and 120 px maximum by default. Background composer tabs get a 160 px minimum.

Evidence.

```css
.auxiliarybar .composite-bar-action-tab{box-sizing:border-box;max-width:120px;min-width:60px;overflow:hidden;padding:0 6px;text-overflow:ellipsis;white-space:nowrap}
.auxiliarybar .composite-bar-action-tab.background-composer-tab{min-width:160px}
```

Composer conversation surfaces use radius tokens, not hardcoded card radii in this slice.

Evidence.

```css
.composer-bar,.composer-messages-container{...--conversation-surface-border-radius:var(--cursor-radius-xl);--card-border-radius:var(--conversation-surface-border-radius)}
```

The hidden aux bar CSS is direct display hiding.

Evidence.

```css
.monaco-workbench.noauxiliarybar .part.auxiliarybar,body.no-titlebar-layout .monaco-workbench .part.auxiliarybar:not(.auxiliary-bar-show-agent-tabs)>.title{display:none!important;visibility:hidden!important}
```

# 6 State & connectivity

Visibility is stateful, not a local component toggle. The layout service writes `AUXILIARYBAR_HIDDEN`, toggles `.noauxiliarybar`, closes or restores pane composites, and updates the grid part visibility.

Evidence.

```js
e&&!i&&this.paneCompositeService.getActivePaneComposite(2)?this.paneCompositeService.hideActivePaneComposite(2)...
this.workbenchGrid.setViewVisible(this.auxiliaryBarPartView,!e)
```

The active agent surface context treats either the unified side bar or the auxiliary bar as agent-visible.

Evidence.

```js
const t=e||this.isVisible("workbench.parts.auxiliarybar");this.agentSurfaceVisibleContextKey.set(t)
```

Width and visibility persist in two storage namespaces. Editor layout uses `cursor/editorLayout.*`; agent layout uses `cursor/agentLayout.*`. There is also a shared JSON blob for cross-window or shared agent layout state.

Evidence.

```js
n.AUXILIARYBAR_VISIBLE="cursor/editorLayout.auxiliaryBarVisible",n.AUXILIARYBAR_WIDTH="cursor/editorLayout.auxiliaryBarWidth"
n.AUXILIARYBAR_VISIBLE="cursor/agentLayout.auxiliaryBarVisible",n.AUXILIARYBAR_WIDTH="cursor/agentLayout.auxiliaryBarWidth"
```

The store path records current size when visible. The restore path reads the saved width and calls `setSize("workbench.parts.auxiliarybar", ...)`.

Evidence.

```js
(m||n==="agent")&&(h=this.layoutService.getSize("workbench.parts.auxiliarybar").width,h&&this.storageService.store(t.AUXILIARYBAR_WIDTH,h,1,0))
D&&this.layoutService.setSize("workbench.parts.auxiliarybar",{width:D,height:this.layoutService.getSize("workbench.parts.auxiliarybar").height})
```

The inline agent tabs are connected by DOM movement and a `ResizeObserver`, not by purely declarative CSS. Cursor dispatches an `inlineAgentTabsHostChanged` event after width changes.

Evidence.

```js
e.style.width=`${t}px`,e.style.maxWidth="100%",e.style.minWidth="0px",CqS()
Z3i=new ResizeObserver(()=>{if(!dHt(n)){YFh(n);return}cUg(n)})
```

Composer panes can be represented as pane views, editor inputs, and background composer URI schemes. The context menu exposes both "Open as Editor" and "Open as Pane".

Evidence.

```js
{id:t8m,label:"Open as Editor",...run:()=>{e.commandService.executeCommand(t8m,n.composerId)}},{id:e8m,label:"Open as Pane",...run:()=>{e.commandService.executeCommand(e8m,n.composerId)}}
```

Opening as pane routes through `handleOpenComposerPane`.

Evidence.

```js
s.trackEvent("composer.open_chat_sidebar",{with_code_context:!1})...t.handleOpenComposerPane(o)
```

# 7 Honk mapping

Honk's `RightAside` should follow the grid part behavior, not the CSS-only behavior. Collapsing the right workbench should remove the right track from layout so the center screen expands into that space. In Cursor terms, this is `workbenchGrid.setViewVisible(auxiliaryBarPartView, false)`, not just `.noauxiliarybar { display:none }`.

Recommended mapping:

| Cursor | Honk |
| --- | --- |
| `workbench.parts.auxiliarybar` | `RightAside` workbench region |
| `.noauxiliarybar` | root or shell class like `right-aside-collapsed` |
| `setAuxiliaryBarHidden(true)` | state transition that removes the right grid column |
| `setAuxiliaryBarHidden(false)` | restore the right grid column at persisted width |
| `AUXILIARYBAR_WIDTH` | persisted `RightAside` width |
| `AUXILIARYBAR_VISIBLE` | persisted `RightAside` visible state |
| `workbench.action.toggleAuxiliaryBar` | configurable keybinding for `RightAside` toggle |
| `agentSurfaceVisibleContextKey` | derived "right surface visible" state for nav and focus |

Implementation consequence for the desired top nav plus expanding center:

- The center area should own the remaining grid space. It should not compute `width: calc(100% - rightWidth)` in leaf components.
- The shell layout should conditionally remove the right column when `RightAside` collapses. This makes collapsed-right state the real full-screen state.
- Keep `RightAside` width in state even while collapsed. Restore that width on expand.
- Keep visibility and width separate. A hidden panel with a remembered width matches Cursor's behavior and avoids snapping to defaults.
- If Honk later needs agent tabs in the top nav, copy Cursor's detach pattern at the tab-strip level only. Do not keep the whole right panel mounted just to show a header tab.

# 8 Open questions/not-found

- `auxiliaryBar.location` was not found.
- `workbench.auxiliaryBar.location` was not found.
- `secondarySideBar.location` was not found.
- `workbench.view.aichat` was not found. The found view id is `workbench.panel.aichat.view`.
- `composer-panel` was not found.
- `composer-container` was not found.
- `.composer-view-pane` was found once in JS as a selector, but no CSS rule with that selector was found.
- `aichat-container` was found as a JS string constant, but no CSS rule with that selector was found.
- I did not prove the exact grid ordering that places `workbench.parts.auxiliarybar` on the right in every layout variant. The evidence shows location 2, right-side use in the target UI, and grid visibility reflow. Sidebar and unified-sidebar modes can change adjacent borders and surrounding parts.
