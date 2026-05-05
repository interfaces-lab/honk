# Multi

Multi is a coding-agent workbench for using providers like Codex and Claude across saved codebases.

## Language

**Workbench**:
The interactive Multi shell where a user works with threads, files, terminals, git, browser panels, and settings.
_Avoid_: Workspace

**Environment**:
A local or remote Multi server that hosts Projects and controls Agent execution.
_Avoid_: Workspace, Worktree, Provider

**Project**:
A user-configured code root in Multi that owns codebase-scoped defaults, scripts, and threads.
_Avoid_: Workspace

**Project Root**:
The filesystem path attached to a Project.
_Avoid_: Workspace path, workspace

**Settings**:
User and server preferences that configure Multi itself rather than a specific codebase.
_Avoid_: Project config when describing global preferences

**Thread**:
A conversation with a coding agent. It may be general chat with no Project context, or codebase-scoped inside one Project.
_Avoid_: Chat, session, conversation as a named concept

**Agent**:
The provider-backed runtime that performs work inside a Thread.
_Avoid_: Thread, conversation

**Provider**:
An external coding-agent integration such as Codex or Claude.
_Avoid_: Agent when naming the product choice shown to users

**Provider Instance**:
A configured Provider runtime identity that can run Thread work.
_Avoid_: Provider when referring to a specific configured runtime or account

**Model**:
A Provider-specific AI model available for Thread work.
_Avoid_: Provider

**Session**:
The internal runtime lifecycle for an Agent inside a Thread.
_Avoid_: User-facing object

**Runtime Mode**:
The internal permission/autonomy setting for Agent work in a Thread.
_Avoid_: User-facing label

**Plan Mode**:
A user-facing Thread mode where the Provider produces a Proposed Plan instead of immediately implementing.
_Avoid_: Interaction Mode

**Interaction Mode**:
The internal setting that controls the Provider's response style in a Thread.
_Avoid_: User-facing label

**Proposed Plan**:
A Provider-authored implementation plan attached to a Thread that can later be implemented.
_Avoid_: Handoff, draft

**Turn**:
An internal execution cycle for one user request and the Agent work that follows inside a Thread.
_Avoid_: User-facing message

**Checkpoint**:
An internal saved Project state used for diffing and reverting Thread work.
_Avoid_: User-facing object

**Changes**:
User-facing modifications produced by Agent work in a Project.
_Avoid_: Diff when writing product UI

**Diff**:
A developer-facing patch comparison between Project states.
_Avoid_: Changes when describing patch mechanics

**Worktree**:
A Git worktree used to isolate Thread work from the Project Root.
_Avoid_: Workspace

**Message**:
Conversation content in a Thread authored by the user, a Provider, or the system.
_Avoid_: Timeline row, activity

**Timeline Row**:
A user-visible row in the Thread timeline that can present a Message, grouped work activity, a Proposed Plan, or working state.
_Avoid_: Message

**Activity**:
A runtime work signal inside a Thread that is not conversation content.
_Avoid_: Message

**Approval**:
A user decision that allows or denies a Provider request during a Thread.
_Avoid_: Runtime Mode

**User Input Request**:
A Provider request for information or choices from the user during a Thread.
_Avoid_: Approval

## Relationships

- An **Environment** hosts zero or more **Projects**
- A **Project** belongs to one configured code root through its **Project Root**
- A **Project** owns zero or more codebase-scoped **Threads**
- A **Thread** may be projectless for general chat, or belong to exactly one **Project** for codebase-scoped work
- A **Thread** can contain zero or more **Proposed Plans**
- A **Thread** contains user-visible messages and internal **Turns**
- A **Turn** can have an internal **Checkpoint**
- A **Diff** compares **Changes** between Project states
- A **Thread** may run in a **Worktree** separate from the **Project Root**, but the **Project** remains its owner
- A **Thread** contains **Messages**, **Proposed Plans**, and **Activity**
- A **Thread** timeline presents **Messages**, **Proposed Plans**, and **Activity** as **Timeline Rows**
- A **Thread** is run by one **Agent** at a time
- A draft **Thread** can choose any available **Provider Instance** and **Model**
- A started **Thread** is locked to its **Provider**
- A started **Thread** can change **Models** across Turns
- A started **Thread** can switch **Provider Instances** only when their runtime continuation is compatible
- A **Thread** has one **Runtime Mode** that reflects the user's permission/access choice
- A **Runtime Mode** controls when **Approvals** are requested
- An **Approval** asks for permission, while a **User Input Request** asks for information
- A **Thread** can be in **Plan Mode** through its internal **Interaction Mode**
- An **Agent** is backed by exactly one **Provider**
- A **Provider** offers one or more **Models**
- A **Session** produces user-visible status text for its **Thread**
- The **Workbench** displays the active **Project**, **Thread**, and supporting panels
- **Settings** configure Multi globally, while a **Project** configures one codebase

## Example dialogue

> **Dev:** "Should this provider binary path live on the **Project**?"
> **Domain expert:** "No — provider binaries are **Settings**. The **Project** can store codebase defaults like its model choice and scripts."
> **Dev:** "Can a **Thread** start in Codex and continue in Claude?"
> **Domain expert:** "No — create another **Thread** in the same **Project** and link it to the original work."
> **Dev:** "Is implementing a **Proposed Plan** a general handoff?"
> **Domain expert:** "No — the transferable unit is the **Proposed Plan**, not the whole previous **Thread**."

## Flagged Ambiguities

- "workspace" was used to mean both the product shell and a configured code root — resolved: use **Workbench** for the shell and **Project** for the code root.
- "environment" was considered as generic execution language — resolved: **Environment** means a local or remote Multi server used for remote control.
- "project" was used for the persisted code root container — resolved: **Project** is the canonical product/domain language. Do not replace it with Workspace for current interfaces.
- "agent" was used for sidebar conversation entries — resolved: use **Thread** for the durable conversation and **Agent** for the runtime performing work inside it.
- "agent" was considered as the primary user-facing provider abstraction — resolved: users mostly see concrete **Provider** names like Codex and Claude.
- "model" was considered interchangeable with provider — resolved: a **Provider** offers multiple **Models**.
- "provider" was considered switchable for a Thread — resolved: draft **Threads** can choose any **Provider**, while started **Threads** are **Provider**-locked.
- "provider instance" was considered settings-only language — resolved: users can choose and switch **Provider Instances**.
- "conversation" was considered as a product term — resolved: use **Thread** as the named concept; "conversation" is only descriptive prose.
- "session" was considered for user-facing runtime state — resolved: **Session** is internal, while its state appears as status text on a **Thread**.
- "runtime mode" was considered for product UI — resolved: **Runtime Mode** is internal; users choose permission/access behavior.
- "interaction mode" was considered for product UI — resolved: **Plan Mode** is user-facing, while **Interaction Mode** is internal.
- "approval" was considered as runtime mode language — resolved: **Approval** is a specific user decision; **Runtime Mode** controls when decisions are required.
- "approval" was used for any Provider pause — resolved: **Approval** is permission; **User Input Request** is information gathering.
- "handoff" was considered for plan implementation across Threads — resolved: the supported concept is **Proposed Plan** implementation, not a general Thread handoff.
- "turn" was considered for user-facing conversation structure — resolved: **Turn** is internal; users see messages and work output.
- "checkpoint" was considered for product vocabulary — resolved: **Checkpoint** is implementation language; users see changes, diffs, and revert affordances.
- "diff" was considered for user-facing UI — resolved: users see **Changes**; developers use **Diff** for patch comparison mechanics.
- "worktree" was considered as generic project language — resolved: **Worktree** means Git worktree.
- "message" was used for both conversation content and UI display rows — resolved: **Message** is content, **Timeline Row** is presentation.
- Tool executions, approvals, file reads, command output, progress, warnings, and errors are **Activity**, not **Messages**.
