# The Core runs on Node only

The Core targets Node exclusively; the Bun runtime lane is deleted (BunHttpServer vs NodeHttpServer,
@effect/sql-sqlite-bun vs the hand-ported node:sqlite client, dual PTY adapters — ~600 LOC of shims
tripling the infra layer). Production reality already chose this: the packaged desktop spawns the server
under ELECTRON_RUN_AS_NODE, i.e. Node, using our own NodeSqliteClient port. A Bun Core would mean bundling
a Bun binary into the desktop or requiring users to install Bun; npm-installed CLI users have Node by
definition. opencode itself is migrating toward full Node. Bun remains welcome as dev tooling only.

Version floor: the Core inherits Electron's bundled Node when the desktop spawns it, so the effective
minimum is min(Electron's Node, oldest supported CLI Node) — newer-Node APIs (modern node:sqlite,
process-management niceties) must clear that floor or be gated. Accepted cost: Bun's faster startup and
sqlite for the standalone-serve case.
