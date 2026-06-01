# Multi

Multi is an agent workspace for running frontier coding agents against real projects.

It gives Codex, Claude, and Cursor a shared runtime: one place to start threads, watch work happen, approve risk when you want supervision, and switch between providers without changing how you work.

Multi began from [t3code](https://github.com/pingdotgg/t3code) and still carries its local, hackable spirit. Its interface takes inspiration from Cursor.

## Manifest

Multi is built for frontier models only: a shared agent runtime with room for desktop, browser, and terminal surfaces to work in parallel over the same threads. It is full access by default and designed to let agents keep moving while you steer from one clear interface. It is not fully opinionated about how you work, but it is opinionated about which model or provider should do the work. Codex, Claude, and Cursor can each be the right agent for a different job, and Multi makes switching between them feel like one product instead of three separate workflows.

## Install

Download the desktop app for your platform from [GitHub Releases](https://github.com/interfaces-lab/multi/releases).

## Providers

Enable at least one provider in Settings before starting a thread:

- **Codex:** [Codex CLI](https://github.com/openai/codex), then `codex login`
- **Claude:** Claude Code, then `claude auth login`
- **Cursor:** Cursor integration; configure in Settings when you use the Cursor adapter

## Runtime modes

Each agent turn uses a **runtime mode** that maps provider permission prompts into one policy. Full access is the default; change the default in Settings -> Agents.

| Mode                  | Behavior                                                               |
| --------------------- | ---------------------------------------------------------------------- |
| **Full access**       | Allow commands and edits without Multi approval prompts.               |
| **Auto-accept edits** | Allow reads and search; ask before edits and commands.                 |
| **Supervised**        | Ask before commands and file changes (reads and search still allowed). |

## Developing

[AGENTS.md](./AGENTS.md)
