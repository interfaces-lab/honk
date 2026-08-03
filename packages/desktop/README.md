# @honk/desktop

Electron desktop shell for Honk.

- Owns native window lifecycle, update flow, app protocol handling, and launching the local Core process.
- Owns the Electron Vite renderer entry under `src/renderer` and imports shared UI from `@honk/app`.
- Keep product UI in `@honk/app`; desktop-only code should stay limited to native integration.

## Dev (next shell by default)

From the repo root:

```bash
pnpm dev
```

Same entrypoint via the package:

```bash
pnpm --filter @honk/desktop run dev
```

In development the BrowserWindow loads the rebuilt client (`packages/app-next`) by default.
The desktop `dev` script:

1. Picks a Core loopback port (`HONK_PORT`, default `13773`) the same way as before.
2. Spawns `pnpm --filter @honk/app-next run dev` with `VITE_HTTP_URL` set to that Core origin
   (app-next cannot infer Core from its own Vite origin).
3. Waits until Vite answers on `http://127.0.0.1:5173` (pinned in `packages/app-next/vite.config.ts`;
   override with `HONK_SHELL_NEXT_URL` — when set, the script does not spawn Vite and only waits
   for that URL).
4. Starts electron-vite / Electron. Packaged builds are unchanged and always use the legacy renderer.

When the next shell is active (dev only):

- File → Close (macOS) and Window → Close (Win/Linux) move to `CmdOrCtrl+Shift+W`
  so the renderer owns ⌘W / Ctrl+W (ADR 0025 §5).
- Preload still exposes `getLocalEnvironmentBootstrap()` (core-app-secret bearer) and
  `getWindowChromeState` / `onWindowChromeState`; app-next's `desktop-bridge.ts` wires them.
- electron-vite may still start its unused legacy renderer — ignore it.

### Legacy renderer opt-out

```bash
HONK_SHELL_NEXT=0 pnpm --filter @honk/desktop run dev
```

`0` / `false` / `no` restore the previous default: legacy `@honk/app` only, no app-next spawn,
⌘W behavior unchanged.
