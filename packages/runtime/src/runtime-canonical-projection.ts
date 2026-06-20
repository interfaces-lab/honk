import type {
  AgentRuntimeEvent,
  MessageId,
  RuntimeIngestionRecord,
  RuntimeSessionId,
  SessionTreeEntry,
  SessionTreeNode,
  SessionTreeProjection,
  ThreadAgentRuntimeQueuedFollowUp,
  ThreadId,
  TurnId,
} from "@honk/contracts";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  runtimeContextWindowActivityRecords,
  runtimeSessionTreeAssistantCompleteRecords,
  runtimeSessionTreeProviderFailureRecords,
  runtimeToolCompletedActivityRecords,
} from "./runtime-orchestration-commands";
import { projectRuntimeSessionTree } from "./session-tree-projection";

export type RuntimeCanonicalTurnState =
  | {
      readonly kind: "running";
      readonly turnId: TurnId | null;
    }
  | {
      readonly kind: "retrying";
      readonly turnId: TurnId | null;
    }
  | {
      readonly kind: "queued-follow-up";
      readonly turnId: TurnId | null;
      readonly queuedCount: number;
    }
  | {
      readonly kind: "completed";
      readonly turnId: TurnId | null;
    }
  | {
      readonly kind: "failed";
      readonly turnId: TurnId | null;
      readonly detail: string;
    }
  | {
      readonly kind: "interrupted";
      readonly turnId: TurnId | null;
    };

export type RuntimeCanonicalEntry = SessionTreeEntry;

export interface RuntimeBridgeFact {
  readonly id: RuntimeIngestionRecord["recordId"];
  readonly kind: RuntimeIngestionRecord["kind"];
  readonly record: RuntimeIngestionRecord;
}

export interface RuntimeCanonicalThread {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly leafEntryId: SessionTreeProjection["leafEntryId"];
  readonly entries: ReadonlyArray<RuntimeCanonicalEntry>;
  readonly nodes: ReadonlyArray<SessionTreeNode>;
  readonly turnState: RuntimeCanonicalTurnState;
  readonly queuedFollowUps: ReadonlyArray<ThreadAgentRuntimeQueuedFollowUp>;
  readonly bridgeFacts: ReadonlyArray<RuntimeBridgeFact>;
}

export function projectRuntimeCanonicalThread(input: {
  readonly threadId: ThreadId;
  readonly sessionManager: SessionManager;
  readonly clientMessageIdByEntryId?: ReadonlyMap<string, MessageId>;
  readonly turnIdByEntryId?: ReadonlyMap<string, TurnId>;
  readonly runtimeEvents?: ReadonlyArray<AgentRuntimeEvent>;
  readonly queuedFollowUps?: ReadonlyArray<ThreadAgentRuntimeQueuedFollowUp>;
  readonly activeTurnId?: TurnId;
  readonly activeRunFirstTurnId?: TurnId;
  readonly pendingTurnCount?: number;
  readonly extraBridgeRecords?: ReadonlyArray<RuntimeIngestionRecord>;
}): RuntimeCanonicalThread {
  const sessionTree = projectRuntimeSessionTree({
    threadId: input.threadId,
    sessionManager: input.sessionManager,
    ...(input.clientMessageIdByEntryId
      ? { clientMessageIdByEntryId: input.clientMessageIdByEntryId }
      : {}),
    ...(input.turnIdByEntryId ? { turnIdByEntryId: input.turnIdByEntryId } : {}),
  });
  const bridgeFacts = runtimeBridgeFactsForCanonicalThread({
    sessionTree,
    runtimeEvents: input.runtimeEvents ?? [],
    extraBridgeRecords: input.extraBridgeRecords ?? [],
  });
  return {
    threadId: sessionTree.threadId,
    runtimeSessionId: sessionTree.runtimeSessionId,
    leafEntryId: sessionTree.leafEntryId,
    entries: sessionTree.entries,
    nodes: sessionTree.nodes,
    turnState: runtimeCanonicalTurnState({
      entries: sessionTree.entries,
      runtimeEvents: input.runtimeEvents ?? [],
      ...(input.activeTurnId ? { activeTurnId: input.activeTurnId } : {}),
      ...(input.activeRunFirstTurnId ? { activeRunFirstTurnId: input.activeRunFirstTurnId } : {}),
      pendingTurnCount: input.pendingTurnCount ?? 0,
      queuedFollowUps: input.queuedFollowUps ?? [],
    }),
    queuedFollowUps: input.queuedFollowUps ?? [],
    bridgeFacts,
  };
}

export function canonicalThreadSessionTree(
  canonicalThread: RuntimeCanonicalThread,
): SessionTreeProjection {
  return {
    threadId: canonicalThread.threadId,
    runtimeSessionId: canonicalThread.runtimeSessionId,
    leafEntryId: canonicalThread.leafEntryId,
    entries: [...canonicalThread.entries],
    nodes: [...canonicalThread.nodes],
  };
}

export function runtimeBridgeFactsForCanonicalThread(input: {
  readonly sessionTree: SessionTreeProjection;
  readonly runtimeEvents: ReadonlyArray<AgentRuntimeEvent>;
  readonly extraBridgeRecords?: ReadonlyArray<RuntimeIngestionRecord>;
}): RuntimeBridgeFact[] {
  return bridgeFactsFromRecords([
    ...runtimeSessionTreeAssistantCompleteRecords({ tree: input.sessionTree }),
    ...runtimeSessionTreeProviderFailureRecords({ tree: input.sessionTree }),
    ...input.runtimeEvents.flatMap(runtimeBridgeRecordsForRuntimeEvent),
    ...(input.extraBridgeRecords ?? []),
  ]);
}

export function runtimeBridgeFactsForRuntimeEvent(event: AgentRuntimeEvent): RuntimeBridgeFact[] {
  return bridgeFactsFromRecords(runtimeBridgeRecordsForRuntimeEvent(event));
}

export function isRuntimeCanonicalTurnActive(turnState: RuntimeCanonicalTurnState): boolean {
  return (
    turnState.kind === "running" ||
    turnState.kind === "retrying" ||
    turnState.kind === "queued-follow-up"
  );
}

function runtimeBridgeRecordsForRuntimeEvent(event: AgentRuntimeEvent): RuntimeIngestionRecord[] {
  return [
    ...runtimeToolCompletedActivityRecords(event),
    ...runtimeContextWindowActivityRecords(event),
  ];
}

function bridgeFactsFromRecords(
  records: ReadonlyArray<RuntimeIngestionRecord>,
): RuntimeBridgeFact[] {
  const factsById = new Map<string, RuntimeBridgeFact>();
  for (const record of records) {
    factsById.set(record.recordId, {
      id: record.recordId,
      kind: record.kind,
      record,
    });
  }
  return [...factsById.values()];
}

function runtimeCanonicalTurnState(input: {
  readonly entries: ReadonlyArray<SessionTreeEntry>;
  readonly runtimeEvents: ReadonlyArray<AgentRuntimeEvent>;
  readonly activeTurnId?: TurnId;
  readonly activeRunFirstTurnId?: TurnId;
  readonly pendingTurnCount: number;
  readonly queuedFollowUps: ReadonlyArray<ThreadAgentRuntimeQueuedFollowUp>;
}): RuntimeCanonicalTurnState {
  const latestEvent = [...input.runtimeEvents]
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  const activeTurnId =
    input.activeTurnId ?? input.activeRunFirstTurnId ?? latestEvent?.turnId ?? null;
  if (input.pendingTurnCount > 0 || input.activeTurnId || input.activeRunFirstTurnId) {
    return { kind: "running", turnId: activeTurnId };
  }
  if (input.queuedFollowUps.length > 0) {
    return {
      kind: "queued-follow-up",
      turnId: activeTurnId,
      queuedCount: input.queuedFollowUps.length,
    };
  }
  if (latestEvent?.type === "runtime.error") {
    return {
      kind: "failed",
      turnId: latestEvent.turnId ?? activeTurnId,
      detail: latestEvent.summary ?? "Runtime failed",
    };
  }
  if (latestEvent?.type === "turn.interrupted") {
    return { kind: "interrupted", turnId: latestEvent.turnId ?? activeTurnId };
  }
  const latestAssistantEntry = [...input.entries]
    .filter((entry) => entry.role === "assistant" && entry.turnId)
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  return {
    kind: "completed",
    turnId: latestAssistantEntry?.turnId ?? activeTurnId,
  };
}
