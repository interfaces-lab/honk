# Path A — Member 4: Deletion Surface

Read-only audit for removing Multi's above-composer subagent preview tray. All citations are from the working tree as of 2026-05-26.

---

## 1. Symbol inventory

Legend: **exported** = public module surface; **internal** = file-local only.

### `SubagentPreviewTrayStack` (exported)

| Location | Role |
| -------- | ---- |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:24` | Definition + export |
| `packages/app/src/components/chat/composer/input.tsx:87` | Import |
| `packages/app/src/components/chat/composer/input.tsx:2227-2231` | Composer mount |

No test imports.

### `SubagentPreviewTray` (internal)

| Location | Role |
| -------- | ---- |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:89` | Definition |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:64` | Used by `SubagentPreviewTrayStack` |

No external importers.

### `SubagentPreviewActiveThreadSync` (internal)

| Location | Role |
| -------- | ---- |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:71` | Definition |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:38` | Rendered from `SubagentPreviewTrayStack` |

Closes preview when `previewKey !== null && !belongsToActiveThread` (`subagent-preview-tray.tsx:80-83`). Does **not** receive `visible` in current tree (regression doc describes an older variant that did).

No external importers.

### `SubagentPreviewBody` (internal)

| Location | Role |
| -------- | ---- |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:145` | Definition |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:123` | Mounted from `SubagentPreviewTray` |

No external importers. Migration source for inline task-card body (member 3).

### `SubagentSnapshotSection` (internal)

| Location | Role |
| -------- | ---- |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:241` | Definition |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:212` | Used in `SubagentPreviewBody` |

No external importers.

### `SubagentSnapshotItem` (internal)

| Location | Role |
| -------- | ---- |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:296` | Definition |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:281` | Used in `SubagentSnapshotSection` |

No external importers.

### `SubagentUserMessageBody` (internal)

| Location | Role |
| -------- | ---- |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:337` | Definition |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:319` | Used in `SubagentSnapshotItem` |

No external importers. Candidate to extract into shared module for inline body.

### `SubagentActivityLine` (internal)

| Location | Role |
| -------- | ---- |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:354` | Definition |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:225` | Running-log rows |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:329` | Snapshot tool rows |

No external importers. Replace with `ToolCallRenderer` in inline body (member 3).

### `useSubagentPreviewStore` (exported)

| Location | Role |
| -------- | ---- |
| `packages/app/src/stores/subagent-preview-store.ts:113` | Definition + export |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:18,29,30` | Tray read/close |
| `packages/app/src/components/chat/view/chat-view.tsx:143,1045,1046` | Dimming + click-capture |
| `packages/app/src/components/chat/message/tool-message.tsx:18,118,164,165` | Row open + live update |

No sidebar or other surface imports the store (confirmed by repo-wide grep of `subagent-preview-store`).

### `subagentPreviewKey` (exported)

| Location | Role |
| -------- | ---- |
| `packages/app/src/stores/subagent-preview-store.ts:17` | Definition + export |
| `packages/app/src/stores/subagent-preview-store.ts:31,57,126` | Internal store helpers |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:17,133` | Body remount key |
| `packages/app/src/components/chat/message/tool-message.tsx:16,120,135,138,166` | React keys + preview match |

### `isSubagentPreviewLogVisible` (exported)

| Location | Role |
| -------- | ---- |
| `packages/app/src/stores/subagent-preview-store.ts:39` | Definition + export |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:16,401` | Tray log filter |

Only tray consumer. Move to inline-body module or `session-logic.ts` if inline body still filters logs before transcript items land.

### `SubagentPreviewSelection` (exported interface)

| Location | Role |
| -------- | ---- |
| `packages/app/src/stores/subagent-preview-store.ts:9` | Definition + export |
| `packages/app/src/stores/subagent-preview-store.ts:28,107,108` | Store typing |
| `packages/app/src/components/chat/composer/subagent-preview-tray.tsx:19,90,128,146` | Tray props |

Only tray + store. Delete with store unless a future side panel reuses the shape.

### `subagentPreviewUpdateSignature` (exported)

| Location | Role |
| -------- | ---- |
| `packages/app/src/stores/subagent-preview-store.ts:55` | Definition + export |
| `packages/app/src/stores/subagent-preview-store.ts:121,122` | `updatePreviewSubagent` dedup |
| `packages/app/src/components/chat/message/tool-message.tsx:17,175` | `SubagentPreviewUpdateSync` remount key |

Tray-only store helper except `tool-message.tsx` live-sync path — delete with store.

### Related symbol not in council list (deletion-adjacent)

| Symbol | Location | Notes |
| ------ | -------- | ----- |
| `SubagentPreviewUpdateSync` | `tool-message.tsx:269-279` | Pushes subagent updates into store while preview open; delete with store |
| `subagentPreviewBodyKey` | `subagent-preview-tray.tsx:128-137` | Internal tray remount key; delete with tray |
| `deriveVisibleSubagentLogs` | `subagent-preview-tray.tsx:397-402` | Internal; delete or move to inline body |

---

## 2. `input.tsx` mount site

### Tray JSX (current working tree)

```tsx
// packages/app/src/components/chat/composer/input.tsx:2227-2231
          <SubagentPreviewTrayStack
            activeThreadId={activeThreadId}
            compact={composerVariant === "compact"}
            visible={composerVariant !== "compact" || isDockComposerExpanded}
          />
```

### Import

```tsx
// packages/app/src/components/chat/composer/input.tsx:87
import { SubagentPreviewTrayStack } from "./subagent-preview-tray";
```

### Surrounding container (spacing / layout that goes away)

```tsx
// packages/app/src/components/chat/composer/input.tsx:2197-2245 (abbreviated)
      <form
        ref={composerFormRef}
        onSubmit={onSend}
        className={cn("w-full min-w-0", !isInlineEditComposer && "mx-auto max-w-agent-chat")}
        data-variant={composerVariant}
        data-layout={layout}
        data-chat-input-form="true"
      >
        {lifecycleSync}
        <div
          className={cn(
            "flex w-full min-w-0 shrink-0 flex-col",
            isInlineEditComposer ? "gap-0" : "mx-auto max-w-agent-chat gap-2",
          )}
          data-menu-open={composerMenuOpen ? "" : undefined}
          data-running={phase === "running" ? "" : undefined}
          data-slash-menu-variant="surface"
          data-variant={composerVariant}
        >
          {showPlanTray ? ( <PlanFollowUpTray ... /> ) : null}
          <SubagentPreviewTrayStack ... />
          {showQueuedComposerPanel ? ( <QueuedComposerItemsPanel ... /> ) : null}
          ...
```

**Visual/CSS removed with tray:**

- Parent column `gap-2` (`input.tsx:2209`) still applies between remaining siblings; only the tray's own `mt-2` on the stack wrapper (`subagent-preview-tray.tsx:56`) and all `[data-subagent-followup-tray*]` rules disappear.
- Tray sits **above** queued-items panel and composer header/surface, **below** plan tray — same slot as `PlanFollowUpTray`.

### Shared-worktree removal scope

Remove **only**:

1. `input.tsx:87` — `SubagentPreviewTrayStack` import
2. `input.tsx:2227-2231` — JSX block

Do **not** touch in this step: `PlanFollowUpTray`, `QueuedComposerItemsPanel`, `composerVariant` / `isDockComposerExpanded` logic (`input.tsx:1514-1524`), composer header block (`input.tsx:2246-2258`), or prompt surface below.

---

## 3. `chat-view.tsx` dimming + click capture

### Primary block (`chat-view.tsx:3427-3486`)

```tsx
// packages/app/src/components/chat/view/chat-view.tsx:3425-3488
            <div
              className="relative flex min-h-0 flex-1 flex-col"
              data-subagent-conversation-shell=""
              data-subagent-preview-open={subagentPreviewOpen ? "" : undefined}
            >
              <div data-subagent-conversation-mask="">
                {branchView.status === "invalid" ? ( ... ) : null}
                <MessagesTimeline ... />
                {showScrollToBottom && ( ... )}
              </div>
              {subagentPreviewOpen ? (
                <button
                  type="button"
                  data-subagent-preview-click-capture=""
                  aria-label="Close subagent preview"
                  onClick={closeSubagentPreview}
                />
              ) : null}
            </div>
```

### Store wiring

```tsx
// packages/app/src/components/chat/view/chat-view.tsx:143
import { useSubagentPreviewStore } from "../../../stores/subagent-preview-store";

// packages/app/src/components/chat/view/chat-view.tsx:1045-1046
  const subagentPreviewOpen = useSubagentPreviewStore((state) => state.preview !== null);
  const closeSubagentPreview = useSubagentPreviewStore((state) => state.closePreview);
```

No other `data-subagent-conversation-shell`, `data-subagent-conversation-mask`, or `data-subagent-preview-click-capture` references in `packages/app` (grep confirms only `chat-view.tsx`).

### Close handlers

| Handler | Location | Action |
| ------- | -------- | ------ |
| Timeline click-capture overlay | `chat-view.tsx:3480-3486` | `onClick={closeSubagentPreview}` |
| Tray header close button | `subagent-preview-tray.tsx:113-118` | `onClick={onClose}` → store `closePreview` |
| Thread switch | `subagent-preview-tray.tsx:80-83` | `SubagentPreviewActiveThreadSync` calls `closePreview()` when preview belongs to another thread |

**Keyboard:** No Escape or keybinding closes subagent preview. `chat-view.tsx:894-960` global `keydown` handles terminal/diff/project-script commands only — no `closeSubagentPreview` branch.

### CSS keyed off conversation-shell / mask / click-capture

From `packages/app/src/styles/conversation.css`:

```css
/* conversation.css:484-486 */
[data-subagent-conversation-shell][data-subagent-preview-open=""] {
  isolation: isolate;
}

/* conversation.css:488-497 */
[data-subagent-conversation-mask] {
  display: flex;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  position: relative;
  opacity: 1;
  transition: var(--multi-composer-subagent-preview-mask-transition);
}

/* conversation.css:499-503 */
[data-subagent-conversation-shell][data-subagent-preview-open=""]
  [data-subagent-conversation-mask] {
  opacity: var(--multi-composer-subagent-preview-mask-dimmed-opacity);
  pointer-events: none;
}

/* conversation.css:505-516 */
[data-subagent-preview-click-capture] {
  position: absolute;
  inset: 0;
  z-index: 20;
  appearance: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: default;
  pointer-events: auto;
}

/* conversation.css:518-520 */
[data-subagent-preview-click-capture]:focus {
  outline: none;
}
```

**Note:** `[data-subagent-conversation-mask]` base rule (`488-497`) provides flex layout for the timeline column, not only dimming. On removal, replace with a neutral wrapper (e.g. `className="flex min-h-0 flex-1 flex-col relative"`) or drop the inner wrapper entirely and keep layout on the outer shell.

---

## 4. CSS rules to delete

### `[data-subagent-followup-tray*]`

```css
/* conversation.css:402-406 — DELETE */
[data-subagent-followup-tray-stack] {
  position: relative;
  width: 100%;
  pointer-events: none;
}

/* conversation.css:408-424 — DELETE */
[data-subagent-followup-tray] {
  position: relative;
  z-index: 1;
  overflow: hidden;
  width: 100%;
  height: auto;
  max-height: var(--multi-composer-subagent-preview-max-height);
  border-radius: var(--multi-composer-subagent-tray-radius);
  background-color: var(--multi-composer-subagent-tray-background);
  box-shadow: var(--multi-composer-subagent-tray-shadow);
  backdrop-filter: blur(var(--multi-composer-subagent-tray-blur));
  -webkit-backdrop-filter: blur(var(--multi-composer-subagent-tray-blur));
  transform-origin: bottom center;
  pointer-events: auto;
  animation: multi-subagent-tray-enter var(--multi-motion-duration-fast) ease-out;
  will-change: opacity, transform;
}

/* conversation.css:426-436 — DELETE */
[data-subagent-followup-tray]::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 0 0 1px var(--multi-stroke-tertiary),
    inset 0 0 0 1px var(--multi-composer-subagent-tray-background);
}

/* conversation.css:438-447 — DELETE */
@keyframes multi-subagent-tray-enter {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* conversation.css:449-453 — DELETE */
@media (prefers-reduced-motion: reduce) {
  [data-subagent-followup-tray] {
    animation: none;
  }
}

/* conversation.css:522-526 — DELETE */
body.multi-reduce-transparency[data-multi-glass-mode="true"] [data-subagent-followup-tray] {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  background-color: var(--multi-composer-subagent-tray-opaque-background);
}

/* conversation.css:528-532 — DELETE */
body.multi-reduce-transparency[data-multi-glass-mode="true"] [data-subagent-followup-tray]::after {
  box-shadow:
    inset 0 0 0 1px var(--multi-stroke-tertiary),
    inset 0 0 0 1px var(--multi-composer-subagent-tray-opaque-background);
}
```

### `[data-subagent-preview-*]` (tray + dimming; not timeline row `data-subagent-open`)

```css
/* conversation.css:484-486 — DELETE (see §3) */
[data-subagent-conversation-shell][data-subagent-preview-open=""] {
  isolation: isolate;
}

/* conversation.css:505-516 — DELETE */
[data-subagent-preview-click-capture] { ... }

/* conversation.css:518-520 — DELETE */
[data-subagent-preview-click-capture]:focus {
  outline: none;
}

/* conversation.css:534-543 — DELETE */
[data-subagent-preview-container] {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  width: 100%;
  min-width: 0;
  height: auto;
  max-height: inherit;
  min-height: var(--multi-composer-subagent-preview-min-height);
}

/* conversation.css:545-558 — DELETE (tray scroll body; inline task body gets new rule in tool-call.css) */
[data-subagent-preview-body] {
  flex: 0 1 auto;
  min-height: 0;
  max-height: max(
    0px,
    calc(
      var(--multi-composer-subagent-preview-max-height) -
        var(--multi-composer-subagent-preview-header-height)
    )
  );
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
```

Tray-only attributes with **no CSS rules** (remove with JSX): `data-subagent-preview-header` (`subagent-preview-tray.tsx:105`), `data-subagent-preview-open` on tray root (`subagent-preview-tray.tsx:62`), `data-subagent-thread-snapshot` (`subagent-preview-tray.tsx:271`).

### `[data-subagent-conversation-*]`

```css
/* conversation.css:488-497 — DELETE / REPLACE (layout-only portions → plain flex classes on wrapper) */
[data-subagent-conversation-mask] { ... }

/* conversation.css:499-503 — DELETE */
[data-subagent-conversation-shell][data-subagent-preview-open=""]
  [data-subagent-conversation-mask] { ... }
```

Remove attributes from `chat-view.tsx:3427-3430,3483` and store import/`subagentPreviewOpen`/`closeSubagentPreview` (`1045-1046,143`).

### `[data-subagent-running-log]`

```css
/* conversation.css:571-574 — DELETE */
[data-subagent-running-log] {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 100%);
  mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 100%);
}
```

### `[data-subagent-tray-row]`

```css
/* tool-call.css:118-121 — MIGRATE then DELETE old selector */
[data-subagent-preview-body] [data-subagent-tray-row] {
  content-visibility: auto;
  contain-intrinsic-size: auto 32px;
}
```

**Migration target:** e.g. `[data-task-tool-call-body] [data-subagent-inline-row]` in `tool-call.css` once inline body lands (member 3). Drop `data-subagent-tray-row` wrappers entirely if inline body emits flat step rows like Cursor `Udd`.

### Timeline row rules — **KEEP** (not tray)

```css
/* conversation.css:560-569 — KEEP */
[data-subagent-status-container] [data-subagent-task].tool-call-shimmer { ... }
[data-subagent-status-container]:is(:hover, :focus-within) [data-subagent-task].tool-call-shimmer,
[data-subagent-row]:is(:hover, :focus-visible) [data-subagent-task].tool-call-shimmer { ... }

/* conversation.css:576-579 — KEEP (row chevron; not tray) */
@media (prefers-reduced-motion: reduce) {
  [data-subagent-open] svg {
    transition: none;
  }
}
```

### CSS custom properties — **DELETE** with tray (no other consumers)

`packages/app/src/styles/conversation.css:42-43,44-49,50-52,53,62-63`:

- `--multi-composer-subagent-preview-max-height`
- `--multi-composer-subagent-preview-min-height`
- `--multi-composer-subagent-tray-radius`
- `--multi-composer-subagent-tray-shadow`
- `--multi-composer-subagent-tray-blur`
- `--multi-composer-subagent-tray-background`
- `--multi-composer-subagent-tray-opaque-background`
- `--multi-composer-subagent-preview-header-height`
- `--multi-composer-subagent-preview-mask-dimmed-opacity`
- `--multi-composer-subagent-preview-mask-transition`

---

## 5. Store deletion safety

### Consumers of `useSubagentPreviewStore`

| Consumer | Selectors / actions | After Path A |
| -------- | ------------------- | ------------ |
| `subagent-preview-tray.tsx:29-30,64` | `preview`, `closePreview` | **Delete file** |
| `chat-view.tsx:1045-1046` | `preview !== null`, `closePreview` | **Remove** dimming + overlay + import |
| `tool-message.tsx:118` | `preview?.key` | **Replace** with local expanded subagent id in `SubagentStatusRow` / `TaskToolCall` |
| `tool-message.tsx:164-165` | `openPreview`, `updatePreviewSubagent` | **Replace** `openPreview` with toggle expand; **delete** `SubagentPreviewUpdateSync` + `updatePreviewSubagent` (React re-render from `workEntry.subagents` is enough) |

### Exported helpers — disposition

| Helper | External use | Proposal |
| ------ | ------------ | -------- |
| `subagentPreviewKey` | `tool-message.tsx` keys + match | Move to `session-logic.ts` or `tool-message.tsx` local helper |
| `isSubagentPreviewLogVisible` | Tray only | Move next to inline body or delete if inline uses transcript items only |
| `subagentPreviewUpdateSignature` | `tool-message.tsx:175` + store | **Delete** with store |
| `SubagentPreviewSelection` | Tray + store | **Delete** with store |
| `isSubagentProviderSnapshotItemType` | Store only (`subagent-preview-store.ts:4,52`) | Stays in `session-logic.ts:868` — not store-owned |

### Store survival for sidebar / id lookup?

**Refuted.** Grep of `useSubagentPreviewStore`, `subagent-preview-store`, and `openPreview` shows no sidebar, agents panel, or secondary surface. The store exists solely to coordinate composer tray + timeline dimming + status-row selection. Safe to delete entirely after inline expand ships.

### `getProviderThreadSnapshot` after tray delete

Only tray callsite in UI: `subagent-preview-tray.tsx:179-184`. RPC remains in `environment-api.ts:52`, `ws-rpc-client.ts:257-259`. Inline body should read coalesced transcript from `WorkLogSubagent` / new items field (member 2), not poll snapshots.

---

## 6. Test impact

Searches: `subagent-preview`, `SubagentPreviewTrayStack`, `useSubagentPreviewStore`, `data-subagent-` in `**/*.test.*`, `**/*.browser.*`, `**/*.spec.*`.

| Match | Classification |
| ----- | -------------- |
| *(none)* for tray/store/`data-subagent-*` selectors | No direct tray tests today |

| Match | Classification |
| ----- | -------------- |
| `packages/app/src/session-logic.test.ts:1403-1490` — subagent activity derivation | **LEAVE** — tests `deriveWorkLogEntries` / `subagents` attachment, not tray UI |
| `packages/app/src/components/chat/timeline/messages-timeline.test.tsx` | **LEAVE** — no subagent preview refs |
| `packages/app/src/components/chat/timeline/messages-timeline.browser.tsx` | **LEAVE** — work-group preview, not subagent tray |
| `packages/app/src/components/chat/composer/composer-css-contract.test.ts` | **LEAVE** — references `isDockComposerExpanded` but not tray |
| `packages/app/src/lib/appearance-tokens-contract.test.ts` | **LEAVE** — no subagent tokens |

**Step 7 (update tests):** Add/rewrite tests only when inline body + row toggle land (member 3). Expect new tests on `TaskToolCall` expand and optional `tool-call.css` selector contract. No existing tests require deletion for tray removal alone.

---

## 7. Ancillary wiring

### Composer variant logic (must keep working without tray)

```tsx
// packages/app/src/components/chat/composer/input.tsx:1514-1524
    const isDockComposerExpanded =
      composerVariant === "compact" &&
      (isInlineEditComposer ||
        hasComposerHeader ||
        isEditingQueuedComposerItem ||
        composerImages.length > 0 ||
        activePendingProgress !== null ||
        promptHasExplicitLineBreak ||
        isComposerEditorMultiline);

// packages/app/src/components/chat/composer/input.tsx:1524
    const isDockComposerSingleLine = composerVariant === "compact" && !isDockComposerExpanded;
```

Tray was the **only** consumer of `visible={composerVariant !== "compact" || isDockComposerExpanded}` (`input.tsx:2230`). Removing the tray does not change `isDockComposerExpanded` inputs — plan tray, queued panel, composer header, editor shell, and footer still use `composerVariant` / `isDockComposerExpanded` (`input.tsx:2201-2415`).

### `SubagentStatusRow` → tray entry (replacement target)

```tsx
// packages/app/src/components/chat/message/tool-message.tsx:177-188
    openPreview({
      key,
      activeThreadId,
      environmentId,
      projectRoot,
      subagent,
    });
```

Also sets `isPreviewOpen`, `aria-pressed`, `data-subagent-open` on row chevron (`tool-message.tsx:210,217,256-258`) from store key — rewire to local expand state.

### Analytics / telemetry

**None found.** Grep for `trackEvent`, `analytics`, `telemetry`, `posthog`, `segment` under subagent/tray paths returned no matches around `openPreview` / `closePreview`.

---

## 8. Order of deletion (sequenced commit plan)

| Step | Action | Files / lines |
| ---- | ------ | ------------- |
| **1** | Introduce inline body in `TaskToolCall` (no removals) | `tool-renderer.tsx` task case; body reads new transcript items field (member 2 schema) |
| **2** | Remove `openPreview` from `SubagentStatusRow`; row toggles task card expansion | `tool-message.tsx:118-120,164-198,269-279` — drop store hooks, `SubagentPreviewUpdateSync`, `isPreviewOpen` from store |
| **3** | Remove tray mount | `input.tsx:87`, `input.tsx:2227-2231` |
| **4** | Remove dimming + click-capture | `chat-view.tsx:143`, `1045-1046`, `3427-3428`, `3430`, `3480-3487` — simplify wrapper markup |
| **5** | Delete tray module + store + tray CSS | Delete `subagent-preview-tray.tsx`, `subagent-preview-store.ts`; `conversation.css:42-43,44-49,50-53,62-63,402-453,484-558,522-532,571-574`; `tool-call.css:118-121` (after migrate) |
| **6** | Prune session-logic + store filters hiding `subagent.content.delta` | `session-logic.ts:816,856,907`; store filters `subagent-preview-store.ts:43-44,87-88` (member 2) |
| **7** | Update / add tests | New inline-body tests; existing `session-logic.test.ts` subagent cases unchanged |

**Dependency note:** Steps 3–5 can land in one commit only after step 1–2 make subagent content visible inline; otherwise row clicks become no-ops.

---

## External consumers that would break (summary)

| Consumer | Break | Fix |
| -------- | ----- | --- |
| `tool-message.tsx` | Row click opens store; UI selection tied to global preview | Local `expandedSubagentKey` (or task-card `defaultExpanded` toggle); remove store imports |
| `chat-view.tsx` | Dimming overlay assumes `preview !== null` | Remove store subscription, attributes, click-capture button |
| `input.tsx` | Imports/mounts `SubagentPreviewTrayStack` | Remove import + JSX (§2) |
| `subagent-preview-tray.tsx` | Entire module | Delete after inline body ships |
| `subagent-preview-store.ts` | Entire module | Delete; move `subagentPreviewKey` if still needed for React keys |
| `conversation.css` / `tool-call.css` | Tray/dimming/tray-row rules | Delete or migrate per §4 |

No package outside `packages/app` imports these symbols.
