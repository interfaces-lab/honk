# Cursor subagent click → presentation flow (binary audit)

Asset: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` (61221385 bytes, mtime 2026-05-25 06:57:18).

Multi comparison sources read 2026-05-26.

---

## 1. What's clickable

Cursor exposes **two distinct subagent click surfaces**. Multi's `SubagentStatusRow` is closest to surface B, but Multi routes it to a composer tray (surface C — Multi-only).

### A. Agent-timeline task tool card header (React — primary chat parity target)

| Field | Value |
| ----- | ----- |
| Component | `wsv` |
| JS line | 639 |
| Byte offset | 3504294 |
| Click target | `<button type="button" className="ui-task-tool-call__header" onClick={D}>` |
| Handler symbol | `D` ← `R` ← `_sv` |
| Handler offset | toggle defined at byte 3504792 (`R=_(()=>{A&&a(_sv)},"t6")`); header `onClick:D` at byte 3505952 |

Handler bodies (character-for-character from binary):

```text
function _sv(n){return!n}
R=_(()=>{A&&a(_sv)},"t6")
Q=Re("button",{type:"button",className:"ui-task-tool-call__header",onClick:D,children:[U,V,j]})
```

- `A` = has expandable body (`k.some(Ssv)||!!h`).
- `a` = `Lt(!1)` setter for local `o` (expanded state).
- No global store, no composer tray, no selection store.

### B. Nested subagent status row under a task bubble (SolidJS — composer bubble / task_v2)

| Field | Value |
| ----- | ----- |
| Component | `SM1` |
| JS line | 46927 |
| Byte offset | 35052767 |
| Row class | `subagent-task-nested-subagent-row flex items-start gap-1` (+ `cursor-pointer` when clickable) |
| Row class offset | 35056594 |
| Status indicator | `Ga_` → `Vei` → `ui-subagent-status-indicator` (byte 3917655, line 695) |
| Click registration | `J.addEventListener("click",Q=>{Q.stopPropagation(),M()})` at byte ~35054380 |

Handler `M` (character-for-character):

```text
M=async()=>{const J=n.handle.data.composerId;if(J){if(E()){if(D())return;await A(J);return}await n.openSubagentComposer(J)}}
```

- Glass path (`E()` true): `A(J)` → `commandService.executeCommand("glass.openSubagentPreviewInAgentsTray",{composerId:J,name:...})` (byte 35054100).
- Non-Glass: `openSubagentComposer(J)` — opens/focuses a separate subagent composer, **not** an above-composer tray in the timeline.

Row is **not** a bordered panel; it is an inline row with left indent (`padding: 2px 0 2px 12px`, icon column `width: 25px`).

### C. Work-group nested tool expand (React — different concern)

| Field | Value |
| ----- | ----- |
| Context | `rXg` work-group renderer |
| JS line | 628 |
| Byte offset | 3303752 |
| Handler | `E=_(ge=>{k(ge),g(!0)},"t4")` at byte 3304057 |
| State | `expandedToolCallId` via `Lt(void 0)`; expands a nested tool inside an open work group |

This is **not** the subagent preview tray path. It sets `expandedToolCallId` and forces the work group open.

---

## 2. What the click does

### A. Task card header (`wsv`)

1. Toggles local React state `o` via `_sv` (`return !n`).
2. Conditionally mounts body when `o && A`.
3. Does **not** set a focus/selection store.
4. Does **not** open a modal, sidebar, or composer-adjacent tray.
5. `subagentConversation` prop is used only for subtitle text via `bsv(t,i,r)` — **not** rendered as separate clickable children in `wsv`.

### B. Nested subagent row (`SM1`)

1. `stopPropagation()` on click.
2. Opens external subagent surface (`openSubagentComposer` or Glass agents tray).
3. Row shows `cursor-pointer` only when `D()` is false.

### Multi (`SubagentStatusRow`)

Click handler at `packages/app/src/components/chat/message/tool-message.tsx` lines 177–188:

```tsx
const handleOpenPreview = (event: MouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
  if (!hasDetails) {
    return;
  }
  openPreview({
    key,
    activeThreadId,
    environmentId,
    projectRoot,
    subagent,
  });
};
```

Store: `useSubagentPreviewStore.openPreview` (`subagent-preview-store.ts` line 115) sets global `preview: SubagentPreviewSelection | null`. No inline expand toggle on the parent task card.

---

## 3. Where subagent content renders

### Cursor A — inline under task card in timeline

Renderer chain:

```text
wsv → ui-task-tool-call__body → v1 (maxHeight:300) → ui-task-tool-call__turns → ysv → ui-turn-view → ui-turn-view__steps → Udd → renderStep
```

Key JSX (byte 3506157, line 639):

```text
Y=o&&A&&$("div",{className:"ui-task-tool-call__body",children:Re(v1,{maxHeight:300,scrollbarVisibility:"hover",children:[h&&Re("div",{className:"ui-task-tool-call__error",children:[$(gr,{name:"error",size:"sm",color:"red"}),$("span",{children:h})]}),s&&$("div",{className:"ui-task-tool-call__turns",style:{padding:`0 ${l_d}px`},children:k.map(ee=>$(ysv,{turn:ee,renderStep:B},ee.turnIndex))})]})})
```

`ysv` root (byte 3504156):

```text
o=$("div",{className:"ui-turn-view",children:$("div",{className:"ui-turn-view__steps",children:$(Udd,{steps:s,renderStep:i})})})
```

- Location: **inline expansion under the same task card row** in the timeline.
- Not a sidebar, not above the composer, not a modal.
- `l_d = 0` (line 6312) → turns padding `0 0px`.

### Cursor B — nested row click leaves timeline

Content stays in the opened subagent composer / Glass agents tray. The timeline row itself does not expand into a bordered transcript panel.

### Multi — above-composer tray (off-thread)

Mount site: `packages/app/src/components/chat/composer/input.tsx` lines 2227–2231 (`SubagentPreviewTrayStack` above composer input).

Tray stack root (`subagent-preview-tray.tsx` lines 55–65):

```tsx
<div
  className={cn("relative mt-2 w-full min-w-0", props.compact ? "mx-auto w-full" : "")}
  data-subagent-followup-tray-stack=""
>
  <div
    className={cn("font-multi text-conversation", props.compact ? "w-full" : "")}
    data-subagent-followup-tray=""
    data-subagent-preview-open=""
  >
```

Timeline dimming: `chat-view.tsx` lines 3427–3428, 3480–3486 (`data-subagent-conversation-shell`, `data-subagent-preview-click-capture`).

For `taskToolCall` entries, Multi also embeds `SubagentStatusSurface` inside `TaskToolCall` body (`tool-message.tsx` lines 65–76), but row click still opens the composer tray instead of expanding inline transcript steps.

---

## 4. Container chrome

### Cursor task card (`ui-task-tool-call`) — embedded CSS byte 16341242, line 7478

```css
.ui-task-tool-call {
  border-radius: var(--conversation-surface-border-radius, var(--cursor-radius-xl));
  border: 1px solid var(--card-border-color, var(--cursor-stroke-secondary));
  background: var(--cursor-bg-tertiary);
  overflow: hidden;
  font-size: var(--conversation-font-size, 13px);
}
.ui-task-tool-call__header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  ...
}
.ui-task-tool-call__body {
  border-top: 1px solid var(--card-border-color, var(--cursor-stroke-secondary));
  padding: 6px 0;
}
```

- **One** bordered card on the parent task tool.
- Expanded body adds a **top border divider**, not a second outer frame.
- **No** close button, **no** titled header bar inside the body.
- **No** glass/blur/shadow tray above the composer for timeline subagent steps.

### Cursor nested subagent row (`SM1`)

- No border/background panel on the row.
- Inline styles only: `padding: 2px 0 2px 12px`, secondary text color, 25px icon column.

### Multi composer tray — `conversation.css`

`[data-subagent-followup-tray]` (lines 408–424): border-radius, background, box-shadow, backdrop-filter.

`::after` inset border (lines 426–435). Header with title + close button: `subagent-preview-tray.tsx` lines 103–122.

**Multi adds chrome Cursor does not put on timeline subagent presentation:**
- Composer-adjacent floating tray with blur, shadow, inset border.
- Dedicated preview header + close control.
- Timeline opacity mask (`data-subagent-conversation-mask` at 45% opacity).

---

## 5. Row styling inside the subagent view

### Cursor

Inside expanded task body, steps reuse the **same** agent step renderer passed as `renderStep`:

- Default tool rows: `q$` → `ui-tool-call-line` (byte 3146297, line 607).
- Dispatch hub: `vRh` (byte 3522599, line 644).

Step indent via `Udd` / `hEh`: `paddingInline: mEh(M.step, g)` (byte 3302987). Constants (line 6291): `J4n`, `i7h` for text vs block inset.

### Multi

Tray body uses `SubagentActivityLine` → `ToolCallLine` / `ExpandableToolMetadataLine` (parallel path). Snapshot via `getProviderThreadSnapshot`. Task card body never receives `renderStep` from `ToolCallMessage`.

---

## 6. Compare to Multi's current implementation

### Click site — `SubagentStatusRow`

```tsx
// tool-message.tsx:177-188
openPreview({ key, activeThreadId, environmentId, projectRoot, subagent });

// tool-message.tsx:203-218
<button ... data-subagent-row="" onClick={handleOpenPreview} ...>
```

### Tray container — `subagent-preview-tray.tsx:55-65`, `conversation.css:408-435`

### Body wrapper — `subagent-preview-tray.tsx:207-209`

### What Multi does that Cursor does NOT

1. Global `subagentPreview` store on row click vs local `_sv` toggle.
2. Composer-adjacent tray vs inline `ui-task-tool-call__body`.
3. Tray blur/shadow/inset border vs single card + body `border-top`.
4. Preview header + close vs no close on inline expansion.
5. Timeline dimming mask vs not found in Cursor inline path.
6. Click-capture overlay to dismiss vs not found.
7. `SubagentActivityLine` parallel renderer vs shared `renderStep`/`q$`.
8. Snapshot polling on tray open vs streamed `subagentConversation.turns`.
9. Clickable status rows opening another surface vs tool/step rows in expanded body.
10. `defaultExpanded={true}` but row click bypasses inline body.

---

## 7. Recommended architecture fix

**Inline subagent steps under the parent task tool card (Cursor `wsv` path).** Remove above-composer tray as default timeline presentation.

### Files and lines to change

| File | Lines | Change |
| ---- | ----- | ------ |
| `tool-message.tsx` | 65–79, 149–218 | Inline expand on task card; pass `renderStep`; drop `openPreview` as default |
| `tool-renderer.tsx` | 417–515 | Subagent transcript in body via shared step renderer |
| `subagent-preview-store.ts` | all | Remove or side-panel-only |
| `subagent-preview-tray.tsx` | all | Remove from composer path |
| `input.tsx` | 2227–2231 | Remove `SubagentPreviewTrayStack` |
| `chat-view.tsx` | 3427–3486 | Remove mask + click capture |
| `conversation.css` | 402–557 | Remove tray chrome tokens |
| `tool-call.css` | 41–67 | Add body `border-top` like Cursor |
| `session-logic.ts` | subagent derivation | Coalesce `subagent.content.delta` for inline body |

---

## Evidence index

| Claim | Source |
| ----- | ------ |
| `wsv` task card | JS line 639, byte 3504294 |
| Header toggle `_sv` / `R` / `D` | byte 3504792, 3505952 |
| Inline body JSX | byte 3506157 |
| `ysv` / `Udd` / `renderStep` | byte 3504156, 3302987 |
| `q$` ToolCallLine | byte 3146297, line 607 |
| `ui-task-tool-call` CSS | byte 16341242, line 7478 |
| `SM1` nested row click | byte 35052767, line 46927 |
| Multi click handler | `tool-message.tsx:177-218` |
| Multi tray | `subagent-preview-tray.tsx`, `conversation.css:402-557`, `input.tsx:2227-2231` |
