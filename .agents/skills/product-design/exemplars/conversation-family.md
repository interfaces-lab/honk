# Conversation family

**Evidence:** `packages/ui/src/tool-call.tsx`, `user-message.tsx`, `status-row.tsx`, and `work-group.tsx`.

The family implements the text-first conversation hierarchy. Tool-call interaction semantics and a
chevron appear only when `onToggle` exists; static rows remain non-interactive. Reduced motion shows an
honest still state. Shared channel variables coordinate hover emphasis, and WorkGroup keeps one concept
in a compound component family.

This evidence supports `rule/assistant-text-not-bubbles` and `rule/honest-controls-and-notices`; it is
not a template for unrelated list rows.
