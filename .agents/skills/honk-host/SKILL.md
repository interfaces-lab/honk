---
name: honk-host
description: Build Honk's CLI-managed OpenCode host, secure remote pairing, and shared web/mobile connection boundary
---

# Honk Host

Use this skill for `packages/cli`, pairing or device revocation, the web connection gate, desktop
OpenCode lifecycle changes, and shared connection helpers in `packages/opencode`.

## Load the contracts

1. Read the repository `AGENTS.md` completely.
2. Read the affected files in `packages/cli`, `packages/opencode`, `packages/app`, and
   `packages/desktop` before editing across their boundary.
3. Inspect the installed `opencode-ai` and `@opencode-ai/sdk` package types and binaries; never
   implement a remembered API from an older OpenCode version.
4. For remote-experience changes, inspect current T3Code source and record the commit reviewed. Use
   its lifecycle and pairing lessons without importing its protocol or product vocabulary.

## Preserve one OpenCode boundary

- `honk` owns one `opencode serve` child, serves the complete web shell immediately, and proxies the
  OpenCode transport while the child starts or restarts.
- Every client uses `@honk/opencode`. Do not restore `api/core`, add a second API client, or project
  OpenCode state into an incompatible transport.
- Mobile connects directly through the native SDK adapter. It never loads the web shell in a
  WebView and never depends on the CLI being installed on the device.
- Desktop may manage its local OpenCode process through Electron, but its renderer consumes the
  same client and shell contracts as web.

## Keep remote attachment secure

- Put one-time pairing grants in the URL fragment, expire them quickly, consume them exactly once,
  and scrub the fragment before asynchronous work.
- Exchange a pairing grant for a random per-device credential. Persist only its hash in host state,
  keep the upstream OpenCode password private to the host process, and make device credentials
  individually revocable.
- Require HTTPS for every non-loopback advertised URL. Never print passwords, authorization
  headers, request bodies, state-file contents, or SecureStore values.
- Keep the shell and pairing exchange reachable before OpenCode is ready; protect proxied API and
  event traffic with a paired device credential.
- Store native credentials in Expo SecureStore. Prefer an HttpOnly same-origin cookie for the web
  host, with JavaScript storage limited to the active browser session.

## CLI contract

- `honk` starts the shell and managed OpenCode process; `honk serve` stays headless and prints a QR
  code; `pair`, `devices`, `revoke`, and `stop` operate on the running host.
- Start the HTTP host before spawning OpenCode so the shell paints immediately. Treat upstream 502,
  503, and 504 responses as startup/restart states rather than authentication failures.
- Keep host state under `HONK_HOME` or `~/.honk` with owner-only permissions and atomic writes.
- Keep the CLI useful from the repository through `pnpm honk` and package the built web shell with
  the published binary. Do not recreate a UI-specific CLI.

## Finish

- Run `pnpm --filter @honk/cli typecheck` and `pnpm --filter @honk/opencode typecheck`.
- Typecheck every affected client. If unrelated work blocks a consumer, report the exact files and
  errors instead of weakening its types or changing that work.
- Run `pnpm run check:mobile` when shared connection behavior changes.
- Run `node .design/lint.mjs` and React Doctor when user-visible React code changes.
- Run focused behavior tests only when this task creates, changes, or debugs those tests.
