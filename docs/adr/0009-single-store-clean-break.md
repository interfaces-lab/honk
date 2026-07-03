# One Core-owned store under HONK_HOME; the rewrite is a clean break with no data import

All durable state belongs to the Core under HONK_HOME: one sqlite database (Canonical Records, Thread
Summaries and projections, auth sessions, server and client settings), one attachments directory, one
0600-file secret store that also absorbs pi's plaintext auth.json. Client/UI settings are served by the
Core so every attached Client shares them; only genuinely device-local bits (window geometry, per-device
theme) stay client-side. Harness-internal state (pi JSONL sessions, Claude resume ids) lives under
HONK_HOME/harness/<name>/ and is explicitly internal — the Canonical Record is the truth, so losing
harness state degrades resume quality, never data.

Everything is version-stamped from day one (store schema version + per-record version) with fail-loud
decode and an explicit quarantine path, but no migration framework exists until the new store ships
stable (flue's pre-1.0 stance). The nine data-repair migrations in the legacy store (033-041) are the
evidence for why strict wire schemas must precede a migration story.

Existing 0.6.x user data is not imported: the new Core starts with an empty store (clean break). A
best-effort importer can be built later as a standalone tool outside the Core if demand appears; legacy
shapes do not leak into the new codebase.
