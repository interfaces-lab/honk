# Remote clients attach at full parity — the Core owns the whole machine surface

Status: accepted (2026-07-04, user ruling: "no feature gaps", t3code-exact topology confirmed after
source dissection of t3code's remote architecture)

## Context

ADR 0021 split the surfaces: Core = orchestration; a desktop-local aux HTTP server = machine-local
concerns (git, settings, projects). Its consequence 4 made remote sessions orchestration-only.

The driver that broke this: a first-class remote client (Expo app, web attach) that remote-controls
the user's machine with zero feature gaps. The reference is t3code, whose dissected topology is
unambiguous: ONE authenticated server owns everything the machine does — git status is a server-side
working-tree watcher/broadcaster, project registry and file trees live in the server, terminals are
server-side PTYs — and the Electron desktop is just another client that happens to spawn a loopback
server instance. Remote parity falls out for free because nothing is desktop-owned. honk already had
half of this: terminals, worktrees, and checkpoints (ADR 0020) are Core-owned.

## Decision

1. **The Core is the single authoritative server for the machine that runs the work.** Git surfaces
   (status watcher/broadcaster, branches, stacked actions, PRs), the project registry, file
   browsing/search/write, settings — all become Core endpoint groups, executed on the Core's machine,
   streamed to every client. The desktop aux HTTP server dissolves into the Core.
2. **The desktop demotes to a pure client** that discovers-or-spawns a loopback Core (unchanged
   bootstrap) and renders the same surface any paired client sees. Electron IPC keeps only shell
   chrome (windowing, dialogs, context menus, openExternal) — ADR 0021 narrows to exactly that.
3. **Remote clients are not second-class: one pairing, one bearer, every feature.** Pairing exchanges
   a one-time token for a durable session (bootstrap-vs-session split); a bearer bootstrap endpoint
   serves native clients (Expo SecureStore). Sessions are enumerable and revocable; owner-only verbs
   (credential administration, pairing issuance) stay owner-gated — parity means features, not
   administration.
4. **Transport stays HTTP + SSE with seq-resume.** Functionally equivalent to t3code's WS
   snapshot+delta+replay, and bearer-over-HTTP avoids their ws-token workaround. Client→server
   verbs (terminal keystrokes included) are ordinary HTTP calls.
5. **Exposure policy tiers** gate binding: loopback/desktop-managed by default; any non-loopback bind
   requires sessions; public exposure is a loud opt-in.

## Consequences

- ADR 0021's aux-HTTP decision is superseded except for the IPC-is-shell-chrome boundary; its
  desktop-local *ownership* intuition survives only as "the Core runs on the machine that owns the
  trees."
- The 7c aux wiring (git/settings/projects over desktop aux) migrates into Core endpoint groups; the
  app's aux client becomes SDK calls. Domain schemas already live in @honk/shared — this is transport
  homing, not a redesign.
- The UI rewrite designs one client family (desktop shell, web attach, Expo) over ONE plane:
  @honk/sdk. Project registration must be a Core RPC from day one — beating t3code's one documented
  remote gap (no remote project-add in their GUI).
