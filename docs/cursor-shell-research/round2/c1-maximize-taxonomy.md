# Round 2: Maximize command taxonomy

Target bundle (read-only, counted/extracted via `rg` windows only):

- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
- `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css`

Builds on round-1 reports `docs/cursor-shell-research/01..05*.md`.

## Method

1. Count anchors: `rg --count-matches -F 'anchor' "$BIN"`.
2. Extract windows: `rg -oN -P '.{0,300}ANCHOR.{0,1500}' "$BIN" | head -c 5000`.
3. Every claim below quotes a snippet from those windows or marks **not found**.

## Context keys (relevant)

| Key                              | Variable | Set when                                                      |
| -------------------------------- | -------- | ------------------------------------------------------------- |
| `editorPartMultipleEditorGroups` | `ZUn`    | `this.count>1`                                                |
| `editorPartMaximizedEditorGroup` | `UMt`    | `this.hasMaximizedGroup()`                                    |
| `agentChatMaximized`             | `K4e`    | `setUnifiedMaximizeState` / `setEditorHidden` in unified mode |
| `sideBarVisible`                 | `C8e`    | primary sidebar visible                                       |
| `auxiliaryBarVisible`            | `JMt`    | auxiliary bar visible                                         |

Evidence:

```js
const t = ZUn.bindTo(n),
  i = UMt.bindTo(n),
  r = () => {
    (this.count > 1 ? t.set(!0) : t.reset(), this.hasMaximizedGroup() ? i.set(!0) : i.reset());
  };
```

## Full command table

Legend: **Y** = hides that part; **N** = unchanged by this command; **—** = not applicable.

| Command ID                                         | Toolbar / menu button                                                                                                                                                                                                                                                                                                                               | Hides primary sidebar (`workbench.parts.sidebar`)? | Hides auxiliary bar (`workbench.parts.auxiliarybar`)? | Hides unified/agent sidebar (`workbench.parts.unifiedsidebar`)? |      Hides panel?       |        Hides editor part?         | What grows                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------: | :---------------------------------------------------: | :-------------------------------------------------------------: | :---------------------: | :-------------------------------: | ------------------------------------------------------------------------------- |
| `workbench.action.toggleMaximizeEditorGroup`       | **Editor group toolbar**: `Ct.EditorTitle` / `Ct.EmptyEditorGroup`, `group:"navigation"`, `order:-1e4`, `icon:it.screenFull`, `toggled:UMt`, `when:ze.and(UMt)`. Context menu: `Ct.EditorTitle`, `group:"8_group_operations"`, `when:ze.and(UMt.negate(),ZUn)` (maximize) / `when:ze.and(UMt)` (restore).                                           |                         N                          |                           N                           |                                N                                |            N            |                 N                 | Active editor group inside editor part via `gridWidget.maximizeView`            |
| `workbench.action.maximizeEditorHideSidebar`       | **No toolbar registration found.** Command palette / `f1:true` only.                                                                                                                                                                                                                                                                                |                         Y                          |                           Y                           |                                N                                |            N            |                 N                 | Active editor group maximized inside remaining editor part                      |
| `workbench.action.minimizeOtherEditors`            | **No toolbar registration found.** Title: "Expand Editor Group".                                                                                                                                                                                                                                                                                    |                         N                          |                           N                           |                                N                                |            N            |                 N                 | Active editor group expands inside editor part via `gridWidget.expandView`      |
| `workbench.action.minimizeOtherEditorsHideSidebar` | **No toolbar registration found.**                                                                                                                                                                                                                                                                                                                  |                         Y                          |                           Y                           |                                N                                |            N            |                 N                 | Active editor group expands inside editor part                                  |
| `workbench.action.maximizeChatSize`                | **Chat view title**: `Ct.ViewTitle`, `id:"workbench.action.maximizeChatSize"`, title "Maximize Chat", `toggled:ze.equals("agentChatMaximized",!0)`. Action class icon: `it.minimize` / toggled `it.maximize`. Keybinding `primary:2595`. Empty-editor watermark shortcut. Double-click aux tab also calls this id with `source:"double_click_tab"`. |                  Y (default path)                  |              N (stays visible; expands)               |                                N                                |            Y            |                 Y                 | Auxiliary bar (chat/composer pane)                                              |
| `workbench.action.toggleMaximizedPanel`            | **Panel title toolbar**: `Ct.PanelTitle`, `group:"navigation"`, `order:1`, icons `YAx`/`QAx` (`it.chevronUp` / `it.chevronDown`, codicons `panel-maximize` / `panel-restore`).                                                                                                                                                                      |                         N                          |        N (may preserve width in unified mode)         |                                N                                | — (panel is what grows) | Y (when entering panel-maximized) | Panel part                                                                      |
| `workbench.action.toggleZenMode`                   | **Appearance menu**: `Ct.MenubarAppearanceMenu`, `group:"1_toggle_view"`, `order:2`, `toggled:ife`. Layout customize menu entry.                                                                                                                                                                                                                    |                         Y                          |                           Y                           |           N (no `unifiedsidebar` call in enter path)            |            Y            |                 N                 | Editor area (centered if configured); chrome stripped                           |
| `workbench.action.toggleFullScreen`                | **Appearance menu** + layout customize menu. `toggled:lNo`.                                                                                                                                                                                                                                                                                         |                         N                          |                           N                           |                                N                                |            N            |                 N                 | Native OS window fullscreen; workbench parts unchanged                          |
| `workbench.action.toggleCenteredLayout`            | **Appearance menu**, `toggled:Gdh`.                                                                                                                                                                                                                                                                                                                 |                         N                          |                           N                           |                                N                                |            N            |                 N                 | Editor content centered inside editor part (`centeredLayoutWidget.activate`)    |
| `workbench.action.togglePanel`                     | Layout control toggles / panel chrome. Special unified-mode branch.                                                                                                                                                                                                                                                                                 |           N (uses `skipHideSidebar:!0`)            |                           N                           |                                N                                |         toggles         |                 N                 | Panel when shown; exits unified maximize when panel hidden while chat maximized |

Standalone `workbench.action.maximizeEditor` as its own command id: **not found** (count=1 is the prefix of `workbench.action.maximizeEditorHideSidebar`).

## Wiring evidence by command

### 1. `workbench.action.toggleMaximizeEditorGroup` (default editor-group maximize)

Registration + run:

```js
iDx=class extends yn{constructor(){super({id:tMo,title:At(3582,"Toggle Maximize Editor Group"),...menu:[{id:Ct.EditorTitle,order:-1e4,group:"navigation",when:ze.and(UMt)},{id:Ct.EmptyEditorGroup,order:-1e4,group:"navigation",when:ze.and(UMt)}],icon:it.screenFull,toggled:UMt})}async run(n,...e){...t.toggleMaximizeGroup(s.groupedEditors[0].group)}}
```

Grid effect (no part hides):

```js
case 0:if(this.groups.length<2)return;this.gridWidget.maximizeView(t),t.focus();break
toggleMaximizeGroup(n=this.activeGroup){this.hasMaximizedGroup()?this.unmaximizeGroup():this.arrangeGroups(0,n)}
```

No `setPartHidden`, `setSideBarHidden`, or `setUnifiedSidebarHidden` on this path.

### 2. `workbench.action.maximizeEditorHideSidebar`

```js
id:"workbench.action.maximizeEditorHideSidebar",title:At(3581,"Maximize Editor Group and Hide Side Bars")
run(n){...e.setPartHidden(!0,"workbench.parts.sidebar"),e.setPartHidden(!0,"workbench.parts.auxiliarybar"),t.arrangeGroups(0)}
```

### 3. `workbench.action.minimizeOtherEditors` / `HideSidebar`

```js
id:"workbench.action.minimizeOtherEditors",title:At(3577,"Expand Editor Group")
run(n){n.get(hl).arrangeGroups(1)}
```

```js
id:"workbench.action.minimizeOtherEditorsHideSidebar",title:At(3578,"Expand Editor Group and Hide Side Bars")
run(n){...t.setPartHidden(!0,"workbench.parts.sidebar"),t.setPartHidden(!0,"workbench.parts.auxiliarybar"),e.arrangeGroups(1)}
```

### 4. `workbench.action.maximizeChatSize` (unified / agent chat maximize)

Action + menu:

```js
RUg=class F7v extends yn{constructor(){super({id:F7v.ID,...icon:it.minimize,toggled:{condition:ze.equals(K4e.key,!0),...icon:it.maximize},keybinding:{weight:200,primary:2595}})}async run(e,t){...await i.toggleUnifiedMaximizeState()}}
RUg.ID="workbench.action.maximizeChatSize"
```

```js
br.appendMenuItem(Ct.ViewTitle,{command:{id:"workbench.action.maximizeChatSize",title:"Maximize Chat",toggled:ze.equals("agentChatMaximized",!0)},group:"0_a_visibility",...})
```

`setUnifiedMaximizeState` enter path (default — no `skipHideSidebar`):

```js
(t?.skipHideSidebar || this.setSideBarHidden(!0, !0),
  this.setPanelHidden(!0, !0),
  this.setEditorHidden(!0, !0));
```

Unified sidebar is **not** hidden here. Width is cached if visible:

```js
if(this.isVisible("workbench.parts.unifiedsidebar")){const a=this.workbenchGrid.getViewSize(this.unifiedSidebarPartView);...this.unifiedSidebarWidthPercentageBeforeMaximize=a.width/this.mainContainerDimension.width}
```

When editor hides in unified mode, auxiliary bar expands to fill space **minus** sidebar + unified sidebar + activity bar widths:

```js
setEditorHidden(e,t){...if(e&&i){...const o=this.isVisible("workbench.parts.sidebar")?this.getSize("workbench.parts.sidebar").width:0,a=this.isVisible("workbench.parts.unifiedsidebar")?this.getSize("workbench.parts.unifiedsidebar").width:0,c=this.isVisible("workbench.parts.activitybar")?this.getSize("workbench.parts.activitybar").width:0,d=Math.max(this.auxiliaryBarPartView.minimumWidth,this.mainContainerDimension.width-o-a-c);this.setSize("workbench.parts.auxiliarybar",{width:d,...})}}
```

### 5. `workbench.action.toggleMaximizedPanel`

```js
id:"workbench.action.toggleMaximizedPanel",...menu:[{id:Ct.PanelTitle,group:"navigation",order:1,...}]
run(n){...e.isVisible("workbench.parts.panel")?e.toggleMaximizedPanel():...}
```

```js
toggleMaximizedPanel(){...else{...this.setEditorHidden(!0),...}}
```

Panel toolbar chevron icons:

```js
((YAx = Qs("panel-maximize", it.chevronUp, N(3882, null))),
  (QAx = Qs("panel-restore", it.chevronDown, N(3883, null))));
```

### 6. `workbench.action.toggleZenMode`

```js
id:"workbench.action.toggleZenMode",...run(n){return n.get(lm).toggleZenMode()}
```

Enter path:

```js
(this.setPanelHidden(!0, !0),
  this.setAuxiliaryBarHidden(!0, !0),
  this.setSideBarHidden(!0, !0),
  o.hideActivityBar && this.setActivityBarHidden(!0, !0),
  o.hideStatusBar && this.setStatusBarHidden(!0, !0));
```

`workbench.parts.unifiedsidebar`: **not found** in zen enter snippet.

### 7. `workbench.action.togglePanel` (unified-mode coupling)

```js
if (r && s && !o) {
  await t.setUnifiedMaximizeState(!0, { skipHideSidebar: !0 });
  return;
}
```

`skipHideSidebar:!0` keeps primary sidebar visible while entering chat-maximized layout.

## Default editor-group toolbar button

The editor-group maximize/restore control in the tab strip is wired to **`workbench.action.toggleMaximizeEditorGroup`** (`tMo`), not `maximizeEditorHideSidebar`.

Evidence:

```js
menu:[{id:Ct.EditorTitle,order:-1e4,group:"navigation",when:ze.and(UMt)},{id:Ct.EmptyEditorGroup,order:-1e4,group:"navigation",when:ze.and(UMt)}],icon:it.screenFull,toggled:UMt
```

That command's only layout mutation is `toggleMaximizeGroup` → `gridWidget.maximizeView` / `exitMaximizedView`. It does **not** call `setPartHidden` on any sidebar part.

The separate "hide side bars then maximize" command is **`workbench.action.maximizeEditorHideSidebar`**, which is palette-only (no `Ct.EditorTitle` / navigation menu registration found).

The **chevron-up/down** toolbar icons (`panel-maximize` / `panel-restore`) belong to **`workbench.action.toggleMaximizedPanel`** on the panel title bar, not the editor-group toolbar.

## Common default vs explicit hide-sidebar maximize

| User action                                         | Command                                        | Sidebars                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Editor tab-strip expand icon (`screenFull`)         | `toggleMaximizeEditorGroup`                    | Primary sidebar, auxiliary bar, and unified/agent sidebar **stay mounted**                                        |
| Palette: "Maximize Editor Group and Hide Side Bars" | `maximizeEditorHideSidebar`                    | Primary sidebar **and** auxiliary bar **hidden**; unified/agent sidebar **unchanged**                             |
| Chat "Maximize Chat" / chat-size keybinding         | `maximizeChatSize` → `setUnifiedMaximizeState` | Primary sidebar **hidden** (unless `skipHideSidebar`); unified/agent sidebar **stays**; auxiliary bar **expands** |

## VERDICT

**default editor maximize KEEPS the left sidebar+agent list**

The default editor-group toolbar button runs `workbench.action.toggleMaximizeEditorGroup`, which only maximizes the active group inside the editor grid. Hiding primary sidebar, auxiliary bar, or unified/agent sidebar requires a different command (`maximizeEditorHideSidebar`, `maximizeChatSize`, zen mode, etc.).
