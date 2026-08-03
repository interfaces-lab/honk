# Logger UX Verification

Testing, stale-message sweeps, and review gates for Honk logging work.

Shared banned tokens: [`lexicon.md`](../../references/lexicon.md).

## General Matrix

When changing logging behavior:

- update tests that assert `message`, `level`, `service`, or critical fields
- add negative assertions for removed vague strings
- cover redaction for secret-like field names
- cover `EffectLogger.create({ service })` usage in new modules
- cover cause attachment on error paths when changing failure logging
- cover console pretty does not throw on broken pipe when touching `makeSafeConsolePrettyLogger`
- cover rotating sink behavior when changing `configureHonkEvlog` or `RotatingFileSink`

**Gap:** `rotating-file-sink.test.ts` covers rotation and EPIPE only — not `redactLogFields`, `writeHonkLogEvent`, or `makeHonkEffectLogger`. Add tests when touching those paths.

## Shared Impact Map

Before editing `logging.ts` or `effect-logger.ts`, inspect call sites:

```bash
rg -n "EffectLogger\\.create|makeHonkEffectLogger|configureHonkEvlog|writeHonkLogEvent|Effect\\.log" packages/desktop/src packages/core/src
```

Do not run banned-language sweeps across `packages/app` or HTTP handlers — those surfaces use user-facing copy, not log messages.

Services with dedicated log handles include:

- `desktop-core-manager`, `desktop-bootstrap`, `desktop-startup`, `desktop-lifecycle`
- `desktop-window`, `desktop-updater`, `desktop-menu`, `desktop-backend-child`
- `app-renderer`
- `core` boot/turn paths in `packages/core/src/main.ts` and `core.ts` (raw `Effect.log*` today)

If a shared helper changes, update its direct tests plus at least one consumer test.

## Stale-Message Sweeps

Scope to log-owning source only:

```bash
rg -n "\\b(successfully|Unable to|Oops|An error occurred|Something went wrong)\\b" packages/desktop/src packages/core/src --glob '!**/*.test.ts'
rg -n "Effect\\.log(Info|Error|Warning)\\(\"[A-Z]" packages/desktop/src packages/core/src
```

Skip `message:.*\.` sweeps — they false-positive on HTTP JSON payloads and test fixtures.

Flag log messages that embed template literals for IDs/URLs when a field would be clearer — except hybrid CLI receipts in `main.ts` until migrated.

## Review Checklist

Reject or fix changes that:

- put IDs, paths, tokens, or large blobs in `message` instead of `fields` (except documented hybrid CLI receipts)
- omit `service` for a new subsystem using `EffectLogger`
- log secrets or unredacted credential field names
- use different event names for the same lifecycle step in the same service
- use `error` for expected control flow
- use `console.log` for durable diagnostics when evlog is configured
- change field keys or `message` tokens without updating tests
- review only the edited line instead of the event family and coupled fields
- mix user-facing CLI copy rules into internal log messages (or vice versa)
- apply CLI `Failed to` / `Couldn't` grammar to log event names
