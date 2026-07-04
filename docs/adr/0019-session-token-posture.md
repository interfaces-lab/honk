# Sessions: opaque hashed bearers, a secret file for Core Apps, no ambient trust

Sessions (the auth surface CONTEXT.md reserves the word for) use opaque random bearer tokens hashed
(SHA-256) at rest in store-backed rows carrying role, label, and expiry — revocation is row deletion,
listing is a table scan. Legacy's HMAC-signed payloads were rejected: signature verification buys
statelessness the Core never needs (the store is always present) at the cost of double bookkeeping and
a signing key to manage. Core Apps authenticate with a secret file minted at Core boot under
`HONK_HOME/core/` with 0600 permissions and presented directly as their bearer: same-user filesystem
trust IS the discover-then-spawn model (ADR 0002) — a process that can read HONK_HOME could equally
have started the Core, so an exchange ceremony adds a round-trip without adding trust. Web clients
enter through one-time pairing tokens (short TTL, single consume, minted only by a core-app Session,
delivered as an `/#token=` URL) exchanged for long-lived web Sessions; web Sessions get 403 on the
auth and session-management verbs (ADR 0016's Core-App-capability rule made mechanical). Enforcement
is bearer-always, loopback included — two trust regimes on one port is how local-proxy holes are born;
the only open endpoints are health (the discovery probe's liveness surface) and the pairing exchange
itself. Pending pairings live in memory only: a Core restart voiding an unconsumed pairing URL costs
one re-pair, which is cheaper than persisting secrets. PTY connect tickets (ADR 0003) are deliberately
absent until the round that ports PTY — shipping an unconsumed credential surface blind is worse than
adding it additively later.
