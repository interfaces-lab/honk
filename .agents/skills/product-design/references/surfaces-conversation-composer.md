# Conversation and composer

Assistant prose, work, and thinking are full-width text, never bubbles. Only user messages are
bubbled. Use the four-role ramp: primary prose, muted verbs, faint details, and mono evidence. Tool calls
do not receive status icons.

The composer is queue-first: Enter enqueues; idle queues drain immediately; running threads reveal the
queue tray; Command-Enter force-sends as a steer. One button changes label between Send and Queue. Do
not create separate send and queue modes. Questions embed in the composer without replacing its job.

The `/` and `@` suggestion menus share the Lexical trigger, keyboard, and rendering path in
`packages/app/src/composer/prompt-editor.tsx`. They are focused composite suggestions, distinct from
the global engine in `packages/app/src/command-menu.tsx`; do not fork `/` and `@` into separate editor
implementations.

Resolved turn diffs render as `ChangeReceipt` from `packages/ui/src/change-receipt.tsx` through
`packages/app/src/thread/transcript-turn.tsx`. Keep the receipt attached to its turn and actionable;
do not replace it with a decorative boundary.
