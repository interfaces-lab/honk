# The Claude Code Harness shares the user's auth and sessions, and nothing else

The Claude Code Harness deliberately inverts ADR 0017's hermeticity: it rides the user's `~/.claude`
config space for the delegated login (ADR 0016 — honk never stores an Anthropic credential, so the
user's local Claude Code auth IS the route) and for session persistence (resume ids and branch forks
must survive in the store the CLI actually reads; relocating `CLAUDE_CONFIG_DIR` couples honk to an
undocumented credential-resolution contract that could orphan the login on any Claude Code release).
Everything else is isolated: `settingSources: ["project"]` loads the project's `CLAUDE.md` — the parity
twin of the pi Harness loading project context from the Thread's cwd — while the user's personal
settings, hooks, and local overrides never execute inside Core-owned turns (the same unowned-surface
argument that made pi hermetic), and the subprocess environment is constructed from an explicit
allowlist because the SDK's `env` option replaces the environment wholesale rather than merging.
The user-visible consequence is deliberate and the mirror image of ADR 0017's: honk threads appear in
`~/.claude/projects` session history, and a user who logs out of Claude Code breaks honk's Anthropic
route (the catalog reports it, fetch-only, at the next probe). Session continuity consequence: because
`forkSession` mints a NEW session id per branch, harness leaves for Claude are self-contained
`sessionId/messageUuid` composites, and the Core's ref-replacement never invalidates recorded leaves —
leaf validity is each harness's own business (pi guards stale leaves at open; Claude leaves carry
their own session).
