---
name: Tool Call Density Parity
overview: Tool Call Density parity with Cursor using exactly three values (Detailed, Balanced, Compact). Legacy modes removed. Plan covers Cursor entry-point chain, Honk mapping, Phase 0 contract collapse, then renderer/grouping parity.
todos:
  - id: collapse-three-values
    content: "Phase 0: narrow ConversationDensity to 3 values; migrate at decode/hydrate + write-back (settings.ts, desktop-client-settings.ts, use-settings.ts); simplify predicates"
    status: completed
  - id: compact-shell-expand
    content: "Phase 3: Balanced/Compact shells need accordion expand to full output (today text-only ToolCallLine with no expand path)"
    status: completed
  - id: pending-approval-parity
    content: "Wire approval to tool-message.tsx; break groups on pending in deriveTimelineRenderItems; add integration tests"
    status: completed
  - id: header-explored-label
    content: "Phase 4: completed header uses summary.action (Explored/Edited) not generic Worked for; running header shows segment details"
    status: completed
  - id: doc-entry-points
    content: Add Cursor/Honk entry-point map to packages/app/ARCHITECTURE.md (Layer 0-6 with symbol equivalents)
    status: completed
  - id: predicate-parity
    content: Align conversation-density.ts predicates (pqb activity mode, yAm cross-type mixing) and extend timeline-render-items.test.ts matrix
    status: completed
  - id: tool-renderer-parity
    content: "Implement XJr/kRm parity in tool-renderer.tsx: detailed card vs compact line, 5-line shell preview, pending override, CSS in tool-call.css"
    status: completed
  - id: group-chrome-parity
    content: "Phase 4: running header stats/segments; loading-gated scroll; 144px strip already shipped — polish header parity only"
    status: completed
  - id: settings-preview
    content: Mount ToolCallDensityPreview in appearance-settings-panel.tsx below slider
    status: completed
  - id: tray-renderStep
    content: "Phase 6: restore taskToolCall ToolCallRenderer path; wire renderStep; narrow SubagentActivityLine fallbacks per inventory"
    status: completed
isProject: false
---

# Tool Call Density Parity — Cursor Entry Points and Honk Implementation Plan

## What this plan covers

This plan turns the reverse-engineered Cursor research into an actionable parity roadmap. The **entry point** is not a single function — it is a **layered pipeline** with two runtime paths in Cursor (Glass transcript vs legacy step list) that converge on the same density predicates and renderers.

**Product decision (locked):** Honk supports exactly **three** density values — the same stops as the settings slider. No legacy modes.


| Slider label      | Stored value          | Behavior                               |
| ----------------- | --------------------- | -------------------------------------- |
| Detailed (right)  | `detailed`            | Full edit/shell cards; no grouping     |
| Balanced (middle) | `compact-ungrouped`   | Compact edit/shell lines; no grouping  |
| Compact (left)    | `compact-all-grouped` | Compact edit/shell lines; grouped runs |


**Removed from Honk:** `compact-shells`, `compact-grouped`, `verbose`, `minimal`. Cursor still has these internally (`XBn` aliases, 5-stop `G8i`); we mirror only the **current 3-stop user-facing behavior**, not Cursor's legacy enum.

---

## Cursor entry point chain (reference architecture)

### Layer 0 — Constants and storage


| Symbol        | Value                                       | Role                                       |
| ------------- | ------------------------------------------- | ------------------------------------------ |
| `HFr`         | `cursor.composer.conversationDensity`       | Primary user setting key                   |
| `vSm`         | `cursor.composer.editorConversationDensity` | Editor-specific override                   |
| `VFr` / `b3n` | `compact-all-grouped`                       | Default when unset                         |
| `M9t`         | `detailed`                                  | Effective density when feature flag is off |
| Feature flag  | `conversation_density_setting`              | Gates slider UI and runtime reads          |


Cursor still normalizes legacy stored values via `XBn` (`verbose`, `minimal`, `compact-shells`, `compact-grouped`). **Honk does not** — persisted settings are migrated once to the nearest of the three values above, then only those three are valid at runtime.

**Binary location:** `[/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js](/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js)`

---

### Layer 1 — Settings UI mount

```
jTA(n, e)                              // hidden DOM React root for settings tab
  └─ ITk("appearance", rootWorkspace)
       └─ ETA({ rootWorkspace })       // Appearance panel
            ├─ sv("conversation_density_setting")   // feature flag gate
            ├─ VHn(HFr, VFr)          // [value, setter]
            ├─ XBn(U) → H             // normalize stored value
            └─ ATA({ onSelect, selectedOptionId: H })  // slider (G8i has 5 internal stops; user-facing is 3)
```

**Ownership:**

- `ETA` — mounts "Tool Call Density" row; label + description; analytics
- `ATA` — slider UI: Compact (left), Balanced (middle), Detailed (right) — **this 3-stop UX is what Honk implements**
- `VHn` — reads/writes `configurationService` for `HFr`

**Start here in Cursor binary:** search `ETA` / `ATA` / `conversation_density_setting`.

---

### Layer 2 — Config read (runtime)

Three readers, same key `HFr`:


| Function              | Mechanism                                           | Used where                     |
| --------------------- | --------------------------------------------------- | ------------------------------ |
| `VHn(n, e)`           | workspace config get/set                            | Settings (`ETA`)               |
| `s8(n, e, t, "user")` | `configurationService` + `onDidChangeConfiguration` | `GMS()` reactive hook          |
| `Cjt(n)`              | read-only reactive `getValue`                       | Glass transcript mount (`qDp`) |


**Runtime resolvers:**

```
$MS()  → wb("conversation_density_setting")

GMS()  → s8(HFr, …, VFr) + s8(vSm, …, ySm)
         → XBn(isGlass ? agentDensity : editorDensity)

f4o()  → $MS() ? GMS() : M9t("detailed")

WMS()  → isGlass ? GMS() : Iex(collapseAutoRunCommands)
         // non-glass terminal-compact path — out of scope for Honk (no compact-shells mode)
```

**Glass transcript bootstrap (`qDp`):**

```js
H = sv("conversation_density_setting")
z = Cjt(HFr)
V = H ? XBn(z ?? VFr) : M9t
// passed as conversationDensity:V → KoI
```

**Start here for runtime:** `f4o`, `GMS`, `Cjt`, `qDp`.

---

### Layer 3 — React context (density distribution)

```
F5r({ conversationDensity, copyToClipboard, onFileClick, …, children })
  ├─ XBn(conversationDensity) → normalized value
  └─ Kkf.Provider value={…conversationDensity:v, …}

SCe() → Nc(Kkf)   // hook: { conversationDensity, … }
```

**Mount sites:**

- Glass: `YoI` → `$(F5r, { conversationDensity: i, … })`
- Step list: `VPm` → optional `$(F5r, { conversationDensity: b, … })`

**Ownership:** Every downstream renderer calls `SCe()` — density is **context-only**, not passed as props to `MRm`.

**Start here for consumers:** `F5r`, `SCe`, `Kkf.Provider`.

---

### Layer 4 — Transcript / timeline build

**Export alias:** `buildAgentTranscriptRows` → `aof`

**Glass path (primary):**

```
qDp
  └─ KoI({ conversationDensity: V, … })
       └─ YoI
            ├─ M = getHeaderEntries(headers)
            ├─ aof(M, { conversationDensity: i, workGrouping })
            ├─ IFk / RFk                    // tail status rows
            ├─ DoI (virtualizer)
            └─ F5r → scroll + soI → zPm per row
```

`**aof` density decisions:**

```
pqb(density) → activity grouping mode:
  compact-all-grouped → "all" (cross-lane)
  else → "lane"

cof(lane, density) → standalone vs grouped per lane:
  fileChange → !lqb(density)   // !Wot
  shell      → !cqb(density)   // !Hot
```

**Start here for row projection:** `aof`, `pqb`, `cof`, `zPm` (`AgentTranscriptRowView`).

---

### Layer 5 — Step grouping

**Export alias:** `groupSteps` → `NAm`

```
NAm(steps, options)
  ├─ conversationDensity from options (default b3n)
  ├─ isToolGroupable: tFn(toolCase, toolCall, density)
  ├─ zIb(step, hasPending, rules) → merge eligibility
  └─ output: single | group | browser-group | waiting-group
```

**Called from:** `LRm` → `ln(() => NAm(n, o), [n, o])` using `SCe().conversationDensity`

**Density predicates (decision layer):**


| Predicate           | Meaning                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `R6r(d)`            | `d !== "detailed"` → compact shells (`kRm` gets `compact: true`) |
| `I6r(d)` / `vQp(d)` | compact edits (`compact-ungrouped` and `compact-all-grouped`)    |
| `Wot(d)` / `Hot(d)` | group edits/shells only for `compact-all-grouped`                |
| `yAm(d)` / `_Am(d)` | mix edits + shells in same group only for `compact-all-grouped`  |
| `pqb(d)`            | activity lane `"all"` (Compact) vs `"lane"` (Detailed/Balanced)  |


**Pending approval override:** `MRm` forces `"detailed"` for edit/delete when `approval.status === "pending"`; shells force card path when pending.

**Start here for grouping:** `NAm`, `LRm`, `tFn`, `A4b` (group header + preview).

---

### Layer 6 — Per-step render (convergence point)

Two pipelines converge on `MRm`:

```mermaid
flowchart TD
  subgraph glassPath [Glass transcript path]
    qDp --> KoI --> YoI --> aof
    aof --> zPm
    zPm --> BRm --> cOb --> MRm
  end

  subgraph stepListPath [Legacy step list path]
    VPm --> LRm --> NAm
    NAm --> A4b
    A4b --> gof
    gof --> MRm
  end

  MRm --> XJr["XJr EditToolCallView"]
  MRm --> kRm["kRm ShellToolCallView"]
  MRm --> otherTools["pO / q5t / etc."]
```




| Symbol                      | Role                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `gof` (`UiStepRenderer`)    | Single-step type switch (assistant, thinking, tool-call)                                    |
| `MRm`                       | Tool-case router; reads `SCe().conversationDensity`                                         |
| `XJr` (`EditToolCallView`)  | Edit/delete: full card (Detailed) vs minimal line (Balanced/Compact)                        |
| `kRm` (`ShellToolCallView`) | Shell: full card + 5-line preview (Detailed) vs compact line (Balanced/Compact)             |
| `A4b`                       | Grouped-step collapsible header + `ui-step-group-preview` (max 144px, `autoScrollToBottom`) |


**Start here for per-tool UI:** `MRm` (switch on `tool.case`), then `XJr` / `kRm`.

---

### Cursor density behavior matrix (council-confirmed)


| Behavior            | Detailed                                          | Balanced (`compact-ungrouped`)                               | Compact (`compact-all-grouped`)  |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| Edit/delete UI      | Full card + collapsed diff preview + expand       | Minimal line + chevron-right; no inline preview until expand | Same renderer as Balanced        |
| Shell UI            | Full card + 5-line output preview + expand scroll | Compact collapsible line + accordion on expand               | Same as Balanced                 |
| Read/grep/glob/etc. | Line renderer (`pO`)                              | Same                                                         | Same                             |
| Edit grouping       | Ungrouped                                         | Ungrouped                                                    | Grouped (`Wot`)                  |
| Shell grouping      | Ungrouped                                         | Ungrouped                                                    | Grouped (`Hot`)                  |
| Cross-type mixing   | No                                                | No                                                           | Yes (`yAm`/`_Am`)                |
| Activity lane       | `"lane"`                                          | `"lane"`                                                     | `"all"`                          |
| Exploration tools   | Group when ≥3 steps                               | Group when ≥3 steps                                          | Group when ≥2 + shell/edit rules |
| Pending approval    | Forces detailed card                              | Forces detailed card                                         | Forces detailed card             |


**Key insight:** Balanced vs Compact differ primarily in **grouping chrome**, not per-tool renderers. Only Detailed changes edit/shell component shape vs compact modes.

---

## Preview windows (included)

The plan covers **four preview surfaces**. Cursor uses density to decide which appear collapsed vs only on expand.

| Preview | Cursor (`XJr` / `kRm` / `A4b`) | Densities | Honk today | Plan phase |
|---------|--------------------------------|-----------|-------------|------------|
| **Edit diff preview** | Collapsed `Bef` inline diff inside card; chevron expands to full diff | Detailed only (Balanced/Compact: line until expand) | `showCollapsedPreview` + `InlineToolDiff` in `tool-renderer.tsx` | Phase 3 |
| **Shell output preview** | `ui-shell-tool-call__output-preview` — ~5 lines, clipped; expand → full scroll | Detailed card only; Balanced/Compact use compact line, output on accordion expand | `STREAMING_TOOL_OUTPUT_PREVIEW_MAX_HEIGHT_PX` (90px today) + `data-shell-tool-call-output-preview` | Phase 3 — align line count + max-height with Cursor |
| **Grouped run preview strip** | `ui-step-group-preview` — grouped step tail, max **144px**, `autoScrollToBottom` while loading | Compact collapsed groups (any running group with preview steps) | `WorkGroupPreview` — **144px + scroll-follow already shipped**; gaps: running header stats, loading-gated scroll semantics | Phase 4 — header polish, not strip infra |
| **Settings live preview** | `ATA` slider shows sample edit + shell at selected density | All three stops | `ToolCallDensityPreview` built + tested but **not mounted** in appearance panel | Phase 5 |

**Explicitly out of scope (density-agnostic, no change):** read/grep/glob line renderers and hover file lists (`pO` / `q5t`) — same at all three densities.

### Group header → preview hierarchy (Exploring / Thinking)

Collapsed Compact groups have **two layers**: a summary header (`A4b` / `WorkGroupHeaderButton`) and an optional live preview strip (`WorkGroupPreview`). Your mental model is right: an **Exploring** group can contain **thinking** steps inside its preview.

```text
deriveTimelineRenderItems(entries, density)
  flush grouped run → GroupedSteps {
    steps[], summary, isThinkingGroup, isCommandGroup, isRunning, ...
  }

render GroupedStepsRenderer(row, expanded=false, isRunning=true)
  │
  ├─ WorkGroupHeaderButton(summary)
  │    if isThinkingGroup:
  │      running  → "Thinking"                    // Cursor: thinking-only group
  │      complete → "Thought for {duration}"
  │    else if explorationSegments or explore tools:
  │      running  → "Exploring" only (details NOT in header today — gap)
  │      complete → summary says "Explored" BUT header shows "Worked for {duration}" (gap)
  │    else if edits:
  │      running  → "Editing" · "{file stats}"
  │    else:
  │      running  → "Exploring" | command summary // fallback
  │      complete → "Worked for {duration}" · "{details}"
  │
  └─ if isRunning && !expanded && previewStepCount > 0:
       WorkGroupPreview(row.steps)
         previewSteps = ALL eligible steps (not tail slice); scroll pins to bottom
           runtime-thinking  → include if thinking text non-empty
                                render: RuntimeThinkingStepRenderer (tertiary ChatMarkdown, NOT shimmer)
           runtime-tool/work → StepRenderer → ToolCallRenderer (density from hook)
           assistant message → include only if isShortPlainText (≤100 chars, ≤2 lines)
           tool.summary meta  → exclude
         lastRunningShellOrEdit = tail shell/edit with output while running
         for step in previewSteps:
           WorkGroupPreviewStep(step)
             render step line
             if step == lastRunningShellOrEdit:
               CompactToolOutputStrip(output, loading)  // max 90px (5×18px)
         scrollHost.scrollTop = scrollHeight on layout + ResizeObserver
         maxHeight = 144px (WORK_GROUP_PREVIEW_PX — already in conversation.css)
         header shimmer (data-group-loading) applies to header only, not thinking in strip
```

**Density interaction with Exploring groups:**

```text
shouldCollapseGroupedRun(steps, density):
  if allThinking(steps):
    return shouldGroupUnifiedSteps(steps)   // thinking-only groups at any density
  if !shouldGroupToolCalls(density):        // detailed + balanced
    return false                              // NO explore/shell/edit collapse today
  // compact-all-grouped only below:
  exploreOnly = !hasThinking && every(step is explore OR short narration)
  minSize = exploreOnly ? max(1, 3) : 1       // runtime explore-only needs 3 reads
  // work-log explore-only groups at 2 (timelineMinGroupSize) — runtime/work split
  // shell/edit work groups: timelineMinGroupSize(density) => 2 at compact

isPreviewableWorkGroupStep(step):
  // Preview content is NOT density-gated — density gates whether the group exists collapsed
  thinking  → previewable if text present
  tools     → previewable (compact/detailed rendering comes from ToolCallRenderer + density)
  long text → not previewable (released to standalone row)
```

**Cursor equivalents:** `summarizeGroupedRun` action selection (`Exploring`/`Explored`), `isThinkingGroup` all-thinking runs, `A4b` preview children via `eif` → `renderStep`, `zIb` merge rules keeping thinking before tools in same group.

**Honk files:** [`timeline-render-items.ts`](packages/app/src/components/chat/timeline/timeline-render-items.ts) (`formatExploringSummary`, `isPreviewableWorkGroupStep`, `RUNTIME_EXPLORE_ONLY_MIN_GROUP_SIZE`), [`step-renderer.tsx`](packages/app/src/components/chat/timeline/step-renderer.tsx) (`GroupedStepsRenderer`, `WorkGroupPreview`, `WorkGroupPreviewStep`).

**Preview rules by density (implementation checklist):**

- **Detailed:** edit card shows collapsed diff preview; shell card shows clipped output window before expand
- **Balanced / Compact:** no inline edit diff or shell output until user expands (chevron-right → full body)
- **Compact grouped:** collapsed group header shows `WorkGroupPreview` tail strip with auto-scroll during active run
- **Pending approval:** always detailed card previews (no compact/minimal path)

---

## Honk entry point chain (implementation target)

### Layer 0 — Constants and storage


| Cursor       | Honk equivalent                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `HFr`        | `[packages/contracts/src/settings.ts](packages/contracts/src/settings.ts)` — `conversationDensity` (three values only) |
| `XBn`        | **Removed** — no legacy alias layer; one-time migration in `normalizeConversationDensity` or settings decode           |
| Valid values | `USER_CONVERSATION_DENSITY_VALUES`: `detailed`, `compact-ungrouped`, `compact-all-grouped`                             |
| Feature flag | **Not implemented** — Honk always exposes slider and always applies stored density                                    |


---

### Layer 1 — Settings UI

```
settings.appearance route
  └─ AppearanceSettingsPanel
       └─ ToolCallDensitySlider
            ├─ toUserConversationDensity (read)
            └─ updateSettings({ conversationDensity }) (write)
```

**Files:**

- `[packages/app/src/routes/settings.appearance.tsx](packages/app/src/routes/settings.appearance.tsx)`
- `[packages/app/src/components/settings/appearance/appearance-settings-panel.tsx](packages/app/src/components/settings/appearance/appearance-settings-panel.tsx)`
- `[packages/app/src/components/settings/tool-call-density-control.tsx](packages/app/src/components/settings/tool-call-density-control.tsx)`

**Gap:** `ToolCallDensityPreview` exists in `tool-call-density-control.tsx` but is **not mounted** in the appearance panel (Cursor shows live preview in settings).

---

### Layer 2 — Config read

```
useSettings(selector)
  └─ useConversationDensity()
       └─ normalizeConversationDensity(settings.conversationDensity)
```

**Files:**

- `[packages/app/src/hooks/use-settings.ts](packages/app/src/hooks/use-settings.ts)` — `persistClientSettings` → IPC `setClientSettings`
- `[packages/app/src/hooks/use-conversation-density.ts](packages/app/src/hooks/use-conversation-density.ts)`
- `[packages/desktop/src/ipc/methods/client-settings.ts](packages/desktop/src/ipc/methods/client-settings.ts)`

**Gap vs Cursor:** No feature-flag fallback to `detailed`; no separate editor/glass keys; no `WMS` terminal-compact path.

---

### Layer 3 — Context distribution

**Cursor:** `F5r` / `SCe()` — single provider, all renderers consume context.

**Honk:** Hook + prop pattern — density read in multiple places:


| Consumer                                                                                   | Mechanism                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `[messages-timeline.tsx](packages/app/src/components/chat/timeline/messages-timeline.tsx)` | `useConversationDensity()` → grouping                   |
| `[tool-message.tsx](packages/app/src/components/chat/message/tool-message.tsx)`            | `useConversationDensity()` → prop to `ToolCallRenderer` |
| Settings preview                                                                           | Explicit `conversationDensity` prop                     |


**Gap:** No `AgentConversationProvider` equivalent; two independent subscriptions instead of one context tree.

---

### Layer 4 — Transcript build

```
chat-view.tsx
  └─ useThreadTimeline()
       └─ projectThreadTimeline()     // density-agnostic
            └─ MessagesTimeline
                 └─ deriveMessagesTimelineRows()
                      └─ deriveTimelineRenderItems({ conversationDensity })
```

**Files:**

- `[packages/app/src/components/chat/view/chat-view.tsx](packages/app/src/components/chat/view/chat-view.tsx)`
- `[packages/app/src/components/chat/view/use-thread-timeline.ts](packages/app/src/components/chat/view/use-thread-timeline.ts)`
- `[packages/app/src/components/chat/view/thread-timeline-projector.ts](packages/app/src/components/chat/view/thread-timeline-projector.ts)` — **no density** (by design)
- `[packages/app/src/components/chat/timeline/timeline-rows.ts](packages/app/src/components/chat/timeline/timeline-rows.ts)`
- `[packages/app/src/components/chat/timeline/timeline-render-items.ts](packages/app/src/components/chat/timeline/timeline-render-items.ts)` — **density-aware grouping**

**Cursor equivalent:** `aof` + `pqb` + `cof` → Honk's `deriveTimelineRenderItems` + `shouldGroupEdits`/`shouldGroupShells`/`shouldGroupToolCalls`.

---

### Layer 5 — Grouping render

```
MessagesTimeline → TimelineRowBody
  ├─ kind: "work" → GroupedStepsRenderer (WorkGroupHeaderButton, WorkGroupPreview)
  └─ single step → StepRenderer
```

**File:** `[packages/app/src/components/chat/timeline/step-renderer.tsx](packages/app/src/components/chat/timeline/step-renderer.tsx)`

**Cursor equivalent:** `LRm` + `A4b` → `GroupedStepsRenderer` + `WorkGroupPreview`.

---

### Layer 6 — Per-tool render

```
StepRenderer → WorkStepRenderer / RuntimeToolStepRenderer
  └─ ToolCallMessage / RuntimeToolCallMessage
       └─ ToolCallRenderer
            ├─ resolveEffectiveToolCallDensity (pending → detailed)
            ├─ shouldUseCompactShells / shouldUseCompactEdits
            └─ switch(tool.case) → shell / edit / task / read / …
```

**Files:**

- `[packages/app/src/components/chat/message/tool-message.tsx](packages/app/src/components/chat/message/tool-message.tsx)`
- `[packages/app/src/components/chat/message/tool-renderer.tsx](packages/app/src/components/chat/message/tool-renderer.tsx)`
- `[packages/app/src/styles/tool-call.css](packages/app/src/styles/tool-call.css)`
- `[packages/app/src/styles/conversation.css](packages/app/src/styles/conversation.css)`

**Cursor equivalent:** `MRm` → `XJr` / `kRm` → `ToolCallRenderer` shell/edit branches.

**Gaps:**

- `renderStep` prop exists on `ToolCallRenderer` but `**tool-message.tsx` never passes it** (blocks nested subagent transcript parity)
- Tray fallback `[SubagentActivityLine](packages/app/src/components/chat/composer/subagents/subagent-tray.tsx)` bypasses `ToolCallRenderer` entirely

---

## Side-by-side entry point map


| Layer            | Cursor symbol                  | Honk file / symbol                                              | Parity status                          |
| ---------------- | ------------------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| Storage key      | `HFr`                          | `ClientSettings.conversationDensity`                             | OK                                     |
| Normalize        | `XBn`                          | `normalizeConversationDensity` (migrate-only, then identity)     | **Change** — drop legacy aliases       |
| Settings UI      | `ETA` + `ATA`                  | `AppearanceSettingsPanel` + `ToolCallDensitySlider`              | Partial (no preview)                   |
| Feature flag     | `conversation_density_setting` | —                                                                | Missing                                |
| Context          | `F5r` / `SCe`                  | `useConversationDensity` hook                                    | Architectural diff                     |
| Transcript rows  | `aof`                          | `projectThreadTimeline` (agnostic) + `deriveTimelineRenderItems` | OK split                               |
| Activity lane    | `pqb`                          | `shouldGroupToolCalls` + grouping in `timeline-render-items.ts`  | Verify `pqb` "all" vs "lane"           |
| Step grouping    | `NAm`                          | `deriveTimelineRenderItems`                                      | Partial (cross-type mixing, min sizes) |
| Group UI         | `A4b` / `LRm`                  | `GroupedStepsRenderer`                                           | Partial (preview strip done; header labels/stats) |
| Tool router      | `MRm`                          | `ToolCallRenderer`                                               | Partial                                |
| Edit UI          | `XJr`                          | `editToolCall` branch in `tool-renderer.tsx`                     | Partial (minimal vs card)              |
| Shell UI         | `kRm`                          | `shellToolCall` branch in `tool-renderer.tsx`                    | Partial (5-line preview detailed-only) |
| Pending override | `MRm` pending→detailed         | `resolveEffectiveToolCallDensity` exists; **not wired** from timeline | **Gap** — helper only, no `approval` prop |


---

## Implementation phases

### Phase 0 — Collapse to three-value model (do first)

**Goal:** One enum, one slider, one predicate surface. No `compact-shells`, `compact-grouped`, `verbose`, or `minimal` anywhere in runtime code.

**Contracts** — `[packages/contracts/src/settings.ts](packages/contracts/src/settings.ts)`:

- Set `ConversationDensity` = `UserConversationDensity` (the three literals only)
- Remove `compact-shells` and `compact-grouped` from `ConversationDensity` schema
- `DEFAULT_CONVERSATION_DENSITY` stays `compact-all-grouped`

**Shared predicates** — `[packages/shared/src/conversation-density.ts](packages/shared/src/conversation-density.ts)`:

- `normalizeConversationDensity`: accept only the three values at runtime; on read, map any persisted legacy value once:
  - `verbose`, `detailed` → `detailed`
  - `compact-shells`, `compact-ungrouped` → `compact-ungrouped`
  - `minimal`, `compact-grouped`, `compact-all-grouped` → `compact-all-grouped`
- Remove `compact-grouped` from `GROUPED_DENSITIES` / `COMPACT_EDIT_DENSITIES` sets (only `compact-all-grouped` groups; both compact modes use compact edits/shells)
- Simplify `toUserConversationDensity` to identity (or delete if redundant)
- Predicates become explicit three-way switches:
  - `shouldGroupEdits` / `shouldGroupShells` / `shouldGroupToolCalls` → true only for `compact-all-grouped`
  - `shouldUseCompactEdits` / `shouldUseCompactShells` → true for `compact-ungrouped` and `compact-all-grouped`

**Persistence migration** — `[packages/app/src/hooks/use-settings.ts](packages/app/src/hooks/use-settings.ts)` or client-settings decode:

- When loading settings, if `conversationDensity` is a legacy value, normalize and **write back** the canonical three-value form so disk state converges

**Tests** — `[packages/shared/test/conversation-density.test.ts](packages/shared/test/conversation-density.test.ts)`:

- Replace legacy-alias assertions with migration tests (legacy in → canonical out)
- Assert predicates only for the three values

**Verification:** `pnpm run typecheck`; fix any call sites still referencing removed literals.

---

### Phase 1 — Document and verify entry points (no behavior change)

Add an **Entry Point Map** section to `[packages/app/ARCHITECTURE.md](packages/app/ARCHITECTURE.md)` mirroring this plan's two chains. Annotate each Honk file with its Cursor symbol equivalent so future agents land in the right layer first.

**Verification:** `pnpm run typecheck` from repo root.

---

### Phase 2 — Predicate and grouping parity

**Target:** `[packages/shared/src/conversation-density.ts](packages/shared/src/conversation-density.ts)` + `[timeline-render-items.ts](packages/app/src/components/chat/timeline/timeline-render-items.ts)`

Align with Cursor predicates:

- Add `shouldMixEditAndShellGroups(density)` for `compact-all-grouped` only (`yAm`/`_Am`)
- Add `activityGroupingMode(density)` → `"all"` | `"lane"` (`pqb`)
- Wire `timelineMinGroupSize(2)` into `shouldGroupUnifiedSteps` for compact runtime shell/edit pairs (today only work-log path uses it)
- **Cursor parity decision:** explore ≥3 at Detailed/Balanced — Honk **does not** do this today (`shouldGroupToolCalls` gate). Document as intentional divergence OR add explicit subtask to change behavior + tests
- Pending approval: wire `approval` prop `tool-message.tsx` → `ToolCallRenderer`; add `zIb`-style break in grouping loop; correlate `PendingApproval` to tool rows

**Tests:** Extend `[timeline-render-items.test.ts](packages/app/src/components/chat/timeline/timeline-render-items.test.ts)` with matrix cases for all three user-facing densities.

---

### Phase 3 — Per-tool renderer parity (`MRm` / `ToolCallRenderer`)

**Target:** `[tool-renderer.tsx](packages/app/src/components/chat/message/tool-renderer.tsx)` + CSS


| Tool        | Detailed                                                                        | Balanced / Compact                                                         |
| ----------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Edit/delete | Full card, collapsed `InlineToolDiff`, chevron down/up expand                   | `ui-edit-tool-call--minimal` line, chevron-right, expand reveals full card |
| Shell       | `ToolCallShellRoot` card + 5-line output preview window + full scroll on expand | `ToolCallLine` compact + accordion body on expand                          |
| Pending     | Always detailed card path                                                       | Same override                                                              |


**Preview windows (Phase 3 detail):**

- Edit: `showCollapsedPreview` + `InlineToolDiff` only when `effectiveDensity === "detailed"` and not expanded
- Shell: 5-line clipped output in detailed card (`data-shell-tool-call-output-preview`); reconcile `STREAMING_TOOL_OUTPUT_PREVIEW_MAX_HEIGHT_PX` (90 today) with Cursor line-height math
- Expand: full scroll body on chevron; `autoScrollToBottom` while `loading` on detailed shell card

**CSS:** `[tool-call.css](packages/app/src/styles/tool-call.css)` — shell/edit preview clipping; group strip max-height 144px in Phase 4

---

### Phase 4 — Group chrome parity (`A4b` / `GroupedStepsRenderer`)

**Target:** `[step-renderer.tsx](packages/app/src/components/chat/timeline/step-renderer.tsx)`

**Already shipped:** 144px preview cap (`WORK_GROUP_PREVIEW_PX`), `conversation.css` `[data-work-group-preview]`, scroll-to-bottom, 90px nested output strip.

**Remaining:**
- Completed header: use `summary.action` (`Explored`, `Edited`, `Deleted`) instead of generic `"Worked for {duration}"`
- Running header: show `summary.details` segments + `WorkGroupStats` while loading (today details only when complete)
- Loading-gated auto-scroll semantics (today scrolls on any ResizeObserver tick while running)

---

### Phase 5 — Settings UX parity (`ETA` / `ATA`)

**Target:** `[appearance-settings-panel.tsx](packages/app/src/components/settings/appearance/appearance-settings-panel.tsx)`

- Mount `ToolCallDensityPreview` below slider (live edit + shell samples)
- Optional: add feature-flag gate if product wants Cursor's "flag off → detailed" behavior

---

### Phase 6 — Tray and nested subagent path (`O4b` / `taskToolCall`)

**Target:** `[tool-message.tsx](packages/app/src/components/chat/message/tool-message.tsx)`, `[subagent-tray.tsx](packages/app/src/components/chat/composer/subagents/subagent-tray.tsx)`

- Restore `RuntimeSubagentTaskMessage` → `ToolCallRenderer` for `taskToolCall` (today only `SubagentStatusSurface`, no density path)
- Wire `renderStep` from `StepRenderer` into `ToolCallRenderer` for nested subagent transcripts
- Tray fallback inventory (do not blanket-delete):
  - `StepRenderer` path for command/tool items — **keep** (already uses density)
  - `SubagentActivityLine` for running logs / unknown kinds — replace or narrow per subagent remediation plan
- Cross-reference `[.cursor/plans/subagent-ui-parity-remediation.md](.cursor/plans/subagent-ui-parity-remediation.md)`

---

## Density decision flow (implementation mental model)

```mermaid
flowchart TD
  settings["Settings: conversationDensity (3 values)"]
  normalize["normalize + migrate legacy on read"]
  hook["useConversationDensity"]

  settings --> normalize --> hook

  hook --> grouping["deriveTimelineRenderItems"]
  hook --> render["ToolCallRenderer"]

  grouping --> predicates["shouldGroupEdits / Shells / ToolCalls"]
  predicates --> groupUI["GroupedStepsRenderer"]

  render --> effective["resolveEffectiveToolCallDensity"]
  effective --> compact["shouldUseCompactEdits / Shells"]
  compact --> branches["shell / edit / read / task branches"]
```



---

## Council verification (10 subagents, 2026-06-10)

| # | Topic | Verdict | Action for plan |
|---|-------|---------|-----------------|
| 1 | Exploring/Thinking header labels | Exploring running OK; **Explored** wrong (shows "Worked for"); Thinking/Thought OK | Phase 4 header fix |
| 2 | Thinking inside Exploring preview | **CONFIRMED** — `isPreviewableWorkGroupStep` + `RuntimeThinkingStepRenderer` | Pseudocode updated |
| 3 | Phase 0 three-value collapse | Feasible; **decode-before-narrow** required | Phase 0 expanded |
| 4 | Grouping predicates | Explore min-3 compact-only; cross-type OK; `pqb`/`yAm` not explicit | Fix pseudo-code; drop or map `activityGroupingMode` |
| 5 | Edit/shell previews | Detailed OK; **compact shell has no expand** | New todo `compact-shell-expand` |
| 6 | Group preview strip | **144px already shipped** | Phase 4 reframed |
| 7 | Entry point chain | Mostly accurate; fix Layer 3 consumer count, exploration matrix | Doc fixes applied |
| 8 | Exploration density matrix | Detailed/Balanced **never** group explores | Removed wrong plan claims |
| 9 | Pending approval | Helper exists; **not wired**; no group break | New todo `pending-approval-parity` |
| 10 | Holistic completeness | Subagent task bypass, test matrix gaps, tray fallback inventory | Phase 6 expanded |

---

## Open decisions (resolve before Phase 2)

1. **Feature flag:** Should Honk gate the density setting behind `conversation_density_setting` (flag off → always `detailed`), or always honor stored value?
2. **Context provider:** Introduce `AgentConversationProvider` equivalent to dedupe subscriptions, or keep hook+prop pattern?
3. **Explore grouping at Detailed/Balanced:** Cursor council said ≥3; Honk never groups explores unless Compact. Intentional divergence or parity gap to fix?

**Resolved:** Legacy density modes removed. Honk uses only `detailed`, `compact-ungrouped`, `compact-all-grouped`.

---

## Verification checklist

- [ ] `ConversationDensity` type has exactly three values; no legacy literals in schema
- [ ] Persisted legacy values migrate at decode/hydrate and write back canonical form
- [ ] Completed group header shows `Explored`/`Edited` not `Worked for`
- [ ] Thinking steps render inside Exploring group preview strip
- [ ] Compact shell expands to full output on chevron (not terminal one-liner)
- [ ] Pending approval forces detailed cards and breaks groups
- [ ] Settings slider writes/read round-trip via `setClientSettings` IPC
- [ ] `deriveTimelineRenderItems` tests cover Detailed / Balanced / Compact grouping matrix
- [ ] `ToolCallRenderer` tests or snapshot for edit/shell at each density + pending override
- [ ] Manual: long shell run auto-scrolls preview in Detailed card and grouped Compact header
- [ ] Tray tool rows use same `ToolCallRenderer` path as main chat
- [ ] `pnpm run typecheck` passes

---

## Where to start (first file per task)


| Task                    | Open first                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Understand Cursor chain | `workbench.desktop.main.js` — search `ETA`, `f4o`, `F5r`, `aof`, `NAm`, `MRm`                                                  |
| Honk settings entry    | `[appearance-settings-panel.tsx](packages/app/src/components/settings/appearance/appearance-settings-panel.tsx)`               |
| Honk grouping entry    | `[timeline-render-items.ts](packages/app/src/components/chat/timeline/timeline-render-items.ts)` — `deriveTimelineRenderItems` |
| Honk render entry      | `[tool-renderer.tsx](packages/app/src/components/chat/message/tool-renderer.tsx)` — `ToolCallRenderer`                         |
| Three-value collapse    | `[settings.ts](packages/contracts/src/settings.ts)` + `[conversation-density.ts](packages/shared/src/conversation-density.ts)` |
| Honk predicates        | `[conversation-density.ts](packages/shared/src/conversation-density.ts)`                                                       |
| Tray parity             | `[subagent-tray.tsx](packages/app/src/components/chat/composer/subagents/subagent-tray.tsx)`                                   |


