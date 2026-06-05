import {
  SessionMessageRole,
  type MessageId,
  type RuntimeItemId,
  type SessionTreeEntry,
  type SessionTreeEntryKind,
  type SessionTreeNode,
  type SessionTreeProjection,
  type ThreadEntryId,
  type ThreadId,
  type TurnId,
} from "@multi/contracts";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";
import {
  makeRuntimeItemId,
  makeRuntimeSessionId,
  makeThreadEntryIdForRuntimeEntry,
} from "./ids";
import { extractMessageText, extractMessageThinking, toUnknownRecord } from "./message-text";

type RuntimeTreeNode = ReturnType<SessionManager["getTree"]>[number];

function entryKind(entry: SessionEntry): SessionTreeEntryKind {
  switch (entry.type) {
    case "message":
      return "message";
    case "model_change":
      return "model-change";
    case "thinking_level_change":
      return "thinking-level-change";
    case "compaction":
      return "compaction";
    case "branch_summary":
      return "branch-summary";
    case "custom":
      return "custom";
    case "custom_message":
      return "custom-message";
    case "label":
      return "label";
    case "session_info":
      return "session-info";
    default:
      return "custom";
  }
}

function messageRole(entry: SessionEntry): SessionMessageRole | undefined {
  if (entry.type !== "message") {
    return undefined;
  }
  return Schema.is(SessionMessageRole)(entry.message.role) ? entry.message.role : undefined;
}

function entryText(entry: SessionEntry): string | undefined {
  if (entry.type === "message") {
    const text = extractMessageText(entry.message);
    return text ? text : undefined;
  }
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    return entry.summary;
  }
  if (entry.type === "custom_message") {
    const text = extractMessageText({ content: entry.content });
    return text ? text : undefined;
  }
  if (entry.type === "session_info") {
    return entry.name;
  }
  return undefined;
}

function entryThinking(entry: SessionEntry): string | undefined {
  if (entry.type !== "message") {
    return undefined;
  }
  const thinking = extractMessageThinking(entry.message);
  return thinking ? thinking : undefined;
}

function parentEntryId(entry: SessionEntry): RuntimeItemId | null {
  return entry.parentId ? makeRuntimeItemId(entry.parentId) : null;
}

function parentThreadEntryId(entry: SessionEntry): ThreadEntryId | null {
  return entry.parentId ? makeThreadEntryIdForRuntimeEntry(entry.parentId) : null;
}

export function projectRuntimeSessionEntry(
  entry: SessionEntry,
  input?: {
    readonly clientMessageIdByEntryId?: ReadonlyMap<string, MessageId>;
    readonly turnIdByEntryId?: ReadonlyMap<string, TurnId>;
  },
): SessionTreeEntry {
  const clientMessageId = input?.clientMessageIdByEntryId?.get(entry.id);
  const turnId = input?.turnIdByEntryId?.get(entry.id);
  const text = entryText(entry);
  const thinking = entryThinking(entry);
  return {
    id: makeRuntimeItemId(entry.id),
    threadEntryId: makeThreadEntryIdForRuntimeEntry(entry.id),
    parentId: parentEntryId(entry),
    parentThreadEntryId: parentThreadEntryId(entry),
    kind: entryKind(entry),
    ...(messageRole(entry) ? { role: messageRole(entry) } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(text ? { text } : {}),
    ...(thinking ? { thinking } : {}),
    createdAt: entry.timestamp,
    rawEntry: toUnknownRecord(entry),
  };
}

function pushProjectedNode(input: {
  readonly node: RuntimeTreeNode;
  readonly parentEntryId: RuntimeItemId | null;
  readonly depth: number;
  readonly leafId: string | null;
  readonly activeEntryIds: ReadonlySet<string>;
  readonly output: SessionTreeNode[];
}): void {
  const entryId = makeRuntimeItemId(input.node.entry.id);
  input.output.push({
    entryId,
    threadEntryId: makeThreadEntryIdForRuntimeEntry(input.node.entry.id),
    parentEntryId: input.parentEntryId,
    depth: input.depth,
    isActivePath: input.activeEntryIds.has(input.node.entry.id),
    isActiveLeaf: input.leafId === input.node.entry.id,
    childCount: input.node.children.length,
  });

  for (const child of input.node.children) {
    pushProjectedNode({
      node: child,
      parentEntryId: entryId,
      depth: input.depth + 1,
      leafId: input.leafId,
      activeEntryIds: input.activeEntryIds,
      output: input.output,
    });
  }
}

export function projectRuntimeSessionTree(input: {
  readonly threadId: ThreadId;
  readonly sessionManager: SessionManager;
  readonly clientMessageIdByEntryId?: ReadonlyMap<string, MessageId>;
  readonly turnIdByEntryId?: ReadonlyMap<string, TurnId>;
}): SessionTreeProjection {
  const entries = input.sessionManager.getEntries();
  const leafId = input.sessionManager.getLeafId();
  const activeEntryIds = new Set(input.sessionManager.getBranch().map((entry) => entry.id));
  const nodes: SessionTreeNode[] = [];

  for (const node of input.sessionManager.getTree()) {
    pushProjectedNode({
      node,
      parentEntryId: null,
      depth: 0,
      leafId,
      activeEntryIds,
      output: nodes,
    });
  }

  return {
    threadId: input.threadId,
    runtimeSessionId: makeRuntimeSessionId(input.sessionManager.getSessionId()),
    leafEntryId: leafId ? makeRuntimeItemId(leafId) : null,
    entries: entries.map((entry) =>
      projectRuntimeSessionEntry(
        entry,
        input.clientMessageIdByEntryId || input.turnIdByEntryId
          ? {
              ...(input.clientMessageIdByEntryId
                ? { clientMessageIdByEntryId: input.clientMessageIdByEntryId }
                : {}),
              ...(input.turnIdByEntryId ? { turnIdByEntryId: input.turnIdByEntryId } : {}),
            }
          : undefined,
      ),
    ),
    nodes,
  };
}
