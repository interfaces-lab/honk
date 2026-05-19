# Multi

Multi takes [t3code](https://github.com/pingdotgg/t3code) as inspiration and as its first iteration. This tree has since diverged in architecture, providers, and shipping, but owes that project the original push.

Multi is a **desktop app** built around a local server. Agent runs, approvals, and live updates stream over WebSockets; the interface is a web UI served from that same process (the desktop shell wraps a local site, not a remote service).

Built-in providers: **Codex**, **Claude**, **OpenCode**, and **Cursor**.

## Install

Download the desktop app for your platform from [GitHub Releases](https://github.com/interfaces-lab/multi/releases).

## Providers

Enable at least one provider in Settings before starting a thread:

- **Codex:** [Codex CLI](https://github.com/openai/codex), then `codex login`
- **Claude:** Claude Code, then `claude auth login`
- **OpenCode:** OpenCode CLI and server; set binary path and server URL in Settings
- **Cursor:** Cursor integration; configure in Settings when you use the Cursor adapter

## Runtime modes

Each thread uses a **runtime mode** that maps provider permission prompts into one policy. Choose it in the composer before you send.

| Mode                  | Behavior                                                               |
| --------------------- | ---------------------------------------------------------------------- |
| **Full access**       | Allow commands and edits without Multi approval prompts.               |
| **Auto-accept edits** | Allow reads and search; ask before edits and commands.                 |
| **Supervised**        | Ask before commands and file changes (reads and search still allowed). |

Providers may still show their own sandbox prompts. See [specs/runtime-permissions.md](./specs/runtime-permissions.md) for the full action matrix.

## Developing

[AGENTS.md](./AGENTS.md) and [specs/README.md](./specs/README.md).
