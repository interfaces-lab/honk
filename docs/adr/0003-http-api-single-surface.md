# One Effect HttpApi is the entire API — HTTP+SSE, public, WS only for PTY

The Core's API is authored exactly once as an Effect HttpApi (effect/unstable/httpapi): endpoint groups,
TaggedErrorClass errors with httpApiStatus, fail-loud schema middleware, OpenAPI derived from the same
value. Event streams are SSE with replay-then-tail semantics; WebSocket exists only for PTY, entered via
single-use connect tickets minted over authenticated HTTP. This replaces all three legacy surfaces (the
WsRpcGroup WS-RPC plane, ad-hoc HTTP routes, and the ~60-channel Electron IPC runtime plane — IPC shrinks
to local shell chrome only, per the LocalApi split). Two deliberate simplifications: no embedded
in-process mode (every client, including the desktop renderer and the spawning Core App, speaks loopback
HTTP+SSE — one transport path), and the client is derived with Effect's HttpApiClient rather than bespoke
codegen. One casing convention on the wire everywhere.

The API is deliberately public: while the Core runs, users can hit the externally available endpoints to
build their own automations. That makes the OpenAPI document a product artifact and core/v1 versioning a
compatibility promise, not an internal convention.

Rejected: keeping the WS-multiplexed Rpc group (working code on main, but opaque to curl/browsers and a
poor foundation for a public automation API); opencode's bespoke SDK codegen compiler (adopt only if the
derived client's DX fails us). Accepted risk: effect/unstable/httpapi churn on a beta pin.
