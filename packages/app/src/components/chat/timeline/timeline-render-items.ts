import {
  type MessageId,
  type RuntimeDisplayTimelineExtensionUiRequestItem,
  type RuntimeDisplayTimelineMessageItem,
  type RuntimeDisplayTimelineToolItem,
} from "@multi/contracts";
import { DEFAULT_CONVERSATION_DENSITY, type ConversationDensity } from "@multi/contracts/settings";
import {
  shouldGroupEdits,
  shouldGroupShells,
  shouldGroupToolCalls,
} from "@multi/shared/conversation-density";

import {
  formatDuration,
  type PendingApproval,
  type TimelineEntry,
  type ToolDiffArtifact,
  type WaitingPhase,
  type WorkLogEntry,
} from "../../../session-logic";
import { type ChatMessage, type ProposedPlan } from "../../../types";
import { formatProjectRelativePath } from "../shared/file-path-display";
export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export interface WorkGroupSummary {
  action: string;
  details: string;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TimelineMessageStep {
  kind: "message";
  id: string;
  createdAt: string;
  message: ChatMessage;
  durationStart: string;
  editAvailable: boolean;
  pairId: MessageId | null;
  messageIndex: number;
}

export interface TimelineProposedPlanStep {
  kind: "proposed-plan";
  id: string;
  createdAt: string;
  proposedPlan: ProposedPlan;
}

export interface TimelineRuntimeToolStep {
  kind: "runtime-tool";
  id: string;
  createdAt: string;
  tool: RuntimeDisplayTimelineToolItem;
}

export interface TimelineRuntimeTaskStep {
  kind: "runtime-task";
  id: string;
  createdAt: string;
  tool: RuntimeDisplayTimelineToolItem;
}

export interface TimelineRuntimeThinkingStep {
  kind: "runtime-thinking";
  id: string;
  createdAt: string;
  message: RuntimeDisplayTimelineMessageItem;
}

export interface TimelineRuntimeExtensionUiRequestStep {
  kind: "runtime-extension-ui-request";
  id: string;
  createdAt: string;
  request: RuntimeDisplayTimelineExtensionUiRequestItem;
}

export interface TimelineWorkStep {
  kind: "work";
  id: string;
  createdAt: string;
  entry: WorkLogEntry;
}

export interface TimelineWaitingStep {
  kind: "waiting";
  id: string;
  createdAt: string | null;
  phase: WaitingPhase;
  elapsedStartedAt: string | null;
}

export type TimelineStep =
  | TimelineMessageStep
  | TimelineProposedPlanStep
  | TimelineRuntimeThinkingStep
  | TimelineRuntimeToolStep
  | TimelineRuntimeTaskStep
  | TimelineRuntimeExtensionUiRequestStep
  | TimelineWorkStep
  | TimelineWaitingStep;

export type TimelineGroupedStep =
  | TimelineRuntimeThinkingStep
  | TimelineRuntimeToolStep
  | TimelineWorkStep
  | TimelineMessageStep;

/** Steps a runtime work group can hold: tools, thinking, and short assistant text. */
type RuntimeGroupStep = TimelineRuntimeThinkingStep | TimelineRuntimeToolStep | TimelineMessageStep;

export interface GroupedSteps {
  id: string;
  createdAt: string;
  completedDurationLabel: string | null;
  isRunning: boolean;
  isTailGroup: boolean;
  isThinkingGroup: boolean;
  isCommandGroup: boolean;
  isWaitingGroup: boolean;
  isBrowserGroup: boolean;
  summary: WorkGroupSummary;
  steps: TimelineGroupedStep[];
  entries: WorkLogEntry[];
}

export const RUNTIME_DEFAULT_MIN_GROUP_SIZE = 1;
export const RUNTIME_EXPLORE_ONLY_MIN_GROUP_SIZE = 3;

export const GROUPABLE_TEXT_MAX_LENGTH = 100;
export const GROUPABLE_TEXT_MAX_LINES = 2;

const BLOCK_MARKDOWN_PATTERN = /```|~~~|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\|.*\||^(?: {4}|\t)\S/m;

// Short, at most two lines, and no block-level markdown (code fence, heading, list, table).
// Longer or structured assistant text stays a standalone message row.
export function isShortPlainText(text: string): boolean {
  const trimmed = text.trim();
  return !(
    trimmed.length > GROUPABLE_TEXT_MAX_LENGTH ||
    trimmed.split("\n").length > GROUPABLE_TEXT_MAX_LINES ||
    BLOCK_MARKDOWN_PATTERN.test(text)
  );
}

/** Meta narration rows (tool.summary) never join work groups. */
export function isNeverGroupableWorkEntry(entry: WorkLogEntry): boolean {
  return entry.isToolSummary === true;
}

export type PendingApprovalRequestKind = PendingApproval["requestKind"];

export const EMPTY_PENDING_APPROVAL_KINDS: ReadonlySet<PendingApprovalRequestKind> = new Set();

interface PendingApprovalToolFlags {
  isCommand: boolean;
  isEdit: boolean;
  isRead: boolean;
  isMcp: boolean;
  isDynamic: boolean;
}

// Approval activities carry no tool-call id, so a pending approval is correlated to the
// running tool of its request kind. "permissions" requests are not tool-shaped and pause
// whichever tool is executing.
function matchesPendingApprovalKinds(
  kinds: ReadonlySet<PendingApprovalRequestKind>,
  flags: PendingApprovalToolFlags,
): boolean {
  if (kinds.size === 0) {
    return false;
  }
  if (kinds.has("permissions")) {
    return true;
  }
  return (
    (kinds.has("command") && flags.isCommand) ||
    (kinds.has("file-change") && flags.isEdit) ||
    (kinds.has("file-read") && flags.isRead) ||
    (kinds.has("mcp-elicitation") && flags.isMcp) ||
    (kinds.has("dynamic-tool") && flags.isDynamic)
  );
}

export function workEntryHasPendingApproval(
  entry: WorkLogEntry,
  kinds: ReadonlySet<PendingApprovalRequestKind>,
): boolean {
  if (entry.status !== "running" || entry.tone === "thinking") {
    return false;
  }
  return matchesPendingApprovalKinds(kinds, {
    isCommand: isCommandWorkEntry(entry),
    isEdit: isWorkEditEntry(entry),
    isRead:
      entry.requestKind === "file-read" ||
      entry.itemType === "file_read" ||
      Boolean(entry.artifacts?.some((artifact) => artifact.type === "read")),
    isMcp: entry.itemType === "mcp_tool_call",
    isDynamic: entry.itemType === "dynamic_tool_call",
  });
}

export function runtimeToolHasPendingApproval(
  tool: RuntimeDisplayTimelineToolItem,
  kinds: ReadonlySet<PendingApprovalRequestKind>,
): boolean {
  if (tool.status !== "running") {
    return false;
  }
  const display = tool.display;
  const toolName = tool.toolName.toLowerCase();
  return matchesPendingApprovalKinds(kinds, {
    isCommand: display?.kind === "shell" || toolName === "shell" || typeof tool.command === "string",
    isEdit:
      display?.kind === "edit" ||
      toolName.includes("edit") ||
      toolName.includes("write") ||
      toolName.includes("patch") ||
      toolName.includes("delete"),
    isRead: display?.kind === "read" || toolName === "read",
    isMcp: display?.kind === "mcp",
    isDynamic: false,
  });
}

/** Cursor zIb parity: a step awaiting approval breaks out of activity groups. */
export function groupedStepHasPendingApproval(
  step: TimelineGroupedStep,
  kinds: ReadonlySet<PendingApprovalRequestKind>,
): boolean {
  if (kinds.size === 0) {
    return false;
  }
  if (step.kind === "work") {
    return workEntryHasPendingApproval(step.entry, kinds);
  }
  if (step.kind === "runtime-tool") {
    return runtimeToolHasPendingApproval(step.tool, kinds);
  }
  return false;
}

/** Assistant narration that may live inside a collapsed work-group preview. */
export function isGroupedNarrationMessageStep(
  step: TimelineGroupedStep,
): step is TimelineMessageStep {
  return (
    step.kind === "message" &&
    step.message.role === "assistant" &&
    isShortPlainText(step.message.text.trim())
  );
}

/**
 * Single eligibility gate for collapsed preview steps. Derive and render both consult this
 * so preview never shows transcript-scale content.
 */
export function isPreviewableWorkGroupStep(step: TimelineGroupedStep): boolean {
  if (step.kind === "work" && step.entry.isToolSummary) {
    return false;
  }
  if (step.kind === "message") {
    return isGroupedNarrationMessageStep(step);
  }
  if (step.kind === "runtime-thinking") {
    return (step.message.thinking?.trim().length ?? 0) > 0;
  }
  return true;
}

function releaseIneligibleRuntimeGroupMessages(steps: ReadonlyArray<TimelineGroupedStep>): {
  groupSteps: TimelineGroupedStep[];
  releasedMessages: TimelineMessageStep[];
} {
  const groupSteps: TimelineGroupedStep[] = [];
  const releasedMessages: TimelineMessageStep[] = [];
  for (const step of steps) {
    if (step.kind === "message" && !isGroupedNarrationMessageStep(step)) {
      releasedMessages.push(step);
      continue;
    }
    groupSteps.push(step);
  }
  return { groupSteps, releasedMessages };
}

function pushSingleTimelineStep(items: TimelineRenderItem[], step: TimelineGroupedStep): void {
  items.push({
    kind: "single",
    id: step.id,
    createdAt: step.createdAt,
    step,
  });
}

export interface WaitingGroupedSteps {
  id: string;
  createdAt: string | null;
  steps: readonly [TimelineWaitingStep];
}

export type TimelineRenderItem =
  | {
      kind: "single";
      id: string;
      createdAt: string;
      step:
        | TimelineMessageStep
        | TimelineProposedPlanStep
        | TimelineRuntimeThinkingStep
        | TimelineRuntimeToolStep
        | TimelineRuntimeTaskStep
        | TimelineRuntimeExtensionUiRequestStep
        | TimelineWorkStep;
    }
  | {
      kind: "group";
      id: string;
      createdAt: string;
      group: GroupedSteps;
    }
  | {
      kind: "waitingGroup";
      id: string;
      createdAt: string | null;
      group: WaitingGroupedSteps;
    };

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function deriveTimelineRenderItems(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  isTurnActive: boolean;
  editableUserMessageIds: ReadonlySet<MessageId>;
  projectRoot?: string | undefined;
  conversationDensity?: ConversationDensity | undefined;
  pendingApprovalKinds?: ReadonlySet<PendingApprovalRequestKind> | undefined;
}): TimelineRenderItem[] {
  const conversationDensity = input.conversationDensity ?? DEFAULT_CONVERSATION_DENSITY;
  const pendingApprovalKinds = input.pendingApprovalKinds ?? EMPTY_PENDING_APPROVAL_KINDS;
  const items: TimelineRenderItem[] = [];
  let lastMessageDurationBoundary: string | null = null;
  let currentPairId: MessageId | null = null;
  let messageIndex = 0;

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (isRuntimeSubagentToolTimelineEntry(timelineEntry)) {
      const step: TimelineRuntimeTaskStep = {
        kind: "runtime-task",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        tool: timelineEntry.tool,
      };
      items.push({
        kind: "single",
        id: step.id,
        createdAt: step.createdAt,
        step,
      });
      continue;
    }

    if (isRuntimeAwaitToolTimelineEntry(timelineEntry)) {
      const collectedEntries = collectAdjacentRuntimeWaitingGroupEntries(
        input.timelineEntries,
        index,
      );
      const steps = collectedEntries.map(({ entry }) => runtimeTimelineEntryToStep(entry));
      const awaitToolCount = countRuntimeAwaitToolSteps(steps);
      if (
        shouldGroupToolCalls(conversationDensity) &&
        awaitToolCount >= MIN_RUNTIME_SPECIAL_GROUP_TOOLS
      ) {
        const group = summarizeRuntimeWaitingGroup(steps, input.isTurnActive);
        items.push({
          kind: "group",
          id: group.id,
          createdAt: group.createdAt,
          group,
        });
      } else {
        for (const step of steps) {
          items.push({
            kind: "single",
            id: step.id,
            createdAt: step.createdAt,
            step,
          });
        }
      }
      index = collectedEntries.at(-1)!.index;
      continue;
    }

    if (isRuntimeBrowserMcpToolTimelineEntry(timelineEntry)) {
      const collectedEntries = collectAdjacentRuntimeBrowserGroupEntries(
        input.timelineEntries,
        index,
      );
      const steps = collectedEntries.map(({ entry }) => runtimeTimelineEntryToStep(entry));
      const browserToolCount = countRuntimeBrowserMcpToolSteps(steps);
      if (
        shouldGroupToolCalls(conversationDensity) &&
        browserToolCount >= MIN_RUNTIME_SPECIAL_GROUP_TOOLS
      ) {
        const group = summarizeRuntimeBrowserGroup(steps, input.isTurnActive);
        items.push({
          kind: "group",
          id: group.id,
          createdAt: group.createdAt,
          group,
        });
      } else {
        for (const step of steps) {
          items.push({
            kind: "single",
            id: step.id,
            createdAt: step.createdAt,
            step,
          });
        }
      }
      index = collectedEntries.at(-1)!.index;
      continue;
    }

    if (timelineEntry.kind === "work" || isRuntimeGroupableTimelineEntry(timelineEntry)) {
      // One accumulator for committed work entries and runtime steps: a turn's steps flip
      // source independently as persistence catches up, so the run must survive the seam
      // or every flip closes the live group ("Worked for Ns · 1 command" per tool).
      const firstStep = groupableStepForTimelineEntry(timelineEntry);
      if (
        !isGroupableStepForDensity(firstStep, conversationDensity) ||
        groupedStepHasPendingApproval(firstStep, pendingApprovalKinds)
      ) {
        pushSingleTimelineStep(items, firstStep);
        continue;
      }

      const steps: TimelineGroupedStep[] = [firstStep];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry) break;
        if (nextEntry.kind === "work" || isRuntimeGroupableTimelineEntry(nextEntry)) {
          const nextStep = groupableStepForTimelineEntry(nextEntry);
          if (!isGroupableStepForDensity(nextStep, conversationDensity)) break;
          if (groupedStepHasPendingApproval(nextStep, pendingApprovalKinds)) break;
          steps.push(nextStep);
          cursor += 1;
          continue;
        }
        // Short plain assistant text joins an open tool group so agent narration streams
        // inside the collapsed preview instead of splitting it; text never starts a group.
        // Orchestration turn ids are deliberately ignored here: runtime-driven continuations
        // mint many turn ids inside one visible run, so the only group boundaries are
        // user-visible entries (user messages, UI requests, transcript-scale text).
        if (
          nextEntry.kind === "message" &&
          nextEntry.message.role === "assistant" &&
          !nextEntry.message.attachments?.length &&
          isShortPlainText(nextEntry.message.text.trim()) &&
          steps.some(isToolGroupedStep)
        ) {
          steps.push({
            kind: "message",
            id: nextEntry.id,
            createdAt: nextEntry.createdAt,
            message: nextEntry.message,
            durationStart: lastMessageDurationBoundary ?? nextEntry.message.createdAt,
            editAvailable: false,
            pairId: currentPairId,
            messageIndex,
          });
          messageIndex += 1;
          if (nextEntry.message.completedAt) {
            lastMessageDurationBoundary = nextEntry.message.completedAt;
          }
          cursor += 1;
          continue;
        }
        break;
      }
      const { groupSteps, releasedMessages } = releaseIneligibleRuntimeGroupMessages(steps);
      const shouldGroup = shouldCollapseGroupedRun(groupSteps, conversationDensity);
      if (!shouldGroup) {
        for (const step of groupSteps) {
          pushSingleTimelineStep(items, step);
        }
        for (const step of releasedMessages) {
          pushSingleTimelineStep(items, step);
        }
      } else {
        const group = summarizeGroupedRun(groupSteps, {
          isTurnActive: input.isTurnActive,
          projectRoot: input.projectRoot,
        });
        items.push({
          kind: "group",
          id: group.id,
          createdAt: group.createdAt,
          group,
        });
        for (const step of releasedMessages) {
          pushSingleTimelineStep(items, step);
        }
      }
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "runtime-extension-ui-request") {
      items.push({
        kind: "single",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        step: {
          kind: "runtime-extension-ui-request",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          request: timelineEntry.request,
        },
      });
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      const step: TimelineProposedPlanStep = {
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      };
      items.push({
        kind: "single",
        id: step.id,
        createdAt: step.createdAt,
        step,
      });
      continue;
    }

    if (timelineEntry.kind === "waiting") {
      const step: TimelineWaitingStep = {
        kind: "waiting",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        phase: timelineEntry.phase,
        elapsedStartedAt: timelineEntry.elapsedStartedAt,
      };
      items.push({
        kind: "waitingGroup",
        id: step.id,
        createdAt: step.createdAt,
        group: {
          id: step.id,
          createdAt: step.createdAt,
          steps: [step],
        },
      });
      continue;
    }

    const message = timelineEntry.message;
    if (message.role === "user") {
      currentPairId = message.id;
    }
    const durationStart = lastMessageDurationBoundary ?? message.createdAt;
    const step: TimelineMessageStep = {
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message,
      durationStart,
      editAvailable: message.role === "user" && input.editableUserMessageIds.has(message.id),
      pairId: currentPairId,
      messageIndex,
    };
    items.push({
      kind: "single",
      id: step.id,
      createdAt: step.createdAt,
      step,
    });
    messageIndex += 1;
    if (message.role === "user") {
      lastMessageDurationBoundary = message.createdAt;
    } else if (message.role === "assistant" && message.completedAt) {
      lastMessageDurationBoundary = message.completedAt;
    }
  }

  const result = keepTailGroupRunning(items, {
    isTurnActive: input.isTurnActive,
    projectRoot: input.projectRoot,
    pendingApprovalKinds,
  });
  return finalizeGroupAssistantMessages(result, {
    isTurnActive: input.isTurnActive,
    projectRoot: input.projectRoot,
  });
}

export function summarizeWorkGroup(
  entries: ReadonlyArray<WorkLogEntry>,
  projectRoot?: string,
): WorkGroupSummary {
  const analysis = analyzeWorkGroup(entries);
  return summarizeAnalyzedWorkGroup(entries, analysis, projectRoot);
}

function isRuntimeGroupableTimelineEntry(
  entry: TimelineEntry,
): entry is Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }> {
  return (
    entry.kind === "runtime-thinking" ||
    (entry.kind === "runtime-tool" && entry.tool.display?.kind !== "subagent")
  );
}

function isRuntimeSubagentToolTimelineEntry(
  entry: TimelineEntry,
): entry is Extract<TimelineEntry, { kind: "runtime-tool" }> {
  return entry.kind === "runtime-tool" && entry.tool.display?.kind === "subagent";
}

const MIN_RUNTIME_SPECIAL_GROUP_TOOLS = 2;

const BROWSER_MCP_PROVIDER_IDENTIFIERS = [
  "cursor-ide-browser",
  "cursor-browser-extension",
] as const;

interface IndexedRuntimeTimelineEntry {
  entry: Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }>;
  index: number;
}

function isRuntimeAwaitToolTimelineEntry(
  entry: TimelineEntry,
): entry is Extract<TimelineEntry, { kind: "runtime-tool" }> {
  if (entry.kind !== "runtime-tool") {
    return false;
  }
  const step = runtimeTimelineEntryToStep(entry);
  return step.kind === "runtime-tool" && isRuntimeAwaitToolStep(step);
}

function isRuntimeBrowserMcpToolTimelineEntry(
  entry: TimelineEntry,
): entry is Extract<TimelineEntry, { kind: "runtime-tool" }> {
  if (entry.kind !== "runtime-tool") {
    return false;
  }
  const step = runtimeTimelineEntryToStep(entry);
  return step.kind === "runtime-tool" && isRuntimeBrowserToolStep(step);
}

function canJoinRuntimeWaitingGroupEntry(
  entry: TimelineEntry,
): entry is Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }> {
  if (entry.kind === "runtime-thinking") {
    return true;
  }
  if (entry.kind !== "runtime-tool" || entry.tool.display?.kind === "subagent") {
    return false;
  }
  if (entry.tool.display?.kind === "edit") {
    return false;
  }
  return true;
}

function collectAdjacentRuntimeWaitingGroupEntries(
  entries: ReadonlyArray<TimelineEntry>,
  startIndex: number,
): IndexedRuntimeTimelineEntry[] {
  const collected: IndexedRuntimeTimelineEntry[] = [];
  let cursor = startIndex;
  while (cursor < entries.length) {
    const entry = entries[cursor];
    if (!entry || !canJoinRuntimeWaitingGroupEntry(entry)) {
      break;
    }
    collected.push({ entry, index: cursor });
    cursor += 1;
  }
  return collected;
}

function collectAdjacentRuntimeBrowserGroupEntries(
  entries: ReadonlyArray<TimelineEntry>,
  startIndex: number,
): IndexedRuntimeTimelineEntry[] {
  const collected: IndexedRuntimeTimelineEntry[] = [];
  let cursor = startIndex;
  while (cursor < entries.length) {
    const entry = entries[cursor];
    if (!entry) {
      break;
    }
    if (entry.kind === "runtime-thinking") {
      collected.push({ entry, index: cursor });
      cursor += 1;
      continue;
    }
    if (isRuntimeBrowserMcpToolTimelineEntry(entry)) {
      collected.push({ entry, index: cursor });
      cursor += 1;
      continue;
    }
    break;
  }
  return collected;
}

function countRuntimeAwaitToolSteps(
  steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>,
): number {
  return steps.filter(
    (step): step is TimelineRuntimeToolStep =>
      step.kind === "runtime-tool" && isRuntimeAwaitToolStep(step),
  ).length;
}

function countRuntimeBrowserMcpToolSteps(
  steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>,
): number {
  return steps.filter(
    (step): step is TimelineRuntimeToolStep =>
      step.kind === "runtime-tool" && isRuntimeBrowserToolStep(step),
  ).length;
}

function isRuntimeAwaitToolStep(step: TimelineRuntimeToolStep): boolean {
  const toolName = normalizeRuntimeToolName(step.tool.toolName);
  return toolName === "await" || toolName.includes("await");
}

function normalizeRuntimeToolName(toolName: string): string {
  return toolName.trim().toLowerCase().replaceAll("-", "_");
}

function countAwaitJobStats(awaitSteps: ReadonlyArray<TimelineRuntimeToolStep>): {
  jobCount: number;
  completeCount: number;
  activeCount: number;
} {
  const jobs = new Map<string, "complete" | "active">();
  for (const step of awaitSteps) {
    const taskId = extractAwaitTaskId(step.tool);
    const key = taskId ?? step.tool.toolCallId;
    jobs.set(key, step.tool.status === "running" ? "active" : "complete");
  }
  const values = [...jobs.values()];
  const completeCount = values.filter((status) => status === "complete").length;
  const jobCount = jobs.size;
  return {
    jobCount,
    completeCount,
    activeCount: jobCount - completeCount,
  };
}

function extractAwaitTaskId(tool: RuntimeDisplayTimelineToolItem): string | undefined {
  const record = asRuntimeToolArgsRecord(tool.args);
  if (!record) {
    return undefined;
  }
  const taskId = record.taskId;
  if (typeof taskId !== "string") {
    return undefined;
  }
  const trimmed = taskId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRuntimeToolArgsRecord(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }
  return args as Record<string, unknown>;
}

function formatMonitoringBackgroundSummary(input: {
  running: boolean;
  jobCount: number;
  completeCount: number;
  activeCount: number;
}): WorkGroupSummary {
  const taskWord = input.jobCount === 1 ? "task" : "tasks";
  const detailParts: string[] = [];
  if (!input.running) {
    if (input.completeCount > 0) {
      detailParts.push(`${input.completeCount} complete`);
    }
    if (input.activeCount > 0) {
      detailParts.push(`${input.activeCount} active`);
    }
  }
  return {
    action: input.running
      ? `Monitoring background ${taskWord}`
      : `Monitored background ${taskWord}`,
    details: input.running ? "" : detailParts.join(", "),
  };
}

function runtimeTimelineEntryToStep(
  entry: Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }>,
): TimelineRuntimeThinkingStep | TimelineRuntimeToolStep {
  if (entry.kind === "runtime-thinking") {
    return {
      kind: "runtime-thinking",
      id: entry.id,
      createdAt: entry.createdAt,
      message: entry.message,
    };
  }
  return {
    kind: "runtime-tool",
    id: entry.id,
    createdAt: entry.createdAt,
    tool: entry.tool,
  };
}

function groupableStepForTimelineEntry(
  entry: Extract<TimelineEntry, { kind: "work" | "runtime-thinking" | "runtime-tool" }>,
): TimelineWorkStep | TimelineRuntimeThinkingStep | TimelineRuntimeToolStep {
  if (entry.kind === "work") {
    return {
      kind: "work",
      id: entry.id,
      createdAt: entry.createdAt,
      entry: entry.entry,
    };
  }
  return runtimeTimelineEntryToStep(entry);
}

function isGroupableStepForDensity(
  step: TimelineWorkStep | TimelineRuntimeThinkingStep | TimelineRuntimeToolStep,
  density: ConversationDensity,
): boolean {
  if (step.kind === "work") {
    return isWorkEntryGroupable(step.entry, density);
  }
  return isRuntimeStepGroupableForDensity(step, density);
}

function isThinkingGroupedStep(step: TimelineGroupedStep): boolean {
  if (step.kind === "runtime-thinking") {
    return true;
  }
  return step.kind === "work" && step.entry.tone === "thinking";
}

function isToolGroupedStep(step: TimelineGroupedStep): boolean {
  if (step.kind === "runtime-tool") {
    return true;
  }
  return step.kind === "work" && step.entry.tone !== "thinking";
}

function isCommandGroupedStep(step: TimelineGroupedStep): boolean {
  if (step.kind === "runtime-tool") {
    return isRuntimeCommandToolStep(step);
  }
  return step.kind === "work" && isCommandWorkEntry(step.entry);
}

function isEditGroupedStep(step: TimelineGroupedStep): boolean {
  if (step.kind === "runtime-tool") {
    return isRuntimeEditToolStep(step);
  }
  return step.kind === "work" && isWorkEditEntry(step.entry);
}

function isExploreGroupedStep(step: TimelineGroupedStep): boolean {
  if (step.kind === "runtime-tool") {
    return isExploreRuntimeToolStep(step);
  }
  return step.kind === "work" && isExploreWorkEntry(step.entry);
}

function isExploreWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.requestKind === "file-read" ||
    entry.itemType === "file_read" ||
    entry.itemType === "file_search" ||
    Boolean(entry.artifacts?.some((artifact) => artifact.type === "read" || artifact.type === "search"))
  );
}

function groupedRunWorkEntries(steps: ReadonlyArray<TimelineGroupedStep>): WorkLogEntry[] {
  return steps.flatMap((step) => (step.kind === "work" ? [step.entry] : []));
}

function groupedRunDurationMs(
  steps: ReadonlyArray<TimelineGroupedStep>,
  workDurationMs: number,
): number {
  const firstStep = steps[0];
  const lastStep = steps.at(-1);
  if (!firstStep || !lastStep) {
    return workDurationMs;
  }
  const startMs = Date.parse(firstStep.createdAt);
  const endAt =
    lastStep.kind === "work" ? (lastStep.entry.completedAt ?? lastStep.createdAt) : lastStep.createdAt;
  const endMs = Date.parse(endAt);
  const spanMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
  return Math.max(spanMs, workDurationMs);
}

function mergeToolGroupAnalyses(
  work: WorkGroupAnalysis,
  runtime: RuntimeToolGroupAnalysis,
  hasWorkEntries: boolean,
  hasRuntimeToolSteps: boolean,
): ToolGroupAnalysisBase {
  if (!hasRuntimeToolSteps) {
    return work;
  }
  if (!hasWorkEntries) {
    return runtime;
  }
  const exploredFileCount = work.exploredFileCount + runtime.exploredFileCount;
  const searchCount = work.searchCount + runtime.searchCount;
  const fetchCount = work.fetchCount + runtime.fetchCount;
  return {
    running: work.running || runtime.running,
    commandCount: work.commandCount + runtime.commandCount,
    editCount: work.editCount + runtime.editCount,
    deleteCount: work.deleteCount + runtime.deleteCount,
    editedFiles: new Set([...work.editedFiles, ...runtime.editedFiles]),
    deletedFiles: new Set([...work.deletedFiles, ...runtime.deletedFiles]),
    primaryEditedFilePath: work.primaryEditedFilePath ?? runtime.primaryEditedFilePath,
    primaryDeletedFilePath: work.primaryDeletedFilePath ?? runtime.primaryDeletedFilePath,
    additions: work.additions + runtime.additions,
    deletions: work.deletions + runtime.deletions,
    exploredFileCount,
    searchCount,
    fetchCount,
    explorationSegments: buildExplorationSegments({
      exploredFileCount,
      searchCount,
      fetchCount,
    }),
  };
}

/**
 * One grouped-run builder for every source mix: committed work entries, runtime steps, and
 * joined narration. A turn's steps flip from runtime to committed independently as
 * persistence catches up, so summaries and flags must be computed over the union, never per
 * source.
 */
function buildGroupedRun(
  steps: ReadonlyArray<TimelineGroupedStep>,
  input: { running: boolean; projectRoot?: string | undefined },
): GroupedSteps {
  const firstStep = steps[0]!;
  const entries = groupedRunWorkEntries(steps);
  const runtimeToolSteps = steps.filter(
    (step): step is TimelineRuntimeToolStep => step.kind === "runtime-tool",
  );
  const workAnalysis = analyzeWorkGroup(entries);
  const runtimeAnalysis = analyzeRuntimeToolSteps(runtimeToolSteps);
  const merged = mergeToolGroupAnalyses(
    workAnalysis,
    runtimeAnalysis,
    entries.length > 0,
    runtimeToolSteps.length > 0,
  );
  const thinkingCount = steps.filter(isThinkingGroupedStep).length;
  const toolCount = steps.filter(isToolGroupedStep).length;
  const browserCount = runtimeToolSteps.filter(isRuntimeBrowserToolStep).length;
  const hasError = runtimeToolSteps.some(
    (step) => step.tool.status === "error" || step.tool.isError === true,
  );
  const durationMs = groupedRunDurationMs(steps, workAnalysis.durationMs);
  const summary = summarizeGroupedRunSteps({
    analysis: merged,
    browserCount,
    durationMs,
    hasError,
    running: input.running,
    stepCount: steps.length,
    thinkingCount,
    toolCount,
    ...(input.projectRoot !== undefined ? { projectRoot: input.projectRoot } : {}),
  });
  return {
    id: firstStep.id,
    createdAt: firstStep.createdAt,
    completedDurationLabel: input.running ? null : formatDuration(durationMs),
    isRunning: input.running,
    isTailGroup: false,
    isThinkingGroup: thinkingCount === steps.length && thinkingCount > 0,
    isCommandGroup: toolCount > 0 && merged.commandCount === toolCount,
    isWaitingGroup: false,
    isBrowserGroup: toolCount > 0 && browserCount === toolCount,
    summary,
    steps: [...steps],
    entries,
  };
}

function summarizeGroupedRun(
  steps: ReadonlyArray<TimelineGroupedStep>,
  input: { isTurnActive: boolean; projectRoot?: string | undefined },
): GroupedSteps {
  const running = input.isTurnActive && steps.some(isActivelyRunningGroupedStep);
  return buildGroupedRun(steps, {
    running,
    ...(input.projectRoot !== undefined ? { projectRoot: input.projectRoot } : {}),
  });
}

function summarizeGroupedRunSteps(input: {
  readonly analysis: ToolGroupAnalysisBase;
  readonly browserCount: number;
  readonly durationMs: number;
  readonly hasError: boolean;
  readonly running: boolean;
  readonly stepCount: number;
  readonly thinkingCount: number;
  readonly toolCount: number;
  readonly projectRoot?: string | undefined;
}): WorkGroupSummary {
  if (input.thinkingCount === input.stepCount && input.thinkingCount > 0) {
    return {
      action: input.running ? "Thinking" : "Thought",
      details: input.running ? "" : formatThinkingDetails(input.durationMs),
    };
  }
  if (input.analysis.commandCount === input.toolCount && input.analysis.commandCount > 0) {
    return {
      action: input.running ? "Running" : "Ran",
      details: formatCommandCountDetails(input.analysis.commandCount),
    };
  }
  if (input.browserCount === input.toolCount && input.browserCount > 0) {
    return {
      action: input.running ? "Running" : "Ran",
      details: formatBrowserActionCountDetails(input.browserCount),
    };
  }
  if (input.hasError) {
    return {
      action: "Error",
      details: input.toolCount === 1 ? "1 tool" : `${input.toolCount} tools`,
    };
  }
  return summarizeToolGroupAnalysis(
    input.analysis,
    input.running,
    input.projectRoot,
    input.toolCount + input.thinkingCount,
  );
}

function summarizeRuntimeWaitingGroup(
  steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>,
  isTurnActive: boolean,
): GroupedSteps {
  const firstStep = steps[0]!;
  const running = isTurnActive && steps.some(isActivelyRunningGroupedStep);
  const thinkingCount = steps.filter((step) => step.kind === "runtime-thinking").length;
  const awaitSteps = steps.filter(
    (step): step is TimelineRuntimeToolStep =>
      step.kind === "runtime-tool" && isRuntimeAwaitToolStep(step),
  );
  const jobStats = countAwaitJobStats(awaitSteps);
  return {
    id: firstStep.id,
    createdAt: firstStep.createdAt,
    completedDurationLabel: running ? null : formatDuration(runtimeGroupDurationMs(steps)),
    isRunning: running,
    isTailGroup: false,
    isThinkingGroup: thinkingCount === steps.length && thinkingCount > 0,
    isCommandGroup: false,
    isWaitingGroup: true,
    isBrowserGroup: false,
    summary: formatMonitoringBackgroundSummary({
      running,
      ...jobStats,
    }),
    steps: [...steps],
    entries: [],
  };
}

function summarizeRuntimeBrowserGroup(
  steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>,
  isTurnActive: boolean,
): GroupedSteps {
  const firstStep = steps[0]!;
  const running = isTurnActive && steps.some(isActivelyRunningGroupedStep);
  const thinkingCount = steps.filter((step) => step.kind === "runtime-thinking").length;
  const browserCount = countRuntimeBrowserMcpToolSteps(steps);
  return {
    id: firstStep.id,
    createdAt: firstStep.createdAt,
    completedDurationLabel: running ? null : formatDuration(runtimeGroupDurationMs(steps)),
    isRunning: running,
    isTailGroup: false,
    isThinkingGroup: thinkingCount === steps.length && thinkingCount > 0,
    isCommandGroup: false,
    isWaitingGroup: false,
    isBrowserGroup: true,
    summary: {
      action: running ? "Running" : "Ran",
      details: formatBrowserActionCountDetails(browserCount),
    },
    steps: [...steps],
    entries: [],
  };
}


// At Balanced, only thinking-only runs may collapse; grouped compact keeps Cursor rules.
// Pure committed-work runs keep the work thresholds; any run touching runtime steps uses the
// runtime thresholds so a step flipping source mid-turn never changes the group decision.
function shouldCollapseGroupedRun(
  steps: ReadonlyArray<TimelineGroupedStep>,
  density: ConversationDensity,
): boolean {
  if (steps.length === 0) {
    return false;
  }
  if (steps.every((step): step is TimelineWorkStep => step.kind === "work")) {
    return shouldGroupWorkSteps(steps, density);
  }
  if (steps.every(isThinkingGroupedStep)) {
    return shouldGroupUnifiedSteps(steps);
  }
  if (!shouldGroupToolCalls(density)) {
    return false;
  }
  return shouldGroupUnifiedSteps(steps);
}

function shouldGroupUnifiedSteps(
  steps: ReadonlyArray<TimelineGroupedStep>,
  minGroupSize = RUNTIME_DEFAULT_MIN_GROUP_SIZE,
): boolean {
  if (steps.length === 0) {
    return false;
  }

  const hasThinking = steps.some(isThinkingGroupedStep);
  const exploreOnly =
    !hasThinking && steps.every((step) => step.kind === "message" || isExploreGroupedStep(step));
  const toolSteps = steps.filter(isToolGroupedStep);
  const toolCount = toolSteps.length;
  const isSingleShell = toolCount === 1 && toolSteps.some(isCommandGroupedStep);
  const minSize = exploreOnly
    ? Math.max(minGroupSize, RUNTIME_EXPLORE_ONLY_MIN_GROUP_SIZE)
    : minGroupSize;
  const groupCount = isSingleShell ? toolCount : hasThinking ? steps.length : toolCount;

  return groupCount >= minSize;
}

// Only plain read/ls runs need 3+ tools before collapsing (Cursor parity); any other tool
// in the run makes it group at the default minimum.
function isExploreRuntimeToolStep(step: TimelineRuntimeToolStep): boolean {
  if (step.tool.display?.kind === "read" || step.tool.display?.kind === "find") {
    return true;
  }
  return (
    step.tool.toolName === "read" || step.tool.toolName === "ls" || step.tool.toolName === "find"
  );
}

function keepTailGroupRunning(
  items: TimelineRenderItem[],
  input: {
    isTurnActive: boolean;
    projectRoot?: string | undefined;
    pendingApprovalKinds?: ReadonlySet<PendingApprovalRequestKind> | undefined;
  },
): TimelineRenderItem[] {
  const nextItems = !input.isTurnActive
    ? items.map((item) => {
        if (item.kind !== "group") {
          return item;
        }
        return {
          ...item,
          group: {
            ...completeGroupedSteps(item.group, input.projectRoot),
            isTailGroup: false,
          },
        };
      })
    : (() => {
        const tailGroupIndex = findTailGroupRenderItemIndex(
          items,
          input.pendingApprovalKinds ?? EMPTY_PENDING_APPROVAL_KINDS,
        );
        if (tailGroupIndex === -1) {
          return items;
        }

        return items.map((item, index) => {
          if (item.kind !== "group") {
            return item;
          }

          if (index === tailGroupIndex) {
            // The trailing group during an active turn is the live loading surface. Keep it
            // running (and present-tense) even between tool calls so the collapsed preview
            // stays mounted instead of flickering to a completed summary and back.
            return {
              ...item,
              group: {
                ...setGroupRunning(item.group, true, input.projectRoot),
                isTailGroup: true,
              },
            };
          }

          return {
            ...item,
            group: {
              ...completeGroupedSteps(item.group, input.projectRoot),
              isTailGroup: false,
            },
          };
        });
      })();

  return nextItems;
}

export function isActivelyRunningGroupedStep(step: TimelineGroupedStep): boolean {
  if (step.kind === "work") {
    return step.entry.status === "running";
  }
  if (step.kind === "message") {
    return step.message.streaming === true;
  }
  return isRunningRuntimeStep(step);
}

function findLastGroupRenderItemIndex(items: ReadonlyArray<TimelineRenderItem>): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === "group") {
      return index;
    }
  }
  return -1;
}

// Only meaningful during an active turn: prefer the last group with an actively running
// step, otherwise fall back to the trailing group when nothing but waiting rows or steps
// broken out by a pending approval follow it (the run is still in flight, so the collapsed
// preview must not unmount while the user decides).
function findTailGroupRenderItemIndex(
  items: ReadonlyArray<TimelineRenderItem>,
  pendingApprovalKinds: ReadonlySet<PendingApprovalRequestKind>,
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "group") {
      continue;
    }
    if (item.group.steps.some(isActivelyRunningGroupedStep)) {
      return index;
    }
  }

  const lastGroupIndex = findLastGroupRenderItemIndex(items);
  if (lastGroupIndex === -1) {
    return -1;
  }
  for (let index = lastGroupIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind === "waitingGroup") {
      continue;
    }
    if (
      item.kind === "single" &&
      (item.step.kind === "work" || item.step.kind === "runtime-tool") &&
      groupedStepHasPendingApproval(item.step, pendingApprovalKinds)
    ) {
      continue;
    }
    return -1;
  }
  return lastGroupIndex;
}

export function finalizeGroupAssistantMessagesForTest(
  items: TimelineRenderItem[],
  input: { isTurnActive: boolean; projectRoot?: string | undefined },
): TimelineRenderItem[] {
  return finalizeGroupAssistantMessages(items, input);
}

function finalizeGroupAssistantMessages(
  items: TimelineRenderItem[],
  input: { isTurnActive: boolean; projectRoot?: string | undefined },
): TimelineRenderItem[] {
  let result = releaseIneligibleAssistantMessagesFromGroups(items, input.projectRoot);
  if (!input.isTurnActive) {
    result = peelGroupedNarrationFromCompletedGroups(result, input.projectRoot);
  }
  return result;
}

/** Transcript-scale assistant rows never stay inside work groups (preview or expanded). */
function releaseIneligibleAssistantMessagesFromGroups(
  items: TimelineRenderItem[],
  projectRoot?: string | undefined,
): TimelineRenderItem[] {
  const next: TimelineRenderItem[] = [];
  for (const item of items) {
    if (item.kind !== "group") {
      next.push(item);
      continue;
    }
    const releasedMessages: TimelineMessageStep[] = [];
    const groupSteps: TimelineGroupedStep[] = [];
    for (const step of item.group.steps) {
      if (step.kind === "message" && !isGroupedNarrationMessageStep(step)) {
        releasedMessages.push(step);
        continue;
      }
      groupSteps.push(step);
    }
    if (releasedMessages.length === 0) {
      next.push(item);
      continue;
    }
    if (groupSteps.length > 0) {
      next.push({
        ...item,
        group: regroupStepsAfterPeel(item.group, groupSteps, projectRoot),
      });
    }
    for (const step of releasedMessages) {
      pushSingleTimelineStep(next, step);
    }
  }
  return next;
}

function peelGroupedNarrationFromCompletedGroups(
  items: TimelineRenderItem[],
  projectRoot?: string | undefined,
): TimelineRenderItem[] {
  const next: TimelineRenderItem[] = [];
  for (const item of items) {
    if (item.kind !== "group") {
      next.push(item);
      continue;
    }
    const lastStep = item.group.steps.at(-1);
    if (
      lastStep?.kind !== "message" ||
      lastStep.message.role !== "assistant" ||
      !isGroupedNarrationMessageStep(lastStep) ||
      item.group.steps.length <= 1
    ) {
      next.push(item);
      continue;
    }
    const groupSteps = item.group.steps.slice(0, -1);
    next.push({
      ...item,
      group: regroupStepsAfterPeel(item.group, groupSteps, projectRoot),
    });
    pushSingleTimelineStep(next, lastStep);
  }
  return next;
}

function regroupStepsAfterPeel(
  group: GroupedSteps,
  groupSteps: TimelineGroupedStep[],
  projectRoot?: string | undefined,
): GroupedSteps {
  if (groupSteps.length === 0) {
    return {
      ...group,
      steps: groupSteps,
      isTailGroup: false,
    };
  }
  const rebuilt = buildGroupedRun(groupSteps, {
    running: group.isRunning,
    ...(projectRoot !== undefined ? { projectRoot } : {}),
  });
  return {
    ...rebuilt,
    id: group.id,
    createdAt: group.createdAt,
    isTailGroup: false,
  };
}

function completeGroupedSteps(group: GroupedSteps, projectRoot?: string | undefined): GroupedSteps {
  if (!group.isRunning) {
    return {
      ...group,
      isTailGroup: false,
    };
  }
  return setGroupRunning(group, false, projectRoot);
}

// Rebuild a group's running flag, duration label, and summary for a target running state.
// Used to complete non-tail groups (running: false) and to keep the loading tail group
// present-tense (running: true) regardless of whether a step is instantaneously executing.
function setGroupRunning(
  group: GroupedSteps,
  running: boolean,
  projectRoot?: string | undefined,
): GroupedSteps {
  const base: GroupedSteps = {
    ...group,
    isRunning: running,
    isTailGroup: false,
  };

  if (group.isWaitingGroup || group.isBrowserGroup) {
    const runtimeSteps = group.steps.filter(
      (step): step is TimelineRuntimeThinkingStep | TimelineRuntimeToolStep =>
        step.kind === "runtime-thinking" || step.kind === "runtime-tool",
    );
    const completedDurationLabel = running
      ? null
      : formatDuration(runtimeGroupDurationMs(runtimeSteps));

    if (group.isWaitingGroup) {
      const awaitSteps = runtimeSteps.filter(
        (step): step is TimelineRuntimeToolStep =>
          step.kind === "runtime-tool" && isRuntimeAwaitToolStep(step),
      );
      return {
        ...base,
        completedDurationLabel,
        summary: formatMonitoringBackgroundSummary({
          running,
          ...countAwaitJobStats(awaitSteps),
        }),
      };
    }
    const browserCount = countRuntimeBrowserMcpToolSteps(runtimeSteps);
    return {
      ...base,
      completedDurationLabel,
      summary: {
        action: running ? "Running" : "Ran",
        details: formatBrowserActionCountDetails(browserCount),
      },
    };
  }

  if (group.steps.length === 0) {
    return base;
  }
  const rebuilt = buildGroupedRun(group.steps, {
    running,
    ...(projectRoot !== undefined ? { projectRoot } : {}),
  });
  return {
    ...rebuilt,
    id: group.id,
    createdAt: group.createdAt,
    isTailGroup: false,
  };
}

function isRunningRuntimeStep(
  step: TimelineRuntimeThinkingStep | TimelineRuntimeToolStep,
): boolean {
  if (step.kind === "runtime-thinking") {
    return step.message.streaming === true;
  }
  return step.tool.status === "running";
}

function isRuntimeCommandToolStep(step: TimelineRuntimeToolStep): boolean {
  if (step.tool.display?.kind === "shell") {
    return true;
  }
  return step.tool.toolName === "shell" || typeof step.tool.command === "string";
}

function isRuntimeBrowserToolStep(step: TimelineRuntimeToolStep): boolean {
  const display = step.tool.display;
  if (display?.kind === "mcp") {
    const provider = display.providerIdentifier?.toLowerCase() ?? "";
    if (BROWSER_MCP_PROVIDER_IDENTIFIERS.some((identifier) => provider.includes(identifier))) {
      return true;
    }
    return provider.includes("browser");
  }
  const args = asRuntimeToolArgsRecord(step.tool.args);
  const provider =
    (typeof args?.providerIdentifier === "string" ? args.providerIdentifier : undefined) ??
    (typeof args?.provider === "string" ? args.provider : undefined) ??
    "";
  const normalizedProvider = provider.toLowerCase();
  if (
    BROWSER_MCP_PROVIDER_IDENTIFIERS.some((identifier) => normalizedProvider.includes(identifier))
  ) {
    return true;
  }
  const toolName = normalizeRuntimeToolName(step.tool.toolName);
  return toolName.startsWith("browser_") || toolName.includes("browser");
}

function isRuntimeEditToolStep(step: TimelineRuntimeToolStep): boolean {
  if (isRuntimeDeleteToolStep(step)) {
    return false;
  }
  if (step.tool.display?.kind === "edit") {
    return true;
  }
  const toolName = step.tool.toolName.toLowerCase();
  return toolName.includes("edit") || toolName.includes("write") || toolName.includes("patch");
}

function isRuntimeDeleteToolStep(step: TimelineRuntimeToolStep): boolean {
  const toolName = step.tool.toolName.toLowerCase();
  if (toolName.includes("delete")) {
    return true;
  }
  const display = step.tool.display;
  if (display?.kind !== "edit") {
    return false;
  }
  const additions = display.additions ?? 0;
  const deletions = display.deletions ?? 0;
  return additions === 0 && deletions > 0;
}

function extractRuntimeEditedFilePath(tool: RuntimeDisplayTimelineToolItem): string | null {
  const display = tool.display;
  if (display?.kind !== "edit" || !display.path) {
    return null;
  }
  const trimmedPath = display.path.trim();
  return trimmedPath.length > 0 ? trimmedPath : null;
}

function runtimeGroupDurationMs(steps: ReadonlyArray<{ createdAt: string }>): number {
  const firstStep = steps[0];
  const lastStep = steps.at(-1);
  if (!firstStep || !lastStep) {
    return 0;
  }
  const startMs = Date.parse(firstStep.createdAt);
  const endMs = Date.parse(lastStep.createdAt);
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
}

function summarizeAnalyzedWorkGroup(
  entries: ReadonlyArray<WorkLogEntry>,
  analysis: WorkGroupAnalysis,
  projectRoot?: string,
): WorkGroupSummary {
  if (analysis.thinkingCount === entries.length && analysis.thinkingCount > 0) {
    return {
      action: analysis.running ? "Thinking" : "Thought",
      details: analysis.running ? "" : formatThinkingDetails(analysis.durationMs),
    };
  }

  if (analysis.commandCount === entries.length && analysis.commandCount > 0) {
    return {
      action: analysis.running ? "Running" : "Ran",
      details: formatCommandCountDetails(analysis.commandCount),
    };
  }

  return summarizeToolGroupAnalysis(analysis, analysis.running, projectRoot, entries.length);
}

interface ToolGroupAnalysisBase {
  running: boolean;
  commandCount: number;
  editCount: number;
  deleteCount: number;
  editedFiles: Set<string>;
  deletedFiles: Set<string>;
  primaryEditedFilePath: string | null;
  primaryDeletedFilePath: string | null;
  additions: number;
  deletions: number;
  exploredFileCount: number;
  searchCount: number;
  fetchCount: number;
  explorationSegments: string[];
}

interface WorkGroupAnalysis extends ToolGroupAnalysisBase {
  thinkingCount: number;
  durationMs: number;
}

interface RuntimeToolGroupAnalysis extends ToolGroupAnalysisBase {}

function analyzeWorkGroup(entries: ReadonlyArray<WorkLogEntry>): WorkGroupAnalysis {
  const editedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  const exploredFiles = new Set<string>();
  let primaryEditedFilePath: string | null = null;
  let primaryDeletedFilePath: string | null = null;
  let running = false;
  let thinkingCount = 0;
  let commandCount = 0;
  let editCount = 0;
  let deleteCount = 0;
  let readCount = 0;
  let searchCount = 0;
  let webSearchCount = 0;
  let webFetchCount = 0;
  let additions = 0;
  let deletions = 0;
  let artifactDurationMs = 0;

  for (const entry of entries) {
    running ||= entry.status === "running";
    if (entry.tone === "thinking") {
      thinkingCount += 1;
    }
    if (entry.itemType === "web_search") {
      webSearchCount += 1;
    }
    if (entry.itemType === "web_fetch") {
      webFetchCount += 1;
    }

    let hasCommandArtifact = false;
    let hasDiffArtifact = false;
    let hasReadArtifact = false;
    let hasSearchArtifact = false;
    const resultDiffArtifacts: ToolDiffArtifact[] = [];
    const fallbackDiffArtifacts: ToolDiffArtifact[] = [];

    for (const artifact of entry.artifacts ?? []) {
      switch (artifact.type) {
        case "command":
          hasCommandArtifact = true;
          artifactDurationMs += artifact.durationMs ?? 0;
          break;
        case "diff":
          hasDiffArtifact = true;
          if (artifact.source === "result") {
            resultDiffArtifacts.push(artifact);
          } else {
            fallbackDiffArtifacts.push(artifact);
          }
          break;
        case "read":
          hasReadArtifact = true;
          addPath(exploredFiles, artifact.path);
          break;
        case "search":
          hasSearchArtifact = true;
          addPaths(exploredFiles, artifact.matchedFiles);
          break;
        case "diagnostic":
        case "raw":
          break;
      }
    }

    if (
      entry.requestKind === "command" ||
      entry.itemType === "command_execution" ||
      Boolean(entry.command) ||
      hasCommandArtifact
    ) {
      commandCount += 1;
    }
    if (entry.requestKind === "file-read" || entry.itemType === "file_read" || hasReadArtifact) {
      readCount += 1;
    }
    if (entry.itemType === "file_search" || hasSearchArtifact) {
      searchCount += 1;
    }

    const diffArtifacts =
      resultDiffArtifacts.length > 0 ? resultDiffArtifacts : fallbackDiffArtifacts;
    const isFileChange =
      entry.requestKind === "file-change" ||
      entry.itemType === "file_change" ||
      (entry.changedFiles?.length ?? 0) > 0 ||
      hasDiffArtifact;
    if (!isFileChange) {
      continue;
    }

    for (const artifact of diffArtifacts) {
      for (const file of artifact.files) {
        const fileAdditions = file.additions ?? 0;
        const fileDeletions = file.deletions ?? 0;
        additions += fileAdditions;
        deletions += fileDeletions;
        if (fileAdditions === 0 && fileDeletions > 0) {
          addPath(deletedFiles, file.path);
          deleteCount += 1;
          primaryDeletedFilePath ??= file.path;
          continue;
        }
        addPath(editedFiles, file.path);
        editCount += 1;
        primaryEditedFilePath ??= file.path;
      }
    }
    if (diffArtifacts.length === 0 && (entry.changedFiles?.length ?? 0) > 0) {
      addPaths(editedFiles, entry.changedFiles);
      editCount += entry.changedFiles?.length ?? 0;
      primaryEditedFilePath ??= entry.changedFiles?.[0] ?? null;
    }
  }

  const exploredFileCount = Math.max(exploredFiles.size, readCount);
  const totalSearchCount = searchCount + webSearchCount;
  const explorationSegments = buildExplorationSegments({
    exploredFileCount,
    searchCount: totalSearchCount,
    fetchCount: webFetchCount,
  });
  const firstEntry = entries[0];
  const lastEntry = entries.at(-1);
  const startMs = firstEntry ? Date.parse(firstEntry.createdAt) : NaN;
  const endMs = lastEntry ? Date.parse(lastEntry.completedAt ?? lastEntry.createdAt) : NaN;
  const timelineDurationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;

  return {
    running,
    thinkingCount,
    commandCount,
    editCount,
    deleteCount,
    editedFiles,
    deletedFiles,
    primaryEditedFilePath,
    primaryDeletedFilePath,
    additions,
    deletions,
    exploredFileCount,
    searchCount: totalSearchCount,
    fetchCount: webFetchCount,
    durationMs: Math.max(timelineDurationMs, artifactDurationMs),
    explorationSegments,
  };
}

function analyzeRuntimeToolSteps(
  toolSteps: ReadonlyArray<TimelineRuntimeToolStep>,
): RuntimeToolGroupAnalysis {
  const editedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  const exploredFiles = new Set<string>();
  let primaryEditedFilePath: string | null = null;
  let primaryDeletedFilePath: string | null = null;
  let commandCount = 0;
  let editCount = 0;
  let deleteCount = 0;
  let readCount = 0;
  let searchCount = 0;
  let fetchCount = 0;
  let additions = 0;
  let deletions = 0;

  for (const step of toolSteps) {
    if (isRuntimeCommandToolStep(step)) {
      commandCount += 1;
      continue;
    }
    if (isRuntimeBrowserToolStep(step)) {
      continue;
    }
    if (isRuntimeDeleteToolStep(step)) {
      deleteCount += 1;
      const path = extractRuntimeEditedFilePath(step.tool);
      if (path) {
        addPath(deletedFiles, path);
        primaryDeletedFilePath ??= path;
      }
      const display = step.tool.display;
      if (display?.kind === "edit") {
        additions += display.additions ?? 0;
        deletions += display.deletions ?? 0;
      }
      continue;
    }
    if (isRuntimeEditToolStep(step)) {
      editCount += 1;
      const path = extractRuntimeEditedFilePath(step.tool);
      if (path) {
        addPath(editedFiles, path);
        primaryEditedFilePath ??= path;
      }
      const display = step.tool.display;
      if (display?.kind === "edit") {
        additions += display.additions ?? 0;
        deletions += display.deletions ?? 0;
      }
      continue;
    }
    const display = step.tool.display;
    if (display?.kind === "read") {
      readCount += 1;
      addPath(exploredFiles, display.path);
      continue;
    }
    if (display?.kind === "grep") {
      searchCount += 1;
      addPath(exploredFiles, display.path);
      addPaths(exploredFiles, display.matchedFiles);
      continue;
    }
    if (display?.kind === "find") {
      searchCount += 1;
      addPath(exploredFiles, display.path);
      continue;
    }
    if (display?.kind === "mcp") {
      const provider = display.providerIdentifier?.toLowerCase() ?? "";
      if (provider.includes("fetch")) {
        fetchCount += 1;
      }
    }
  }

  const exploredFileCount = Math.max(exploredFiles.size, readCount);
  return {
    running: false,
    commandCount,
    editCount,
    deleteCount,
    editedFiles,
    deletedFiles,
    primaryEditedFilePath,
    primaryDeletedFilePath,
    additions,
    deletions,
    exploredFileCount,
    searchCount,
    fetchCount,
    explorationSegments: buildExplorationSegments({
      exploredFileCount,
      searchCount,
      fetchCount,
    }),
  };
}

function summarizeToolGroupAnalysis(
  analysis: ToolGroupAnalysisBase,
  running: boolean,
  projectRoot?: string,
  stepCount?: number,
): WorkGroupSummary {
  if (analysis.editCount > 0) {
    const fileCount = analysis.editedFiles.size || analysis.editCount;
    return {
      action: running ? "Editing" : "Edited",
      details: joinGroupDetailParts([
        formatFileCountSegment(fileCount, analysis.primaryEditedFilePath, projectRoot),
        formatExplorationDetailSegments(analysis.explorationSegments, true),
        analysis.commandCount > 0 ? formatRanCommandSegment(analysis.commandCount) : undefined,
      ]),
      ...(analysis.additions > 0 ? { additions: analysis.additions } : {}),
      ...(analysis.deletions > 0 ? { deletions: analysis.deletions } : {}),
    };
  }

  if (analysis.deleteCount > 0) {
    const fileCount = analysis.deletedFiles.size || analysis.deleteCount;
    return {
      action: running ? "Deleting" : "Deleted",
      details: joinGroupDetailParts([
        formatFileCountSegment(fileCount, analysis.primaryDeletedFilePath, projectRoot),
        formatExplorationDetailSegments(analysis.explorationSegments, true),
        analysis.commandCount > 0 ? formatRanCommandSegment(analysis.commandCount) : undefined,
      ]),
      ...(analysis.deletions > 0 ? { deletions: analysis.deletions } : {}),
    };
  }

  if (analysis.explorationSegments.length > 0 || analysis.commandCount > 0) {
    return {
      action: running ? "Exploring" : "Explored",
      details: joinGroupDetailParts([
        formatExplorationDetailSegments(analysis.explorationSegments, false),
        analysis.commandCount > 0 ? formatRanCommandSegment(analysis.commandCount) : undefined,
      ]),
    };
  }

  return {
    action: running ? "Exploring" : "Explored",
    details: stepCount === undefined || stepCount === 1 ? "1 step" : `${stepCount} steps`,
  };
}

const CURSOR_SINGLE_FILE_PATH_MAX_LENGTH = 20;

function formatThinkingDetails(
  durationMs: number,
  options?: { headerTitle?: string | undefined },
): string {
  const headerTitle = options?.headerTitle?.trim() ?? "";
  const hasHeaderTitle = headerTitle.length > 0;
  const seconds = durationMs > 0 ? Math.round(durationMs / 1_000) : 0;

  if (durationMs > 0 && durationMs < 500) {
    return hasHeaderTitle ? "" : "briefly";
  }
  if (hasHeaderTitle) {
    if (seconds > 0) {
      return `${seconds}s`;
    }
    if (durationMs > 0) {
      return `${(durationMs / 1_000).toFixed(1)}s`;
    }
    return "";
  }
  if (durationMs > 0 && seconds === 0) {
    return `for ${(durationMs / 1_000).toFixed(1)}s`;
  }
  if (seconds > 0) {
    return `for ${seconds}s`;
  }
  return "briefly";
}

function formatCommandCountDetails(commandCount: number): string {
  return commandCount === 1 ? "1 command" : `${commandCount} commands`;
}

function formatBrowserActionCountDetails(browserActionCount: number): string {
  return browserActionCount === 1 ? "1 browser action" : `${browserActionCount} browser actions`;
}

function formatRanCommandSegment(commandCount: number): string {
  return commandCount === 1 ? "ran 1 command" : `ran ${commandCount} commands`;
}

function buildExplorationSegments(input: {
  exploredFileCount: number;
  searchCount: number;
  fetchCount: number;
}): string[] {
  return [
    ...(input.exploredFileCount > 0
      ? [input.exploredFileCount === 1 ? "1 file" : `${input.exploredFileCount} files`]
      : []),
    ...(input.searchCount > 0
      ? [input.searchCount === 1 ? "1 search" : `${input.searchCount} searches`]
      : []),
    ...(input.fetchCount > 0
      ? [input.fetchCount === 1 ? "1 fetch" : `${input.fetchCount} fetches`]
      : []),
  ];
}

function formatExplorationDetailSegments(
  segments: ReadonlyArray<string>,
  prefixFirstSegment: boolean,
): string | undefined {
  if (segments.length === 0) {
    return undefined;
  }
  if (!prefixFirstSegment) {
    return segments.join(", ");
  }
  const [firstSegment, ...rest] = segments;
  if (!firstSegment) {
    return undefined;
  }
  return [`explored ${firstSegment}`, ...rest].join(", ");
}

function formatFileCountSegment(
  fileCount: number,
  primaryPath: string | null,
  projectRoot?: string,
): string {
  if (fileCount === 1) {
    const pathLabel = primaryPath ? formatEditedFileLabel(primaryPath, projectRoot) : null;
    if (pathLabel && pathLabel.length <= CURSOR_SINGLE_FILE_PATH_MAX_LENGTH) {
      return pathLabel;
    }
    return "1 file";
  }
  return `${fileCount} files`;
}

function joinGroupDetailParts(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(", ");
}

function formatEditedFileLabel(path: string, projectRoot: string | undefined): string {
  if (projectRoot) {
    return formatProjectRelativePath(path, projectRoot);
  }
  const trimmed = path.trim();
  const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return lastSeparator === -1 ? trimmed : trimmed.slice(lastSeparator + 1);
}

export function isCommandWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.requestKind === "command" ||
    entry.itemType === "command_execution" ||
    Boolean(entry.command) ||
    Boolean(entry.artifacts?.some((artifact) => artifact.type === "command"))
  );
}

function timelineMinGroupSize(density: ConversationDensity): number {
  return shouldGroupEdits(density) || shouldGroupShells(density) ? 2 : 1;
}

function shouldGroupWorkSteps(
  steps: ReadonlyArray<TimelineWorkStep>,
  density: ConversationDensity,
): boolean {
  if (steps.length === 0) {
    return false;
  }
  const entries = steps.map((step) => step.entry);
  const analysis = analyzeWorkGroup(entries);
  if (analysis.thinkingCount === entries.length) {
    return true;
  }
  if (!shouldGroupToolCalls(density)) {
    return false;
  }
  if (steps.length === 1) {
    const entry = entries[0]!;
    if (isCommandWorkEntry(entry)) {
      return shouldGroupShells(density);
    }
    if (isWorkEditEntry(entry)) {
      return shouldGroupEdits(density);
    }
    return false;
  }
  return steps.length >= timelineMinGroupSize(density);
}

function isWorkEditEntry(entry: WorkLogEntry): boolean {
  return (
    entry.requestKind === "file-change" ||
    entry.itemType === "file_change" ||
    (entry.changedFiles?.length ?? 0) > 0 ||
    Boolean(entry.artifacts?.some((artifact) => artifact.type === "diff"))
  );
}

function isWorkEntryGroupable(entry: WorkLogEntry, density: ConversationDensity): boolean {
  if (isNeverGroupableWorkEntry(entry)) {
    return false;
  }
  if (entry.tone === "thinking") {
    return true;
  }
  if (isCommandWorkEntry(entry)) {
    return shouldGroupShells(density);
  }
  if (isWorkEditEntry(entry)) {
    return shouldGroupEdits(density);
  }
  return shouldGroupToolCalls(density);
}

// Density gates shells/edits unconditionally (Cursor parity): a tool must not become
// un-groupable when it completes, or the streaming group recomposes and the collapsed
// preview flashes once per tool call.
function isRuntimeStepGroupableForDensity(
  step: TimelineRuntimeThinkingStep | TimelineRuntimeToolStep,
  density: ConversationDensity,
): boolean {
  if (step.kind === "runtime-thinking") {
    return true;
  }
  if (isRuntimeCommandToolStep(step)) {
    return shouldGroupShells(density);
  }
  if (isRuntimeEditToolStep(step)) {
    return shouldGroupEdits(density);
  }
  return shouldGroupToolCalls(density);
}

function addPaths(target: Set<string>, paths: ReadonlyArray<string | undefined> | undefined) {
  for (const path of paths ?? []) {
    addPath(target, path);
  }
}

function addPath(target: Set<string>, path: string | undefined) {
  const trimmedPath = path?.trim();
  if (trimmedPath) {
    target.add(trimmedPath);
  }
}
