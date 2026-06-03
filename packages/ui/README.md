# @multi/ui

Tomeito is Multi's design system. This package ships its React primitives.

- Export components through explicit subpaths such as `@multi/ui/button`.
- Stack: Base UI + CVA + Tailwind (`multi-*` tokens from `@multi/app` theme).
- Dev gallery: `/dev/tomeito` in `@multi/app` (DialKit for live prop tweaks).
- This package must not depend on app stores, router state, RPC clients, or server contracts beyond pure shared utilities.
- Components should be accessible, deterministic, and styled by app-provided Tailwind/theme tokens.
- App-aware global surfaces, such as thread-scoped toasts, belong in `@multi/app`.
