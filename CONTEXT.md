# Multi

Multi is a desktop agent workbench. This glossary names the domain concepts that should stay stable while the implementation is rewritten around Pi.

## Language

**Pi Agent Runtime**:
The single agent runtime in Multi. It is the domain runtime for agent threads; Codex, Claude, and xAI are accounts/providers/models, not separate runtimes.
_Avoid_: provider runtime, Codex runtime, Claude runtime, Cursor runtime

**Provider**:
A Pi provider that supplies model access and authentication, such as Anthropic, OpenAI Codex, OpenAI, or xAI. A provider is selected by the Pi Agent Runtime; it is not a separate Multi runtime.
_Avoid_: provider runtime, runtime provider, driver

**Model**:
A Pi model identified by provider and model id. Multi may constrain which models are selectable, but it should use Pi's model naming and registry semantics.
_Avoid_: model route, provider instance

**Accounts**:
The settings area where the user manages saved provider credentials. Accounts are grouped by provider and authentication type.
_Avoid_: provider settings, provider instances, runtime settings

**Login**:
The user action that creates or refreshes provider credentials for Pi. Login includes OAuth subscriptions and API-key entry.
_Avoid_: connect runtime, install provider

**Session Tree**:
The Pi-owned tree of session entries for an agent thread. Multi may render and filter it, but it does not define a separate conversation tree.
_Avoid_: thread tree, conversation tree, Multi tree

**Agent Preferences**:
The desktop settings that control accounts, model policy, permissions, session tree behavior, resources, and GUI behavior for the Pi Agent Runtime. The name belongs to Multi's product surface, not to Pi's SDK.
_Avoid_: Pi desktop preferences, provider settings, runtime settings

**Login Completion Page**:
The browser page shown after an OAuth login callback finishes. Multi owns this page's desktop-facing language while Pi owns the login flow.
_Avoid_: Pi TUI success page, callback UI

**Usable Model**:
A Pi model that Multi intentionally exposes through product policy. Usable models are hard-coded by Multi and may be a small subset of Pi's provider catalog.
_Avoid_: available model, provider catalog model, user-selected arbitrary model

**Agent Mode**:
The user's work intent for a thread or turn. An agent mode is a Pi-backed behavior preset that can select the usable model, reasoning posture, tool posture, and custom prompt through product policy.
_Avoid_: model picker, provider picker, runtime mode

**Interaction Mode**:
A Cursor-style behavior profile such as ask, plan, or debug. The default profile is agent and has no visible label.
_Avoid_: Pi runtime mode, TUI mode

**Ask Mode**:
An Interaction Mode for chat-style work with no edit tool. Ask Mode can read and explain but cannot modify files.
_Avoid_: ask_user, clarification request

**ask_user**:
A Pi tool the model calls when it needs a specific user decision. It can be used from any Interaction Mode and does not change the current interaction mode.
_Avoid_: Ask Mode, chat mode

**Applied Mode**:
The Agent Mode and Interaction Mode actually used for a Pi turn. Applied modes are recorded in Pi session history so later tree views, exports, and diagnostics can explain a turn's behavior.
_Avoid_: selected mode, UI mode state

**Pending Mode Change**:
A mode change selected while a Pi turn is already running. Pending mode changes apply to the next turn unless the user stops the current turn and explicitly applies the change.
_Avoid_: live mode mutation, mid-turn mode switch

**Safe Diagnostic Shell**:
Shell access limited to inspection commands. Plan Mode may use the Safe Diagnostic Shell, but it cannot run formatters, package installs, file writes, commits, or destructive commands.
_Avoid_: unrestricted shell, auto-run shell

**subagent**:
The Pi extension tool name used by the model to spawn child agents. Keep this lowercase name at the Pi tool boundary.
_Avoid_: provider child agent, Delegate

**Subagent**:
The user-facing product name for a child agent selected by the Pi `subagent` tool. Subagents appear in ThreadView and the Subagent Preview Tray.
_Avoid_: Delegate, worker bot

**Subagent Run**:
One child Pi session spawned by a `subagent` tool call. A run has status, transcript, tool logs, usage, diff scope, and handback summary.
_Avoid_: Delegate Run, provider thread, spawned process, child-agent runtime

**Subagent Preview Tray**:
The ThreadView tray that previews a Subagent Run without navigating away from the parent thread. It is the renamed continuation of the existing subagent preview tray design.
_Avoid_: agents panel as the only surface, modal transcript

**Subagent Policy**:
The Agent Preferences policy object that controls project-agent trust, Subagent Run permissions, and maximum parallel Subagent Runs.
_Avoid_: stricter child-agent flags, child-agent settings, per-agent boolean
