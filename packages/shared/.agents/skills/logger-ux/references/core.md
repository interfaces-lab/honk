# Core Logger Rules

Reusable shape, redaction, sink, and Effect integration rules for Honk logging.

Implementation lives in `packages/shared/src/logging.ts` and `packages/shared/src/effect-logger.ts`.

## NDJSON Contract

Each evlog line is one JSON object terminated by `\n`.

Standard shape:

```json
{
  "time": "2026-07-05T18:20:00.000Z",
  "level": "info",
  "message": "core boot",
  "service": "core",
  "environment": "development",
  "runId": "…",
  "processRole": "runtime",
  "processInstanceId": "…",
  "storePath": "/path/to/store",
  "harnesses": ["openai-codex", "anthropic", "cursor"]
}
```

Rules:

- `message` is the event name, not a sentence.
- Domain context is merged **flat** into the top-level object from `fields` / annotations via `Object.assign` — there is no nested `fields` key in NDJSON output.
- `level` is one of `debug` | `info` | `warn` | `error`.
- `service` identifies the subsystem; use kebab-case slugs: `desktop-core-manager`, `core`, `desktop-bootstrap`.
- `storePath`, `harnesses`, `runId`, etc. appear only when a callsite annotates them — not on every line.
- Do not nest arbitrary subtrees without reason; prefer flat camelCase keys.

**Wiring today:** `configureHonkEvlog` + `makeHonkEffectLogger` are wired in desktop (`desktop-observability.ts`). Core uses raw `Effect.log*` without Honk evlog unless a Core App adds wiring later.

## Process Metadata

Configure once per process via `configureHonkProcessMetadata(role)`:

- `HONK_RUN_ID_ENV`
- `HONK_PROCESS_ROLE_ENV` — `app-renderer` | `desktop-main` | `desktop-renderer` | `dev-runner` | `provider` | `runtime` | `server` | `terminal`
- `HONK_PROCESS_INSTANCE_ID_ENV`

Do not invent ad hoc env vars for the same data.

## Sinks

- **Rotating file sink** (`configureHonkEvlog`): durable NDJSON for support/debug.
- **Console pretty** (`makeSafeConsolePrettyLogger`): dev-friendly stderr; must tolerate broken pipes.
- File sink failures must not crash the process unless `throwOnError` is explicitly enabled.

## Redaction + Secrets

- Field names matching `SECRET_FIELD_PATTERN` are replaced with `[redacted]`.
- Redaction is **key-name-based**; string values are not scanned for embedded secrets.
- Treat values from auth, tokens, cookies, passwords, and API keys as sensitive by default — prefer redacting field names (`token`, `apiKey`, `password`).
- Never log bearer tokens, session secrets, or raw request bodies.
- `cause` pretty-printing may include stacks in error paths; do not expand scope to routine info logs.

## Effect Integration

Preferred pattern at module scope:

```ts
const elog = EffectLogger.create({ service: "desktop-core-manager" });

yield* elog.info("core attach succeeded", { origin, port });
yield* elog.error("core spawn failed", { reason });
```

Rules:

- One `EffectLogger.create` per file/subsystem unless sub-scopes need `with()`.
- Do not pass `service` again in `fields` if the factory already sets it.
- Use `debug` sparingly; `configureHonkEvlog` defaults to `minLevel: "debug"`; desktop sets `info` explicitly.

## Levels

| Level | Use for |
| ----- | ------- |
| debug | high-volume diagnostics, handshake retries, dev-only detail |
| info  | lifecycle boundaries: boot, attach, turn started/settled, dispose |
| warn  | recoverable anomalies: stale discovery, invalid session, persistence retry |
| error | failed operations, defects, dispose failures |

Do not log routine success paths at `error`. Do not log defects only at `warn`.

## Streams

- NDJSON file and structured logs are the machine contract.
- Console pretty is stderr-oriented dev output.
- Do not mix structured and unstructured lines in the same sink without tagging.

## Compatibility

- Do not rename existing field keys without a migration note and test updates.
- Do not change `level` semantics for the same `message` without checking dashboards/alerts.
- Adding fields is safe; removing or retyping fields is a breaking change.

## Hardening

- Sanitize depth-limited (`MAX_SANITIZE_DEPTH`); circular structures become `[circular]`; depth overflow becomes `[truncated-depth]`.
- Arrays are walked in full up to depth limit — no automatic summarization.
- Ignorable stdio write errors (`EPIPE`, etc.) must not throw in console loggers.
- `writeHonkLogEvent` is a silent no-op when evlog is not configured.
