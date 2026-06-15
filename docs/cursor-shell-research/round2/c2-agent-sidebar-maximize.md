# Round 2: Agent list (unified sidebar) visibility during chat/composer maximize

## Question

In Cursor's AGENT layout, when the chat/composer maximizes, does the agent list (`workbench.parts.unifiedsidebar`) stay visible or get hidden?

## Method

Read-only search of bundled workbench JS/CSS. Counts first (`rg --count-matches -F`), then bounded windows (`rg -oN -P '.{0,300}ANCHOR.{0,1500}' | head -c 5000`). Binary never opened in editor.

Targets:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

## Anchor counts

| Anchor                                                     |             Count |
| ---------------------------------------------------------- | ----------------: |
| `setUnifiedMaximizeState`                                  |                18 |
| `toggleUnifiedMaximizeState`                               |                 2 |
| `skipHideSidebar`                                          |                12 |
| `setUnifiedSidebarHidden`                                  |                 3 |
| `unifiedsidebar`                                           |                83 |
| `unifiedSidebarPartView`                                   |                31 |
| `agentChatMaximizedContext` / `K4e` (`agentChatMaximized`) |                 9 |
| `setSideBarHidden`                                         |                 9 |
| `setAgentMaximized`                                        | **0 (not found)** |

## VERDICT

**agent list (unified sidebar) STAYS on maximize**

---

## 1. `setUnifiedMaximizeState` body

Enter (maximize) path records unified-sidebar width, then hides only file sidebar (conditionally), panel, and editor. No `setUnifiedSidebarHidden` / no `setPartHidden(..., "workbench.parts.unifiedsidebar")`.

```js
async setUnifiedMaximizeState(e,t){if(!this.workbenchGrid){this.wasMaximized=e,this.agentChatMaximizedContext?.set(e);return}if(this.isTogglingUnifiedMaximization=!0,e){...if(this.isVisible("workbench.parts.unifiedsidebar")){const a=this.workbenchGrid.getViewSize(this.unifiedSidebarPartView);this.mainContainerDimension.width>0&&(this.unifiedSidebarWidthPercentageBeforeMaximize=a.width/this.mainContainerDimension.width)}else this.unifiedSidebarWidthPercentageBeforeMaximize=void 0;await this.chatEditorGroupService.ensureChatVisibleOrCreate(),t?.skipHideSidebar||this.setSideBarHidden(!0,!0),this.setPanelHidden(!0,!0),this.setEditorHidden(!0,!0),t?.skipHideSidebar&&this.isVisible("workbench.parts.sidebar")&&this.setSize("workbench.parts.sidebar",{width:s.width,height:this.getSize("workbench.parts.sidebar").height})}else{...}
```

Exit path restores editor/panel/file-sidebar sizes; still no unified-sidebar hide call. Ends by setting maximize context:

```js
((this.wasMaximized = e),
  this.agentChatMaximizedContext?.set(e),
  this.stateModel.save(!0, !1),
  queueMicrotask(() => {
    this.isTogglingUnifiedMaximization = !1;
  }));
```

On exit, unified-sidebar width is read (not restored from hidden state) to adjust auxiliary-bar restore:

```js
const o = this.isVisible("workbench.parts.unifiedsidebar")
    ? this.getSize("workbench.parts.unifiedsidebar").width / this.mainContainerDimension.width
    : 0,
  c = (this.unifiedSidebarWidthPercentageBeforeMaximize ?? 0) - o;
```

## 2. `skipHideSidebar` — file sidebar only, not unified sidebar

`skipHideSidebar` gates `setSideBarHidden` (primary/file explorer `workbench.parts.sidebar`). Default when omitted: sidebar is hidden on maximize.

Agent-layout call sites overwhelmingly pass `{skipHideSidebar:!0}`:

```js
await e.setUnifiedMaximizeState(f, { skipHideSidebar: !0 });
```

```js
if (r && s && !o) {
  await t.setUnifiedMaximizeState(!0, { skipHideSidebar: !0 });
  return;
}
```

`toggleUnifiedMaximizeState` (used by `workbench.action.maximizeChatSize`) does not pass options:

```js
async toggleUnifiedMaximizeState(){const e=this.agentChatMaximizedContext?.get()??this.wasMaximized??!this.isVisible("workbench.parts.editor");await this.setUnifiedMaximizeState(!e)}
```

Even without `skipHideSidebar`, only `setSideBarHidden` is skipped conditionally — unified sidebar is never in that branch.

## 3. Unified sidebar is a separate part from file sidebar

`setPartHidden` dispatches to different methods:

```js
case"workbench.parts.sidebar":this.setSideBarHidden(e);break;...case"workbench.parts.unifiedsidebar":this.setUnifiedSidebarHidden(e);break
```

`setUnifiedSidebarHidden` only runs when explicitly hiding `workbench.parts.unifiedsidebar`:

```js
setUnifiedSidebarHidden(e,t){...this.workbenchGrid.setViewVisible(this.unifiedSidebarPartView,!e),this.updateUnifiedSidebarVisibleContextKey()}
```

`setUnifiedMaximizeState` never calls this. Unified sidebar is toggled elsewhere (e.g. `workbench.action.toggleAgentsSideBar`, layout restore), not during maximize.

## 4. Maximize grows auxiliary bar around unified sidebar

When editor is hidden in unified/agent mode, `setEditorHidden` expands the auxiliary bar (composer/chat pane) by subtracting unified-sidebar width from available width:

```js
const o=this.isVisible("workbench.parts.sidebar")?this.getSize("workbench.parts.sidebar").width:0,a=this.isVisible("workbench.parts.unifiedsidebar")?this.getSize("workbench.parts.unifiedsidebar").width:0,c=this.isVisible("workbench.parts.activitybar")?this.getSize("workbench.parts.activitybar").width:0,d=Math.max(this.auxiliaryBarPartView.minimumWidth,this.mainContainerDimension.width-o-a-c);this.setSize("workbench.parts.auxiliarybar",{width:d,...})
```

This layout math assumes unified sidebar remains on screen while the composer area expands.

## 5. `agentChatMaximizedContext` / `agentmode`

Context key definition:

```js
K4e = new $n("agentChatMaximized", !1, N(4314, null));
```

Bound at init: `this.agentChatMaximizedContext=K4e.bindTo(this.contextKeyService)`.

Set on maximize and on editor hide in unified mode:

```js
this.isUnifiedMode() &&
  (this.agentChatMaximizedContext?.set(e),
  (this.wasMaximized = e),
  e
    ? this.mainContainer.classList.add("agentmode")
    : this.mainContainer.classList.remove("agentmode"));
```

Maximize toggle command uses `agentChatMaximized` context (`K4e.key`) and calls `toggleUnifiedMaximizeState()`.

Startup restore when editor was hidden in unified mode also sets `agentChatMaximizedContext` and `.agentmode` without hiding unified sidebar.

## 6. CSS: `agentmode` coexists with `unifiedsidebarvisible`

CSS targets `.agentmode` auxiliary-bar chrome and `body.unifiedsidebarvisible` / `body.unifiedsidebarhidden` separately. Maximize adds `agentmode` + `nomaineditorarea`; unified-sidebar body classes flip only when unified-sidebar visibility changes, not in `setUnifiedMaximizeState`.

```css
body
  .monaco-workbench.agentmode
  .part.auxiliarybar
  .composite.title.auxiliary-bar-title--agent-mode {
  max-width: none;
}
body.no-titlebar-layout.unifiedsidebarvisible[data-sidebar-position="right"]
  .monaco-workbench
  .part.auxiliarybar
  > .composite.title {
  pointer-events: none;
}
```

## 7. What gets hidden on maximize (agent layout)

| Part                                          | Hidden on maximize? | Mechanism                                                            |
| --------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| `workbench.parts.unifiedsidebar` (agent list) | **No**              | Not referenced in hide path; width preserved/snapshot                |
| `workbench.parts.sidebar` (file explorer)     | Conditional         | `skipHideSidebar` → skip `setSideBarHidden`; agent paths pass `true` |
| `workbench.parts.panel`                       | Yes                 | `setPanelHidden(!0,!0)`                                              |
| `workbench.parts.editor`                      | Yes                 | `setEditorHidden(!0,!0)` → `.nomaineditorarea`, `.agentmode`         |
| `workbench.parts.auxiliarybar` (composer)     | **No**              | Stays visible; resized to fill remaining width                       |

## 8. Not found

- `setAgentMaximized` — 0 matches
- Any `setUnifiedMaximizeState` window containing `setUnifiedSidebarHidden` — not found
- Any maximize path that calls `setPartHidden(!0,"workbench.parts.unifiedsidebar")` — not found (onboarding disable-unification path hides it separately, unrelated to chat maximize)

## Honk implication

Honk's agent-layout fullscreen should keep the agent/conversation list column mounted and visible while only the center editor and panel collapse; the active chat/composer column should expand into freed space, matching Cursor's `setEditorHidden` + auxiliary-bar resize behavior rather than hiding the list rail.
