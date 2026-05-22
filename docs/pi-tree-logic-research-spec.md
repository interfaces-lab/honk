# Pi-Style `/tree` Logic For Multi

Research spec. This is not a Pi implementation, not a Pi harness port, and not a replacement for Multi's backend. The goal is to implement the effective `/tree` logic inside Multi's orchestration/event/projection architecture.

## Source Evidence

Pi source was resolved with `codebase-cli` at `/Users/workgyver/.agents/codebases/earendil-pi`.

Key Pi files:

- `/Users/workgyver/.agents/codebases/earendil-pi/packages/agent/src/harness/types.ts`
- `/Users/workgyver/.agents/codebases/earendil-pi/packages/agent/src/harness/session/session.ts`
- `/Users/workgyver/.agents/codebases/earendil-pi/packages/agent/src/harness/session/jsonl-storage.ts`
- `/Users/workgyver/.agents/codebases/earendil-pi/packages/agent/src/harness/compaction/branch-summarization.ts`
- `/Users/workgyver/.agents/codebases/earendil-pi/packages/coding-agent/src/core/agent-session.ts`
- `/Users/workgyver/.agents/codebases/earendil-pi/packages/coding-agent/src/modes/interactive/components/tree-selector.ts`

Key Multi files:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/provider.ts`
- `packages/server/src/orchestration/decider.ts`
- `packages/server/src/orchestration/projector.ts`
- `packages/server/src/orchestration/ProjectionPipeline.ts`
- `packages/server/src/orchestration/ProviderCommandReactor.ts`
- `packages/server/src/provider/ProviderAdapter.service.ts`
- `packages/server/src/provider/ProviderService.service.ts`
- `packages/server/src/persistence/migrations/001_OrchestrationEvents.ts`
- `packages/server/src/persistence/migrations/005_Projections.ts`
- `packages/app/src/stores/thread-store.ts`
- `packages/app/src/stores/thread-sync.ts`

## What To Copy From Pi

Copy the invariants, not the implementation:

- Persist conversation topology as append-only facts.
- Every context-bearing entry has a stable id and a parent id.
- Appending a new entry uses the current active leaf as parent, then advances the leaf.
- `/tree` navigation moves the active leaf; the next append creates a branch.
- The model context is derived from the active root-to-leaf path, never from the whole thread.
- Tree views are derived from flat entries and parent ids.
- Labels are append-only metadata targeting entries; latest non-empty label wins.
- Branch summaries are optional context entries inserted when leaving one branch for another.
- Active leaf movement must be durable. Use Pi's newer harness `leaf` concept, not the older `coding-agent` in-memory-only leaf mutation.

Do not copy:

- Pi JSONL storage.
- Pi `SessionManager`.
- Pi extension events or stale-context machinery.
- Pi TUI rendering, key defaults, ASCII gutters, terminal filters as-is.
- Pi provider/model/auth plumbing.
- Pi exact branch-summary prompt unless product wants identical wording.

## Multi Current State

Multi already has the right durable backbone:

- `orchestration_events` is append-only with sequence and stream version.
- `OrchestrationEngine` dispatches commands, persists events, projects them, and publishes stream events in one command flow.
- Thread detail snapshots already stream over existing HTTP/WS orchestration APIs.

Multi does not currently have the required tree facts:

- `OrchestrationMessage` has no parent edge.
- `projection_thread_messages` is linear by `created_at`.
- `OrchestrationThread` exposes linear `messages`, `activities`, `checkpoints`, and `proposedPlans`.
- Provider sessions are keyed by `ThreadId`, not by branch or leaf.
- `ProviderSendTurnInput` sends only the next input/attachments/model, not reconstructed history.
- Provider adapter contract has `readThread` and `rollbackThread`, but no fork/start-from-history API.

## Multi Checkpointing Assessment

Multi already has checkpointing, but it is not a `/tree` substrate.

What it does today:

- `CheckpointReactor` captures pre-turn and completed-turn Git checkpoints from domain and provider runtime events.
- `CheckpointStore` stores hidden Git refs by staging the whole worktree with `git add -A`, writing a tree, creating a commit, and updating the checkpoint ref.
- `CheckpointLifecycle.revertToCheckpoint` restores the worktree, invalidates the project file cache, rolls the provider conversation back by turn count, deletes newer checkpoint refs, and dispatches `thread.revert.complete`.
- `thread.reverted` projections prune messages, proposed plans, activities, and turn facts to the retained checkpoint turn ids.
- `ProviderService.rollbackConversation` is count-based linear rollback through adapter `rollbackThread(threadId, numTurns)`.

What that means:

- Checkpoints represent workspace snapshots, not conversation branches.
- Checkpoint revert is intentionally destructive to the current projected view and filesystem state.
- Tree entries may eventually reference checkpoint refs for an explicit workspace restore affordance, but tree navigation must not call checkpoint revert.
- `/tree` navigation must not emit `thread.checkpoint.revert`, `thread.reverted`, or call `rollbackConversation` as its navigation effect.
- If provider context is reconstructed from the active path, checkpoint rollback is orthogonal. If provider context relies on adapter session state, checkpoint rollback still only supports linear backtracking and cannot execute arbitrary branch paths.

## Product Semantics

The Multi version should behave like this:

1. A thread owns an append-only set of tree entries.
2. `activeEntryId` is the durable active leaf for the thread.
3. Starting a turn creates a user message entry under `activeEntryId`.
4. Provider output creates or updates an assistant message entry under the user entry.
5. Selecting a non-user tree entry moves `activeEntryId` to that entry.
6. Selecting a user message moves `activeEntryId` to that user's parent and returns editor text so the user can edit/resend that prompt.
7. Navigation is blocked while the thread has a running turn, pending approval, or pending provider user input.
8. New input after navigation appends below the new active leaf, leaving all other branches intact.
9. Read model exposes enough tree data for UI, but shell snapshot can omit tree entries unless sidebar branch awareness is desired.

## Required Decisions Before Implementation

These are not safe to assume:

- Provider branch behavior: should Multi restart/reseed a provider session from reconstructed active-path context, or explicitly ship v1 as tree UI/history-only?
- Branch summary: generate with `TextGeneration`, the active provider, or skip in v1?
- Granularity: tree entries per message only, or also activities/checkpoints/plans?
- Shell visibility: should branch count/active branch appear in the sidebar?

Decision after review:

- Keep the storage shape as normalized `projection_thread_entries` plus `projection_threads.active_entry_id`. Do not switch to Pi JSONL, a JSON tree blob, or parent columns on `projection_thread_messages`.
- Treat `orchestration_events` as the durable source of truth. Projection tables are read-model storage only.
- Implement durable message-level topology and whole-tree UI navigation first.
- If provider behavior is not changed in the same release, name the feature tree UI/history branching only. Do not claim Pi-equivalent model behavior.
- For real Pi-equivalent behavior, add explicit reconstructed active-path context to provider turns. Provider rollback is not sufficient.
- Keep branch summaries off by default until provider context semantics are confirmed.

Pushback:

- A tree UI on top of current provider sessions is not Pi behavior. Current provider sessions are keyed by `threadId` and keep their own linear state.
- Checkpoint revert is not navigation. It prunes projected rows and restores the filesystem; `/tree` must preserve all branches and must not call checkpoint rollback.
- Leaf movement should be a durable navigation event projected to `active_entry_id`. Do not add visible `leaf` rows in v1; they are cursor audit facts, not user-facing tree nodes.
- Labels are append-only metadata targeting entries. The whole-tree UI should render labels on their target nodes, not as normal visible branch nodes.

## Proposed Contract Shape

Add a thread-entry id in `packages/contracts/src/base-schemas.ts`.

```ts
export const ThreadEntryId = makeEntityId("ThreadEntryId");
export type ThreadEntryId = typeof ThreadEntryId.Type;
```

Add flat tree entries to `packages/contracts/src/orchestration.ts`.

```ts
export const OrchestrationThreadEntryKind = Schema.Literals([
  "message",
  "branch-summary",
  "label",
]);
export type OrchestrationThreadEntryKind = typeof OrchestrationThreadEntryKind.Type;

export const OrchestrationThreadEntry = Schema.Struct({
  id: ThreadEntryId,
  threadId: ThreadId,
  parentEntryId: Schema.NullOr(ThreadEntryId),
  kind: OrchestrationThreadEntryKind,
  messageId: Schema.optionalKey(Schema.NullOr(MessageId)),
  turnId: Schema.optionalKey(Schema.NullOr(TurnId)),
  targetEntryId: Schema.optionalKey(Schema.NullOr(ThreadEntryId)),
  label: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  summary: Schema.optionalKey(Schema.NullOr(Schema.String)),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadEntry = typeof OrchestrationThreadEntry.Type;
```

`message` and `branch-summary` are visible tree nodes. `label` rows are metadata rows used to derive node labels. Do not expose `leaf` as an entry kind in v1; `thread.tree-navigated` plus `projection_threads.active_entry_id` is enough to preserve cursor movement.

Extend thread detail, not shell by default:

```ts
export const OrchestrationThread = Schema.Struct({
  // existing fields...
  activeEntryId: Schema.NullOr(ThreadEntryId),
  entries: Schema.Array(OrchestrationThreadEntry),
});
```

Add commands/events:

```ts
const ThreadTreeNavigateCommand = Schema.Struct({
  type: Schema.Literal("thread.tree.navigate"),
  commandId: CommandId,
  threadId: ThreadId,
  targetEntryId: Schema.NullOr(ThreadEntryId),
  summarize: Schema.optionalKey(Schema.Boolean),
  createdAt: IsoDateTime,
});

const ThreadTreeLabelSetCommand = Schema.Struct({
  type: Schema.Literal("thread.tree.label.set"),
  commandId: CommandId,
  threadId: ThreadId,
  targetEntryId: ThreadEntryId,
  label: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

export const ThreadTreeNavigatedPayload = Schema.Struct({
  threadId: ThreadId,
  oldActiveEntryId: Schema.NullOr(ThreadEntryId),
  activeEntryId: Schema.NullOr(ThreadEntryId),
  targetEntryId: Schema.NullOr(ThreadEntryId),
  editorText: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
});

export const ThreadTreeLabelSetPayload = Schema.Struct({
  threadId: ThreadId,
  entryId: ThreadEntryId,
  parentEntryId: Schema.NullOr(ThreadEntryId),
  targetEntryId: ThreadEntryId,
  label: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
```

Modify message and turn payloads so projection can create stable topology:

```ts
export const ThreadMessageSentPayload = Schema.Struct({
  // existing fields...
  entryId: ThreadEntryId,
  parentEntryId: Schema.NullOr(ThreadEntryId),
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  // existing fields...
  userEntryId: ThreadEntryId,
});
```

Assistant output must not attach under whatever `activeEntryId` happens to be when a streaming delta arrives. `thread.turn-start-requested` should carry `userEntryId`, and assistant message delta/complete commands or the decider should resolve one stable assistant `entryId` under that user entry. Repeated streaming deltas for the same assistant `messageId` must update the same tree entry.

## Persistence Shape

Add a projection table, not columns on `projection_thread_messages`. Tree topology is not message rendering state, and tree entries are not only messages.

This is read-model storage. The durable facts remain `orchestration_events`; a full reprojection must be able to rebuild `projection_thread_entries` and `active_entry_id` from event payloads.

```sql
CREATE TABLE IF NOT EXISTS projection_thread_entries (
  entry_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  parent_entry_id TEXT,
  kind TEXT NOT NULL,
  message_id TEXT,
  turn_id TEXT,
  target_entry_id TEXT,
  label TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projection_thread_entries_thread_created
ON projection_thread_entries(thread_id, created_at, entry_id);
```

Add `active_entry_id` to `projection_threads`.

```sql
ALTER TABLE projection_threads ADD COLUMN active_entry_id TEXT;
```

Do not use a JSON/blob tree column. Multi's current projection style is normalized tables assembled into detail snapshots, and the tree needs indexed parent lookup, label derivation, branch summaries, partial updates, and future UI filtering. A blob would make those worse.

Backfill existing linear history as one chain ordered by `created_at, message_id`, with `active_entry_id` set to the latest generated message entry. If old `thread.message-sent` events must replay from scratch after this change, either derive deterministic entry ids from `messageId` for pre-tree events or accept that pre-tree replay creates inferred linear entries.

## Projection Rules

`thread.message-sent`:

- Upsert `projection_thread_messages` as today.
- Upsert a `projection_thread_entries` row with `kind = "message"`.
- For user messages, set `projection_threads.active_entry_id = entryId`.
- For assistant messages, set `projection_threads.active_entry_id = entryId` when the assistant entry is first created for that turn; later streaming deltas update the same entry and leave the cursor on it.

`thread.tree-navigated`:

- Set `projection_threads.active_entry_id = activeEntryId`.
- Do not append a visible `leaf` entry in v1. The event stream is already the audit log.

`thread.tree-label-set`:

- Append/upsert a `kind = "label"` metadata row with `targetEntryId` and label.
- Derived tree node label is latest label by target id.
- Do not change `projection_threads.active_entry_id`. Labeling is metadata, not branch movement.

`thread.branch-summary-created`:

- Append a `kind = "branch-summary"` entry under the target/new active leaf.
- Set active leaf to the branch summary entry.

## Example: Pure Tree Logic

This module is portable and can live in `packages/server/src/orchestration/ThreadTree.ts` or a contracts-adjacent shared module if the app also needs it.

```ts
import type { MessageId, ThreadEntryId } from "@multi/contracts";

export interface ThreadTreeEntry {
  readonly id: ThreadEntryId;
  readonly parentEntryId: ThreadEntryId | null;
  readonly kind: "message" | "branch-summary" | "label";
  readonly messageId?: MessageId | null;
  readonly targetEntryId?: ThreadEntryId | null;
  readonly label?: string | null;
  readonly summary?: string | null;
  readonly createdAt: string;
}

export interface ThreadTreeNode {
  readonly entry: ThreadTreeEntry;
  readonly label?: string;
  readonly labelTimestamp?: string;
  readonly children: ThreadTreeNode[];
}

export function getPathToRoot(input: {
  readonly entries: ReadonlyArray<ThreadTreeEntry>;
  readonly leafId: ThreadEntryId | null;
}): ThreadTreeEntry[] {
  if (input.leafId === null) return [];

  const byId = new Map(input.entries.map((entry) => [entry.id, entry]));
  const path: ThreadTreeEntry[] = [];
  let cursor: ThreadEntryId | null = input.leafId;

  while (cursor !== null) {
    const entry = byId.get(cursor);
    if (!entry) {
      throw new Error(`Invalid thread tree: missing entry '${cursor}'`);
    }
    path.unshift(entry);
    cursor = entry.parentEntryId;
  }

  return path;
}

export function buildThreadTree(entries: ReadonlyArray<ThreadTreeEntry>): ThreadTreeNode[] {
  const labelsByTarget = new Map<string, { label: string; timestamp: string }>();
  for (const entry of entries) {
    if (entry.kind !== "label" || entry.targetEntryId === undefined || entry.targetEntryId === null) {
      continue;
    }
    const key = entry.targetEntryId;
    const label = entry.label?.trim();
    if (label) {
      labelsByTarget.set(key, { label, timestamp: entry.createdAt });
    } else {
      labelsByTarget.delete(key);
    }
  }

  const visibleEntries = entries.filter(
    (entry) => entry.kind === "message" || entry.kind === "branch-summary",
  );
  const nodes = new Map<string, ThreadTreeNode>();
  for (const entry of visibleEntries) {
    const resolvedLabel = labelsByTarget.get(entry.id);
    nodes.set(entry.id, {
      entry,
      ...(resolvedLabel ? { label: resolvedLabel.label, labelTimestamp: resolvedLabel.timestamp } : {}),
      children: [],
    });
  }

  const roots: ThreadTreeNode[] = [];
  for (const entry of visibleEntries) {
    const node = nodes.get(entry.id);
    if (!node) continue;
    const parent = entry.parentEntryId === null ? undefined : nodes.get(entry.parentEntryId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (node: ThreadTreeNode) => {
    node.children.sort(
      (left, right) =>
        left.entry.createdAt.localeCompare(right.entry.createdAt) ||
        left.entry.id.localeCompare(right.entry.id),
    );
    for (const child of node.children) sortChildren(child);
  };

  roots.sort(
    (left, right) =>
      left.entry.createdAt.localeCompare(right.entry.createdAt) ||
      left.entry.id.localeCompare(right.entry.id),
  );
  for (const root of roots) sortChildren(root);
  return roots;
}
```

## Example: Navigation Decision

This is the Pi `/tree` decision without Pi session classes. It does not persist; the decider/service would call it and emit events.

```ts
import type { MessageId, ThreadEntryId } from "@multi/contracts";

export interface NavigateTreeEntry {
  readonly id: ThreadEntryId;
  readonly parentEntryId: ThreadEntryId | null;
  readonly kind: "message" | "branch-summary" | "label";
  readonly messageId?: MessageId | null;
}

export interface NavigateTreeMessage {
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
}

export interface NavigateTreeResult {
  readonly oldActiveEntryId: ThreadEntryId | null;
  readonly activeEntryId: ThreadEntryId | null;
  readonly editorText?: string;
}

export function decideTreeNavigation(input: {
  readonly activeEntryId: ThreadEntryId | null;
  readonly targetEntryId: ThreadEntryId | null;
  readonly entries: ReadonlyArray<NavigateTreeEntry>;
  readonly messagesById: ReadonlyMap<MessageId, NavigateTreeMessage>;
}): NavigateTreeResult {
  if (input.targetEntryId === input.activeEntryId) {
    return {
      oldActiveEntryId: input.activeEntryId,
      activeEntryId: input.activeEntryId,
    };
  }

  if (input.targetEntryId === null) {
    return {
      oldActiveEntryId: input.activeEntryId,
      activeEntryId: null,
    };
  }

  const target = input.entries.find((entry) => entry.id === input.targetEntryId);
  if (!target) {
    throw new Error(`Cannot navigate tree to missing entry '${input.targetEntryId}'`);
  }

  if (target.kind === "message" && target.messageId) {
    const message = input.messagesById.get(target.messageId);
    if (message?.role === "user") {
      return {
        oldActiveEntryId: input.activeEntryId,
        activeEntryId: target.parentEntryId,
        editorText: message.text,
      };
    }
  }

  return {
    oldActiveEntryId: input.activeEntryId,
    activeEntryId: target.id,
  };
}
```

## Example: Decider Event Shape

This shows where Multi should differ from Pi: events are the durable facts.

```ts
case "thread.tree.navigate": {
  const thread = yield* requireThread({
    readModel,
    command,
    threadId: command.threadId,
  });

  if (thread.session?.status === "running") {
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "Cannot navigate the thread tree while a turn is running.",
    });
  }
  if (hasPendingApprovalOrProviderUserInput(thread)) {
    return yield* new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail: "Cannot navigate the thread tree while provider input is pending.",
    });
  }

  const navigation = decideTreeNavigation({
    activeEntryId: thread.activeEntryId,
    targetEntryId: command.targetEntryId,
    entries: thread.entries,
    messagesById: new Map(thread.messages.map((message) => [message.id, message])),
  });

  return {
    ...withEventBase({
      aggregateKind: "thread",
      aggregateId: command.threadId,
      occurredAt: command.createdAt,
      commandId: command.commandId,
    }),
    type: "thread.tree-navigated",
    payload: {
      threadId: command.threadId,
      oldActiveEntryId: navigation.oldActiveEntryId,
      activeEntryId: navigation.activeEntryId,
      targetEntryId: command.targetEntryId,
      ...(navigation.editorText !== undefined ? { editorText: navigation.editorText } : {}),
      createdAt: command.createdAt,
    },
  };
}
```

## Provider Context Requirement

This is the main blocker for true Pi-equivalent behavior.

Pi rebuilds LLM context from `getBranch(activeLeaf)`. Multi currently sends a provider turn through:

- `ProviderCommandReactor.buildSendTurnRequestForThread`
- `ProviderService.sendTurn`
- adapter `sendTurn`

The current provider contract only carries:

```ts
export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(TrimmedNonEmptyString),
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
```

To make `/tree` affect actual model behavior, implement explicit reconstructed context. Other options are weaker:

1. Add explicit history/context to `ProviderSendTurnInput` and teach every adapter how to honor it. This is the recommended path.
2. Add a provider adapter `forkSessionFromHistory` or `startSessionFromHistory` primitive later, after the explicit context contract exists.
3. Use provider-native rollback only for explicit linear rollback/checkpoint flows. It cannot represent arbitrary old branch switching or multiple sibling branches.
4. Accept a v1 where tree navigation is UI/history only and provider state remains linear. This is acceptable only if the UI labels it honestly; it is not Pi-equivalent model behavior.

Recommended provider contract direction:

```ts
export const ProviderConversationMessage = Schema.Struct({
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optionalKey(Schema.Array(ChatAttachment)),
});

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(TrimmedNonEmptyString),
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
  context: Schema.optionalKey(Schema.Array(ProviderConversationMessage)),
});
```

Then `ProviderCommandReactor` can derive:

```ts
function buildProviderContextFromActivePath(input: {
  readonly activePath: ReadonlyArray<ThreadTreeEntry>;
  readonly messagesById: ReadonlyMap<MessageId, NavigateTreeMessage>;
}): Array<{ readonly role: "user" | "assistant" | "system"; readonly text: string }> {
  return input.activePath.flatMap((entry) => {
    if (entry.kind !== "message" || !entry.messageId) return [];
    const message = input.messagesById.get(entry.messageId);
    return message ? [{ role: message.role, text: message.text }] : [];
  });
}
```

Adapter implications:

- `ProviderCommandReactor.buildSendTurnRequestForThread` should derive the active path from `thread.entries + thread.activeEntryId`, map path entries to messages, and include `context` with the next input.
- `ProviderService.sendTurn` can keep routing by `threadId`, but the adapter must not blindly append to stale provider-native linear history when `context` is present.
- Adapters that cannot send explicit history directly should restart or fork their provider-native session internally from `context`.
- Existing `readThread`/`rollbackThread` remains useful for checkpoint rollback and diagnostics only; it is not the tree navigation primitive.

## UI Logic To Reuse

Portable tree selector behavior:

- Active branch first.
- Filters: default, no-tools, user-only, labeled-only, all.
- Search: lowercase whitespace tokens, all tokens must match searchable text.
- After filtering, attach each visible node to nearest visible ancestor so connectors stay coherent.
- Folding state is a set of entry ids.
- Keybindings must be named actions, not hardcoded key checks.

Do not port Pi terminal UI. Build Multi-native React UI against the flat `entries` and `activeEntryId`.

## Whole Tree UI

The user should see the whole tree as a persistent, thread-scoped outline panel, not as hidden timeline state.

Recommended UI surface:

- Add a toggle in `packages/app/src/components/chat/view/chat-header.tsx` using a `central-icons` branch/tree-style icon.
- Render `ThreadTreePanel` from `packages/app/src/components/chat/view/chat-view.tsx` as a right-side split pane beside the message timeline. The panel should be full height within the chat view, with a left border and fixed/resizable width around 300-420px on desktop.
- On narrow viewports, use the same component as a slide-over panel so the whole tree is still available without compressing the composer.
- Keep the global shell sidebar unchanged in v1. The shell can later show branch count or active branch only if product wants sidebar awareness.

Panel content:

- Every visible tree node is a message entry or branch-summary entry.
- Sibling branches appear under the same parent, so the user can see all alternatives at once.
- The active root-to-leaf path is highlighted continuously.
- The active leaf has the strongest selected state.
- Non-active branches remain visible and selectable, not pruned.
- User message nodes show an edit/resend affordance. Selecting a user node navigates to that user's parent and returns the prompt text for the composer.
- Assistant nodes navigate to that exact history point.
- Labels render on target nodes; label metadata rows are not normal visible nodes.
- Missing message rows caused by caps/backfill should render a recoverable placeholder instead of breaking the tree.

Controls:

- Search input with lowercase whitespace-token matching; all tokens must match a node's searchable text.
- Filter segmented control: default, no-tools, user-only, labeled-only, all.
- Per-branch fold/unfold buttons.
- Global expand/collapse.
- Jump to active leaf.
- Label action on each node.

Filtering and folding:

- Build the full tree from flat entries first.
- Derive labels by latest label row per target id.
- Filter visible nodes by search/filter mode.
- Reattach each visible node to the nearest visible ancestor so the outline remains coherent.
- Keep folding state local to the panel as `Set<ThreadEntryId>`.
- Keep selected row state local unless a route/search-param decision is made.

Dispatch behavior:

- Node selection dispatches `thread.tree.navigate`.
- Label edits dispatch `thread.tree.label.set`.
- Navigation is disabled while the active thread is running, has pending approval, or has pending provider user input.
- If navigation returns `editorText`, populate the composer only when the draft is empty. If the draft is non-empty, require an explicit confirmation flow before replacing it.
- All keybindings must be named configurable actions, not hardcoded key checks.

Do not build the whole-tree UI by filtering the existing message timeline. The timeline should continue to render the active path/conversation view; the tree panel is the branch navigator.

## Expected Change Diff

Contracts:

- `packages/contracts/src/base-schemas.ts`: add `ThreadEntryId`.
- `packages/contracts/src/orchestration.ts`: add thread entry schema, `activeEntryId`, `entries`, tree commands, tree events, `ThreadMessageSentPayload.entryId`, `ThreadMessageSentPayload.parentEntryId`, and `ThreadTurnStartRequestedPayload.userEntryId`.
- `packages/contracts/src/provider.ts`: for Pi-equivalent model behavior, add `ProviderConversationMessage` and optional `context` on `ProviderSendTurnInput`.

Server orchestration:

- `packages/server/src/orchestration/decider.ts`: create user entry ids on `thread.turn.start`; add tree navigation and label commands; reject navigation while running/pending; ensure assistant message events reuse a stable assistant entry under the originating `userEntryId`.
- `packages/server/src/orchestration/ProviderRuntimeIngestion.ts`: carry enough turn/user-entry correlation into assistant delta/complete commands so streaming does not create duplicate tree entries.
- `packages/server/src/orchestration/projector.ts`: initialize and update `activeEntryId` and `entries` in the in-memory read model.
- `packages/server/src/orchestration/ProviderCommandReactor.ts`: if shipping real branching, build active-path provider context from `entries + activeEntryId + messages` before `ProviderService.sendTurn`.

Server persistence/projection:

- `packages/server/src/persistence/migrations/027_ProjectionThreadEntries.ts`: add `projection_thread_entries`, add `projection_threads.active_entry_id`, and backfill existing linear message history.
- `packages/server/src/persistence/ProjectionThreadEntries.service.ts` and `.ts`: add repository shape and SQL implementation.
- `packages/server/src/persistence/ProjectionThreads.service.ts` and `.ts`: include `activeEntryId`.
- `packages/server/src/orchestration/ProjectionPipeline.ts`: add `threadEntries` projector, update thread active cursor on message/tree events, and add the projector to bootstrapping.
- `packages/server/src/orchestration/ThreadProjectionRows.ts` and `ThreadProjection.ts`: query entry rows, map them into thread detail snapshots, and include `activeEntryId`.
- `packages/server/src/ws.ts`: include tree events in `isThreadDetailEvent`.

Provider adapters:

- UI/history-only v1: no adapter change, but document provider divergence.
- Pi-equivalent v1: update every adapter `sendTurn` path to honor `ProviderSendTurnInput.context` directly or restart/fork internally from that context. Do not use `rollbackConversation` for tree navigation.

App store:

- `packages/app/src/types.ts`: add `activeEntryId` and `entries` to `Thread`; add app-facing tree node/label types if deriving them outside the panel.
- `packages/app/src/stores/thread-store.ts`: add normalized entry state, active-entry state, and selectors for whole-tree rendering and active path.
- `packages/app/src/stores/thread-sync.ts`: map thread entries from snapshots and apply `thread.message-sent`, `thread.tree-navigated`, and `thread.tree-label-set`.

App UI:

- `packages/app/src/components/chat/view/thread-tree-panel.tsx`: new whole-tree panel component.
- `packages/app/src/components/chat/view/thread-tree.ts`: pure tree derivation helpers for building nodes, active path, search/filter, and visible ancestor reattachment.
- `packages/app/src/components/chat/view/chat-header.tsx`: add tree panel toggle.
- `packages/app/src/components/chat/view/chat-view.tsx`: render the side panel/drawer and dispatch tree commands.
- Keybinding settings files: add configurable tree actions for toggle panel, jump active, fold/unfold, search focus, label edit, and filter cycling.

## Implementation Sequence

Do this only after provider behavior is decided. The storage and UI pieces can ship before provider context only if product explicitly accepts UI/history-only branching.

0. Cleanup checkpoint/revert semantics before adding tree code:
   - Treat `thread.checkpoint.revert` as explicit workspace rollback only.
   - Keep `thread.reverted` pruning only in the checkpoint revert path.
   - Keep `rollbackConversation` only behind explicit linear rollback or checkpoint revert.
   - Do not use `CheckpointRetention` helpers for tree navigation.
   - Audit app command labels and call sites so "revert" cannot be confused with branch selection or edit/resend.
1. Add contract ids, entry schema, commands, events, and thread detail fields.
2. Add migration for `projection_thread_entries` and `projection_threads.active_entry_id`.
3. Add projection repository and include it in `ProjectionPipeline`.
4. Update `decider.ts` for tree commands and `thread.turn.start` entry ids.
5. Update projector/read-model assembly to expose `entries` and `activeEntryId`.
6. Update app store/types/thread sync.
7. Add React whole-tree panel UI.
8. Add provider context reconstruction or explicitly ship UI-only tree behavior.

## What Else Matters

- Existing checkpoint revert deletes/prunes projected rows. `/tree` must not delete history.
- Existing `rollbackConversation` is not enough for Pi-like branching; it is linear rollback only.
- `activeEntryId` is a thread-level cursor, but provider sessions are keyed by `threadId`; without provider changes, provider state can diverge from tree state.
- Branch summaries should be persisted as entries, not as synthetic UI text.
- Navigating to a user message should never overwrite non-empty composer draft text in the app.
- The shell snapshot should stay small unless sidebar branch UX is explicitly required.
- `MAX_THREAD_MESSAGES` and any future detail caps can break tree integrity if entries outlive message rows. Either stop capping detail data needed by the tree or cap entries/messages coherently with placeholders.
- Assistant entry parentage is the sharp backend risk. Streaming deltas must be correlated to the user entry that started the turn, not to mutable `activeEntryId`.
- Existing linear history needs a migration/backfill story; otherwise old threads will not show a useful whole tree.
