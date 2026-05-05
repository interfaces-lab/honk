# Dream Agent Workflow Coverage

This note maps the tweet/spec workflow against Multi's current codebase.

Scope inspected:

- Product/domain docs: `README.md`, `CONTEXT.md`, `TODO.md`
- App shell and UI: `packages/app/src/components/**`, `packages/app/src/hooks/**`, `packages/app/src/lib/**`, `packages/app/src/store.ts`
- Server orchestration: `packages/server/src/orchestration/**`, `packages/server/src/provider/**`, `packages/server/src/codex-app-server-manager.ts`
- Git, PR, worktree, terminal, scripts: `packages/server/src/git/**`, `packages/server/src/project/**`, `packages/server/src/terminal/**`, `packages/contracts/src/{orchestration,git,rpc,server,terminal}.ts`, `packages/shared/src/project-scripts.ts`
- External reference check: Symphony, Diffity, Matt Pocock skills, portless, t3code links from the tweet

## Spec Workflow

The tweet describes a higher-level "stop babysitting agent runs" system:

1. Turn project/feature/bug ideas into Linear tickets.
2. Let agents help make MVPs, then implement real versions.
3. Use a Symphony-like orchestrator that shows active tasks.
4. Clicking a ticket should show output controls, not the running agent chat: dev server, tests, diff.
5. Backlink the local orchestrator URL from Linear tickets and GitHub PRs.
6. Use Graphite stacked diffs where useful, planned through child tickets.
7. Use a local PR reviewer like Diffity: comment to refine the original ticket, or comment to create a skill that prevents repeat patterns.
8. Enforce anti-patterns with Sentry Warden.
9. Keep the layer harness/agent agnostic.
10. Prefer existing tools for planning, issues, agent running, review, ports, saved commands, and maintain only the orchestration layer.
11. End-state loop: input ticket -> output result -> local review -> iterate.
12. Linear MCP should ship skills/load-skill tooling so the normal local agent can turn ideas into tickets with repo context.

## Coverage Summary

| Workflow area                                      | Multi coverage                                       | Evidence                                                                                                                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent workbench over saved codebases               | Covered                                              | `README.md`; `CONTEXT.md`; `OrchestrationProject`, `OrchestrationThread` in `packages/contracts/src/orchestration.ts`; shell sidebar models in `packages/app/src/lib/sidebar-chat-view-model.ts`                              |
| Harness/provider agnostic agent execution          | Partial to strong                                    | Built-in providers include Codex, Claude, OpenCode, Cursor in `packages/server/src/provider/builtInProviderCatalog.ts`; common `ProviderService` and adapter layer; Codex app-server path is still the deepest implementation |
| Active task/status overview                        | Covered for threads, not tickets                     | Sidebar derives `running`, `needs_attention`, `error`, `idle` from session/projection state in `sidebar-chat-view-model.ts`; `AgentRow` renders status dots                                                                   |
| Agent chat visibility                              | Opposite default                                     | Multi's primary object is a Thread/chat timeline. The tweet wants ticket output views where users do not inspect running agent chat by default. Multi has shell panels, but selecting a thread still opens the conversation   |
| Project/feature/bug breakdown into Linear tickets  | Missing                                              | No Linear/issue domain, no Linear MCP/client, no ticket schema, no ticket creation workflow found                                                                                                                             |
| Planning mode                                      | Partial                                              | `ProviderInteractionMode` has `plan`; Codex plan-mode developer instructions exist in `codex-app-server-manager.ts`; proposed plans are stored/rendered via `OrchestrationProposedPlan` and `ProposedPlanCard`                |
| Plan -> implementation handoff                     | Partial                                              | Composer has plan follow-up/implement behavior and `implementationThreadId`; `CONTEXT.md` defines Proposed Plan implementation, not general handoff                                                                           |
| MVP concept workflow                               | Missing as explicit workflow                         | Plan mode can ask for a prototype, but there is no product state that separates MVP exploration from production implementation                                                                                                |
| Run dev server/tests from task/ticket              | Partial                                              | Project scripts exist (`ProjectScript`, `ProjectScriptsControl`) with icons for play/test/lint/build/debug and terminal execution; no ticket-scoped command runner and no first-class test result view                        |
| Saved commands                                     | Partial                                              | Project scripts are saved per project and can run in terminals; t3code-style saved commands are not a distinct feature                                                                                                        |
| Run multiple dev servers on the same port          | Missing                                              | No portless integration or named `.localhost` routing found; terminals/scripts can run servers manually                                                                                                                       |
| Diff view                                          | Covered for git working tree; partial for turn diffs | Git panel uses `@pierre/diffs` and lazy patch loading; contracts expose `getTurnDiff` and `getFullThreadDiff`; Diffity-style review comments are missing                                                                      |
| PR/local review flow                               | Partial                                              | GitHub PR resolution and PR checkout into local/worktree threads exist; local diff viewing exists; no inline review comments that feed ticket refinement or skill creation                                                    |
| GitHub PR creation                                 | Covered for GitHub CLI path                          | `GitRunStackedAction` supports `commit`, `push`, `create_pr`, `commit_push`, `commit_push_pr`; `GitManager.runStackedAction` uses GitHub CLI for PR creation                                                                  |
| Graphite stacked diffs                             | Missing                                              | "StackedAction" in Multi means local branch/commit/push/PR action, not Graphite. No Graphite integration found                                                                                                                |
| Child tickets for planning stacks                  | Missing                                              | No issue/ticket tree or child-ticket planning model found                                                                                                                                                                     |
| Backlink local orchestrator URL into Linear/GitHub | Missing                                              | No local orchestrator permalink/backlink domain and no Linear/GitHub backlink writer found                                                                                                                                    |
| Worktree isolation                                 | Covered                                              | Thread has `branch` and `worktreePath`; `GitCreateWorktreeInput`; `GitManager.preparePullRequestThread`; setup scripts can run on worktree create                                                                             |
| PR checkout into review thread                     | Covered                                              | `PullRequestThreadDialog` resolves GitHub PR references and prepares local or worktree thread                                                                                                                                 |
| Approval and user-input handling                   | Covered                                              | Pending approval/user-input schemas, projection counts, composer panels/actions, Codex request tracking                                                                                                                       |
| Skills surfaced to composer                        | Partial                                              | Provider skills are part of `ServerProviderSkill`; composer can mention/browse skills; no Linear MCP load-skill workflow or comment-to-skill creation flow                                                                    |
| Anti-pattern enforcement with Warden/Sentry        | Missing                                              | No Warden, Sentry anti-pattern policy, or enforcement hook found                                                                                                                                                              |
| Output-first ticket result loop                    | Partial                                              | Multi has diffs, terminals, scripts, PR prep, plans, and statuses. It lacks ticket as the input/output unit and lacks local review comments that mutate ticket/skills                                                         |

## What Multi Already Covers Well

### 1. Local agent workbench

Multi already models the core local workbench around Projects, Threads, Agents, Providers, Sessions, Worktrees, Proposed Plans, Activities, Approvals, and Checkpoints. The domain language in `CONTEXT.md` is aligned with a durable orchestration layer rather than a one-off chat wrapper.

The server has an event/projection pipeline:

- Commands and events in `packages/contracts/src/orchestration.ts`
- Command validation/decisioning in `packages/server/src/orchestration/decider.ts`
- Projection into read models in `packages/server/src/orchestration/projector.ts`
- Shell and thread subscriptions via `orchestration.subscribeShell` and `orchestration.subscribeThread`

This is a strong base for a Symphony-like control plane.

### 2. Provider abstraction

Multi is not purely Codex-only anymore at the catalog level. The built-in provider list includes Codex, Claude Agent, OpenCode, and Cursor. Providers share common session, model, runtime-mode, turn, approval, and event surfaces.

Current limitation: Codex app-server support is the richest path, and provider capability parity is not guaranteed.

### 3. Active run visibility

The sidebar already gives a thread-level active-work overview:

- `running` when streaming/session status is starting or running
- `needs_attention` when pending approvals/user input exist
- `error` for failed sessions
- `idle` otherwise

This covers "what tasks are actively running" at the Thread level. It does not cover the tweet's Ticket level because Multi has no ticket model.

### 4. Worktrees and PR review entrypoints

Multi has meaningful worktree support:

- Threads carry `branch` and `worktreePath`
- Draft state supports local vs worktree mode
- Git worktree creation/removal is in contracts and server Git core
- PR references can be resolved and prepared as local or worktree threads
- Setup scripts can run when a worktree is created

This is one of the closest matches to the "stop babysitting runs" workflow because it enables isolated agent work and local review without disturbing the main checkout.

### 5. Diff and source-control UI

Multi has a real git diff panel:

- Changed-file tree
- Unified/split diff style
- Lazy patch loading
- Expand/collapse controls
- Discard per file or all files
- Commit, branch commit, push, and PR-oriented action plumbing

This is not Diffity's full local PR-review loop, but the raw review surface exists.

### 6. Project scripts and terminals

Project scripts cover a large part of "run dev server, tests, saved commands":

- Scripts are stored on the project/project
- Icons include play, test, lint, configure, build, debug
- Scripts can be run from UI controls
- Setup scripts can run automatically for worktrees
- Terminals receive `MULTI_PROJECT_ROOT` and `MULTI_WORKTREE_PATH`

Missing: command result capture as a first-class ticket artifact, portless/named-localhost support, and test/dev-server status summarized on a ticket.

### 7. Plan mode and proposed plans

Plan mode is present and fairly integrated:

- Provider interaction mode includes `plan`
- Composer toggles Build/Plan
- Proposed plans are projected and displayed
- Users can copy/download/save plans
- Composer follow-up supports refining or implementing a plan
- Proposed plan implementation can link to an implementation thread

This supports "agent helps plan, then implement" but stops short of "break into Linear tickets".

## Major Gaps

### 1. No Linear or ticket domain

The spec's core unit is a Linear ticket. Multi's core unit is a Thread inside a Project. There is no:

- Linear MCP integration
- Issue/ticket schema
- Ticket import/export
- Ticket status mapping
- Child ticket tree
- Ticket assignment to local/cloud agents
- Ticket output/result artifact

Without this, Multi can orchestrate agent threads but cannot currently implement the tweet's ticket-first workflow.

### 2. No idea -> ticket decomposition workflow

Plan mode can generate a plan, and provider skills can be surfaced, but there is no product workflow that:

- Takes a project/feature/bug input
- Produces linearized implementation tickets
- Creates those tickets in Linear
- Assigns them to agents
- Tracks ticket dependency/order

This is the largest planning gap.

### 3. The main UI is still chat-first

The tweet explicitly says clicking a ticket should not show the agent chat. Multi's selected item is a Thread and the primary surface is the conversation timeline. Shell panels for git, files, and terminal exist, but they are adjacent to chat rather than replacing chat with an output-focused ticket page.

To match the spec, Multi would need a task/ticket detail view where the default state is:

- Status
- Diff
- Commands/dev server/tests
- PR/check links
- Review comments/actions
- Agent log only as a secondary drill-down

### 4. No local review-comment loop

Multi can view diffs and ask agents for follow-up in chat. It does not have Diffity-style review comments with structured actions:

- Comment on a diff line/file
- Choose "refine original ticket"
- Choose "create/update skill to prevent recurrence"
- Re-run or queue agent work from that comment
- Preserve review comments as durable artifacts

This is a key missing part of the "input ticket -> output result -> review -> iterate" loop.

### 5. No Graphite or stacked-diff planning

Multi has `GitRunStackedAction`, but that name refers to local commit/push/PR phases, not Graphite stacked diffs. There is no Graphite CLI/API integration and no planner that maps parent/child tickets to stacked branches/PRs.

### 6. No backlinks to external systems

No implementation was found for:

- Generating a stable local orchestrator URL per task/thread/ticket
- Writing that URL back to Linear
- Writing that URL into GitHub PR descriptions/comments
- Reading backlinks to reconnect external tickets/PRs to Multi state

### 7. No Warden/Sentry anti-pattern enforcement

No Warden or Sentry anti-pattern enforcement path exists. Multi has approvals and runtime modes, but those gate provider actions, not code-pattern policies.

### 8. No portless integration

Multi can run scripts in terminals, but it does not integrate portless or any equivalent named-localhost proxy for multiple dev servers on the same nominal port.

## External Reference Alignment

- Symphony: closest conceptual match for isolated autonomous implementation runs and higher-level management.
- Diffity: closest match for local diff review and agent-agnostic review loops.
- Matt Pocock skills: aligns with reusable planning/PRD skills, but Multi only surfaces provider skills; it does not own a planning-skill library.
- portless: aligns with task-scoped dev-server ergonomics; not present in Multi.
- t3code saved commands: Multi project scripts are the nearest equivalent.
- `diffs.com` / `trees.com`: Multi already uses `@pierre/diffs`; file tree and diff surfaces exist, but not a full IDE/review experience.

## Recommended Implementation Slices

1. Add a ticket/task domain separate from Thread.
   - Persist task id, source, title, status, parent id, linked thread ids, linked PRs, local URL, and output artifacts.
   - Start local-only first before Linear writeback.

2. Build an output-first task detail route.
   - Default panels: status, commands, diff, PR, review comments.
   - Hide chat behind an "Agent log" affordance.

3. Connect existing Threads to Tasks.
   - A task can own one or more implementation threads.
   - Thread active/error/attention state rolls up to task state.

4. Promote project scripts into task commands.
   - Store command runs and last status.
   - Add dev-server/test/lint/build result summaries.
   - Later add portless/named-localhost support.

5. Add review comments over diffs.
   - File/line comments first.
   - Actions: "request changes from agent" and "save as skill candidate".
   - Feed comments into a follow-up turn or new thread.

6. Add external links/backlinks.
   - Generate stable Multi task URLs.
   - Add GitHub PR body/comment writeback first because GitHub CLI infrastructure already exists.
   - Add Linear MCP/client after the local task model is stable.

7. Add stacked PR planning.
   - Model parent/child task dependencies first.
   - Then integrate Graphite for branch/PR stack creation where requested.

8. Add policy/anti-pattern enforcement.
   - Start with local skill/policy checks generated from review comments.
   - Add Sentry Warden integration once there is a clear policy lifecycle.

## Bottom Line

Multi covers the local workbench foundation: provider sessions, active thread status, worktrees, terminals, scripts, diffs, PR checkout, PR creation, approvals, checkpoints, and proposed plans.

Multi does not yet cover the spec's main product workflow: ticket-first planning and execution, Linear integration, output-first task review, backlinks, Graphite stacks, review-comment-to-iteration, review-comment-to-skill, Warden enforcement, or portless dev-server routing.
