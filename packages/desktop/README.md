# @multi/desktop

Electron desktop shell for Multi.

- Owns native window lifecycle, update flow, app protocol handling, and launching the `usemulti` server process.
- Owns the Electron Vite renderer entry under `src/renderer` and imports shared UI from `@multi/app`.
- Keep product UI in `@multi/app`; desktop-only code should stay limited to native integration.
