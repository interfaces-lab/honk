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

Honk is a pnpm monorepo. [mise](https://mise.jdx.dev/) installs the exact Node and pnpm versions used by the repository; pnpm is the single command surface for development tasks.

```sh
mise install
pnpm install
pnpm typecheck
pnpm test
```

Run the desktop app with `pnpm dev`. Other useful commands are discoverable with `pnpm run`:

| Command                  | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `pnpm lint`              | Run product-design, TypeScript, architecture, and CSS lint rules |
| `pnpm fmt`               | Format the repository                                            |
| `pnpm fmt:check`         | Check formatting without changing files                          |
| `pnpm build`             | Build every package through Turbo                                |
| `pnpm knip`              | Find unused files, exports, and dependencies                     |
| `pnpm assets:brand:sync` | Regenerate app icons from the brand sources                      |

### Repository map

| Path        | What belongs there                                                       |
| ----------- | ------------------------------------------------------------------------ |
| `packages/` | Product packages: app, desktop, mobile, UI, CLI, and shared runtime code |
| `scripts/`  | Typed repository automation with its own pnpm workspace dependencies     |
| `tooling/`  | Custom lint rules, policy checks, and their fixtures                     |
| `assets/`   | Brand sources, generated application artwork, and marketing assets       |
| `docs/`     | Architecture notes and historical engineering audits                     |
| `patches/`  | Dependency patches managed by pnpm                                       |
| `.agents/`  | Repository setup and first-party coding-agent guidance                   |
| `.github/`  | CI and release automation                                                |

Root configuration files stay at the root when their tools discover them by convention. Shared TypeScript policy lives in `tsconfig.base.json`, dependency policy in `pnpm-workspace.yaml`, and task orchestration in `turbo.json`.

Read [AGENTS.md](./AGENTS.md) before making changes. It contains the repository's coding conventions, architecture boundaries, and verification guidance.
