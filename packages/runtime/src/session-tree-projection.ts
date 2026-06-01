import type {
  RuntimeItemId,
  SessionMessageRole,
  SessionTreeEntry,
  SessionTreeEntryKind,
  SessionTreeNode,
  SessionTreeProjection,
  ThreadEntryId,
  ThreadId,
} from "@multi/contracts";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  makeRuntimeItemId,
  makeRuntimeSessionId,
  makeThreadEntryIdForRuntimeEntry,
} from "./ids";
import { extractMessageText, toUnknownRecord } from "./message-text";

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
  }
}

function messageRole(entry: SessionEntry): SessionMessageRole | undefined {
  if (entry.type !== "message") {
    return undefined;
  }
  const role = String(entry.message.role);
  if (
    role === "user" ||
    role === "assistant" ||
    role === "system" ||
    role === "toolResult" ||
    role === "custom"
  ) {
    return role;
  }
  return undefined;
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

function parentEntryId(entry: SessionEntry): RuntimeItemId | null {
  return entry.parentId ? makeRuntimeItemId(entry.parentId) : null;
}

function parentThreadEntryId(entry: SessionEntry): ThreadEntryId | null {
  return entry.parentId ? makeThreadEntryIdForRuntimeEntry(entry.parentId) : null;
}

export function projectRuntimeSessionEntry(entry: SessionEntry): SessionTreeEntry {
  return {
    id: makeRuntimeItemId(entry.id),
    threadEntryId: makeThreadEntryIdForRuntimeEntry(entry.id),
    parentId: parentEntryId(entry),
    parentThreadEntryId: parentThreadEntryId(entry),
    kind: entryKind(entry),
    ...(messageRole(entry) ? { role: messageRole(entry) } : {}),
    ...(entryText(entry) ? { text: entryText(entry) } : {}),
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
    entries: entries.map(projectRuntimeSessionEntry),
    nodes,
  };
}
