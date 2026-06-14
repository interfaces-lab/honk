# Round 2 — No-rerender toolbar toggle (maximize / fullscreen)

## 1. Scope

Focused re-check of how Cursor's bundled workbench reflects maximize/fullscreen toggle state on a toolbar button **without React re-render**. Evidence from bounded `rg` windows in:

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

Anchor counts (first pass): `updateChecked` 30, `agentChatMaximizedContext` 9, `toggled:ze` 41, `classList.toggle("checked"` 7, `onDidChangeContext` 75, `K4e` 14, `agentChatMaximized` 11.

## 2. Target button and command

Cursor's unified chat/editor maximize control is **`workbench.action.maximizeChatSize`** (`RUg.ID`, class alias `S3h`).

Command run path reads the context key and toggles layout:

```js
const d=!(s.getContextKeyValue(K4e.key)===!0);await i.toggleUnifiedMaximizeState()
```

Layout service writes the key when maximize state changes:

```js
this.agentChatMaximizedContext?.set(e)
```

Context key definition:

```js
K4e=new $n("agentChatMaximized",!1,N(4314,null))
```

Bound in layout service init:

```js
this.agentChatMaximizedContext=K4e.bindTo(this.contextKeyService)
```

## 3. Menu registration (`toggled:`)

Titlebar layout-control menu (`Ct.LayoutControlMenu`, group `2_pane_toggles`):

```js
command:{id:S3h.ID,title:N(3061,null),icon:it.maximize,toggled:{condition:ze.equals(K4e.key,!0),icon:it.minimize,title:N(3062,null)}}
```

Composer/auxiliary view title (same command, simpler `toggled:`):

```js
command:{id:"workbench.action.maximizeChatSize",title:"Maximize Chat",toggled:ze.equals("agentChatMaximized",!0)}
```

Icons: `it.maximize` / `it.minimize` codicons (`maximize:Jn("maximize",62040)`, `minimize:Jn("minimize",62041)`).

Reference parallel (panel maximize, same mechanism, different key):

```js
toggled:{condition:r2i,icon:QAx,tooltip:N(3903,null)}
```

## 4. Context key -> menu -> action.checked

### 4.1 Menu collects toggled context keys

When menu items are parsed, `command.toggled` keys are registered:

```js
if(e.command.toggled){const t=e.command.toggled.condition||e.command.toggled;CMp._fillInKbExprKeys(t,this._toggledContextKeys)}
```

### 4.2 Context change fires menu update

Menu service listens to `contextKeyService.onDidChangeContext` and sets `isToggleChange` when `toggledContextKeys` are affected:

```js
const v=m.affectsSome(this._menuInfo.toggledContextKeys);(h||f||v)&&this._onDidChange.fire({...,isToggleChange:v})
```

Titlebar subscribes (debounced 16 ms):

```js
this.layoutToolbarMenu.onDidChange(()=>{...this.scheduleActionToolBarMenusUpdate(!0)})
```

Dedicated listener for maximize key also repositions toolbar container (DOM move, not React):

```js
const o=new Set([K4e.key]);this._register(this.contextKeyService.onDidChangeContext(a=>{a.affectsSome(o)&&so(this.element).requestAnimationFrame(()=>{this.updateActionsPositioning()})}))
```

### 4.3 MenuItemAction (`v0`) evaluates checked once per refresh

Each menu refresh constructs a new `v0` (VS Code `MenuItemAction`) with `checked` from the context service:

```js
if(n.toggled){const c=n.toggled.condition?n.toggled:{condition:n.toggled};this.checked=s.contextMatchesRules(c.condition),this.checked&&mn.isThemeIcon(c.icon)&&(a=c.icon),...}
```

Helper for structured toggled objects:

```js
function IHp(n){return n?n.condition!==void 0:!1}
```

## 5. Imperative view-item update (no React)

Toolbar is VS Code **`monaco-action-bar`** / **`ActionBar` (`Ey`)** inside titlebar part `jFa` / `v5v`. Titlebar creates one persistent container:

```js
this.actionToolBarElement=Qt(this.rightContent,zt("div.action-toolbar-container"))
```

View item factory for menu actions:

```js
function _5(n,e,t){return e instanceof v0?n.createInstance(rV,e,t):...}
```

`rV` = **`MenuEntryActionViewItem`**, extends **`gO` (`CodiconActionViewItem`)**, extends **`L8` (`BaseActionViewItem`)**.

### 5.1 checked class + aria (BaseActionViewItem path)

`L8` subscribes to `Lo.onDidChange` and calls `updateChecked()` when `checked` changes:

```js
n.checked!==void 0&&this.updateChecked()
```

`gO.updateChecked()` mutates the existing `.action-label` node:

```js
updateChecked(){this.label&&(this.action.checked!==void 0?(this.label.classList.toggle("checked",this.action.checked),...this.label.setAttribute("aria-checked",this.action.checked?"true":"false"),this.label.setAttribute("role","checkbox")):(this.label.classList.remove("checked"),...))}
```

### 5.2 Icon swap (CSS classes on same label node)

`MenuEntryActionViewItem.updateClass()` -> `_updateItemClass()` picks icon from toggled state:

```js
const i=this._commandAction.checked&&IHp(n.toggled)&&n.toggled.icon?n.toggled.icon:n.icon;if(i)if(mn.isThemeIcon(i)){const r=mn.asClassNameArray(i);t.classList.add(...r),this._itemClassDispose.value=or(()=>{t.classList.remove(...r)})}
```

Off state: `codicon-maximize`. On state: `codicon-minimize`. Swap is **classList add/remove on the same `<a.action-label>`**, not a React icon prop.

### 5.3 Toggled highlight CSS

Action bar enables highlight when editor actions live in titlebar:

```js
highlightToggledItems:this.editorActionsEnabled
```

Which adds container class:

```js
this.options.highlightToggledItems&&this.actionsList.classList.add("highlight-toggled")
```

CSS:

```css
.monaco-action-bar .actions-container.highlight-toggled .action-label.checked{background:var(--vscode-actionBar-toggledBackground)!important}
```

`.toggled` class and `[aria-checked=true]` attribute selectors: **not found** in `workbench.desktop.main.css`. State uses `.checked` on `.action-label`.

## 6. Toolbar refresh vs in-place DOM

### 6.1 Shell chrome stays mounted

Titlebar part, `.action-toolbar-container`, and `.monaco-action-bar` are created once in `createContentArea`. On maximize, the **same** `actionToolBarElement` node is reparented between titlebar and editor tabs:

```js
t.appendChild(this.actionToolBarElement),this.actionToolBarElement.classList.toggle("in-editor-tabs",n==="editor-tabs"),this.actionToolBarElement.classList.toggle("in-titlebar",n==="titlebar")
```

This is imperative DOM motion, not component unmount.

### 6.2 Toggle state refresh rebuilds action items (still not React)

On `agentChatMaximized` change, menu `onDidChange` schedules:

```js
scheduleActionToolBarMenusUpdate -> createActionToolBarMenus -> layoutToolbarMenu.getActions() -> actionToolBar.setActions(...)
```

`setActions` always clears and re-pushes:

```js
setActions(n,e){this.clear();...t.forEach(i=>{this.actionBar.push(i,{icon:...})})}
```

`ActionBar.clear()` removes all `<li.action-item>` children; `push()` creates new ones and calls `viewItem.render(s)`.

So: **toolbar shell node is updated in place; individual toggle buttons are recreated on each menu toggle refresh** (new `v0` + new `rV`, new `<li>`). No React tree involved either way.

Within a single view-item lifetime (e.g. `Lo` actions that fire `onDidChange({checked})`), updates are strictly in-place via `updateChecked()` / `updateClass()`.

## 7. End-to-end chain (maximize chat)

```text
toggleUnifiedMaximizeState()
  -> agentChatMaximizedContext.set(true|false)     // K4e / "agentChatMaximized"
  -> contextKeyService.onDidChangeContext
       -> layoutToolbarMenu.onDidChange (isToggleChange)
       -> scheduleActionToolBarMenusUpdate (rAF)
       -> v0.checked = contextMatchesRules(ze.equals(K4e.key,true))
       -> MenuEntryActionViewItem (rV)
            -> updateChecked: .action-label.checked + aria-checked
            -> updateClass/_updateItemClass: codicon-maximize <-> codicon-minimize
       -> CSS: .highlight-toggled .action-label.checked background
  -> updateActionsPositioning (same actionToolBarElement reparented if needed)
```

## 8. Exact identifiers

| Identifier | Role |
|---|---|
| `agentChatMaximized` | Context key string (`K4e.key`) |
| `K4e` | Context key object; `bindTo(contextKeyService)` as `agentChatMaximizedContext` |
| `workbench.action.maximizeChatSize` | Command id (`S3h.ID`, `RUg.ID`) |
| `Ct.LayoutControlMenu` | Titlebar layout toolbar menu id |
| `Ct.ViewTitle` | Composer pane title menu (also registers maximize with `toggled:`) |
| `v0` | `MenuItemAction` — sets `.checked` from `contextMatchesRules(toggled.condition)` |
| `rV` | `MenuEntryActionViewItem` — `_updateItemClass`, `updateChecked` |
| `gO` | `CodiconActionViewItem` — `updateChecked()` on `.action-label` |
| `L8` | `BaseActionViewItem` — `handleActionChangeEvent` -> `updateChecked()` |
| `Ey` / `FB` | `ActionBar` / workbench `WorkbenchToolBar` |
| `IHp()` | Returns true when toggled object has `.condition` |
| `it.maximize` / `it.minimize` | Off/on codicons |
| `.action-label.checked` | Toggle-on surface class |
| `.highlight-toggled` | Action-bar container class for toggled background |
| `data-command-id` | Set on menu-entry items (`Oot="data-command-id"`) |

## 9. Not found / caveats

- `MenuItemAction` string literal: **not found** (minified as `v0`).
- `set("checked"` on context keys: **not found** (uses `ContextKey.set()` via `bindTo`, not string `"checked"`).
- `.toggled` CSS class on action labels: **not found**.
- `[aria-checked=true]` CSS selector: **not found** (attribute is set imperatively; styling uses `.checked`).
- Glass/React editor-panel fullscreen (`Enter Full Screen` / `arrows-expand-simple` icon prop): separate React path in bundle; **not** the workbench `ActionBar` mechanism above.
- `workbench.action.toggleFullScreen` / `isFullscreen` (`lNo`): native window fullscreen; different state from `agentChatMaximized`.

## 10. Honk mapping

Copy the VS Code pattern, not React conditional render:

1. Store maximize as a **context key** (or external store) written synchronously in the layout transition.
2. Bind toolbar/menu items with **`toggled: { condition, icon, title }`** semantics.
3. Let view items mutate **existing** `.action-label` nodes: `classList.toggle("checked")`, swap codicon classes, optional `.highlight-toggled` background.
4. Keep toolbar/titlebar **DOM mounted**; move containers with `appendChild` + class flips, not `return null`.
