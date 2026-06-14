# 1 Scope

This slice covers Cursor's bundled workbench left side only:

- Activity bar part, icon composite bar, badges, and bottom global actions.
- Primary sidebar part, title/header, viewlet/pane container, and pane headers.
- Sidebar/activity-bar visibility and location state.
- Sidebar width persistence and grid reflow when collapsed.

Out of scope: titlebar contents, auxiliary bar, composer/unified sidebar behavior except where it appears in the same layout method, and fullscreen/zen-mode state machines.

Method notes:

- Guard the Context Window shaped the search method. I counted fixed string anchors first, then used byte-offset windows around preserved literals instead of loading the 61 MB bundle.
- Sequence Work into Verifiable Units shaped the order. Counts came first, then DOM identifiers, then state, then CSS geometry.
- Prove It Works shaped the final check. The report quotes the exact literals found in the bundled JS/CSS and records missing terms as not found.

# 2 Mechanism

Cursor models the left side as separate workbench parts inside a grid. The vertical activity bar is `workbench.parts.activitybar`; the primary sidebar is `workbench.parts.sidebar`. Focus traversal treats them as siblings of editor, panel, status bar, and auxiliary bar:

Evidence:

`case"workbench.parts.activitybar":s=t?"workbench.parts.sidebar":"workbench.parts.statusbar";break;case"workbench.parts.sidebar":n.activityBarDirection==="vertical"?s=t?"workbench.parts.editor":"workbench.parts.activitybar":s="workbench.parts.editor"`

The activity bar is a fixed-width part. CSS gives it a 48 px width and a column layout where the main composite bar sits above the bottom actions:

Evidence:

`.monaco-workbench .part.activitybar{height:100%;width:48px}.monaco-workbench .activitybar>.content{display:flex;flex-direction:column;height:100%;justify-content:space-between}`

The primary sidebar is a pane composite part. Its title area is generic, not a literal `sidebar-title` node. The title area contains `.title`, `.title-label h2`, and `.title-actions`; the content area is `.content`.

Evidence:

`createTitleArea(n){const e=Qt(n,zt(".composite"));e.classList.add("title"),this.titleLabel=this.createTitleLabel(e);const t=Qt(e,zt(".title-actions"))`

`createTitleLabel(n){const e=Qt(n,zt(".title-label")),t=Qt(e,zt("h2"));this.titleLabelElement=t;`

Sidebar hiding is both a class toggle and a grid operation. The `workbench.action.toggleSidebarVisibility` command asks the layout service to hide or show `workbench.parts.sidebar`:

Evidence:

`run(e){const t=e.get(lm);t.setPartHidden(t.isVisible("workbench.parts.sidebar"),"workbench.parts.sidebar")}};PUg.ID="workbench.action.toggleSidebarVisibility"`

The concrete hide path persists runtime state, toggles `.nosidebar` / `.sidebarvisible`, closes or restores the active pane composite, and then changes the grid view visibility:

Evidence:

`this.stateModel.setRuntimeValue(Bu.SIDEBAR_HIDDEN,e),this.stateModel.save(!0,!1);const s=this.isUnifiedMode();if(e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible"))`

`const c=this.workbenchGrid.isViewVisible(this.sideBarPartView);this.workbenchGrid.setViewVisible(this.sideBarPartView,!e);const d=this.workbenchGrid.isViewVisible(this.sideBarPartView);`

CSS then hard-hides the sidebar part when the root workbench has `.nosidebar`:

Evidence:

`.monaco-workbench.nosidebar>.part.sidebar{display:none!important;visibility:hidden!important}`

The canonical reflow comes from the grid. The workbench creates a grid descriptor whose sidebar leaf has the stored sidebar size and `visible:!B`, where `B` is `SIDEBAR_HIDDEN`. At runtime, `setViewVisible(sideBarPartView, false)` removes it from layout, so the editor/center area takes the freed width.

Evidence:

`F={type:"leaf",data:{type:"workbench.parts.sidebar"},size:i,visible:!B&&!this.environmentService.isGlass}`

`this.workbenchGrid.layout(c,d),this.initialized=!0,this.handleContainerDidLayout(this.mainContainer,this._mainContainerDimension)`

# 3 Exact identifiers

| Identifier | Count | Meaning | Evidence |
|---|---:|---|---|
| `workbench.parts.activitybar` | 34 | Activity bar workbench part id. | `n.hasFocus("workbench.parts.activitybar")?i="workbench.parts.activitybar"` |
| `workbench.parts.sidebar` | 111 | Primary sidebar workbench part id. | `super("workbench.parts.sidebar",...,this.minimumWidth=214` |
| `activitybar` | 55 | Activity bar class/name fragment. | `.monaco-workbench .part.activitybar{height:100%;width:48px}` |
| `activity-bar` | 0 | Not found. Cursor uses `activitybar`, not `activity-bar`. | not found |
| `composite-bar` | 18 JS, 379 CSS | Host for view container tabs/icons. | `const t=e.querySelector(".composite-bar")??e` |
| `composite-bar-action-tab` | 3 | Activity/composite item class. | `this.container.classList.add("composite-bar-action-tab")` |
| `monaco-action-bar` | 80 JS, 622 CSS | Generic action bar wrapper. | `this.domNode=document.createElement("div"),this.domNode.className="monaco-action-bar"` |
| `action-item` | 59 JS | Action list item. | `const s=document.createElement("li");s.className="action-item"` |
| `action-label` | 73 JS | Anchor inside an action item. | `e.classList.add("action-label"),e.setAttribute("role",this.getDefaultAriaRole())` |
| `badge` | 590 | Badge system, many workbench uses. | `this._badge=Qt(n,zt(".badge")),this._badgeContent=Qt(this._badge,zt(".badge-content"))` |
| `badge-content` | 5 | Badge text content node. | `this._badgeContent.textContent=s,zw(this._badge)` |
| `active-item-indicator` | 6 | Active activity bar marker. | `Qt(n,zt(".active-item-indicator")),nb(this.badge),this.update()` |
| `global-actions` | 2 JS, 13 CSS | Toolbar area in pane composite titles. It is not the activity bar bottom strip. | `const t=e.appendChild(zt(".global-actions"));return this.globalToolBar=` |
| `workbench.actions.manage` | 1 | Bottom activity bar manage/settings action id. | `var EFt="workbench.actions.manage",AFt="workbench.actions.accounts"` |
| `workbench.actions.accounts` | 1 | Bottom activity bar accounts action id. | `var EFt="workbench.actions.manage",AFt="workbench.actions.accounts"` |
| `settings-view-bar-icon` | 1 | Manage/settings bottom icon registration. | `var h7n=Qs("settings-view-bar-icon",it.settingsGear` |
| `accounts-view-bar-icon` | 1 | Accounts bottom icon registration. | `IFt.ACCOUNTS_ICON=Qs("accounts-view-bar-icon",it.account` |
| `sidebar-title` | 8 | Not primary sidebar. Matches marketplace editor sidebar titles. | `<h2 class=marketplace-editor__sidebar-title>Marketplace` |
| `pane-header` | 8 JS, 51 CSS | Generic pane header class. | `this.header=zt(".pane-header"),Qt(this.element,this.header)` |
| `split-view-view` | 2 JS, 34 CSS | Split view child wrapper for panes. | `const r=zt(".split-view-view");...this.viewContainer.appendChild(r)` |
| `viewlet` | 85 | Legacy name for sidebar pane composite. | `ACTIVE_VIEWLET_SETTINGS_KEY="workbench.sidebar.activeviewletid"` |
| `workbench.action.toggleSidebarVisibility` | 3 | Primary sidebar toggle command. | `PUg.ID="workbench.action.toggleSidebarVisibility"` |
| `workbench.action.toggleActivityBarVisibility` | 1 | Activity bar toggle command. | `var YIx="workbench.action.toggleActivityBarVisibility"` |
| `workbench.sideBar.location` | 39 | User setting for primary sidebar side. | `"workbench.sideBar.location":{type:"string",enum:["left","right"],default:z9t` |
| `workbench.activityBar.location` | 33 | User setting for activity bar location/hidden state. | `"workbench.activityBar.location":{type:"string",enum:["default","top","bottom","hidden"]` |
| `nosidebar` | 3 | Root class when primary sidebar is hidden. | `.monaco-workbench.nosidebar>.part.sidebar{display:none!important;visibility:hidden!important}` |
| `cursor/editorLayout.sidebarWidth` | 1 | Cursor storage key for editor layout sidebar width. | `n.SIDEBAR_WIDTH="cursor/editorLayout.sidebarWidth"` |
| `cursor/agentLayout.sidebarWidth` | 1 | Cursor storage key for agent layout sidebar width. | `n.SIDEBAR_WIDTH="cursor/agentLayout.sidebarWidth"` |
| `workbench.sidebar.activeviewletid` | 2 | Last active primary sidebar viewlet id. | `p7n.activeViewletSettingsKey="workbench.sidebar.activeviewletid"` |
| `SIDE_BAR_WIDTH` | 0 | Not found. | not found |

# 4 DOM/component hierarchy

Observed hierarchy, reconstructed from preserved class literals and CSS:

```text
.monaco-workbench
  .part.activitybar.activitybar.left|right
    .content
      .composite-bar
        .monaco-action-bar.vertical
          li.action-item.checked|active
            a.action-label.codicon|uri-icon
            .active-item-indicator
            .badge
              .badge-content
      div
        .monaco-action-bar.vertical
          li.action-item
            a.action-label
              workbench.actions.accounts
          li.action-item
            a.action-label
              workbench.actions.manage

  .part.sidebar.pane-composite-part.left|right
    .title.composite
      .title-label
        h2
      .title-actions
        .monaco-toolbar / .monaco-action-bar
    .content
      .empty-pane-message-area
      .composite / active viewlet container
        .monaco-pane-view
          .pane.vertical|horizontal.expanded
            .pane-header
              .title
              .actions
            .pane-body
          .split-view-view
```

Evidence:

`this.element=n,this.element.classList.add("pane-composite-part"),super.create(n);const e=this.getContentArea();e&&this.createEmptyPaneMessage(e),this.updateCompositeBar()`

`this.header=zt(".pane-header"),Qt(this.element,this.header),this.header.setAttribute("tabindex","0"),this.header.setAttribute("role","button")`

# 5 Geometry & tokens

Activity bar:

- Part width: 48 px.
- Action label box: 48 px wide by 48 px high.
- Codicon size: 24 px.
- Menubar in activity bar: 35 px high.
- Non-codicon labels reserve 48 px left padding.

Evidence:

`.monaco-workbench .part.activitybar{height:100%;width:48px}`

`.monaco-workbench .activitybar>.content :not(.monaco-menu)>.monaco-action-bar .action-label{box-sizing:border-box;display:flex;height:48px;...width:48px}`

Evidence:

`.monaco-workbench .activitybar>.content :not(.monaco-menu)>.monaco-action-bar .action-label.codicon{align-items:center;font-size:24px;justify-content:center}`

`.monaco-workbench .activitybar .menubar,.monaco-workbench .activitybar .menubar.compact .toolbar-toggle-more{height:35px;width:100%}`

Badges:

- Composite bar badge content is 16 px high with a 16 px minimum width.
- Font size is 10 px and border radius is 10 px.

Evidence:

`.badge .badge-content{border-radius:10px;box-sizing:border-box;display:inline-block;font-size:10px;font-weight:400;height:16px;line-height:10px;min-width:16px;padding:3px 5px`

Primary sidebar:

- Minimum width is 214 px.
- Maximum width is `Number.POSITIVE_INFINITY`.
- Vertical activity-bar sidebar variant minimum height is 0.
- Horizontal activity-bar sidebar variant minimum height is 77.

Evidence:

`super("workbench.parts.sidebar",...,this.minimumWidth=214,this.maximumWidth=Number.POSITIVE_INFINITY,this.minimumHeight=0,this.maximumHeight=Number.POSITIVE_INFINITY`

`this.partId="workbench.parts.sidebar",...,this.minimumWidth=214,this.maximumWidth=Number.POSITIVE_INFINITY,this.minimumHeight=77`

Pane headers:

- Pane header height is 22 px.
- Header title is uppercase.
- Header action labels are 28 px wide by 22 px high in viewlets.

Evidence:

`.monaco-pane-view .pane>.pane-header{align-items:center;box-sizing:border-box;cursor:pointer;display:flex;font-size:11px;font-weight:700;height:22px;overflow:hidden}`

`.monaco-workbench .viewlet .collapsible.header .actions .action-label{background-position:50%;background-repeat:no-repeat;background-size:16px;height:22px;margin-right:0;width:28px}`

# 6 State & connectivity

The sidebar toggle is not a React-style re-render in the app layer. It is a layout service operation over a state model and a grid.

1. The command toggles `setPartHidden` for `workbench.parts.sidebar`.
2. The sidebar hide method writes `Bu.SIDEBAR_HIDDEN`.
3. It saves the state model.
4. It toggles root classes on `.monaco-workbench`.
5. It hides or restores the active pane composite.
6. It calls `workbenchGrid.setViewVisible(sideBarPartView, !hidden)`.

Evidence:

`this.stateModel.setRuntimeValue(Bu.SIDEBAR_HIDDEN,e),this.stateModel.save(!0,!1)`

`e?(this.mainContainer.classList.add("nosidebar"),this.mainContainer.classList.remove("sidebarvisible")):(this.mainContainer.classList.remove("nosidebar"),this.mainContainer.classList.add("sidebarvisible"))`

Evidence:

`this.workbenchGrid.setViewVisible(this.sideBarPartView,!e);const d=this.workbenchGrid.isViewVisible(this.sideBarPartView);if(c!==d&&this._onDidChangePartVisibility.fire()`

Width persistence happens through the layout state model. Cursor's storage key enums include both classic editor layout and agent layout sidebar widths:

Evidence:

`n.SIDEBAR_WIDTH="cursor/editorLayout.sidebarWidth"...A0=(n=>(n.SIDEBAR_LOCATION="cursor/agentLayout.sidebarLocation"...n.SIDEBAR_WIDTH="cursor/agentLayout.sidebarWidth"`

On state save, the grid records the current visible sidebar width. If the sidebar is hidden, it records the grid's cached visible size instead. That is the key detail that lets collapse reclaim space without losing the restore width.

Evidence:

`const k=this.workbenchGrid.getViewSize(this.sideBarPartView).width,E=this.workbenchGrid.getViewCachedVisibleSize(this.sideBarPartView),A=this.stateModel.getInitializationValue(Bu.SIDEBAR_SIZE),R=this.stateModel.getRuntimeValue(Bu.SIDEBAR_HIDDEN)?E:k`

`this.stateModel.setInitializationValue(Bu.SIDEBAR_SIZE,W);...this.stateModel.save(!0,!0)`

On startup, the grid descriptor reads the stored initialization value and creates the sidebar leaf with that size:

Evidence:

`createGridDescriptor(){const{width:e,height:t}=this._mainContainerDimension,i=this.stateModel.getInitializationValue(Bu.SIDEBAR_SIZE)`

`F={type:"leaf",data:{type:"workbench.parts.sidebar"},size:i,visible:!B&&!this.environmentService.isGlass}`

Activity bar visibility is different. Its toggle command updates the user setting `workbench.activityBar.location` between `hidden` and the previous/default vertical location:

Evidence:

`var YIx="workbench.action.toggleActivityBarVisibility";...const o=t.getValue("workbench.activityBar.location")==="hidden"?s:"hidden";return t.updateValue("workbench.activityBar.location",o)`

Sidebar side is also a setting. `workbench.sideBar.location` is `left` or `right`, and changing it updates body data and side classes before adjusting grid positions:

Evidence:

`"workbench.sideBar.location":{type:"string",enum:["left","right"],default:z9t,description:N(4156,null)}`

`m?.classList.remove(a),h.classList.remove(a),m?.classList.add(o),h.classList.add(o),...b&&b.setAttribute("data-sidebar-position",o),...this.adjustPartPositions(e,c,d)`

# 7 Honk mapping

Honk's fullscreen bug matches the failure mode Cursor avoids. If entering fullscreen only visually hides the left panel or changes an inner component state, the layout column still owns its previous width. The center cannot reclaim the space until the user manually toggles the sidebar and triggers the real layout path.

Cursor's pattern has three pieces that Honk should mirror:

1. A root shell class for state reflection, equivalent to Cursor's `.monaco-workbench.nosidebar`.
2. A layout state update that marks the left panel hidden at the same moment fullscreen is entered.
3. A grid or CSS column update that sets the left panel track to 0 and lets the center/workbench track reflow immediately.

For Honk, `LeftAside` should not only hide its contents on fullscreen. The shell layout should collapse the `LeftAside` width to `0` on fullscreen entry, cache the prior width for restoration, and update the center/workbench container in the same transaction. A good local analogue would be:

```text
fullscreen enters
  shell state: leftAsideHidden = true
  root class: .honk-shell--no-left-aside
  layout: left aside track width = 0
  cache: previous left aside width retained
  center: reflows into the freed width immediately
```

Cursor's evidence for this is the pair of operations below. The class hides the sidebar DOM. The grid visibility change removes the sidebar from geometry:

Evidence:

`.monaco-workbench.nosidebar>.part.sidebar{display:none!important;visibility:hidden!important}`

`this.workbenchGrid.setViewVisible(this.sideBarPartView,!e)`

# 8 Open questions/not-found

- `activity-bar`: not found. Cursor uses `activitybar`.
- `SIDE_BAR_WIDTH`: not found. The preserved width identifiers are `SIDEBAR_WIDTH`, `cursor/editorLayout.sidebarWidth`, `cursor/agentLayout.sidebarWidth`, and `Bu.SIDEBAR_SIZE`.
- `sidebar-title`: found only in marketplace editor UI, not the primary sidebar. The primary sidebar title uses `.part.sidebar > .title > .title-label h2`.
- Exact localized labels behind several `N(...)` calls were not resolved. The preserved command IDs and class names were enough for this slice.
- The state model class that maps `Bu.SIDEBAR_SIZE` to the storage enum was not fully deminified. The save/load call sites prove the operational flow, and the storage enum proves the persisted key names.
- `global-actions` is present in pane composite title bars. The activity bar bottom actions use `IFt` with a vertical `globalActivityActionBar`, plus `workbench.actions.accounts` and `workbench.actions.manage`.
