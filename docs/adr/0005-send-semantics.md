# Clients mint message ids; admission is durable; delivery is Queue / Steer / Interrupt

A send is admitted, not executed: the Client mints the MessageId, the Core durably records the message and
returns an admission receipt before any processing. Exact replay of the same id returns the same receipt
(retry-safe); the same id with a different payload is a typed conflict. Work interrupted by a crash
settles as an explicit aborted outcome, never an ambiguous resume. Optimistic UI falls out: the sender
renders under the id it minted and the projection confirms under that same id, so keyed lists never see
remove+add.

Input against a busy thread has exactly three delivery modes, mediated centrally by the Core so they
behave identically across providers: Queue (deliver when the agent stops), Steer (inject at the next safe
point without stopping), Interrupt (stop the turn immediately, optionally carrying a message that starts a
new turn — the Cursor-style force send). Queued input is projected state visible to all Clients;
cancelling a queued item returns its text to the composer.

Rejected: server-minted ids with client echo-reconciliation (today's runtimeAcknowledgedMessageIds
machinery), and in-memory queued input (today's queuedComposerFollowUps array — invisible to other
Clients, lost on restart).
