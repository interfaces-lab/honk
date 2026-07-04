# The Harness set is closed and hardcoded; PartOrigin is a closed enum

PartOrigin is a closed literal union ("honk", "pi", "claude-code", "cursor", "extension") and decoding is
fail-closed: an SDK meeting an unknown origin throws. Adding a Harness is a deliberate, hardcoded change
shipped with the Core — a core/v1 version event surfaced by connect-time negotiation — never a runtime
registration. There is no dynamic provider registry by design ("an AI-free zone"): the lineup is
hand-curated per ADR 0006's credential-driven routing, and extensibility for third parties lives in the
Extension origin plus the custom Part arm (ADR 0015), not in an open provider namespace.

Rejected: origin as an open string with documented known values. It would keep stale clients rendering
via generic fallback, but pokes the first hole in the strict-schema premise on a load-bearing field.
Graceful degradation, if ever wanted, belongs in the SDK reducer (catch the decode failure, synthesize a
custom Part) — degradation as SDK policy, not schema looseness.
