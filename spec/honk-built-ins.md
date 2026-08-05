# Honk built-ins

> **Status:** Working draft. Update this beside [Honk Core](./core.md).
>
> Honk Core starts useful. Applications do not install Files, Git, MCP, models,
> sessions, or Honk tools before they can use it.

## Read this first

1. Built-ins always ship with Honk Core.
2. Their public methods live under `sdk.*`.
3. They use Pi sessions, tools, resources, and events inside the host.
4. They open only after the workspace trust check.
5. Desktop layout extensions remain client code. They are not core built-ins.

This document defines the built-ins and their SDK namespaces. Keep it aligned
with [Honk Core](./core.md).

# Part I: names and boundaries

## 1. What a built-in is

A built-in is code that Honk registers when the host starts. The user does not
select it from a plugin list. Every client can rely on its SDK namespace and
types.

The built-in may attach Pi tools, resources, or event listeners when a session
opens. That is an implementation detail. Public code sees `sdk.mcp`, not an
`mcp()` factory and not a serialized `AgentHarness`.

```ts
const sdk = await createHonkClient({ transport });

await sdk.files.read({ workspaceId, path: "README.md" });
await sdk.git.status({ workspaceId });
await sdk.mcp.connect({ workspaceId, server: "github" });
```

## 2. Three kinds of extension

| Kind              | Runs in                          | What it may change                                        | Public API                         |
| ----------------- | -------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| Honk built-in     | Core host                        | Host services and each Pi harness                         | Static `sdk.*` namespace           |
| Pi extension      | Core host, after workspace trust | Pi tools, resources, prompts, and events                  | No new static namespace by default |
| Desktop extension | Desktop client                   | Layout, settings, panes, tabs, and native client behavior | Uses the Honk SDK                  |

This split keeps independently compiled web, desktop, and mobile clients on one
known SDK. A workspace Pi extension can still change what the model can do. It
cannot silently add a typed method to three clients that were already built.

We can support compiled SDK extensions later. Such an extension package would
have to ship its host code, client types, runtime schemas, and version together.

# Part II: providers

## 3. Claude Agent SDK runtime

> **Decision:** Do not register the Claude Agent SDK as a Pi model provider in
> the first build. Its public `query()` API owns an agent loop and a separate
> Claude transcript. That conflicts with Core's real `AgentHarness` and sole
> durable Pi session.

The prompt question is settled independently. The Agent SDK accepts a custom
`systemPrompt` string, which replaces its default Claude Code prompt. Omitting
the option uses a smaller SDK prompt. T3 Code deliberately chooses the full
Claude Code preset instead:

```ts
query({
  prompt,
  options: {
    systemPrompt: { type: "preset", preset: "claude_code" },
  },
});
```

T3 Code can make that choice because its adapter lets the Agent SDK own the
loop, tools, Claude session ID, and transcript. T3 then translates SDK stream
events into its own provider event model.

Honk has a different boundary. Pi's `AgentHarness` owns the loop and invokes a
model provider once per model turn. Pi also owns the only durable transcript.
Wrapping `query()` in a Pi provider would nest one agent loop inside another,
let Claude execute tools before Pi receives an unexecuted tool call, and make
Claude's session required for continuation. An MCP proxy does not remove those
conflicts.

The first build therefore adds no Agent SDK dependency, process cache, Claude
session mapping, or MCP proxy. The existing Pi `anthropic` provider remains the
explicit Messages API route. Honk does not modify requests to imitate Claude
Code or copy private billing markers.

### Requirements before implementation

Reconsider a Claude subscription runtime only when one of these boundaries
changes:

1. The official SDK exposes a single-model-turn API that accepts the complete
   Pi role history and returns unexecuted tool calls, or Honk explicitly stops
   using Pi's `AgentHarness` for that session type.
2. A cold host can continue from the Pi session alone. A Claude process,
   session ID, JSONL file, or `SessionStore` mirror cannot be required recovery
   state.
3. Assistant blocks, tool calls, tool results, aborts, and failures round-trip
   through Pi without a second user-visible event or message schema.
4. Honk passes an explicit custom `systemPrompt` and proves that the Claude
   Code preset is absent.
5. Subscription mode uses Anthropic's official authentication path, strips API
   credential environment variables, reports the detected route, and never
   falls back to pay-as-you-go credentials.

Subscription eligibility is an external condition, not a Core guarantee. Antrhopic allows it for now.got it

Sources:

- [T3 Code Claude adapter](https://github.com/pingdotgg/t3code/blob/69dfb7f09a473d270a8b127cb1c39836fa1c6bc4/apps/server/src/provider/Layers/ClaudeAdapter.ts)
- [Customize system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)
- [How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Persist sessions to external storage](https://code.claude.com/docs/en/agent-sdk/session-storage)
- [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

# Part III: SDK

## 4. The first SDK shape

The same client object works in desktop, web, and mobile:

```ts
const sdk = await createHonkClient({ transport });

const opened = await sdk.workspace.open({ directory });
if (opened.type !== "ready") return;

const session = await sdk.session.create({
  workspaceId: opened.id,
  model: { provider: "anthropic", id: "claude-sonnet-4-6" },
});

await sdk.session.prompt({
  sessionId: session.id,
  text: "Find the reload bug",
});
await sdk.mcp.connect({ workspaceId: opened.id, server: "github" });

const state = await sdk.session.reload({ sessionId: session.id });
render(state.entries);
```

No client imports Pi's `AgentHarness`. The SDK returns Pi values where Pi owns
the value, and Honk values where the capability is ours.

## 5. Namespaces needed for the first harness

| Namespace       | Initial methods                                                                                                                                                                                                                           | Scope                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `sdk.workspace` | `open`, `trust`, `get`, `close`                                                                                                                                                                                                           | Host and canonical directory         |
| `sdk.session`   | `list`, `create`, `get`, `delete`, `reload`, `prompt`, `steer`, `followUp`, `abort`, `compact`, `navigateTree`, `setMode`, `changes`, `setWorkspace`, `revert`                                                                            | One Pi session                       |
| `sdk.models`    | `list`, `setCredential`, `deleteCredential`                                                                                                                                                                                               | Host credential and model collection |
| `sdk.files`     | `find`, `list`, `read`, `write`, `delete`, `createDirectory`, `rename`                                                                                                                                                                    | Trusted workspace                    |
| `sdk.git`       | `status`, `diff`, `filePatch`, `fileImage`, `fileContent`, `branches`, `checkout`, `pull`, `discard`, `captureCheckpoint`, `checkpoints`, `checkpointChanges`, `checkpointDiff`, `restoreCheckpoint`, `restoreFiles`, `deleteCheckpoints` | Trusted workspace                    |
| `sdk.mcp`       | `list`, `status`, `add`, `update`, `remove`, `connect`, `disconnect`, `login`, `logout`                                                                                                                                                   | Trusted workspace                    |

Worktree methods do not appear in `sdk.git` yet.

Workspace listing is deliberately absent: `workspace.list` was removed before
implementation, and its slot stays open until the replacement for enumerating
known workspaces is designed.

### Checkpoints: the snapshot primitive under per-turn changes

A checkpoint is a whole-workspace snapshot stored as a hidden parentless
commit under `refs/honk/checkpoints/`, captured through a scratch index so the
user's index, `HEAD`, branches, and log never move. Untracked files are
captured; ignore rules are honored. The git object store is the only storage —
unchanged files share objects between snapshots, and the ref name is the
entire bookkeeping.

Checkpoint names are the caller's convention. The session layer names them
`<sessionId>/<entryId>`, captures one per settled turn, diffs consecutive
checkpoints to answer "what did _this_ turn do" — shell writes included — and
restores one to revert the workspace to that turn. This is the mechanism
behind per-turn changes, proven by OpenCode's message snapshots, t3 code's
checkpoints, and Cursor's checkpoints; a non-git workspace honestly has no
checkpoints rather than a degraded imitation.

Restore has two grains. `restoreCheckpoint` rewrites the whole workspace to a
snapshot, which is what a turn-level revert means. `restoreFiles` takes named
paths back to their snapshot versions and leaves every other path alone —
"this file broke, return it to turn N" without discarding innocent work.
OpenCode's revert restores per file for the same reason; whole-tree restore
is its redo path, not its undo path. A path the snapshot does not hold is
removed, because the honest meaning of restoring it is "this file did not
exist then", and the removal is reported by name.

`fileContent` reads one file's text at the working tree, at `HEAD`, or at a
checkpoint. It is the read behind expand-context on a rendered patch —
Pierre-style hydration fetches both full sides instead of re-requesting
ever-larger context windows — and behind "show me this file as it was at
turn N". Patches answer _what changed_; `fileContent` answers _what was
there_. Binary content is reported as its own state and the bytes stay with
`fileImage`.

### `sdk.session.changes`: what this thread changed, turn by turn

A workspace answers "what changed here". A thread must answer "what did _this
conversation_ change", and those are different questions. Two sessions open on
one directory see each other's edits through `sdk.git.status`, which is the
wrong answer for a transcript, a review surface, or an undo affordance.

`changes` belongs to `sdk.session` because the session is its scope, and it
answers at turn granularity:

```ts
const { turns } = await sdk.session.changes({ sessionId });
// [{ entryId, files: [{ file, status, additions, deletions, ... }] }]
```

Every settled turn captures a workspace checkpoint named
`<sessionId>/<entryId>`, and a turn's changes are the diff between its
checkpoint and the one before it. The snapshot is the truth about content —
shell writes, generated files, and MCP side effects all appear. The turn's own
tool calls are the truth about attribution and gate that diff: a turn that
used only declaring tools claims exactly the paths it named, which keeps a
sibling session's edits and the user's hand edits out of its receipt; a turn
that ran an opaque mutator claims the whole diff, because filtering it would
silently hide real writes. The gate contract lives in
[core.md](./core.md#a-turn-captures-a-checkpoint-tools-gate-attribution).

It adds no durable Honk state. The snapshots live in the workspace's git
object store, the gate is a derivation over the committed transcript, and the
answer is recomputed from both on every read. A workspace without a git
repository has no checkpoints and honestly reports no turns.

`entryId` anchors each receipt to its transcript row and is the handle a
client passes to `sdk.session.revert`. Per-turn patches come from
`sdk.git.checkpointDiff`; `changes` answers _which_ paths per turn, `sdk.git`
answers _what_ changed in them.

`sdk.session.revert({ sessionId, entryId })` restores the workspace to a
turn's checkpoint — `"base"` means the state the session found. The revert is
recorded in the transcript as a custom entry, and a safety checkpoint of the
present is captured under that entry first, so a revert is itself revertible.
The transcript is never rewritten: only the files move.

`sdk.session.setWorkspace({ sessionId, workspaceId })` is `/cd`. Holding a
`WorkspaceId` proves a trust decision, so there is no second gate; the move
takes effect at the next turn, lands in the transcript as a custom entry, and
starts a fresh checkpoint baseline in the new workspace. A turn pair that
spans a `/cd` has no comparable base and is honestly skipped by `changes`.

Where the two disagree, `sdk.git` is authoritative about the working tree and
`changes` is authoritative about the conversation.

## 6. Additional built-in namespaces

| Namespace        | Initial methods                                                                         | Availability                      |
| ---------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| `sdk.skills`     | `list`, `reload`                                                                        | Every host                        |
| `sdk.commands`   | `list`, `run`                                                                           | Every host                        |
| `sdk.terminal`   | `list`, `open`, `write`, `resize`, `clear`, `restart`, `close`, `events`                | Hosts with process execution      |
| `sdk.browser`    | `status`, `open`, `navigate`, `snapshot`, `click`, `type`, `press`, `scroll`, `waitFor` | Hosts with a controllable browser |
| `sdk.extensions` | `list`, `reload`, `errors`                                                              | Every host                        |
| `sdk.events`     | `subscribe`                                                                             | Every host                        |

Capability status methods return a tagged unavailable state. Calling an
unsupported operation rejects with its exact catalog code, such as
`browser.unavailable`. Methods do not vanish from the SDK type and force each
client to guess which ones exist.

## 7. Events and reload

Built-ins do not create a second event history. They publish live state changes
and keep durable state in their owning store:

- Pi session changes persist in the Pi session.
- MCP definitions and credentials persist in their workspace or host stores.
- Git status and terminal output are live observations, not transcript data.
- Plan and diagnosis results persist as Pi session entries.
- Desktop layout state stays in the desktop client.

After reconnect, each namespace reloads its authoritative state. `sdk.session`
uses the read-to-live handoff described in `core.md`.

# Part IV: internal shape

## 8. One workspace instance, many sessions

MCP shows the lifecycle we need. One trusted workspace owns the MCP manager.
Every open session in that workspace receives the manager's current tools.

This is proposed internal code. Applications never import it:

```ts
const mcpBuiltIn = defineHonkBuiltIn({
  id: "mcp",

  async openWorkspace({ workspace }) {
    const manager = await createMcpManager(workspace.directory);

    return {
      sdk: {
        list: () => manager.list(),
        connect: (input) => manager.connect(input),
        disconnect: (input) => manager.disconnect(input),
      },

      async openSession({ tools }) {
        const refresh = () => tools.replace("mcp", manager.tools());
        await refresh();
        const stop = manager.subscribe(refresh);
        return () => stop();
      },

      dispose: () => manager.close(),
    };
  },
});
```

`tools.replace()` is Honk bookkeeping around Pi's real tool registry. It merges
all built-in and Pi extension contributions, then calls:

```ts
await harness.setTools(allTools, activeToolNames);
```

The host registers `mcpBuiltIn` itself. `createHonkCore()` does not ask the
application to pass it back.

## 9. Built-in lifecycle

```text
core starts
    -> start host-scoped stores and services

workspace becomes trusted
    -> open Files, Git, MCP, skills, and workspace extensions

session opens
    -> construct Pi Session and AgentHarness
    -> attach built-in tools, resources, and listeners

session closes
    -> detach session contributions

workspace closes
    -> stop workspace watchers, MCP servers, and session attachments

core closes
    -> close host services and release the writer lease
```

An interface disconnect does not run any of these close paths.

# Part V: decisions we still need

## 10. Hard questions

1. Should browser automation be a core namespace on every host, or a desktop
   capability contributed to core when the desktop owns a browser tab?
2. Should persistent terminals live in core or in the desktop client?
3. Should Build, Ask, Plan, and Debug be core session modes? With no
   permission system, Plan and Debug would rely on prompt guidance rather than
   blocked tools.
4. Should workspace Pi extensions ever add public SDK namespaces? Doing so
   requires distributing matching types and runtime schemas to all three
   clients.
5. Should plan and diagnosis results use Pi custom entries or ordinary tool
   calls whose inputs the clients render?

The first implementation does not need all five answers. It needs a narrow
path through workspace, session, models, Files, Git, and one MCP server.
