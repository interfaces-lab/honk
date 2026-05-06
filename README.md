# Multi

Multi takes [t3code](https://github.com/pingdotgg/t3code) as inspiration and as its first iteration. This tree has since diverged in architecture, providers, and shipping, but owes that project the original push.

**Multi is primarily a desktop app.** The heart of the product is a local **HTTP and WebSocket server**: agent runs, approvals, and live updates stream over WebSockets; the UI is a **web interface** served from that same server (so the desktop shell wraps a local site, not a remote SaaS). You can also run the **CLI** (`usemulti`) and use a browser if you prefer.

Built-in providers: **Codex**, **Claude** (Claude Code), **OpenCode**, and **Cursor** (early access; adapter availability depends on your build).

Shipped builds live on [GitHub Releases](https://github.com/interfaces-co/Multi/releases). Pushing a semver tag matching `v*.*.*` triggers the [Release workflow](https://github.com/interfaces-co/Multi/actions/workflows/release.yml), which builds desktop artifacts, publishes the `usemulti` CLI to npm, and opens a GitHub release.

## Install

### Desktop (recommended)

**macOS** (Homebrew): `brew install --cask multi`  
**Arch** (AUR): `yay -S multi-bin`

Or install from [GitHub Releases](https://github.com/interfaces-co/Multi/releases).

### CLI / browser

```bash
npx usemulti
```

## Providers

Configure at least one before running:

- **Codex:** [Codex CLI](https://github.com/openai/codex), then `codex login`
- **Claude:** Claude Code, then `claude auth login`
- **OpenCode:** Install and configure OpenCode (CLI/server) so Multi can use its API; see OpenCode’s own setup guides.
- **Cursor:** Early access; set up Cursor side of the integration when the Cursor adapter is present in your build.

## Develop

See [CONTRIBUTING.md](./CONTRIBUTING.md). Observability: [docs/observability.md](./docs/observability.md). Support: [Discord](https://discord.gg/jn4EGJjrvv).

```bash
mise install   # optional
bun install .
```
