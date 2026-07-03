# Extensions attach to the Core; MCP is a first-class Core capability

Extensions are a Core-level contract — they never plug into a Harness directly, because the harnesses are
permanently asymmetric (pi: rich in-process hooks; Claude Code: a subprocess with injection points;
Cursor: almost nothing). Each Harness adapter projects whatever subset of the contract it can honor, and
capabilities are declared as data per thread — stable for the thread's whole life because the model (and
therefore the Harness) is pinned at creation (ADR 0014).

The contract has four planes: (1) observation — extensions subscribe to the Core's canonical
stream and see identical events for every harness by construction; (2) contribution — custom Parts
(extensionTag + a schema the extension registers, keeping decode fail-closed), commands, and the public
HTTP API; (3) model context — tools registered once in the Core's tool registry reach every model
natively: as pi tools in the pi Harness and as MCP tools in Claude Code (mcpServers query option) and
Cursor (ACP session/new mcpServers); (4) harness-native extras (pi-only hooks), available only where
declared. ADR 0007 removed the hardest cross-harness hook from the problem: there is no tool
veto/permission interception — extensions observe, never gate.

MCP is therefore first-class: the Core hosts an internal, per-thread-auth-scoped MCP endpoint (the t3code
pattern) as the lingua franca for cross-harness tools, and external MCP servers configured per thread ride
the same plumbing later. Execution model v1: in-process, trusted, single-file TypeScript with a
per-extension scope (closing it removes every registration), behind the capability-declared API so an
out-of-process host can come later without changing the contract. Dogfood rule: at least one first-party
feature ships as an extension. Canonical term: Extension (never "plugin"); the PartOrigin literal is
"extension".
