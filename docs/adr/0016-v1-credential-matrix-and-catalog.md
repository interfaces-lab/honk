# The v1 credential matrix and the three-model catalog

Exactly three ways to authenticate, and only two of them are credentials honk stores. Anthropic auth is
fully delegated: the Claude Code Harness rides whatever the user's local Claude Code login is —
subscription OAuth or their own API key — probed through the Agent SDK (accountInfo / auth status) and
surfaced as harness availability with a derived label ("Claude Max Subscription", "Claude API Key"; the
t3code pattern). Honk never stores an Anthropic credential and never offers a claude.ai login flow — the
posture Anthropic's SDK terms sanction for third-party products; "log in" for Anthropic means sending the
user to Claude Code itself. Codex OAuth lives in pi auth behind Honk-owned login UI and unlocks the pi
Harness. Cursor authenticates with a dashboard API key (creatable on every plan) stored by honk and
injected as CURSOR_API_KEY when the ACP child spawns — spawned with an isolated auth context, because the
CLI's precedence between a stored `agent login` session and the env key is undocumented. Login and logout
are Core App capability (desktop/CLI); web sessions read auth state and are pointed at a Core App.

codex-api-key was in the matrix and was dropped: verified in pi 0.80.2, the openai-codex provider is
OAuth-only (the ChatGPT backend requires an account-bearing JWT), the API-key path would ride pi's plain
openai provider against Platform billing, and Platform has no gpt-5.5 — so a stored Codex API key would
unlock nothing in this catalog. A credential kind that cannot run a model is worse than an absent one;
reintroducing it when Platform catches up is a core/v1 version event (ADR 0012), paid knowingly.

The model catalog is hardcoded to three models across three Providers — anthropic, openai-codex, cursor —
extending ADR 0012's AI-free-zone stance from Harnesses to Providers and models: gpt-5.5 (backing the
Rush and Deep Modes at low/high — reasoning never turns off on the ChatGPT backend), Fable 5 (Smart, at
medium, 1M context), and Composer (composer-2.5 with the fast toggle). Each model's thinkingLevels is
exactly the set of pairs we present — the Mode table — not the model's capability ceiling. Every pair on
the wire is one we route, test, and present deliberately; anything beyond the catalog is the Extension
layer's business (ADR 0015).

This supersedes ADR 0006's provisional login list and its dual-route consequence: the plain `openai`
provider is dropped, "Claude API key via pi" is dropped, and each Provider maps to exactly one Harness
(Anthropic → Claude Code, Codex → pi, Cursor → cursor), which strengthens ADR 0014's origin-narrowing —
a model pins not just a Harness but the only Harness its Provider ever uses. With one credential kind (or
delegation) per Provider there is no routes concept on the wire at all: ModelDescriptor.available is the
one route's state, and staleness costs exactly one typed rejection at threads.create, because auth and
catalog state are fetch-only — never pushed (the t3code posture; ADR 0008's two subscription altitudes
stand untouched).
