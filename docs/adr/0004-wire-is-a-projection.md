# The wire is a projection; the canonical record is private

Conversation state crosses the wire only as a projection: subscribing to a thread returns a materialized
snapshot of render-ready Parts plus a sequence high-water mark, then a live tail of seq-stamped Part
deltas applied idempotently by clients. The Core's canonical record — the durable, append-only account of
what actually happened, including harness-native detail — never leaves the Core, so its schema can evolve
without breaking the public API.

This deviates deliberately from opencode v2, where the durable session-event log is itself the public
protocol. Flue shipped its canonical records publicly and had to retract the entire surface (1.0.0-beta.8)
in favor of exactly the snapshot+validated-chunks shape we are choosing; Cursor likewise keeps a private
protobuf core joined to a public typed surface by one adapter. Freezing the canonical record into a public
compatibility promise is the mistake this ADR exists to prevent.
