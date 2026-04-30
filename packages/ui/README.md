# @multi/ui

Reusable React UI primitives for Multi.

- Export components through explicit subpaths such as `@multi/ui/button`.
- This package must not depend on app stores, router state, RPC clients, or server contracts beyond pure shared utilities.
- Components should be accessible, deterministic, and styled by app-provided Tailwind/theme tokens.
- App-aware global surfaces, such as thread-scoped toasts, belong in `@multi/app`.
