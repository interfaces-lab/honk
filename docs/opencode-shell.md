# OpenCode shell boundary

Honk's shell targets the current OpenCode protocol directly. It may borrow interaction mechanics from
OpenCode's desktop app, but it must not translate compatibility `session.*` records into canonical
local shapes or fall back to retired methods when the current protocol lacks an operation.

Research was pinned to anomalyco/opencode commit
[`05c3e40a4e641732b991499000ca479e5dad4b02`](https://github.com/anomalyco/opencode/tree/05c3e40a4e641732b991499000ca479e5dad4b02)
(v1.18.1, 2026-07-15), plus the matching protocol types shipped in Honk's installed
`@opencode-ai/sdk@1.18.1`.

## Identity model

OpenCode has three identities that must remain separate. A session ID alone is not a tab key because
two connected servers can legitimately expose the same ID.

| Layer    | Stable identity                     | Owns                                      | UI consequence                                                              |
| -------- | ----------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| Server   | normalized origin / connection key  | transport, auth, event stream, cache      | local, remote, and cloud-control servers coexist in one registry            |
| Location | `(server, directory, workspaceID?)` | project instance and filesystem scope     | `workspaceID` identifies a cloud workspace behind a server                  |
| Session  | `(server, sessionID)`               | conversation aggregate and durable events | routes, tabs, watches, notifications, and caches use the composite identity |

The canonical implementation is exported from `@honk/opencode`. `openCodeSessionKey()` encodes
`(server, sessionID)`, while `openCodeLocationKey()` encodes
`(server, directory, workspaceID?)`. Session keys omit location because a session can move without
becoming a different session. Credentials are never part of an identity or route.

## Desktop tab model

OpenCode persists ordered tabs, recent selection, display information, and closed-tab history per
window. A tab is either a server-scoped session or a client-only draft; creation atomically replaces
the draft with the real session, so opening a blank composer does not create server garbage. See
[`context/tabs.tsx`](https://github.com/anomalyco/opencode/blob/05c3e40a4e641732b991499000ca479e5dad4b02/packages/app/src/context/tabs.tsx)
and
[`utils/session-route.ts`](https://github.com/anomalyco/opencode/blob/05c3e40a4e641732b991499000ca479e5dad4b02/packages/app/src/utils/session-route.ts).

Routes use `/server/:encodedServer/session/:sessionID`, and persisted keys include the server.
Closing a tab only removes a view and records it for reopening; it does not interrupt or delete the
session. Honk keeps a pinned Home tab as the aggregate attention surface, then applies the same tab
behavior to sessions and drafts.

The strip uses pointer sorting with a 4px activation threshold, horizontal restriction, edge
autoscroll, compact rendering under pressure, middle-click close, active-tab scroll seating, and
overflow scrolling. See
[`components/titlebar-tab-strip.tsx`](https://github.com/anomalyco/opencode/blob/05c3e40a4e641732b991499000ca479e5dad4b02/packages/app/src/components/titlebar-tab-strip.tsx).
Honk implements those mechanics in `packages/ui/src/tabs.tsx`, while retaining its own sheet,
status vocabulary, yellow attention indicator, and pinned Home.

## Server contexts and cloud

OpenCode constructs one context per connected server and stores contexts by connection key. Each
context owns its client, cache, sync state, project state, and event fan-out; directory-scoped state
hangs below it. Removing a server disposes the whole context. See
[`context/global.tsx`](https://github.com/anomalyco/opencode/blob/05c3e40a4e641732b991499000ca479e5dad4b02/packages/app/src/context/global.tsx),
[`context/server.tsx`](https://github.com/anomalyco/opencode/blob/05c3e40a4e641732b991499000ca479e5dad4b02/packages/app/src/context/server.tsx),
and
[`context/server-sdk.tsx`](https://github.com/anomalyco/opencode/blob/05c3e40a4e641732b991499000ca479e5dad4b02/packages/app/src/context/server-sdk.tsx).

Honk mirrors that ownership shape with `createOpenCodeRegistry()`. A remote machine is another
server entry. A cloud workspace is an `OpenCodeLocationRef` with `workspaceID` behind its
controlling server. The UI shows a server label when it disambiguates equal titles, but it does not
invent a separate cloud-session concept.

## Server-generated titles

OpenCode desktop currently gets automatic titles from its compatibility session engine. After the
first real, non-synthetic user message on a parent session, that engine checks that the title is
still its timestamp default, runs a hidden tool-disabled title agent with the provider's small
model, retries twice, removes reasoning and extra lines, caps the result, stores it, and publishes
`session.updated`.

The canonical session runner still creates the timestamp default and explicitly leaves title work
unfinished. Honk therefore treats `session.updated` as an invalidation and will display any
server-owned title that arrives, but it does not fabricate a first-line title or call the
compatibility endpoint for automatic generation.

Manual rename is enabled: double-clicking a tab title edits it in place, and Honk commits the new
title through the stable session group's update endpoint (`PATCH /session/{id}`) — the same call
OpenCode desktop's own tab strip makes. The rename is optimistic in the tab store and reverted
with a toast if the server rejects it; the resulting `session.updated` event re-syncs every other
view.

## Remote host boundary

The managed OpenCode process stays on loopback behind a random upstream password. `honk serve`
exposes an authenticated proxy instead: non-loopback listeners require an explicit HTTPS public
URL, pairing grants are random, hashed, one-use, and short-lived, and each exchanged device gets a
separate revocable credential. The proxy replaces device authorization with the private upstream
credential and carries ordinary HTTP, event streams, and upgraded connections without exposing
the engine directly.

The remote lifecycle was cross-checked against T3Code commit
[`3513fa04fbf12c1d4fa2b8d07cfc7f0905714d31`](https://github.com/pingdotgg/t3code/tree/3513fa04fbf12c1d4fa2b8d07cfc7f0905714d31)
(2026-07-14). Honk reuses the direct-connection and advertised-endpoint lessons, but it does not
import T3Code's protocol: `@honk/opencode` remains the only transport boundary and hosted services
never proxy session traffic.

Desktop offers two HTTPS endpoint sources. A custom endpoint binds the authenticated Honk host to
the network listener and expects the supplied tunnel or reverse proxy to forward to it. The managed
Tailscale option keeps the host on loopback, derives the public origin from the machine's MagicDNS
identity, runs `tailscale serve --bg --https=443` without a shell, and removes that mapping when Honk
shuts down. `honk serve --tailscale-serve` provides the same lifecycle for a headless server. Command
failures retain only sanitized metadata, never Tailscale output that could contain secrets.

The Honk host starts as soon as the sidecar publishes its reserved loopback endpoint, before the
OpenCode health check completes. Pairing and shell routes are therefore available during cold start
or restart, while proxied API requests return a startup response until OpenCode is ready.

Mobile stores server descriptors separately from credentials and runs one reconnecting global
event plane per server. Revoking or signing out a device closes its live sockets immediately, so an
already-open event stream cannot outlive the credential that authorized it.

## Protocol boundary

The canonical client supports session list/create/get/active, agent and model switching, durable
queue/steer prompt admission, compact/wait/context/history/session events/interrupt, projected
messages, revert, and session-scoped permission and question requests. Its public vocabulary is
`OpenCodeSessionInfo`, `OpenCodeSessionMessage`, and `OpenCodeLocationRef`; generated upstream
names stay inside the adapter.

The installed protocol does not expose title rename, archive, delete, fork/parent creation, or slash
command execution. OpenCode's desktop app still reaches compatibility endpoints for several of
those operations while its server is being completed. That mixed application code is UX prior art,
not code to port into Honk's boundary.

`OPEN_CODE_SESSION_CAPABILITIES` makes unsupported operations explicit, with no hidden fallback.
`scripts/check-protocol-boundary.mjs` runs during package typecheck and rejects calls that bypass
the current generated namespace or recreate the retired thread/workspace facade inside the adapter.

The global event union still contains transitional metadata events. A server context may use only
those events' discriminants as workspace or request-queue invalidations; it must not store or
export a compatibility event payload as a canonical session record. The live-only
`session.next.*.delta` events may temporarily overlay the matching projected part, but they never
advance a cursor. Projected messages and the per-session durable event stream own canonical
conversation state.

An open session retains its last applied durable aggregate sequence and reconnects with that value
as the exclusive `after` cursor. Cold bootstrap loads a visible snapshot, reads durable history to
its watermark, reconciles the snapshot once, and then subscribes after the watermark. A durable
boundary fetches only its affected canonical message; whole-transcript reconciliation is reserved
for aggregate-wide changes such as move, model/agent switch, or committed revert. Global reconnect,
status, idle, and compatibility message events must never trigger transcript reloads.

## Port order

1. Persist server descriptors separately from credentials, resolve routes through server keys, and
   make `(server, sessionID)` the only session identity.
2. Persist session tabs, local drafts, recent selection, display information, and closed-tab history
   per stable desktop window. Promote a draft atomically after `sessions.create()`.
3. Let one server context own each global event stream and fan workspace invalidations and
   ephemeral deltas to open session stores. Give each retained open session one separately
   reconnecting durable stream; do not multiply either stream because leaf views remount.
4. Build Home from paginated `sessions.list()` plus `sessions.active()`; build a session page from
   `get()`, `messages()`, `history()`, and durable events.
5. Map pending questions or permissions to the yellow circular matrix, active execution to the
   neutral sweep, and retain Honk's existing done, draft, unread, failed, and idle states. Attention
   outranks activity.
6. Keep rename/archive/delete/fork/command execution disabled until the installed protocol exposes
   them. A compatibility call, fake local mutation, or Honk-only parallel protocol is not a bridge.
7. `@honk/opencode` is the only client. Do not add generation-qualified paths, compatibility
   exports, or a second client tree.
