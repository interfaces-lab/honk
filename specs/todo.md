# Cleanup TODO

Open work and tracks. Durable rules: [guide.md](./guide.md). Completed wave
history: [docs/multi-app-slimming-spec.md](../docs/multi-app-slimming-spec.md).

## Tracks

`ERR` typed failures · `RENDER` UI surfacing · `ROUTE` transport mapping ·
`SCHEMA` contract ownership · `MODEL` resolver · `COMPOSER` / `PLAN` · `REACT`
effects · `DELETE` dead code · `TEST` behavior coverage · `EFFECT` runtime ·
`CSS` styling ownership · `TIMELINE` Cursor-style activity log (virtualized,
grouped work rows)

## Open

No open cleanup items outside the timeline backlog.

## Optional follow-ups

- Diff panel word-wrap: open handler vs persisted panel state
- Route navigation effects until loaders have synchronous dependencies
- Promoted-draft finalization in a store if a second caller needs it

## TIMELINE — Cursor parity

Open work for the agent activity timeline. Implementation lives under
[packages/app/src/components/chat/timeline/](../packages/app/src/components/chat/timeline/).
Durable decisions: [implementation-notes.md](../implementation-notes.md).
Layout contracts: [messages-timeline.browser.tsx](../packages/app/src/components/chat/timeline/messages-timeline.browser.tsx).

Cursor bundle class names (`ui-step-group-preview`, `ui-collapsible`, etc.) are
dissection labels only — do not port into Multi. Use Tailwind/`cva`, tokens in
[conversation.css](../packages/app/src/styles/conversation.css), and `data-*`
hooks (`data-assistant-work-group`, `data-work-group-preview`,
`data-work-preview-scrollable`, `data-tool-call-line-*`).

Ephemeral collapse: `expandedWorkGroupIds` in `MessagesTimeline` (`id in set` =
explicitly expanded; default collapsed). No reducer, not persisted. Rows and
summary come from pure derivation (`deriveMessagesTimelineRows`,
`summarizeWorkGroup`).

### Open

- [ ] Collapsed header copy: optional narrative description when the server
      provides a turn summary. Document activity payload dependency if needed.
- [ ] (Optional) Turn-chapter collapse hiding intermediate assistant content.
      Large scope; defer unless product requires.

## Verification

- `pnpm run typecheck` after code changes
- Focused tests when editing test-owned behavior
- Browser tests when changing layout or interaction contracts
