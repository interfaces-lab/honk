import {
  EntryId as CoreApiEntryId,
  MessageId as CoreApiMessageId,
  ModelId as CoreApiModelId,
  PlanId as CoreApiPlanId,
  ProjectId as CoreApiProjectId,
  QuestionId as CoreApiQuestionId,
  ThreadId as CoreApiThreadId,
  TurnId as CoreApiTurnId,
  type AdmissionReceipt,
  type SendMessageInput,
} from "@honk/api/core/v1";
import { DEFAULT_AGENT_INTERACTION_MODE } from "@honk/shared/interaction-mode";
import { DEFAULT_PROJECTLESS_CWD } from "@honk/shared/project";
import type { EnvironmentApi } from "~/desktop-bridge";
import {
  EventId,
  MessageId,
  RuntimeTaskId,
  ThreadEntryId,
  TurnId,
  type ThreadEntryId as AppThreadEntryId,
  type TurnId as AppTurnId,
} from "@honk/shared/base-schemas";
import type { ToolLifecycleItemType } from "@honk/shared/runtime-events";
import {
  DEFAULT_RUNTIME_MODE,
  type OrchestrationReplayEventsResult,
  type OrchestrationSessionStatus,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationThreadStreamItem,
  type RuntimeMode,
} from "@honk/shared/orchestration";
import {
  ProjectId as ProjectIdSchema,
  ThreadId,
  type ProjectId,
  type ThreadId as AppThreadId,
} from "@honk/shared/base-schemas";
import type { EnvironmentId } from "@honk/shared/environment";
import type { ModelSelection } from "@honk/shared/model";
import {
  parsePromptTokens,
  type PromptToken,
  type ThreadState,
  type WorkspaceState,
  type WorkspaceWatchHandlers,
} from "@honk/sdk";
import type { QueryClient } from "@tanstack/react-query";

import {
  getKnownEnvironmentHttpBaseUrl,
  scopedThreadKey,
  scopeThreadRef,
} from "~/lib/environment-scope";
import { setLocalServerApiOverride } from "~/local-api";
import { applyServerConfigEvent, setServerConfigSnapshot } from "~/rpc/server-state";
import type {
  ChatAttachment,
  ChatMessage,
  ProposedPlan,
  Thread,
  ThreadSession,
  ThreadTreeEntry,
  TurnDiffSummary,
} from "~/types";
import {
  createCoreEnvironmentConnection,
  type CoreEnvironmentConnection,
} from "./connection";
import {
  createUnavailableCoreAuxServerApi,
  DESKTOP_AUX_UNAVAILABLE_ERROR,
  type CoreAuxClient,
  type CoreAuxProjectEvent,
} from "./aux";
import { createCoreTerminalApi } from "./terminal";
import { getPrimaryKnownEnvironment } from "../primary";
import { markPromotedDraftThreadsByRef } from "~/stores/chat-drafts";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "~/stores/thread-store";
import {
  syncCoreThreadDetail,
  syncServerShellSnapshot,
  applyShellEvent,
  applyOrchestrationEvent,
} from "~/stores/thread-sync";
import { useUiStateStore } from "~/stores/ui-state-store";
import { deriveSidebarProjectStateKey, getProjectOrderKey } from "~/stores/project-identity";

type CorePart = ThreadState["parts"][number];
type CoreMessage = ThreadState["messages"][number];
type CoreThreadEntry = ThreadState["entries"][number];
type CoreThreadSummary = WorkspaceState["threads"][number];
type CoreToolPart = Extract<CorePart, { readonly _tag: "tool" }>;
type CoreQuestionPart = Extract<CorePart, { readonly _tag: "question" }>;
type CorePatchPart = Extract<CorePart, { readonly _tag: "patch" }>;
type CorePlanPart = Extract<CorePart, { readonly _tag: "plan" }>;
type CoreDispatchCommand = Parameters<EnvironmentApi["orchestration"]["dispatchCommand"]>[0];
type CoreDispatchResult = Awaited<ReturnType<EnvironmentApi["orchestration"]["dispatchCommand"]>>;
type CoreTurnStartCommand = Extract<CoreDispatchCommand, { readonly type: "thread.turn.start" }>;
type CoreThreadCreateCommand = Extract<CoreDispatchCommand, { readonly type: "thread.create" }>;
type CoreThreadDeleteCommand = Extract<CoreDispatchCommand, { readonly type: "thread.delete" }>;
type CoreThreadArchiveCommand = Extract<CoreDispatchCommand, { readonly type: "thread.archive" }>;
type CoreThreadUnarchiveCommand = Extract<
  CoreDispatchCommand,
  { readonly type: "thread.unarchive" }
>;
type CoreThreadMetaUpdateCommand = Extract<
  CoreDispatchCommand,
  { readonly type: "thread.meta.update" }
>;
type CoreThreadInteractionModeSetCommand = Extract<
  CoreDispatchCommand,
  { readonly type: "thread.interaction-mode.set" }
>;
type CoreTurnInterruptCommand = Extract<
  CoreDispatchCommand,
  { readonly type: "thread.turn.interrupt" }
>;
type CoreSessionStopCommand = Extract<
  CoreDispatchCommand,
  { readonly type: "thread.session.stop" }
>;
type CoreProjectCreateCommand = Extract<CoreDispatchCommand, { readonly type: "project.create" }>;
type CoreProjectMetaUpdateCommand = Extract<
  CoreDispatchCommand,
  { readonly type: "project.meta.update" }
>;
type CoreProjectDeleteCommand = Extract<CoreDispatchCommand, { readonly type: "project.delete" }>;
type CoreUserInputRespondCommand = Extract<
  CoreDispatchCommand,
  { readonly type: "thread.user-input.respond" }
>;

interface CoreEnvironmentServiceState {
  readonly queryClient: QueryClient;
  readonly shellUnsubscribe: () => void;
  refCount: number;
}

export interface CoreEnvironmentServiceConnection extends CoreEnvironmentConnection {
  readonly client: EnvironmentApi;
}

const CORE_NOT_IMPLEMENTED_ERROR = "not implemented in slice 1";

const coreEnvironmentConnections = new Map<EnvironmentId, CoreEnvironmentServiceConnection>();
const coreEnvironmentConnectionListeners = new Set<() => void>();
let activeService: CoreEnvironmentServiceState | null = null;

const NOOP: () => void = () => undefined;

function emitCoreEnvironmentConnectionRegistryChange(): void {
  for (const listener of coreEnvironmentConnectionListeners) {
    listener();
  }
}

function syncProjectUiFromCoreEnvironment(): void {
  const projects = selectProjectsAcrossEnvironments(useStore.getState());
  useUiStateStore.getState().syncProjects(
    projects.map((project) => ({
      key: getProjectOrderKey(project),
      logicalKey: deriveSidebarProjectStateKey(project),
      cwd: project.cwd,
    })),
  );
}

function syncThreadUiFromCoreEnvironment(): void {
  const threads = selectThreadsAcrossEnvironments(useStore.getState());
  useUiStateStore.getState().syncThreads(
    threads.map((thread) => ({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      seedVisitedAt: thread.updatedAt ?? thread.createdAt,
    })),
  );
  markPromotedDraftThreadsByRef(
    threads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
  );
}

function notImplemented(): Promise<never> {
  return Promise.reject(new Error(CORE_NOT_IMPLEMENTED_ERROR));
}

function unavailableAux(): Error {
  return new Error(DESKTOP_AUX_UNAVAILABLE_ERROR);
}

function withCoreAux<TResult>(
  connection: CoreEnvironmentConnection,
  run: (aux: CoreAuxClient) => Promise<TResult>,
): Promise<TResult> {
  const aux = connection.aux();
  if (!aux) {
    return Promise.reject(unavailableAux());
  }
  return run(aux);
}

function subscribeCoreAux(
  connection: CoreEnvironmentConnection,
  run: (aux: CoreAuxClient) => () => void,
): () => void {
  const aux = connection.aux();
  if (!aux) {
    throw unavailableAux();
  }
  return run(aux);
}

function createCoreAuxGitApi(connection: CoreEnvironmentConnection): EnvironmentApi["git"] {
  return {
    pull: (input) => withCoreAux(connection, (aux) => aux.git.pull(input)),
    refreshStatus: (input) => withCoreAux(connection, (aux) => aux.git.refreshStatus(input)),
    onStatus: (input, callback, options) =>
      subscribeCoreAux(connection, (aux) => aux.git.onStatus(input, callback, options)),
    listBranches: (input) => withCoreAux(connection, (aux) => aux.git.listBranches(input)),
    createWorktree: (input) => withCoreAux(connection, (aux) => aux.git.createWorktree(input)),
    removeWorktree: (input) => withCoreAux(connection, (aux) => aux.git.removeWorktree(input)),
    createBranch: (input) => withCoreAux(connection, (aux) => aux.git.createBranch(input)),
    checkout: (input) => withCoreAux(connection, (aux) => aux.git.checkout(input)),
    init: (input) => withCoreAux(connection, (aux) => aux.git.init(input)),
    resolvePullRequest: (input) =>
      withCoreAux(connection, (aux) => aux.git.resolvePullRequest(input)),
    preparePullRequestThread: (input) =>
      withCoreAux(connection, (aux) => aux.git.preparePullRequestThread(input)),
    discardPaths: (input) => withCoreAux(connection, (aux) => aux.git.discardPaths(input)),
    getFilePatch: (input) => withCoreAux(connection, (aux) => aux.git.getFilePatch(input)),
    getFileImage: (input) => withCoreAux(connection, (aux) => aux.git.getFileImage(input)),
  };
}

function coreRuntimeModeCompatibilityGap(): RuntimeMode {
  return DEFAULT_RUNTIME_MODE;
}

function appThreadId(id: unknown): AppThreadId {
  return ThreadId.make(String(id));
}

function appThreadEntryId(id: unknown): AppThreadEntryId {
  return ThreadEntryId.make(String(id));
}

function appMessageId(id: unknown): MessageId {
  return MessageId.make(String(id));
}

function appTurnId(id: unknown): AppTurnId {
  return TurnId.make(String(id));
}

function coreThreadId(id: unknown): CoreApiThreadId {
  return CoreApiThreadId.make(String(id));
}

function coreEntryId(id: unknown): CoreApiEntryId {
  return CoreApiEntryId.make(String(id));
}

function coreMessageId(id: unknown): CoreApiMessageId {
  return CoreApiMessageId.make(String(id));
}

function coreTurnId(id: unknown): CoreApiTurnId {
  return CoreApiTurnId.make(String(id));
}

function corePlanId(id: unknown): CoreApiPlanId {
  return CoreApiPlanId.make(String(id));
}

function coreQuestionId(id: unknown): CoreApiQuestionId {
  return CoreApiQuestionId.make(String(id));
}

function coreProjectId(id: unknown): CoreApiProjectId {
  return CoreApiProjectId.make(String(id));
}

function coreModelId(id: unknown): CoreApiModelId {
  return CoreApiModelId.make(String(id));
}

function appProjectId(id: unknown): ProjectId {
  return ProjectIdSchema.make(String(id));
}

function optionalProjectId(id: CoreThreadSummary["projectId"]): ProjectId | null {
  return id === null ? null : appProjectId(id);
}

function optionalThreadEntryId(id: CoreThreadEntry["parentId"] | ThreadState["leafId"]): AppThreadEntryId | null {
  return id === null ? null : appThreadEntryId(id);
}

function optionalTurnId(id: CoreMessage["turnId"] | CorePart["turnId"]): AppTurnId | null {
  return id === null ? null : appTurnId(id);
}

function mapModelSelection(model: string): ModelSelection {
  const separatorIndex = model.indexOf("/");
  return {
    instanceId: separatorIndex > 0 ? model.slice(0, separatorIndex) : "core",
    model,
  };
}

function mapCoreStatusToOrchestrationStatus(
  status: CoreThreadSummary["status"],
): OrchestrationSessionStatus {
  switch (status) {
    case "running":
      return "running";
    case "failed":
      return "error";
    case "idle":
      return "ready";
  }
}

function mapCoreStatusToThreadSessionStatus(
  status: CoreThreadSummary["status"],
): ThreadSession["status"] {
  switch (status) {
    case "running":
      return "running";
    case "failed":
      return "error";
    case "idle":
      return "ready";
  }
}

function mapSessionFromSummary(
  summary: CoreThreadSummary,
  activeTurnId?: AppTurnId | undefined,
  lastError?: string | undefined,
): ThreadSession {
  const orchestrationStatus = mapCoreStatusToOrchestrationStatus(summary.status);
  return {
    status: mapCoreStatusToThreadSessionStatus(summary.status),
    orchestrationStatus,
    ...(activeTurnId ? { activeTurnId } : {}),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    ...(lastError ? { lastError } : {}),
  };
}

function workspaceUpdatedAt(state: WorkspaceState): string {
  return state.threads.reduce(
    (latest, thread) => (thread.updatedAt > latest ? thread.updatedAt : latest),
    new Date(0).toISOString(),
  );
}

function mapCoreThreadSummary(
  summary: CoreThreadSummary,
  environmentId: EnvironmentId,
): OrchestrationShellSnapshot["threads"][number] {
  const threadId = appThreadId(summary.id);
  const appSession = mapSessionFromSummary(summary);
  const session = {
    threadId,
    status: appSession.orchestrationStatus,
    runtimeMode: coreRuntimeModeCompatibilityGap(),
    activeTurnId: appSession.activeTurnId ?? null,
    lastError: appSession.lastError ?? null,
    updatedAt: appSession.updatedAt,
  };
  return {
    id: threadId,
    projectId: optionalProjectId(summary.projectId),
    title: summary.title,
    modelSelection: mapModelSelection(summary.model),
    runtimeMode: coreRuntimeModeCompatibilityGap(),
    interactionMode: DEFAULT_AGENT_INTERACTION_MODE,
    branch: summary.worktree?.branch ?? null,
    worktreePath: summary.worktree?.path ?? null,
    latestTurn: null,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    archivedAt: summary.archivedAt,
    session,
    latestUserMessageAt: summary.latestUserMessageAt,
    hasPendingApprovals: false,
    hasPendingUserInput: summary.needsAttention,
    hasActionableProposedPlan: false,
  };
}

function mapWorkspaceStateToShellSnapshot(
  state: WorkspaceState,
  environmentId: EnvironmentId,
  projects: OrchestrationShellSnapshot["projects"],
): OrchestrationShellSnapshot {
  return {
    snapshotSequence: state.seq,
    projects,
    threads: state.threads.map((thread) => mapCoreThreadSummary(thread, environmentId)),
    updatedAt: workspaceUpdatedAt(state),
  };
}

function mapWorkspaceEvent(
  event: Parameters<NonNullable<WorkspaceWatchHandlers["onEvent"]>>[0],
  environmentId: EnvironmentId,
): OrchestrationShellStreamEvent {
  switch (event._tag) {
    case "thread.updated":
      return {
        kind: "thread-upserted",
        sequence: event.seq,
        thread: mapCoreThreadSummary(event.summary, environmentId),
      };
    case "thread.removed":
      return {
        kind: "thread-removed",
        sequence: event.seq,
        threadId: appThreadId(event.threadId),
      };
  }
}

function partsForMessage(parts: ReadonlyArray<CorePart>, messageId: CoreMessage["id"]): CorePart[] {
  return parts.filter((part) => String(part.messageId) === String(messageId));
}

function textFromParts(parts: ReadonlyArray<CorePart>): string {
  return parts
    .flatMap((part) => (part._tag === "text" ? [part.text] : []))
    .join("");
}

function hasActivePart(parts: ReadonlyArray<CorePart>): boolean {
  return parts.some((part) => part.state === "active");
}

function promptTokenLabel(token: PromptToken): string {
  switch (token.kind) {
    case "mention":
      return token.path.split("/").at(-1) ?? token.path;
    case "skill":
      return `$${token.name}`;
    case "inline":
      return token.label;
    case "text":
      return token.text;
  }
  const _exhaustive: never = token;
  return _exhaustive;
}

function lexicalTextNode(text: string): Record<string, unknown> {
  return {
    detail: 0,
    format: 0,
    mode: "normal",
    style: "",
    text,
    type: "text",
    version: 1,
  };
}

function lexicalPromptTokenNode(token: PromptToken): Record<string, unknown> {
  switch (token.kind) {
    case "mention":
      return {
        path: token.path,
        label: promptTokenLabel(token),
        lineStart: null,
        lineEnd: null,
        text: token.raw,
        type: "mentionNode",
        version: 1,
      };
    case "skill":
      return {
        name: token.name,
        label: promptTokenLabel(token),
        description: null,
        path: token.path,
        text: token.raw,
        type: "skillNode",
        version: 1,
      };
    case "inline":
      return {
        label: token.label,
        sourceUri: token.uri,
        markdown: token.raw,
        text: token.raw,
        type: "inlineTokenNode",
        version: 1,
      };
    case "text":
      return lexicalTextNode(token.text);
  }
  const _exhaustive: never = token;
  return _exhaustive;
}

function richTextFromPromptText(text: string): Record<string, unknown> | undefined {
  const tokens = parsePromptTokens(text);
  if (!tokens.some((token) => token.kind !== "text")) {
    return undefined;
  }

  return {
    root: {
      children: [
        {
          children: tokens.map(lexicalPromptTokenNode),
          direction: null,
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
          textFormat: 0,
          textStyle: "",
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}

function imageAttachmentsFromMessage(
  message: CoreMessage,
  parts: ReadonlyArray<CorePart>,
): ChatAttachment[] | undefined {
  const attachments = [
    ...message.attachments,
    ...parts.flatMap((part) =>
      part._tag === "image" ? [part.attachment] : [],
    ),
  ].flatMap<ChatAttachment>((attachment) =>
    attachment.mimeType.startsWith("image/")
      ? [
          {
            type: "image",
            id: String(attachment.id),
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            ...(attachment.url ? { previewUrl: attachment.url } : {}),
          },
        ]
      : [],
  );

  return attachments.length > 0 ? attachments : undefined;
}

function mapCoreMessage(
  message: CoreMessage,
  parts: ReadonlyArray<CorePart>,
  threadUpdatedAt: string,
): ChatMessage {
  const text = textFromParts(parts);
  const richText = message.role === "user" ? richTextFromPromptText(text) : undefined;
  const attachments = imageAttachmentsFromMessage(message, parts);
  const streaming = message.role === "assistant" && hasActivePart(parts);
  return {
    id: appMessageId(message.id),
    role: message.role,
    text,
    ...(richText !== undefined ? { richText } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
    turnId: optionalTurnId(message.turnId),
    createdAt: message.createdAt,
    ...(streaming ? {} : { completedAt: message.role === "assistant" ? threadUpdatedAt : message.createdAt }),
    streaming,
    ...(message.error ? { turnFailure: message.error } : {}),
  };
}

function mapCoreEntry(entry: CoreThreadEntry, threadId: AppThreadId): ThreadTreeEntry {
  return {
    id: appThreadEntryId(entry.id),
    threadId,
    parentEntryId: optionalThreadEntryId(entry.parentId),
    kind: "message",
    messageId: entry.messageId === null ? null : appMessageId(entry.messageId),
    turnId: optionalTurnId(entry.turnId),
    createdAt: entry.createdAt,
  };
}

function messageCreatedAtById(messages: ReadonlyArray<CoreMessage>): ReadonlyMap<string, string> {
  return new Map(
    messages.map((message): readonly [string, string] => [
      String(message.id),
      message.createdAt,
    ]),
  );
}

function planCreatedAt(
  plan: CorePlanPart,
  messagesById: ReadonlyMap<string, string>,
  fallback: string,
): string {
  return messagesById.get(String(plan.messageId)) ?? fallback;
}

function mapPlanPart(
  part: CorePlanPart,
  messagesById: ReadonlyMap<string, string>,
  threadUpdatedAt: string,
): ProposedPlan {
  return {
    id: part.planId,
    turnId: optionalTurnId(part.turnId),
    planMarkdown: part.markdown,
    implementedAt: part.implementedAt,
    implementationThreadId: null,
    createdAt: planCreatedAt(part, messagesById, threadUpdatedAt),
    updatedAt: threadUpdatedAt,
  };
}

function coreToolActivityKind(part: CoreToolPart): Extract<
  OrchestrationThreadActivity["kind"],
  "tool.started" | "tool.updated" | "tool.completed"
> {
  switch (part.toolState._tag) {
    case "pending":
      return "tool.started";
    case "running":
      return "tool.updated";
    case "completed":
    case "error":
      return "tool.completed";
  }
  const _exhaustive: never = part.toolState;
  return _exhaustive;
}

function coreToolStatus(part: CoreToolPart): string {
  switch (part.toolState._tag) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "error":
      return "failed";
  }
  const _exhaustive: never = part.toolState;
  return _exhaustive;
}

function toolActivityItemType(part: CoreToolPart): ToolLifecycleItemType {
  switch (part.display._tag) {
    case "bash":
      return "command_execution";
    case "read":
      return "file_read";
    case "grep":
    case "find":
      return "file_search";
    case "edit":
      return "file_change";
    case "mcp":
      return "mcp_tool_call";
    case "subagent":
      return "collab_agent_tool_call";
    case "web":
      return part.display.kind === "fetch" ? "web_fetch" : "web_search";
    case "image":
      return "image_view";
    case "diagnostic":
    case "generic":
    case "raw":
      return "dynamic_tool_call";
  }
  const _exhaustive: never = part.display;
  return _exhaustive;
}

function toolStateTitle(part: CoreToolPart): string | undefined {
  switch (part.toolState._tag) {
    case "running":
    case "completed":
      return part.toolState.title;
    case "pending":
    case "error":
      return undefined;
  }
  const _exhaustive: never = part.toolState;
  return _exhaustive;
}

function toolDetail(part: CoreToolPart): string | undefined {
  switch (part.toolState._tag) {
    case "error":
      return part.toolState.error;
    case "completed":
      return typeof part.toolState.output === "string" ? part.toolState.output : undefined;
    case "pending":
    case "running":
      return undefined;
  }
  const _exhaustive: never = part.toolState;
  return _exhaustive;
}

function mapToolPart(part: CoreToolPart, sequence: number, fallbackCreatedAt: string): OrchestrationThreadActivity {
  const failed = part.toolState._tag === "error";
  const title = toolStateTitle(part) ?? part.tool;
  const detail = toolDetail(part);
  return {
    id: EventId.make(`core-tool:${part.id}`),
    kind: coreToolActivityKind(part),
    tone: failed ? "error" : "tool",
    summary: failed ? `${title} failed` : title,
    turnId: optionalTurnId(part.turnId),
    sequence,
    createdAt: fallbackCreatedAt,
    payload: {
      itemType: toolActivityItemType(part),
      itemId: String(part.callId),
      status: coreToolStatus(part),
      title,
      ...(detail ? { detail } : {}),
      data: {
        tool: part.tool,
        toolState: part.toolState,
        display: part.display,
        ...(part.diagnostics ? { diagnostics: part.diagnostics } : {}),
        ...(part.metadata ? { metadata: part.metadata } : {}),
      },
    },
  };
}

function mapReasoningPart(
  part: Extract<CorePart, { readonly _tag: "reasoning" }>,
  sequence: number,
  fallbackCreatedAt: string,
): OrchestrationThreadActivity {
  if (part.state === "active") {
    return {
      id: EventId.make(`core-reasoning:${part.id}`),
      kind: "task.progress",
      tone: "info",
      summary: "Reasoning",
      turnId: optionalTurnId(part.turnId),
      sequence,
      createdAt: fallbackCreatedAt,
      payload: {
        taskId: RuntimeTaskId.make(`core-reasoning:${part.id}`),
        detail: part.text,
      },
    };
  }

  return {
    id: EventId.make(`core-reasoning:${part.id}`),
    kind: "task.completed",
    tone: "info",
    summary: "Reasoning completed",
    turnId: optionalTurnId(part.turnId),
    sequence,
    createdAt: fallbackCreatedAt,
    payload: {
      taskId: RuntimeTaskId.make(`core-reasoning:${part.id}`),
      taskType: "reasoning",
      status: "completed",
      detail: part.text,
    },
  };
}

function mapStepPart(
  part: Extract<CorePart, { readonly _tag: "step" }>,
  sequence: number,
  fallbackCreatedAt: string,
): OrchestrationThreadActivity {
  const taskId = RuntimeTaskId.make(`core-step:${part.id}`);
  if (part.state === "active") {
    return {
      id: EventId.make(`core-step:${part.id}`),
      kind: "task.progress",
      tone: "info",
      summary: "Model step",
      turnId: optionalTurnId(part.turnId),
      sequence,
      createdAt: fallbackCreatedAt,
      payload: {
        taskId,
        detail: part.model ?? "Model step",
        ...(part.usage ? { usage: part.usage } : {}),
      },
    };
  }

  return {
    id: EventId.make(`core-step:${part.id}`),
    kind: "task.completed",
    tone: "info",
    summary: "Model step completed",
    turnId: optionalTurnId(part.turnId),
    sequence,
    createdAt: fallbackCreatedAt,
    payload: {
      taskId,
      taskType: "model",
      status: "completed",
      ...(part.model ? { detail: part.model } : {}),
      ...(part.usage ? { usage: part.usage } : {}),
    },
  };
}

function mapNoticePart(
  part: Extract<CorePart, { readonly _tag: "notice" }>,
  sequence: number,
  fallbackCreatedAt: string,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`core-notice:${part.id}`),
    kind: part.severity === "error" ? "runtime.error" : "runtime.warning",
    tone: part.severity === "error" ? "error" : "info",
    summary: part.name,
    turnId: optionalTurnId(part.turnId),
    sequence,
    createdAt: fallbackCreatedAt,
    payload: {
      message: part.message,
      detail: {
        name: part.name,
        ...(part.metadata ? { metadata: part.metadata } : {}),
      },
    },
  };
}

function mapQuestionPart(
  part: CoreQuestionPart,
  sequence: number,
  fallbackCreatedAt: string,
): OrchestrationThreadActivity {
  if (part.status === "pending") {
    return {
      id: EventId.make(`core-question:${part.id}`),
      kind: "user-input.requested",
      tone: "approval",
      summary: part.title,
      turnId: optionalTurnId(part.turnId),
      sequence,
      createdAt: fallbackCreatedAt,
      payload: {
        requestId: String(part.questionId),
        questions: part.questions.map((question) => ({
          id: String(question.id),
          header: question.header ?? part.title,
          question: question.text,
          options: question.options.map((option) => ({
            label: option.label,
            description: option.description ?? option.label,
          })),
          multiSelect: question.multiSelect === true,
        })),
      },
    };
  }

  return {
    id: EventId.make(`core-question:${part.id}`),
    kind: "user-input.resolved",
    tone: "approval",
    summary: `${part.title} answered`,
    turnId: optionalTurnId(part.turnId),
    sequence,
    createdAt: fallbackCreatedAt,
    payload: {
      requestId: String(part.questionId),
      answers: part.answers ?? {},
    },
  };
}

function mapCompactionPart(
  part: Extract<CorePart, { readonly _tag: "compaction" }>,
  sequence: number,
  fallbackCreatedAt: string,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`core-compaction:${part.id}`),
    kind: "context-compaction",
    tone: "info",
    summary: "Context compacted",
    turnId: optionalTurnId(part.turnId),
    sequence,
    createdAt: fallbackCreatedAt,
    payload: {
      state: "compacted",
      detail: {
        summary: part.summary,
        ...(part.tokensBefore !== undefined ? { tokensBefore: part.tokensBefore } : {}),
      },
    },
  };
}

function mapActivityPart(
  part: CorePart,
  sequence: number,
  fallbackCreatedAt: string,
): OrchestrationThreadActivity | null {
  switch (part._tag) {
    case "tool":
      return mapToolPart(part, sequence, fallbackCreatedAt);
    case "reasoning":
      return mapReasoningPart(part, sequence, fallbackCreatedAt);
    case "step":
      return mapStepPart(part, sequence, fallbackCreatedAt);
    case "notice":
      return mapNoticePart(part, sequence, fallbackCreatedAt);
    case "question":
      return mapQuestionPart(part, sequence, fallbackCreatedAt);
    case "compaction":
      return mapCompactionPart(part, sequence, fallbackCreatedAt);
    case "text":
    case "file":
    case "image":
    case "plan":
    case "patch":
    case "branchSummary":
    case "custom":
      return null;
  }
  const _exhaustive: never = part;
  return _exhaustive;
}

function mapActivities(parts: ReadonlyArray<CorePart>, fallbackCreatedAt: string): OrchestrationThreadActivity[] {
  return parts.flatMap((part, index) => {
    const activity = mapActivityPart(part, index, fallbackCreatedAt);
    return activity === null ? [] : [activity];
  });
}

function assistantMessageIdForTurn(
  messages: ReadonlyArray<CoreMessage>,
  turnId: AppTurnId,
): MessageId | null {
  const message = messages.findLast(
    (entry) => entry.role === "assistant" && entry.turnId !== null && appTurnId(entry.turnId) === turnId,
  );
  return message ? appMessageId(message.id) : null;
}

function requestedAtForTurn(
  messages: ReadonlyArray<CoreMessage>,
  turnId: AppTurnId,
  fallback: string,
): string {
  return (
    messages.find(
      (entry) => entry.role === "user" && entry.turnId !== null && appTurnId(entry.turnId) === turnId,
    )?.createdAt ?? fallback
  );
}

function latestTurnFromThreadState(state: ThreadState): Thread["latestTurn"] {
  if (state.activeTurn !== null) {
    const turnId = appTurnId(state.activeTurn);
    const requestedAt = requestedAtForTurn(state.allMessages, turnId, state.summary.updatedAt);
    return {
      turnId,
      state: "running",
      requestedAt,
      startedAt: requestedAt,
      completedAt: null,
      assistantMessageId: assistantMessageIdForTurn(state.allMessages, turnId),
    };
  }

  if (state.lastSettled !== null) {
    const turnId = appTurnId(state.lastSettled.turnId);
    const requestedAt = requestedAtForTurn(state.allMessages, turnId, state.summary.updatedAt);
    return {
      turnId,
      state:
        state.lastSettled.state === "completed"
          ? "completed"
          : state.lastSettled.state === "aborted"
            ? "interrupted"
            : "error",
      requestedAt,
      startedAt: requestedAt,
      completedAt: state.summary.updatedAt,
      assistantMessageId: assistantMessageIdForTurn(state.allMessages, turnId),
    };
  }

  return null;
}

function mapPatchPart(
  part: CorePatchPart,
  latestTurn: Thread["latestTurn"],
  fallbackCompletedAt: string,
): TurnDiffSummary | null {
  if (part.turnId === null) {
    return null;
  }
  const turnId = appTurnId(part.turnId);
  return {
    turnId,
    completedAt: fallbackCompletedAt,
    status: part.state,
    files: part.files.map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    })),
    ...(latestTurn?.turnId === turnId && latestTurn.assistantMessageId
      ? { assistantMessageId: latestTurn.assistantMessageId }
      : {}),
  };
}

function mapTurnDiffSummaries(
  parts: ReadonlyArray<CorePart>,
  latestTurn: Thread["latestTurn"],
  fallbackCompletedAt: string,
): TurnDiffSummary[] {
  return parts.flatMap((part) => {
    if (part._tag !== "patch") {
      return [];
    }
    const summary = mapPatchPart(part, latestTurn, fallbackCompletedAt);
    return summary === null ? [] : [summary];
  });
}

function threadSessionFromState(state: ThreadState, latestTurn: Thread["latestTurn"]): ThreadSession {
  const activeTurnId = latestTurn?.state === "running" ? latestTurn.turnId : undefined;
  return mapSessionFromSummary(
    state.summary,
    activeTurnId,
    state.lastSettled?.error ?? undefined,
  );
}

function mapThreadState(state: ThreadState, environmentId: EnvironmentId): Thread {
  const threadId = appThreadId(state.summary.id);
  const latestTurn = latestTurnFromThreadState(state);
  const messages = state.messages.map((message) =>
    mapCoreMessage(message, partsForMessage(state.parts, message.id), state.summary.updatedAt),
  );
  const messagesById = messageCreatedAtById(state.allMessages);
  return {
    id: threadId,
    environmentId,
    codexThreadId: null,
    projectId: optionalProjectId(state.summary.projectId),
    title: state.summary.title,
    modelSelection: mapModelSelection(state.summary.model),
    runtimeMode: coreRuntimeModeCompatibilityGap(),
    interactionMode: DEFAULT_AGENT_INTERACTION_MODE,
    session: threadSessionFromState(state, latestTurn),
    messages,
    leafId: optionalThreadEntryId(state.leafId),
    entries: state.entries.map((entry) => mapCoreEntry(entry, threadId)),
    proposedPlans: state.parts.flatMap((part) =>
      part._tag === "plan" ? [mapPlanPart(part, messagesById, state.summary.updatedAt)] : [],
    ),
    error: state.lastSettled?.error ?? null,
    createdAt: state.summary.createdAt,
    archivedAt: state.summary.archivedAt,
    updatedAt: state.summary.updatedAt,
    latestTurn,
    branch: state.summary.worktree?.branch ?? null,
    worktreePath: state.summary.worktree?.path ?? null,
    turnDiffSummaries: mapTurnDiffSummaries(state.parts, latestTurn, state.summary.updatedAt),
    activities: mapActivities(state.parts, state.summary.updatedAt),
  };
}

function mapCoreMessageToOrchestrationMessage(
  message: ChatMessage,
): OrchestrationThread["messages"][number] {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    ...(message.richText !== undefined ? { richText: message.richText } : {}),
    ...(message.attachments !== undefined
      ? {
          attachments: message.attachments.map((attachment) => ({
            type: "image",
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          })),
        }
      : {}),
    turnId: message.turnId ?? null,
    streaming: message.streaming,
    createdAt: message.createdAt,
    updatedAt: message.completedAt ?? message.createdAt,
  };
}

function mapCoreSessionToOrchestrationSession(
  thread: Thread,
): OrchestrationThread["session"] {
  if (thread.session === null) {
    return null;
  }

  return {
    threadId: thread.id,
    status: thread.session.orchestrationStatus,
    runtimeMode: coreRuntimeModeCompatibilityGap(),
    activeTurnId: thread.session.activeTurnId ?? null,
    lastError: thread.session.lastError ?? null,
    updatedAt: thread.session.updatedAt,
  };
}

function mapThreadStateToOrchestrationThread(
  state: ThreadState,
  environmentId: EnvironmentId,
): OrchestrationThread {
  const thread = mapThreadState(state, environmentId);
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestTurn: thread.latestTurn,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt ?? thread.createdAt,
    archivedAt: thread.archivedAt,
    deletedAt: null,
    messages: thread.messages.map(mapCoreMessageToOrchestrationMessage),
    leafId: thread.leafId,
    entries: thread.entries,
    proposedPlans: thread.proposedPlans,
    activities: thread.activities,
    session: mapCoreSessionToOrchestrationSession(thread),
  };
}

function subscribeWithReconnect(input: {
  readonly connection: CoreEnvironmentConnection;
  readonly attach: () => () => void;
}): () => void {
  let unsubscribe = input.attach();
  const unsubscribeReconnect = input.connection.subscribeReconnect(() => {
    unsubscribe();
    unsubscribe = input.attach();
  });

  return () => {
    unsubscribeReconnect();
    unsubscribe();
  };
}

function mapUploadAttachmentToCoreAttachment(
  attachment: CoreTurnStartCommand["message"]["attachments"][number],
): NonNullable<SendMessageInput["attachments"]>[number] {
  return {
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    dataUrl: attachment.dataUrl,
  };
}

function buildCoreSendMessageInput(command: CoreTurnStartCommand): SendMessageInput {
  return {
    messageId: coreMessageId(command.message.messageId),
    text: command.message.text,
    ...(command.message.attachments.length > 0
      ? { attachments: command.message.attachments.map(mapUploadAttachmentToCoreAttachment) }
      : {}),
    interactionMode: command.interactionMode,
    ...(command.parentEntryId !== undefined
      ? {
          parentEntryId:
            command.parentEntryId === null ? null : coreEntryId(command.parentEntryId),
        }
      : {}),
  };
}

function dispatchResultFromAdmissionReceipt(receipt: AdmissionReceipt): CoreDispatchResult {
  return {
    sequence: receipt.seq,
  };
}

async function currentThreadDispatchResult(
  connection: CoreEnvironmentConnection,
  threadId: CoreApiThreadId,
): Promise<CoreDispatchResult> {
  const thread = await connection.honk().threads.get(threadId);
  return {
    sequence: thread.seq,
  };
}

async function ensureCoreThreadForTurnStartCommand(
  connection: CoreEnvironmentConnection,
  command: CoreTurnStartCommand,
): Promise<void> {
  const createThread = command.bootstrap?.createThread;
  if (!createThread) {
    return;
  }

  const worktree =
    createThread.branch && createThread.worktreePath
      ? {
          branch: createThread.branch,
          path: createThread.worktreePath,
        }
      : null;
  await connection.honk().threads.create({
    threadId: coreThreadId(command.threadId),
    ...(createThread.projectId ? { projectId: coreProjectId(createThread.projectId) } : {}),
    title: createThread.title,
    model: coreModelId(createThread.modelSelection.model),
    cwd: createThread.worktreePath ?? command.bootstrap?.prepareWorktree?.projectCwd ?? DEFAULT_PROJECTLESS_CWD,
    ...(worktree ? { worktree } : {}),
  });
}

async function dispatchCoreThreadCreateCommand(
  connection: CoreEnvironmentConnection,
  command: CoreThreadCreateCommand,
): Promise<CoreDispatchResult> {
  const threadId = coreThreadId(command.threadId);
  const worktree =
    command.branch && command.worktreePath
      ? {
          branch: command.branch,
          path: command.worktreePath,
        }
      : null;
  await connection.honk().threads.create({
    threadId,
    ...(command.projectId ? { projectId: coreProjectId(command.projectId) } : {}),
    title: command.title,
    model: coreModelId(command.modelSelection.model),
    cwd: command.worktreePath ?? DEFAULT_PROJECTLESS_CWD,
    ...(worktree ? { worktree } : {}),
  });
  return currentThreadDispatchResult(connection, threadId);
}

async function dispatchCoreThreadDeleteCommand(
  connection: CoreEnvironmentConnection,
  command: CoreThreadDeleteCommand,
): Promise<CoreDispatchResult> {
  await connection.honk().threads.remove(coreThreadId(command.threadId));
  return { sequence: 0 };
}

async function dispatchCoreThreadArchiveCommand(
  connection: CoreEnvironmentConnection,
  command: CoreThreadArchiveCommand,
): Promise<CoreDispatchResult> {
  const threadId = coreThreadId(command.threadId);
  await connection.honk().threads.archive(threadId);
  return currentThreadDispatchResult(connection, threadId);
}

async function dispatchCoreThreadUnarchiveCommand(
  connection: CoreEnvironmentConnection,
  command: CoreThreadUnarchiveCommand,
): Promise<CoreDispatchResult> {
  const threadId = coreThreadId(command.threadId);
  await connection.honk().threads.unarchive(threadId);
  return currentThreadDispatchResult(connection, threadId);
}

async function dispatchCoreThreadMetaUpdateCommand(
  connection: CoreEnvironmentConnection,
  command: CoreThreadMetaUpdateCommand,
): Promise<CoreDispatchResult> {
  const threadId = coreThreadId(command.threadId);
  if (command.title !== undefined) {
    await connection.honk().threads.update(threadId, { title: command.title });
  }
  return currentThreadDispatchResult(connection, threadId);
}

function dispatchCoreThreadInteractionModeSetCommand(
  connection: CoreEnvironmentConnection,
  command: CoreThreadInteractionModeSetCommand,
): Promise<CoreDispatchResult> {
  return currentThreadDispatchResult(connection, coreThreadId(command.threadId));
}

async function dispatchCoreTurnStartCommand(
  connection: CoreEnvironmentConnection,
  command: CoreTurnStartCommand,
): Promise<CoreDispatchResult> {
  await ensureCoreThreadForTurnStartCommand(connection, command);
  const receipt = await connection.honk().threads.send(
    coreThreadId(command.threadId),
    buildCoreSendMessageInput(command),
  );
  if (command.sourceProposedPlan) {
    await connection.honk().threads.implementPlan(
      coreThreadId(command.sourceProposedPlan.threadId),
      corePlanId(command.sourceProposedPlan.planId),
    );
  }
  return dispatchResultFromAdmissionReceipt(receipt);
}

async function dispatchCoreTurnInterruptCommand(
  connection: CoreEnvironmentConnection,
  command: CoreTurnInterruptCommand,
): Promise<CoreDispatchResult> {
  const threadId = coreThreadId(command.threadId);
  await connection.honk().threads.interrupt(
    threadId,
    command.turnId ? { turnId: coreTurnId(command.turnId) } : {},
  );
  return currentThreadDispatchResult(connection, threadId);
}

async function dispatchCoreSessionStopCommand(
  connection: CoreEnvironmentConnection,
  command: CoreSessionStopCommand,
): Promise<CoreDispatchResult> {
  const threadId = coreThreadId(command.threadId);
  await connection.honk().threads.interrupt(threadId);
  return currentThreadDispatchResult(connection, threadId);
}

async function dispatchCoreUserInputRespondCommand(
  connection: CoreEnvironmentConnection,
  command: CoreUserInputRespondCommand,
): Promise<CoreDispatchResult> {
  const threadId = coreThreadId(command.threadId);
  await connection.honk().threads.answerQuestion(threadId, coreQuestionId(command.requestId), {
    answers: command.answers,
  });
  return currentThreadDispatchResult(connection, threadId);
}

function dispatchCoreProjectCreateCommand(
  connection: CoreEnvironmentConnection,
  command: CoreProjectCreateCommand,
): Promise<CoreDispatchResult> {
  return withCoreAux(connection, (aux) => aux.createProject(command));
}

function dispatchCoreProjectMetaUpdateCommand(
  connection: CoreEnvironmentConnection,
  command: CoreProjectMetaUpdateCommand,
): Promise<CoreDispatchResult> {
  return withCoreAux(connection, (aux) => aux.updateProjectMeta(command));
}

function dispatchCoreProjectDeleteCommand(
  connection: CoreEnvironmentConnection,
  command: CoreProjectDeleteCommand,
): Promise<CoreDispatchResult> {
  return withCoreAux(connection, (aux) => aux.deleteProject(command));
}

function unsupportedCoreOrchestrationCommand(command: CoreDispatchCommand): Promise<never> {
  return Promise.reject(
    new Error(`Core environment does not implement orchestration command "${command.type}".`),
  );
}

function dispatchCoreCommand(
  connection: CoreEnvironmentConnection,
  command: CoreDispatchCommand,
): Promise<CoreDispatchResult> {
  switch (command.type) {
    case "project.create":
      return dispatchCoreProjectCreateCommand(connection, command);
    case "project.meta.update":
      return dispatchCoreProjectMetaUpdateCommand(connection, command);
    case "project.delete":
      return dispatchCoreProjectDeleteCommand(connection, command);
    case "thread.create":
      return dispatchCoreThreadCreateCommand(connection, command);
    case "thread.delete":
      return dispatchCoreThreadDeleteCommand(connection, command);
    case "thread.archive":
      return dispatchCoreThreadArchiveCommand(connection, command);
    case "thread.unarchive":
      return dispatchCoreThreadUnarchiveCommand(connection, command);
    case "thread.meta.update":
      return dispatchCoreThreadMetaUpdateCommand(connection, command);
    case "thread.interaction-mode.set":
      return dispatchCoreThreadInteractionModeSetCommand(connection, command);
    case "thread.turn.start":
      return dispatchCoreTurnStartCommand(connection, command);
    case "thread.turn.interrupt":
      return dispatchCoreTurnInterruptCommand(connection, command);
    case "thread.session.stop":
      return dispatchCoreSessionStopCommand(connection, command);
    case "thread.user-input.respond":
      return dispatchCoreUserInputRespondCommand(connection, command);
    default:
      return unsupportedCoreOrchestrationCommand(command);
  }
}

function createCoreEnvironmentApi(connection: CoreEnvironmentConnection): EnvironmentApi {
  const client: EnvironmentApi = {
    terminal: createCoreTerminalApi(connection),
    projects: {
      listDirectory: notImplemented,
      readFile: notImplemented,
      searchEntries: notImplemented,
      writeFile: notImplemented,
      deleteFile: notImplemented,
      createDirectory: notImplemented,
      renamePath: notImplemented,
    },
    filesystem: {
      browse: notImplemented,
    },
    git: createCoreAuxGitApi(connection),
    orchestration: {
      dispatchCommand: (command) => dispatchCoreCommand(connection, command),
      replayEvents: async (input): Promise<OrchestrationReplayEventsResult> => {
        await connection.reconnect();
        return {
          events: [],
          nextSequence: input.fromSequenceExclusive,
          upToDate: true,
        };
      },
      subscribeShell: (callback, options) =>
        subscribeWithReconnect({
          connection,
          attach: () => {
            let snapshotRequestId = 0;
            return connection.honk().workspace.watch({
              onChange: (state) => {
                const requestId = snapshotRequestId + 1;
                snapshotRequestId = requestId;
                void connection
                  .listProjects()
                  .catch(() => [])
                  .then((projects) => {
                    if (requestId !== snapshotRequestId) {
                      return;
                    }
                    callback({
                      kind: "snapshot",
                      snapshot: mapWorkspaceStateToShellSnapshot(
                        state,
                        connection.environmentId,
                        projects,
                      ),
                    });
                    connection.markBootstrapped();
                  });
              },
              onEvent: (event) => {
                callback(mapWorkspaceEvent(event, connection.environmentId));
              },
              onStatus: (status) => {
                if (status === "reconnecting") {
                  connection.resetBootstrap();
                  options?.onResubscribe?.();
                }
              },
            }).close;
          },
        }),
      subscribeThread: (input, callback, options) =>
        subscribeWithReconnect({
          connection,
          attach: () =>
            connection.honk().threads.watch(coreThreadId(input.threadId), {
              onChange: (state) => {
                const item: OrchestrationThreadStreamItem = {
                  kind: "snapshot",
                  snapshot: {
                    snapshotSequence: state.seq,
                    thread: mapThreadStateToOrchestrationThread(
                      state,
                      connection.environmentId,
                    ),
                  },
                };
                callback(item);
              },
              onStatus: (status) => {
                if (status === "reconnecting") {
                  options?.onResubscribe?.();
                }
              },
            }).close,
        }),
    },
  };

  return client;
}

function registerCoreEnvironmentConnection(
  connection: CoreEnvironmentConnection,
): CoreEnvironmentServiceConnection {
  let configUnsubscribe = NOOP;
  let projectEventsUnsubscribe = NOOP;
  let releaseLocalServerApi = NOOP;

  const installAuxServerSurface = () => {
    configUnsubscribe();
    releaseLocalServerApi();
    const aux = connection.aux();
    releaseLocalServerApi = setLocalServerApiOverride(
      aux?.server ?? createUnavailableCoreAuxServerApi(),
    );
    if (!aux) {
      configUnsubscribe = NOOP;
      return;
    }
    let disposed = false;
    void aux.server
      .getConfig()
      .then((config) => {
        if (!disposed) {
          setServerConfigSnapshot(config);
        }
      })
      .catch(() => undefined);
    const unsubscribe = aux.subscribeConfig((event) => {
      applyServerConfigEvent(event);
    });
    configUnsubscribe = () => {
      disposed = true;
      unsubscribe();
    };
  };

  installAuxServerSurface();
  projectEventsUnsubscribe = connection.subscribeProjectEvents((event) => {
    applyCoreProjectEvent(event, connection.environmentId);
  });
  const unsubscribeReconnect = connection.subscribeReconnect(installAuxServerSurface);

  const serviceConnection: CoreEnvironmentServiceConnection = {
    ...connection,
    client: createCoreEnvironmentApi(connection),
    dispose: async () => {
      unsubscribeReconnect();
      configUnsubscribe();
      projectEventsUnsubscribe();
      releaseLocalServerApi();
      await connection.dispose();
    },
  };
  const existing = coreEnvironmentConnections.get(serviceConnection.environmentId);
  if (existing && existing !== serviceConnection) {
    throw new Error(
      `Core environment ${serviceConnection.environmentId} already has an active connection.`,
    );
  }
  coreEnvironmentConnections.set(serviceConnection.environmentId, serviceConnection);
  emitCoreEnvironmentConnectionRegistryChange();
  return serviceConnection;
}

async function createPrimaryCoreEnvironmentConnection(): Promise<CoreEnvironmentServiceConnection> {
  const knownEnvironment = getPrimaryKnownEnvironment();
  if (!knownEnvironment?.environmentId) {
    throw new Error("Unable to resolve the primary core environment.");
  }

  const existing = coreEnvironmentConnections.get(knownEnvironment.environmentId);
  if (existing) {
    return existing;
  }

  return registerCoreEnvironmentConnection(
    await createCoreEnvironmentConnection({
      knownEnvironment,
    }),
  );
}

function applyCoreShellSnapshot(snapshot: OrchestrationShellSnapshot, environmentId: EnvironmentId): void {
  useStore.setState((state) => syncServerShellSnapshot(state, snapshot, environmentId));
  syncProjectUiFromCoreEnvironment();
  syncThreadUiFromCoreEnvironment();
}

function applyCoreShellEvent(event: OrchestrationShellStreamEvent, environmentId: EnvironmentId): void {
  useStore.setState((state) => applyShellEvent(state, event, environmentId));
  syncProjectUiFromCoreEnvironment();
  syncThreadUiFromCoreEnvironment();
}

function applyCoreProjectEvent(event: CoreAuxProjectEvent, environmentId: EnvironmentId): void {
  useStore.setState((state) => applyOrchestrationEvent(state, event, environmentId));
  syncProjectUiFromCoreEnvironment();
  syncThreadUiFromCoreEnvironment();
}

function syncCoreThreadState(state: ThreadState, environmentId: EnvironmentId): void {
  const thread = mapThreadState(state, environmentId);
  useStore.setState((appState) => syncCoreThreadDetail(appState, thread, environmentId));
  syncThreadUiFromCoreEnvironment();
}

function stopActiveService(): void {
  activeService?.shellUnsubscribe();
  activeService = null;
}

export function subscribeCoreEnvironmentConnections(listener: () => void): () => void {
  coreEnvironmentConnectionListeners.add(listener);
  return () => {
    coreEnvironmentConnectionListeners.delete(listener);
  };
}

export function listCoreEnvironmentConnections(): ReadonlyArray<CoreEnvironmentServiceConnection> {
  return [...coreEnvironmentConnections.values()];
}

export function readCoreEnvironmentConnection(
  environmentId: EnvironmentId,
): CoreEnvironmentServiceConnection | null {
  return coreEnvironmentConnections.get(environmentId) ?? null;
}

export function requireCoreEnvironmentConnection(
  environmentId: EnvironmentId,
): CoreEnvironmentServiceConnection {
  const connection = readCoreEnvironmentConnection(environmentId);
  if (!connection) {
    throw new Error(`No core client registered for environment ${environmentId}.`);
  }
  return connection;
}

export function resolveCoreEnvironmentHttpUrl(input: {
  readonly environmentId: EnvironmentId;
  readonly pathname: string;
  readonly searchParams?: Record<string, string>;
}): string {
  const connection = requireCoreEnvironmentConnection(input.environmentId);
  const baseUrl = getKnownEnvironmentHttpBaseUrl(connection.knownEnvironment);
  if (!baseUrl) {
    throw new Error(`No HTTP URL registered for environment ${input.environmentId}.`);
  }
  const url = new URL(input.pathname, baseUrl);
  if (input.searchParams) {
    url.search = new URLSearchParams(input.searchParams).toString();
  }
  return url.toString();
}

export async function getPrimaryCoreEnvironmentConnection(): Promise<CoreEnvironmentServiceConnection> {
  return createPrimaryCoreEnvironmentConnection();
}

export async function ensureCoreEnvironmentConnectionBootstrapped(
  environmentId: EnvironmentId,
): Promise<void> {
  await coreEnvironmentConnections.get(environmentId)?.ensureBootstrapped();
}

export function startCoreEnvironmentConnectionService(queryClient: QueryClient): () => void {
  const existingService = activeService;
  if (existingService?.queryClient === queryClient) {
    existingService.refCount += 1;
    return () => {
      if (!activeService || activeService.queryClient !== queryClient) {
        return;
      }
      activeService.refCount -= 1;
      if (activeService.refCount === 0) {
        stopActiveService();
      }
    };
  }

  stopActiveService();

  let shellUnsubscribe = NOOP;
  void createPrimaryCoreEnvironmentConnection().then((connection) => {
    const currentService = activeService;
    if (!currentService || currentService.queryClient !== queryClient) {
      return;
    }
    const unsubscribe = connection.client.orchestration.subscribeShell((item) => {
      if (item.kind === "snapshot") {
        applyCoreShellSnapshot(item.snapshot, connection.environmentId);
        return undefined;
      }
      applyCoreShellEvent(item, connection.environmentId);
      return undefined;
    });
    shellUnsubscribe = () => {
      unsubscribe();
      return undefined;
    };
    activeService = {
      ...currentService,
      shellUnsubscribe,
    };
  }).catch(() => undefined);

  activeService = {
    queryClient,
    refCount: 1,
    shellUnsubscribe: () => shellUnsubscribe(),
  };

  return () => {
    if (!activeService || activeService.queryClient !== queryClient) {
      return;
    }
    activeService.refCount -= 1;
    if (activeService.refCount === 0) {
      stopActiveService();
    }
  };
}

export function retainCoreThreadDetailSubscription(
  environmentId: EnvironmentId,
  threadId: AppThreadId,
): () => void {
  const connection = readCoreEnvironmentConnection(environmentId);
  if (!connection) {
    return NOOP;
  }

  return connection.honk().threads.watch(coreThreadId(threadId), {
    onChange: (state) => syncCoreThreadState(state, environmentId),
  }).close;
}

export async function resetCoreEnvironmentServiceForTests(): Promise<void> {
  stopActiveService();
  await Promise.all(
    [...coreEnvironmentConnections.values()].map(async (connection) => {
      await connection.dispose();
    }),
  );
  coreEnvironmentConnections.clear();
  emitCoreEnvironmentConnectionRegistryChange();
}
