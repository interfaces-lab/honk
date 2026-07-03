# Three packages carry the rewrite; one file per domain concept

The new Core is three packages with one-way imports: @honk/api (the public contract — every core/v1
schema plus the HttpApi endpoint groups and typed errors; imports effect only), @honk/core (canonical
record, projections, the three Harnesses, store, auth, PTY, the honk bin; imports @honk/api), and
@honk/sdk (connection lifecycle, canonical reducer, promise facade with an Effect export; imports
@honk/api and must never import @honk/core). opencode's further schema/protocol split is deliberately
collapsed into @honk/api — that split earns its keep only with codegen or multiple protocol bindings, and
we have neither; the dependency discipline survives as an enforced import rule instead of a package
boundary. At cutover, contracts, runtime, server, and client-runtime are deleted; app, desktop, honkkit,
marketing, and release-scripts survive.

File philosophy: one file per domain concept, however long — part.ts owns everything Part, thread.ts owns
the Thread aggregate, each Harness adapter is one file. No utils/, no helpers/, no types.ts dumping
grounds, no barrel sprawl. Splitting a file happens when the owner asks for it, never as a default. This
is a deliberate deviation from small-file convention, chosen so the code stays ownable and reviewable as
whole concepts.

Staging note (2026-07-02, Round 7 grill): the clean cut is the FINAL commit, not the only commit.
Preparatory commits may add new @honk/api, @honk/core, @honk/sdk, and Core-App-local surfaces (PTY
tickets + WS, worktree thread metadata, local settings/keybindings, the desktop-local git service)
while the legacy server still runs untouched — additions are not half-states. What "no interleaved
half-states" forbids is any commit in which app or desktop speaks both stacks at once: the final
commit atomically switches app+desktop to @honk/sdk AND deletes contracts, runtime, server, and
client-runtime together. The port map that sized this staging is the Round 7 investigation
(cited edge set: app's contracts-shaped state layer, the 5,300-LOC git service, PTY ownership in
the legacy server).
