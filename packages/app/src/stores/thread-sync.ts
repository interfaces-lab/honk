import type {
  DesktopExtensionUiRequest,
  EnvironmentId,
  AgentRuntimeEvent,
  ModelSelection,
  OrchestrationEvent,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationSession,
  OrchestrationSessionStatus,
  OrchestrationThread,
  OrchestrationThreadShell,
  SourceProposedPlanReference,
  SessionTreeProjection,
  OrchestrationThreadActivity,
  ScopedThreadRef,
  ProjectId,
  ThreadEntryId,
  CanonicalItemType,
  ToolLifecycleItemType,
} from "@honk/contracts";
import {
  DEFAULT_AGENT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
  EventId,
  ThreadId,
  MessageId,
  RuntimeItemId,
  RuntimeTaskId,
  resolveLeafIdAfterThreadMessage,
  runtimeSessionEntryMessageId,
  threadEntryIdForMessageId,
  ThreadTokenUsageSnapshot,
  TurnId,
} from "@honk/contracts";
import { Schema } from "effect";
import { normalizeModelSlug } from "@honk/shared/model";
import { toJsonValue } from "@honk/shared/schema-json";
import { resolveGitAgentActionFromPrompt } from "~/lib/git-agent-actions";
import type {
  ChatMessage,
  LiveAssistantTurn,
  Project,
  ProposedPlan,
  SidebarThreadSummary,
  Thread,
  ThreadTreeEntry,
  ThreadSession,
  ThreadShell,
  ThreadTurnState,
  TurnDiffSummary,
} from "../types";
import { resolveEnvironmentHttpUrl } from "../environments/runtime";
import { sanitizeThreadErrorMessage } from "../rpc/transport-error";
import { getThreadFromEnvironmentState } from "../thread-derivation";
import {
  EMPTY_THREAD_IDS,
  initialEnvironmentState,
  type AppState,
  type EnvironmentState,
} from "./thread-store";

const MAX_THREAD_PROPOSED_PLANS = 200;
const MAX_THREAD_ACTIVITIES = 500;
type ThreadActivity = Thread["activities"][number];
type RuntimeSessionTreeEntry = SessionTreeProjection["entries"][number];
type ProjectedRuntimeMessageEntry = RuntimeSessionTreeEntry & {
  readonly role: "user" | "assistant" | "system";
};
type ToolActivityPhase = "started" | "updated" | "completed";
type ToolActivityKind = Extract<
  OrchestrationThreadActivity["kind"],
  "tool.started" | "tool.updated" | "tool.completed"
>;

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function modelSelectionsEqual(
  left: ModelSelection | undefined,
  right: ModelSelection | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    modelOptionSelectionsEqual(left.options, right.options)
  );
}

function modelOptionSelectionsEqual(
  left: ModelSelection["options"] | undefined,
  right: ModelSelection["options"] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  return left.every((leftOption, index) => {
    const rightOption = right[index];
    return (
      rightOption !== undefined &&
      leftOption.id === rightOption.id &&
      leftOption.value === rightOption.value
    );
  });
}

function normalizeModelSelection<T extends { instanceId: string; model: string }>(selection: T): T {
  return {
    ...selection,
    model: normalizeModelSlug(selection.model) ?? selection.model,
  };
}

function mapProjectScripts(scripts: ReadonlyArray<Project["scripts"][number]>): Project["scripts"] {
  return scripts.map((script) => ({ ...script }));
}

function agentRuntimeProposedPlanData(
  data: unknown,
): { readonly planId: string; readonly planMarkdown: string } | null {
  if (!isIndexableRecord(data)) {
    return null;
  }
  return typeof data.planId === "string" &&
    data.planId.trim().length > 0 &&
    typeof data.planMarkdown === "string" &&
    data.planMarkdown.trim().length > 0
    ? { planId: data.planId, planMarkdown: data.planMarkdown }
    : null;
}

function agentRuntimeSourceProposedPlanData(
  data: unknown,
): SourceProposedPlanReference | undefined {
  if (!isIndexableRecord(data)) {
    return undefined;
  }
  const sourceProposedPlan = data.sourceProposedPlan;
  if (!isIndexableRecord(sourceProposedPlan)) {
    return undefined;
  }
  const source = sourceProposedPlan;
  return typeof source.threadId === "string" &&
    source.threadId.trim().length > 0 &&
    typeof source.planId === "string" &&
    source.planId.trim().length > 0
    ? {
        threadId: ThreadId.make(source.threadId),
        planId: source.planId,
      }
    : undefined;
}

function mapSession(session: OrchestrationSession): ThreadSession {
  return {
    status: mapSessionStatusForThreadState(session.status),
    orchestrationStatus: session.status,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
}

function mapMessage(environmentId: EnvironmentId, message: OrchestrationMessage): ChatMessage {
  const attachments = message.attachments?.map((attachment) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: resolveEnvironmentHttpUrl({
      environmentId,
      pathname: attachmentPreviewRoutePath(attachment.id),
    }),
  }));

  return {
    id: message.id,
    role: message.role,
    text: message.text,
    ...(message.richText !== undefined ? { richText: message.richText } : {}),
    turnId: message.turnId,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

function mapThreadEntry(entry: OrchestrationThread["entries"][number]): ThreadTreeEntry {
  return { ...entry };
}

function mapProposedPlan(proposedPlan: OrchestrationProposedPlan): ProposedPlan {
  return {
    id: proposedPlan.id,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
  };
}

function mapProject(
  project:
    | OrchestrationReadModel["projects"][number]
    | OrchestrationShellSnapshot["projects"][number],
  environmentId: EnvironmentId,
): Project {
  return {
    id: project.id,
    environmentId,
    name: project.title,
    cwd: project.projectRoot,
    repositoryIdentity: project.repositoryIdentity ?? null,
    defaultModelSelection: project.defaultModelSelection
      ? normalizeModelSelection(project.defaultModelSelection)
      : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    scripts: mapProjectScripts(project.scripts),
  };
}

function mapThread(thread: OrchestrationThread, environmentId: EnvironmentId): Thread {
  return {
    id: thread.id,
    environmentId,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    session: thread.session ? mapSession(thread.session) : null,
    messages: thread.messages.map((message) => mapMessage(environmentId, message)),
    leafId: thread.leafId,
    entries: thread.entries.map(mapThreadEntry),
    proposedPlans: thread.proposedPlans.map(mapProposedPlan),
    error: sanitizeThreadErrorMessage(thread.session?.lastError),
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    pendingSourceProposedPlan: thread.latestTurn?.sourceProposedPlan,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    turnDiffSummaries: [],
    activities: thread.activities.map((activity) => ({ ...activity })),
  };
}

function mapThreadShell(
  thread: OrchestrationThreadShell,
  environmentId: EnvironmentId,
): {
  shell: ThreadShell;
  session: ThreadSession | null;
  turnState: ThreadTurnState;
  summary: SidebarThreadSummary;
} {
  const shell: ThreadShell = {
    id: thread.id,
    environmentId,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    error: sanitizeThreadErrorMessage(thread.session?.lastError),
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
  };
  const session = thread.session ? mapSession(thread.session) : null;
  const turnState: ThreadTurnState = {
    latestTurn: thread.latestTurn,
    pendingSourceProposedPlan: thread.latestTurn?.sourceProposedPlan,
  };
  const summary: SidebarThreadSummary = {
    id: thread.id,
    environmentId,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestUserMessageAt: thread.latestUserMessageAt,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    hasActionableProposedPlan: thread.hasActionableProposedPlan,
  };
  return {
    shell,
    session,
    turnState,
    summary,
  };
}

function toThreadShell(thread: Thread): ThreadShell {
  return {
    id: thread.id,
    environmentId: thread.environmentId,
    codexThreadId: thread.codexThreadId,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    error: thread.error,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
  };
}

function toThreadTurnState(thread: Thread): ThreadTurnState {
  return {
    latestTurn: thread.latestTurn,
    ...(thread.pendingSourceProposedPlan
      ? { pendingSourceProposedPlan: thread.pendingSourceProposedPlan }
      : {}),
  };
}

function createRuntimeSession(input: {
  readonly threadId: ThreadId;
  readonly createdAt: string;
  readonly updatedAt: string;
}): ThreadSession {
  return {
    status: "ready",
    orchestrationStatus: "ready",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function completedThinkingActivityForSessionEntry(
  entry: SessionTreeProjection["entries"][number],
): OrchestrationThreadActivity | null {
  const thinking = entry.thinking?.trim();
  if (!thinking || entry.role !== "assistant" || entry.turnId === undefined) {
    return null;
  }
  const turnId = TurnId.make(entry.turnId);
  // Entry-scoped identity: a turn holds one reasoning block per assistant message; a
  // turn-scoped id would collapse them into a single entry whose content and timestamp
  // jump to the latest block.
  return {
    id: EventId.make(`runtime-thinking:${turnId}:${entry.id}`),
    kind: "task.completed",
    tone: "info",
    summary: "Task completed",
    turnId,
    sequence: 2,
    createdAt: entry.createdAt,
    payload: {
      taskId: RuntimeTaskId.make(`pi-thinking:${turnId}:${entry.id}`),
      taskType: "thinking",
      status: "completed",
      detail: thinking,
    },
  };
}

function isDisplayableRuntimeMessageEntry(
  entry: RuntimeSessionTreeEntry,
): entry is ProjectedRuntimeMessageEntry {
  if (entry.role !== "user" && entry.role !== "assistant" && entry.role !== "system") {
    return false;
  }
  return entry.role !== "assistant" || (entry.text?.trim().length ?? 0) > 0;
}

function resolveNearestProjectedRuntimeThreadEntryId(input: {
  readonly runtimeEntryId: RuntimeSessionTreeEntry["id"] | null;
  readonly entryByRuntimeId: ReadonlyMap<RuntimeSessionTreeEntry["id"], RuntimeSessionTreeEntry>;
  readonly projectedThreadEntryIdByRuntimeId: ReadonlyMap<
    RuntimeSessionTreeEntry["id"],
    ThreadEntryId
  >;
}): ThreadEntryId | null {
  const seen = new Set<RuntimeSessionTreeEntry["id"]>();
  let cursor = input.runtimeEntryId;

  while (cursor !== null) {
    if (seen.has(cursor)) {
      return null;
    }
    seen.add(cursor);

    const projectedThreadEntryId = input.projectedThreadEntryIdByRuntimeId.get(cursor);
    if (projectedThreadEntryId !== undefined) {
      return projectedThreadEntryId;
    }

    const entry = input.entryByRuntimeId.get(cursor);
    if (!entry) {
      return null;
    }
    cursor = entry.parentId;
  }

  return null;
}

function resolveRuntimeThreadEntryParentEntryId(input: {
  readonly projectedParentEntryId: ThreadEntryId | null;
  readonly existingEntry: ThreadTreeEntry | undefined;
  readonly previousLeafParentId: ThreadEntryId | null;
}): ThreadEntryId | null {
  if (input.existingEntry?.parentEntryId != null) {
    return input.existingEntry.parentEntryId;
  }
  return input.projectedParentEntryId ?? input.previousLeafParentId;
}

function threadFromRuntimeSessionTree(
  tree: SessionTreeProjection,
  environmentId: EnvironmentId,
  previousThread: Thread | undefined,
): Thread {
  const projectedMessages: ChatMessage[] = [];
  const projectedEntries: ThreadTreeEntry[] = [];
  const sessionTreeActivities: OrchestrationThreadActivity[] = [];
  const entryByRuntimeId = new Map(tree.entries.map((entry) => [entry.id, entry] as const));
  const previousEntryById = new Map(
    previousThread?.entries.map((entry) => [entry.id, entry] as const) ?? [],
  );
  const projectedThreadEntryIdByRuntimeId = new Map(
    tree.entries
      .filter(isDisplayableRuntimeMessageEntry)
      .map(
        (entry) =>
          [entry.id, threadEntryIdForMessageId(runtimeSessionTreeMessageId(tree, entry))] as const,
      ),
  );

  for (const entry of tree.entries) {
    const thinkingActivity = completedThinkingActivityForSessionEntry(entry);
    if (thinkingActivity) {
      sessionTreeActivities.push(thinkingActivity);
    }
    sessionTreeActivities.push(...startedToolActivitiesForSessionEntry(entry));
    const completedToolActivity = completedToolActivityForSessionEntry(entry);
    if (completedToolActivity) {
      sessionTreeActivities.push(completedToolActivity);
    }

    if (isDisplayableRuntimeMessageEntry(entry)) {
      const messageId = runtimeSessionTreeMessageId(tree, entry);
      const threadEntryId = threadEntryIdForMessageId(messageId);
      projectedMessages.push({
        id: messageId,
        role: entry.role,
        text: entry.text ?? "",
        turnId: entry.turnId ?? null,
        createdAt: entry.createdAt,
        completedAt: entry.createdAt,
        streaming: false,
      });
      const projectedParentEntryId = resolveNearestProjectedRuntimeThreadEntryId({
        runtimeEntryId: entry.parentId,
        entryByRuntimeId,
        projectedThreadEntryIdByRuntimeId,
      });
      const existingEntry = previousThread?.entries.find(
        (threadEntry) => threadEntry.id === threadEntryId,
      );
      const previousLeafParentId =
        previousThread?.leafId &&
        previousThread.leafId !== threadEntryId &&
        previousEntryById.has(previousThread.leafId)
          ? previousThread.leafId
          : null;
      projectedEntries.push({
        id: threadEntryId,
        threadId: tree.threadId,
        parentEntryId: resolveRuntimeThreadEntryParentEntryId({
          projectedParentEntryId,
          existingEntry,
          previousLeafParentId,
        }),
        kind: "message",
        messageId,
        turnId: entry.turnId ?? null,
        createdAt: entry.createdAt,
      });
    }
  }

  const projectedMessageIdAliases = runtimeSessionMessageIdAliases(
    previousThread,
    projectedMessages,
  );
  const projectedThreadEntryIdAliases = new Map(
    [...projectedMessageIdAliases.entries()].map(
      ([projectedMessageId, resolvedMessageId]) =>
        [
          threadEntryIdForMessageId(projectedMessageId),
          threadEntryIdForMessageId(resolvedMessageId),
        ] as const,
    ),
  );
  const messages = mergeRuntimeSessionMessages(
    previousThread,
    projectedMessages,
    projectedMessageIdAliases,
  );
  const entries = mergeRuntimeSessionEntries(
    previousThread,
    projectedEntries.map((entry) => {
      if (entry.messageId === null) {
        return entry;
      }
      const aliasedMessageId = projectedMessageIdAliases.get(entry.messageId);
      const messageId = aliasedMessageId ?? entry.messageId;
      const entryId = threadEntryIdForMessageId(messageId);
      const existingAliasedEntry =
        aliasedMessageId === undefined
          ? undefined
          : previousThread?.entries.find((threadEntry) => threadEntry.id === entryId);
      const aliasedParentEntryId =
        entry.parentEntryId === null
          ? null
          : (projectedThreadEntryIdAliases.get(entry.parentEntryId) ?? entry.parentEntryId);
      if (!aliasedMessageId && aliasedParentEntryId === entry.parentEntryId) {
        return entry;
      }
      return {
        ...entry,
        id: entryId,
        messageId,
        parentEntryId:
          existingAliasedEntry?.parentEntryId ??
          (aliasedParentEntryId === entryId ? null : aliasedParentEntryId),
      };
    }),
  );
  const createdAt = messages[0]?.createdAt ?? new Date().toISOString();
  const updatedAt = messages.at(-1)?.createdAt ?? createdAt;
  const session =
    previousThread?.session ??
    createRuntimeSession({ threadId: tree.threadId, createdAt, updatedAt });
  const rawProjectedLeafId = tree.leafEntryId
    ? resolveNearestProjectedRuntimeThreadEntryId({
        runtimeEntryId: tree.leafEntryId,
        entryByRuntimeId,
        projectedThreadEntryIdByRuntimeId,
      })
    : null;
  const projectedLeafId = rawProjectedLeafId
    ? (projectedThreadEntryIdAliases.get(rawProjectedLeafId) ?? rawProjectedLeafId)
    : null;
  const projectedLeafAliasesExistingEntry =
    rawProjectedLeafId !== null && projectedThreadEntryIdAliases.has(rawProjectedLeafId);
  const leafId =
    projectedLeafAliasesExistingEntry &&
    previousThread?.leafId &&
    previousThread.leafId !== projectedLeafId
      ? previousThread.leafId
      : (projectedLeafId ?? previousThread?.leafId ?? null);
  const piSessionTitle =
    tree.entries.findLast((entry) => entry.kind === "session-info")?.text?.trim() || null;

  return {
    id: tree.threadId,
    environmentId,
    codexThreadId: null,
    projectId: previousThread?.projectId ?? null,
    title: piSessionTitle ?? previousThread?.title ?? "Agent thread",
    modelSelection: previousThread?.modelSelection ?? DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
    runtimeMode: previousThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode: previousThread?.interactionMode ?? DEFAULT_AGENT_INTERACTION_MODE,
    session,
    messages,
    leafId,
    entries,
    proposedPlans: previousThread?.proposedPlans ?? [],
    error: null,
    createdAt: previousThread?.createdAt ?? createdAt,
    archivedAt: previousThread?.archivedAt ?? null,
    updatedAt,
    latestTurn: previousThread?.latestTurn ?? null,
    pendingSourceProposedPlan: previousThread?.pendingSourceProposedPlan,
    branch: previousThread?.branch ?? null,
    worktreePath: previousThread?.worktreePath ?? null,
    turnDiffSummaries: previousThread?.turnDiffSummaries ?? [],
    activities: upsertThreadActivities(previousThread?.activities ?? [], sessionTreeActivities),
  };
}

function runtimeSessionTreeMessageId(
  tree: SessionTreeProjection,
  entry: ProjectedRuntimeMessageEntry,
): MessageId {
  return entry.clientMessageId ?? runtimeSessionEntryMessageId(tree.runtimeSessionId, entry.id);
}

function mergeRuntimeSessionMessages(
  previousThread: Thread | undefined,
  projectedMessages: ReadonlyArray<ChatMessage>,
  projectedMessageIdAliases: ReadonlyMap<MessageId, MessageId>,
): ChatMessage[] {
  if (!previousThread) {
    return [...projectedMessages];
  }
  const messageById = new Map(previousThread.messages.map((message) => [message.id, message]));
  for (const projectedMessage of projectedMessages) {
    const messageId = projectedMessageIdAliases.get(projectedMessage.id) ?? projectedMessage.id;
    const existingMessage = messageById.get(messageId);
    if (existingMessage?.role === "user" && projectedMessage.role === "user") {
      messageById.set(messageId, existingMessage);
      continue;
    }
    const shouldPreserveAttachments =
      existingMessage?.attachments !== undefined && projectedMessage.attachments === undefined;
    messageById.set(
      messageId,
      existingMessage
        ? {
            ...existingMessage,
            ...projectedMessage,
            id: messageId,
            ...(existingMessage.richText !== undefined && projectedMessage.richText === undefined
              ? { richText: existingMessage.richText }
              : {}),
            ...(shouldPreserveAttachments ? { attachments: existingMessage.attachments } : {}),
          }
        : projectedMessage,
    );
  }
  return [...messageById.values()].toSorted(compareCreatedThreadItem);
}

function runtimeSessionMessageIdAliases(
  previousThread: Thread | undefined,
  projectedMessages: ReadonlyArray<ChatMessage>,
): Map<MessageId, MessageId> {
  const aliases = new Map<MessageId, MessageId>();
  if (!previousThread) {
    return aliases;
  }
  const existingMessageById = new Map(
    previousThread.messages.map((message) => [message.id, message]),
  );
  const existingGitActionUserMessageByAction = new Map<
    NonNullable<ReturnType<typeof resolveGitAgentActionFromPrompt>>,
    ChatMessage
  >();
  const existingUserMessagesByText = new Map<string, ChatMessage[]>();
  for (const message of previousThread.messages) {
    if (message.role !== "user") {
      continue;
    }
    const messagesWithText = existingUserMessagesByText.get(message.text) ?? [];
    messagesWithText.push(message);
    existingUserMessagesByText.set(message.text, messagesWithText);

    const gitAction = resolveGitAgentActionFromPrompt(message.text);
    if (gitAction !== null) {
      existingGitActionUserMessageByAction.set(gitAction, message);
    }
  }
  const projectedUserTextCounts = new Map<string, number>();
  for (const projectedMessage of projectedMessages) {
    if (projectedMessage.role === "user") {
      projectedUserTextCounts.set(
        projectedMessage.text,
        (projectedUserTextCounts.get(projectedMessage.text) ?? 0) + 1,
      );
    }
  }

  for (const projectedMessage of projectedMessages) {
    if (existingMessageById.has(projectedMessage.id)) {
      continue;
    }
    if (projectedMessage.role !== "user") {
      continue;
    }
    const gitAction = resolveGitAgentActionFromPrompt(projectedMessage.text);
    const existingGitActionUserMessage =
      gitAction === null ? undefined : existingGitActionUserMessageByAction.get(gitAction);
    if (existingGitActionUserMessage) {
      aliases.set(projectedMessage.id, existingGitActionUserMessage.id);
      continue;
    }

    const existingUserMessagesWithText = existingUserMessagesByText.get(projectedMessage.text);
    if (
      existingUserMessagesWithText?.length === 1 &&
      projectedUserTextCounts.get(projectedMessage.text) === 1
    ) {
      aliases.set(projectedMessage.id, existingUserMessagesWithText[0]!.id);
    }
  }
  return aliases;
}

function mergeRuntimeSessionEntries(
  previousThread: Thread | undefined,
  projectedEntries: ReadonlyArray<ThreadTreeEntry>,
): ThreadTreeEntry[] {
  if (!previousThread) {
    return [...projectedEntries];
  }
  const entryById = new Map(previousThread.entries.map((entry) => [entry.id, entry]));
  for (const projectedEntry of projectedEntries) {
    const existingEntry = entryById.get(projectedEntry.id);
    entryById.set(
      projectedEntry.id,
      existingEntry
        ? {
            ...existingEntry,
            ...projectedEntry,
            parentEntryId: existingEntry.parentEntryId,
            turnId:
              projectedEntry.turnId === null && existingEntry.turnId !== null
                ? existingEntry.turnId
                : projectedEntry.turnId,
            createdAt: existingEntry.createdAt,
          }
        : projectedEntry,
    );
  }
  return [...entryById.values()].toSorted(compareCreatedThreadItem);
}

function compareCreatedThreadItem(
  left: Pick<ChatMessage | ThreadTreeEntry, "id" | "createdAt">,
  right: Pick<ChatMessage | ThreadTreeEntry, "id" | "createdAt">,
): number {
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  return createdAtComparison === 0 ? left.id.localeCompare(right.id) : createdAtComparison;
}

function sidebarThreadSummaryFromThread(
  thread: Thread,
  previousSummary?: SidebarThreadSummary,
): SidebarThreadSummary {
  return {
    id: thread.id,
    environmentId: thread.environmentId,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session: thread.session,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestUserMessageAt:
      thread.messages.findLast((message) => message.role === "user")?.createdAt ??
      previousSummary?.latestUserMessageAt ??
      null,
    hasPendingApprovals: previousSummary?.hasPendingApprovals ?? false,
    hasPendingUserInput: previousSummary?.hasPendingUserInput ?? false,
    hasActionableProposedPlan: previousSummary?.hasActionableProposedPlan ?? false,
  };
}

function sidebarThreadSummaryInputsUnchanged(
  previousThread: Thread | undefined,
  nextThread: Thread,
): boolean {
  return (
    previousThread !== undefined &&
    previousThread.id === nextThread.id &&
    previousThread.environmentId === nextThread.environmentId &&
    previousThread.projectId === nextThread.projectId &&
    previousThread.title === nextThread.title &&
    previousThread.interactionMode === nextThread.interactionMode &&
    previousThread.session === nextThread.session &&
    previousThread.createdAt === nextThread.createdAt &&
    previousThread.archivedAt === nextThread.archivedAt &&
    previousThread.updatedAt === nextThread.updatedAt &&
    previousThread.latestTurn === nextThread.latestTurn &&
    previousThread.branch === nextThread.branch &&
    previousThread.worktreePath === nextThread.worktreePath &&
    previousThread.messages === nextThread.messages
  );
}

function sourceProposedPlansEqual(
  left: OrchestrationLatestTurn["sourceProposedPlan"] | undefined,
  right: OrchestrationLatestTurn["sourceProposedPlan"] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.threadId === right.threadId && left.planId === right.planId;
}

function latestTurnsEqual(
  left: OrchestrationLatestTurn | null | undefined,
  right: OrchestrationLatestTurn | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.turnId === right.turnId &&
    left.state === right.state &&
    left.requestedAt === right.requestedAt &&
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.assistantMessageId === right.assistantMessageId &&
    sourceProposedPlansEqual(left.sourceProposedPlan, right.sourceProposedPlan)
  );
}

function threadSessionsEqual(
  left: ThreadSession | null | undefined,
  right: ThreadSession | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.status === right.status &&
    left.orchestrationStatus === right.orchestrationStatus &&
    left.activeTurnId === right.activeTurnId &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.lastError === right.lastError
  );
}

function sidebarThreadSummariesEqual(
  left: SidebarThreadSummary | undefined,
  right: SidebarThreadSummary,
): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.interactionMode === right.interactionMode &&
    threadSessionsEqual(left.session, right.session) &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    latestTurnsEqual(left.latestTurn, right.latestTurn) &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.latestUserMessageAt === right.latestUserMessageAt &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.hasActionableProposedPlan === right.hasActionableProposedPlan
  );
}

function threadShellsEqual(left: ThreadShell | undefined, right: ThreadShell): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.environmentId === right.environmentId &&
    left.codexThreadId === right.codexThreadId &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    modelSelectionsEqual(left.modelSelection, right.modelSelection) &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    left.error === right.error &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.updatedAt === right.updatedAt &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath
  );
}

function threadTurnStatesEqual(left: ThreadTurnState | undefined, right: ThreadTurnState): boolean {
  return (
    left !== undefined &&
    latestTurnsEqual(left.latestTurn, right.latestTurn) &&
    sourceProposedPlansEqual(left.pendingSourceProposedPlan, right.pendingSourceProposedPlan)
  );
}

function appendId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

function removeId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.filter((value) => value !== id);
}

function mergePreservingOrder<T extends string>(
  previousOrder: readonly T[],
  nextOrder: readonly T[],
): T[] {
  const remaining = new Set(nextOrder);
  const merged: T[] = [];
  for (const value of previousOrder) {
    if (remaining.has(value)) {
      merged.push(value);
      remaining.delete(value);
    }
  }
  for (const value of nextOrder) {
    if (remaining.has(value)) {
      merged.push(value);
    }
  }
  return merged;
}

function mergeThreadIdsByProjectId(
  previous: Record<ProjectId, ThreadId[]>,
  next: Record<ProjectId, ThreadId[]>,
): Record<ProjectId, ThreadId[]> {
  const projectIds = new Set<ProjectId>([
    ...(Object.keys(previous) as ProjectId[]),
    ...(Object.keys(next) as ProjectId[]),
  ]);
  const merged: Record<ProjectId, ThreadId[]> = {};
  for (const projectId of projectIds) {
    merged[projectId] = mergePreservingOrder(
      previous[projectId] ?? EMPTY_THREAD_IDS,
      next[projectId] ?? EMPTY_THREAD_IDS,
    );
  }
  return merged;
}

function buildMessageSlice(thread: Thread): {
  ids: MessageId[];
  byId: Record<MessageId, ChatMessage>;
} {
  return {
    ids: thread.messages.map((message) => message.id),
    byId: Object.fromEntries(
      thread.messages.map((message) => [message.id, message] as const),
    ) as Record<MessageId, ChatMessage>,
  };
}

function toolItemTypeForName(toolName: string): ToolLifecycleItemType {
  // TODO: Use runtimeToolItemTypeForName from @honk/runtime if @honk/app gains that dependency.
  switch (toolName) {
    case "bash":
      return "command_execution";
    case "read":
      return "file_read";
    case "grep":
    case "find":
    case "ls":
      return "file_search";
    case "edit":
    case "write":
      return "file_change";
    default:
      return "dynamic_tool_call";
  }
}

function toolActivityId(toolCallId: string, phase: ToolActivityPhase): EventId {
  return EventId.make(`runtime-tool:${toolCallId}:${phase}`);
}

function toolActivityKindForPhase(phase: ToolActivityPhase): ToolActivityKind {
  switch (phase) {
    case "started":
      return "tool.started";
    case "updated":
      return "tool.updated";
    case "completed":
      return "tool.completed";
  }
}

function defaultToolActivitySummary(input: {
  readonly phase: ToolActivityPhase;
  readonly toolName: string;
  readonly isError: boolean;
}): string {
  const toolLabel = toolActivityDisplayLabel(input.toolName);
  switch (input.phase) {
    case "started":
      return `Started ${toolLabel}`;
    case "updated":
      return `Running ${toolLabel}`;
    case "completed":
      return input.isError ? `${capitalizeToolLabel(toolLabel)} failed` : `Ran ${toolLabel}`;
  }
}

function toolActivityDisplayLabel(toolName: string): string {
  return toolItemTypeForName(toolName) === "command_execution" ? "command" : toolName;
}

function capitalizeToolLabel(label: string): string {
  return `${label.slice(0, 1).toUpperCase()}${label.slice(1)}`;
}

function buildToolLifecycleActivity(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly phase: ToolActivityPhase;
  readonly turnId: TurnId | null;
  readonly createdAt: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly isError?: boolean;
  readonly summary?: string;
  readonly runtimeEvent: unknown;
}): OrchestrationThreadActivity {
  const itemType = toolItemTypeForName(input.toolName);
  const title = itemType === "command_execution" ? "command" : input.toolName;
  const detail = toolResultText(input.result);
  const command = asTrimmedString(asRecord(input.args)?.command);
  const isError = input.isError === true;
  return {
    id: toolActivityId(input.toolCallId, input.phase),
    kind: toolActivityKindForPhase(input.phase),
    tone: isError ? "error" : "tool",
    summary:
      asTrimmedString(input.summary) ??
      defaultToolActivitySummary({ phase: input.phase, toolName: input.toolName, isError }),
    turnId: input.turnId,
    createdAt: input.createdAt,
    payload: {
      itemType,
      itemId: input.toolCallId,
      status: input.phase === "completed" ? (isError ? "failed" : "completed") : "running",
      title,
      ...(detail ? { detail } : {}),
      data: {
        ...(input.args !== undefined ? { args: input.args } : {}),
        ...(command ? { command } : {}),
        ...(input.result !== undefined ? { result: input.result, rawOutput: input.result } : {}),
        runtimeEvent: input.runtimeEvent,
      },
    },
  };
}

function startedToolActivitiesForSessionEntry(
  entry: RuntimeSessionTreeEntry,
): OrchestrationThreadActivity[] {
  if (entry.role !== "assistant") {
    return [];
  }
  const rawEntry = asRecord(entry.rawEntry);
  const message = asRecord(rawEntry?.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.flatMap((part) => {
    const toolCall = asRecord(part);
    if (toolCall?.type !== "toolCall") {
      return [];
    }
    const toolCallId = asTrimmedString(toolCall.id ?? toolCall.toolCallId);
    const toolName = asTrimmedString(toolCall.name ?? toolCall.toolName);
    if (!toolCallId || !toolName) {
      return [];
    }
    return [
      buildToolLifecycleActivity({
        toolCallId,
        toolName,
        phase: "started",
        turnId: entry.turnId ?? null,
        createdAt: entry.createdAt,
        ...(toolCall.arguments !== undefined ? { args: toolCall.arguments } : {}),
        runtimeEvent: toolCall,
      }),
    ];
  });
}

function completedToolActivityForSessionEntry(
  entry: RuntimeSessionTreeEntry,
): OrchestrationThreadActivity | null {
  if (entry.role !== "toolResult") {
    return null;
  }
  const rawEntry = asRecord(entry.rawEntry);
  const message = asRecord(rawEntry?.message);
  const toolCallId = asTrimmedString(message?.toolCallId);
  const toolName = asTrimmedString(message?.toolName);
  if (!toolCallId || !toolName) {
    return null;
  }
  return buildToolLifecycleActivity({
    toolCallId,
    toolName,
    phase: "completed",
    turnId: entry.turnId ?? null,
    createdAt: entry.createdAt,
    ...(message?.content !== undefined ? { result: message.content } : {}),
    isError: message?.isError === true,
    runtimeEvent: message,
  });
}

function extensionUiActivityId(requestId: string): EventId {
  return EventId.make(`runtime-extension-ui:${requestId}`);
}

function isExtensionUiRequestKind(value: unknown): value is DesktopExtensionUiRequest["kind"] {
  switch (value) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
    case "question":
    case "custom":
      return true;
    default:
      return false;
  }
}

function extensionUiRequestTurnId(thread: Thread): TurnId | null {
  return thread.session?.activeTurnId ?? thread.latestTurn?.turnId ?? null;
}

function buildExtensionUiRequestedActivity(
  request: DesktopExtensionUiRequest,
  turnId: TurnId | null,
): OrchestrationThreadActivity {
  const detail = asTrimmedString(request.message);
  return {
    id: extensionUiActivityId(request.id),
    kind: "extension-ui.requested",
    tone: "info",
    summary: `Waiting for ${request.title}`,
    turnId,
    createdAt: request.createdAt,
    payload: {
      requestId: request.id,
      requestKind: request.kind,
      title: request.title,
      detail,
      placeholder: request.placeholder ?? null,
      options: request.options ? [...request.options] : null,
      ...(request.questions
        ? { questions: request.questions.map((question) => ({ ...question })) }
        : {}),
    },
  };
}

function buildExtensionUiResolvedActivity(
  activity: OrchestrationThreadActivity,
  requestId: string,
  resolvedAt: string,
): OrchestrationThreadActivity {
  const payload = asRecord(activity.payload);
  const title = asTrimmedString(payload?.title) ?? "Extension prompt";
  const requestKind = isExtensionUiRequestKind(payload?.requestKind)
    ? payload.requestKind
    : "custom";
  return {
    id: extensionUiActivityId(requestId),
    kind: "extension-ui.resolved",
    tone: "info",
    summary: `Answered ${title}`,
    turnId: activity.turnId,
    createdAt: resolvedAt,
    payload: {
      requestId,
      requestKind,
      title,
      detail: typeof payload?.detail === "string" ? payload.detail : null,
      value: null,
    },
  };
}

function isIndexableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isIndexableRecord(value) ? value : null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function toolResultText(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => toolResultText(entry))
      .filter((entry): entry is string => entry !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const keys = ["stdout", "stderr", "output", "content", "text", "message", "result"];
  for (const key of keys) {
    const text = toolResultText(record[key]);
    if (text) {
      return text;
    }
  }
  return null;
}

type RuntimeSubagentActivityKind = Extract<
  OrchestrationThreadActivity["kind"],
  | "subagent.thread.started"
  | "subagent.thread.state.changed"
  | "subagent.item.started"
  | "subagent.item.updated"
  | "subagent.item.completed"
  | "subagent.content.delta"
  | "subagent.usage.updated"
>;
type RuntimeSubagentContentStreamKind = Extract<
  OrchestrationThreadActivity,
  { kind: "subagent.content.delta" }
>["payload"]["streamKind"];

function isRuntimeSubagentActivityKind(value: unknown): value is RuntimeSubagentActivityKind {
  switch (value) {
    case "subagent.thread.started":
    case "subagent.thread.state.changed":
    case "subagent.item.started":
    case "subagent.item.updated":
    case "subagent.item.completed":
    case "subagent.content.delta":
    case "subagent.usage.updated":
      return true;
    default:
      return false;
  }
}

function isRuntimeSubagentContentStreamKind(
  value: unknown,
): value is RuntimeSubagentContentStreamKind {
  switch (value) {
    case "assistant_text":
    case "reasoning_text":
    case "reasoning_summary_text":
    case "plan_text":
    case "command_output":
    case "file_change_output":
    case "unknown":
      return true;
    default:
      return false;
  }
}

function compactRuntimeSubagentIdentityPayload(
  payload: Record<string, unknown> | null,
  parentTurnId: TurnId | undefined,
) {
  const subagentThreadId = asTrimmedString(payload?.subagentThreadId);
  if (!subagentThreadId) {
    return null;
  }
  const parentThreadId = asTrimmedString(payload?.parentThreadId);
  const parentItemId = asTrimmedString(payload?.parentItemId);
  const agentId = asTrimmedString(payload?.agentId);
  const nickname = asTrimmedString(payload?.nickname);
  const role = asTrimmedString(payload?.role);
  const model = asTrimmedString(payload?.model);
  const prompt = asTrimmedString(payload?.prompt);
  return {
    subagentThreadId,
    ...(parentThreadId ? { parentThreadId } : {}),
    ...(parentTurnId ? { parentTurnId } : {}),
    ...(parentItemId ? { parentItemId: RuntimeItemId.make(parentItemId) } : {}),
    ...(agentId ? { agentId } : {}),
    ...(nickname ? { nickname } : {}),
    ...(role ? { role } : {}),
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

function compactRuntimeSubagentItemPayload(
  payload: Record<string, unknown> | null,
  parentTurnId: TurnId | undefined,
) {
  const identity = compactRuntimeSubagentIdentityPayload(payload, parentTurnId);
  if (!identity) {
    return null;
  }
  const itemType = asTrimmedString(payload?.itemType);
  const itemId = asTrimmedString(payload?.itemId);
  const status = asTrimmedString(payload?.status);
  const title = asTrimmedString(payload?.title);
  const detail = asTrimmedString(payload?.detail);
  const data = toJsonValue(payload?.data);
  return {
    ...identity,
    ...(itemType && isCanonicalItemType(itemType) ? { itemType } : {}),
    ...(itemId ? { itemId } : {}),
    ...(status ? { status } : {}),
    ...(title ? { title } : {}),
    ...(detail ? { detail } : {}),
    ...(data !== undefined && data !== null ? { data } : {}),
  };
}

function compactRuntimeSubagentContentDeltaPayload(
  payload: Record<string, unknown> | null,
  parentTurnId: TurnId | undefined,
) {
  const identity = compactRuntimeSubagentIdentityPayload(payload, parentTurnId);
  if (!identity) {
    return null;
  }
  const streamKind = payload?.streamKind;
  const delta = typeof payload?.delta === "string" ? payload.delta : null;
  const itemId = asTrimmedString(payload?.itemId);
  const contentIndex = asInteger(payload?.contentIndex);
  const summaryIndex = asInteger(payload?.summaryIndex);
  if (!isRuntimeSubagentContentStreamKind(streamKind) || delta === null) {
    return null;
  }
  return {
    ...identity,
    streamKind,
    delta,
    ...(itemId ? { itemId } : {}),
    ...(contentIndex !== null ? { contentIndex } : {}),
    ...(summaryIndex !== null ? { summaryIndex } : {}),
  };
}

function compactRuntimeSubagentUsagePayload(
  payload: Record<string, unknown> | null,
  parentTurnId: TurnId | undefined,
) {
  const identity = compactRuntimeSubagentIdentityPayload(payload, parentTurnId);
  if (!identity) {
    return null;
  }
  const usedTokens = asNonNegativeInteger(payload?.usedTokens);
  if (usedTokens === null) {
    return null;
  }
  const maxTokens = asPositiveInteger(payload?.maxTokens);
  return {
    ...identity,
    usedTokens,
    ...(maxTokens !== null ? { maxTokens } : {}),
  };
}

function isCanonicalItemType(value: string): value is CanonicalItemType {
  switch (value) {
    case "user_message":
    case "assistant_message":
    case "reasoning":
    case "plan":
    case "command_execution":
    case "file_read":
    case "file_search":
    case "file_change":
    case "mcp_tool_call":
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
    case "web_search":
    case "web_fetch":
    case "image_view":
    case "review_entered":
    case "review_exited":
    case "context_compaction":
    case "error":
    case "unknown":
      return true;
    default:
      return false;
  }
}

function normalizeRuntimeSubagentThreadState(
  value: unknown,
): "active" | "idle" | "archived" | "closed" | "compacted" | "error" | null {
  switch (value) {
    case "running":
    case "active":
      return "active";
    case "completed":
    case "idle":
      return "idle";
    case "failed":
    case "aborted":
    case "error":
      return "error";
    case "archived":
    case "closed":
    case "compacted":
      return value;
    default:
      return null;
  }
}

export function runtimeSubagentActivitiesForToolEvent(
  event: AgentRuntimeEvent,
): OrchestrationThreadActivity[] {
  const data = asRecord(event.data);
  if (data?.toolName !== "subagent") {
    return [];
  }
  const result = asRecord(event.type === "tool.completed" ? data.result : data?.partialResult);
  const details = asRecord(result?.details);
  const rawActivities = Array.isArray(details?.activities) ? details.activities : [];
  const turnId = event.turnId ? TurnId.make(event.turnId) : undefined;
  const activities: OrchestrationThreadActivity[] = [];

  for (const rawActivity of rawActivities) {
    const activity = asRecord(rawActivity);
    if (!activity) {
      continue;
    }
    const kind = activity?.kind;
    if (!isRuntimeSubagentActivityKind(kind)) {
      continue;
    }

    const id = EventId.make(asTrimmedString(activity.id) ?? `runtime-subagent:${event.id}`);
    const summary = asTrimmedString(activity.summary) ?? "Subagent update";
    const createdAt = asTrimmedString(activity.createdAt) ?? event.createdAt;
    const payload = asRecord(activity.payload);
    const sequence = asNonNegativeInteger(activity.sequence) ?? undefined;

    switch (kind) {
      case "subagent.thread.started": {
        const identity = compactRuntimeSubagentIdentityPayload(payload, turnId);
        if (!identity) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: identity,
        });
        break;
      }
      case "subagent.thread.state.changed": {
        const identity = compactRuntimeSubagentIdentityPayload(payload, turnId);
        const state = normalizeRuntimeSubagentThreadState(payload?.state);
        if (!identity || !state) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: state === "error" ? "error" : "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: {
            ...identity,
            state,
            ...(payload?.detail !== undefined
              ? { detail: toJsonValue(payload.detail) ?? null }
              : {}),
          },
        });
        break;
      }
      case "subagent.item.started":
      case "subagent.item.updated":
      case "subagent.item.completed": {
        const itemPayload = compactRuntimeSubagentItemPayload(payload, turnId);
        if (!itemPayload) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: itemPayload,
        });
        break;
      }
      case "subagent.content.delta": {
        const deltaPayload = compactRuntimeSubagentContentDeltaPayload(payload, turnId);
        if (!deltaPayload) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: deltaPayload,
        });
        break;
      }
      case "subagent.usage.updated": {
        const usagePayload = compactRuntimeSubagentUsagePayload(payload, turnId);
        if (!usagePayload) {
          break;
        }
        activities.push({
          id,
          kind,
          tone: "info",
          summary,
          turnId: turnId ?? null,
          ...(sequence !== undefined ? { sequence } : {}),
          createdAt,
          payload: usagePayload,
        });
        break;
      }
    }
  }

  return activities;
}

function upsertThreadActivities(
  current: ReadonlyArray<ThreadActivity>,
  replacements: ReadonlyArray<ThreadActivity>,
): ThreadActivity[] {
  if (replacements.length === 0) {
    return [...current];
  }
  let next = current;
  for (const replacement of replacements) {
    next = upsertThreadActivity(next, replacement);
  }
  return next.length > MAX_THREAD_ACTIVITIES ? next.slice(-MAX_THREAD_ACTIVITIES) : [...next];
}

function upsertThreadActivity(
  current: ReadonlyArray<ThreadActivity>,
  replacement: ThreadActivity,
): ReadonlyArray<ThreadActivity> {
  const existingIndex = current.findIndex((activity) => activity.id === replacement.id);
  if (existingIndex >= 0 && isActivityOrderedAt(current, existingIndex, replacement)) {
    const next = [...current];
    next[existingIndex] = replacement;
    return next;
  }

  const withoutExisting =
    existingIndex >= 0
      ? [...current.slice(0, existingIndex), ...current.slice(existingIndex + 1)]
      : [...current];
  const insertIndex = activityInsertIndex(withoutExisting, replacement);
  withoutExisting.splice(insertIndex, 0, replacement);
  return withoutExisting;
}

function isActivityOrderedAt(
  activities: ReadonlyArray<ThreadActivity>,
  index: number,
  activity: ThreadActivity,
): boolean {
  const previous = activities[index - 1];
  const next = activities[index + 1];
  return (
    (previous === undefined || compareActivities(previous, activity) <= 0) &&
    (next === undefined || compareActivities(activity, next) <= 0)
  );
}

function activityInsertIndex(
  activities: ReadonlyArray<ThreadActivity>,
  activity: ThreadActivity,
): number {
  let low = 0;
  let high = activities.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = activities[mid];
    if (candidate && compareActivities(candidate, activity) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function clearLiveAssistantTurn(
  state: EnvironmentState,
  threadId: ThreadId,
  turnId: TurnId,
): EnvironmentState {
  const currentByTurnId = state.liveAssistantTurnByThreadId[threadId];
  if (!currentByTurnId?.[turnId]) {
    return state;
  }
  const { [turnId]: _removedTurn, ...nextByTurnId } = currentByTurnId;
  const nextIds = removeId(state.liveAssistantTurnIdsByThreadId[threadId] ?? [], turnId);
  return {
    ...state,
    liveAssistantTurnIdsByThreadId: {
      ...state.liveAssistantTurnIdsByThreadId,
      [threadId]: nextIds,
    },
    liveAssistantTurnByThreadId: {
      ...state.liveAssistantTurnByThreadId,
      [threadId]: nextByTurnId,
    },
  };
}

function clearLiveAssistantTurnsForThread(
  state: EnvironmentState,
  threadId: ThreadId,
): EnvironmentState {
  if (!state.liveAssistantTurnByThreadId[threadId]) {
    return state;
  }
  const { [threadId]: _removedIds, ...liveAssistantTurnIdsByThreadId } =
    state.liveAssistantTurnIdsByThreadId;
  const { [threadId]: _removedTurns, ...liveAssistantTurnByThreadId } =
    state.liveAssistantTurnByThreadId;
  return {
    ...state,
    liveAssistantTurnIdsByThreadId,
    liveAssistantTurnByThreadId,
  };
}

function syncPendingExtensionUiRequestsForThread(
  state: EnvironmentState,
  threadId: ThreadId,
  requests: ReadonlyArray<DesktopExtensionUiRequest>,
): EnvironmentState {
  const requestIds = new Set(requests.map((request) => request.id));
  const resolvedAt = new Date().toISOString();
  return updateThreadState(state, threadId, (thread) => {
    const requestedActivities = requests.map((request) =>
      buildExtensionUiRequestedActivity(request, extensionUiRequestTurnId(thread)),
    );
    const resolvedActivities = thread.activities.flatMap((activity) => {
      if (activity.kind !== "extension-ui.requested") {
        return [];
      }
      const requestId = asTrimmedString(asRecord(activity.payload)?.requestId);
      if (!requestId || requestIds.has(requestId)) {
        return [];
      }
      return [buildExtensionUiResolvedActivity(activity, requestId, resolvedAt)];
    });
    const replacements = [...requestedActivities, ...resolvedActivities];
    if (replacements.length === 0) {
      return thread;
    }
    return {
      ...thread,
      activities: upsertThreadActivities(thread.activities, replacements),
      updatedAt: latestTimestamp(
        [thread.updatedAt, ...replacements.map((activity) => activity.createdAt)],
        thread.updatedAt,
      ),
    };
  });
}

function latestTimestamp(
  candidates: readonly (string | undefined)[],
  fallback: string | undefined,
): string {
  const timestamps = candidates.filter((value): value is string => typeof value === "string");
  return timestamps.toSorted((left, right) => left.localeCompare(right)).at(-1) ?? fallback ?? "";
}

function buildEntrySlice(thread: Thread): {
  ids: ThreadEntryId[];
  byId: Record<ThreadEntryId, ThreadTreeEntry>;
} {
  const entries = thread.entries;
  return {
    ids: entries.map((entry) => entry.id),
    byId: Object.fromEntries(entries.map((entry) => [entry.id, entry] as const)) as Record<
      ThreadEntryId,
      ThreadTreeEntry
    >,
  };
}

function buildActivitySlice(thread: Thread): {
  ids: string[];
  byId: Record<string, OrchestrationThreadActivity>;
} {
  return {
    ids: thread.activities.map((activity) => activity.id),
    byId: Object.fromEntries(
      thread.activities.map((activity) => [activity.id, activity] as const),
    ) as Record<string, OrchestrationThreadActivity>,
  };
}

function splitSubagentActivities(activities: ReadonlyArray<OrchestrationThreadActivity>): {
  parentActivities: ReadonlyArray<OrchestrationThreadActivity>;
  subagentActivities: OrchestrationThreadActivity[];
} {
  let parentActivities: OrchestrationThreadActivity[] | null = null;
  const subagentActivities: OrchestrationThreadActivity[] = [];

  for (let index = 0; index < activities.length; index += 1) {
    const activity = activities[index];
    if (!activity) {
      continue;
    }
    if (isSubagentActivity(activity)) {
      subagentActivities.push(activity);
      if (parentActivities === null) {
        parentActivities = activities.slice(0, index);
      }
      continue;
    }
    parentActivities?.push(activity);
  }

  return {
    parentActivities: parentActivities ?? activities,
    subagentActivities,
  };
}

function isSubagentActivity(activity: OrchestrationThreadActivity): boolean {
  return activity.kind.startsWith("subagent.");
}

export interface SubagentActivityBatch {
  readonly threadId: ThreadId;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}

export function subagentActivitiesForThreadDetail(
  thread: OrchestrationThread,
): ReadonlyArray<OrchestrationThreadActivity> {
  return thread.activities.flatMap((activity) =>
    isSubagentActivity(activity) ? [{ ...activity }] : [],
  );
}

export function subagentActivityBatchesForOrchestrationEvent(
  event: OrchestrationEvent,
): ReadonlyArray<SubagentActivityBatch> {
  if (event.type !== "thread.activity-appended" || !isSubagentActivity(event.payload.activity)) {
    return [];
  }
  return [
    {
      threadId: event.payload.threadId,
      activities: [{ ...event.payload.activity }],
    },
  ];
}

export function subagentActivityBatchesForOrchestrationEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): ReadonlyArray<SubagentActivityBatch> {
  return events.flatMap(subagentActivityBatchesForOrchestrationEvent);
}

function reuseParentVisibleThreadSlices(
  previousThread: Thread | undefined,
  nextThread: Thread,
): Thread {
  if (!previousThread) {
    return nextThread;
  }

  const messages = areSameChatMessages(previousThread.messages, nextThread.messages)
    ? previousThread.messages
    : nextThread.messages;
  const entries = areSameThreadEntries(previousThread.entries, nextThread.entries)
    ? previousThread.entries
    : nextThread.entries;
  const activities = areSameParentActivities(previousThread.activities, nextThread.activities)
    ? previousThread.activities
    : nextThread.activities;
  const proposedPlans = areSameProposedPlans(previousThread.proposedPlans, nextThread.proposedPlans)
    ? previousThread.proposedPlans
    : nextThread.proposedPlans;
  const turnDiffSummaries = areSameTurnDiffSummaries(
    previousThread.turnDiffSummaries,
    nextThread.turnDiffSummaries,
  )
    ? previousThread.turnDiffSummaries
    : nextThread.turnDiffSummaries;

  if (
    messages === nextThread.messages &&
    entries === nextThread.entries &&
    activities === nextThread.activities &&
    proposedPlans === nextThread.proposedPlans &&
    turnDiffSummaries === nextThread.turnDiffSummaries
  ) {
    return nextThread;
  }

  return {
    ...nextThread,
    messages,
    entries,
    activities,
    proposedPlans,
    turnDiffSummaries,
  };
}

function preserveParentUpdatedAtWhenOnlyHiddenDataChanged(
  previousThread: Thread | undefined,
  nextThread: Thread,
): Thread {
  if (
    !previousThread ||
    previousThread.updatedAt === nextThread.updatedAt ||
    !isSameParentVisibleThread(previousThread, nextThread)
  ) {
    return nextThread;
  }

  return {
    ...nextThread,
    updatedAt: previousThread.updatedAt,
  };
}

function isSameParentVisibleThread(previousThread: Thread, nextThread: Thread): boolean {
  return (
    previousThread.id === nextThread.id &&
    previousThread.environmentId === nextThread.environmentId &&
    previousThread.codexThreadId === nextThread.codexThreadId &&
    previousThread.projectId === nextThread.projectId &&
    previousThread.title === nextThread.title &&
    modelSelectionsEqual(previousThread.modelSelection, nextThread.modelSelection) &&
    previousThread.runtimeMode === nextThread.runtimeMode &&
    previousThread.interactionMode === nextThread.interactionMode &&
    threadSessionsEqual(previousThread.session, nextThread.session) &&
    previousThread.error === nextThread.error &&
    previousThread.createdAt === nextThread.createdAt &&
    previousThread.archivedAt === nextThread.archivedAt &&
    latestTurnsEqual(previousThread.latestTurn, nextThread.latestTurn) &&
    sourceProposedPlansEqual(
      previousThread.pendingSourceProposedPlan,
      nextThread.pendingSourceProposedPlan,
    ) &&
    previousThread.branch === nextThread.branch &&
    previousThread.worktreePath === nextThread.worktreePath &&
    previousThread.leafId === nextThread.leafId &&
    previousThread.messages === nextThread.messages &&
    previousThread.entries === nextThread.entries &&
    previousThread.activities === nextThread.activities &&
    previousThread.proposedPlans === nextThread.proposedPlans &&
    previousThread.turnDiffSummaries === nextThread.turnDiffSummaries
  );
}

function isNeutralSessionStatus(status: ThreadSession["orchestrationStatus"] | null): boolean {
  return status === null || status === "idle" || status === "ready";
}

function shouldPreserveLiveRuntimeSession(
  previousSession: ThreadSession | null | undefined,
  nextSession: ThreadSession | null | undefined,
): previousSession is ThreadSession {
  if (previousSession?.orchestrationStatus !== "running") {
    return false;
  }
  if (!isNeutralSessionStatus(nextSession?.orchestrationStatus ?? null)) {
    return false;
  }
  return (
    nextSession === null ||
    nextSession === undefined ||
    previousSession.updatedAt >= nextSession.updatedAt
  );
}

function preserveLiveRuntimeLatestTurn(
  previous: ThreadTurnState | null | undefined,
  next: ThreadTurnState,
): ThreadTurnState {
  if (!previous?.latestTurn) {
    return next;
  }
  return {
    latestTurn: previous.latestTurn,
    pendingSourceProposedPlan:
      previous.pendingSourceProposedPlan ?? next.pendingSourceProposedPlan,
  };
}

function preserveLiveRuntimeThreadState(previousThread: Thread | undefined, nextThread: Thread) {
  if (!shouldPreserveLiveRuntimeSession(previousThread?.session, nextThread.session)) {
    return nextThread;
  }
  const nextTurnState = preserveLiveRuntimeLatestTurn(
    previousThread ? toThreadTurnState(previousThread) : null,
    toThreadTurnState(nextThread),
  );
  return {
    ...nextThread,
    session: previousThread.session,
    latestTurn: nextTurnState.latestTurn,
    pendingSourceProposedPlan: nextTurnState.pendingSourceProposedPlan,
  };
}

function areSameChatMessages(
  previous: ReadonlyArray<ChatMessage>,
  next: ReadonlyArray<ChatMessage>,
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((previousMessage, index) => {
    const nextMessage = next[index];
    return (
      nextMessage !== undefined &&
      previousMessage.id === nextMessage.id &&
      previousMessage.role === nextMessage.role &&
      previousMessage.text === nextMessage.text &&
      valuesEqual(previousMessage.richText, nextMessage.richText) &&
      areSameAttachments(previousMessage.attachments, nextMessage.attachments) &&
      previousMessage.turnId === nextMessage.turnId &&
      previousMessage.createdAt === nextMessage.createdAt &&
      previousMessage.completedAt === nextMessage.completedAt &&
      previousMessage.streaming === nextMessage.streaming
    );
  });
}

function areSameAttachments(
  previous: ChatMessage["attachments"] | undefined,
  next: ChatMessage["attachments"] | undefined,
): boolean {
  if (previous === next) return true;
  if (previous === undefined || next === undefined || previous.length !== next.length) return false;
  return previous.every((previousAttachment, index) => {
    const nextAttachment = next[index];
    return (
      nextAttachment !== undefined &&
      previousAttachment.type === nextAttachment.type &&
      previousAttachment.id === nextAttachment.id &&
      previousAttachment.name === nextAttachment.name &&
      previousAttachment.mimeType === nextAttachment.mimeType &&
      previousAttachment.sizeBytes === nextAttachment.sizeBytes &&
      previousAttachment.previewUrl === nextAttachment.previewUrl
    );
  });
}

function areSameThreadEntries(
  previous: ReadonlyArray<ThreadTreeEntry>,
  next: ReadonlyArray<ThreadTreeEntry>,
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((previousEntry, index) => {
    const nextEntry = next[index];
    return (
      nextEntry !== undefined &&
      previousEntry.id === nextEntry.id &&
      previousEntry.threadId === nextEntry.threadId &&
      previousEntry.parentEntryId === nextEntry.parentEntryId &&
      previousEntry.kind === nextEntry.kind &&
      previousEntry.messageId === nextEntry.messageId &&
      previousEntry.turnId === nextEntry.turnId &&
      previousEntry.createdAt === nextEntry.createdAt
    );
  });
}

function areSameParentActivities(
  previous: ReadonlyArray<OrchestrationThreadActivity>,
  next: ReadonlyArray<OrchestrationThreadActivity>,
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((previousActivity, index) => {
    const nextActivity = next[index];
    return (
      nextActivity !== undefined &&
      previousActivity.id === nextActivity.id &&
      previousActivity.kind === nextActivity.kind &&
      previousActivity.tone === nextActivity.tone &&
      previousActivity.summary === nextActivity.summary &&
      previousActivity.turnId === nextActivity.turnId &&
      previousActivity.sequence === nextActivity.sequence &&
      previousActivity.createdAt === nextActivity.createdAt &&
      valuesEqual(previousActivity.payload, nextActivity.payload)
    );
  });
}

function areSameProposedPlans(
  previous: ReadonlyArray<ProposedPlan>,
  next: ReadonlyArray<ProposedPlan>,
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((previousPlan, index) => {
    const nextPlan = next[index];
    return (
      nextPlan !== undefined &&
      previousPlan.id === nextPlan.id &&
      previousPlan.turnId === nextPlan.turnId &&
      previousPlan.planMarkdown === nextPlan.planMarkdown &&
      previousPlan.implementedAt === nextPlan.implementedAt &&
      previousPlan.implementationThreadId === nextPlan.implementationThreadId &&
      previousPlan.createdAt === nextPlan.createdAt &&
      previousPlan.updatedAt === nextPlan.updatedAt
    );
  });
}

function areSameTurnDiffSummaries(
  previous: ReadonlyArray<TurnDiffSummary>,
  next: ReadonlyArray<TurnDiffSummary>,
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((previousSummary, index) => {
    const nextSummary = next[index];
    return (
      nextSummary !== undefined &&
      previousSummary.turnId === nextSummary.turnId &&
      previousSummary.completedAt === nextSummary.completedAt &&
      previousSummary.status === nextSummary.status &&
      previousSummary.assistantMessageId === nextSummary.assistantMessageId &&
      areSameTurnDiffFiles(previousSummary.files, nextSummary.files)
    );
  });
}

function areSameTurnDiffFiles(
  previous: ReadonlyArray<TurnDiffSummary["files"][number]>,
  next: ReadonlyArray<TurnDiffSummary["files"][number]>,
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((previousFile, index) => {
    const nextFile = next[index];
    return (
      nextFile !== undefined &&
      previousFile.path === nextFile.path &&
      previousFile.kind === nextFile.kind &&
      previousFile.additions === nextFile.additions &&
      previousFile.deletions === nextFile.deletions
    );
  });
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function buildProposedPlanSlice(thread: Thread): {
  ids: string[];
  byId: Record<string, ProposedPlan>;
} {
  return {
    ids: thread.proposedPlans.map((plan) => plan.id),
    byId: Object.fromEntries(
      thread.proposedPlans.map((plan) => [plan.id, plan] as const),
    ) as Record<string, ProposedPlan>,
  };
}

function buildTurnDiffSlice(thread: Thread): {
  ids: TurnId[];
  byId: Record<TurnId, TurnDiffSummary>;
} {
  return {
    ids: thread.turnDiffSummaries.map((summary) => summary.turnId),
    byId: Object.fromEntries(
      thread.turnDiffSummaries.map((summary) => [summary.turnId, summary] as const),
    ) as Record<TurnId, TurnDiffSummary>,
  };
}

/**
 * Ensure a thread is registered in the bookkeeping indices (threadIds,
 * threadIdsByProjectId).  Shared by both the shell stream and detail stream
 * write paths — the bookkeeping is additive (append-only IDs) so concurrent
 * writes from both streams are safe.
 */
function ensureThreadRegistered(
  state: EnvironmentState,
  threadId: ThreadId,
  nextProjectId: ProjectId | null,
  previousProjectId: ProjectId | null | undefined,
): EnvironmentState {
  let nextState = state;

  if (!state.threadIds.includes(threadId)) {
    nextState = {
      ...nextState,
      threadIds: [...nextState.threadIds, threadId],
    };
  }

  if (previousProjectId !== nextProjectId) {
    let threadIdsByProjectId = nextState.threadIdsByProjectId;
    let projectlessThreadIds = nextState.projectlessThreadIds;
    if (previousProjectId) {
      const previousIds = threadIdsByProjectId[previousProjectId] ?? EMPTY_THREAD_IDS;
      const nextIds = removeId(previousIds, threadId);
      if (nextIds.length === 0) {
        const { [previousProjectId]: _removed, ...rest } = threadIdsByProjectId;
        threadIdsByProjectId = rest as Record<ProjectId, ThreadId[]>;
      } else if (!arraysEqual(previousIds, nextIds)) {
        threadIdsByProjectId = {
          ...threadIdsByProjectId,
          [previousProjectId]: nextIds,
        };
      }
    } else if (previousProjectId === null) {
      const nextProjectlessThreadIds = removeId(projectlessThreadIds, threadId);
      if (!arraysEqual(projectlessThreadIds, nextProjectlessThreadIds)) {
        projectlessThreadIds = nextProjectlessThreadIds;
      }
    }
    if (nextProjectId === null) {
      const nextProjectlessThreadIds = appendId(projectlessThreadIds, threadId);
      if (!arraysEqual(projectlessThreadIds, nextProjectlessThreadIds)) {
        projectlessThreadIds = nextProjectlessThreadIds;
      }
    } else {
      const projectThreadIds = threadIdsByProjectId[nextProjectId] ?? EMPTY_THREAD_IDS;
      const nextProjectThreadIds = appendId(projectThreadIds, threadId);
      if (!arraysEqual(projectThreadIds, nextProjectThreadIds)) {
        threadIdsByProjectId = {
          ...threadIdsByProjectId,
          [nextProjectId]: nextProjectThreadIds,
        };
      }
    }
    if (
      threadIdsByProjectId !== nextState.threadIdsByProjectId ||
      projectlessThreadIds !== nextState.projectlessThreadIds
    ) {
      nextState = {
        ...nextState,
        threadIdsByProjectId,
        projectlessThreadIds,
      };
    }
  }

  return nextState;
}

/**
 * Write thread state from the **detail stream** (per-thread subscription).
 *
 * Owns: messages, activities, proposed plans, turn diff summaries.
 * Also writes threadShellById / threadSessionById / threadTurnStateById so
 * the active thread has up-to-date state even if the shell stream event
 * hasn't arrived yet (both streams use structural equality checks to avoid
 * unnecessary re-renders when delivering equivalent data). Also writes the
 * denormalized sidebar summary from the same canonical thread state so running
 * status is stored on the sidebar row itself.
 */
function writeThreadState(
  state: EnvironmentState,
  nextThread: Thread,
  previousThread?: Thread,
): EnvironmentState {
  const { parentActivities } = splitSubagentActivities(nextThread.activities);
  if (parentActivities !== nextThread.activities) {
    nextThread = {
      ...nextThread,
      activities: [...parentActivities],
    };
  }
  nextThread = reuseParentVisibleThreadSlices(previousThread, nextThread);
  nextThread = preserveParentUpdatedAtWhenOnlyHiddenDataChanged(previousThread, nextThread);
  nextThread = preserveLiveRuntimeThreadState(previousThread, nextThread);
  const nextShell = toThreadShell(nextThread);
  const nextTurnState = toThreadTurnState(nextThread);
  const previousShell = state.threadShellById[nextThread.id];
  const previousTurnState = state.threadTurnStateById[nextThread.id];

  let nextState = ensureThreadRegistered(
    state,
    nextThread.id,
    nextThread.projectId,
    previousThread?.projectId,
  );

  if (!threadShellsEqual(previousShell, nextShell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...nextState.threadShellById,
        [nextThread.id]: nextShell,
      },
    };
  }

  if (!threadSessionsEqual(previousThread?.session ?? null, nextThread.session)) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...nextState.threadSessionById,
        [nextThread.id]: nextThread.session,
      },
    };
  }

  if (!threadTurnStatesEqual(previousTurnState, nextTurnState)) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...nextState.threadTurnStateById,
        [nextThread.id]: nextTurnState,
      },
    };
  }

  if (previousThread?.messages !== nextThread.messages) {
    const nextMessageSlice = buildMessageSlice(nextThread);
    nextState = {
      ...nextState,
      messageIdsByThreadId: {
        ...nextState.messageIdsByThreadId,
        [nextThread.id]: nextMessageSlice.ids,
      },
      messageByThreadId: {
        ...nextState.messageByThreadId,
        [nextThread.id]: nextMessageSlice.byId,
      },
    };
  }

  const nextLeafId = nextThread.leafId;
  if ((previousThread?.leafId ?? null) !== nextLeafId) {
    nextState = {
      ...nextState,
      leafIdByThreadId: {
        ...nextState.leafIdByThreadId,
        [nextThread.id]: nextLeafId,
      },
    };
  }

  if (previousThread?.entries !== nextThread.entries) {
    const nextEntrySlice = buildEntrySlice(nextThread);
    nextState = {
      ...nextState,
      entryIdsByThreadId: {
        ...nextState.entryIdsByThreadId,
        [nextThread.id]: nextEntrySlice.ids,
      },
      entryByThreadId: {
        ...nextState.entryByThreadId,
        [nextThread.id]: nextEntrySlice.byId,
      },
    };
  }

  if (previousThread?.activities !== nextThread.activities) {
    const nextActivitySlice = buildActivitySlice(nextThread);
    nextState = {
      ...nextState,
      activityIdsByThreadId: {
        ...nextState.activityIdsByThreadId,
        [nextThread.id]: nextActivitySlice.ids,
      },
      activityByThreadId: {
        ...nextState.activityByThreadId,
        [nextThread.id]: nextActivitySlice.byId,
      },
    };
  }

  if (previousThread?.proposedPlans !== nextThread.proposedPlans) {
    const nextProposedPlanSlice = buildProposedPlanSlice(nextThread);
    nextState = {
      ...nextState,
      proposedPlanIdsByThreadId: {
        ...nextState.proposedPlanIdsByThreadId,
        [nextThread.id]: nextProposedPlanSlice.ids,
      },
      proposedPlanByThreadId: {
        ...nextState.proposedPlanByThreadId,
        [nextThread.id]: nextProposedPlanSlice.byId,
      },
    };
  }

  if (previousThread?.turnDiffSummaries !== nextThread.turnDiffSummaries) {
    const nextTurnDiffSlice = buildTurnDiffSlice(nextThread);
    nextState = {
      ...nextState,
      turnDiffIdsByThreadId: {
        ...nextState.turnDiffIdsByThreadId,
        [nextThread.id]: nextTurnDiffSlice.ids,
      },
      turnDiffSummaryByThreadId: {
        ...nextState.turnDiffSummaryByThreadId,
        [nextThread.id]: nextTurnDiffSlice.byId,
      },
    };
  }

  const previousSummary = state.sidebarThreadSummaryById[nextThread.id];
  if (!sidebarThreadSummaryInputsUnchanged(previousThread, nextThread)) {
    const nextSummary = sidebarThreadSummaryFromThread(nextThread, previousSummary);
    if (!sidebarThreadSummariesEqual(previousSummary, nextSummary)) {
      nextState = {
        ...nextState,
        sidebarThreadSummaryById: {
          ...nextState.sidebarThreadSummaryById,
          [nextThread.id]: nextSummary,
        },
      };
    }
  }

  return nextState;
}

/**
 * Write thread state from the **shell stream** (all-threads subscription).
 *
 * Owns: sidebarThreadSummaryById (pre-computed server-side sidebar data).
 * Also writes threadShellById / threadSessionById / threadTurnStateById as
 * the authoritative source for these fields.  The detail stream may also
 * write them for the focused thread (see writeThreadState); structural
 * equality checks prevent unnecessary re-renders.
 * Does NOT write message/activity/proposedPlan/turnDiff content — that is
 * detail-stream-only.
 */
function writeThreadShellState(
  state: EnvironmentState,
  nextThread: {
    shell: ThreadShell;
    session: ThreadSession | null;
    turnState: ThreadTurnState;
    summary: SidebarThreadSummary;
  },
  previous?: {
    shell?: ThreadShell | undefined;
    session?: ThreadSession | null | undefined;
    turnState?: ThreadTurnState | undefined;
    summary?: SidebarThreadSummary | undefined;
  },
): EnvironmentState {
  const existingShell = state.threadShellById[nextThread.shell.id];
  const existingSession = state.threadSessionById[nextThread.shell.id] ?? null;
  const existingTurnState = state.threadTurnStateById[nextThread.shell.id];
  const existingSummary = state.sidebarThreadSummaryById[nextThread.shell.id];
  const previousShell = previous?.shell ?? existingShell;
  const liveSession = previous?.session ?? existingSession;
  const liveTurnState = previous?.turnState ?? existingTurnState;
  if (shouldPreserveLiveRuntimeSession(liveSession, nextThread.session)) {
    const turnState = preserveLiveRuntimeLatestTurn(liveTurnState, nextThread.turnState);
    nextThread = {
      ...nextThread,
      session: liveSession,
      turnState,
      summary: {
        ...nextThread.summary,
        session: liveSession,
        latestTurn: turnState.latestTurn,
      },
    };
  }

  let nextState = ensureThreadRegistered(
    state,
    nextThread.shell.id,
    nextThread.shell.projectId,
    previousShell?.projectId,
  );

  if (!threadShellsEqual(existingShell, nextThread.shell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...nextState.threadShellById,
        [nextThread.shell.id]: nextThread.shell,
      },
    };
  }

  if (!threadSessionsEqual(existingSession, nextThread.session)) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...nextState.threadSessionById,
        [nextThread.shell.id]: nextThread.session,
      },
    };
  }

  if (!threadTurnStatesEqual(existingTurnState, nextThread.turnState)) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...nextState.threadTurnStateById,
        [nextThread.shell.id]: nextThread.turnState,
      },
    };
  }

  if (
    !sidebarThreadSummariesEqual(
      existingSummary,
      nextThread.summary,
    )
  ) {
    nextState = {
      ...nextState,
      sidebarThreadSummaryById: {
        ...nextState.sidebarThreadSummaryById,
        [nextThread.shell.id]: nextThread.summary,
      },
    };
  }

  return nextState;
}

function retainThreadScopedRecord<T>(
  record: Record<ThreadId, T>,
  nextThreadIds: ReadonlySet<ThreadId>,
): Record<ThreadId, T> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([threadId, value]) =>
      nextThreadIds.has(threadId as ThreadId) ? [[threadId, value] as const] : [],
    ),
  ) as Record<ThreadId, T>;
}

function removeThreadState(state: EnvironmentState, threadId: ThreadId): EnvironmentState {
  const shell = state.threadShellById[threadId];
  if (!shell) {
    return state;
  }

  const nextThreadIds = removeId(state.threadIds, threadId);
  const nextProjectlessThreadIds =
    shell.projectId === null
      ? removeId(state.projectlessThreadIds, threadId)
      : state.projectlessThreadIds;
  const nextThreadIdsByProjectId =
    shell.projectId === null
      ? state.threadIdsByProjectId
      : (() => {
          const currentProjectThreadIds =
            state.threadIdsByProjectId[shell.projectId] ?? EMPTY_THREAD_IDS;
          const nextProjectThreadIds = removeId(currentProjectThreadIds, threadId);
          return nextProjectThreadIds.length === 0
            ? (() => {
                const { [shell.projectId]: _removed, ...rest } = state.threadIdsByProjectId;
                return rest as Record<ProjectId, ThreadId[]>;
              })()
            : {
                ...state.threadIdsByProjectId,
                [shell.projectId]: nextProjectThreadIds,
              };
        })();

  const { [threadId]: _removedShell, ...threadShellById } = state.threadShellById;
  const { [threadId]: _removedSession, ...threadSessionById } = state.threadSessionById;
  const { [threadId]: _removedTurnState, ...threadTurnStateById } = state.threadTurnStateById;
  const { [threadId]: _removedMessageIds, ...messageIdsByThreadId } = state.messageIdsByThreadId;
  const { [threadId]: _removedMessages, ...messageByThreadId } = state.messageByThreadId;
  const { [threadId]: _removedLiveTurnIds, ...liveAssistantTurnIdsByThreadId } =
    state.liveAssistantTurnIdsByThreadId;
  const { [threadId]: _removedLiveTurns, ...liveAssistantTurnByThreadId } =
    state.liveAssistantTurnByThreadId;
  const { [threadId]: _removedLeafId, ...leafIdByThreadId } = state.leafIdByThreadId ?? {};
  const { [threadId]: _removedEntryIds, ...entryIdsByThreadId } = state.entryIdsByThreadId ?? {};
  const { [threadId]: _removedEntries, ...entryByThreadId } = state.entryByThreadId ?? {};
  const { [threadId]: _removedActivityIds, ...activityIdsByThreadId } = state.activityIdsByThreadId;
  const { [threadId]: _removedActivities, ...activityByThreadId } = state.activityByThreadId;
  const { [threadId]: _removedPlanIds, ...proposedPlanIdsByThreadId } =
    state.proposedPlanIdsByThreadId;
  const { [threadId]: _removedPlans, ...proposedPlanByThreadId } = state.proposedPlanByThreadId;
  const { [threadId]: _removedTurnDiffIds, ...turnDiffIdsByThreadId } = state.turnDiffIdsByThreadId;
  const { [threadId]: _removedTurnDiffs, ...turnDiffSummaryByThreadId } =
    state.turnDiffSummaryByThreadId;
  const { [threadId]: _removedSidebarSummary, ...sidebarThreadSummaryById } =
    state.sidebarThreadSummaryById;

  return {
    ...state,
    threadIds: nextThreadIds,
    threadIdsByProjectId: nextThreadIdsByProjectId,
    projectlessThreadIds: nextProjectlessThreadIds,
    threadShellById,
    threadSessionById,
    threadTurnStateById,
    messageIdsByThreadId,
    messageByThreadId,
    liveAssistantTurnIdsByThreadId,
    liveAssistantTurnByThreadId,
    leafIdByThreadId,
    entryIdsByThreadId,
    entryByThreadId,
    activityIdsByThreadId,
    activityByThreadId,
    proposedPlanIdsByThreadId,
    proposedPlanByThreadId,
    turnDiffIdsByThreadId,
    turnDiffSummaryByThreadId,
    sidebarThreadSummaryById,
  };
}

function compareActivities(
  left: Thread["activities"][number],
  right: Thread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function buildLatestTurn(params: {
  previous: Thread["latestTurn"];
  turnId: NonNullable<Thread["latestTurn"]>["turnId"];
  state: NonNullable<Thread["latestTurn"]>["state"];
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"];
  sourceProposedPlan?: Thread["pendingSourceProposedPlan"];
}): NonNullable<Thread["latestTurn"]> {
  const resolvedPlan =
    params.previous?.turnId === params.turnId
      ? params.previous.sourceProposedPlan
      : params.sourceProposedPlan;
  return {
    turnId: params.turnId,
    state: params.state,
    requestedAt: params.requestedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    assistantMessageId: params.assistantMessageId,
    ...(resolvedPlan ? { sourceProposedPlan: resolvedPlan } : {}),
  };
}

function bindNextPendingUserTurnStart(
  thread: Thread,
  turnId: TurnId,
): {
  readonly messages: Thread["messages"];
  readonly entries: Thread["entries"];
  readonly requestedAt: string | null;
} {
  const messagesById = new Map(thread.messages.map((message) => [message.id, message] as const));
  const pendingEntry = thread.entries.find((entry) => {
    if (entry.kind !== "message" || entry.turnId !== null || entry.messageId === null) {
      return false;
    }
    const message = messagesById.get(entry.messageId);
    return message?.role === "user" && (message.turnId === null || message.turnId === undefined);
  });

  if (!pendingEntry?.messageId) {
    return {
      messages: thread.messages,
      entries: thread.entries,
      requestedAt: null,
    };
  }

  return {
    messages: thread.messages.map((message) =>
      message.id === pendingEntry.messageId ? { ...message, turnId } : message,
    ),
    entries: thread.entries.map((entry) =>
      entry.id === pendingEntry.id ? { ...entry, turnId } : entry,
    ),
    requestedAt: messagesById.get(pendingEntry.messageId)?.createdAt ?? pendingEntry.createdAt,
  };
}

function settledLatestTurnForRunningSession(
  latestTurn: OrchestrationLatestTurn,
): OrchestrationLatestTurn | null {
  if (
    latestTurn.state === "completed" ||
    latestTurn.state === "interrupted" ||
    latestTurn.state === "error"
  ) {
    return latestTurn;
  }
  if (latestTurn.completedAt !== null) {
    return {
      ...latestTurn,
      state: "completed",
    };
  }
  return null;
}

function rebindTurnDiffSummariesForAssistantMessage(
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>,
  turnId: TurnId,
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"],
): TurnDiffSummary[] {
  let changed = false;
  const nextSummaries = turnDiffSummaries.map((summary) => {
    if (summary.turnId !== turnId || summary.assistantMessageId === assistantMessageId) {
      return summary;
    }
    changed = true;
    return {
      ...summary,
      assistantMessageId: assistantMessageId ?? undefined,
    };
  });
  return changed ? nextSummaries : [...turnDiffSummaries];
}

function mapSessionStatusForThreadState(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
    default:
      return "closed";
  }
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

function updateThreadState(
  state: EnvironmentState,
  threadId: ThreadId,
  updater: (thread: Thread) => Thread,
): EnvironmentState {
  const currentThread = getThreadFromEnvironmentState(state, threadId);
  if (!currentThread) {
    return state;
  }
  const nextThread = updater(currentThread);
  if (nextThread === currentThread) {
    return state;
  }
  return writeThreadState(state, nextThread, currentThread);
}

function clearUnconfirmedLocalTurnStartInEnvironment(
  state: EnvironmentState,
  input: {
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
  },
): EnvironmentState {
  return updateThreadState(state, input.threadId, (thread) => {
    const message = thread.messages.find((candidate) => candidate.id === input.messageId);
    if (
      !message ||
      message.role !== "user" ||
      (message.turnId !== null && message.turnId !== undefined)
    ) {
      return thread;
    }

    const removedEntries = thread.entries.filter(
      (entry) =>
        entry.kind === "message" &&
        entry.messageId === input.messageId &&
        (entry.turnId === null || entry.turnId === undefined),
    );
    const removedEntryIds = new Set(removedEntries.map((entry) => entry.id));
    const removedLeafEntry = removedEntries.find((entry) => entry.id === thread.leafId);

    return {
      ...thread,
      messages: thread.messages.filter((candidate) => candidate.id !== input.messageId),
      entries: thread.entries.filter((entry) => !removedEntryIds.has(entry.id)),
      leafId: removedLeafEntry ? removedLeafEntry.parentEntryId : thread.leafId,
      pendingSourceProposedPlan: undefined,
      updatedAt: new Date().toISOString(),
    };
  });
}

function isUnconfirmedLocalThreadEmpty(state: EnvironmentState, threadId: ThreadId): boolean {
  if (!state.threadShellById[threadId]) {
    return false;
  }
  if (state.threadSessionById[threadId] != null) {
    return false;
  }
  const turnState = state.threadTurnStateById[threadId];
  if (turnState?.latestTurn != null || turnState?.pendingSourceProposedPlan != null) {
    return false;
  }
  return (
    (state.messageIdsByThreadId[threadId]?.length ?? 0) === 0 &&
    (state.liveAssistantTurnIdsByThreadId[threadId]?.length ?? 0) === 0 &&
    (state.entryIdsByThreadId?.[threadId]?.length ?? 0) === 0 &&
    (state.activityIdsByThreadId[threadId]?.length ?? 0) === 0 &&
    (state.proposedPlanIdsByThreadId[threadId]?.length ?? 0) === 0 &&
    (state.turnDiffIdsByThreadId[threadId]?.length ?? 0) === 0
  );
}

function clearUnconfirmedLocalThreadInEnvironment(
  state: EnvironmentState,
  threadId: ThreadId,
): EnvironmentState {
  if (!isUnconfirmedLocalThreadEmpty(state, threadId)) {
    return state;
  }
  return removeThreadState(state, threadId);
}

function buildProjectState(
  projects: ReadonlyArray<Project>,
): Pick<EnvironmentState, "projectIds" | "projectById"> {
  return {
    projectIds: projects.map((project) => project.id),
    projectById: Object.fromEntries(
      projects.map((project) => [project.id, project] as const),
    ) as Record<ProjectId, Project>,
  };
}

export function getStoredEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
): EnvironmentState {
  return state.environmentStateById[environmentId] ?? initialEnvironmentState;
}

export function commitEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
  nextEnvironmentState: EnvironmentState,
): AppState {
  const currentEnvironmentState = state.environmentStateById[environmentId];
  const environmentStateById =
    currentEnvironmentState === nextEnvironmentState
      ? state.environmentStateById
      : {
          ...state.environmentStateById,
          [environmentId]: nextEnvironmentState,
        };

  if (environmentStateById === state.environmentStateById) {
    return state;
  }

  return {
    ...state,
    environmentStateById,
  };
}

function applyShellSnapshotWithSource(
  state: EnvironmentState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
  source: "cache" | "server",
): EnvironmentState {
  const previousThreadIds = state.threadIds;
  const previousThreadIdsByProjectId = state.threadIdsByProjectId;
  const previousProjectlessThreadIds = state.projectlessThreadIds;
  const previousSnapshotSource = state.snapshotSource;
  const nextProjects = snapshot.projects.map((project) => mapProject(project, environmentId));
  const nextThreadIds = new Set(snapshot.threads.map((thread) => thread.id));
  let nextState: EnvironmentState = {
    ...state,
    ...buildProjectState(nextProjects),
    threadIds: [],
    threadIdsByProjectId: {},
    projectlessThreadIds: [],
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    sidebarThreadSummaryById: {},
    messageIdsByThreadId: retainThreadScopedRecord(state.messageIdsByThreadId, nextThreadIds),
    messageByThreadId: retainThreadScopedRecord(state.messageByThreadId, nextThreadIds),
    leafIdByThreadId: retainThreadScopedRecord(state.leafIdByThreadId ?? {}, nextThreadIds),
    entryIdsByThreadId: retainThreadScopedRecord(state.entryIdsByThreadId ?? {}, nextThreadIds),
    entryByThreadId: retainThreadScopedRecord(state.entryByThreadId ?? {}, nextThreadIds),
    activityIdsByThreadId: retainThreadScopedRecord(state.activityIdsByThreadId, nextThreadIds),
    activityByThreadId: retainThreadScopedRecord(state.activityByThreadId, nextThreadIds),
    proposedPlanIdsByThreadId: retainThreadScopedRecord(
      state.proposedPlanIdsByThreadId,
      nextThreadIds,
    ),
    proposedPlanByThreadId: retainThreadScopedRecord(state.proposedPlanByThreadId, nextThreadIds),
    turnDiffIdsByThreadId: retainThreadScopedRecord(state.turnDiffIdsByThreadId, nextThreadIds),
    turnDiffSummaryByThreadId: retainThreadScopedRecord(
      state.turnDiffSummaryByThreadId,
      nextThreadIds,
    ),
    snapshotSource: source,
    bootstrapComplete: source === "server",
  };

  for (const thread of snapshot.threads) {
    nextState = writeThreadShellState(nextState, mapThreadShell(thread, environmentId), {
      shell: state.threadShellById[thread.id],
      session: state.threadSessionById[thread.id] ?? null,
      turnState: state.threadTurnStateById[thread.id],
      summary: state.sidebarThreadSummaryById[thread.id],
    });
  }

  if (source === "server" && previousSnapshotSource === "cache" && previousThreadIds.length > 0) {
    nextState = {
      ...nextState,
      threadIds: mergePreservingOrder(previousThreadIds, nextState.threadIds),
      threadIdsByProjectId: mergeThreadIdsByProjectId(
        previousThreadIdsByProjectId,
        nextState.threadIdsByProjectId,
      ),
      projectlessThreadIds: mergePreservingOrder(
        previousProjectlessThreadIds,
        nextState.projectlessThreadIds,
      ),
    };
  }

  return nextState;
}

export function applyShellSnapshot(
  state: EnvironmentState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): EnvironmentState {
  return applyShellSnapshotWithSource(state, snapshot, environmentId, "server");
}

export function syncServerShellSnapshot(
  state: AppState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyShellSnapshot(getStoredEnvironmentState(state, environmentId), snapshot, environmentId),
  );
}

export function syncCachedShellSnapshot(
  state: AppState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): AppState {
  const environmentState = getStoredEnvironmentState(state, environmentId);
  if (environmentState.snapshotSource === "server") {
    return state;
  }

  return commitEnvironmentState(
    state,
    environmentId,
    applyShellSnapshotWithSource(environmentState, snapshot, environmentId, "cache"),
  );
}

export function syncServerThreadDetail(
  state: AppState,
  thread: OrchestrationThread,
  environmentId: EnvironmentId,
): AppState {
  const environmentState = getStoredEnvironmentState(state, environmentId);
  const previousThread = getThreadFromEnvironmentState(environmentState, thread.id);
  const nextEnvironmentState = writeThreadState(
    clearLiveAssistantTurnsForThread(environmentState, thread.id),
    mapThread(thread, environmentId),
    previousThread,
  );
  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

export function applyThreadDetailEvent(
  state: EnvironmentState,
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): EnvironmentState {
  switch (event.type) {
    case "project.created": {
      const nextProject = mapProject(
        {
          id: event.payload.projectId,
          title: event.payload.title,
          projectRoot: event.payload.projectRoot,
          repositoryIdentity: event.payload.repositoryIdentity ?? null,
          defaultModelSelection: event.payload.defaultModelSelection,
          scripts: event.payload.scripts,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          deletedAt: null,
        },
        environmentId,
      );
      const existingProjectId =
        state.projectIds.find(
          (projectId) =>
            projectId === event.payload.projectId ||
            state.projectById[projectId]?.cwd === event.payload.projectRoot,
        ) ?? null;
      let projectById = state.projectById;
      let projectIds = state.projectIds;

      if (existingProjectId !== null && existingProjectId !== nextProject.id) {
        const { [existingProjectId]: _removedProject, ...restProjectById } = state.projectById;
        projectById = {
          ...restProjectById,
          [nextProject.id]: nextProject,
        };
        projectIds = state.projectIds.map((projectId) =>
          projectId === existingProjectId ? nextProject.id : projectId,
        );
      } else {
        projectById = {
          ...state.projectById,
          [nextProject.id]: nextProject,
        };
        projectIds =
          existingProjectId === null && !state.projectIds.includes(nextProject.id)
            ? [...state.projectIds, nextProject.id]
            : state.projectIds;
      }

      return {
        ...state,
        projectById,
        projectIds,
      };
    }

    case "project.meta-updated": {
      const project = state.projectById[event.payload.projectId];
      if (!project) {
        return state;
      }
      const nextProject: Project = {
        ...project,
        ...(event.payload.title !== undefined ? { name: event.payload.title } : {}),
        ...(event.payload.projectRoot !== undefined ? { cwd: event.payload.projectRoot } : {}),
        ...(event.payload.repositoryIdentity !== undefined
          ? { repositoryIdentity: event.payload.repositoryIdentity ?? null }
          : {}),
        ...(event.payload.defaultModelSelection !== undefined
          ? {
              defaultModelSelection: event.payload.defaultModelSelection
                ? normalizeModelSelection(event.payload.defaultModelSelection)
                : null,
            }
          : {}),
        ...(event.payload.scripts !== undefined
          ? { scripts: mapProjectScripts(event.payload.scripts) }
          : {}),
        updatedAt: event.payload.updatedAt,
      };
      return {
        ...state,
        projectById: {
          ...state.projectById,
          [event.payload.projectId]: nextProject,
        },
      };
    }

    case "project.deleted": {
      if (!state.projectById[event.payload.projectId]) {
        return state;
      }
      const { [event.payload.projectId]: _removedProject, ...projectById } = state.projectById;
      return {
        ...state,
        projectById,
        projectIds: removeId(state.projectIds, event.payload.projectId),
      };
    }

    case "thread.created": {
      const previousThread = getThreadFromEnvironmentState(state, event.payload.threadId);
      const nextThread = mapThread(
        {
          id: event.payload.threadId,
          projectId: event.payload.projectId,
          title: event.payload.title,
          modelSelection: event.payload.modelSelection,
          runtimeMode: event.payload.runtimeMode,
          interactionMode: event.payload.interactionMode,
          branch: event.payload.branch,
          worktreePath: event.payload.worktreePath,
          latestTurn: null,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          archivedAt: null,
          deletedAt: null,
          messages: [],
          leafId: null,
          entries: [],
          proposedPlans: [],
          activities: [],
          session: null,
        },
        environmentId,
      );
      return writeThreadState(state, nextThread, previousThread);
    }

    case "thread.deleted":
      return removeThreadState(state, event.payload.threadId);

    case "thread.archived":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        archivedAt: event.payload.archivedAt,
      }));

    case "thread.unarchived":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        archivedAt: null,
      }));

    case "thread.meta-updated":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
        ...(event.payload.worktreePath !== undefined
          ? { worktreePath: event.payload.worktreePath }
          : {}),
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.runtime-mode-set":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        runtimeMode: event.payload.runtimeMode,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.interaction-mode-set":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        interactionMode: event.payload.interactionMode,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.turn-start-requested":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        runtimeMode: event.payload.runtimeMode,
        interactionMode: event.payload.interactionMode,
        pendingSourceProposedPlan: event.payload.sourceProposedPlan,
        updatedAt: event.occurredAt,
      }));

    case "thread.turn-interrupt-requested": {
      const currentThread = getThreadFromEnvironmentState(state, event.payload.threadId);
      const interruptTurnId =
        event.payload.turnId ??
        (currentThread?.session?.orchestrationStatus === "running"
          ? currentThread.session.activeTurnId
          : undefined) ??
        (currentThread?.latestTurn?.state === "running"
          ? currentThread.latestTurn.turnId
          : undefined);
      const interruptedState =
        interruptTurnId === undefined
          ? state
          : clearLiveAssistantTurn(state, event.payload.threadId, interruptTurnId);
      return updateThreadState(interruptedState, event.payload.threadId, (thread) => {
        if (interruptTurnId === undefined) {
          return thread;
        }

        const latestTurn = thread.latestTurn;
        const messages = thread.messages.map((message) =>
          message.role === "assistant" && message.turnId === interruptTurnId && message.streaming
            ? {
                ...message,
                streaming: false,
                completedAt: message.completedAt ?? event.payload.createdAt,
              }
            : message,
        );
        const messagesChanged = messages.some(
          (message, index) => message !== thread.messages[index],
        );
        if (latestTurn === null || latestTurn.turnId !== interruptTurnId) {
          if (!messagesChanged) {
            return thread;
          }
          return {
            ...thread,
            messages,
            updatedAt: event.occurredAt,
          };
        }
        const completedAt = latestTurn.completedAt ?? event.payload.createdAt;
        const nextLatestTurn = buildLatestTurn({
          previous: latestTurn,
          turnId: interruptTurnId,
          state: "interrupted",
          requestedAt: latestTurn.requestedAt,
          startedAt: latestTurn.startedAt ?? event.payload.createdAt,
          completedAt,
          assistantMessageId: latestTurn.assistantMessageId,
        });
        return {
          ...thread,
          messages,
          latestTurn: nextLatestTurn,
          updatedAt: event.occurredAt,
        };
      });
    }

    case "thread.message-sent":
      return updateThreadState(
        event.payload.role === "assistant" && event.payload.turnId !== null
          ? clearLiveAssistantTurn(state, event.payload.threadId, event.payload.turnId)
          : state,
        event.payload.threadId,
        (thread) => {
          const message = mapMessage(thread.environmentId, {
            id: event.payload.messageId,
            role: event.payload.role,
            text: event.payload.text,
            ...(event.payload.richText !== undefined ? { richText: event.payload.richText } : {}),
            ...(event.payload.attachments !== undefined
              ? { attachments: event.payload.attachments }
              : {}),
            turnId: event.payload.turnId,
            streaming: event.payload.streaming,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          const existingMessage = thread.messages.find((entry) => entry.id === message.id);
          const messages = existingMessage
            ? thread.messages.map((entry) =>
                entry.id !== message.id
                  ? entry
                  : {
                      ...entry,
                      text: message.text.length > 0 ? message.text : entry.text,
                      streaming: message.streaming,
                      ...(message.turnId !== undefined
                        ? {
                            turnId:
                              message.turnId === null &&
                              entry.turnId !== null &&
                              entry.turnId !== undefined
                                ? entry.turnId
                                : message.turnId,
                          }
                        : {}),
                      ...(message.richText !== undefined ? { richText: message.richText } : {}),
                      ...(message.streaming
                        ? entry.completedAt !== undefined
                          ? { completedAt: entry.completedAt }
                          : {}
                        : message.completedAt !== undefined
                          ? { completedAt: message.completedAt }
                          : {}),
                      ...(message.attachments !== undefined
                        ? { attachments: message.attachments }
                        : {}),
                    },
              )
            : [...thread.messages, message];
          const turnDiffSummaries =
            event.payload.role === "assistant" && event.payload.turnId !== null
              ? rebindTurnDiffSummariesForAssistantMessage(
                  thread.turnDiffSummaries,
                  event.payload.turnId,
                  event.payload.messageId,
                )
              : thread.turnDiffSummaries;
          const entryId = event.payload.entryId;
          const threadEntries = thread.entries;
          const existingEntry = threadEntries.find((entry) => entry.id === entryId);
          const nextEntryTurnId =
            event.payload.turnId === null &&
            existingEntry?.turnId !== null &&
            existingEntry?.turnId !== undefined
              ? existingEntry.turnId
              : event.payload.turnId;
          // The event's parent is authoritative: a server echo corrects any
          // locally projected guess (optimistic tip or runtime session tree).
          const nextEntry: ThreadTreeEntry = {
            id: entryId,
            threadId: event.payload.threadId,
            parentEntryId: event.payload.parentEntryId,
            kind: "message",
            messageId: event.payload.messageId,
            turnId: nextEntryTurnId,
            createdAt: existingEntry?.createdAt ?? event.payload.createdAt,
          };
          const entries = existingEntry
            ? threadEntries.map((entry) => (entry.id === entryId ? nextEntry : entry))
            : [...threadEntries, nextEntry];
          const latestTurn: Thread["latestTurn"] =
            event.payload.role === "assistant" &&
            event.payload.turnId !== null &&
            (thread.latestTurn === null || thread.latestTurn.turnId === event.payload.turnId)
              ? buildLatestTurn({
                  previous: thread.latestTurn,
                  turnId: event.payload.turnId,
                  state:
                    thread.latestTurn?.state === "interrupted"
                      ? "interrupted"
                      : thread.latestTurn?.state === "error"
                        ? "error"
                        : "completed",
                  requestedAt:
                    thread.latestTurn?.turnId === event.payload.turnId
                      ? thread.latestTurn.requestedAt
                      : event.payload.createdAt,
                  startedAt:
                    thread.latestTurn?.turnId === event.payload.turnId
                      ? (thread.latestTurn.startedAt ?? event.payload.createdAt)
                      : event.payload.createdAt,
                  sourceProposedPlan: thread.pendingSourceProposedPlan,
                  completedAt: event.payload.updatedAt,
                  assistantMessageId: event.payload.messageId,
                })
              : thread.latestTurn;
          return {
            ...thread,
            messages,
            leafId: resolveLeafIdAfterThreadMessage({
              leafId: thread.leafId,
              entryId,
              parentEntryId: event.payload.parentEntryId,
              role: event.payload.role,
            }),
            entries,
            turnDiffSummaries,
            latestTurn,
            updatedAt: event.occurredAt,
          };
        },
      );

    case "thread.tree-leaf-moved":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        leafId: event.payload.leafId,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.session-set":
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const session = event.payload.session;
        const settledLatestTurn =
          session.activeTurnId !== null && thread.latestTurn?.turnId === session.activeTurnId
            ? settledLatestTurnForRunningSession(thread.latestTurn)
            : null;
        return {
          ...thread,
          session: mapSession(session),
          error: sanitizeThreadErrorMessage(session.lastError),
          latestTurn:
            session.status === "running" && session.activeTurnId !== null
              ? (settledLatestTurn ??
                buildLatestTurn({
                  previous: thread.latestTurn,
                  turnId: session.activeTurnId,
                  state: "running",
                  requestedAt:
                    thread.latestTurn?.turnId === session.activeTurnId
                      ? thread.latestTurn.requestedAt
                      : session.updatedAt,
                  startedAt:
                    thread.latestTurn?.turnId === session.activeTurnId
                      ? (thread.latestTurn.startedAt ?? session.updatedAt)
                      : session.updatedAt,
                  completedAt: null,
                  assistantMessageId:
                    thread.latestTurn?.turnId === session.activeTurnId
                      ? thread.latestTurn.assistantMessageId
                      : null,
                  sourceProposedPlan: thread.pendingSourceProposedPlan,
                }))
              : thread.latestTurn,
          updatedAt: event.occurredAt,
        };
      });

    case "thread.session-stop-requested":
      return updateThreadState(state, event.payload.threadId, (thread) =>
        thread.session === null
          ? thread
          : {
              ...thread,
              session: {
                ...thread.session,
                status: "closed",
                orchestrationStatus: "stopped",
                activeTurnId: undefined,
                updatedAt: event.payload.createdAt,
              },
              updatedAt: event.occurredAt,
            },
      );

    case "thread.proposed-plan-upserted":
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const proposedPlan = mapProposedPlan(event.payload.proposedPlan);
        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== proposedPlan.id),
          proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-MAX_THREAD_PROPOSED_PLANS);
        return {
          ...thread,
          proposedPlans,
          updatedAt: event.occurredAt,
        };
      });

    case "thread.activity-appended":
      if (isSubagentActivity(event.payload.activity)) {
        return state;
      }
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const activities = upsertThreadActivities(thread.activities, [
          { ...event.payload.activity },
        ]);
        return {
          ...thread,
          activities,
          updatedAt: event.occurredAt,
        };
      });

    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
      return state;
  }

  return state;
}

export function applyShellEventToEnvironment(
  state: EnvironmentState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): EnvironmentState {
  switch (event.kind) {
    case "project-upserted": {
      const nextProject = mapProject(event.project, environmentId);
      const existingProjectId =
        state.projectIds.find(
          (projectId) =>
            projectId === event.project.id ||
            state.projectById[projectId]?.cwd === event.project.projectRoot,
        ) ?? null;
      let projectById = state.projectById;
      let projectIds = state.projectIds;

      if (existingProjectId !== null && existingProjectId !== nextProject.id) {
        const { [existingProjectId]: _removedProject, ...restProjectById } = state.projectById;
        projectById = {
          ...restProjectById,
          [nextProject.id]: nextProject,
        };
        projectIds = state.projectIds.map((projectId) =>
          projectId === existingProjectId ? nextProject.id : projectId,
        );
      } else {
        projectById = {
          ...state.projectById,
          [nextProject.id]: nextProject,
        };
        projectIds =
          existingProjectId === null && !state.projectIds.includes(nextProject.id)
            ? [...state.projectIds, nextProject.id]
            : state.projectIds;
      }

      return {
        ...state,
        projectById,
        projectIds,
      };
    }
    case "project-removed": {
      if (!state.projectById[event.projectId]) {
        return state;
      }
      const { [event.projectId]: _removedProject, ...projectById } = state.projectById;
      return {
        ...state,
        projectById,
        projectIds: removeId(state.projectIds, event.projectId),
      };
    }
    case "thread-upserted":
      return writeThreadShellState(state, mapThreadShell(event.thread, environmentId));
    case "thread-removed":
      return removeThreadState(state, event.threadId);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

const isThreadTokenUsageSnapshot = Schema.is(ThreadTokenUsageSnapshot);

function contextWindowActivityForRuntimeEvent(
  event: AgentRuntimeEvent,
): OrchestrationThreadActivity | null {
  if (event.type !== "context-window.updated" || !isThreadTokenUsageSnapshot(event.data)) {
    return null;
  }
  // Mirror runtimeContextWindowActivities in @honk/runtime so the persisted copy
  // replaces this live one instead of duplicating it.
  return {
    id: EventId.make(`runtime-activity:${event.id}`),
    tone: "info",
    kind: "context-window.updated",
    summary: event.summary ?? "Context usage updated",
    payload: event.data,
    turnId: event.turnId ?? null,
    createdAt: event.createdAt,
  };
}

function applyAgentRuntimeEventToEnvironment(
  state: EnvironmentState,
  event: AgentRuntimeEvent,
): EnvironmentState {
  switch (event.type) {
    case "message.started":
    case "message.updated":
    case "message.completed":
      return state;

    case "tool.started":
    case "tool.updated":
    case "tool.completed":
      return state;

    case "context-window.updated":
      return updateThreadState(state, event.threadId, (thread) => {
        const activity = contextWindowActivityForRuntimeEvent(event);
        if (!activity) {
          return thread;
        }
        return {
          ...thread,
          activities: upsertThreadActivities(thread.activities, [activity]),
        };
      });

    case "session.started":
    case "session.ready":
      return updateThreadState(state, event.threadId, (thread) => {
        const now = event.createdAt;
        const session: ThreadSession = {
          status: "ready",
          orchestrationStatus: "ready",
          createdAt: thread.session?.createdAt ?? now,
          updatedAt: now,
        };
        return {
          ...thread,
          session,
          error: null,
          updatedAt: now,
        };
      });

    case "agent.started":
      return updateThreadState(state, event.threadId, (thread) => {
        const now = event.createdAt;
        const session: ThreadSession = {
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: thread.session?.activeTurnId,
          createdAt: thread.session?.createdAt ?? now,
          updatedAt: now,
        };
        return {
          ...thread,
          session,
          error: null,
          updatedAt: now,
        };
      });

    case "agent.completed":
      return updateThreadState(state, event.threadId, (thread) => {
        const now = event.createdAt;
        const session: ThreadSession = {
          status: "ready",
          orchestrationStatus: "ready",
          createdAt: thread.session?.createdAt ?? now,
          updatedAt: now,
        };
        return {
          ...thread,
          session,
          error: null,
          updatedAt: now,
        };
      });

    case "turn.started": {
      const startedTurnId = event.turnId;
      if (!startedTurnId) {
        return state;
      }
      return updateThreadState(state, event.threadId, (thread) => {
        const now = event.createdAt;
        const latestTurn = thread.latestTurn;
        const pendingUserTurnStart = bindNextPendingUserTurnStart(thread, startedTurnId);
        const session: ThreadSession = {
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: startedTurnId,
          createdAt: thread.session?.createdAt ?? now,
          updatedAt: now,
        };
        return {
          ...thread,
          messages: pendingUserTurnStart.messages,
          entries: pendingUserTurnStart.entries,
          session,
          latestTurn: buildLatestTurn({
            previous: latestTurn,
            turnId: startedTurnId,
            state: "running",
            requestedAt:
              latestTurn?.turnId === startedTurnId
                ? latestTurn.requestedAt
                : (pendingUserTurnStart.requestedAt ?? now),
            startedAt: now,
            completedAt: null,
            assistantMessageId:
              latestTurn?.turnId === startedTurnId ? latestTurn.assistantMessageId : null,
            sourceProposedPlan:
              agentRuntimeSourceProposedPlanData(event.data) ?? thread.pendingSourceProposedPlan,
          }),
          pendingSourceProposedPlan: undefined,
          error: null,
          updatedAt: now,
        };
      });
    }

    case "turn.interrupted": {
      const interruptedTurnId = event.turnId;
      if (!interruptedTurnId) {
        return state;
      }
      const clearedState = clearLiveAssistantTurn(state, event.threadId, interruptedTurnId);
      return updateThreadState(clearedState, event.threadId, (thread) => {
        const now = event.createdAt;
        const latestTurn = thread.latestTurn;
        const session: ThreadSession = {
          status: "ready",
          orchestrationStatus: "ready",
          createdAt: thread.session?.createdAt ?? now,
          updatedAt: now,
        };
        return {
          ...thread,
          session,
          latestTurn: buildLatestTurn({
            previous: latestTurn,
            turnId: interruptedTurnId,
            state: "interrupted",
            requestedAt: latestTurn?.turnId === interruptedTurnId ? latestTurn.requestedAt : now,
            startedAt:
              latestTurn?.turnId === interruptedTurnId ? (latestTurn.startedAt ?? now) : now,
            completedAt: now,
            assistantMessageId:
              latestTurn?.turnId === interruptedTurnId ? latestTurn.assistantMessageId : null,
            sourceProposedPlan: thread.pendingSourceProposedPlan,
          }),
          error: null,
          updatedAt: now,
        };
      });
    }

    case "turn.completed": {
      const completedTurnId = event.turnId;
      if (!completedTurnId) {
        return state;
      }
      return updateThreadState(state, event.threadId, (thread) => {
        const now = event.createdAt;
        const latestTurn = thread.latestTurn;
        const preservesTerminalState =
          latestTurn?.turnId === completedTurnId &&
          (latestTurn.state === "interrupted" || latestTurn.state === "error");
        const agentStillRunning =
          event.agentRuntime === "pi" && thread.session?.orchestrationStatus === "running";
        const activeTurnId =
          agentStillRunning && thread.session?.activeTurnId !== completedTurnId
            ? thread.session?.activeTurnId
            : undefined;
        const session: ThreadSession = {
          status: agentStillRunning ? "running" : "ready",
          orchestrationStatus: agentStillRunning ? "running" : "ready",
          ...(activeTurnId ? { activeTurnId } : {}),
          createdAt: thread.session?.createdAt ?? now,
          updatedAt: now,
        };
        return {
          ...thread,
          session,
          latestTurn: buildLatestTurn({
            previous: latestTurn,
            turnId: completedTurnId,
            state: preservesTerminalState ? latestTurn.state : "completed",
            requestedAt: latestTurn?.turnId === completedTurnId ? latestTurn.requestedAt : now,
            startedAt: latestTurn?.turnId === completedTurnId ? (latestTurn.startedAt ?? now) : now,
            completedAt: preservesTerminalState ? (latestTurn.completedAt ?? now) : now,
            assistantMessageId:
              latestTurn?.turnId === completedTurnId ? latestTurn.assistantMessageId : null,
            sourceProposedPlan: thread.pendingSourceProposedPlan,
          }),
          updatedAt: now,
        };
      });
    }

    case "turn.proposed.completed": {
      const planData = agentRuntimeProposedPlanData(event.data);
      if (!planData) {
        return state;
      }
      return updateThreadState(state, event.threadId, (thread) => {
        const existingPlan = thread.proposedPlans.find((entry) => entry.id === planData.planId);
        const proposedPlan: ProposedPlan = {
          id: planData.planId,
          turnId: event.turnId ?? null,
          planMarkdown: `${planData.planMarkdown.trim()}\n`,
          implementedAt: existingPlan?.implementedAt ?? null,
          implementationThreadId: existingPlan?.implementationThreadId ?? null,
          createdAt: existingPlan?.createdAt ?? event.createdAt,
          updatedAt: event.createdAt,
        };
        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== proposedPlan.id),
          proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-MAX_THREAD_PROPOSED_PLANS);
        return {
          ...thread,
          proposedPlans,
          updatedAt: event.createdAt,
        };
      });
    }

    case "runtime.error":
      return updateThreadState(state, event.threadId, (thread) => {
        const now = event.createdAt;
        const turnId = event.turnId ?? thread.session?.activeTurnId ?? thread.latestTurn?.turnId;
        const session: ThreadSession = {
          status: "error",
          orchestrationStatus: "error",
          createdAt: thread.session?.createdAt ?? now,
          updatedAt: now,
          lastError: event.summary ?? event.text ?? "Runtime error",
        };
        return {
          ...thread,
          session,
          ...(turnId
            ? {
                latestTurn: buildLatestTurn({
                  previous: thread.latestTurn,
                  turnId,
                  state: "error",
                  requestedAt:
                    thread.latestTurn?.turnId === turnId ? thread.latestTurn.requestedAt : now,
                  startedAt:
                    thread.latestTurn?.turnId === turnId
                      ? (thread.latestTurn.startedAt ?? now)
                      : now,
                  completedAt: now,
                  assistantMessageId:
                    thread.latestTurn?.turnId === turnId
                      ? thread.latestTurn.assistantMessageId
                      : null,
                  sourceProposedPlan: thread.pendingSourceProposedPlan,
                }),
              }
            : {}),
          error: sanitizeThreadErrorMessage(session.lastError),
          updatedAt: now,
        };
      });

    default:
      return state;
  }
}

export function applyOrchestrationEvents(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
): AppState {
  if (events.length === 0) {
    return state;
  }
  const currentEnvironmentState = getStoredEnvironmentState(state, environmentId);
  const nextEnvironmentState = events.reduce(
    (nextState, event) => applyThreadDetailEvent(nextState, event, environmentId),
    currentEnvironmentState,
  );
  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

export function applyAgentRuntimeEvent(
  state: AppState,
  event: AgentRuntimeEvent,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyAgentRuntimeEventToEnvironment(getStoredEnvironmentState(state, environmentId), event),
  );
}

export function syncPendingExtensionUiRequests(
  state: AppState,
  requests: ReadonlyArray<DesktopExtensionUiRequest>,
  environmentId: EnvironmentId,
): AppState {
  const currentEnvironmentState = getStoredEnvironmentState(state, environmentId);
  const threadIds = new Set<ThreadId>();
  for (const request of requests) {
    threadIds.add(request.threadId);
  }
  for (const [threadId, activitiesById] of Object.entries(
    currentEnvironmentState.activityByThreadId,
  )) {
    const hasPendingExtensionUi = Object.values(activitiesById).some(
      (activity) => activity.kind === "extension-ui.requested",
    );
    if (hasPendingExtensionUi) {
      threadIds.add(threadId as ThreadId);
    }
  }
  if (threadIds.size === 0) {
    return state;
  }
  let nextEnvironmentState = currentEnvironmentState;
  for (const threadId of threadIds) {
    nextEnvironmentState = syncPendingExtensionUiRequestsForThread(
      nextEnvironmentState,
      threadId,
      requests.filter((request) => request.threadId === threadId),
    );
  }
  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

export function applyRuntimeSessionTreeProjection(
  state: AppState,
  tree: SessionTreeProjection,
  environmentId: EnvironmentId,
): AppState {
  const currentEnvironmentState = getStoredEnvironmentState(state, environmentId);
  const previousThread = getThreadFromEnvironmentState(currentEnvironmentState, tree.threadId);
  const nextThread = threadFromRuntimeSessionTree(tree, environmentId, previousThread);
  const nextEnvironmentState = writeThreadShellState(
    writeThreadState(currentEnvironmentState, nextThread, previousThread),
    {
      shell: toThreadShell(nextThread),
      session: nextThread.session,
      turnState: toThreadTurnState(nextThread),
      summary: sidebarThreadSummaryFromThread(
        nextThread,
        currentEnvironmentState.sidebarThreadSummaryById[nextThread.id],
      ),
    },
  );
  return commitEnvironmentState(state, environmentId, {
    ...nextEnvironmentState,
    snapshotSource: "server",
    bootstrapComplete: true,
  });
}

export function clearAgentRuntimeThreadSession(
  state: AppState,
  threadId: ThreadId,
  environmentId: EnvironmentId,
): AppState {
  const currentEnvironmentState = getStoredEnvironmentState(state, environmentId);
  const currentThread = getThreadFromEnvironmentState(currentEnvironmentState, threadId);
  if (!currentThread?.session) {
    return state;
  }

  const now = new Date().toISOString();
  const latestTurn =
    currentThread.latestTurn && currentThread.latestTurn.completedAt === null
      ? buildLatestTurn({
          previous: currentThread.latestTurn,
          turnId: currentThread.latestTurn.turnId,
          state: "interrupted",
          requestedAt: currentThread.latestTurn.requestedAt,
          startedAt: currentThread.latestTurn.startedAt ?? now,
          completedAt: now,
          assistantMessageId: currentThread.latestTurn.assistantMessageId,
          sourceProposedPlan: currentThread.pendingSourceProposedPlan,
        })
      : currentThread.latestTurn;
  const nextThread: Thread = {
    ...currentThread,
    session: {
      ...currentThread.session,
      status: "closed",
      orchestrationStatus: "stopped",
      activeTurnId: undefined,
      updatedAt: now,
    },
    latestTurn,
    error: null,
    updatedAt: now,
  };
  const nextEnvironmentState = writeThreadState(
    clearLiveAssistantTurnsForThread(currentEnvironmentState, threadId),
    nextThread,
    currentThread,
  );
  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

export function clearUnconfirmedLocalTurnStart(
  state: AppState,
  input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
  },
): AppState {
  return commitEnvironmentState(
    state,
    input.environmentId,
    clearUnconfirmedLocalTurnStartInEnvironment(
      getStoredEnvironmentState(state, input.environmentId),
      input,
    ),
  );
}

export function clearUnconfirmedLocalThread(
  state: AppState,
  input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  },
): AppState {
  return commitEnvironmentState(
    state,
    input.environmentId,
    clearUnconfirmedLocalThreadInEnvironment(
      getStoredEnvironmentState(state, input.environmentId),
      input.threadId,
    ),
  );
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  if (state.activeEnvironmentId === null) {
    return state;
  }

  const nextEnvironmentState = updateThreadState(
    getStoredEnvironmentState(state, state.activeEnvironmentId),
    threadId,
    (thread) => {
      if (thread.error === error) return thread;
      return { ...thread, error };
    },
  );
  return commitEnvironmentState(state, state.activeEnvironmentId, nextEnvironmentState);
}

export function applyOrchestrationEvent(
  state: AppState,
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyThreadDetailEvent(getStoredEnvironmentState(state, environmentId), event, environmentId),
  );
}

export function applyShellEvent(
  state: AppState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyShellEventToEnvironment(
      getStoredEnvironmentState(state, environmentId),
      event,
      environmentId,
    ),
  );
}

export function setActiveEnvironmentId(state: AppState, environmentId: EnvironmentId): AppState {
  if (state.activeEnvironmentId === environmentId) {
    return state;
  }

  return {
    ...state,
    activeEnvironmentId: environmentId,
  };
}

export function setThreadBranch(
  state: AppState,
  threadRef: ScopedThreadRef,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const nextEnvironmentState = updateThreadState(
    getStoredEnvironmentState(state, threadRef.environmentId),
    threadRef.threadId,
    (thread) => {
      if (thread.branch === branch && thread.worktreePath === worktreePath) return thread;
      const cwdChanged = thread.worktreePath !== worktreePath;
      return {
        ...thread,
        branch,
        worktreePath,
        ...(cwdChanged ? { session: null } : {}),
      };
    },
  );
  return commitEnvironmentState(state, threadRef.environmentId, nextEnvironmentState);
}
