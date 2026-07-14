---
name: honk-mobile
description: Build Honk's Expo Client, direct Core remote connection, and mobile platform support
---

# Honk Mobile

Use this skill for `packages/mobile`, mobile pairing or remote-session work, and Core changes made to
support iOS or Android Clients.

## Load the contracts

1. Read the repository `AGENTS.md` and `packages/ui/AGENTS.md` completely.
2. Load `honk-ui` for shared components and the relevant Expo Router/native-data skills.
3. If Core command behavior changes, load `packages/core/.agents/skills/cli-ux/SKILL.md` and every
   reference it routes the task to.
4. Verify APIs against the versions installed in `packages/mobile`; do not work from remembered Expo
   APIs or an older template.

## Preserve the remote boundary

Model the connection as 4 separate things: a target origin, a bearer credential, a prepared SDK
client, and a reconnecting supervisor. A tunnel or relay may bootstrap reachability, but HTTPS and
SSE traffic run directly between the Client and Core.

- Require HTTPS for non-loopback Core origins.
- Keep one-time pairing tokens in memory and exchange them once; persist only the resulting bearer in
  Expo SecureStore.
- Inject `expo/fetch` into `@honk/sdk`; do not add a second mobile API client.
- Revoke the current Core session on disconnect when reachable, then remove local credentials even
  when Core is offline.
- Never log pairing links, tokens, bearer values, request bodies, or SecureStore payloads.

## Keep the app native

- Use Expo Router's file-based platform resolution and nested stacks inside native tabs. Read the
  installed router types before using unstable native APIs.
- Import `@honk/ui` components through unsuffixed public paths. Native renderers use React Native or
  Expo primitives and shared resolved tokens; StyleX output stays on web.
- Keep task lists flat, dense, text-first, and native-scrolling. Use Bluesky for interaction and
  navigation mechanics, not branding, icons, or visual copying.
- Queue messages by default while a turn runs. Preserve explicit stop, plan, question, and
  reconnecting states instead of hiding Core state behind optimistic UI.
- Put every field in a keyboard-avoiding surface appropriate to its route or modal, and keep the
  TextField gate in `packages/ui/AGENTS.md` intact.

## Core and CLI

The operator path is `honk-core serve`, `honk-core pair`, `honk-core devices`, and
`honk-core revoke <session-id>`. Pairing links advertise `--public-url`, while local discovery keeps
the trusted loopback origin. Machine modes emit JSON-only stdout, and remote credentials never enter
suggested commands.

## Finish

- Run `pnpm --filter @honk/ui-cli mobile:check` and `pnpm exec expo install --check` from
  `packages/mobile`.
- Typecheck `@honk/ui`, `@honk/sdk`, `@honk/mobile`, and each changed Core surface.
- Run only focused tests for behavior changed in this task, plus `node .design/lint.mjs` for UI.
- Exercise both iOS and Android for native behavior when simulator/device access is available, and
  state exactly which platforms were actually run.
