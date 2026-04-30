# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

Multi is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `packages/app`: React/Vite UI. Owns session UX, conversation/event rendering, route state, and client-side state. Connects to the server via WebSocket.
- `packages/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React app, and manages provider sessions.
- `packages/desktop`: Electron shell. Owns desktop lifecycle, update flow, native window behavior, and launching the server process.
- `packages/ui`: Reusable React UI primitives. Keep app/domain state out of this package; app-aware surfaces belong in `packages/app`.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and app. Uses explicit subpath exports (e.g. `@multi/shared/git`) — no barrel index.

## Codex App Server (Important)

Multi is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `packages/server/src/codex-app-server-manager.ts`.
- Provider dispatch and thread event logging are coordinated in `packages/server/src/provider/ProviderService.ts`.
- WebSocket server routes NativeApi methods in `packages/server/src/ws.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: [https://developers.openai.com/codex/sdk/#app-server](https://developers.openai.com/codex/sdk/#app-server)

## Reference Repos

- Open-source Codex repo: [https://github.com/openai/codex](https://github.com/openai/codex)
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): [https://github.com/Dimillian/CodexMonitor](https://github.com/Dimillian/CodexMonitor)

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
