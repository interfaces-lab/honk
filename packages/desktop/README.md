# @multi/desktop

Electron desktop shell for Multi.

- Owns native window lifecycle, update flow, app protocol handling, and launching the `usemulti` server process.
- Loads the renderer from `packages/app` during development and packaged server/client assets in production.
- Keep product UI in `@multi/app`; desktop-only code should stay limited to native integration.
