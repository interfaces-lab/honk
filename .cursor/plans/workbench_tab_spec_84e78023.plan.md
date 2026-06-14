
---
name: Workbench Tab Spec
overview: Cursor Glass workbench tab strip spec grounded in reverse-engineered entry points (services, events, components, registry). Honk migration map references real files only — no mock APIs.
todos:
  - id: cursor-entry-audit
    content: "Document Honk→Cursor entry-point parity matrix: every Honk setActiveTab/activate* call site mapped to the Cursor glassTabPersistenceService / NewTabMenu / tab-manager path it should become"
    status: pending
  - id: tab-manager-store
    content: "Implement Honk tab manager mirroring Cursor VNf + glassTabPersistenceService split (manager owns tabs/activeTabId/events; persistence service owns create*Tab ops) — names aligned to behavior not minified symbols"
    status: pending
  - id: o7e-bar-ui
    content: "Replace RightWorkbenchHeader icon switcher with O7e.Bar equivalent: tab cluster (labeled pills) + TrailingSection (+ menu, fullscreen, hide panel) wired through event bridge not prop threading"
    status: pending
  - id: registry-renderers
    content: "Lift shell-host panel map into kind→renderer registry (Cursor Imf/O7e pattern) with mount flags alwaysMounted / keepMountedAfterFirstActivation"
    status: pending
  - id: flatten-sessions-urls
    content: "Route terminal sessions, browser URLs, and open files through persistence create*Tab entry points; remove conditional terminal pills from header"
    status: pending
isProject: false
---

# Cursor Glass Workbench Tabs — Entry-Point Spec (Honk migration reference)

**Scope:** Cursor **Agents Window / Glass** right editor panel (`O7e` tab system), not the legacy VS Code auxiliary-bar icon switcher.

**Sources:** [`docs/cursor-agent-window-implementation-notes.html`](docs/cursor-agent-window-implementation-notes.html), [`docs/cursor-agent-window-reimplementation-notes.html`](docs/cursor-agent-window-reimplementation-notes.html), [`docs/cursor-shell-research/04-auxiliarybar-editor-composer.md`](docs/cursor-shell-research/04-auxiliarybar-editor-composer.md), user screenshot (active browser pill + ghost terminal + ghost file).

**User target:** Glass **flat** labeled tab row (2026 behavior). Retire Honk icon-only `WorkbenchTab` switcher as primary navigation.

**Explicitly NOT in this doc:** Honk mock types, pseudocode registries, or invented `openSurfaceTab()` APIs. Honk work is described as **which Cursor entry point each Honk file must route through**.

---

## 0. Two Cursor products (do not conflate)

| Surface | How users open it | Tab strip |
|---|---|---|
| **Classic Editor Window** | Command palette → Open Editor Window | VS Code editor tabs (center) + auxiliary bar view tabs (chat pane) — **separate surfaces** |
| **Agents Window / Glass** | Default Cursor 3+ agent UI | **Single `O7e` tab strip** in right editor panel: browser, terminal, file, diff, agent chats |

Honk right workbench should match **Glass `O7e`**, not VS Code `workbench.parts.auxiliarybar` composite icons.

---

## 1. Cursor component tree (actual symbols)

From `workbench.desktop.main.js` reverse-engineering (offsets in implementation-notes §07):

```
OPI GlassRoot
└─ DSI EditorPanelResizeShell          @58,663,412
   └─ BSI EditorPanelMainShell         @58,667,485
      └─ div.editor-panel-inner
         └─ O7e.Root                    @57,745,878  (Imf factory instance)
            └─ O7e.Group id=workspace group
               ├─ O7e.Bar
               │  ├─ .editor-panel-tab-bar-tab-cluster   ← flex:1 scrollable
               │  │  ├─ Gk  leading (W4v Search/AgentSwitcher, p5k New Agent) — agent chrome
               │  │  ├─ zS  ISI agent title-tab
               │  │  ├─ $p  StableTabs (Environment / Changes / Vnc) when sidebar folded
               │  │  └─ O7e.Tabs sections=[workspace, agent]   ← **your screenshot row**
               │  └─ O7e.TrailingSection
               │     ├─ zo   connection status
               │     ├─ Al   reconnect banner
               │     ├─ Ic→_SI  New Tab + menu
               │     ├─ jc   remote port-forward (remote only)
               │     ├─ $o   fullscreen toggle
               │     └─ eu=YLp  hide/show right panel
               └─ O7e.Content   kind→renderer dispatch, hidden not unmounted
```

**DOM classes (stable literals for re-anchoring):**
- `.editor-panel-tab-root[data-variant="simple-tabs"]`
- `.editor-panel-tab-bar-tab-cluster`
- `.ui-tab-system` / `.ui-tab-system-tab`
- `.editor-panel-tab-header-row` — per-panel 36px subchrome (KDp @56,490,984)
- `.glass-editor-panel-new-tab-menu-trigger` — `+` button

---

## 2. Cursor state owners (actual services)

| Service | Minified | Owns | Subscription |
|---|---|---|---|
| **Tab manager** | `VNf` | `tabs[]`, `stableTabs`, `activeTabId` per group | `subscribe(type, cb)`, `subscribeAll(cb)` |
| **Tab persistence** | `glassTabPersistenceService` | High-level create/activate ops | Consumers call ops; subscribe via `.manager.subscribeAll` |
| **Layout** | `glassLayoutService` (`LJ()` / `hPI`) | `editorPanelVisible`, `editorPanelFullscreen`, widths | `onDidChange` → `uxe(selector)` |
| **Command bridge** | `glassCommandBridgeService` (`Jd` / `YOg`) | 88 typed events, deferred replay | `emit` / `Ap()` hook |

**Tab manager events** (filter before React notify):
- `TAB_LIST_EVENTS` + `payload.groupId === myGroup` → tab bar re-render
- `activeTabIdChanged` → toolbar/fullscreen slice only
- Per-tab dirty events filtered by `payload.tabId`

**Layout atomic recompute** (`_recomputeAndEmit`):
1. Build immutable snapshot
2. Sync keybinding context keys (`glassEditorPanelVisible`, `glassEditorPanelFullscreen`, …)
3. Fire `onDidChange` for `uxe` consumers

---

## 3. Tab kind registry (actual `O7e = Imf({…})`)

From reimplementation-notes §3.3 @57745878:

| Kind enum `Ri.*` | Icon | Renderer | Mount flags |
|---|---|---|---|
| `Ri.Terminal` | `terminal` | `OnI` | default |
| `Ri.Browser` | `globe` | `AJA` (+ `iconRenderer:IJA`) | `alwaysMounted:true` |
| `Ri.File` | `file` | `sWA` (+ `iconRenderer:cWA`) | `alwaysMounted:true` |
| `Ri.Gallery` | `compass` | `vtI` | — |
| `Ri.Plan` | `list-todo` | `FtI` | — |
| `Ri.EnvironmentSetup` | `settings-gear` | … | stable |
| `Ri.Diff` | `git-branch` | `KLk` | `alwaysMounted:true` |
| `Ri.Pr` | `github` | `v6A` | `keepMountedAfterFirstActivation:true` |
| `Ri.Canvas` | `layers` | `$JA` | `alwaysMounted:true` |
| … | | | 14 kinds total |

**Content mount formula (confirmed):**
```
mountList = stableTabs ∪ {active} ∪ {alwaysMounted} ∪ {keepMounted & visited}
per tab: <div role=tabpanel hidden={!active}> renderer(tab.props) </div>
```

---

## 4. Entry-point catalog (how tabs actually get opened)

### 4.1 Primary UI entry: `+` New Tab menu (`_SI` @58650243)

**Trigger chain:**
1. User clicks `Vc` IconButton (`icon:"plus"`, `aria-label:"Open new tab menu"`, class `glass-editor-panel-new-tab-menu-trigger`)
2. **Does NOT** call persistence directly from button
3. Cross-tree: button `emit("editorPanelNewTabMenuRequested")` via `glassCommandBridgeService`
4. Header `Ap()` listener sets local `open` state → only menu subtree re-renders

**Menu component `_SI` props (actual):**
- `workspace`, `automationService`, `shortcutLabel`
- `onActivateChanges`
- `onCreateBrowserTab`, `onCreateCanvasTab`, `onCreateFileTab`, `onCreateTerminalTab`
- `onNavigateToUrl`, `onOpenFile`
- `onOpenChange`, `open`

**Empty-query menu registry `aSI` @58642769 (fixed menu order, not strip order):**
1. Changes (`git-branch`)
2. Terminal (`terminal`)
3. Browser (`globe`)
4. File (`file`)
5. Canvas (`layers`)

**With-query routing (`yUk` results):**
- URL-like input → `onNavigateToUrl` → browser tab via persistence
- Fuzzy file match → `onOpenFile` → file tab
- Web suggestions (when enabled)

**Persistence layer (named in implementation-notes, invoked by `onCreate*` handlers):**
- `glassTabPersistenceService.createTerminal(...)`
- `glassTabPersistenceService.createBrowser(...)`
- `glassTabPersistenceService.createFile(...)`
- `glassTabPersistenceService.createCanvas(...)`
- `glassTabPersistenceService.activateDiffTab(...)`
- `activateChanges` path for Changes stable tab

### 4.2 Tab strip interactions (`O7e.Tabs`)

| User action | Handler layer | Effect |
|---|---|---|
| Click tab pill | Tab manager `activateTab(tabId)` | `activeTabIdChanged` event; `O7e.Content` toggles `hidden` |
| Close tab (hover `×`) | Tab manager `closeTab(tabId)` | Removes from `tabs[]`; neighbor activation |
| Drag tab | Tab manager reorder | **Inferred** — reimplementation-notes: "closable, draggable, renameable" |
| Double-click tab | `setEditorPanelFullscreen(true, { source: "double_click_tab" })` | Maximize active surface |

### 4.3 Trailing chrome entry points

| Control | Symbol | Action | Entrypoint param |
|---|---|---|---|
| Fullscreen | `$o` | `layoutService.setEditorPanelFullscreen(true/false, …)` | `entrypoint:"editor_panel_header"` |
| Hide panel | `YLp` | `toggleEditorPanelByUserIntent` | `variant:"hide"` |
| Port forward | `WwI` | remote only | — |

**Keybinding context** (layout service sets): `editorPanelVisible`, `editorPanelFullscreen`, `editorPanelFullscreenAllowed`.

### 4.4 Non-menu entry points (inferred from persistence service surface)

These call **`glassTabPersistenceService`** methods directly (not through `_SI`):
- Tool/command palette actions that open terminal, browser, or file
- Clicking a git change → `activateDiffTab`
- Plan implementation flow → `Ri.Plan` renderer
- Agent conversation open → agent section of `O7e.Tabs` (separate from workspace tabs)

*Exact command IDs for each non-menu path are not fully extracted in docs — re-anchor in bundle via `glassTabPersistenceService` string literals.*

### 4.5 Classic Editor Window (out of scope but referenced)

Opening composer from palette:
```
setPartHidden(false, "workbench.parts.auxiliarybar")
createComposer({ view:"pane", unifiedMode:"agent", openInNewTab:true })
```
Source: [`docs/cursor-shell-research/04-auxiliarybar-editor-composer.md`](docs/cursor-shell-research/04-auxiliarybar-editor-composer.md)

This is **not** the Glass `O7e` strip Honk is targeting.

---

## 5. Ordering and stacking (confidence-rated)

| Rule | Confidence | Cursor evidence | Honk default |
|---|---|---|---|
| User-visible strip is **flat** (no type clusters) | **Confirmed** (2026) | Forum + user screenshot; internal `sections=[workspace,agent]` still exists but type-grouping removed | Flat single scroller |
| Menu empty-query order ≠ strip order | **Confirmed** | `aSI` registry fixed; strip is dynamic | Menu order independent |
| New tab insert position | **Unknown** | Not in public docs; persistence service not fully disassembled for insert index | **Defer:** instrument Cursor or bundle-slice `glassTabPersistenceService.create*` before coding |
| Dedupe on re-open (same URL/path/session) | **Inferred** | Standard IDE behavior; persistence named `create*` implies activate-if-exists | Dedupe by normalized URL, relative path, terminal session id |
| Stable tabs pinned left | **Confirmed** | `$p StableTabs` before `O7e.Tabs` in cluster | `changes`, `plan` as StableTab analog |
| Drag reorder persisted | **Inferred** | "draggable" in §05; no public persistence key documented | Persist `tabOrder[]` per workspace when drag ships |
| Agent tab LRU cap (default 5) | **Confirmed** (agent section) | Cursor settings "Max Tab Count" | Defer — Honk agents not in strip yet |

---

## 6. Visual spec (actual Cursor CSS, not Honk mock)

From reimplementation-notes §7 + implementation-notes §04:

**Tab pill (`.ui-tab-system-tab`):**
- Height: `barHeight - 2×5px` = **25px** inside **35px** bar (`--tab-system-height: 35px`)
- Padding: `0 8px`; margin-right `1px`; max-width `200px`
- Radius: `--cursor-radius-base` (~6px)
- Inactive: transparent bg, `--cursor-text-tertiary`
- Hover: `--cursor-bg-card`, primary text, label fade mask on long titles
- Active (`data-active`): `--cursor-bg-quaternary` fill, primary text
- Focus: `box-shadow: inset 0 0 0 2px var(--cursor-stroke-focused)`
- Close: `opacity:0` until `data-hovered`

**Browser tab icon:** default `globe`; `iconRenderer:IJA` separate from body renderer (favicon slot exists in architecture; live favicon update **unverified** in public docs).

**Trailing `+` / fullscreen:** IconButton `Vc` size `lg` = **24×24px**; gap **1px** between actions.

**Honk token mapping (already mostly present):** see [`packages/app/src/styles/shell.css`](packages/app/src/styles/shell.css) `--honk-workbench-tab-height`, [`packages/honkkit/src/tabs.tsx`](packages/honkkit/src/tabs.tsx) workbench variant. Gap: `--honk-bg-card` hover alias.

---

## 7. Honk today — actual entry points (contrast)

Honk does **not** have `glassTabPersistenceService` or `O7e.Tabs`. It has a **panel-kind switcher**:

| Honk entry | File | What it does today |
|---|---|---|
| Click icon tab | [`app.tsx`](packages/app/src/components/shell/shell/app.tsx) `TabsRoot.onValueChange` | `shellPanelsActions.setActiveTab(WorkbenchTab)` |
| URL `?panel=` | [`app.tsx`](packages/app/src/components/shell/shell/app.tsx) | `setActiveTab(searchActiveTab)` |
| Open terminal from chat | [`chat-view.tsx`](packages/app/src/components/chat/view/chat-view.tsx) | `setActiveTab("terminal")` + `setActiveTerminal` |
| Open plan | [`shell-host.tsx`](packages/app/src/components/shell/shell-host.tsx), [`chat-view.tsx`](packages/app/src/components/chat/view/chat-view.tsx) | `activatePlanTab` → `setActiveTab("plan")` |
| Open dev workbench | [`command-palette.tsx`](packages/app/src/components/command-palette.tsx) | `activateDevTab` |
| Open files from center editor | [`project-center-editor-surface.tsx`](packages/app/src/components/shell/files/project-center-editor-surface.tsx) | `setActiveTab("files")` |
| Terminal session click | [`right-workbench-header.tsx`](packages/app/src/components/shell/shell/right-workbench-header.tsx) | `setActiveTerminal(id)` — **only when `activeTab==="terminal"`** |
| New terminal `+` | [`right-workbench-header.tsx`](packages/app/src/components/shell/shell/right-workbench-header.tsx) | `onNewTerminal` |
| Panel registration | [`shell-host.tsx`](packages/app/src/components/shell/shell-host.tsx) | Static `panels: Record<WorkbenchTab, ReactNode>` |

**State owners (Honk):**
- [`shell-panels-store.ts`](packages/app/src/stores/shell-panels-store.ts) — `activeTab`, `terminalByWorkspaceKey`, `browserByWorkspaceKey`
- [`workspace-editor-store.ts`](packages/app/src/stores/workspace-editor-store.ts) — single `activePath` (not a tab list)

**Visual:** [`right-workbench-header.tsx`](packages/app/src/components/shell/shell/right-workbench-header.tsx) — icon-only `data-stable` tabs; [`TerminalSessionTab`](packages/app/src/components/shell/shell/right-workbench-header.tsx) is the only labeled-pill precedent.

---

## 8. Honk migration map (Cursor entry point → Honk file)

No new mock APIs. Each Cursor entry point must gain a **real Honk equivalent**:

| Cursor entry | Honk file(s) to change |
|---|---|
| `O7e.Bar` + tab cluster | [`right-workbench-header.tsx`](packages/app/src/components/shell/shell/right-workbench-header.tsx), [`right-workbench-tool-island.tsx`](packages/app/src/components/shell/shell/right-workbench-tool-island.tsx) |
| `O7e.Tabs` labeled pills | New tab bar component; retire `ToolIconButton` / `WorkbenchTabList` icon row |
| `O7e.Content` dispatch | [`app.tsx`](packages/app/src/components/shell/shell/app.tsx) `RightAsidePanels` + [`shell-host.tsx`](packages/app/src/components/shell/shell-host.tsx) registry |
| `Imf` kind registry | Lift [`shell-host.tsx`](packages/app/src/components/shell/shell-host.tsx) panel map into kind→renderer table with mount flags |
| `glassTabPersistenceService.create*` | New persistence module + store; **replace** direct `setActiveTab` at all call sites listed in §7 |
| `VNf` tab manager events | Store with filtered subscriptions (avoid header re-render on tab body dirty) |
| `editorPanelNewTabMenuRequested` | Small event bridge in app shell (optional but matches Cursor decoupling) |
| `_SI` / `aSI` menu | Wire to Honk command palette / file picker / browser URL normalize |
| `$o` fullscreen | Existing [`workspace-editor-store`](packages/app/src/stores/workspace-editor-store.ts) fullscreen + shell fullscreen layer |
| `YLp` hide panel | Existing `shellPanelsActions.setRightOpen` |
| Per-panel `KDp` subchrome | Keep in [`browser-subchrome.tsx`](packages/app/src/components/shell/browser/browser-subchrome.tsx), terminal/files/git toolbars |
| `TerminalSessionTab` UI | Generalize to all dynamic tab kinds (close-on-hover, icon+label) |

---

## 9. Phased implementation (entry-point driven)

### Phase 1 — Tab manager + persistence (Cursor `VNf` + `glassTabPersistenceService`)
- Add store with `tabs`, `activeTabId`, `stableTabs`, manager events
- Add persistence ops: `createTerminal`, `createBrowser`, `createFile`, `activateChanges`, `activateDiff`
- **Do not** build UI yet; redirect one call site (e.g. chat terminal open) through persistence

### Phase 2 — `O7e.Bar` UI
- Replace icon switcher with labeled `O7e.Tabs` analog
- Port `TerminalSessionTab` styling to all kinds
- Trailing: `+` emits menu-open event; fullscreen; hide panel

### Phase 3 — Flatten existing multi-instance state
- Terminal `sessions[]` → persistence `createTerminal` per session
- Browser `committedUrl` → `createBrowser` per URL tab (multi-webview)
- Files `activePath` → `createFile` per path

### Phase 4 — Ordering + drag
- Bundle-slice Cursor `create*` for insert index **before** guessing
- Add drag reorder + persist `tabOrder`

### Phase 5 — Cleanup
- Remove `WorkbenchTab` icon navigation, dead [`workbench-tabs.tsx`](packages/app/src/components/shell/shell/workbench-tabs.tsx)
- Remove debug `fetch` ingest in [`right-workbench-header.tsx`](packages/app/src/components/shell/shell/right-workbench-header.tsx) lines 151–163

---

## 10. Open research (required before coding insert order)

1. **Slice `glassTabPersistenceService.createBrowser/createTerminal/createFile`** in `workbench.desktop.main.js` via `indexOf("createBrowser")` window — extract insert-index logic
2. **List `TAB_LIST_EVENTS`** enum values from tab manager `VNf`
3. **Confirm favicon path:** `IJA` iconRenderer + webview/page events

---

## 11. Success criteria

- [ ] Opening terminal/browser/file from chat, palette, and `+` menu all route through **persistence create\*** (one code path)
- [ ] Strip shows **simultaneous** labeled tabs (screenshot parity)
- [ ] Active = quaternary pill; inactive = ghost
- [ ] Click/close/drag hit **tab manager**, not `setActiveTab(enum)`
- [ ] Visited tab bodies stay mounted (`hidden`, not unmounted)
- [ ] Subchrome remains per-renderer 36px row below strip

---

## Appendix: Subagent research (round 1)

- [Honk tab strip](a83907fb-c466-4c3c-bac0-4fe9647e6d17) — two-tier model, no DnD
- [cursor-shell-research](40d14e55-c2f3-414e-a628-e3f12106cff6) — auxiliary bar ≠ Glass tabs
- [Panel registration](980386f3-f2ad-48a2-af50-8aac16bb71f4) — static panel map gap
- [HonkKit primitives](c2c64943-29a6-487f-bbda-7c6c43ff5569) — pills exist; need text tab + DnD
- [External Cursor behavior](d123a396-b13f-4bec-9319-eb8230be6125) — flat 2026 layout confirmed

**Round 2 (user requested, interrupted):** Re-run 3 subagents after bundle-slice for `create*` insert logic.
