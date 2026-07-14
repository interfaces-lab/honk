---
name: honk-mobile
description: Build Honk's Expo client and its direct OpenCode SDK connection
---

# Honk Mobile

Use this skill for `packages/mobile`, mobile connection or remote-session work, and changes to
`packages/opencode` that support iOS or Android clients.

## Load the contracts

1. Read the repository `AGENTS.md` and `packages/ui/AGENTS.md` completely.
2. Load `design` for user-visible work, `honk-ui` for shared components, and the relevant Expo
   Router or native-data skills.
3. Read the installed `@opencode-ai/sdk` and `@honk/opencode` types before changing connection,
   session, event, or command behavior.
4. Verify APIs against the versions installed in `packages/mobile`; do not work from remembered Expo
   APIs or an older template.

## Preserve the remote boundary

Model the connection as separate origin, credential, prepared SDK client, and reconnecting
supervisor concerns. Mobile talks directly to OpenCode through `@honk/opencode`; do not recreate the
retired Core v1 transport or add a second API client.

- Require HTTPS for non-loopback origins.
- Persist credentials only in Expo SecureStore and never log connection URLs, passwords, request
  bodies, or SecureStore payloads.
- Use the native event-stream adapter from `@honk/opencode/native` for OpenCode events.
- Remove locally stored credentials on disconnect even when the remote host is offline.
- Keep SDK-derived state authoritative instead of projecting it into a parallel mobile store.

## Keep the app native

- Use Expo Router's file-based platform resolution and nested stacks inside native tabs. Read the
  installed router types before using unstable native APIs.
- Import `@honk/ui` components through unsuffixed public paths. Native renderers use React Native or
  Expo primitives and shared resolved tokens; StyleX output stays on web.
- Keep task lists flat, dense, text-first, and native-scrolling. Use Bluesky for interaction and
  navigation mechanics, not branding, icons, or visual copying.
- Queue messages by default while a turn runs. Preserve explicit stop, plan, question, and
  reconnecting states instead of hiding OpenCode state behind optimistic UI.
- Put every field in a keyboard-avoiding surface appropriate to its route or modal, and keep the
  TextField gate in `packages/ui/AGENTS.md` intact.

## Finish

- Run `pnpm run check:mobile`; it typechecks `@honk/ui`, `@honk/opencode`, and `@honk/mobile`, checks
  installed Expo package compatibility, and runs the current Expo Doctor directly.
- Run only focused tests for behavior changed in this task, plus `node .design/lint.mjs` for UI.
- Exercise both iOS and Android for native behavior when simulator/device access is available, and
  state exactly which platforms were actually run.
