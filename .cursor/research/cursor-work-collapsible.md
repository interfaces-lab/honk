# Cursor work collapsible audit (step group / `rXg`)

Asset: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` (61221385 bytes, mtime 2026-05-25). Embedded tool/step CSS lives in JS, not `workbench.desktop.main.css`. Re-grep before citing offsets on a different build.

Multi targets: `WorkGroupSection` in `packages/app/src/components/chat/timeline/messages-timeline.tsx`, `packages/app/src/styles/conversation.css`, `packages/app/src/styles/tool-call.css`.

---

## 1. Exact JSX / component structure (Cursor)

### Symbols

| Symbol | Role | JS location |
| ------ | ---- | ----------- |
| `Udd` | Step list container; maps groups to `rXg` | byte **3306777**, line **628** |
| `rXg` | Work-group collapsible root | byte **3303752**, line **628** |
| `I3e` | Generic collapsible (`ui-collapsible`) | byte **3148291**, line **607** |
| `hEh` | Expanded step list body | byte **3302081**, line **628** |
| `uEh` | Header label builder (`loadingAction` / `completedAction` / details) | byte **3300920**, line **628** |
| `iXg` | Appends file-change stats to details | byte **3290848** region, line **628** |
| `wsh` | **not found** in this build | — |

Note: `wsh` was not located. Step-group UI is `rXg` + `I3e` + `hEh`.

### Tree (expanded)

```text
Udd
  div[style: flex column, gap, --step-gap, --ui-collapsible-content-gap, ...]
    div[data-preview-scrollable][data-group-loading?]
      rXg
        div                          // plain wrapper, no className
          div.ui-step-group-header
            I3e.ui-step-group-collapsible[data-open][data-expandable]
              div.ui-collapsible-header[role=button][aria-expanded]
                span.ui-collapsible-action          // action label (e.g. "Exploring")
                span.ui-collapsible-details?        // details (e.g. "3 files", "16 browser actions")
                span.ui-collapsible-chevron?        // chevron-right, 10px
              div.ui-collapsible-content            // only when open && children
                hEh
                  div[style: flex column, gap var(--step-gap, 6px)]
                    map(steps) -> div[style: paddingInline] -> renderStep(...)
                    optional simulated-thinking row
          [when loading && !open]
          v1.ui-step-group-preview[maxHeight, cursor:pointer]
            div.ui-step-group-collapsible[ref]
              hEh[dimMessages=true]
```

### Header (`I3e` + `rXg`)

From byte **3305716** (line **628**):

```javascript
oe=$("div",{className:"ui-step-group-header",children:$(I3e,{className:"ui-step-group-collapsible",action:z,details:j,expandable:ae,open:f,onOpenChange:D,children:ue})})
```

`I3e` header children (byte **3148291**, line **607**):

```javascript
pe=Re("div",{className:"ui-collapsible-header",...Y,style:ne,children:[ae,ue,oe,k]})
// ae = span.ui-collapsible-action (action text)
// ue = span.ui-collapsible-details (details text, optional)
// oe = span.ui-collapsible-chevron (chevron-right, size 10, when expandable)
```

Action/details source (`rXg`): `z = cdd(d ? J.loadingAction : J.completedAction, 200, d)`, `j = iXg(V, W)` where `J = uEh(t)`.

Generic-group labels from `uEh` / `XZg` (byte **3300920**, line **628**): e.g. `loadingAction:"Exploring"`, `completedAction:"Explored"`, details like `` `${s} command${s===1?"":"s"}` `` or file-count strings. Multi's literal `Working · N steps` string was **not found** in this build (see `cursor-source-extracts.md`).

### Expanded body (`hEh`)

From byte **3302081** (line **628**):

```javascript
k={display:"flex",flexDirection:"column",gap:"var(--step-gap, 6px)"}
R=Re("div",{style:k,children:[E,A]})
```

Each step is a direct `div` with optional `paddingInline`; no intermediate card wrapper:

```javascript
$("div",{style:{paddingInline:mEh(M.step,g)},children: i(M.step,M.index,{...})},M.index)
```

Children render via `renderStep` prop (agent tool router), not a bordered container.

### Parent list wrapper (`Udd`)

From byte **3306777** (line **628**):

```javascript
Re("div",{style:{display:"flex",flexDirection:"column",gap:a,"--step-gap":`${a}px`,"--ui-collapsible-content-gap":`${a}px`,...},children:[...]})
```

Group shell:

```javascript
$("div",{"data-preview-scrollable":"false","data-group-loading":B||void 0,children:$(rXg,{...})})
```

---

## 2. Exact CSS rules (Cursor)

Step-group rules are in **embedded JS CSS**, not `workbench.desktop.main.css`. Main CSS has **no** `ui-step-group-*` selectors (grep: not found).

### Work-group container chrome

| Property | Work-group expanded container | Evidence |
| -------- | ----------------------------- | -------- |
| **border** | **no** | No `.ui-step-group-*`, `.ui-step-group-collapsible`, `.ui-step-group-header`, or `.ui-collapsible-content` rule sets `border`. |
| **background** | **no** | Same selectors; no `background` on step-group or collapsible-content blocks below. |
| **border-radius** | **no** | Not on step-group/collapsible-content. (`border-radius` on `.ui-task-tool-call` is a separate task-card surface.) |
| **padding** | **yes, top only on content** | `.ui-collapsible-content { padding-top: var(--ui-collapsible-content-gap, 4px); }` |

### Verbatim rules

#### `.ui-collapsible` base (byte **16826774**, embedded JS CSS, line **27131**)

```css
.ui-collapsible {
  display: flex;
  flex-direction: column;
}
```

#### `.ui-collapsible-header` (byte **16826838**, line **27136**)

```css
.ui-collapsible-header {
  display: flex;
  align-items: center;
  -webkit-user-select: none;
     -moz-user-select: none;
          user-select: none;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  outline: none !important;
  font-size: var(--conversation-font-size, 13px);
  line-height: 1.5;
}
```

#### `.ui-collapsible-chevron` + open/hover (byte **16827173**–**16827537**, line **27151**–**27161**)

```css
.ui-collapsible-chevron {
  margin-left: 4px;
  color: var(--cursor-text-tertiary);
  opacity: 0;
  transition: transform 0.15s ease-in-out, color 0.1s ease-in-out, opacity 0.1s ease-in-out;
}
.ui-collapsible-header:hover > .ui-collapsible-chevron {
  color: var(--cursor-text-secondary);
  opacity: 1;
}
.ui-collapsible[data-open=true] > .ui-collapsible-header > .ui-collapsible-chevron {
  transform: rotate(90deg);
  opacity: 1;
}
```

#### `.ui-collapsible-content` — expanded body wrapper (byte **16827770**, line **27170**)

```css
.ui-collapsible-content {
  display: flex;
  flex-direction: column;
  gap: var(--ui-collapsible-content-gap, 4px);
  padding-top: var(--ui-collapsible-content-gap, 4px);
  opacity: 1;
  transition: opacity 0.15s ease-in-out;
}
```

No `border`, `background`, or `border-radius` in this rule.

#### Step-group-specific (byte **16828165**–**16828609**, line **27187**–**27203**)

```css
.ui-step-group-header > .ui-collapsible > .ui-collapsible-header {
  padding-inline: var(--conversation-text-inset, 0px);
}

.ui-step-group-preview {
  padding-top: var(--step-gap, 6px);
}

[data-group-loading][data-preview-scrollable=false] .ui-step-group-preview {
  padding-top: 0;
}

[data-preview-scrollable=true] .ui-step-group-preview .ui-scroll-area__viewport {
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.15) 0px, black 32px);
  -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.15) 0px, black 32px);
}
```

#### File-change stats badge in header details (byte **16340924**, line **7464**)

```css
.ui-step-group-file-change-stats {
  display: inline-flex;
  gap: 4px;
  margin-left: var(--cursor-spacing-2);
}

.ui-step-group-file-change-stats [data-kind=additions] {
  color: var(--cursor-text-green-primary);
}

.ui-step-group-file-change-stats [data-kind=deletions] {
  color: var(--cursor-text-red-primary);
}
```

#### Dimmed preview markdown (byte **16828870** region, line **27209**)

```css
.ui-step-group-collapsible .markdown-root.markdown-normalized {
  opacity: 0.5;
}
```

### Transparency / no-chrome confirmation

Surrounding collapsible rules define layout and text motion only. The expanded body is a flex column with gap + `padding-top`; header is flex row with `outline: none !important` and no `background` or `border` on hover. Child tool rows may bring their own chrome (e.g. `.ui-task-tool-call` has border/bg at byte **16341242**), but the **work-group shell does not**.

---

## 3. Header vs body differences

### Header hover / focus

- **Hover background:** **no** — no `background` on `.ui-collapsible-header` or `:hover` variants in step-group CSS block.
- **Hover affordance:** chevron opacity/color only:

```css
.ui-collapsible-header:hover > .ui-collapsible-chevron {
  color: var(--cursor-text-secondary);
  opacity: 1;
}
```

(byte **16827297**, line **27157**)

- Loading-group override (byte **16827640**, line **27165**):

```css
[data-group-loading]:hover > * > .ui-step-group-header > .ui-collapsible > .ui-collapsible-header > .ui-collapsible-chevron {
  opacity: 1;
  transition: none;
}
```

- **Focus ring:** **no** — `outline: none !important` on `.ui-collapsible-header` (byte **16826838**).
- **Header text colors:** action uses inline `color: var(--cursor-text-secondary)` in `I3e`; details use inline `color: var(--cursor-text-tertiary)` (byte **3148291**, line **607**).
- **Shimmer while loading:** `.ui-collapsible-shimmer` on action/details (text gradient animation, byte **16829008**, line **27213**); not a box background.

### Count / details badge (`· N steps` equivalent)

Cursor does not use a separate pill badge. Step/command counts live in **`span.ui-collapsible-details`** beside the action, styled inline as tertiary text and optionally extended by `iXg` with `span.ui-step-group-file-change-stats` (+/− counts).

Example details strings from label builders (byte **3300920**, line **628**): `` `${i} browser action${i===1?"":"s"}` ``, `` `${s} command${s===1?"":"s"}` ``, file-count strings from `ZZg`.

---

## 4. Compare to Multi

### Multi component structure (`WorkGroupSection`)

Root (lines **869**–**925**, `messages-timeline.tsx`):

```tsx
<div data-assistant-work-group="" data-work-group-expanded=... data-work-group-running=... className="flex ... gap-(--chat-timeline-collapsible-header-gap) py-0.5 text-conversation">
  <button data-work-group-header="" className="... border-0 bg-transparent p-0 ... hover:text-multi-fg-secondary ...">
    <span>{headerLabel}</span>
    {!expanded && !isRunning && !isThinkingGroup ? ( <> · <WorkGroupSummaryLine /> </> ) : null}
    <IconChevronRightMedium className="... rotate-90 when expanded" />
  </button>
  {expanded ? (
    <div className="flex min-w-0 max-w-full flex-col gap-(--chat-timeline-step-gap)">
      {!isCommandGroup ? <WorkGroupSummaryLine summary={summary} /> : null}
      {row.groupedEntries.map(... ToolCallMessage ...)}
    </div>
  ) : isRunning ? <WorkGroupPreview ... /> : null}
</div>
```

Expanded body: direct flex column of `ToolCallMessage` rows — structurally aligned with Cursor's `hEh` flex column. No wrapper card on the group body.

### Multi CSS on work-group container

**No selectors** for `[data-assistant-work-group]`, `[data-work-group-expanded]`, or `[data-work-group-header]` in `conversation.css` or `tool-call.css`.

Work-group-related rules in `conversation.css`:

```css
[data-work-group-preview] {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 32px, #000 100%);
  mask-image: linear-gradient(to bottom, transparent 0, #000 32px, #000 100%);
}

[data-work-group-preview][data-work-preview-scrollable="false"] {
  -webkit-mask-image: none;
  mask-image: none;
}
```

(lines **392**–**400**) — preview fade only; no border/background on expanded body.

Tokens (lines **8**–**9**): `--chat-timeline-step-gap: 6px`, `--chat-timeline-collapsible-header-gap: 4px` — match Cursor `--step-gap` / header gap intent.

### Where Multi adds card chrome (inside expanded groups)

These are **child row** styles, not work-group container rules, but they produce the bordered/card look the user reported:

| Location | Rule / classes | Border | Background | Radius | Padding |
| -------- | -------------- | ------ | ---------- | ------ | ------- |
| `tool-call.css` **41**–**46** | `[data-task-tool-call]` | `1px solid var(--multi-stroke-tertiary)` | `var(--multi-bg-quinary)` | `var(--multi-radius-card)` | header **53**–**53**: `6px 10px`; body **66**: `0 10px 8px` |
| `tool-message.tsx` **92** | `[data-tool-summary]` Tailwind | `border border-multi-stroke-tertiary` | `bg-multi-bg-quinary` | `rounded-multi-control` | `px-3 py-2` |
| `tool-renderer.tsx` **736**–**737** | metadata/read expanded body | `border border-multi-stroke-secondary` | `bg-multi-editor` | `rounded-multi-control` | `px-(--conversation-tool-card-padding-x) py-1.5` |
| `tool-renderer.tsx` **882**–**883** | shell expanded body | `border ... border-multi-stroke-secondary` | `bg-multi-editor` | `rounded-multi-control` | `px-(--conversation-tool-card-padding-x) py-1.5` |

Cursor equivalents:

- **Task card:** `.ui-task-tool-call { border: 1px solid ...; background: var(--cursor-bg-tertiary); border-radius: ... }` (byte **16341242**) — **intentional** card; Multi parity here is correct.
- **Shell tool root:** `.ui-shell-tool-call { padding-inline: 0; }` only (byte **16319943**) — **no** border/bg on the line; expanded output uses `.ui-shell-tool-call__accordion-body { border: 1px solid ...; background: ... }` (byte **16321529**) only when expanded.
- **Work-group shell:** no border/bg (section 2).

### Concrete diffs

| Surface | Cursor | Multi |
| ------- | ------ | ----- |
| Work-group expanded container | no border, no background, no radius; `padding-top` on `.ui-collapsible-content` only | no border/background/radius on `[data-assistant-work-group]` expanded `<div>`; gap via `--chat-timeline-step-gap` |
| Work-group header | text + chevron hover; no header background | `border-0 bg-transparent`; text color hover (`hover:text-multi-fg-secondary`) — aligned |
| Step count presentation | inline `ui-collapsible-details` (tertiary text) in header | collapsed: `WorkGroupSummaryLine` in header after `·`; expanded: duplicate `WorkGroupSummaryLine` below header (`messages-timeline.tsx` **905**) |
| Chevron | hidden until hover/open; `opacity: 0` default | always visible in header (`IconChevronRightMedium`, line **896**–**901**); no opacity-0 / hover-reveal |
| Collapsed running preview | `ui-step-group-preview` + gradient mask on scroll viewport | `[data-work-group-preview]` + mask in `conversation.css` **392**–**395** — similar |
| Child tool lines in group | compact lines by default; cards on specific tools when expanded | task summary rows and several expanded tool bodies always use bordered `bg-multi-editor` / `bg-multi-bg-quinary` cards |

**Summary:** Multi's **work-group wrapper** is not over-styled relative to Cursor. The visible "card stack" in an expanded group likely comes from **child row** rules (`[data-tool-summary]`, expanded shell/metadata bodies, and always-on task cards), not from a group-level border.

---

## 5. Recommended fix

### A. Keep work-group shell as-is (no new container chrome)

Do **not** add border, background, or radius to `[data-assistant-work-group]` or its expanded body. Cursor's expanded body is plain flex + gap; Multi already matches at lines **904**–**916**.

### B. Align header chevron with Cursor hover-only reveal

Adopt Cursor's chevron behavior on `[data-work-group-header]`:

```css
[data-work-group-header] [data-work-group-chevron] {
  opacity: 0;
  transition: transform 150ms ease-in-out, opacity 100ms ease-in-out;
}
[data-work-group-header]:hover [data-work-group-chevron],
[data-assistant-work-group][data-work-group-expanded="true"] [data-work-group-chevron] {
  opacity: 1;
}
[data-assistant-work-group][data-work-group-expanded="true"] [data-work-group-chevron] {
  transform: rotate(90deg);
}
```

(Cursor source: byte **16827173**–**16827537**.)

Add `data-work-group-chevron` on the icon in `messages-timeline.tsx` **896**–**901**.

### C. Move step count into header details (optional parity)

Cursor keeps action + details on one header row via `ui-collapsible-action` + `ui-collapsible-details`. Multi should render `summary.details` (e.g. `16 steps`) in the header while expanded, and **remove** the duplicate `WorkGroupSummaryLine` below the header when expanded (**905**) unless product wants the extra summary row.

### D. Remove card chrome from non-task rows inside work groups

If the goal is "no card backgrounds in expanded work groups" for generic tool lines:

1. **`tool-message.tsx` line 92** — remove `rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary px-3 py-2` from `[data-tool-summary]`; render as a compact line (Cursor has no bordered summary card in the step-group CSS grep).
2. **`tool-renderer.tsx` lines 736–737, 882–883, 1030–1032** — gate bordered `bg-multi-editor` blocks on `conversationDensity !== "minimal"` (work-group children pass `conversationDensity="minimal"` from `tool-message.tsx` **77**). In minimal mode, match Cursor compact lines; show bordered accordion/output only when expanded in detailed density or for shell accordion body parity (`.ui-shell-tool-call__accordion-body` at byte **16321529**).
3. **Keep** `[data-task-tool-call]` rules in `tool-call.css` **41**–**46** — Cursor `.ui-task-tool-call` legitimately uses border/bg.

### E. No deletions needed in `conversation.css` for expanded body

Rules at **392**–**400** are preview-only and align with Cursor's preview mask. Leave them.

---

## Re-grep recipe

```bash
JS="/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js"
python3 - <<'PY'
from pathlib import Path
js = Path("$JS").read_text(errors="ignore")
for s in ("function rXg(", "function I3e(", "function hEh(", ".ui-step-group-header", ".ui-collapsible-content {"):
    i = js.find(s)
    print(s, i, js[:i].count("\\n")+1 if i>=0 else "missing")
PY
```
