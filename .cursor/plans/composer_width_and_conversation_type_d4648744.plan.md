---
name: Composer width and conversation type
overview: Expose composer column width as first-class Tailwind theme utilities (`max-w-composer`, optional `w-composer`) backed by existing CSS variables, and tie conversation typography to the same UI font scale so message/markdown text tracks appearance settings.
todos:
  - id: theme-max-w-composer
    content: Add --max-width-composer (and optional alias) to @theme in packages/app/src/index.css; replace max-w arbitrary / max-w-(--composer-max-width) usages in chat-composer, tool-renderer, messages-timeline
    status: completed
  - id: conversation-vars
    content: Point --conversation-font-size and --conversation-text-font-size at UI scale in tokens.css; optionally add --font-size-conversation + text-conversation in @theme and simplify message-surface, chat-markdown, tool-renderer
    status: completed
  - id: typecheck
    content: Run pnpm exec tsc --noEmit in packages/app
    status: completed
isProject: false
---

# Composer width utilities + dynamic conversation type

## What exists today

**Composer width (already dynamic)**

- Default token chain: [`packages/app/src/styles/tokens.css`](packages/app/src/styles/tokens.css) sets `--multi-composer-max-width: 840px` and `--composer-max-width: var(--multi-composer-max-width)`.
- Runtime override: [`packages/app/src/components/shell/shell/app.tsx`](packages/app/src/components/shell/shell/app.tsx) injects `--multi-composer-max-width: ${agentWindowChatMaxWidth}px` on the `agent-window` root via `shellStyle` (from `useSettings` → `settings.agentWindowChatMaxWidth`).
- Usages mix patterns: `max-w-(--composer-max-width)` in [`chat-composer.tsx`](packages/app/src/components/chat/composer/chat-composer.tsx); `max-w-[min(100%,var(--composer-max-width))]` in [`tool-renderer.tsx`](packages/app/src/components/chat/message/tool-renderer.tsx) and [`messages-timeline.tsx`](packages/app/src/components/chat/timeline/messages-timeline.tsx); inline `maxWidth` in timeline; raw CSS in [`shell.css`](packages/app/src/styles/shell.css) with `min(100%, …)` in places.

**Conversation text (mostly static)**

- [`tokens.css`](packages/app/src/styles/tokens.css) fixes `--conversation-font-size` / `--conversation-text-font-size` to `13px`.
- Prose uses long arbitrary classes in [`message-surface.tsx`](packages/app/src/components/chat/message/message-surface.tsx), [`chat-markdown.tsx`](packages/app/src/components/chat/markdown/chat-markdown.tsx), [`tool-renderer.tsx`](packages/app/src/components/chat/message/tool-renderer.tsx).
- The rest of the shell already follows `--multi-ui-font-size-user` (set in [`packages/app/src/lib/appearance-settings.ts`](packages/app/src/lib/appearance-settings.ts) via `--multi-ui-font-size-user`), and tokens define `--multi-text-body` / `--multi-text-title` as **derived** steps from that user value.

## Proposed changes

### 1) `@theme` bridges for composer width (Tailwind v4)

In [`packages/app/src/index.css`](packages/app/src/index.css) inside `@theme inline`, add:

- `--max-width-composer: min(100%, var(--composer-max-width, 840px));` so utilities resolve to **`max-w-composer`** (matches the safe pattern used in tool blocks and shell chrome).
- Optionally `--max-width-composer-raw: var(--composer-max-width);` only if you still need “no min cap” somewhere (likely unnecessary if everything should respect viewport).

Then replace call sites:

- `max-w-(--composer-max-width)` → `max-w-composer` where the intended behavior is “cap at composer max, never overflow viewport”.
- `max-w-[min(100%,var(--composer-max-width))]` → `max-w-composer`.
- `messages-timeline.tsx` inline `maxWidth: "var(--composer-max-width, 840px)"` → use `max-w-composer` on the wrapper or set style to `var(--max-width-composer)` if a style object must remain (prefer class).

Leave [`shell.css`](packages/app/src/styles/shell.css) as-is unless you want identical `max-w-composer` there too for consistency (optional follow-up).

### 2) Dynamic conversation typography

**Single source in tokens**

In [`packages/app/src/styles/tokens.css`](packages/app/src/styles/tokens.css), redefine:

- `--conversation-font-size` and `--conversation-text-font-size` to reference the UI scale, e.g. `var(--multi-ui-font-size-user, 13px)` **or** `var(--multi-text-title)` if you want conversation to match the “title” step of the internal scale (that is exactly `var(--multi-ui-font-size-user, 13px)` per existing tokens).

That one change makes all existing `text-[length:var(--conversation-…)]` call sites track the font slider without editing every component.

**Optional cleanup (smaller class strings)**

In `@theme`, add e.g. `--font-size-conversation: var(--conversation-text-font-size);` so you can use **`text-conversation`** / **`leading-*`** instead of repeated `text-[length:var(--conversation-text-font-size,...)]` in the three files above. Only do this if you confirm Tailwind picks up the custom `font-size-*` key (same pattern as existing `--font-size-caption`, etc.).

### 3) Verification

- After edits: `pnpm exec tsc --noEmit` in `packages/app` per AGENTS.md.
- Manually: change **UI font size** and **agent chat max width** in settings and confirm timeline + composer + tool cards align.

## Scope note

This does **not** require changing how settings are stored; it’s CSS/theme wiring on top of variables you already set on `.agent-window`.
