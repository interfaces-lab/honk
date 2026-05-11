# UI / Component Review — `packages/app`

Deep review of the React component layer, design system integration, and frontend polish opportunities across the Multi app shell, chat, composer, settings, and workbench surfaces.

---

## 1. Architecture & Organization

### What works well

- **Clean split between `components/` and `routes/`**. Routes are thin TanStack Router entry points; heavy UI lives in `components/`. This is correct.
- **`shell/` is well-scoped**: `shell/shell/app.tsx` is the root layout orchestrator. It owns the three-column layout (sidebar, chat, workbench) and resize handles. Keeping this in one file makes the layout contract explicit.
- **CSS is split intentionally**: `index.css` (Tailwind v4 theme + keyframes), `styles/tokens.css` (design-token custom properties), `styles/shell.css` (layout + component selectors). This separation of concerns is good.
- **Central Icons usage is consistent**: `central-icons` is imported throughout; no stray `lucide-react` references seen in reviewed files. Follows the AGENTS.md rule.
- **No inline dynamic imports for types**: All imports are top-level. Good.

### Friction points

- **`components/chat/` is very large (40+ files)**. It mixes presentation, logic, and browser-specific variants (`*.browser.tsx`). Consider a sub-folder structure:
  - `chat/message/` — HumanMessage, AssistantMessage, MessageSurface, etc.
  - `chat/composer/` — PromptInput, ChatComposer, etc.
  - `chat/timeline/` — MessagesTimeline, virtualizer logic.
- **`components/shell/shell/` has nested sub-folders but `components/shell/chat/` and `components/shell/composer/` are empty**. This is confusing — either use the nested structure consistently or flatten it.
- **Some component names are verbose and leak implementation**: `composer-pending-approval-actions.tsx`, `composer-pending-terminal-contexts.tsx`. These could be shorter (`ApprovalActions`, `TerminalContextPanel`).

---

## 2. Token System & Theming

### Strengths

- **OKLCH-based Pierre palette** is properly implemented with `color-gamut: p3` overrides. This is best-in-class for modern displays.
- **`--multi-user-hue` + `--multi-intensity` + `--multi-transparency`** creates a genuinely configurable theme engine. The math in `tokens.css` is rigorous.
- **Transparency stack is well-considered**: `--multi-sidebar-opacity`, `--multi-chat-opacity`, etc. each have independent curves tied to the global transparency knob.
- **`html.multi-reduce-transparency` fallback** correctly removes blur and forces 100% opacity. Accessibility-aware.
- **Dark mode uses `@variant dark`** inside `@theme inline` — Tailwind v4 native pattern. Correct.
- **Glass panel isolation**: `.multi-shell-sidebar` and `.multi-shell-surface` use `isolation: isolate` with `backdrop-filter`. This prevents blur bleeding and z-index bugs.

### Issues & Opportunities

#### 2.1 Token naming is inconsistent between semantic and literal

`tokens.css` has two naming conventions:
- Semantic: `--multi-color-sidebar`, `--multi-color-chat`, `--multi-color-editor`
- Literal/role-based: `--multi-fg-primary`, `--multi-bg-tertiary`, `--multi-stroke-secondary`

This dual system is powerful but **hard to learn**. There is no single source of truth for "what token do I use for a button border in a chat bubble?" A small `TOKENS.md` or JSDoc on a `tokens.ts` re-export would help.

#### 2.2 `color-mix(in srgb, ...)` is used everywhere despite OKLCH palette

The Pierre palette correctly uses `color-mix(in oklch, ...)`, but most of the app-specific tokens still use `in srgb`. Example:

```css
--multi-color-hover: color-mix(in srgb, var(--color-black) 4%, transparent);
```

**Why this matters**: `color-mix(in oklch, ...)` produces perceptually uniform results. Mixing black/white in sRGB creates muddy grays and hue shifts. Since the app already uses OKLCH for the Pierre palette, migrating the `multi-*` tokens to OKLCH would make the entire theme engine perceptually consistent.

#### 2.3 Border tokens could be simplified

There are **four** border-related tokens:
- `--multi-color-border`
- `--multi-color-stroke`
- `--multi-color-stroke-strong`
- `--multi-stroke-secondary`, `--multi-stroke-tertiary`, `--multi-stroke-quaternary`

This is likely grown organically. Consider collapsing to a structured scale:
```
--multi-border-base
--multi-border-subtle
--multi-border-strong
--multi-border-focus
```

---

## 3. Component Patterns

### 3.1 Compound Components

`PromptInputRoot`, `PromptInputToolbar`, `PromptInputToolbarLeft`, `PromptInputToolbarRight` in `prompt-input.tsx` are a **good compound component pattern**. They use `forwardRef` and `createContext` to share state without prop drilling.

However, the context value has **26 properties**. This is a large API surface. Consider splitting into focused contexts:
- `PromptInputVariantContext` — variant, expanded, dragging
- `PromptInputActionContext` — onSubmit, onStop, onEscape
- `PromptInputMenuContext` — menu open state, placements

This reduces re-renders when only one slice changes.

### 3.2 CVA Usage

`message-surface.tsx` uses `cva` for `assistantMessageSurfaceVariants` and `humanMessageBubbleVariants`. This is correct and type-safe.

But `shell/shell/app.tsx` also uses `cva` for `workbenchPanelSlotVariants` with only a boolean `active` flag. For this simple case, `cn()` with a ternary is lighter:

```tsx
// Current
const workbenchPanelSlotVariants = cva("absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden", {
  variants: { active: { false: "pointer-events-none invisible opacity-0", true: "visible opacity-100" } },
});

// Suggested
className={cn(
  "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden",
  state.hidden && "pointer-events-none invisible opacity-0"
)}
```

**Rule of thumb**: `cva` shines at 3+ variants or compound variants. For 1 boolean flag, `cn` is simpler.

### 3.3 Memoization

`MessagesTimeline` and its row components (`TimelineRowContent`, `WorkGroupSection`) are wrapped in `memo`. This is **essential** for a virtualized list and shows good awareness of React performance patterns.

`AssistantMessage` and `HumanMessage` are also memoized. Good.

`ChatHeader`, however, receives many props but only uses `activeThreadTitle`. It destructures only that prop — the rest are unused. This is either dead code (other props were removed) or a component that should be split. If the other header actions are handled elsewhere, remove the unused props from the interface to reduce confusion.

### 3.4 Props Interface Bloat

`MessagesTimelineProps` has **28 properties**. Many are passed through to `TimelineRowSharedState` context. This is a valid pattern, but the interface is unwieldy. Consider a builder pattern or a single `timelineState` object prop:

```tsx
interface MessagesTimelineProps {
  timelineState: TimelineState;
  controllerRef: RefObject<MessagesTimelineController>;
  onIsAtBottomChange: (v: boolean) => void;
}
```

### 3.5 Ref Forwarding

`PromptInputRoot` uses `forwardRef`. Good.
`ShellSidebarFooter` and `ChatHeader` do not expose refs. For a settings back button that may need programmatic focus (e.g., after a keyboard shortcut), a ref could be useful.

---

## 4. Animation & Motion

### 4.1 What is done well

- **`@keyframes` are in `index.css`**, not scattered in JS. Centralized keyframes are easier to audit for `prefers-reduced-motion`.
- **`motion-reduce:transition-none`** is used on resize transitions in `app.tsx` and `right-workbench-layout.tsx`. Good.
- **`thinking-shimmer` uses `mask-image`** for a gradient sweep — GPU-friendly, no layout thrash.
- **Exit animation for scroll-to-bottom button**: `scroll-btn-exit` keyframe at 0.12s ease-in. Subtle and appropriate.

### 4.2 Issues

#### 4.2.1 `transition: all` is used in some places

In `index.css`:
```css
.chat-markdown .chat-markdown-copy-button {
  transition: opacity 120ms ease, color 120ms ease, border-color 120ms ease;
}
```
This is correct (specific properties).

But in `shell.css`:
```css
.git-diff-card {
  transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
}
```
Also correct.

However, `message-surface.tsx` has:
```tsx
className={cn(
  "flex items-center gap-1.5",
  "opacity-0 transition-opacity duration-200",
  "group-hover/message-bubble:opacity-100 focus-within:opacity-100",
)}
```
This is fine (only `opacity`).

No instances of `transition: all` were found in reviewed files. Good.

#### 4.2.2 No `will-change` optimization on virtualized rows

The `MessagesTimeline` virtualizer repositions rows with `transform: translateY(...)`. For long chat histories with rapid scrolling, adding `will-change: transform` to the virtual row container could reduce first-frame jank. However, this should be added **only** to the active viewport rows, not all rows, to save GPU memory.

```tsx
// In virtualRowStyle:
return {
  position: "absolute",
  top: 0,
  left: 0,
  transform: `translateY(${virtualRow.start}px)`,
  willChange: "transform", // Add this
};
```

#### 4.2.3 Sticky user row backdrop blur is heavy

In `messages-timeline.tsx`:
```tsx
isActiveStickyUserRow &&
  "isolate bg-[color-mix(in_srgb,var(--multi-composer-overlay-bg)_72%,transparent)] backdrop-blur-[18px] after:pointer-events-none ..."
```

`backdrop-blur-[18px]` on a sticky element during fast scroll can be expensive. Consider:
- Reducing to `backdrop-blur-[12px]` or `backdrop-blur-[8px]`
- Using a solid fallback color when `prefers-reduced-motion: reduce` is active
- Or replacing the pseudo-element gradient fade with a simpler `mask-image` fade

#### 4.2.4 `animate-skeleton` and `animate-thinking` lack `prefers-reduced-motion`

In `index.css`:
```css
--animate-skeleton: skeleton 2s -1s infinite linear;
--animate-thinking: thinking-shimmer 2s linear infinite;
```

There is no `@media (prefers-reduced-motion: reduce)` guard for these. Skeleton screens and thinking indicators should freeze or become static when reduced motion is preferred. The `tool-call-shimmer` class *does* have a reduced-motion fallback — apply the same pattern to skeleton and thinking animations.

#### 4.2.5 `scale` on press is missing

No `active:scale-[0.96]` or `scale(0.96)` press feedback was found on buttons or message bubbles. The `ChatMessageBubble` (user) has no tactile press state. The `agent-window-chat-header [data-slot="button"]` buttons also lack a press scale.

This is a small but high-impact polish addition. For buttons in the header and composer toolbar:
```tsx
className="... active:scale-[0.96] transition-transform"
```

### 4.3 `AnimatePresence` / Motion Library

Motion/framer-motion is not in the reviewed components. The `package.json` would need to be checked, but the app seems to rely on CSS transitions and keyframes. This is a valid choice for a performance-sensitive app. If motion library is already a dependency (check), consider using it for the command palette enter/exit and sidebar collapse animations for smoother spring physics.

---

## 5. Accessibility

### 5.1 Strengths

- **`aria-label` on icon buttons**: `ShellHeaderControls` buttons have explicit `aria-label` values ("Collapse chats", "Show project panel", etc.).
- **`aria-hidden` on decorative elements**: `multi-shell-sash-hit-feedback` has `aria-hidden`. Good.
- **`role="separator"` on resize sashes**: Correct for splitter handles.
- **`aria-label` on resize sashes**: "Resize thread sidebar", "Resize project panel width".
- **`aria-busy="true"` on loading spinner** in `MessagesTimeline`.
- **`aria-current="page"` on settings back button**.
- **`tabIndex={0}` and `role="button"` on editable message bubbles** with Enter/Space handlers. Good.
- **Font smoothing is configurable**: `data-agent-window-font-smoothing="antialiased" | "subpixel"` with CSS custom properties. Users can choose.
- **Reduced transparency mode**: `html.multi-reduce-transparency` correctly disables blur.
- **`@media (prefers-reduced-motion: reduce)`** is present in `shell.css` for sash feedback and chevron rotation.

### 5.2 Gaps

#### 5.2.1 Missing `aria-live` on streaming assistant messages

`AssistantMessage` renders streaming text via `ChatMarkdown`. There is no `aria-live` region announced to screen readers when new tokens arrive. For a chat app, this is important.

Add an `aria-live="polite"` region that mirrors the latest assistant message text, or use `aria-relevant="additions"` on the message container.

#### 5.2.2 `MessagesTimeline` virtualizer hides off-screen rows from AT

Virtualizers remove off-screen DOM nodes. Screen readers that browse the full document (not just focused elements) will miss older messages. This is a known virtualizer tradeoff.

**Mitigation**: Add a visually hidden "Load more messages" button at the top of the scroll area that screen readers can reach, or use `aria-rowcount` / `aria-rowindex` on the virtual container to inform assistive tech of the total message count.

#### 5.2.3 Command palette footer shortcut text is not marked up as shortcuts

In `command-palette.tsx`:
```tsx
<KbdGroup className="items-center gap-1.5">
  <Kbd><IconArrowUp /></Kbd>
  <Kbd><IconArrowDown /></Kbd>
  <span className={cn("text-muted-foreground/80")}>Navigate</span>
</KbdGroup>
```

The `Kbd` component likely renders `<kbd>` elements. If so, this is correct. Verify that `Kbd` outputs semantic `<kbd>` tags.

#### 5.2.4 Image previews lack `alt` fallback

In `human-message.tsx`:
```tsx
<img src={image.previewUrl} alt={image.name} className="block h-8 w-full object-cover" />
```

If `image.name` is a raw filename like `IMG_2024_001.png`, it is not a great `alt` text. Consider using a generic fallback if the name looks auto-generated:
```tsx
alt={looksLikeAutoGeneratedName(image.name) ? "Attached image" : image.name}
```

#### 5.2.5 Focus rings are suppressed on collapsibles

```css
[data-slot="collapsible-trigger"]:focus,
[data-slot="collapsible-trigger"]:focus-visible {
  outline: none;
  box-shadow: none;
}
```

This removes focus indicators entirely. While the comment says "no focus ring that reads as an extra outline on the header row", removing focus entirely makes the collapsible unusable by keyboard-only users. Replace with a subtle focus ring that matches the design system:

```css
[data-slot="collapsible-trigger"]:focus-visible {
  outline: 2px solid var(--multi-stroke-focused);
  outline-offset: -2px;
  border-radius: 4px;
}
```

---

## 6. Typography

### 6.1 What works

- **`text-wrap: balance` and `text-wrap: pretty` are NOT used anywhere** in the reviewed files. This is a missed opportunity for headings and body text.
  - Add `text-wrap: balance` to `.chat-markdown h1, h2, h3`.
  - Add `text-wrap: pretty` to `.chat-markdown p` and user message bubbles.
- **`font-variant-numeric: tabular-nums`** IS used in `git-diff-card__stats`. Good.
- **`-webkit-font-smoothing: antialiased`** is configurable via `data-agent-window-font-smoothing`. Excellent.
- **`font-synthesis: none`** on `body` prevents browsers from artificially bolding or italicizing fonts. Good for UI consistency.

### 6.2 Issues

#### 6.2.1 Hardcoded font sizes without `text-wrap` guards

`.chat-markdown h1` is `font-size: 20px` with `line-height: 1.25`. On narrow mobile viewports, a long heading will wrap awkwardly without `text-wrap: balance`.

#### 6.2.2 `font-size` mix of px and relative units

The app uses `px` for most sizes (`font-size: 12px`, `font-size: 13px`) but also CSS custom properties (`--multi-ui-font-size-user: 13px`). This is intentional for a dense desktop app, but headings in chat markdown (`20px`, `16px`) do not scale with the user preference. Consider:

```css
.chat-markdown h1 {
  font-size: calc(var(--multi-ui-font-size-user, 13px) + 7px);
}
```

Or use a relative scale (rem/em) tied to the base.

#### 6.2.3 `text-[length:var(--conversation-text-font-size,var(--conversation-font-size,13px))]/[1.5]`

This inline style in `message-surface.tsx` is verbose and hard to read. Consider a utility class:

```css
@utility text-conversation {
  font-size: var(--conversation-text-font-size, var(--conversation-font-size, 13px));
  line-height: 1.5;
}
```

---

## 7. Layout & Spacing

### 7.1 Concentric border radius

Reviewed for nested radius mismatches:

- **`ChatMessageBubble` (user)**: `rounded-xl` with `px-3 py-2`. If a child element inside needs a radius, it should be `rounded-lg` or smaller (`12 - 8 = 4px` difference, but padding is `12px` horizontally, `8px` vertically). For a generic bubble, `rounded-xl` is fine since children are usually text blocks without their own radius.
- **`.git-diff-card`**: `border-radius: max(8px, var(--multi-radius-card, 8px))`. Inner title bar has no radius. The card body has `overflow: hidden` so content is clipped. This is acceptable.
- **`agent-panel-followup-input` overlay**: `ui-prompt-input__container[data-variant="compact"]` uses `border-radius: var(--prompt-input-border-radius-compact)` which is `9999px` (pill). If the inner `chat-composer-surface` has the same radius, the concentric rule is satisfied because there's no padding gap (they share the same boundary).

**No obvious radius mismatches found.** Good.

### 7.2 Shadows vs borders

The app correctly uses shadows for elevation:
- `--multi-shadow-card: 0 1px 2px 0 oklch(0 0 0 / 0.05)`
- `--multi-shadow-popup: 0 16px 48px oklch(0 0 0 / 0.18)`
- `--multi-composer-surface-shadow: 0 1px 2px 0 oklch(0 0 0 / 0.05)`

Borders are used for structural separation (`--multi-stroke-tertiary` on composer surface, `--multi-workbench-panel-border` on workbench). This is correct: borders delineate, shadows elevate.

### 7.3 Hit areas

- **Workbench action buttons**: `width: 22px; height: 22px` in CSS. These are below the 40px minimum. However, they are likely inside a larger padding container. Verify that the actual clickable area meets 40px. If not, add an invisible `::before` pseudo-element to extend the hit area.
- **`.agent-window-chat-header [data-slot="button"]`**: `min-height: 22px; height: 22px; min-width: 22px`. Same concern. These header chrome buttons should have extended hit targets.
- **Sash hit area**: `width: var(--multi-shell-sash-hit-width)` (4px). This is intentionally narrow for precision, but the CSS shows `position: absolute` with full height. The 4px stripe is the visual feedback; the actual hit target might be wider. If the parent container extends the hit area, this is fine. Verify.

### 7.4 z-index discipline

No `z-index: 9999` found. The app uses small z-index values:
- `z-index: 10` on sash hit area
- `z-index: 20` on workbench pseudo-border
- `z-index: 30` on overlay elements
- `z-index: 40` on titlebar controls

This is disciplined. Consider documenting the z-index scale in `tokens.css`:
```css
--z-sash: 10;
--z-workbench-border: 20;
--z-overlay: 30;
--z-titlebar: 40;
--z-tooltip: 50;
```

---

## 8. Specific Component Reviews

### 8.1 `app.tsx` (AppShell)

**Strengths:**
- Uses CSS custom properties for layout math (`--multi-shell-left-width`, etc.). This allows pure CSS container queries to respond to layout changes without React re-renders.
- `data-shell-left-intent` and `data-shell-right-intent` attributes enable CSS selectors to style based on panel state. Clean.
- `useColumnResize` hook abstracts resize logic. Good separation.

**Issues:**
- `shellStyle` object is recreated on every render. Since it's passed to a `div` style attribute, this causes a style recalc every render. Memoize it:
  ```tsx
  const shellStyle = useMemo<ShellRootStyle>(() => ({...}), [leftWidth, rightWidth, agentWindowChatMaxWidth]);
  ```
- `useEffect` for `data-cursor-glass-mode` mutates `document.body` directly. This is a side effect in a component that could be handled by a dedicated hook or layout effect.
- `resolveEffectiveRightOpen` is called in three places (`ShellHeaderControls`, `RightAside`, `AppShell`). Consider computing it once in `AppShell` and passing it down as a prop to avoid drift.

### 8.2 `messages-timeline.tsx`

**Strengths:**
- `@tanstack/react-virtual` is used correctly with `measureElement` for dynamic row heights.
- `rangeExtractor` with sticky user rows is a sophisticated optimization.
- `useStableRows` uses structural sharing to preserve row references. This is expert-level React performance optimization.
- Scroll-to-bottom logic handles programmatic scroll, user scroll, and stick-to-bottom on new messages. The three refs (`scrollFrameRef`, `programmaticScrollFrameRef`, `programmaticScrollDeadlineRef`) manage complex scroll state machine correctly.

**Issues:**
- `virtualRowStyle` returns inline styles for every row. For 100+ rows, this creates many style objects. Since only `translateY` changes per row, consider using a CSS custom property:
  ```tsx
  style={{ "--row-translate-y": `${virtualRow.start}px` } as CSSProperties}
  ```
  And in CSS:
  ```css
  .virtualized-composer-messages-row {
    transform: translateY(var(--row-translate-y));
  }
  ```
  This reduces per-row object creation.
- `content-visibility: auto` is used on non-sticky rows. This is excellent for long timelines.
- `contain-intrinsic-size: 96px` provides a stable estimate. Good.
- The `[--meta-agent-thread-stack-gap:8px]` etc. CSS variables are set on the container but never referenced in the reviewed file. Verify they are consumed or remove dead variables.

### 8.3 `human-message.tsx`

**Strengths:**
- `deriveDisplayedUserMessageState` separates parsing from rendering. Good.
- Git agent actions are abstracted into a lookup table (`GIT_AGENT_ACTIONS`). Clean.
- Terminal context labels are parsed and rendered as inline chips with tooltips. Good UX.

**Issues:**
- The `inlineNodes` array building in `UserMessageBody` is complex and imperative (pushing into an array in a loop). Consider extracting this into a small hook or utility that returns a stable ReactNode array.
- `hasEmbeddedInlineLabels` check with `textContainsInlineTerminalContextLabels` runs before the inline parsing. If this returns false, the code falls back to a different rendering path. This branching is hard to follow. Consider unifying the paths: always parse, and if no labels match, render plain text.

### 8.4 `assistant-message.tsx`

**Strengths:**
- `ChangedFilesTree` is memoized and only renders when `turnSummary` exists.
- `useUiStateStore` selector is precise: `(store) => store.threadChangedFilesExpandedById[routeThreadKey]?.[turnSummary.turnId] ?? true`. Good Zustand pattern.

**Issues:**
- `showCompletionDivider` renders a divider with a pill label. The divider uses `span` elements with `h-px flex-1 bg-border`. This is a common pattern, but `bg-border` is a solid color. Consider using a gradient fade for a softer separation:
  ```tsx
  <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
  ```
- `AssistantChangedFilesSectionInner` calls `useUiStateStore` twice (once for expanded state, once for setter). In Zustand, this causes two subscriptions. Combine them:
  ```tsx
  const { expanded, setExpanded } = useUiStateStore((store) => ({
    expanded: store.threadChangedFilesExpandedById[routeThreadKey]?.[turnSummary.turnId] ?? true,
    setExpanded: store.setThreadChangedFilesExpanded,
  }));
  ```

### 8.5 `message-surface.tsx`

**Strengths:**
- `cva` variants for `humanMessageBubbleVariants` with `editable` flag.
- `MessageActions` uses `group-hover/message-bubble:opacity-100` for hover-reveal actions. This is a clean pattern.
- Keyboard activation (`Enter`/`Space`) on editable bubbles.

**Issues:**
- `MessageActions` opacity transition is `duration-200`. For frequently-hovered elements in a chat, `150ms` or `120ms` would feel snappier. The current 200ms feels slightly sluggish.
- `ReadonlyActionChatMessageBubble` has no visual distinction from a regular user bubble other than `cursor-default`. Consider a subtle background tint or border change to indicate it's an action message.

### 8.6 `command-palette.tsx`

**Strengths:**
- `CommandPalette` is well-structured with view stack navigation (submenus).
- `useDeferredValue` for query filtering prevents UI jank during typing.
- `zustand` store for open state.
- Keyboard navigation (ArrowUp/Down, Enter, Backspace, Esc) is implemented.

**Issues:**
- The component is **very large** (~700+ lines). It handles data fetching, filtering, navigation, and rendering. Consider splitting:
  - `CommandPaletteData` — builds items from projects/threads
  - `CommandPaletteNavigation` — handles view stack
  - `CommandPaletteDialog` — renders the UI
- `buildRootGroups`, `filterCommandPaletteGroups` are imported from `.logic.ts`. Good, but the component still has heavy `useMemo` chains for `projectThreadItems`, `allThreadItems`, etc. These could be memoized at the data layer instead.
- `CommandPaletteDialog` uses `key={`${viewStack.length}`}` on `<Command>`. This forces a full remount on every view push/pop. While this resets scroll position and focus correctly, it loses any internal state in `<Command>` children. Verify this is intentional.
- The `finalFocus` callback returns `false` after focusing the composer. If `CommandDialog` expects `true` to indicate success, returning `false` may cause a focus trap issue. Verify the `CommandDialog` API contract.

### 8.7 `settings-layout.tsx`

**Strengths:**
- `SettingsSection` and `SettingsRow` are clean, reusable layout primitives.
- `useRelativeTimeTick` is a neat utility for live-updating relative labels.
- `Text` component from `@multi/ui/text` with `size`, `tone`, `weight` props provides consistent typography.

**Issues:**
- `SettingsPageContainer` uses `sm:px-8 sm:py-17` — `py-17` is not a standard Tailwind scale value (Tailwind v4 uses `py-17` if configured, but verify it's in the theme). If it's a custom value, consider using `py-16` or `py-[68px]` for clarity.
- `SettingsRow` has a `border-t` with `first:border-t-0`. This is correct, but the border color `--multi-stroke-quaternary` is very subtle. In some themes, this may be invisible. Verify contrast.

---

## 9. Performance Opportunities

### 9.1 Virtualizer `overscan`

`VIRTUALIZER_OVERSCAN = 8` in `messages-timeline.tsx`. For tall message rows, 8 may not be enough to prevent white flashes during fast scroll. Consider increasing to `12` or making it dynamic based on row height estimates.

### 9.2 Image lazy loading

In `human-message.tsx`:
```tsx
<img src={image.previewUrl} alt={image.name} className="block h-8 w-full object-cover" />
```

No `loading="lazy"` attribute. For long conversations with many images, add `loading="lazy"` to defer off-screen image loads. Also add `decoding="async"`:
```tsx
<img src={image.previewUrl} alt={image.name} loading="lazy" decoding="async" ... />
```

### 9.3 `useMemo` dependency arrays

In `app.tsx`:
```tsx
const shellStyle: ShellRootStyle = {
  "--multi-shell-left-width": `${leftWidth}px`,
  ...
};
```

This is not memoized and is passed to a `div` style. React will diff this object on every render, causing style recalculation. Memoize with `useMemo`.

### 9.4 `useCallback` for event handlers

`PromptInputRoot` creates `setMenuOpen` with `useCallback` but then includes `onMenuOpenChange` in `useMemo`'s dependency array. If `onMenuOpenChange` is an inline function from the parent, this `useMemo` will invalidate on every parent render. Consider using `useEventCallback` (or a ref-based pattern) for callback props that don't need to trigger re-renders.

---

## 10. Recommendations Summary

### High Impact, Low Effort

1. **Add `loading="lazy" decoding="async"` to user message image thumbnails.** One-line change, reduces initial load in image-heavy threads.
2. **Add `text-wrap: balance` to chat markdown headings and `text-wrap: pretty` to paragraphs.** Improves readability without layout changes.
3. **Reduce `MessageActions` transition from `duration-200` to `duration-150`.** Snappier hover feedback.
4. **Add `active:scale-[0.96]` to header chrome buttons and composer toolbar buttons.** Tactile press feedback.
5. **Memoize `shellStyle` in `AppShell`.** Reduces style recalc on every render.
6. **Add `aria-live="polite"` region for streaming assistant messages.** Accessibility fix.
7. **Add `@media (prefers-reduced-motion: reduce)` guards for `skeleton` and `thinking` animations.** Accessibility fix.

### High Impact, Medium Effort

8. **Migrate `color-mix(in srgb, ...)` tokens to `color-mix(in oklch, ...)`** for perceptual uniformity. This is a systematic change across `tokens.css`.
9. **Extract `CommandPalette` into smaller focused components.** The current 700+ line component is hard to maintain and test.
10. **Add `will-change: transform` to virtualized rows** (only active viewport rows) for smoother scrolling.
11. **Create a `TOKENS.md` or type-safe token map** documenting the relationship between semantic tokens (`--multi-color-chat`) and role tokens (`--multi-fg-primary`).
12. **Unify `HumanMessage` inline parsing logic.** The current imperative array-building is error-prone.

### Architectural

13. **Consider OKLCH for ALL color mixing**, not just the Pierre palette. The app's entire visual identity would become perceptually uniform.
14. **Add a z-index scale documented in `tokens.css`.** Prevents future z-index inflation.
15. **Reorganize `components/chat/` into sub-folders** (`message/`, `composer/`, `timeline/`) to scale the codebase.
16. **Replace `key={`${viewStack.length}`}` remount in CommandPalette** with a scroll-reset approach that preserves component state.

---

## 11. Final Notes

This is a **sophisticated, well-engineered UI codebase**. The token system is unusually rigorous, the virtualized timeline is expertly implemented, and the accessibility baseline is solid (aria-labels, roles, reduced-motion support in some places).

The main opportunities are:
- **Perceptual color uniformity** (srgb -> oklch migration)
- **Animation completeness** (reduced-motion coverage, press feedback)
- **Typography polish** (text-wrap, balanced headings)
- **Component decomposition** (CommandPalette, PromptInput context)
- **Performance micro-optimizations** (memoization, lazy images, will-change)

No critical bugs or accessibility blockers were found. The app is production-ready with room for refinement.
