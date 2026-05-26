# Browser panel plan (Cursor dissection + Multi integration)

Research source: `/Applications/Cursor.app` bundle (`workbench.desktop.main.js`, `workbench.desktop.main.css`, `main.js`, preloads). Multi shell: `packages/app` right workbench (`shell-host.tsx`, `shell-panels-store.ts`, `app.tsx`).

## Executive summary

Cursor’s in-IDE browser is **not** a simple iframe. It is an Electron **`<webview>` guest** with a dedicated **preload bridge** (`window.cursorBrowser`), a **persistent session partition** (cookies/login survive restarts), and a large set of **main-process IPC handlers** for TLS, DevTools embedding, CDP, and storage. The visible surface is positioned with a **`position: fixed` container** synced to layout via `ResizeObserver` + workbench layout events (not a naive flex child in the editor stack).

Multi already documents “browser panels” in `CONTEXT.md` and has a mature **right workbench** (`plan | git | terminal | files`). The lowest-risk path is a new **`browser` workbench tab** that embeds a `<webview>` inside `WorkbenchPanel`, reusing Multi’s IPC/preload patterns from `packages/desktop`.

Cursor also ships a separate **`BrowserViewMainService`** (`electron.BrowserView` + `setBounds` in `main.js`). Workbench usage today is overwhelmingly **`WebviewBrowserManager` + `<webview>`**; `browserViewService` in the renderer is used for network tracking and image copy, not for `setBounds`. Prefer the webview path for Multi v1.

---

## Cursor architecture (from bundle)

### 1. Renderer: `WebviewBrowserManager`

Core class (minified in `workbench.desktop.main.js`). Responsibilities:

| Area | Behavior |
|------|----------|
| **Guest element** | `document.createElement("webview")` |
| **Partition** | ``persist:${applicationName}-browser`` (dev: ``${applicationName}-dev-browser``) |
| **Preload** | `vs/workbench/contrib/composer/browser/preload-webview-browser.js` |
| **WebPreferences attr** | `contextIsolation=yes, nodeIntegration=no, sandbox=yes` |
| **Popups** | `allowpopups="true"` |
| **Initial URL** | `about:blank`, then `navigate()` |
| **Positioning** | Wrapper `div.webview-browser-container` with `position: fixed`; `syncPosition()` sets `left/top/width/height` from `containerElement.getBoundingClientRect()` |
| **Layout hooks** | `ResizeObserver` on container; `onDidLayoutMainContainer`; editor group layout/scroll |
| **Tab state** | `url`, `consoleLogs`, `isLoading`, load error + kind, favicon, `pageTitle`, find state |
| **Storage keys** | `webviewBrowser.devtoolsWidth`, `webviewBrowser.acceptedCertificates` |

`createBrowserView()` on the manager is a misnomer: it only resets tab state and calls `setupCertificateHandler()` — it does **not** call `BrowserViewMainService.createBrowserView`.

### 2. Preload: `preload-webview-browser.js`

Exposes `contextBridge` API:

```ts
window.cursorBrowser.send(channel, ...args)
```

Allowed channels (whitelist): `focus-url-bar`, `element-selected`, `element-updated`, `element-picked`, `element-hovered`, `area-screenshot-selected`, `style-changes-confirmed`, `css-inspector-style-change`, `open-url-side-group`, `open-url-new-tab`, `focus-composer-input`, `css-inspector-undo/redo`, `show-dialog`, `passkey-request-stalled`, `browser-error-action`, etc.

Also injects:

- **Local network access** polyfill on auth hostnames (Okta, Microsoft, Auth0, …) — grants `navigator.permissions.query` for `local-network-access`.
- **WebAuthn** wrapper — partial support; notifies host on stall; blocks platform authenticator APIs.
- **Dialog overrides** — `alert` / `confirm` / `prompt` non-blocking for automation.
- **Keyboard routing** — Cmd/Ctrl+R/L/T/W, zoom, devtools, navigation; forwarded via `sendToHost('keyboard-shortcut', …)`.
- **Alt+click links** — `open-url-side-group`.

Multi v1 preload can be much smaller: bridge + optional dialog policy + localhost permission helper. Defer CSS inspector / design overlay / React prop editing.

### 3. Main process (`main.js`)

**Window defaults** include `webviewTag: true` (required for `<webview>` in renderer).

**IPC handlers** (representative):

| Channel | Purpose |
|---------|---------|
| `vscode:setupWebviewCertificateHandler` | `session.setCertificateVerifyProc` per partition; pending user accept |
| `vscode:webviewAcceptCertificate` / `Reject` | Trust decision + persist fingerprint |
| `vscode:webviewLoadRememberedCertificates` | Restore accepted certs on startup |
| `vscode:webviewClearCookies` / `ClearCache` | Session hygiene |
| `vscode:webviewSendCDPCommand` | Chrome DevTools Protocol to guest `webContents` |
| `vscode:webviewGetMatchedCSSStyles` | Inspector support |
| `vscode:webviewEmulateColorScheme` | Dark/light emulation |
| `vscode:setDevToolsWebContents` | Embed DevTools in secondary `<webview>` |
| `vscode:webviewPopupOpenTab` | Popup → new tab |
| `vscode:getWebviewCertificateError` | Error page metadata |

Certificate verify proc stores pending verifications; accepted fingerprints go to `webviewBrowser.acceptedCertificates` in workspace storage.

### 4. `BrowserViewMainService` (parallel path)

`main.js` implements `createBrowserView` with `new BrowserView({ webPreferences: { partition, preload: preload-browser.js, … } })` and `setBounds` / `setVisible`. Preload at `vs/platform/browserView/electron-main/preload-browser.js` mirrors `cursorBrowser` bridge.

Workbench **does not** call `browserViewService.setBounds` in the current bundle (0 direct hits). Treat as auxiliary/headless/automation infrastructure, not the primary panel renderer.

### 5. Product integration (Glass + editor)

- **Editor tab**: `workbench.action.openBrowserEditor` → `BrowserEditor` input (`B1` class); `browserViewStore` manages per-`browserId` managers.
- **Glass workspace**: `glass-browser-*` CSS (`glass-browser-toolbar`, `glass-browser-webview-wrapper`, favorites, design mode). Launcher id `glass-workspace-browser-launcher`; persistence via `glassTabPersistenceService` and `stable-browser-session`.
- **Feature gate**: context key `cursor.browserTabEnabled`.
- **Settings** (workspace storage): `autoOpenLocalhostUrls` (default true), `glassOpenWebLinksInBrowser`, `browserUrlPopupDismissed`.
- **Automation**: `browserAutomationService`, extension `cursor-browser-automation`, commands like `cursor.browserAutomation.internal.captureScreenshot`, `cursor.browserView.executeJavaScript`.

### 6. CSS surface (`workbench.desktop.main.css`)

Key classes: `glass-browser-content`, `glass-browser-webview-wrapper`, `glass-browser-webview-container`, toolbar/favorites/design overlays. Webview wrapper gets `data-loaded` → white background.

---

## Multi today

| Piece | Status |
|-------|--------|
| Right workbench tabs | `plan`, `git`, `terminal`, `files` — `WorkbenchTab` in `shell-panels-store.ts` |
| Panel chrome | `WorkbenchPanel`, `RightWorkbenchHeader`, width limits `min: 300` (matches Cursor auxiliary floor) |
| Desktop window | `webviewTag` **not** enabled; `sandbox: true`, `contextIsolation: true` |
| IPC | `desktop:*` channels only — no webview/cert/CDP |
| CONTEXT.md | Mentions browser panels — not implemented |

Terminal panel is the closest analogue: native capability hosted inside a workbench tab with desktop backing.

---

## Recommendation for Multi

### Placement: right workbench tab `browser`

**Why not a center editor surface (Cursor default)?**

- Multi’s center is the agent/chat surface; a full browser editor would fight that model.
- `CONTEXT.md` already frames browser as part of the project shell alongside git/terminal/files.
- Reuses existing tab persistence (`multi.shell.panels.v3`), resize handles, and `data-shell-right-panel` contract.

**Why not a left sidebar item?**

- Browser needs width; right workbench already allocates 300–600px and is where “project tools” live.

Optional later: open browser in a detached `BrowserWindow` for a second monitor (Cursor has “open in new window” patterns).

### Rendering strategy

**Phase 1 (MVP): in-panel `<webview>`**

- Mount `<webview>` inside `WorkbenchPanel` flex column (toolbar + guest).
- Simpler than Cursor’s `position: fixed` overlay unless we hit z-index/overflow bugs with nested scroll surfaces; if we do, adopt Cursor’s fixed container + `syncPosition()` pattern.

**Phase 2+**: only add fixed overlay if compositing breaks (e.g. vibrancy, transformed ancestors).

### Session & login

- Partition: `persist:multi-browser` (single app-wide browser profile for v1; per-environment partitions later if needed).
- Enable `webviewTag: true` on main `BrowserWindow` only (not a security regression if guest preload stays minimal and `nodeIntegration` is off).
- Reuse Cursor’s certificate handler pattern for local HTTPS dev (`localhost` with mkcert) — required for real login flows.

### Preload (`packages/desktop/src/browser/preload-browser.ts`)

Minimal bridge:

```ts
multiBrowser.send("navigate-request" | "new-window" | "keyboard-shortcut" | …)
```

Skip for v1: WebAuthn polyfill, CSS inspector, design overlay, dialog automation (unless agent needs it).

### Main process (`packages/desktop`)

New IPC namespace, e.g. `desktop:browser:*`:

| Handler | Priority |
|---------|----------|
| Setup certificate verify proc for partition | P0 (dev HTTPS) |
| Accept/reject/list remembered certs | P0 |
| Clear cookies/cache for partition | P1 |
| `executeJavaScript` / CDP passthrough | P2 (agent) |
| DevTools attach | P2 |

Validate `webContents` ownership on every invoke (Cursor checks sender owns target IDs).

### Renderer UI (`packages/app`)

New `BrowserWorkbenchPanel`:

- URL bar (editable, commits on Enter)
- Back / forward / reload / home
- Optional tab strip (v1: single tab; v2: multi-tab like Cursor)
- Loading / error states (mirror Cursor load error kinds: cert, DNS, blocked `file://`)
- Context menu: copy link, open in system browser (`desktop:open-external` already exists)

Wire into `ChatWorkbenchShellHost` like terminal:

```tsx
{ id: "browser", label: "Browser", icon: IconGlobe }
panels.browser = <BrowserWorkbenchPanel cwd={...} />
```

Extend `WorkbenchTab` union + `isWorkbenchTab` + persisted `activeTab`.

### Agent / automation access

Cursor path: headless container (`attachToContainer` on hidden div, `z-index: -1`) + `executeJavaScript` + MCP extension.

Multi path (aligned with contracts):

1. **IPC**: `desktop:browser:navigate`, `getUrl`, `screenshot`, `evaluate` (scoped to active browser guest).
2. **Contracts**: add methods to `@multi/contracts` if agents call from server; or desktop-only if only UI triggers initially.
3. **Later**: MCP tool surface similar to `cursor-browser-automation` — not required for panel MVP.

### Settings & keybindings

Follow `AGENTS.md`: configurable keybindings map, defaults in keybinding config.

Suggested settings (client settings schema):

- `browser.defaultUrl` (e.g. `http://localhost:3000` when `cwd` has known dev script — optional heuristic)
- `browser.openLocalhostLinks` (Cursor: `autoOpenLocalhostUrls`)
- `browser.rememberCertificates` (backed by main-process storage)

### Security notes

- Block `file://` navigation in guest (Cursor redirects to `about:blank#blocked`).
- Confirm external scheme navigation (`cursor:`, `mailto:`, custom) via dialog → `openExternal`.
- Do not enable `nodeIntegration` on guest; keep preload tiny and channel-whitelisted.
- Main frame of app window stays locked to trusted origin (`DesktopWindow` already does this); webview is a **separate** guest — do not confuse the two.

---

## Phased implementation

### Phase 0 — Spike (1–2 days)

- [ ] Enable `webviewTag: true` on main window.
- [ ] Proof-of-concept: static HTML page in right panel loads `https://example.com` and retains cookies across reload.
- [ ] Confirm macOS local HTTPS + login redirect works with cert handler.

### Phase 1 — Panel MVP

- [ ] `desktop:browser` preload + cert IPC.
- [ ] `BrowserWorkbenchPanel` + workbench tab registration.
- [ ] URL bar, navigation, loading/error UI.
- [ ] Persist last URL per project (`cwd`) in client settings or shell store.

### Phase 2 — Quality

- [ ] Multi-tab / session restore (optional; Cursor uses `glassTabPersistenceService`).
- [ ] Find in page.
- [ ] DevTools (detach or embedded second webview).
- [ ] Context menu, copy image at point (Cursor uses `browserViewService.copyWebviewImageAt`).

### Phase 3 — Agent

- [ ] IPC evaluate/screenshot/navigate for automation.
- [ ] Hook composer “open localhost” to focus browser tab (Cursor `autoOpenLocalhostUrls`).

---

## Open questions

1. **Per-environment vs global session** — Should `persist:multi-browser` be shared across projects, or `persist:multi-browser-${environmentId}`?
2. **Default URL** — Detect dev server from workspace (package.json scripts) vs manual only?
3. **Fixed overlay vs flex embed** — Prototype in Multi shell first; only copy Cursor overlay if stacking breaks.
4. **Web vs desktop** — Browser panel is desktop-only; web build should hide tab (like terminal).

---

## Key file references (Cursor bundle)

| Asset | Path |
|-------|------|
| Workbench bundle | `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` |
| Workbench CSS | `.../workbench.desktop.main.css` |
| Main process | `.../out/main.js` |
| Webview preload | `.../contrib/composer/browser/preload-webview-browser.js` |
| BrowserView preload | `.../vs/platform/browserView/electron-main/preload-browser.js` |
| Browser automation ext | `.../extensions/cursor-browser-automation/` |

## Key file references (Multi)

| Area | Path |
|------|------|
| Workbench tabs | `packages/app/src/components/shell-host.tsx` |
| Tab types / persistence | `packages/app/src/stores/shell-panels-store.ts` |
| Panel chrome | `packages/app/src/components/shell/shell/workbench-panel.tsx` |
| Window prefs | `packages/desktop/src/window/DesktopWindow.ts` |
| IPC pattern | `packages/desktop/src/ipc/channels.ts`, `preload.ts` |

---

## Thoughts / risks

- **Naming drift**: Cursor calls both `<webview>` managers and `BrowserView` APIs “browser view”. Multi code should use explicit names (`WebviewGuest`, `BrowserPanel`) to avoid mirroring the confusion.
- **`webviewTag` + `sandbox: true`**: Supported together on the parent window; guest has its own sandboxed process. This matches Cursor’s main window defaults.
- **Scope creep**: Cursor’s glass browser (favorites, design mode, CSS inspector) is a large product surface. Ship navigation + login + persistence first; treat inspector/design as non-goals for initial PR.
- **Right workbench width**: 300px minimum may be tight for complex sites; consider 360px default width when browser tab is active, still user-resizable within existing limits.
