# @honk/honkkit

HonkKit is Honk's shadcn-style component kit. This package ships the internal source, registry config, and CSS variables used before copy-out distribution.

- Export components through explicit subpaths such as `@honk/honkkit/button`.
- Stack: Base UI + CVA + Tailwind (`honk-*` tokens from `@honk/app` theme).
- This package must not depend on app stores, router state, RPC clients, or server contracts beyond pure shared utilities.
- Components should be accessible, deterministic, and styled by app-provided Tailwind/theme tokens.
- App-aware global surfaces, such as thread-scoped toasts, belong in `@honk/app`.
- Workbench chrome uses product-specific CSS variables instead of generic spacing tokens. Keep toolbar item gaps on `--honk-workbench-chrome-action-gap`; keep icon+text control spacing inside `workbenchChromeTextControlVariants()` / `WorkbenchTextButton`.
- Do not add local `gap-*` or `px-*` overrides to workbench chrome controls unless a new named primitive variant is needed.
