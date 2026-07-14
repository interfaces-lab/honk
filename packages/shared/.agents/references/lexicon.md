# Honk Agent Lexicon

Shared product vocabulary for user-facing copy and structured logs. Load from `cli-ux` and `logger-ux` skills.

Canonical source for nouns: `CONTEXT.md` Language section.

## Canonical Nouns

| Term | Use for | Avoid |
| ---- | ------- | ----- |
| **Core** | The Honk process that runs agents and owns durable state | backend, server, runtime host, engine |
| **Client** | Any surface attached to the Core (desktop app, web, CLI) | frontend, app (ambiguous) |
| **Core App** | A Client that may start the Core (desktop app, CLI) | launcher, host app |
| **Serve Mode** | Headless long-lived Core (`honk serve`) | daemon, background service |
| **thread** | One conversation with an agent | session (conversation), chat |
| **workspace** | Project-scoped work area in the Client | project (unless literal path or third-party name) |
| **Harness** | Agent engine adapter (pi, Claude Code, Cursor) | provider (that's the model vendor) |
| **Provider** | Model/credential vendor (Anthropic, OpenAI/Codex, Cursor) | harness |

## Legacy Substitutions

- `backend` / `server` → **Core** in user-facing CLI copy.
- In desktop logs, `backend` may mean the Bun HTTP server layer — never interchange with **Core** in the same event family.
- `session` → **thread** for conversations; keep `session` for auth sessions, SSE sessions, and subprocess session boundaries (`sessionId`, `sse session invalid`).
- `frontend` / `app` → **Client** or **desktop app** when routing users to UI.

## User Destinations

Route users to concrete surfaces, not bare product name:

- **desktop app** — folder pickers, login, thread UI
- **honk serve** — start a long-lived Core for web/remote Clients
- **settings** — auth and configuration (not defaults/preferences)

## Shared Banned Tokens

Both CLI copy and log `message` strings must not use:

- `successfully` (name what completed)
- `Unable to`, `An error occurred`, `Something went wrong` (except true last-resort fallback)
- `Oops`, `Uh-oh`, `Whoops`, `Yay`, `Yikes`, `Heads up`
- hype: `seamlessly`, `effortlessly`, `leverage`, `utilize`, `streamline`, `robust`, `powerful`
- filler: `just`, `simply`, `actually`, `In order to`, `At this time`

Full CLI banned list: `packages/core/.agents/skills/cli-ux/references/copy.md` → Banned + Avoided Language.

## Surface Grammar

| Surface | Shape | Recovery |
| ------- | ----- | -------- |
| **CLI human copy** | Sentence fragments or full sentences; `Failed to` / `Couldn't` by failure class | Name the next command or destination |
| **Log `message`** | 3–8 token lowercase event phrase; IDs in fields | Reserve user recovery for CLI/UI — not logs |
| **Hybrid operator lines** | `Effect.log` receipts that function as CLI output (serve boot) | Load **both** skills; receipt wording follows `command-contracts.md`; field shape follows logger-ux when migrating |

## Failure Grammar Split

- **CLI errors:** `Failed to` / `{Noun} failed` for system/Core/API failures; `Couldn't` / `Can't` for validation and user-state failures.
- **Log errors:** stable event names (`turn settlement failed`, `core dispose failed`); attach `cause` or `{ reason }` in fields — do not apply CLI `Failed to` / `Couldn't` taxonomy to log messages.
