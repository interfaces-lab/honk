import {
  parseDiffFromFile,
  type FileDiffMetadata,
  type Hunk,
  type FileContents,
} from "@pierre/diffs";
import { Data, Effect, Option } from "effect";
import {
  ApprovalRequestId,
  isToolLifecycleItemType,
  ProviderDriverKind,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  type ProviderRequestKind,
  type ToolLifecycleItemType,
  type UserInputQuestion,
  type ThreadId,
  type TurnId,
} from "@multi/contracts";

import type {
  ChatMessage,
  ProposedPlan,
  SessionPhase,
  Thread,
  ThreadSession,
  TurnDiffSummary,
} from "./types";
import {
  decodeSubagentAgentStates,
  decodeSubagentReceiverAgents,
  decodeSubagentReceiverThreadIds,
} from "@multi/shared/subagents";

export type ProviderPickerKind = ProviderDriverKind;

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
}> = [
  { value: ProviderDriverKind.make("codex"), label: "Codex", available: true },
  { value: ProviderDriverKind.make("claudeAgent"), label: "Claude", available: true },
  { value: ProviderDriverKind.make("cursor"), label: "Cursor", available: false },
];

export interface WorkLogSubagent {
  threadId: string;
  providerThreadId?: string | undefined;
  resolvedThreadId?: string | undefined;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  rawStatus?: string | undefined;
  latestUpdate?: string | undefined;
  title?: string | undefined;
  statusLabel?: string | undefined;
  isActive?: boolean | undefined;
}

export interface WorkLogSubagentAction {
  tool: string;
  status: string;
  summaryText: string;
  model?: string | undefined;
  prompt?: string | undefined;
}

export type ToolDisplayArtifact =
  | ToolDiffArtifact
  | ToolCommandArtifact
  | ToolReadArtifact
  | ToolSearchArtifact
  | ToolDiagnosticArtifact
  | ToolRawArtifact;

export interface ToolDiffArtifactFile {
  path: string;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface ToolDiffArtifact {
  type: "diff";
  format: "unified";
  source: "preview" | "result";
  title?: string | undefined;
  summary?: string | undefined;
  files: ReadonlyArray<ToolDiffArtifactFile>;
  unifiedDiff: string;
  isPreview?: boolean | undefined;
}

export interface ToolCommandArtifact {
  type: "command";
  command?: string | undefined;
  output?: string | undefined;
  exitCode?: number | undefined;
  durationMs?: number | undefined;
  truncated?: boolean | undefined;
  fullOutputPath?: string | undefined;
  isPartial?: boolean | undefined;
}

export interface ToolReadArtifact {
  type: "read";
  path?: string | undefined;
  output?: string | undefined;
  truncated?: boolean | undefined;
  isPartial?: boolean | undefined;
}

export interface ToolSearchArtifact {
  type: "search";
  query?: string | undefined;
  output?: string | undefined;
  matchedFiles?: ReadonlyArray<string> | undefined;
  truncated?: boolean | undefined;
  isPartial?: boolean | undefined;
}

export interface ToolDiagnosticArtifact {
  type: "diagnostic";
  severity: "info" | "warning" | "error";
  message: string;
}

export interface ToolRawArtifact {
  type: "raw";
  text: string;
}

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  output?: string;
  command?: string;
  rawCommand?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  status?: "running" | "completed" | "error";
  toolCallId?: string;
  toolTitle?: string;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  artifacts?: ReadonlyArray<ToolDisplayArtifact>;
  subagents?: ReadonlyArray<WorkLogSubagent>;
  subagentAction?: WorkLogSubagentAction;
}

interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  turnId: TurnId | null;
}

export interface WorkLogDerivationOptions {
  activeRunningTurnId?: TurnId | null | undefined;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: ProviderRequestKind;
  createdAt: string;
  detail?: string;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

export interface ActiveBackgroundTasksState {
  activeCount: number;
}

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    };

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0ms";
  const totalMs = Math.round(durationMs);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1_000);
  const milliseconds = totalMs % 1_000;
  return durationFormatter.format({
    ...(hours > 0 ? { hours } : {}),
    ...(minutes > 0 ? { minutes } : {}),
    ...(seconds > 0 ? { seconds } : {}),
    ...(hours === 0 && minutes === 0 && seconds < 10 && milliseconds > 0
      ? { milliseconds }
      : {}),
  });
}

const durationFormatter = new Intl.DurationFormat("en", {
  style: "narrow",
});

export function formatElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null;
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null;
  }
  return formatDuration(endedAt - startedAt);
}

type LatestTurnTiming = Pick<
  OrchestrationLatestTurn,
  "turnId" | "state" | "startedAt" | "completedAt"
>;
type SessionActivityState = Pick<ThreadSession, "orchestrationStatus" | "activeTurnId">;

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) return false;
  if (!latestTurn.completedAt) return false;
  if (latestTurn.state === "interrupted" || latestTurn.state === "error") {
    return true;
  }
  if (!session) return true;
  if (session.orchestrationStatus === "running") return false;
  return true;
}

export function hasLiveLatestTurn(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
): boolean {
  if (!latestTurn?.startedAt) {
    return false;
  }
  return !isLatestTurnSettled(latestTurn, session);
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null,
): string | null {
  const runningTurnId =
    session?.orchestrationStatus === "running" ? (session.activeTurnId ?? null) : null;
  if (runningTurnId !== null && runningTurnId === latestTurn?.turnId) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  if (runningTurnId !== null) {
    return sendStartedAt;
  }
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}

export function hasLiveTurnTailWork(input: {
  latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "completedAt"> | null;
  messages: ReadonlyArray<Pick<ChatMessage, "role" | "streaming" | "turnId">>;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  session?: Pick<ThreadSession, "orchestrationStatus"> | null;
}): boolean {
  const latestTurnId = input.latestTurn?.turnId;
  if (!latestTurnId) {
    return false;
  }

  const hasStreamingAssistantText = input.messages.some(
    (message) =>
      message.role === "assistant" && message.turnId === latestTurnId && message.streaming,
  );
  if (hasStreamingAssistantText) {
    return input.latestTurn?.completedAt == null;
  }

  if (input.session?.orchestrationStatus !== "running") {
    return false;
  }

  if (deriveActiveBackgroundTasksState(input.activities, latestTurnId) !== null) {
    return true;
  }

  return false;
}

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    case "permissions_approval":
      return "permissions";
    default:
      return null;
  }
}

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request")
  );
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;
    const requestKind =
      payload && isProviderRequestKind(payload.requestKind)
        ? payload.requestKind
        : payload
          ? requestKindFromRequestType(payload.requestType)
          : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
      continue;
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          if (
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
        multiSelect: question.multiSelect === true,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (
      activity.kind === "provider.user-input.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActivePlanState | null {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const allPlanActivities = ordered.filter((activity) => activity.kind === "turn.plan.updated");
  // Prefer plan from the current turn; fall back to the most recent plan from a prior turn
  // so that TodoWrite tasks persist across follow-up messages.
  const latest =
    (latestTurnId
      ? allPlanActivities.findLast((activity) => activity.turnId === latestTurnId)
      : undefined) ??
    allPlanActivities.at(-1) ??
    null;
  if (!latest) {
    return null;
  }
  const payload =
    latest.payload && typeof latest.payload === "object"
      ? (latest.payload as Record<string, unknown>)
      : null;
  const rawPlan = payload?.plan;
  if (!Array.isArray(rawPlan)) {
    return null;
  }
  const steps = rawPlan
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (typeof record.step !== "string") {
        return null;
      }
      const status =
        record.status === "completed" || record.status === "inProgress" ? record.status : "pending";
      return {
        step: record.step,
        status,
      };
    })
    .filter(
      (
        step,
      ): step is {
        step: string;
        status: "pending" | "inProgress" | "completed";
      } => step !== null,
    );
  if (steps.length === 0) {
    return null;
  }
  return {
    createdAt: latest.createdAt,
    turnId: latest.turnId,
    ...(payload && "explanation" in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  };
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined,
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter((proposedPlan) => proposedPlan.turnId === latestTurnId)
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
      .at(-1);
    if (matchingTurnPlan) {
      return toLatestProposedPlanState(matchingTurnPlan);
    }
  }

  const latestPlan = [...proposedPlans]
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latestPlan) {
    return null;
  }

  return toLatestProposedPlanState(latestPlan);
}

export function findSidebarProposedPlan(input: {
  threads: ReadonlyArray<Pick<Thread, "id" | "proposedPlans">>;
  latestTurn: Pick<OrchestrationLatestTurn, "turnId" | "sourceProposedPlan"> | null;
  latestTurnSettled: boolean;
  threadId: ThreadId | string | null | undefined;
}): LatestProposedPlanState | null {
  const activeThreadPlans =
    input.threads.find((thread) => thread.id === input.threadId)?.proposedPlans ?? [];

  if (!input.latestTurnSettled) {
    const sourceProposedPlan = input.latestTurn?.sourceProposedPlan;
    if (sourceProposedPlan) {
      const sourcePlan = input.threads
        .find((thread) => thread.id === sourceProposedPlan.threadId)
        ?.proposedPlans.find((plan) => plan.id === sourceProposedPlan.planId);
      if (sourcePlan) {
        return toLatestProposedPlanState(sourcePlan);
      }
    }
  }

  return findLatestProposedPlan(activeThreadPlans, input.latestTurn?.turnId ?? null);
}

export function hasActionableProposedPlan(
  proposedPlan: LatestProposedPlanState | Pick<ProposedPlan, "implementedAt"> | null,
): boolean {
  return proposedPlan !== null && proposedPlan.implementedAt === null;
}

export function deriveActiveBackgroundTasksState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): ActiveBackgroundTasksState | null {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const activeTasks = new Map<string, { taskType?: string | undefined }>();

  for (const activity of ordered) {
    if (
      latestTurnId &&
      activity.turnId &&
      activity.turnId !== latestTurnId &&
      activity.kind !== "task.completed"
    ) {
      continue;
    }

    if (
      activity.kind !== "task.started" &&
      activity.kind !== "task.progress" &&
      activity.kind !== "task.completed"
    ) {
      continue;
    }

    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const taskId = payload && typeof payload.taskId === "string" ? payload.taskId : null;
    if (!taskId) {
      continue;
    }

    if (activity.kind === "task.completed") {
      activeTasks.delete(taskId);
      continue;
    }

    const previous = activeTasks.get(taskId);
    const taskType = payload && typeof payload.taskType === "string" ? payload.taskType : undefined;
    activeTasks.set(taskId, {
      taskType: taskType ?? previous?.taskType,
    });
  }

  const activeCount = [...activeTasks.values()].filter((task) => task.taskType !== "plan").length;
  return activeCount > 0 ? { activeCount } : null;
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
  options: WorkLogDerivationOptions = {},
): WorkLogEntry[] {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const entries = ordered
    .filter((activity) => (latestTurnId ? activity.turnId === latestTurnId : true))
    .filter((activity) => activity.kind !== "account.rate-limits.updated")
    .filter((activity) => activity.kind !== "context-window.updated")
    .filter((activity) => activity.summary !== "Checkpoint captured")
    .filter((activity) => !isPlanBoundaryToolActivity(activity))
    .map(toDerivedWorkLogEntry);
  return collapseDerivedWorkLogEntries(entries).map((entry) => {
    const shouldSettle =
      options.activeRunningTurnId !== undefined &&
      entry.status === "running" &&
      (entry.activityKind === "tool.started" ||
        entry.activityKind === "tool.updated" ||
        entry.activityKind === "tool.completed") &&
      (options.activeRunningTurnId === null || entry.turnId !== options.activeRunningTurnId);
    const settledEntry = shouldSettle
      ? {
          ...entry,
          status: "completed" as const,
          ...(entry.artifacts
            ? {
                artifacts: entry.artifacts.map((artifact): ToolDisplayArtifact => {
                  switch (artifact.type) {
                    case "diff": {
                      const { isPreview: _isPreview, ...resultArtifact } = artifact;
                      return { ...resultArtifact, source: "result" };
                    }
                    case "command":
                    case "read":
                    case "search": {
                      const { isPartial: _isPartial, ...completeArtifact } = artifact;
                      return completeArtifact;
                    }
                    case "diagnostic":
                    case "raw":
                      return artifact;
                  }
                }),
              }
            : {}),
        }
      : entry;
    const { activityKind: _activityKind, turnId: _turnId, ...workEntry } = settledEntry;
    return workEntry;
  });
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }

  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const data = asRecord(payload?.data);
  const commandPreview = extractToolCommand(payload);
  const payloadChangedFiles = extractChangedFiles(payload);
  const title = extractToolTitle(payload);
  const subagents = extractWorkLogSubagents(payload);
  const isTaskActivity =
    activity.kind === "task.started" ||
    activity.kind === "task.progress" ||
    activity.kind === "task.completed";
  const taskSummary =
    isTaskActivity && typeof payload?.summary === "string" && payload.summary.length > 0
      ? payload.summary
      : null;
  const taskDetailAsLabel =
    isTaskActivity &&
    !taskSummary &&
    typeof payload?.detail === "string" &&
    payload.detail.length > 0
      ? payload.detail
      : null;
  const taskLabel = taskSummary || taskDetailAsLabel;
  const itemType = extractWorkLogItemType(payload);
  const requestKind = extractWorkLogRequestKind(payload);
  const toolCallId = asTrimmedString(payload?.itemId);
  const isSubagentLifecycle = itemType === "collab_agent_tool_call" || subagents.length > 0;
  const entryId =
    toolCallId && isToolLifecycleActivityKind(activity.kind) && !isSubagentLifecycle
      ? activity.turnId
        ? `tool:${activity.turnId}:${toolCallId}`
        : `tool:${toolCallId}`
      : activity.id;
  const tone: WorkLogEntry["tone"] =
    activity.kind === "task.started" || activity.kind === "task.progress"
      ? "thinking"
      : activity.tone === "approval"
        ? "info"
        : activity.tone;
  const entry: DerivedWorkLogEntry = {
    id: entryId,
    createdAt: activity.createdAt,
    label: taskLabel || activity.summary,
    tone,
    activityKind: activity.kind,
    turnId: activity.turnId,
  };
  const status = resolveWorkLogStatus(activity, payload, tone);
  const streamKind = asTrimmedString(data?.streamKind);
  const streamDelta = asTrimmedString(data?.delta);
  if (
    !taskDetailAsLabel &&
    payload &&
    typeof payload.detail === "string" &&
    payload.detail.length > 0
  ) {
    const normalized = stripTrailingExitCode(payload.detail).output;
    if (normalized) {
      if (streamKind === "command_output") {
        entry.output = normalized;
      } else if (itemType === "command_execution") {
        entry.detail = normalized;
      } else if (streamKind === "file_change_output") {
        entry.detail = normalized;
      } else {
        entry.detail = normalized;
      }
    }
  } else if (!taskDetailAsLabel) {
    const resultText = extractToolResultText(payload, commandPreview);
    if (resultText) {
      entry.output = resultText;
    }
  }
  if (!taskDetailAsLabel && !entry.output && itemType === "command_execution") {
    const resultText = extractToolResultText(payload, commandPreview);
    if (resultText) {
      entry.output = resultText;
    }
  }
  if (!taskDetailAsLabel && !entry.output && streamKind === "command_output" && streamDelta) {
    const normalizedStreamOutput = normalizeToolOutputCandidate(
      stripTrailingExitCode(streamDelta).output ?? streamDelta,
      {
        detail: entry.detail,
        command: commandPreview.command,
        rawCommand: commandPreview.rawCommand,
      },
    );
    if (normalizedStreamOutput) {
      entry.output = normalizedStreamOutput;
    }
  }
  if (commandPreview.command) {
    entry.command = commandPreview.command;
  }
  if (commandPreview.rawCommand) {
    entry.rawCommand = commandPreview.rawCommand;
  }
  if (title) {
    entry.toolTitle = title;
  }
  if (itemType) {
    entry.itemType = itemType;
  }
  if (requestKind) {
    entry.requestKind = requestKind;
  }
  if (status) {
    entry.status = status;
  }
  if (toolCallId) {
    entry.toolCallId = toolCallId;
  }
  if (subagents.length > 0) {
    entry.subagents = subagents;
  }
  const subagentAction = extractSubagentAction(payload, entry);
  if (subagentAction) {
    entry.subagentAction = subagentAction;
  }
  const artifacts = extractToolDisplayArtifacts(payload, entry);
  const changedFiles = mergeChangedFiles(
    payloadChangedFiles,
    extractChangedFilesFromArtifacts(artifacts),
  );
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles;
  }
  if (artifacts.length > 0) {
    entry.artifacts = artifacts;
  }
  return entry;
}

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  const activeLifecycleIndexByWorkEntryId = new Map<string, number>();

  for (const entry of entries) {
    const workEntryId = activeToolLifecycleWorkEntryId(entry);
    const activeIndex = workEntryId ? activeLifecycleIndexByWorkEntryId.get(workEntryId) : undefined;
    const activeEntry = activeIndex === undefined ? undefined : collapsed[activeIndex];
    if (
      activeIndex !== undefined &&
      activeEntry &&
      shouldCollapseToolLifecycleEntries(activeEntry, entry)
    ) {
      const merged = mergeDerivedWorkLogEntries(activeEntry, entry);
      collapsed[activeIndex] = merged;
      trackActiveToolLifecycleEntry(activeLifecycleIndexByWorkEntryId, merged, activeIndex);
      continue;
    }

    collapsed.push(entry);
    trackActiveToolLifecycleEntry(activeLifecycleIndexByWorkEntryId, entry, collapsed.length - 1);
  }
  return collapsed;
}

function activeToolLifecycleWorkEntryId(entry: DerivedWorkLogEntry): string | undefined {
  if (!isToolLifecycleActivityKind(entry.activityKind)) {
    return undefined;
  }
  if (!entry.toolCallId || isSubagentLifecycleEntry(entry)) {
    return undefined;
  }
  return entry.id;
}

function trackActiveToolLifecycleEntry(
  activeLifecycleIndexByWorkEntryId: Map<string, number>,
  entry: DerivedWorkLogEntry,
  index: number,
): void {
  const workEntryId = activeToolLifecycleWorkEntryId(entry);
  if (!workEntryId) {
    return;
  }
  if (entry.activityKind === "tool.completed") {
    activeLifecycleIndexByWorkEntryId.delete(workEntryId);
    return;
  }
  activeLifecycleIndexByWorkEntryId.set(workEntryId, index);
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  if (isSubagentLifecycleEntry(previous) || isSubagentLifecycleEntry(next)) {
    return false;
  }
  if (!isToolLifecycleActivityKind(previous.activityKind)) {
    return false;
  }
  if (!isToolLifecycleActivityKind(next.activityKind)) {
    return false;
  }
  if (previous.activityKind === "tool.completed") {
    return false;
  }
  if (next.activityKind === "tool.started") {
    return false;
  }
  return (
    previous.toolCallId !== undefined &&
    previous.toolCallId === next.toolCallId &&
    previous.id === next.id
  );
}

function isToolLifecycleActivityKind(kind: OrchestrationThreadActivity["kind"]): boolean {
  return kind === "tool.started" || kind === "tool.updated" || kind === "tool.completed";
}

function isSubagentLifecycleEntry(entry: DerivedWorkLogEntry): boolean {
  return entry.itemType === "collab_agent_tool_call" || (entry.subagents?.length ?? 0) > 0;
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = mergeStreamText(previous.detail, next.detail);
  const output = mergeStreamText(previous.output, next.output);
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const toolTitle = next.toolTitle ?? previous.toolTitle;
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const status = next.status ?? previous.status;
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  const artifacts = mergeToolDisplayArtifacts(previous.artifacts, next.artifacts);
  const subagents = mergeSubagents(previous.subagents, next.subagents);
  const subagentAction = next.subagentAction ?? previous.subagentAction;
  return {
    ...previous,
    ...next,
    id: previous.id,
    createdAt: previous.createdAt,
    ...(detail ? { detail } : {}),
    ...(output ? { output } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(status ? { status } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(subagents.length > 0 ? { subagents } : {}),
    ...(subagentAction ? { subagentAction } : {}),
  };
}

function mergeStreamText(
  previous: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!previous) {
    return next;
  }
  if (!next || next === previous) {
    return previous;
  }
  if (next.startsWith(previous)) {
    return next;
  }
  if (previous.endsWith(next)) {
    return previous;
  }
  return `${previous}${next}`;
}

function mergeSubagents(
  previous: ReadonlyArray<WorkLogSubagent> | undefined,
  next: ReadonlyArray<WorkLogSubagent> | undefined,
): WorkLogSubagent[] {
  const merged = new Map<string, WorkLogSubagent>();
  for (const subagent of [...(previous ?? []), ...(next ?? [])]) {
    const key = subagent.providerThreadId ?? subagent.threadId ?? subagent.agentId;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, ...subagent } : subagent);
  }
  return [...merged.values()];
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) {
    return [];
  }
  return [...new Set(merged)];
}

function extractToolDisplayArtifacts(
  payload: Record<string, unknown> | null,
  entry: WorkLogEntry,
): ToolDisplayArtifact[] {
  const artifacts: ToolDisplayArtifact[] = [];
  const diffArtifact = extractToolDiffArtifact(payload, entry);
  if (diffArtifact) {
    artifacts.push(diffArtifact);
  }
  const commandArtifact = extractToolCommandArtifact(payload, entry);
  if (commandArtifact) {
    artifacts.push(commandArtifact);
  }
  const readArtifact = extractToolReadArtifact(payload, entry);
  if (readArtifact) {
    artifacts.push(readArtifact);
  }
  const searchArtifact = extractToolSearchArtifact(payload, entry);
  if (searchArtifact) {
    artifacts.push(searchArtifact);
  }
  if (entry.tone === "error" || entry.status === "error") {
    const message = (entry.detail ?? entry.output ?? entry.label).trim();
    if (message) {
      artifacts.push({
        type: "diagnostic",
        severity: "error",
        message,
      });
    }
  }
  if (artifacts.length === 0) {
    const text = (entry.output ?? entry.detail)?.trim();
    if (text) {
      artifacts.push({
        type: "raw",
        text,
      });
    }
  }
  return artifacts;
}

interface AcpDiffContent {
  path: string;
  oldText: string | null;
  newText: string;
}

class ToolDiffMetadataParseError extends Data.TaggedError("ToolDiffMetadataParseError")<{
  cause: unknown;
}> {}

function extractToolDiffArtifact(
  payload: Record<string, unknown> | null,
  entry: WorkLogEntry,
): ToolDiffArtifact | null {
  const fileChangeArtifact = extractCodexFileChangeDiffArtifact(payload, entry);
  if (fileChangeArtifact) {
    return fileChangeArtifact;
  }

  const diffContents = extractAcpDiffContents(payload);
  if (diffContents.length === 0) {
    return null;
  }

  const fileDiffs = diffContents
    .map((content) => toFileDiffMetadata(content))
    .filter((fileDiff): fileDiff is FileDiffMetadata => fileDiff !== null);
  if (fileDiffs.length === 0) {
    return null;
  }

  const unifiedDiff = fileDiffs
    .map((fileDiff) => serializeFileDiffMetadata(fileDiff))
    .filter((patch) => patch.trim().length > 0)
    .join("\n");
  if (unifiedDiff.trim().length === 0) {
    return null;
  }

  const files = fileDiffs.map((fileDiff) => ({
    path: fileDiff.name,
    additions: sumFileDiffAdditions(fileDiff),
    deletions: sumFileDiffDeletions(fileDiff),
  }));
  const source = entry.status === "completed" ? "result" : "preview";
  return {
    type: "diff",
    format: "unified",
    source,
    title: entry.toolTitle ?? entry.label,
    summary: summarizeDiffArtifactFiles(files),
    files,
    unifiedDiff,
    ...(source === "preview" ? { isPreview: true } : {}),
  };
}

function extractCodexFileChangeDiffArtifact(
  payload: Record<string, unknown> | null,
  entry: WorkLogEntry,
): ToolDiffArtifact | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  if (item?.type !== "fileChange" || !Array.isArray(item.changes)) {
    return null;
  }

  const files: ToolDiffArtifactFile[] = [];
  const patches: string[] = [];
  for (const change of item.changes) {
    const record = asRecord(change);
    const path = asTrimmedString(record?.path);
    const diff = asTrimmedString(record?.diff);
    if (!path || !diff) {
      continue;
    }

    const lines = diff.split("\n");
    files.push({
      path,
      additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
      deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
    });
    patches.push(
      [
        `--- ${formatPatchPath("a", path)}`,
        `+++ ${formatPatchPath("b", path)}`,
        diff.trimEnd(),
      ].join("\n"),
    );
  }
  if (patches.length === 0) {
    return null;
  }

  const source = entry.status === "completed" ? "result" : "preview";
  return {
    type: "diff",
    format: "unified",
    source,
    title: entry.toolTitle ?? entry.label,
    summary: summarizeDiffArtifactFiles(files),
    files,
    unifiedDiff: `${patches.join("\n")}\n`,
    ...(source === "preview" ? { isPreview: true } : {}),
  };
}

function extractAcpDiffContents(payload: Record<string, unknown> | null): AcpDiffContent[] {
  const data = asRecord(payload?.data);
  const contents: AcpDiffContent[] = [];
  collectAcpDiffContents(data?.content, contents, 0);
  return contents;
}

function collectAcpDiffContents(
  value: unknown,
  target: AcpDiffContent[],
  depth: number,
): void {
  if (depth > 4) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectAcpDiffContents(entry, target, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  if (record.type === "diff") {
    const path = asTrimmedString(record.path);
    if (!path || typeof record.newText !== "string") {
      return;
    }
    if ("oldText" in record && record.oldText !== null && typeof record.oldText !== "string") {
      return;
    }
    target.push({
      path,
      oldText: typeof record.oldText === "string" ? record.oldText : null,
      newText: record.newText,
    });
    return;
  }

  if ("content" in record) {
    collectAcpDiffContents(record.content, target, depth + 1);
  }
}

function toFileDiffMetadata(content: AcpDiffContent): FileDiffMetadata | null {
  if (content.oldText === content.newText) {
    return null;
  }

  const oldFile: FileContents = {
    name: content.path,
    contents: content.oldText ?? "",
  };
  const newFile: FileContents = {
    name: content.path,
    contents: content.newText,
  };

  return Option.getOrNull(
    Effect.runSync(
      Effect.try({
        try: () => parseDiffFromFile(oldFile, newFile, undefined, true),
        catch: (cause) => new ToolDiffMetadataParseError({ cause }),
      }).pipe(Effect.option),
    ),
  );
}

function serializeFileDiffMetadata(fileDiff: FileDiffMetadata): string {
  const previousPath = fileDiff.prevName ?? fileDiff.name;
  const lines = [
    `diff --git ${formatPatchPath("a", previousPath)} ${formatPatchPath("b", fileDiff.name)}`,
  ];

  if (fileDiff.type === "new") {
    lines.push("new file mode 100644");
    lines.push("--- /dev/null");
    lines.push(`+++ ${formatPatchPath("b", fileDiff.name)}`);
  } else if (fileDiff.type === "deleted") {
    lines.push("deleted file mode 100644");
    lines.push(`--- ${formatPatchPath("a", previousPath)}`);
    lines.push("+++ /dev/null");
  } else {
    lines.push(`--- ${formatPatchPath("a", previousPath)}`);
    lines.push(`+++ ${formatPatchPath("b", fileDiff.name)}`);
  }

  for (const hunk of fileDiff.hunks) {
    appendSerializedHunk(lines, fileDiff, hunk);
  }

  return `${lines.join("\n")}\n`;
}

function formatPatchPath(prefix: "a" | "b", path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  return `${prefix}/${normalizedPath}`;
}

function appendSerializedHunk(target: string[], fileDiff: FileDiffMetadata, hunk: Hunk): void {
  target.push(hunk.hunkSpecs?.trimEnd() ?? formatHunkHeader(hunk));
  for (const content of hunk.hunkContent) {
    if (content.type === "context") {
      appendSerializedLines(
        target,
        " ",
        fileDiff.additionLines,
        content.additionLineIndex,
        content.lines,
      );
      continue;
    }
    appendSerializedLines(
      target,
      "-",
      fileDiff.deletionLines,
      content.deletionLineIndex,
      content.deletions,
    );
    appendSerializedLines(
      target,
      "+",
      fileDiff.additionLines,
      content.additionLineIndex,
      content.additions,
    );
  }
}

function formatHunkHeader(hunk: Hunk): string {
  return `@@ -${formatHunkRange(hunk.deletionStart, hunk.deletionCount)} +${formatHunkRange(
    hunk.additionStart,
    hunk.additionCount,
  )} @@`;
}

function formatHunkRange(start: number, count: number): string {
  return `${start},${count}`;
}

function appendSerializedLines(
  target: string[],
  prefix: " " | "-" | "+",
  source: ReadonlyArray<string>,
  start: number,
  count: number,
): void {
  if (start < 0 || count <= 0) {
    return;
  }
  for (let offset = 0; offset < count; offset += 1) {
    const line = source[start + offset];
    if (line === undefined) {
      continue;
    }
    target.push(`${prefix}${stripSingleTrailingLineEnding(line)}`);
  }
}

function stripSingleTrailingLineEnding(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }
  if (value.endsWith("\n")) {
    return value.slice(0, -1);
  }
  return value;
}

function sumFileDiffAdditions(fileDiff: FileDiffMetadata): number {
  return fileDiff.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
}

function sumFileDiffDeletions(fileDiff: FileDiffMetadata): number {
  return fileDiff.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
}

function summarizeDiffArtifactFiles(files: ReadonlyArray<ToolDiffArtifactFile>): string | undefined {
  const firstPath = files[0]?.path;
  if (!firstPath) {
    return undefined;
  }
  return files.length === 1 ? firstPath : `${firstPath} +${files.length - 1} more`;
}

function extractToolCommandArtifact(
  payload: Record<string, unknown> | null,
  entry: WorkLogEntry,
): ToolCommandArtifact | null {
  if (entry.itemType !== "command_execution" && !entry.command) {
    return null;
  }

  const command = entry.command?.trim();
  const output = entry.output?.trim();
  const metadata = extractCommandArtifactMetadata(payload);
  if (!command && !output && !hasCommandArtifactMetadata(metadata)) {
    return null;
  }

  return {
    type: "command",
    ...(command ? { command } : {}),
    ...(output ? { output } : {}),
    ...metadata,
    ...(entry.status === "running" ? { isPartial: true } : {}),
  };
}

function extractToolReadArtifact(
  payload: Record<string, unknown> | null,
  entry: WorkLogEntry,
): ToolReadArtifact | null {
  if (entry.itemType !== "file_read") {
    return null;
  }
  const output = (entry.output ?? entry.detail)?.trim();
  const path = extractChangedFiles(payload)[0];
  const truncated = extractTruncatedMetadata(payload);
  if (!path && !output && truncated === undefined) {
    return null;
  }
  return {
    type: "read",
    ...(path ? { path } : {}),
    ...(output ? { output } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(entry.status === "running" ? { isPartial: true } : {}),
  };
}

function extractToolSearchArtifact(
  payload: Record<string, unknown> | null,
  entry: WorkLogEntry,
): ToolSearchArtifact | null {
  if (entry.itemType !== "file_search") {
    return null;
  }
  const data = asRecord(payload?.data);
  const output = (entry.output ?? entry.detail)?.trim();
  const query =
    findStringMetadata(data, ["query", "pattern", "glob", "search", "regex"], 0) ??
    asTrimmedString(payload?.detail);
  const matchedFiles = extractChangedFiles(payload);
  const truncated = extractTruncatedMetadata(payload);
  if (!query && !output && matchedFiles.length === 0 && truncated === undefined) {
    return null;
  }
  return {
    type: "search",
    ...(query ? { query } : {}),
    ...(output ? { output } : {}),
    ...(matchedFiles.length > 0 ? { matchedFiles } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(entry.status === "running" ? { isPartial: true } : {}),
  };
}

function extractTruncatedMetadata(payload: Record<string, unknown> | null): boolean | undefined {
  const data = asRecord(payload?.data);
  return (
    findBooleanMetadata(data, ["truncated", "isTruncated"], 0) ??
    findBooleanMetadata(asRecord(data?.result), ["truncated", "isTruncated"], 0) ??
    findBooleanMetadata(asRecord(data?.rawOutput), ["truncated", "isTruncated"], 0)
  );
}

function extractCommandArtifactMetadata(
  payload: Record<string, unknown> | null,
): Omit<ToolCommandArtifact, "type" | "command" | "output" | "isPartial"> {
  const data = asRecord(payload?.data);
  const detail = typeof payload?.detail === "string" ? stripTrailingExitCode(payload.detail) : null;
  const exitCode =
    detail?.exitCode ??
    findNumericMetadata(data, ["exitCode", "exit_code"], 0) ??
    findNumericMetadata(asRecord(data?.result), ["exitCode", "exit_code"], 0) ??
    findNumericMetadata(asRecord(data?.rawOutput), ["exitCode", "exit_code"], 0);
  const truncated =
    findBooleanMetadata(data, ["truncated", "isTruncated"], 0) ??
    findBooleanMetadata(asRecord(data?.result), ["truncated", "isTruncated"], 0) ??
    findBooleanMetadata(asRecord(data?.rawOutput), ["truncated", "isTruncated"], 0);
  const fullOutputPath =
    findStringMetadata(data, ["fullOutputPath", "full_output_path"], 0) ??
    findStringMetadata(asRecord(data?.result), ["fullOutputPath", "full_output_path"], 0) ??
    findStringMetadata(asRecord(data?.rawOutput), ["fullOutputPath", "full_output_path"], 0);
  const durationMs =
    findNumericMetadata(data, ["durationMs", "duration_ms"], 0) ??
    findNumericMetadata(asRecord(data?.result), ["durationMs", "duration_ms"], 0) ??
    findNumericMetadata(asRecord(data?.rawOutput), ["durationMs", "duration_ms"], 0);

  return {
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(fullOutputPath ? { fullOutputPath } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function hasCommandArtifactMetadata(
  metadata: Omit<ToolCommandArtifact, "type" | "command" | "output" | "isPartial">,
): boolean {
  return (
    metadata.exitCode !== undefined ||
    metadata.truncated !== undefined ||
    metadata.fullOutputPath !== undefined ||
    metadata.durationMs !== undefined
  );
}

const COMMAND_METADATA_NESTED_KEYS = ["item", "result", "rawOutput", "metadata", "details"] as const;

function findNumericMetadata(
  value: Record<string, unknown> | null,
  keys: ReadonlyArray<string>,
  depth: number,
): number | undefined {
  if (!value || depth > 3) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  for (const key of COMMAND_METADATA_NESTED_KEYS) {
    const nested = findNumericMetadata(asRecord(value[key]), keys, depth + 1);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function findBooleanMetadata(
  value: Record<string, unknown> | null,
  keys: ReadonlyArray<string>,
  depth: number,
): boolean | undefined {
  if (!value || depth > 3) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }
  for (const key of COMMAND_METADATA_NESTED_KEYS) {
    const nested = findBooleanMetadata(asRecord(value[key]), keys, depth + 1);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function findStringMetadata(
  value: Record<string, unknown> | null,
  keys: ReadonlyArray<string>,
  depth: number,
): string | undefined {
  if (!value || depth > 3) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = asTrimmedString(value[key]);
    if (candidate) {
      return candidate;
    }
  }
  for (const key of COMMAND_METADATA_NESTED_KEYS) {
    const nested = findStringMetadata(asRecord(value[key]), keys, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function extractChangedFilesFromArtifacts(
  artifacts: ReadonlyArray<ToolDisplayArtifact>,
): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (artifact.type === "diff") {
      for (const file of artifact.files) {
        pushChangedFile(changedFiles, seen, file.path);
      }
      continue;
    }
    if (artifact.type === "read") {
      pushChangedFile(changedFiles, seen, artifact.path);
      continue;
    }
    if (artifact.type === "search") {
      for (const file of artifact.matchedFiles ?? []) {
        pushChangedFile(changedFiles, seen, file);
      }
    }
  }
  return changedFiles;
}

function mergeToolDisplayArtifacts(
  previous: ReadonlyArray<ToolDisplayArtifact> | undefined,
  next: ReadonlyArray<ToolDisplayArtifact> | undefined,
): ToolDisplayArtifact[] {
  const merged = new Map<string, ToolDisplayArtifact>();
  for (const artifact of [...(previous ?? []), ...(next ?? [])]) {
    const key = toolDisplayArtifactKey(artifact);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeToolDisplayArtifact(existing, artifact) : artifact);
  }
  return [...merged.values()];
}

function toolDisplayArtifactKey(artifact: ToolDisplayArtifact): string {
  if (artifact.type === "diff") {
    return `diff:${artifact.files
      .map((file) => file.path)
      .toSorted()
      .join("\0")}`;
  }
  if (artifact.type === "command") {
    return `command:${artifact.command ?? ""}`;
  }
  if (artifact.type === "read") {
    return `read:${artifact.path ?? ""}`;
  }
  if (artifact.type === "search") {
    return `search:${artifact.query ?? ""}`;
  }
  if (artifact.type === "diagnostic") {
    return `diagnostic:${artifact.severity}:${artifact.message}`;
  }
  return "raw";
}

function mergeToolDisplayArtifact(
  previous: ToolDisplayArtifact,
  next: ToolDisplayArtifact,
): ToolDisplayArtifact {
  if (previous.type === "diff" && next.type === "diff") {
    if (previous.source === "result" && next.source !== "result") {
      return previous;
    }
    return next;
  }
  if (previous.type === "command" && next.type === "command") {
    return mergeToolCommandArtifacts(previous, next);
  }
  if (previous.type === "read" && next.type === "read") {
    return mergeToolReadArtifacts(previous, next);
  }
  if (previous.type === "search" && next.type === "search") {
    return mergeToolSearchArtifacts(previous, next);
  }
  if (previous.type === "raw" && next.type === "raw") {
    return {
      type: "raw",
      text: mergeStreamText(previous.text, next.text) ?? next.text,
    };
  }
  return next;
}

function mergeToolCommandArtifacts(
  previous: ToolCommandArtifact,
  next: ToolCommandArtifact,
): ToolCommandArtifact {
  const command = next.command ?? previous.command;
  const output = mergeStreamText(previous.output, next.output);
  const exitCode = next.exitCode ?? previous.exitCode;
  const truncated = next.truncated ?? previous.truncated;
  const fullOutputPath = next.fullOutputPath ?? previous.fullOutputPath;
  const durationMs = next.durationMs ?? previous.durationMs;
  return {
    type: "command",
    ...(command ? { command } : {}),
    ...(output ? { output } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(fullOutputPath ? { fullOutputPath } : {}),
    ...(next.isPartial === true ? { isPartial: true } : {}),
  };
}

function mergeToolReadArtifacts(
  previous: ToolReadArtifact,
  next: ToolReadArtifact,
): ToolReadArtifact {
  const path = next.path ?? previous.path;
  const output = mergeStreamText(previous.output, next.output);
  const truncated = next.truncated ?? previous.truncated;
  return {
    type: "read",
    ...(path ? { path } : {}),
    ...(output ? { output } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(next.isPartial === true ? { isPartial: true } : {}),
  };
}

function mergeToolSearchArtifacts(
  previous: ToolSearchArtifact,
  next: ToolSearchArtifact,
): ToolSearchArtifact {
  const query = next.query ?? previous.query;
  const output = mergeStreamText(previous.output, next.output);
  const matchedFiles = mergeChangedFiles(previous.matchedFiles, next.matchedFiles);
  const truncated = next.truncated ?? previous.truncated;
  return {
    type: "search",
    ...(query ? { query } : {}),
    ...(output ? { output } : {}),
    ...(matchedFiles.length > 0 ? { matchedFiles } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
    ...(next.isPartial === true ? { isPartial: true } : {}),
  };
}

function resolveWorkLogStatus(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown> | null,
  tone: WorkLogEntry["tone"],
): WorkLogEntry["status"] | undefined {
  if (tone === "error") {
    return "error";
  }

  const payloadStatus = typeof payload?.status === "string" ? payload.status : null;
  if (payloadStatus === "failed") {
    return "error";
  }

  switch (activity.kind) {
    case "tool.updated":
      return "running";
    case "tool.started":
      return "running";
    case "task.started":
      return "running";
    case "tool.completed":
      return "completed";
    case "task.progress":
      return "running";
    case "task.completed":
      return "completed";
    default:
      return undefined;
  }
}

function toLatestProposedPlanState(proposedPlan: ProposedPlan): LatestProposedPlanState {
  return {
    id: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) {
      return null;
    }
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) {
    return {
      executable: trimmed,
      rest: "",
    };
  }

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/i,
  },
] as const;

function findShellWrapperSpec(shell: string) {
  return SHELL_WRAPPER_SPECS.find((spec) =>
    (spec.executables as ReadonlyArray<string>).includes(shell),
  );
}

function unwrapCommandRemainder(value: string, wrapperFlagPattern: RegExp): string | null {
  const match = wrapperFlagPattern.exec(value);
  if (!match) {
    return null;
  }

  const command = value.slice(match.index + match[0].length).trim();
  if (command.length === 0) {
    return null;
  }

  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : null;
}

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) {
    return value;
  }

  const shell = executableBasename(split.executable);
  if (!shell) {
    return value;
  }

  const spec = findShellWrapperSpec(shell);
  if (!spec) {
    return value;
  }

  return unwrapCommandRemainder(split.rest, spec.wrapperFlagPattern) ?? value;
}

function formatCommandArrayPart(value: string): string {
  return /[\s"'`]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function formatCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null);
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => formatCommandArrayPart(part)).join(" ");
}

function normalizeCommandValue(value: unknown): string | null {
  const formatted = formatCommandValue(value);
  return formatted ? unwrapKnownShellCommandWrapper(formatted) : null;
}

function toRawToolCommand(value: unknown, normalizedCommand: string | null): string | null {
  const formatted = formatCommandValue(value);
  if (!formatted || normalizedCommand === null) {
    return null;
  }
  return formatted === normalizedCommand ? null : formatted;
}

function extractToolCommand(payload: Record<string, unknown> | null): {
  command: string | null;
  rawCommand: string | null;
} {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const itemInput = asRecord(item?.input);
  const itemType = asTrimmedString(payload?.itemType);
  const detail = asTrimmedString(payload?.detail);
  const candidates: unknown[] = [
    item?.command,
    itemInput?.command,
    itemResult?.command,
    data?.command,
    itemType === "command_execution" && detail ? stripTrailingExitCode(detail).output : null,
  ];

  for (const candidate of candidates) {
    const command = normalizeCommandValue(candidate);
    if (!command) {
      continue;
    }
    return {
      command,
      rawCommand: toRawToolCommand(candidate, command),
    };
  }

  return {
    command: null,
    rawCommand: null,
  };
}

function extractToolResultText(
  payload: Record<string, unknown> | null,
  commandPreview?: { command: string | null; rawCommand: string | null },
): string | null {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemResult = asRecord(item?.result);
  const directResult = asRecord(data?.result);
  const detail = asTrimmedString(payload?.detail);
  const candidates: unknown[] = [
    item?.aggregatedOutput,
    itemResult?.content,
    itemResult?.output,
    directResult?.content,
    directResult?.output,
    extractRawToolOutputText(data?.rawOutput),
  ];

  for (const candidate of candidates) {
    const text = asTrimmedString(candidate);
    if (!text) {
      continue;
    }
    const normalized = stripTrailingExitCode(text).output;
    const output = normalizeToolOutputCandidate(normalized, {
      detail,
      command: commandPreview?.command ?? null,
      rawCommand: commandPreview?.rawCommand ?? null,
    });
    if (output) {
      return output;
    }
  }

  return null;
}

function extractRawToolOutputText(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractRawToolOutputText(entry))
      .filter((entry): entry is string => entry !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const prioritizedKeys = ["stdout", "stderr", "output", "content", "text", "message", "result"];
  for (const key of prioritizedKeys) {
    const nested = extractRawToolOutputText(record[key]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function normalizeToolOutputCandidate(
  candidate: string | null,
  context: {
    detail: string | null | undefined;
    command: string | null | undefined;
    rawCommand: string | null | undefined;
  },
): string | null {
  const normalized = candidate?.trim();
  if (!normalized) {
    return null;
  }

  const detail = context.detail?.trim() ?? null;
  if (detail && isEquivalentToolText(normalized, detail)) {
    return null;
  }

  const command = context.command?.trim() ?? null;
  if (command && isEquivalentToolText(normalized, command)) {
    return null;
  }

  const rawCommand = context.rawCommand?.trim() ?? null;
  if (rawCommand && isEquivalentToolText(normalized, rawCommand)) {
    return null;
  }

  const unwrappedCandidate = normalizeCommandValue(normalized);
  if (command && unwrappedCandidate && isEquivalentToolText(unwrappedCandidate, command)) {
    return null;
  }

  return normalized;
}

function isEquivalentToolText(left: string, right: string): boolean {
  return left.trim() === right.trim();
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title);
}

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null,
): WorkLogEntry["itemType"] | undefined {
  if (typeof payload?.itemType === "string" && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType;
  }
  return undefined;
}

function extractWorkLogSubagents(
  payload: Record<string, unknown> | null,
): ReadonlyArray<WorkLogSubagent> {
  const item = extractPayloadItem(payload);
  if (!item) {
    return [];
  }

  const threadIds = decodeSubagentReceiverThreadIds(item);
  const agents = decodeSubagentReceiverAgents(item, threadIds);
  const states = decodeSubagentAgentStates(item);
  const byThreadId = new Map<string, WorkLogSubagent>();

  for (const agent of agents) {
    byThreadId.set(agent.providerThreadId, {
      threadId: agent.providerThreadId,
      providerThreadId: agent.providerThreadId,
      agentId: agent.agentId,
      nickname: agent.nickname,
      role: agent.role,
      model: agent.model,
      prompt: agent.prompt,
      title: resolveSubagentTitle(agent.nickname, agent.role),
      statusLabel: "Started",
      isActive: true,
    });
  }

  for (const state of Object.values(states)) {
    const existing = byThreadId.get(state.threadId);
    const statusLabel = resolveSubagentStatusLabel(state.status);
    byThreadId.set(state.threadId, {
      ...existing,
      threadId: state.threadId,
      providerThreadId: existing?.providerThreadId ?? state.threadId,
      agentId: state.agentId ?? existing?.agentId,
      nickname: state.nickname ?? existing?.nickname,
      role: state.role ?? existing?.role,
      model: state.model ?? existing?.model,
      prompt: state.prompt ?? existing?.prompt,
      rawStatus: state.status ?? existing?.rawStatus,
      latestUpdate: state.message ?? existing?.latestUpdate,
      title: resolveSubagentTitle(
        state.nickname ?? existing?.nickname,
        state.role ?? existing?.role,
      ),
      statusLabel,
      isActive: statusLabel !== "Completed" && statusLabel !== "Failed",
    });
  }

  return [...byThreadId.values()];
}

function extractSubagentAction(
  payload: Record<string, unknown> | null,
  entry: WorkLogEntry,
): WorkLogSubagentAction | null {
  if (entry.itemType !== "collab_agent_tool_call") {
    return null;
  }
  const item = extractPayloadItem(payload);
  const prompt = asTrimmedString(item?.prompt ?? item?.task ?? item?.message);
  const model = asTrimmedString(item?.model ?? item?.modelName ?? item?.model_name);
  return {
    tool: asTrimmedString(payload?.title) ?? "Task",
    status: entry.status ?? "running",
    summaryText: entry.detail ?? entry.label,
    ...(model ? { model } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

function extractPayloadItem(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!payload) {
    return null;
  }
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  const item =
    data?.item && typeof data.item === "object" ? (data.item as Record<string, unknown>) : null;
  return item ?? payload;
}

function resolveSubagentTitle(
  nickname: string | undefined,
  role: string | undefined,
): string | undefined {
  return nickname ?? role;
}

function resolveSubagentStatusLabel(status: string | undefined): string | undefined {
  switch (status) {
    case "completed":
    case "success":
      return "Completed";
    case "failed":
    case "error":
      return "Failed";
    case "running":
    case "in_progress":
      return "Running";
    default:
      return status;
  }
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (isProviderRequestKind(payload?.requestKind)) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function isProviderRequestKind(value: unknown): value is ProviderRequestKind {
  switch (value) {
    case "command":
    case "file-read":
    case "file-change":
    case "permissions":
    case "mcp-elicitation":
    case "dynamic-tool":
    case "auth-refresh":
      return true;
    default:
      return false;
  }
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
    "content",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(asRecord(payload?.data), changedFiles, seen, 0);
  return changedFiles;
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
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

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind);
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison;
  }

  return left.id.localeCompare(right.id);
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") {
    return 0;
  }
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) {
    return 1;
  }
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) {
    return 2;
  }
  return 1;
}

export function hasToolActivityForTurn(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined,
): boolean {
  if (!turnId) return false;
  return activities.some((activity) => activity.turnId === turnId && activity.tone === "tool");
}

export function deriveTimelineEntries(
  messages: ChatMessage[],
  proposedPlans: ProposedPlan[],
  workEntries: WorkLogEntry[],
): TimelineEntry[] {
  const messageRows: TimelineEntry[] = messages.map((message) => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  }));
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: `work:${entry.id}`,
    kind: "work",
    createdAt: entry.createdAt,
    entry,
  }));
  return [...messageRows, ...proposedPlanRows, ...workRows].toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function deriveCompletionDividerBeforeEntryId(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  latestTurn: Pick<
    OrchestrationLatestTurn,
    "assistantMessageId" | "startedAt" | "completedAt"
  > | null,
): string | null {
  if (!latestTurn?.startedAt || !latestTurn.completedAt) {
    return null;
  }

  if (latestTurn.assistantMessageId) {
    const exactMatch = timelineEntries.find(
      (timelineEntry) =>
        timelineEntry.kind === "message" &&
        timelineEntry.message.role === "assistant" &&
        timelineEntry.message.id === latestTurn.assistantMessageId,
    );
    if (exactMatch) {
      return exactMatch.id;
    }
  }

  const turnStartedAt = Date.parse(latestTurn.startedAt);
  const turnCompletedAt = Date.parse(latestTurn.completedAt);
  if (Number.isNaN(turnStartedAt) || Number.isNaN(turnCompletedAt)) {
    return null;
  }

  let inRangeMatch: string | null = null;
  let fallbackMatch: string | null = null;
  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message" || timelineEntry.message.role !== "assistant") {
      continue;
    }
    const messageAt = Date.parse(timelineEntry.message.createdAt);
    if (Number.isNaN(messageAt) || messageAt < turnStartedAt) {
      continue;
    }
    fallbackMatch = timelineEntry.id;
    if (messageAt <= turnCompletedAt) {
      inRangeMatch = timelineEntry.id;
    }
  }
  return inRangeMatch ?? fallbackMatch;
}

export function inferCheckpointTurnCountByTurnId(
  summaries: TurnDiffSummary[],
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (!session || session.status === "closed") return "disconnected";
  if (session.status === "connecting") return "connecting";
  if (session.status === "running") return "running";
  return "ready";
}
