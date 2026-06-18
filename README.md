# Honk

Honk is an agent workspace for running frontier coding agents against real projects.

It gives coding agents one Pi-backed runtime: one place to start threads, watch work happen, and steer work without changing how you work.

Honk began from [t3code](https://github.com/pingdotgg/t3code) and still carries its local, hackable spirit. Its interface takes inspiration from Cursor.

## Manifest

Honk is built for frontier models only: a shared agent runtime with room for desktop, browser, and terminal surfaces to work in parallel over the same threads. It is full access by default and designed to let agents keep moving while you steer from one clear interface. Honk is opinionated about which account, model, and policy should do the work; you choose intent, not a generic provider marketplace.

## Install

Download the desktop app for your platform from [GitHub Releases](https://github.com/interfaces-lab/honk/releases).

## Accounts

Connect Claude or Codex accounts in Settings before using those modes:

- **Claude API key**
- **Claude OAuth**
- **Codex OAuth**
- **Codex API key**

Cursor Composer uses Cursor Agent CLI auth; run `agent login` or provide `CURSOR_API_KEY` in the environment.

## Runtime Access

Pi runs with full project access by default. Access is not exposed as a user-selectable runtime mode; interaction modes such as Agent, Ask, Plan, and Debug control intent and UI posture.

## Developing

[AGENTS.md](./AGENTS.md)
