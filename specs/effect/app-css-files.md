# App CSS File Inventory

This inventory covers non-ignored CSS files under `packages/app/src`. It exists
to prevent name-based cleanup from deleting active shell layout while still
removing one-off styling buckets from new work.

Inventory command:

```bash
git ls-files --cached --others --exclude-standard packages/app/src | rg "\\.css$"
```

Current count:

- [x] `10` app CSS files are tracked.
- [x] No non-ignored untracked CSS files were found.
- [x] No `agent-panel` selector was found.
- [x] No `agent-window__layout` selector was found.
- [x] `agent-window*` selectors are current shell layout selectors.

## Canonical CSS Boundaries

Keep these unless their owning runtime changes.

- [x] `packages/app/src/index.css`: Tailwind entry, theme export map, base
      globals, drag globals, and scrollbar globals.
- [x] `packages/app/src/styles/tokens.css`: semantic color, type, radius,
      glass, workbench, and terminal tokens.
- [x] `packages/app/src/styles/app.css`: CSS composition/import boundary.
- [x] `packages/app/src/styles/shell.css`: shell, workbench, sidebar, and
      right-panel layout selectors.

Current shell selectors:

- [x] `.agent-window`
- [x] `.agent-window__sidebar`
- [x] `.agent-window__workbench`
- [x] `.multi-workbench-panel-title-row`
- [x] `.multi-workbench-tool-island`
- [x] `.multi-shell-workbench-columns`
- [x] `.multi-shell-secondary-rail`
- [x] `.agent-window-chat-header`

## Feature CSS Bridges

Keep only while the corresponding renderer needs global or generated-content
styling.

- [x] `packages/app/src/styles/conversation.css`: chat typography and spacing
      variables.
- [x] `packages/app/src/styles/git-diff.css`: diff token bridge plus
      `.diff-panel-viewport` and `.diff-render-file`.
- [x] `packages/app/src/styles/terminal.css`: terminal token bridge plus
      `.thread-terminal-drawer`, `.thread-terminal-viewport`, and
      `.workbench-terminal-viewport`.
- [x] `packages/app/src/styles/markdown.css`: `.chat-markdown` generated
      markdown rules.
- [x] `packages/app/src/styles/settings.css`: `.settings-form-page`.
- [x] `packages/app/src/styles/tool-call.css`: `.tool-call-shimmer`.

## New Styling Rules

- [x] Do not add `composer-*`, `agent-panel`, or decorative BEM-style helper
      buckets for new work.
- [x] Use Tailwind utilities on elements or existing `cva` variants for
      component-local styling.
- [x] Add CSS selectors only for global renderer integration, generated content,
      shell/workbench geometry, test selectors, or stable third-party host slots.
- [x] Put reusable tokens in `tokens.css`, not component CSS.
- [x] Keep feature CSS files small and renderer-owned.

## Composer And Menu Styling Notes

The active one-off-looking hooks are in TSX, not CSS files.

- [x] `packages/app/src/components/chat/composer/slash-menu.tsx` no longer
      contains `ui-slash-menu__*`, `mentions-menu__content`, or `ui-menu__*`
      class hooks.
- [x] Do not delete `prompt-segments.ts` or `prompt-triggers.ts` as styling
      cleanup; they are active behavior helpers used by composer, slash menu, and
      chat view.
- [x] Replace unowned menu class hooks only when the slash menu component is
      rewritten or its behavior is covered by browser tests.

## Done Means

- [ ] A CSS deletion keeps the rendered shell, composer, terminal, markdown,
      diff, settings, and tool-call surfaces intact.
- [ ] Shell geometry is verified in browser when `shell.css` changes.
- [ ] Composer overflow and row containment are verified in browser when
      composer styling changes.
- [x] No new feature CSS file is added without a renderer/global-token reason.
