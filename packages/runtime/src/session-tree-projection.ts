import {
  MessageId,
  SessionMessageRole,
  type RuntimeItemId,
  type SessionTreeEntry,
  type SessionTreeEntryKind,
  type SessionTreeNode,
  type SessionTreeProjection,
  type ThreadEntryId,
  type ThreadId,
  type TurnId,
  threadEntryIdForMessageId,
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
export const CLIENT_MESSAGE_ID_SIDECAR_TYPE = "multi.client-message-id";

export function clientMessageIdSidecarData(
  entry: SessionEntry,
): { readonly entryId: string; readonly clientMessageId: MessageId } | null {
  if (entry.type !== "custom" || entry.customType !== CLIENT_MESSAGE_ID_SIDECAR_TYPE) {
    return null;
  }
  const data = entry.data;
  if (
    typeof data !== "object" ||
    data === null ||
    !("entryId" in data) ||
    !("clientMessageId" in data) ||
    typeof data.entryId !== "string" ||
    typeof data.clientMessageId !== "string"
  ) {
    return null;
  }
  return {
    entryId: data.entryId,
    clientMessageId: MessageId.make(data.clientMessageId),
  };
}

export function collectClientMessageIdSidecars(
  entries: ReadonlyArray<SessionEntry>,
): Map<string, MessageId> {
  const clientMessageIdByEntryId = new Map<string, MessageId>();
  for (const entry of entries) {
    const sidecar = clientMessageIdSidecarData(entry);
    if (sidecar) {
      clientMessageIdByEntryId.set(sidecar.entryId, sidecar.clientMessageId);
    }
  }
  return clientMessageIdByEntryId;
}

function isClientMessageIdSidecar(entry: SessionEntry): boolean {
  return clientMessageIdSidecarData(entry) !== null;
}

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

function nearestProjectedRuntimeEntryId(
  entryId: string | null,
  entryById: ReadonlyMap<string, SessionEntry>,
): RuntimeItemId | null {
  const seen = new Set<string>();
  let cursor = entryId;
  while (cursor) {
    if (seen.has(cursor)) {
      return null;
    }
    seen.add(cursor);
    const entry = entryById.get(cursor);
    if (!entry) {
      return null;
    }
    if (!isClientMessageIdSidecar(entry)) {
      return makeRuntimeItemId(cursor);
    }
    cursor = entry.parentId;
  }
  return null;
}

function nearestProjectedThreadEntryId(
  entryId: string | null,
  entryById: ReadonlyMap<string, SessionEntry>,
  clientMessageIdByEntryId: ReadonlyMap<string, MessageId> | undefined,
): ThreadEntryId | null {
  const seen = new Set<string>();
  let cursor = entryId;
  while (cursor) {
    if (seen.has(cursor)) {
      return null;
    }
    seen.add(cursor);
    const entry = entryById.get(cursor);
    if (!entry) {
      return null;
    }
    if (!isClientMessageIdSidecar(entry)) {
      return projectedThreadEntryId(cursor, clientMessageIdByEntryId);
    }
    cursor = entry.parentId;
  }
  return null;
}

function projectedThreadEntryId(
  entryId: string,
  clientMessageIdByEntryId: ReadonlyMap<string, MessageId> | undefined,
): ThreadEntryId {
  const clientMessageId = clientMessageIdByEntryId?.get(entryId);
  return clientMessageId
    ? threadEntryIdForMessageId(clientMessageId)
    : makeThreadEntryIdForRuntimeEntry(entryId);
}

function parentThreadEntryId(
  entry: SessionEntry,
  clientMessageIdByEntryId: ReadonlyMap<string, MessageId> | undefined,
  entryById?: ReadonlyMap<string, SessionEntry>,
): ThreadEntryId | null {
  return entryById
    ? nearestProjectedThreadEntryId(entry.parentId, entryById, clientMessageIdByEntryId)
    : entry.parentId
      ? projectedThreadEntryId(entry.parentId, clientMessageIdByEntryId)
      : null;
}

export function projectRuntimeSessionEntry(
  entry: SessionEntry,
  input?: {
    readonly clientMessageIdByEntryId?: ReadonlyMap<string, MessageId>;
    readonly turnIdByEntryId?: ReadonlyMap<string, TurnId>;
    readonly entryById?: ReadonlyMap<string, SessionEntry>;
  },
): SessionTreeEntry {
  const clientMessageId = input?.clientMessageIdByEntryId?.get(entry.id);
  const turnId = input?.turnIdByEntryId?.get(entry.id);
  const text = entryText(entry);
  const thinking = entryThinking(entry);
  return {
    id: makeRuntimeItemId(entry.id),
    threadEntryId: projectedThreadEntryId(entry.id, input?.clientMessageIdByEntryId),
    parentId: input?.entryById
      ? nearestProjectedRuntimeEntryId(entry.parentId, input.entryById)
      : parentEntryId(entry),
    parentThreadEntryId: parentThreadEntryId(
      entry,
      input?.clientMessageIdByEntryId,
      input?.entryById,
    ),
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
  readonly clientMessageIdByEntryId?: ReadonlyMap<string, MessageId>;
  readonly entryById: ReadonlyMap<string, SessionEntry>;
  readonly output: SessionTreeNode[];
}): void {
  if (isClientMessageIdSidecar(input.node.entry)) {
    for (const child of input.node.children) {
      pushProjectedNode({
        node: child,
        parentEntryId: input.parentEntryId,
        depth: input.depth,
        leafId: input.leafId,
        activeEntryIds: input.activeEntryIds,
        ...(input.clientMessageIdByEntryId
          ? { clientMessageIdByEntryId: input.clientMessageIdByEntryId }
          : {}),
        entryById: input.entryById,
        output: input.output,
      });
    }
    return;
  }

  const entryId = makeRuntimeItemId(input.node.entry.id);
  input.output.push({
    entryId,
    threadEntryId: projectedThreadEntryId(
      input.node.entry.id,
      input.clientMessageIdByEntryId,
    ),
    parentEntryId: input.parentEntryId,
    depth: input.depth,
    isActivePath: input.activeEntryIds.has(input.node.entry.id),
    isActiveLeaf: input.leafId === input.node.entry.id,
    childCount: projectedChildCount(input.node.children),
  });

  for (const child of input.node.children) {
    pushProjectedNode({
      node: child,
      parentEntryId: entryId,
      depth: input.depth + 1,
      leafId: input.leafId,
      activeEntryIds: input.activeEntryIds,
      ...(input.clientMessageIdByEntryId
        ? { clientMessageIdByEntryId: input.clientMessageIdByEntryId }
        : {}),
      entryById: input.entryById,
      output: input.output,
    });
  }
}

function projectedChildCount(nodes: ReadonlyArray<RuntimeTreeNode>): number {
  let count = 0;
  for (const node of nodes) {
    count += isClientMessageIdSidecar(node.entry) ? projectedChildCount(node.children) : 1;
  }
  return count;
}

export function projectRuntimeSessionTree(input: {
  readonly threadId: ThreadId;
  readonly sessionManager: SessionManager;
  readonly clientMessageIdByEntryId?: ReadonlyMap<string, MessageId>;
  readonly turnIdByEntryId?: ReadonlyMap<string, TurnId>;
}): SessionTreeProjection {
  const entries = input.sessionManager.getEntries();
  const entryById = new Map(entries.map((entry) => [entry.id, entry] as const));
  const sidecarClientMessageIds = collectClientMessageIdSidecars(entries);
  const clientMessageIdByEntryId =
    input.clientMessageIdByEntryId || sidecarClientMessageIds.size > 0
      ? new Map([
          ...sidecarClientMessageIds,
          ...(input.clientMessageIdByEntryId
            ? [...input.clientMessageIdByEntryId.entries()]
            : []),
        ])
      : undefined;
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
      ...(clientMessageIdByEntryId ? { clientMessageIdByEntryId } : {}),
      entryById,
      output: nodes,
    });
  }

  return {
    threadId: input.threadId,
    runtimeSessionId: makeRuntimeSessionId(input.sessionManager.getSessionId()),
    leafEntryId: leafId ? nearestProjectedRuntimeEntryId(leafId, entryById) : null,
    entries: entries.filter((entry) => !isClientMessageIdSidecar(entry)).map((entry) =>
      projectRuntimeSessionEntry(
        entry,
        clientMessageIdByEntryId || input.turnIdByEntryId || entryById
          ? {
              ...(clientMessageIdByEntryId ? { clientMessageIdByEntryId } : {}),
              ...(input.turnIdByEntryId ? { turnIdByEntryId: input.turnIdByEntryId } : {}),
              entryById,
            }
          : undefined,
      ),
    ),
    nodes,
  };
}
