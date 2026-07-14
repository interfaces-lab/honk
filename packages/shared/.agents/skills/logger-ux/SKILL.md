---
name: logger-ux
description: Use for @honk/shared logging changes that affect log message wording, field names, redaction, NDJSON evlog shape, Effect.Logger / EffectLogger output, console pretty output, or tests for those surfaces. Do not load for implementation-only refactors with unchanged log strings and field contracts.
---

# Honk Logger UX

Related skills: [`cli-ux`](../../../core/.agents/skills/cli-ux/SKILL.md) for user-facing CLI strings; shared vocabulary in [`lexicon.md`](../references/lexicon.md).

## Hybrid Surfaces

Operator-visible `Effect.log` lines in `packages/core/src/main.ts` (serve receipts) function as CLI output today. When editing them, load **both** skills. Receipt wording follows `cli-ux` `command-contracts.md`; structured field migration follows this skill.

Canonical front door for making Honk logs consistent, searchable, safe, and operator-ready.

## Stance

Act like an observability engineer, not a string polisher.

- Logs are structured events, not prose. The `message` is a short event name; context lives in `fields`.
- Inspect `packages/shared/src/logging.ts`, `packages/shared/src/effect-logger.ts`, and call sites before judging.
- Treat shipped log lines as evidence, not automatic precedent. Check them against this skill and redaction contracts.
- Fix the event model when the model is wrong; copy-only edits are not enough.
- Keep human console output readable during dev; keep NDJSON machine output stable.
- Never log secrets, tokens, or raw user content.
- Preserve JSON field names and enum values unless migrating with tests.

## Decision Authority

Resolve conflicts in this order:

1. The user's explicit goal and constraints.
2. Verified system truth: redaction rules, process metadata env vars, sink behavior, and compatibility contracts.
3. Repository-canonical guidance: `AGENTS.md`, this skill, `logging.ts` contracts, and tests.
4. Verified adjacent service patterns (`EffectLogger.create({ service })` families).
5. General structured-logging heuristics.

## Workflow

1. **Event map.** Name the subsystem, trigger, durable outcome, and whether the event is debug/info/warn/error.
2. **Surface map.** List NDJSON file sink, console pretty, Effect annotations, spans, and cause pretty-printing.
3. **Field map.** For each new field, justify its name, type, cardinality, and whether it is PII or secret-bearing.
4. **Redaction audit.** Run secret field patterns and value sanitization rules before shipping.
5. **Transcript review.** Read before/after log lines in both console and NDJSON form.
6. **Regression lock.** Test message strings, field presence, and redaction for touched paths.

## When to Load References

| Task surface                    | Load                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Any logging change              | [`references/core.md`](references/core.md)                                           |
| Log message copy or review      | [`references/core.md`](references/core.md) + [`references/copy.md`](references/copy.md) |
| Redaction / secrets             | `core.md` → Redaction + Secrets; `copy.md` → Scope Guards                            |
| NDJSON / evlog shape            | `core.md` → NDJSON Contract, Process Metadata                                        |
| EffectLogger / Effect.log usage | `core.md` → Effect Integration; `verification.md`                                    |
| Console pretty output           | `copy.md` → Console Output; `core.md` → Streams                                      |
| Tests and stale-message sweeps  | [`references/verification.md`](references/verification.md)                           |

## Quality Bar

Every log event should answer:

- What happened? (short `message`)
- Where? (`service`, `processRole`, optional `runId`)
- What context matters? (`fields`, bounded)
- Did it fail? (`level`, optional `cause`)

## Minimum Done State

A logging change is not done until:

- `message` is a short stable event phrase, not a sentence or stack dump
- structured context is in `fields`, not interpolated into `message`
- secrets and sensitive field names are redacted per `SECRET_FIELD_PATTERN`
- touched services use `EffectLogger.create({ service: "…" })` or equivalent consistent `service` annotation
- stale vague messages are locked out by tests when user-visible diagnostics change
- focused tests pass
