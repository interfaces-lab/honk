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
  TurnId,
  threadEntryIdForMessageId,
} from "@honk/contracts";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";
import { makeRuntimeItemId, makeRuntimeSessionId, makeThreadEntryIdForRuntimeEntry } from "./ids";
import { extractMessageText, extractMessageThinking, toUnknownRecord } from "./message-text";

type RuntimeTreeNode = ReturnType<SessionManager["getTree"]>[number];
export const CLIENT_MESSAGE_ID_SIDECAR_TYPE = "honk.client-message-id";
export const TURN_ID_SIDECAR_TYPE = "honk.turn-id";
export const HIDDEN_PROMPT_SIDECAR_TYPE = "honk.hidden-prompt";

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

export function turnIdSidecarData(
  entry: SessionEntry,
): { readonly entryId: string; readonly turnId: TurnId } | null {
  if (entry.type !== "custom" || entry.customType !== TURN_ID_SIDECAR_TYPE) {
    return null;
  }
  const data = entry.data;
  if (
    typeof data !== "object" ||
    data === null ||
    !("entryId" in data) ||
    !("turnId" in data) ||
    typeof data.entryId !== "string" ||
    typeof data.turnId !== "string"
  ) {
    return null;
  }
  return {
    entryId: data.entryId,
    turnId: TurnId.make(data.turnId),
  };
}

export function collectTurnIdSidecars(entries: ReadonlyArray<SessionEntry>): Map<string, TurnId> {
  const turnIdByEntryId = new Map<string, TurnId>();
  for (const entry of entries) {
    const sidecar = turnIdSidecarData(entry);
    if (sidecar) {
      turnIdByEntryId.set(sidecar.entryId, sidecar.turnId);
    }
  }
  return turnIdByEntryId;
}

export function hiddenPromptSidecarData(
  entry: SessionEntry,
): { readonly entryId: string; readonly reason: string | null } | null {
  if (entry.type !== "custom" || entry.customType !== HIDDEN_PROMPT_SIDECAR_TYPE) {
    return null;
  }
  const data = entry.data;
  if (
    typeof data !== "object" ||
    data === null ||
    !("entryId" in data) ||
    typeof data.entryId !== "string"
  ) {
    return null;
  }
  return {
    entryId: data.entryId,
    reason: "reason" in data && typeof data.reason === "string" ? data.reason : null,
  };
}

export function collectHiddenPromptSidecars(entries: ReadonlyArray<SessionEntry>): Set<string> {
  const hiddenEntryIds = new Set<string>();
  for (const entry of entries) {
    const sidecar = hiddenPromptSidecarData(entry);
    if (sidecar) {
      hiddenEntryIds.add(sidecar.entryId);
    }
  }
  return hiddenEntryIds;
}

function isHonkSidecar(entry: SessionEntry): boolean {
  return (
    clientMessageIdSidecarData(entry) !== null ||
    turnIdSidecarData(entry) !== null ||
    hiddenPromptSidecarData(entry) !== null
  );
}

function isProjectionHiddenEntry(
  entry: SessionEntry,
  hiddenEntryIds: ReadonlySet<string>,
): boolean {
  return isHonkSidecar(entry) || hiddenEntryIds.has(entry.id);
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
  hiddenEntryIds: ReadonlySet<string> = new Set(),
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
    if (!isProjectionHiddenEntry(entry, hiddenEntryIds)) {
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
  hiddenEntryIds: ReadonlySet<string> = new Set(),
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
    if (!isProjectionHiddenEntry(entry, hiddenEntryIds)) {
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
  hiddenEntryIds?: ReadonlySet<string>,
): ThreadEntryId | null {
  return entryById
    ? nearestProjectedThreadEntryId(
        entry.parentId,
        entryById,
        clientMessageIdByEntryId,
        hiddenEntryIds,
      )
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
    readonly hiddenEntryIds?: ReadonlySet<string>;
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
      ? nearestProjectedRuntimeEntryId(
          entry.parentId,
          input.entryById,
          input.hiddenEntryIds,
        )
      : parentEntryId(entry),
    parentThreadEntryId: parentThreadEntryId(
      entry,
      input?.clientMessageIdByEntryId,
      input?.entryById,
      input?.hiddenEntryIds,
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
  readonly hiddenEntryIds: ReadonlySet<string>;
  readonly entryById: ReadonlyMap<string, SessionEntry>;
  readonly output: SessionTreeNode[];
}): void {
  if (isProjectionHiddenEntry(input.node.entry, input.hiddenEntryIds)) {
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
        hiddenEntryIds: input.hiddenEntryIds,
        entryById: input.entryById,
        output: input.output,
      });
    }
    return;
  }

  const entryId = makeRuntimeItemId(input.node.entry.id);
  input.output.push({
    entryId,
    threadEntryId: projectedThreadEntryId(input.node.entry.id, input.clientMessageIdByEntryId),
    parentEntryId: input.parentEntryId,
    depth: input.depth,
    isActivePath: input.activeEntryIds.has(input.node.entry.id),
    isActiveLeaf: input.leafId === input.node.entry.id,
    childCount: projectedChildCount(input.node.children, input.hiddenEntryIds),
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
      hiddenEntryIds: input.hiddenEntryIds,
      entryById: input.entryById,
      output: input.output,
    });
  }
}

function projectedChildCount(
  nodes: ReadonlyArray<RuntimeTreeNode>,
  hiddenEntryIds: ReadonlySet<string>,
): number {
  let count = 0;
  for (const node of nodes) {
    count += isProjectionHiddenEntry(node.entry, hiddenEntryIds)
      ? projectedChildCount(node.children, hiddenEntryIds)
      : 1;
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
  const sidecarTurnIds = collectTurnIdSidecars(entries);
  const hiddenEntryIds = collectHiddenPromptSidecars(entries);
  const clientMessageIdByEntryId =
    input.clientMessageIdByEntryId || sidecarClientMessageIds.size > 0
      ? new Map([
          ...sidecarClientMessageIds,
          ...(input.clientMessageIdByEntryId ? [...input.clientMessageIdByEntryId.entries()] : []),
        ])
      : undefined;
  const turnIdByEntryId =
    input.turnIdByEntryId || sidecarTurnIds.size > 0
      ? new Map([
          ...sidecarTurnIds,
          ...(input.turnIdByEntryId ? [...input.turnIdByEntryId.entries()] : []),
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
      hiddenEntryIds,
      entryById,
      output: nodes,
    });
  }

  return {
    threadId: input.threadId,
    runtimeSessionId: makeRuntimeSessionId(input.sessionManager.getSessionId()),
    leafEntryId: leafId ? nearestProjectedRuntimeEntryId(leafId, entryById, hiddenEntryIds) : null,
    entries: entries
      .filter((entry) => !isProjectionHiddenEntry(entry, hiddenEntryIds))
      .map((entry) =>
        projectRuntimeSessionEntry(
          entry,
          clientMessageIdByEntryId || turnIdByEntryId || entryById || hiddenEntryIds.size > 0
            ? {
                ...(clientMessageIdByEntryId ? { clientMessageIdByEntryId } : {}),
                ...(turnIdByEntryId ? { turnIdByEntryId } : {}),
                entryById,
                hiddenEntryIds,
              }
            : undefined,
        ),
      ),
    nodes,
  };
}
