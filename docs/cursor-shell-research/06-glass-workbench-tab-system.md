# Glass Workbench Tab System Bundle Slice

Source: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`.

## Entry Points

- `O7e=Amf(...)` at byte `57750042` builds the editor-panel tab namespace.
- `O7e.Root` composition is under `.editor-panel-inner` at byte `58686652` through `58691613`.
- `VNf=zNf` at byte `16270606` is the exported tab-system manager.
- `Py=xi("glassTabPersistenceService")` at byte `29637742`; service class starts at byte `57785218`.
- `editorPanelNewTabMenuRequested` listener is at byte `58680008`; command emitters are at bytes `59269686` and `59270158`.

## Hierarchy

Cursor does not render the editor-panel row as independent buttons. It renders:

```text
div.editor-panel-inner
  O7e.Root className="editor-panel-tab-root" data-variant="simple-tabs"
    O7e.Group id="editor-panel-group" stable=true
      O7e.Bar rightInsetPx=0
        div.editor-panel-tab-bar-tab-cluster
          stable editor-panel controls
          O7e.Tabs sections=[workspace, agent]
        O7e.TrailingSection
          connection status, new-tab menu, fullscreen, hide
      O7e.Content
```

Stable DOM strings used by the row include `.ui-tab-system`, `.ui-tab-system-tab`, `.ui-tab-system-tabs__scrollable`, `.ui-tab-system-tabs__viewport`, `.ui-tab-system-drop-indicator`, `.editor-panel-tab-root`, `.editor-panel-tab-bar-tab-cluster`, and `.glass-editor-panel-new-tab-menu-trigger`.

## State Model

The manager owns tab order, active tab id, stable tab registration, and tab events. Relevant manager behavior:

- `_setActiveTabId` only emits `activeTabIdChanged` when the id changes.
- `_upsertRegular` inserts a new tab at a clamped target index; existing tabs update props in place and do not move.
- `moveTab` is the explicit reorder path and emits `tabMoved`.
- Closing picks the fallback active tab from previous regular, next regular, most recently active regular or stable, then first stable.

Cursor subscriptions are event filtered. The tab-list event set is equivalent to `tabPushed`, `tabClosed`, `tabPropsChanged`, `tabMoved`, dirty/label/icon changes, and stable registration changes. Active-id consumers subscribe separately.

React usage follows this split: manager snapshots are read through `useSyncExternalStore`; local UI state is reserved for transient hover/edit/scroll/menu state. Runtime tab availability such as file, terminal, and plan surfaces should not be manufactured by React effects when it can be derived from the current store inputs.

## Menu

The new-tab menu is opened by the `editorPanelNewTabMenuRequested` command event. The plus trigger is classed `.glass-editor-panel-new-tab-menu-trigger`; the popup is bottom-end with 4px offset, 280px width, and 720px max height.

Empty query order:

1. Changes
2. Terminal
3. Browser
4. File
5. Canvas

Selection routes through the persistence service: `activateDiffTab`, `createTerminal`, `createBrowserTab`, `createUntitledFileTab` or `activateFileTab`, and `createCanvasTab`.

## Implementation Consequences For Honk

- Keep stable tabs pinned and non-draggable; regular tabs live in one flat scrollable tablist.
- Preserve current order on tab prop updates. Only drag/drop should call a reorder action.
- Derive plan and terminal tab availability from current runtime inputs in the tab snapshot instead of synchronizing them from effects.
- Use the existing workbench menu primitive and class the new-tab popup like Cursor rather than adding a new menu surface.
- Use a visible drop indicator and horizontal scroll affordance on the regular tab viewport.
