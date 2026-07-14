# Logger Copywriting

Canonical voice and language rules for Honk log messages. Load with [`core.md`](core.md): this file governs wording; `core.md` governs shape, redaction, sinks, and compatibility.

Logs are for operators and agents debugging Honk — not end-user CLI copy. Prefer searchability and stable tokens over marketing voice. For user-facing CLI strings, use `packages/core/.agents/skills/cli-ux`.

Canonical vocabulary and surface grammar: [`lexicon.md`](../../references/lexicon.md).

**Failure grammar:** log `message` uses short event phrases (`turn settlement failed`), not CLI `Failed to` / `Couldn't` taxonomy.

## Quick Triage

1. Identify the surface: NDJSON evlog, console pretty, Effect annotation, span, or cause attachment.
2. Name the event in `message` as a short phrase: `core boot`, `turn settled`, `auth store persistence failed`.
3. Move identifiers, counts, durations, and object refs into `fields`.
4. Classify failures: operational defects use `error`; expected edge cases use `warn`; routine lifecycle uses `info`/`debug`.
5. Check level, service name, field keys, and redaction before punctuation.

## Voice

Write like an engineer reading `jq`:

| Level | Tone              | Example `message`              | Example `fields`                                |
| ----- | ----------------- | ------------------------------ | ----------------------------------------------- |
| info  | Factual, terse    | `core boot`                    | `{ storePath, harnesses }`                      |
| warn  | Direct, scoped    | `sse session invalid`          | `{ sessionId }`                                 |
| error | Plain, actionable | `turn settlement failed`       | `{ turnId, cause }` via Cause attachment       |
| debug | Sparse            | `discovery handshake retry`    | `{ attempt, origin }`                           |

Avoid hype, jokes, apologies, and celebration in logs.

## Brief

- `message` is a short event phrase — aim for 3–8 tokens. Prefer `turn settled` over narration.
- Put *why* in fields (`reason`, `cause`, `signal`) or in the attached Cause, not in a subordinate clause in `message`.
- Do not embed IDs, URLs, paths, or counts in `message` when a field exists for them — except hybrid CLI receipts documented in `cli-ux` `command-contracts.md` until migrated.
- Do not repeat `service` in `message`; `service` is already a top-level evlog field.
- Cut `successfully`; the level and event name carry outcome.
- Cut filler: `just`, `simply`, `actually`, `In order to`.
- One event per log line. Do not combine unrelated facts.

## Clear + Consistent

- Use stable event names across callsites for the same lifecycle step. Prefer `turn started` / `turn settled`, not alternating `starting turn` / `turn complete`.
- Use space-separated lowercase phrases for `message` tokens. Do not mix `coreBoot`, `core boot`, and `Core boot` for the same event.
- Field keys use camelCase per existing evlog JSON: `turnId`, `threadId`, `storePath`, `sessionId`.
- Use Honk vocabulary in field values when appropriate (`Core`, `thread`, `Harness`, `Provider`). Proper nouns may appear in `message` when needed (`Core discovery probe failed`).
- **thread** for conversation turns; **session** only for transport/auth/subprocess boundaries (`sessionId`, `sse session invalid`).
- **Core** for the agent runtime process; **backend** only for the desktop HTTP/Bun server layer — never interchange in one event family.
- For Effect failures: keep `message` as a stable event name. Pass the raw `Cause` or `Error` directly — `Effect.catchCause((cause) => log.error("…", cause))` — so it rides Effect's native log cause channel; each logger renders it (do not pre-format with `Cause.pretty` at call sites). Do not use a field key `message` for error text.

## Actionable

- Error logs should make the subsystem obvious from `service` + `message`.
- Add fields that explain *what* failed, not only that something failed: `{ turnId }`, `{ sessionId }`, `{ path }`.
- Do not instruct operators to "contact support" in logs; reserve recovery guidance for CLI/user surfaces.
- Do not log suggested shell commands with secrets or tokens.

## Surface Rules

### NDJSON evlog (`writeHonkLogEvent`)

- Required top-level keys: `time`, `level`, `message`, `service`, `environment`.
- Optional process metadata: `runId`, `processRole`, `processInstanceId` from env configuration.
- Additional context merges into the same object from `fields` after redaction.
- Values must be JSON-serializable; no `undefined`, no circular structures.

### EffectLogger (`EffectLogger.create`)

- Always pass `service` in the factory: `EffectLogger.create({ service: "desktop-core-manager" })`.
- First argument is the event `message`; second is `fields`.
- Use `with({ … })` for per-scope fields instead of repeating them on every call.

### Effect.log* (direct)

- Prefer `EffectLogger` at module scope over ad hoc `Effect.logInfo("…")` when a service owns the file.
- When using raw `Effect.log*`, keep the same message/field split.

### Console Output

- Console pretty is for local dev ergonomics, not the durable contract.
- Console lines may be slightly more readable than NDJSON `message`, but must not leak secrets pretty-printed.
- Do not rely on ANSI color for required meaning.

## Banned + Avoided Language

Do not use in log `message` strings:

- `successfully`, `Unable to`, `Oops`, `An error occurred`, `Something went wrong`
- hype/filler: `seamlessly`, `just`, `simply`, `actually`, `In order to`, `leverage`, `utilize`, `streamline`
- full sentences with subject-verb-object narration: `The core has finished booting.`
- duplicated service prefix: `desktop-core-manager: core boot` when `service` is already set
- raw upstream error blobs in `message`; put them in `cause` or `{ reason }` / `{ error }` fields after sanitization
- user-facing apologies or `please`

Full shared list: [`lexicon.md`](../../references/lexicon.md). CLI-only bans (interjections, inclusive alternatives): `packages/core/.agents/skills/cli-ux/references/copy.md`.

## Mechanics

- `message`: lowercase phrase, no period, no colon suffix.
- Field keys: camelCase, stable, searchable.
- IDs and paths: field values, exact, not truncated unless truncation is explicit and tested.
- Durations: `logSpan.*` keys for Effect spans; use `ms` suffix in values: `"42ms"`.
- Timestamps: ISO 8601 UTC in `time`; do not duplicate human timestamps in `message`.

## Scope Guards

Apply these rules to:

- `message` strings in `logging.ts`, `effect-logger.ts`, and all `Effect.log*` / `EffectLogger` call sites
- new field keys added to log events
- console pretty formatting when it changes readable text

Do not rewrite:

- third-party library log output
- test fixtures unless asserting new copy
- CLI user-facing strings (see cli-ux skill)
- JSON field renames without a migration plan and tests

Use [`verification.md`](verification.md) for review gates and stale-message sweeps.
