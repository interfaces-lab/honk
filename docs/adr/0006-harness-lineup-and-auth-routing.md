# Three Harnesses — pi, Claude Code, Cursor — with credential-driven routing

> Amended by ADR 0016: the login list and the two-harnesses-per-provider consequence below are
> superseded — Anthropic auth is delegated to the local Claude Code login (no pi route, no honk-owned
> Anthropic login), pi's one login is Codex OAuth, Cursor uses a honk-stored API key, and each
> Provider maps to exactly one Harness.

The Core integrates agent engines as sibling Harnesses, none impersonating another's model stream (this
deletes today's fake-provider pattern: streamSimple overrides in pi's process-global last-write-wins
registry smuggling tool results as tagged synthetic blocks). The lineup and the routing are dictated by
credential reality, not preference:

- **Claude Code Harness** (Anthropic Agent SDK on the user's local Claude Code instance): the only path to
  Anthropic subscription OAuth. Runs its own loop and tools; the Core observes.
- **Cursor Harness** (ACP child process): Cursor has no API-callable surface, so ACP is forced.
- **pi Harness**: the native and most important one — it carries pi's extension system (the substrate for
  a future honk extension layer) and owns every login honk can offer its own UX for: Claude API key,
  Codex OAuth, OpenAI API key, and the rest of pi-ai's provider catalog.

Consequence worth stating: one Provider (Anthropic) is served by two Harnesses depending on credential
kind — subscription-OAuth routes to Claude Code, API-key routes to pi. Model catalog and login flows must
key on credential kind, and honk's desktop login UI is built over pi's auth layer for the pi-side logins.
Every Harness keeps its own internal session/resume state (pi JSONL, Claude session ids); the Canonical
Record written from observed Harness events is the durable truth (t3code's model). This is deliberately
"part opencode, part t3code" — t3code wraps only external harnesses; honk additionally offers pi-level
direct logins.

Rejected: rebuilding the agent loop in-house with pi-ai as a bare streaming library (forfeits pi's
extension system, the customization vehicle honk actually values); keeping pi-coding-agent as the single
host all other harnesses tunnel through (today's architecture — the LWW-registry and strip-before-persist
hacks are the evidence against it).
