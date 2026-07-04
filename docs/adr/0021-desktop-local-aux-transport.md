# Desktop-local concerns reach the app over a separate aux surface, not the Core

Status: proposed (Round 7, 2026-07-03 — decided on-principle while the user was away; open to veto)

## Context

The cutover deletes the legacy WS-RPC socket. That socket carried *everything* the app needed:
threads/turns (now a Core concern), and also three concerns that are inherently **local to the
machine holding the files** — git management (status,
branches, worktrees, diff, commit, PR actions), settings/keybindings, and the project registry
(`Project`: name, cwd, repository identity, default model, scripts). Projects arrive today bundled in
the `orchestration.subscribeShell` snapshot (`snapshot.projects`).

The new Core (`honk.*`) is deliberately lean: it owns threads/turns/parts/sessions/checkpoints/
terminals and **must be able to run remotely** (serve mode — ADR 0002/0003). A Core on another machine
cannot manage *this* desktop's git working tree, read *this* user's keybindings file, or know which
local folders the user opened as projects. So those concerns cannot live on the Core.

A desktop aux server already exists (ported behind `HONK_AUX_SERVICES`): a separate `node:http`
loopback server on a random port with its **own** bearer token, serving `/git/*` and `/settings/*`
(`packages/desktop/src/aux/{server,git,settings}.ts`). It is currently instantiated but wired to
nothing — no consumer reads its `baseUrl`/token.

## Decision

1. **Desktop-local concerns are served by the desktop, over the aux loopback HTTP surface — never by
   the Core.** The app's core-environment holds a *second* typed client (`environments/core/aux.ts`)
   pointed at the aux server, alongside the `@honk/sdk` client pointed at the Core. Two data planes,
   split by ownership: Core = orchestration; aux = local machine.

2. **The desktop hands the renderer the aux `{baseUrl, bearer}` via an electron IPC bootstrap channel**
   (the same class of desktop→renderer handoff already used for local config). IPC carries only the
   *endpoint handoff*; the ongoing data plane is HTTP to the aux. The aux keeps its own bearer, distinct
   from the Core bearer.

3. **Projects are a desktop-local registry served by the aux** (new `/projects/*` endpoint group +
   watch). The desktop mints `projectId` when a folder is opened as a project, stores
   `{projectId → metadata}` locally, and passes `projectId` + `cwd` to the Core on thread create; the
   Core merely echoes `projectId` on thread summaries. The app's shell projection **merges** Core
   threads (grouped by `projectId`) with the aux project registry.

4. **In web/serve mode there is no desktop, so git/settings/projects are absent — and that is correct.**
   A browser attached to a remote Core gets orchestration only; managing the remote machine's local git
   is out of scope for v1. The environment surfaces these as unavailable rather than faking them.
   *Superseded by ADR 0022 for paired clients: pairing hands over the aux endpoint + bearer too, so the
   owner's remote clients (web attach, Expo) get full parity. "Absent" now applies only to contexts
   that never paired with the desktop.*

## Consequences

- The Core stays lean and genuinely relocatable; nothing local leaks into it.
- The app gains a second connection to manage (lifecycle in `connection.ts`), and a merge step in the
  shell projection. Accepted: it is the honest shape of "orchestration is remote-capable, the working
  tree is not."
- Rejected alternatives: **(a) mount git/settings/projects as Core endpoint groups** — one connection,
  but breaks serve-mode (remote Core cannot touch local files) and couples local concerns into the lean
  Core. **(b) route everything over electron IPC** — native to the desktop, but the web/serve build
  gets nothing and it forks the environment abstraction into HTTP/ws-vs-IPC idioms. Both lose to the
  ownership split above.

## Status note

Decided on-principle (options (a)/(b) are eliminated by the already-accepted lean-Core + serve-mode
invariants). All wiring lands additively and unwired-by-default; reversible until the atomic cut. Flag
for the user's veto before the cut.
