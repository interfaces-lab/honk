# @honk/desktop

Electron desktop shell for Honk.

- Owns native window lifecycle, update flow, app protocol handling, and launching the `usehonk` server process.
- Owns the Electron Vite renderer entry under `src/renderer` and imports shared UI from `@honk/app`.
- Keep product UI in `@honk/app`; desktop-only code should stay limited to native integration.
