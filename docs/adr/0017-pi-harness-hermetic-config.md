# The pi Harness runs hermetic: HONK_HOME/harness/pi, not ~/.pi/agent

The pi Harness is built from pi's SDK surface (`createAgentSession`), and every discovery root it is
given is honk's own: `agentDir` is `HONK_HOME/harness/pi` — session JSONL, settings, and the debug-logs
surface live there — never the user's `~/.pi/agent`. Project-local resources (AGENTS.md context files,
project skills) still load through `DefaultResourceLoader` from the Thread's cwd, because those belong
to the project, not to a pi installation. The alternative — sharing `~/.pi/agent` so a user's installed
pi skills, themes, and extensions appear inside honk for free — was rejected because it hands an unowned
extension surface a place inside the Core's process (user pi extensions executing in honk turns, outside
ADR 0015's Extension boundary), lets pi's own settings fight honk's pinned model and thinking level
(ADR 0014), and interleaves honk's Canonical-Record-adjacent session files with the user's pi history.
Honk sessions must survive `pi` upgrades and uninstalls the user performs on their own tooling; a shared
config space cannot promise that. The user-visible consequence is deliberate: pi skills installed for
the pi CLI do not automatically appear in honk — surfacing user skill libraries is Extension-layer
business (ADR 0015), not an implicit read of another product's home directory.
