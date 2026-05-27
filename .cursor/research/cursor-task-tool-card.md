# Cursor `ui-task-tool-call` audit (vs Multi)

Asset: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` (verified 2026-05-26). Task tool CSS is **embedded in JS**, not in `workbench.desktop.main.css` (0 matches for `ui-task-tool-call` in main CSS).

## Executive summary

Cursor **does** render the task tool as a bordered, filled card (`.ui-task-tool-call`). The user perception that Multi is “too card-like” is mostly **token mismatch** and **layout mismatch**: Multi applies card chrome to a compact **tool-line** header (`inline-flex`, action + details on one baseline) while Cursor uses a **taller card header** (status icon + stacked title/subtitle + chevron). Multi should **not** delete border/background entirely; it should align tokens to Cursor and restructure `TaskToolCall` JSX/CSS to match `wsv`.

---

## 1. JSX / component structure

### Cursor — `wsv` (task tool call)

| Item | Value |
|------|--------|
| Symbol | `wsv` |
| Byte offset | `3504294` |
| Line | `639` |
| Dispatch | `case"taskToolCall"` → `$(wsv,{toolCall:t,loading:R,subagentConversation:d,renderStep:m})` at byte `3522599`, line `644` |

**Root** — single class, **not** shared with `ui-tool-call-line`:

```text
Re("div",{className:"ui-task-tool-call",children:[Q,Y]})
```

**Header** (`Q`) — `<button type="button" className="ui-task-tool-call__header">`:

| Child | Class | Content |
|-------|-------|---------|
| Status | `ui-task-tool-call__status-icon` | `loading` spin icon \| `error` red \| `check-circle` secondary |
| Text block | `ui-task-tool-call__title-area` | Column flex |
| → Title | `ui-task-tool-call__title` (+ `ui-task-tool-call__shimmer` when loading) | `gsv(toolCall)` → `args.description` or `"Task"` |
| → Subtitle | `ui-task-tool-call__subtitle` | `bsv(toolCall, loading, subagentConversation)` → nested step label, or `"Generating"` / `"Error"` / `"Completed"` |
| Chevron | `ui-task-tool-call__chevron` (+ `--open` when expanded) | `chevron-right` size 10; only if body expandable |

**Body** (`Y`) — conditional `o && A` (expanded && has turns or error):

```text
$("div",{className:"ui-task-tool-call__body",children:
  Re(v1,{maxHeight:300,...},[
    error block → ui-task-tool-call__error,
    turns → ui-task-tool-call__turns → map ysv
  ])
})
```

**Nested turn** — `ysv` at byte `3503829`, line `639`:

```text
$("div",{className:"ui-turn-view",children:
  $("div",{className:"ui-turn-view__steps",children:
    $(Udd,{steps:s,renderStep:i})
  })
})
```

**Label map vs card copy** — Global tool labels at byte `13900165`, line `6312`:

- `taskToolCall.loading`: `"Working on task"`
- `taskToolCall.completed`: `"Completed task"`

Those strings are used by generic `i6r` / `q$` paths, **not** as the card title. Card title is task **description** (`gsv`); subtitle is runtime status (`bsv`).

**Helpers**

| Symbol | Offset | Line | Role |
|--------|--------|------|------|
| `gsv` | `3503257` | `639` | Title text |
| `bsv` | `3503829` | `639` | Subtitle text |
| `pRh` | `3503257` | `639` | Error string from result |

### Cursor — compact line base (`ui-tool-call-line`)

Generic tools use `q$` at byte `3146297`, line `607`:

```text
Re("div",{role:...,className:Us("ui-tool-call-line",d,o),children:[
  $("span",{className:Us("ui-tool-call-line-action",r&&"ui-tool-call-line-shimmer"),children:t}),
  $("span",{className:"ui-tool-call-line-details",children:i})
]})
```

**No** `ui-tool-call-line` on `ui-task-tool-call` root.

### Multi — `TaskToolCall`

File: `packages/app/src/components/chat/message/tool-renderer.tsx` (lines `417–515`).

**Root JSX:**

```tsx
<div
  className="group/task-tool-call min-w-0 max-w-full text-multi-fg-secondary"
  data-task-tool-call=""
  data-status={...}
  data-expanded={isExpanded ? "true" : "false"}
>
```

**Header** (when `hasBody`) — **not** a card header; mirrors `toolCallLineVariants` layout:

```tsx
<button
  type="button"
  className="inline-flex min-h-6 w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 overflow-hidden"
  data-task-tool-call-header=""
>
  {statusIcon}
  {titleArea}  // action + details inline (baseline)
  <IconChevronRightMedium className="..." data-task-tool-call-chevron="" />
</button>
```

`titleArea`: `toolCallLineActionVariants` → `action` ("Working on task") + `details` (tertiary ellipsis).

**Body:**

```tsx
<div className="mt-1 min-w-0 max-w-full" data-task-tool-call-body="">
```

**Structural gap:** Multi uses tool-line semantics on a card shell; Cursor uses dedicated title/subtitle column classes.

---

## 2. Cursor CSS — every `.ui-task-tool-call*` rule (verbatim)

All rules live in embedded stylesheet; extracted from JS with byte offsets and line numbers.

### `.ui-task-tool-call` — byte `16341242`, line `7478`

```css
.ui-task-tool-call {
  border-radius: var(--conversation-surface-border-radius, var(--cursor-radius-xl));
  border: 1px solid var(--card-border-color, var(--cursor-stroke-secondary));
  background: var(--cursor-bg-tertiary);
  overflow: hidden;
  font-size: var(--conversation-font-size, 13px);
}
```

| Property | Cursor value |
|----------|----------------|
| root border | **yes** — `1px solid var(--card-border-color, var(--cursor-stroke-secondary))` |
| root background | **yes** — `var(--cursor-bg-tertiary)` |
| root border-radius | **yes** — `var(--conversation-surface-border-radius, var(--cursor-radius-xl))` |
| root padding | **none** on root |
| root font-size | `var(--conversation-font-size, 13px)` |
| root line-height | **not set** on root |

`--card-border-color` is set on step containers to `var(--cursor-stroke-secondary)` (byte `3307404`, line `628`).

### `.ui-task-tool-call__header` — byte `16341539`, line `7485`

```css
.ui-task-tool-call__header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  -webkit-user-select: none;
     -moz-user-select: none;
          user-select: none;
  min-height: 36px;
  box-sizing: border-box;
  width: 100%;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  outline: none !important;
}
```

### `.ui-task-tool-call__header:hover` — byte `16341940`, line `7504`

```css
.ui-task-tool-call__header:hover {
  background: var(--cursor-bg-secondary);
}
```

### `.ui-task-tool-call__status-icon` — byte `16342019`, line `7507`

```css
.ui-task-tool-call__status-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 20px;
  color: var(--cursor-text-secondary);
}
```

### `.ui-task-tool-call__title-area` — byte `16342210`, line `7516`

```css
.ui-task-tool-call__title-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
```

### `.ui-task-tool-call__title` — byte `16342335`, line `7523`

```css
.ui-task-tool-call__title {
  font-size: var(--conversation-font-size, 13px);
  line-height: 20px;
  color: var(--cursor-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### `.ui-task-tool-call__subtitle` — byte `16342543`, line `7531`

```css
.ui-task-tool-call__subtitle {
  font-size: var(--conversation-font-size, 13px);
  line-height: 20px;
  color: var(--cursor-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### `.ui-task-tool-call__chevron` — byte `16342755`, line `7539`

```css
.ui-task-tool-call__chevron {
  flex-shrink: 0;
  color: var(--cursor-icon-tertiary);
  transition: transform 100ms ease;
  opacity: 0;
}
```

### `.ui-task-tool-call__header:hover .ui-task-tool-call__chevron` — byte `16342893`, line `7545`

```css
.ui-task-tool-call__header:hover .ui-task-tool-call__chevron {
  opacity: 1;
}
```

### `.ui-task-tool-call__chevron--open` — byte `16342972`, line `7548`

```css
.ui-task-tool-call__chevron--open {
  transform: rotate(90deg);
  opacity: 1;
}
```

Chevron transition: **transform only** `100ms ease`; opacity has **no** transition rule.

### `.ui-task-tool-call__body` — byte `16343052`, line `7552`

```css
.ui-task-tool-call__body {
  border-top: 1px solid var(--card-border-color, var(--cursor-stroke-secondary));
  padding: 6px 0;
}
```

Body indent / rail: **top border divider**, horizontal padding `0` on body (turns use inline `padding: 0 ${l_d}px` in JSX — `l_d` symbol at byte `3506448`, numeric value **not found** in static extract).

### `.ui-task-tool-call__error` — byte `16343181`, line `7556`

```css
.ui-task-tool-call__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  color: var(--cursor-text-red-primary);
  font-size: var(--conversation-font-size, 13px);
  line-height: 20px;
}
```

### `@keyframes task-shimmer` — byte `16343401`, line `7566`

```css
@keyframes task-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
```

### `.ui-task-tool-call__shimmer` — byte `16343520`, line `7574`

```css
.ui-task-tool-call__shimmer {
  background-image: linear-gradient(90deg, color-mix(in srgb, var(--cursor-foreground, currentColor) 60%, transparent) 0%, color-mix(in srgb, var(--cursor-foreground, currentColor) 60%, transparent) 25%, var(--cursor-text-primary) 60%, color-mix(in srgb, var(--cursor-foreground, currentColor) 60%, transparent) 75%, color-mix(in srgb, var(--cursor-foreground, currentColor) 60%, transparent) 100%);
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: task-shimmer 2s linear infinite;
}
```

**Note:** `ui-task-tool-call__turns` and `ui-turn-view` have **no** dedicated CSS rules in the embedded block (class names only in JSX).

---

## 3. Shared base — `.ui-tool-call-line` (for comparison)

Task card does **not** inherit this on its root; listed for compact-tool parity.

### Minimal flex — byte `16314643`, line `6655`

```css
.ui-tool-call-line {
  min-width: 0;
  flex: 0 1 auto;
}
```

### Primary layout — byte `16346840`, line `7695`

```css
.ui-tool-call-line {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-user-select: none;
     -moz-user-select: none;
          user-select: none;
  font-size: var(--conversation-font-size, 13px);
  line-height: 1.5;
}
```

### Action / details — bytes `16347604` / `16347784`, lines `7734` / `7737`

```css
.ui-tool-call-line-action {
  color: var(--cursor-text-secondary);
  font-weight: var(--cursor-font-weight-normal, 400);
  flex-shrink: 0;
  transition: color 0.1s ease-in-out;
}

.ui-tool-call-line-details {
  color: var(--cursor-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.1s ease-in-out;
  font-variant-numeric: tabular-nums;
}
```

### Hover — bytes `16347252` / `16347355`, lines `7716` / `7719`

```css
.ui-tool-call-line--clickable:hover .ui-tool-call-line-action {
  color: var(--cursor-text-primary);
}
.ui-tool-call-line--clickable:hover .ui-tool-call-line-details {
  color: var(--cursor-text-secondary);
}
```

Compact lines: **no** border, **no** background, **no** border-radius on `.ui-tool-call-line`.

---

## 4. Multi implementation vs Cursor

### `tool-call.css` — all `[data-task-tool-call]*` rules

```41:47:packages/app/src/styles/tool-call.css
[data-task-tool-call] {
  border-radius: var(--multi-radius-card);
  border: 1px solid var(--multi-stroke-tertiary);
  background: var(--multi-bg-quinary);
  overflow: hidden;
  font-size: var(--multi-text-body);
}
```

```49:63:packages/app/src/styles/tool-call.css
[data-task-tool-call-header] {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  ...
}
```

```65:67:packages/app/src/styles/tool-call.css
[data-task-tool-call-body] {
  padding: 0 10px 8px;
}
```

```73:81:packages/app/src/styles/tool-call.css
[data-task-tool-call-chevron] { transition: transform + opacity 100ms; }
[data-task-tool-call][data-expanded="true"] [data-task-tool-call-chevron] { opacity: 1; }
```

Also referenced in margin reset at lines `113–116` (shared with shell + tool line).

### Property-by-property comparison

| Multi declaration | Line | Cursor equivalent | Verdict |
|-------------------|------|-------------------|---------|
| `border-radius: var(--multi-radius-card)` | 42 | `var(--conversation-surface-border-radius, var(--cursor-radius-xl))` | **Different** token chain (`multi-radius-card` ≈ 10px user default; Cursor uses `cursor-radius-xl` — exact px **not found** in CSS extract) |
| `border: 1px solid var(--multi-stroke-tertiary)` | 43 | `1px solid var(--card-border-color, var(--cursor-stroke-secondary))` | **Different** — Multi uses weaker 6% mix; Cursor uses `--cursor-stroke-secondary` → `--multi-stroke-secondary` (88% border mix) |
| `background: var(--multi-bg-quinary)` | 44 | `var(--cursor-bg-tertiary)` | **Different** — quinary 4% vs tertiary 8% (`--multi-bg-tertiary` in `tokens.css` L414); Multi has **no** `--cursor-bg-tertiary` alias |
| `overflow: hidden` | 45 | same | **Same** |
| `font-size: var(--multi-text-body)` | 46 | `var(--conversation-font-size, 13px)` | **Likely same** intent |
| Header `display: inline-flex` + `align-items: center` | 49–51 | `display: flex` + `align-items: flex-start` | **Different** |
| Header `padding: 6px 10px` | 53 | `8px 10px` | **Different** |
| Header `min-height` | Tailwind `min-h-6` (24px) in JSX | `min-height: 36px` | **Different** |
| Header hover background | **none** | `var(--cursor-bg-secondary)` | **Missing in Multi** |
| Body `padding: 0 10px 8px` | 66 | `6px 0` + no horizontal on body | **Different** |
| Body `border-top` | **none** | `1px solid var(--card-border-color, ...)` | **Missing in Multi** |
| Chevron opacity transition | lines 74–76 | opacity **not** transitioned | **Extra in Multi** |
| Chevron expanded opacity rule | 79–81 | `.ui-task-tool-call__chevron--open { opacity: 1 }` | **Same intent**, different hook (`data-expanded` vs class) |

### JSX / semantics gaps (not in `tool-call.css`)

| Area | Multi | Cursor |
|------|-------|--------|
| Title copy | `action` = "Working on task" | `gsv` = task description |
| Subtitle | `details` inline with action | `bsv` = Generating / Completed / latest nested step |
| Title layout | Single baseline row | Stacked column in `__title-area` |
| Shimmer target | `tool-call-shimmer` on action span | `ui-task-tool-call__shimmer` on **title** only |
| Root class | `data-task-tool-call` only | `ui-task-tool-call` only (no tool-line) |

### Rules that are “wrong” relative to Cursor

If the goal is Cursor parity:

1. **Wrong tokens** (lines 42–44): stroke tertiary + bg quinary — Cursor uses stroke **secondary** + bg **tertiary**.
2. **Wrong header model** (49–63 + JSX): inline tool-line header on a card — Cursor uses full-width flex card header.
3. **Missing** header hover fill and body top border.
4. **Not wrong to have a card** — deleting border/background would **diverge** from Cursor, not match it.

Applying card CSS to a **short inline** header makes chrome look heavier than Cursor’s 36px-tall card row.

---

## 5. Recommended fix (concrete)

### A. `tool-call.css` — replace tokens (do not delete card chrome)

| Line | Action |
|------|--------|
| 42 | `border-radius: var(--conversation-surface-border-radius, var(--multi-radius-card));` — add `--conversation-surface-border-radius` alias to `--multi-radius-card` or `--cursor-radius-xl` when known |
| 43 | `border: 1px solid var(--card-border-color, var(--cursor-stroke-secondary));` — add `--card-border-color: var(--cursor-stroke-secondary)` on timeline scope if needed |
| 44 | `background: var(--cursor-bg-tertiary, var(--multi-bg-tertiary));` — add to `tokens.css`: `--cursor-bg-tertiary: var(--multi-bg-tertiary);` |
| 49–63 | Replace header block with Cursor parity: `display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; min-height: 36px; width: 100%` |
| **new** | `[data-task-tool-call-header]:hover { background: var(--cursor-bg-secondary, var(--multi-bg-secondary)); }` |
| 66–67 | `border-top: 1px solid var(--card-border-color, var(--cursor-stroke-secondary)); padding: 6px 0;` — drop `0 10px 8px` unless turns need it |
| 74–76 | Chevron: `transition: transform 100ms ease` only (drop opacity from transition) |
| 79–81 | Keep expanded opacity `1`; optional rotate via Tailwind |

### B. `tool-renderer.tsx` — restructure `TaskToolCall` (~477–515)

1. **Title** = task description from tool args (mirror `gsv`), not `displayState.action`.
2. **Subtitle** = `Generating` / `Completed` / `Error` / latest nested step (mirror `bsv`); keep "Working on task" / "Completed task" only where generic `ToolCallLine` is used.
3. Markup:
   - `data-task-tool-call-status-icon`
   - `data-task-tool-call-title-area` > title + subtitle spans
   - Chevron with `data-expanded` rotating 90deg
4. Remove `inline-flex min-h-6 w-fit` tool-line classes from header button; use `w-full` card header.
5. Move shimmer from action to **title** when loading (`ui-task-tool-call__shimmer` / `.tool-call-shimmer` on title only).

### C. Do **not** delete

- Lines 41–47 border/background/radius — **retarget** tokens, don’t remove.
- Chevron hover/expand behavior — align timing, keep behavior.

### D. Optional token additions (`tokens.css`)

```css
--cursor-bg-tertiary: var(--multi-bg-tertiary);
--cursor-bg-secondary: var(--multi-bg-secondary);
--card-border-color: var(--cursor-stroke-secondary);
--conversation-surface-border-radius: var(--multi-radius-card);
```

---

## References

- Prior extracts: `.cursor/research/cursor-source-extracts.md` §4, §7
- Multi labels: `tool-renderer.tsx` L1230–1232
- Multi tokens: `tokens.css` L414–416, L438–450
