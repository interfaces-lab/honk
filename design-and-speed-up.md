# Design And Speed Up Notes

## Cursor Search Findings

- Five subagents searched `/Applications/Cursor.app`.
- Exact `@anysphere/ui/primitives/` paths were not present in the installed app bundle.
- The recoverable UI surface is bundled `@anysphere/ui`, compiled `.ui-*` CSS, and canvas SDK declarations.
- Cursor primitives use compound namespaces such as `Dialog.Root` style exports via `Object.assign`.
- Cursor primitives favor stable classes plus `data-*` attributes for variant state: `data-variant`, `data-size`, `data-shape`, `data-color`.
- Trigger composition uses a Slot-style merge model. Base UI's `render` prop already gives Multikit the same underlying capability, so the first step is to standardize metadata and guardrails instead of replacing Base UI composition.
- Cursor tokens split text, icon, background, and stroke roles into separate semantic tiers. Multikit already does this with `--multi-fg-*`, `--multi-icon-*`, `--multi-bg-*`, and `--multi-stroke-*`.

## Solid And Data Loading Findings

- Cursor bundles `solid-js`, `@tanstack/solid-query`, and `@tanstack/solid-virtual`.
- No named Solid-to-React translator or bridge module was found.
- Translator-like code in the bundle was React/MDX and ProseMirror React renderer code, not Solid-to-React.
- The useful pattern is an owned reactive root with explicit disposal, dependency-keyed resources, abortable producers, bounded stale times, and tactical query prefetching.
- Multikit should remain primitive-only. Data loading should live in app-owned resource/query roots, not design-system components.

## Changes Made

- Converted Multikit `Button` to build on Base UI `@base-ui/react/button` instead of local `useRender` button plumbing.
- Added stable primitive metadata to `Button`: `data-size` and `data-variant`.
- Added a runtime guard warning when icon-only `Button` sizes lack `aria-label`, `aria-labelledby`, or `title`.
- Added stable primitive metadata to `SelectButton` and `SelectTrigger`: `data-size` and `data-variant`.
- Added stable workbench button metadata: `data-slot`, `data-active`, `data-chrome`, `data-tab-system`, and `data-tone`.
- Added missing Cursor-style primitives with durable product value: `Checkbox`, `Card`, `Code`, `Pre`, `Link`, `Stat`, and `Table`.
- Added the next durable primitive wave from Cursor's `.ui-*` surface: `Avatar`, `HoverCard`, `Icon`, `InputGroup`, and `SplitButton`.
- Added Cursor canvas chart coverage: `BarChart`, `LineChart`, and `PieChart`.
- Added Cursor layout primitive coverage as `@multi/multikit/layout`: `Stack`, `Row`, `Grid`, and `Spacer`.
- Registered existing Multikit toast chrome in the dev catalog and preview surface.
- Filled `/dev/multikit` catalog and DialKit preview coverage for existing exported visual primitives: `Autocomplete`, `Combobox`, `ContextMenu`, `Command`, `RadioGroup`, `Toggle`, and `ToggleGroup`.
- Extracted Cursor-like `ui-tab-system` row chrome into `@multi/multikit/workbench-chrome-row` and replaced duplicated shell tab-bar row/button/menu markup with Multikit primitives.
- Moved Cursor-like `ui-tray-row` queue row chrome into `@multi/multikit/sidebar` tray-row parts and replaced queued composer row markup with those parts.
- Moved tray shell/header chrome into generic `@multi/multikit/sidebar` tray parts and replaced the queued composer panel shell.
- Replaced queued composer row action buttons and edit-banner cancel button with Multikit `Button`.
- Replaced additional chat dismiss/cancel/close controls with Multikit `Button`: thread error dismiss, human-message expand toggle, inline edit cancel, plan tray dismiss, and subagent tray close.
- Replaced context-window popover trigger buttons with Multikit `Button` while preserving Base UI `PopoverTrigger` composition.
- Moved Cursor-like `ui-scroll-area` ownership to `@multi/multikit/scroll-area` and replaced the plan workbench native overflow wrapper with `ScrollArea`.
- Moved Cursor-like tab icon content/badge hooks into `WorkbenchTabIconContent`.
- Moved Cursor-like `data-tool-call-line` chrome into `@multi/multikit/tool-call` and updated the app tool renderer/subagent tray to consume it.
- Moved shared `tool-call-shimmer` animation and reduced-motion fallback into `@multi/multikit/styles.css` because `ToolCallLine` and app chat rows both depend on it.
- Added `status` and `className` support to `ToolCallLine` so chat loading/completed/error states can be previewed and reused without app-only styling hooks.
- Expanded chat-adjacent DialKit previews: toast kind/action/expanded state, tray row status, and tool-call status/truncation width.
- Audited `packages/app/src/app` route UI. No native button/input/select/textarea/anchor/pre/code controls remain there; root status cards now use `Card` + `CardBody` without app-owned card chrome.
- Did not keep broad Cursor-name aliases after council review; they widened API surface without product usage.

## Cursor Primitive Coverage

| Cursor primitive | Multikit status |
| --- | --- |
| Button | `@multi/multikit/button` backed by Base UI Button |
| Checkbox | Added `@multi/multikit/checkbox` backed by Base UI Checkbox |
| IconButton | Covered by `Button size="icon*"` and `WorkbenchIconButton` |
| Select | `@multi/multikit/select` backed by Base UI Select |
| TextArea | Existing `@multi/multikit/textarea` |
| TextInput | Existing `@multi/multikit/input` |
| Toggle | `@multi/multikit/toggle` |
| ToggleGroup | Existing `@multi/multikit/toggle-group`; now cataloged and previewed |
| RadioGroup | Existing `@multi/multikit/radio-group`; now cataloged and previewed |
| Autocomplete | Existing `@multi/multikit/autocomplete`; now cataloged and previewed |
| Combobox | Existing `@multi/multikit/combobox`; now cataloged and previewed |
| Callout | Existing `@multi/multikit/alert`; no alias kept |
| Card, CardBody, CardHeader | Added `@multi/multikit/card` |
| Code | Added `@multi/multikit/code` |
| Divider | Existing `@multi/multikit/separator`; no alias kept |
| Grid, Row, Spacer, Stack | Added `@multi/multikit/layout` as narrow structural wrappers |
| H1, H2, H3, Text | `@multi/multikit/text` now supports `as` for semantic elements |
| Link | Added `@multi/multikit/link` |
| Pill | Existing `@multi/multikit/badge`; no alias kept |
| Stat | Added `@multi/multikit/stat` |
| Table | Added `@multi/multikit/table` |
| Avatar | Added `@multi/multikit/avatar` backed by Base UI Avatar |
| Dialog | `@multi/multikit/dialog` backed by Base UI Dialog |
| HoverCard | Added `@multi/multikit/hover-card` backed by Base UI PreviewCard |
| Icon | Added `@multi/multikit/icon` as a central-icons size/tone wrapper |
| InputGroup | Added `@multi/multikit/input-group` as a shared shell around existing input/textarea/button primitives |
| Menu | `@multi/multikit/menu` backed by Base UI Menu |
| ContextMenu | Existing `@multi/multikit/context-menu`; now cataloged and previewed |
| Command | Existing `@multi/multikit/command`; now cataloged and previewed |
| SplitButton | Added `@multi/multikit/split-button` by composing ButtonGroup and Menu |
| TabSystem / WorkbenchChromeRow | Added `@multi/multikit/workbench-chrome-row`; shell tab bar now uses it |
| TabIconContent | Added `WorkbenchTabIconContent` to `@multi/multikit/workbench-button` |
| Tray / TrayRow | Added tray shell/header/row parts to `@multi/multikit/sidebar`; queued composer panel now uses them |
| ScrollArea | Existing `@multi/multikit/scroll-area`; now owns `ui-scroll-area` hook and plan panel uses it |
| ToolCallLine | Added `@multi/multikit/tool-call`; app renderer still owns runtime-specific tool bodies |
| BarChart, LineChart, PieChart | Added `@multi/multikit/chart` as lightweight SVG primitives |
| Toast | Existing `@multi/multikit/toast`; now cataloged and previewed |

## Tradeoffs

- Kept CVA class generation for now. Cursor's CSS is more `data-*` driven, but a full rewrite would be noisy and risk unrelated behavior.
- Did not add Solid to the app. Cursor's Solid usage is a runtime/data architecture decision, not a Multikit primitive dependency.
- Did not remove existing `render={<Button />}` composition. Base UI owns that contract today; swapping it out would affect product call sites and should be a separate migration.
- Re-centered the redesign boundary after council review: Multikit owns durable primitive chrome and Base UI behavior; app-specific toast stack math, routing status layout, and chat timeline orchestration stay in app-owned code.
- Aligned `Text` with Cursor's recovered pattern: semantic element is `as`, while visual presentation remains `size`/`tone`/`weight`. `h1` is not a visual variant.
- Removed broad Cursor-name aliases. Layout coverage was later reintroduced as a narrow `layout` subpath because the explicit goal is full Cursor primitive coverage; it does not replace product-owned Tailwind composition for bespoke surfaces.
- Implemented chart primitives without a new charting dependency. This covers Cursor's primitive declarations while keeping Multikit light; richer analytics can still choose a product-owned chart package later.
- Implemented layout primitives without app-specific spacing tokens or routing/data behavior. They expose only structural props (`gap`, `align`, `justify`, `columns`, `wrap`, `size`) plus `className`.
- Used Base UI PreviewCard for Hover Card instead of Popover because the primitive is hover/focus preview behavior, not click-owned disclosure.
- Built Split Button from existing Multikit ButtonGroup/Menu primitives so the menu and button styling remain centralized.
- Added `Icon` as a wrapper around `central-icons`, not as a competing icon source.
- Kept toast stack math in app code. Multikit owns the root/content/action chrome; app-owned thread scoping, viewport math, and timer behavior stay outside primitives.
- Set the preview standard: every exported visual primitive gets a DialKit-backed preview, while chat-specific previews expose primitive states instead of app data loading, routing, or runtime behavior.
- For chat-related primitives, DialKit should cover prop/state axes that affect layout and perceived performance: truncation, loading/error state, selected/interactive row state, and toast action/chrome. Runtime data loading and timeline orchestration remain outside preview scope.
- Added scenario previews for the most chat-facing primitives: toast can show a stack, and tool-call can show all statuses together. Other primitives keep targeted controls for their own visual axes instead of exposing every prop.
- Centralized interactive cursor styling in Multikit helpers. Button-like controls use the shared cursor token; roving listbox/menu option rows intentionally keep `cursor-default`, and disabled controls keep disabled cursor affordance.
- Five follow-up council agents audited primitive coverage, app migrations, style drift, DialKit previews, and Base UI/API alignment. They confirmed catalog/preview registration is complete (`49` visual exports, no missing catalog or preview entries) but identified exact-name Cursor aliases, task/shell tool-call composites, and stronger chat scenario previews as remaining gaps.
- Migrated additional clear app surfaces to Multikit: root error details use `Collapsible`, proposed-plan editing uses `Textarea`, read-only rich text uses `Pre`/`Code`/`Link`, chat title uses `Button`, and scroll-to-bottom uses `Button`.
- Tightened primitive APIs: Workbench buttons compose Multikit `Button`, clickable `ToolCallLine` uses Base UI Button, `Text` has better element typing with no unused `data-element`, `ToastAction` forwards custom-render classes, and modal/tab transitions avoid `transition-all`.
- Strengthened DialKit previews for council-flagged primitive states: `CardFooter`, table density/empty/long-cell states, alert icon/action/titleless/long-copy states, popover side/align/tooltip/workbench states, and menu workbench/icon/disabled/checkbox/radio states.
- Strengthened the remaining chat-facing DialKit previews after the council pass: `Command` now covers palette/composer/positioned-composer modes plus loading/empty/result states, `Sidebar` now covers queue-style tray rows with selected/editing/busy rows, and `Toast` now covers stack/collapsed-stack/error-copy/anchored-tooltip scenarios and viewport position controls.
- Moved the queue tray row overflow rule into `SidebarTrayRowContent` so Multikit owns the reusable row clipping behavior instead of `conversation.css`.
- Extracted task/shell tool-call chrome into `@multi/multikit/tool-call` slots: task root/header/status/title/body, shell root/header/body, and a shared line chevron. The app `ToolCallRenderer` now composes these slots while keeping runtime artifact/output/subagent behavior app-owned.
- Trimmed `packages/app/src/styles/tool-call.css` down to lifecycle hooks; task/shell layout and reduced-motion behavior now live in Multikit classes.
- Expanded the Tool Call DialKit preview to cover line, status matrix, task, and shell scenarios.
- Migrated generic tool-renderer expansion/file controls to Multikit `Button`; `tool-renderer.tsx` no longer uses raw buttons or `div role="button"` for tool-line interactions.
- Migrated markdown mermaid/code-copy controls and all audited composer controls to Multikit `Button`. Streaming submit/stop now uses a local `ComposerActionButton` wrapper because it combines submit, interrupt, busy/running state, and send-while-streaming settings while still needing Multikit's Base UI button foundation.
- Replaced remaining raw composer-folder buttons: attachment preview, pending user-input option rows, and inline prompt command chips now use Multikit `Button` with local layout-preserving class overrides.
- Replaced the remaining raw chat component buttons with Multikit `Button`: work-group headers, subagent status rows, human-message image previews, expanded-image backdrop close, and subagent-tray click capture. `rg "<button"` now returns no matches under `packages/app/src/components/chat`.
- Kept product composites out of this pass even when Cursor has `.ui-*` class families for them; reusable primitive coverage and app extraction are separate decisions.
- Kept specialized editor, markdown, image preview/backdrop, composer submit/interrupt, user-input option, click-capture, and tool/timeline expansion behavior app-owned. These surfaces now use Multikit `Button` where they are interactive, but their layout and runtime-specific semantics should not be flattened into generic primitive APIs without dedicated component boundaries.
- Preserved shell CSS compatibility by keeping `ui-tab-system`/`editor-panel-tab-root` class hooks inside the Multikit workbench row primitive.
- After subagent review, moved more shared workbench row ownership into `@multi/multikit/workbench-chrome-row`: baseline font/text styling plus action group, divider, label, spacer, and text-control variants. Right workbench and git panel headers now consume those instead of repeating row sizing/gap/typography classes.
- Corrected the local branch chrome to match Cursor more closely: no branch icon in the chrome row and no monospace branch label; the row inherits WorkbenchChromeRow typography.
- Kept `ui-tab-system`, `editor-panel-tab-root`, `editor-panel-tab-bar-tab-cluster`, and `editor-panel-tab-bar-spacer` in Multikit because they are compatibility hooks for tab layout and drag regions.
- Preserved queue CSS compatibility by keeping `ui-tray-row` hooks inside the Multikit sidebar tray-row parts.
- Kept tray shell hooks generic (`ui-tray`, `ui-tray-header`) because no queue CSS depended on the old `--queued` names; queue-specific state stays on app `data-queued-*` attributes.
- Preserved scroll-area CSS compatibility by moving `ui-scroll-area` into the Multikit `ScrollArea` root.
- Kept the full tool renderer out of Multikit because it is tied to runtime cases, file/diff artifacts, shell output, and subagent transcript state.

## Next Decisions

- GPT-5.5 medium whole-interface council audit returned 30 Cursor-comparison improvements for text crispness, primitive usage, and chrome density:
  1. **P1 pending** — replace the work-group preview `div role="button"` in `step-renderer.tsx` with a real Multikit `Button`/workbench primitive.
  2. **P1 pending** — migrate the terminal drawer action button in `thread-terminal-drawer.tsx` to `WorkbenchIconButton`.
  3. **P1 pending** — remove uppercase tracking from terminal drawer group headers and use tokenized label text.
  4. **P1 pending** — replace terminal row activate/close raw buttons with sidebar or workbench primitives.
  5. **P1 pending** — move shell titlebar toggles in `shell/shell/app.tsx` to workbench icon-button chrome instead of hand-built button classes.
  6. **P1 pending** — replace bespoke agent-sidebar `SidebarIconButton` with a Multikit button/sidebar primitive.
  7. **P1 pending** — move custom agent section-title triggers onto sidebar primitives.
  8. **P1 pending** — migrate terminal rail raw button groups to sidebar tray/item primitives.
  9. **P1 implemented** — migrated command-palette submenu back control from a raw button to Multikit `Button size="icon-xs"`.
  10. **P1 implemented** — added reduced-motion fallback to Multikit `Spinner`.
  11. **P1 implemented** — tightened root status eyebrow tracking and typography.
  12. **P1 implemented** — replaced root status title arbitrary large sizing with `text-title`/`text-heading` tokens.
  13. **P1 implemented** — moved composer agent-mode trigger onto `workbenchChromeTextControlVariants()`.
  14. **P2 deferred** — composer submit/stop still has local stateful classes; keep app-owned until a reusable submit/interrupt primitive is designed.
  15. **P2 implemented** — normalized composer busy copy to use a single ellipsis glyph.
  16. **P1 implemented** — tokenized context-window usage details and removed wide tracking.
  17. **P1 implemented** — removed tiny numeric text from the context-window ring and replaced it with a crisp status dot.
  18. **P1 implemented** — tightened pending approval typography to `text-caption`/`text-detail` with no wide tracking.
  19. **P1 implemented** — tokenized git kind badge text to `text-detail`.
  20. **P1 implemented** — softened git diff-card file-label weight and color for Cursor-like dense chrome.
  21. **P2 deferred** — full git commit split action remains app-owned because the primary action also stops in-flight agent work.
  22. **P1 implemented** — migrated empty file preview “Open File” action to Multikit `Button`.
  23. **P1 implemented** — migrated settings active footer control to Multikit `Button`.
  24. **P2 deferred** — appearance range slider should become a Multikit slider once Base UI slider coverage is added.
  25. **P2 deferred** — appearance number stepper should move into a real input-group/stepper primitive instead of a class bucket.
  26. **P1 implemented** — tokenized remaining Multikit combobox group/empty/status text.
  27. **P1 implemented** — tokenized Multikit tooltip typography to `text-detail`.
  28. **P2 deferred** — queued composer panel chrome still has app CSS; defer until the next chat tray extraction.
  29. **P2 deferred** — shell simple-tab geometry overrides still live in app CSS for compatibility; keep until tab-system ownership is fully moved.
  30. **P3 deferred** — dev-only branching prototypes still use raw tiny text/buttons; quarantine or migrate after product surfaces are settled.
- Cursor chrome correction applied: panel title/filter chrome should not carry decorative icons or monospace styling. Removed the `Thread Tree` title icon and the decorative folder icon in the changes filter; keep icons only for actual controls or code/path/terminal content.
- Follow-up source audit corrected the diff layout decision: Pierre's React wrapper keeps a persistent `FileDiff`/`PatchDiff` instance and `flushManagers()` installs `ResizeManager` observers on rendered code columns. t3code uses `FileDiff` inside `Virtualizer` without width keys, and opencode uses low-level `FileDiff`/`VirtualizedFileDiff` with `setOptions`/`render`/`rerender` for data changes. Removed the synthetic rail-width `layoutKey` remount path to avoid unnecessary Git panel churn, and memoized `DiffViewer` options so Pierre's `areOptionsEqual()` can take the reference-equality fast path when theme/style are unchanged.
- GPT-5.5 medium council audit returned 20 Cursor-alignment and CSS-trimming opportunities:
  1. **P1 implemented** — remove negative chat markdown tracking in `packages/app/src/styles/markdown.css` for crisper macOS Retina text.
  2. **P1 implemented** — migrate `Init Git` from a raw button to Multikit `Button` in `packages/app/src/components/shell/git/panel.tsx`.
  3. **P1 implemented** — replace the git editor-options custom menu/backdrop with Multikit `Menu`, `MenuTrigger`, `MenuPopup variant="workbench"`, and radio items.
  4. **P1 partially implemented** — replace the git commit dropdown popup with Multikit `MenuPopup` and use Multikit `Button` for the primary action. A fuller `SplitButton` API fit is deferred because the primary action doubles as an in-flight stop control.
  5. **P1 implemented** — replace `GitDiffCard`'s `div role="button"` header with a real Multikit `Button` expansion target.
  6. **P1 implemented** — migrate git diff-card copy/revert controls to `WorkbenchIconButton`.
  7. **P1 implemented** — migrate git diff-card viewed control to Multikit `Checkbox`.
  8. **P1 implemented** — respect `prefers-reduced-motion` for selected-diff scroll behavior.
  9. **P2 implemented** — replace markdown heading arbitrary `clamp()`/`max()` sizes with Multi text token utilities.
  10. **P2 implemented** — normalize workbench `Menu` typography from fixed 11/12px classes to `text-body`/`text-detail`.
  11. **P2 implemented** — normalize `Autocomplete` item, label, empty, and status typography to text tokens.
  12. **P2 implemented** — normalize dense `Select` trigger and group-label typography to text tokens.
  13. **P2 implemented** — normalize `Command` input, shortcut, and footer typography to text tokens.
  14. **P2 implemented** — reuse `ToolCallLineChevron` in `ExpandableToolMetadataLine`.
  15. **P2 implemented** — reuse `ToolCallLineChevron` in edit tool-call expansion.
  16. **P2 implemented** — add reduced-motion handling to loading toast icon spins.
  17. **P2 implemented** — add reduced-motion handling to the composer send spinner.
  18. **P2 implemented** — extracted repeated `workspace-toolbar.tsx` trigger text-control styling into `workbenchChromeTextControlVariants()` and converted workspace toolbar menu metadata/status text to `text-body`/`text-detail`.
  19. **P3 implemented** — tighten pending extension UI request typography to `text-detail`/`text-caption` and remove wide tracking.
  20. **P3 implemented** — migrated `thread-tree-panel.tsx` title chrome to `WorkbenchChromeRow` and replaced hardcoded tiny text sizes with `text-body`/`text-detail`/`text-caption`.
- GPT-5.5 medium audit found 10 detail improvements to compare against Cursor and tighten text/rendering quality:
  1. **P1: Remove negative chat markdown tracking** — `packages/app/src/styles/markdown.css` uses `letter-spacing: -0.005em`; remove it so small chat text stays crisper on macOS Retina and matches the app-wide `letter-spacing: 0` baseline.
  2. **P2: Tokenize markdown headings** — `chat-markdown.tsx` still uses `clamp()`/`max()` heading sizes; map headings to Multi text tokens (`text-heading`, `text-title`, `text-conversation`) to keep Cursor-like compact density.
  3. **P2: Normalize workbench menu typography** — `packages/multikit/src/menu.tsx` uses fixed `12px/16px` and `11px/14px`; move workbench menu rows/meta/labels to `text-body`/`text-detail` token classes.
  4. **P2: Normalize autocomplete typography** — `packages/multikit/src/autocomplete.tsx` uses fixed `12px`/`11px`; switch item, label, and empty-state text to Multikit tokens so user font size preferences propagate.
  5. **P1: Replace git panel custom popups with Multikit Menu** — `packages/app/src/components/shell/git/panel.tsx` still has hand-built editor/commit popups and backdrop buttons; use `Menu`, `MenuTrigger`, and `MenuPopup variant="workbench"`.
  6. **P2: Tokenize Git commit split button** — the Git primary action still has raw split-button markup and `rose-500`; compose with Multikit `SplitButton`/`Button` and semantic pending/stop tokens.
  7. **P2: Bring Git diff-card header controls into workbench primitives** — `git-diff-card.tsx` still uses raw 14px toggles, icon buttons, fixed text sizes, and native checkbox; migrate to `WorkbenchIconButton`, `Checkbox`, and token text classes.
  8. **P2: Respect reduced motion when scrolling selected diffs** — selected diff scrolling uses unconditional `behavior: "smooth"`; switch to `auto` under `prefers-reduced-motion: reduce`.
  9. **P3: Reuse shared tool-call chevron motion** — `tool-renderer.tsx` still duplicates a chevron with `duration-150`; use `ToolCallLineChevron` or its tokenized reduced-motion classes.
  10. **P3: Disable toast spinner motion under reduced motion** — loading toast icons still use `animate-spin`; add `motion-reduce:animate-none`.
- Move shared component variants from large inline Tailwind strings into `data-*` CSS only where multiple primitives share the same state matrix.
- Keep task/shell tool-call behavior app-owned unless a repeated product surface emerges. Multikit now owns the reusable Cursor-like slots; the app still owns command/output policy, approvals, file/diff artifacts, and subagent transcript rendering.
- Keep strengthening chat-facing DialKit scenarios when extracting new chat primitives. Current preview coverage is complete by exported primitive and stronger for `command`, `sidebar`, `toast`, and `tool-call`; remaining work is not registration, but any future extracted chat composites.
- Decide whether exact Cursor-name aliases (`IconButton`, `TextInput`, `TextArea`, `Callout`, `Divider`, `Pill`, `H1/H2/H3`) are worth the API surface; current direction keeps Multi names and documents equivalence.
- If app data loading remains heavy, choose one narrow workflow and prototype an owned resource root with abortable producers before introducing a new dependency.
- Keep Multikit exports explicit by subpath and avoid adding app/router/RPC data hooks to primitives.
- Do not push generic layout/card primitives into `chat-view.tsx` unless a repeated chat-specific surface emerges; the existing chat view depends on precise timeline, overflow, branch, and composer behavior.

## Verification Notes

- Cursor gap correction: Cursor's compiled workbench keeps toolbar item gaps at `2px`, while icon+text UI controls use `--cursor-spacing-1` (`4px`) internally and `--cursor-spacing-1-5` (`6px`) for pill-like horizontal spacing. Multikit now mirrors that split with `--multi-workbench-chrome-action-gap: 2px`, `--multi-workbench-text-control-gap: 4px`, and `--multi-workbench-text-control-padding-inline: 6px`.
- Workbench chrome rule: app chrome should use `WorkbenchChromeActionGroup`, `WorkbenchChromeRow`, `WorkbenchIconButton`, `WorkbenchTextButton`, and `workbenchChromeTextControlVariants()` instead of local `gap-1`, `px-1.5`, or fixed button width buckets. Local max-width/truncation is okay when tied to content constraints; spacing belongs to the primitive.
- Sidebar correction: the left thread sidebar is shell chrome, not an Appearance preference surface. Sidebar labels now use fixed Cursor-like shell tokens (`12px/16px`) instead of inheriting `UI Font Size`, and the legacy `180px` default left rail width migrates to `260px` while preserving deliberate non-default user resizes.
- Sidebar rhythm correction: the sidebar body owns the only horizontal gutter (`8px`). Section headers and thread rows no longer add their own `px-2`, rows use a shared `22px` height with `4px` icon/text gaps, and sections use a shared `8px` vertical gap instead of ad hoc `pb-[11px]`.
- Width preference correction: removed the Appearance page's `Chat Max Width` setting and the `agentWindowChatMaxWidth` client setting. Shell/sidebar/workbench widths stay local drag-persisted state; chat content max width uses the CSS fallback instead of a preference control.
- Subagent tray correction: the tray lives in `SubagentTrayStack` under the composer, opens from subagent status rows, and `ChatView` only owns the overlay/click-capture state. Compact docked composer collapse was hiding the mounted tray even after a row opened it, so tray visibility now only excludes inline-edit composers and has a unit guard in `subagent-tray-visibility.test.ts`. The Amp thread JSON reference redirected to sign-in in this environment, so this decision is based on the local data flow trace rather than that external transcript.
- Subagent runtime audit: the first-party runtime subagent extension publishes typed `SubagentToolDetails` on updates and completion; `display-timeline-projection.ts` preserves those details into `display.kind === "subagent"`; `RuntimeToolCallMessage` receives active thread/environment context through `StepRenderer` and renders `SubagentStatusSurface` open by default. Focused tests now cover runtime subagent row rendering plus the tray presentation predicate.
- Earlier UI-scoped verification had transient app failures while other agents were editing nearby chat/runtime files; the current scoped verification below is authoritative for this cleanup pass.
- Follow-up GPT-5.5 medium verifier pass reviewed the deferred workspace toolbar/thread-tree cleanup and returned **Pass**: no duplicated `h-6 px-1.5 text-[12px]` toolbar trigger bucket remains, `WorkbenchChromeRow variant="panel"` is appropriate for the thread tree title row, and `MenuTrigger render={<Button />}` is API/accessibility-safe. The verifier noted the expected visual delta that toolbar triggers now use Multikit workbench action sizing and `font-medium`.
- Current scoped verification passes: `pnpm --filter @multi/app typecheck` and `pnpm --filter @multi/multikit typecheck`. A small `exactOptionalPropertyTypes` issue in runtime edit tool stats was fixed by omitting `stats` when no edit stat exists.
- Current full verification passes: `pnpm run typecheck` completed successfully across all 9 packages.
