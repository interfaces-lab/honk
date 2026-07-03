# One SDK from day one; subscriptions are per-Thread Parts or Thread Summaries — no firehose

A published SDK ships with the Core from day one and owns the entire connection lifecycle: discovery,
the auth handshake (bootstrap/pairing token to bearer session), reconnect with re-sync (re-fetch the
{parts, seq} snapshot, resume the tail from seq), and the canonical Part-apply reducer, so every client —
ours and third-party automations — folds the same stream into the identical transcript (Cursor's
exported-reducer lesson). The public face is promise/callback (automation authors and app components
never see Effect); the raw Effect client is exported alongside since the internals are Effect anyway.
Syntax is benchmarked against the opencode and Cursor SDKs.

Subscription has exactly two altitudes, and nothing subscribes to everything: (1) per-Thread Part
subscription for open threads; (2) the Thread Summary stream for workspace surfaces — a separate, coarse
projection (title, status, small metadata) that emits only when a summary actually changes, never as a
re-broadcast of Part traffic. An instance-wide event firehose is deliberately absent: N clients times all
threads times every delta is the fan-out cost the single-core design exists to eliminate, and opencode's
per-connection-filtered global stream is the wart we are avoiding.
