# Cursor subagent step row styling — audit

Asset: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
Multi sources read 2026-05-26.

---

## One-paragraph summary

Cursor renders nested subagent steps through the same `ui-tool-call-line` pipeline (`q$` / `ToolCallRenderer` via `renderStep` in `ysv` → `Udd`, and in the preview tray via the full composer `feh`) — there is **no subagent-specific step row class**. Multi's `SubagentActivityLine` already delegates to `ToolCallLine` or `ExpandableToolMetadataLine`, so the row primitive is fine. The parity gaps are:

1. **`subagent-preview-tray.tsx`** — delete the `SubagentActivityLine` adapter (lines 354–378), route snapshot/log items through `ToolCallRenderer`, flatten `data-subagent-tray-row` wrappers (lines 206–293).
2. **`conversation.css`** — remove the running-log gradient mask (lines 571–574); not present on Cursor step rows.
3. **Optional** — move `[data-tool-call-line]` typography from Tailwind `cva` in `tool-renderer.tsx` (lines 120–184) into `tool-call.css` to mirror Cursor's centralized `.ui-tool-call-line-*` rules.

---

## 1. Shared base row (`ui-tool-call-line`)

Cursor uses **flat classes** (no BEM `__icon` / `__action` / `__details` / `__chevron` modifiers):

- `.ui-tool-call-line` (root)
- `.ui-tool-call-line-action`
- `.ui-tool-call-line-details`
- `.ui-tool-call-line-shimmer`

Primary typography block at **byte 16346840, line 7695**:

| Property | Value |
| --- | --- |
| `font-size` | `var(--conversation-font-size, 13px)` |
| `line-height` | `1.5` |
| `gap` | `4px` |
| action color | `var(--cursor-text-secondary)`, hover → `var(--cursor-text-primary)` (100ms transition) |
| details color | `var(--cursor-text-tertiary)`, hover → `var(--cursor-text-secondary)` |

## 2. Row variants

- `ui-task-tool-call`: see `cursor-task-tool-card.md` (separate audit).
- `ui-shell-tool-call`: byte **16319943** — `font-size: 14px`, `line-height: 20px`, `letter-spacing: -0.15px`.
- **Subagent step row variant: not found.** Cursor reuses the same primitives.

## 3. Subagent step composition

Cursor reuses `renderStep` → `vRh` → `q$`. The preview tray embeds `feh` (full composer), not a custom row list. Nested task body: `ysv` → `Udd` → `renderStep`. Single pipeline.

## 4. Shimmer

- `@keyframes tool-call-line-shine` at byte **16314272**.
- `.ui-tool-call-line-shimmer` applied on action when `loading` in `q$` (byte **3146732**).
- Other variants: `.ui-task-tool-call__shimmer`, `.ui-edit-tool-call__filename--loading`, `.ui-collapsible-shimmer`.

## 5. Multi comparison

`SubagentActivityLine` (`subagent-preview-tray.tsx` lines 354–378) **does** delegate to `ToolCallLine` / `ExpandableToolMetadataLine`. Extra chrome added beyond Cursor:

| Multi | Location |
| --- | --- |
| tray body padding (`px-3 py-2`) | `subagent-preview-tray.tsx:213-214` |
| `data-subagent-tray-row` wrappers | `subagent-preview-tray.tsx:206-293` |
| `[data-subagent-running-log]` gradient mask | `conversation.css:571-574` |

Multi rows use `var(--multi-...)` via Tailwind (`text-multi-fg-*`), not hardcoded colors. Multi uses `data-tool-call-line` data hooks vs Cursor's `ui-tool-call-line` classes — equivalent, just a different selector strategy.

---

## 6. Recommended Multi changes (if the subagent flow stays as a tray)

| File | Lines | Change |
| --- | --- | --- |
| `subagent-preview-tray.tsx` | 354–378 | Delete `SubagentActivityLine` adapter; pass items into `ToolCallRenderer` directly. |
| `subagent-preview-tray.tsx` | 206–293 | Remove `data-subagent-tray-row` wrappers; emit rows flush like Cursor's `Udd`. |
| `conversation.css` | 571–574 | Remove `[data-subagent-running-log]` gradient mask. |
| `tool-renderer.tsx` | 120–184 | Move `[data-tool-call-line]` typography out of Tailwind `cva` into `tool-call.css` (optional consistency win). |

If the subagent flow is restructured to inline expansion under the task tool card (per `cursor-subagent-click-flow.md`), the tray-specific items above become moot.

## Evidence index

| Claim | Source |
| --- | --- |
| `ui-tool-call-line` base typography | byte 16346840, line 7695 |
| `ui-shell-tool-call` typography | byte 16319943 |
| `tool-call-line-shine` keyframes | byte 16314272 |
| `q$` shimmer wiring | byte 3146732 |
| Cursor `renderStep`/`Udd`/`ysv` chain | (cross-ref `cursor-subagent-click-flow.md`) |
| Multi `SubagentActivityLine` | `subagent-preview-tray.tsx:354-378` |
| Multi tray wrappers | `subagent-preview-tray.tsx:206-293` |
| Multi running-log gradient | `conversation.css:571-574` |
| Multi tool-line typography (Tailwind cva) | `tool-renderer.tsx:120-184` |
