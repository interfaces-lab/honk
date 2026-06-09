import {
  type MessageId,
  type RuntimeDisplayTimelineExtensionUiRequestItem,
  type RuntimeDisplayTimelineMessageItem,
  type RuntimeDisplayTimelineToolItem,
} from "@multi/contracts";
import {
  DEFAULT_CONVERSATION_DENSITY,
  type ConversationDensity,
} from "@multi/contracts/settings";
import {
  shouldGroupEdits,
  shouldGroupShells,
} from "@multi/shared/conversation-density";

import {
  formatDuration,
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
  | TimelineWorkStep;

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

/**
 * Snapshot of the trailing grouped row. Pass from `readTailGroupSnapshot` on the prior
 * derivation while `isTurnActive` so a brief empty regroup does not flicker the tail away.
 * `messages-timeline.tsx` is the intended consumer for this hook point.
 */
export function readTailGroupSnapshot(
  items: ReadonlyArray<TimelineRenderItem>,
): GroupedSteps | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "group") {
      return item.group;
    }
  }
  return null;
}

export function deriveTimelineRenderItems(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  isWorking: boolean;
  isTurnActive: boolean;
  editableUserMessageIds: ReadonlySet<MessageId>;
  projectRoot?: string | undefined;
  conversationDensity?: ConversationDensity | undefined;
  tailGroupSnapshot?: GroupedSteps | null | undefined;
}): TimelineRenderItem[] {
  const conversationDensity = input.conversationDensity ?? DEFAULT_CONVERSATION_DENSITY;
  const items: TimelineRenderItem[] = [];
  let lastMessageDurationBoundary: string | null = null;
  let currentPairId: MessageId | null = null;
  let messageIndex = 0;

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const steps: TimelineWorkStep[] = [];
      const entries: WorkLogEntry[] = [];
      const appendWorkStep = (entry: Extract<TimelineEntry, { kind: "work" }>) => {
        steps.push({
          kind: "work",
          id: entry.id,
          createdAt: entry.createdAt,
          entry: entry.entry,
        });
        entries.push(entry.entry);
      };
      appendWorkStep(timelineEntry);
      const canGroupCurrentEntry = isWorkEntryGroupable(timelineEntry.entry, conversationDensity);
      let cursor = index + 1;
      if (canGroupCurrentEntry) {
        while (cursor < input.timelineEntries.length) {
          const nextEntry = input.timelineEntries[cursor];
          if (!nextEntry || nextEntry.kind !== "work") break;
          if (
            (timelineEntry.entry.tone === "thinking") !== (nextEntry.entry.tone === "thinking")
          ) {
            break;
          }
          if (!isWorkEntryGroupable(nextEntry.entry, conversationDensity)) {
            break;
          }
          appendWorkStep(nextEntry);
          cursor += 1;
        }
      }
      const analysis = analyzeWorkGroup(entries);
      if (!input.isTurnActive) {
        analysis.running = false;
      }
      if (shouldGroupWorkSteps(steps, conversationDensity, analysis.running)) {
        const firstStep = steps[0]!;
        const group: GroupedSteps = {
          id: firstStep.id,
          createdAt: firstStep.createdAt,
          completedDurationLabel: analysis.running ? null : formatDuration(analysis.durationMs),
          isRunning: analysis.running,
          isTailGroup: false,
          isThinkingGroup: analysis.thinkingCount === entries.length && analysis.thinkingCount > 0,
          isCommandGroup: analysis.commandCount === entries.length && analysis.commandCount > 0,
          isWaitingGroup: false,
          isBrowserGroup: false,
          summary: summarizeAnalyzedWorkGroup(entries, analysis, input.projectRoot),
          steps,
          entries,
        };
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
      index = cursor - 1;
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
      if (awaitToolCount >= MIN_RUNTIME_SPECIAL_GROUP_TOOLS) {
        const group = summarizeRuntimeWaitingGroup(steps, {
          isWorking: input.isWorking,
          isTurnActive: input.isTurnActive,
        });
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
      if (browserToolCount >= MIN_RUNTIME_SPECIAL_GROUP_TOOLS) {
        const group = summarizeRuntimeBrowserGroup(steps, {
          isWorking: input.isWorking,
          isTurnActive: input.isTurnActive,
        });
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

    if (isRuntimeGroupableTimelineEntry(timelineEntry)) {
      const firstStep = runtimeTimelineEntryToStep(timelineEntry);
      if (!isRuntimeStepGroupableForDensity(firstStep, conversationDensity)) {
        items.push({
          kind: "single",
          id: firstStep.id,
          createdAt: firstStep.createdAt,
          step: firstStep,
        });
        continue;
      }

      const steps: Array<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep> = [firstStep];
      const appendRuntimeStep = (
        entry: Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }>,
      ) => {
        steps.push(runtimeTimelineEntryToStep(entry));
      };
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || !isRuntimeGroupableTimelineEntry(nextEntry)) break;
        const nextStep = runtimeTimelineEntryToStep(nextEntry);
        if (!isRuntimeStepGroupableForDensity(nextStep, conversationDensity)) break;
        appendRuntimeStep(nextEntry);
        cursor += 1;
      }
      const shouldGroup = shouldGroupRuntimeSteps(steps);
      if (!shouldGroup) {
        for (const step of steps) {
          items.push({
            kind: "single",
            id: step.id,
            createdAt: step.createdAt,
            step,
          });
        }
      } else {
        const group = summarizeRuntimeGroup(steps, {
          isWorking: input.isWorking,
          isTurnActive: input.isTurnActive,
          projectRoot: input.projectRoot,
        });
        items.push({
          kind: "group",
          id: group.id,
          createdAt: group.createdAt,
          group,
        });
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

  if (
    input.isTurnActive &&
    input.tailGroupSnapshot &&
    !items.some((item) => item.kind === "group")
  ) {
    items.push({
      kind: "group",
      id: input.tailGroupSnapshot.id,
      createdAt: input.tailGroupSnapshot.createdAt,
      group: input.tailGroupSnapshot,
    });
  }

  return applyTailOnlyLoadingSemantics(items, {
    isTurnActive: input.isTurnActive,
    isWorking: input.isWorking,
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
  return entry.kind === "runtime-thinking" || (
    entry.kind === "runtime-tool" && entry.tool.display?.kind !== "subagent"
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

function summarizeRuntimeGroup(
  steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>,
  input: { isWorking: boolean; isTurnActive: boolean; projectRoot?: string | undefined },
): GroupedSteps {
  const firstStep = steps[0]!;
  const running =
    input.isWorking && input.isTurnActive && steps.some(isActivelyRunningGroupedStep);
  const thinkingCount = steps.filter((step) => step.kind === "runtime-thinking").length;
  const toolSteps = steps.filter((step) => step.kind === "runtime-tool");
  const commandCount = toolSteps.filter(isRuntimeCommandToolStep).length;
  const browserCount = toolSteps.filter(isRuntimeBrowserToolStep).length;
  const hasError = toolSteps.some((step) => step.tool.status === "error" || step.tool.isError === true);
  const toolAnalysis = analyzeRuntimeToolSteps(toolSteps);
  return {
    id: firstStep.id,
    createdAt: firstStep.createdAt,
    completedDurationLabel: running ? null : formatDuration(runtimeGroupDurationMs(steps)),
    isRunning: running,
    isTailGroup: false,
    isThinkingGroup: thinkingCount === steps.length && thinkingCount > 0,
    isCommandGroup: commandCount === toolSteps.length && commandCount > 0,
    isWaitingGroup: false,
    isBrowserGroup: browserCount === toolSteps.length && browserCount > 0,
    summary: summarizeRuntimeGroupSteps({
      browserCount,
      commandCount,
      hasError,
      running,
      steps,
      thinkingCount,
      toolAnalysis,
      toolCount: toolSteps.length,
    }),
    steps: [...steps],
    entries: [],
  };
}

function summarizeRuntimeWaitingGroup(
  steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>,
  input: { isWorking: boolean; isTurnActive: boolean },
): GroupedSteps {
  const firstStep = steps[0]!;
  const running = input.isWorking && input.isTurnActive && steps.some(isActivelyRunningGroupedStep);
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
  input: { isWorking: boolean; isTurnActive: boolean },
): GroupedSteps {
  const firstStep = steps[0]!;
  const running = input.isWorking && input.isTurnActive && steps.some(isActivelyRunningGroupedStep);
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

function summarizeRuntimeGroupSteps(input: {
  readonly browserCount: number;
  readonly commandCount: number;
  readonly hasError: boolean;
  readonly running: boolean;
  readonly steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>;
  readonly thinkingCount: number;
  readonly toolAnalysis: RuntimeToolGroupAnalysis;
  readonly toolCount: number;
}): WorkGroupSummary {
  if (input.thinkingCount === input.steps.length && input.thinkingCount > 0) {
    return {
      action: input.running ? "Thinking" : "Thought",
      details: input.running ? "" : formatThinkingDetails(runtimeGroupDurationMs(input.steps)),
    };
  }
  if (input.commandCount === input.toolCount && input.commandCount > 0) {
    return {
      action: input.running ? "Running" : "Ran",
      details: formatCommandCountDetails(input.commandCount),
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
    input.toolAnalysis,
    input.running,
    undefined,
    input.toolCount + input.thinkingCount,
  );
}

function shouldGroupRuntimeSteps(
  steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>,
  minGroupSize = RUNTIME_DEFAULT_MIN_GROUP_SIZE,
): boolean {
  if (steps.length === 0) {
    return false;
  }

  const hasThinking = steps.some((step) => step.kind === "runtime-thinking");
  const exploreOnly =
    !hasThinking &&
    steps.every(
      (step) =>
        step.kind === "runtime-thinking" ||
        (step.kind === "runtime-tool" && isExploreRuntimeToolStep(step)),
    );
  const toolSteps = steps.filter((step): step is TimelineRuntimeToolStep => step.kind === "runtime-tool");
  const toolCount = toolSteps.length;
  const isSingleShell = toolCount === 1 && toolSteps.some(isRuntimeCommandToolStep);
  const minSize = exploreOnly
    ? Math.max(minGroupSize, RUNTIME_EXPLORE_ONLY_MIN_GROUP_SIZE)
    : minGroupSize;
  const groupCount = isSingleShell ? toolCount : hasThinking ? steps.length : toolCount;

  return groupCount >= minSize;
}

function isExploreRuntimeToolStep(step: TimelineRuntimeToolStep): boolean {
  const displayKind = step.tool.display?.kind;
  if (displayKind === "shell" || displayKind === "edit" || displayKind === "subagent") {
    return false;
  }
  if (displayKind === "read" || displayKind === "grep" || displayKind === "mcp") {
    return true;
  }
  switch (step.tool.toolName) {
    case "read":
    case "grep":
    case "glob":
    case "ls":
    case "web_search":
    case "web_fetch":
      return true;
    default:
      return false;
  }
}

function applyTailOnlyLoadingSemantics(
  items: TimelineRenderItem[],
  input: { isTurnActive: boolean; isWorking: boolean; projectRoot?: string | undefined },
): TimelineRenderItem[] {
  if (!input.isTurnActive) {
    return items.map((item) => {
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
    });
  }

  const tailGroupIndex = findTailGroupRenderItemIndex(items, input);
  if (tailGroupIndex === -1) {
    return items;
  }

  return items.map((item, index) => {
    if (item.kind !== "group") {
      return item;
    }

    const isTailGroup = index === tailGroupIndex;
    if (isTailGroup) {
      const isRunning = resolveTailWorkGroupRunning(item.group, input);
      return {
        ...item,
        group: {
          ...item.group,
          isTailGroup: true,
          isRunning,
          completedDurationLabel: isRunning ? null : item.group.completedDurationLabel,
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
}

export function resolveTailWorkGroupRunning(
  group: GroupedSteps,
  input: { isTurnActive: boolean; isWorking: boolean },
): boolean {
  if (!input.isTurnActive || !input.isWorking) {
    return false;
  }
  return group.steps.some(isActivelyRunningGroupedStep);
}

export function isActivelyRunningGroupedStep(step: TimelineGroupedStep): boolean {
  if (step.kind === "work") {
    return step.entry.status === "running";
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

function findTailGroupRenderItemIndex(
  items: ReadonlyArray<TimelineRenderItem>,
  input: { isTurnActive: boolean; isWorking: boolean },
): number {
  if (input.isWorking) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.kind !== "group") {
        continue;
      }
      if (item.group.steps.some(isActivelyRunningGroupedStep)) {
        return index;
      }
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
    return -1;
  }
  return lastGroupIndex;
}

function completeGroupedSteps(
  group: GroupedSteps,
  projectRoot?: string | undefined,
): GroupedSteps {
  if (!group.isRunning) {
    return {
      ...group,
      isTailGroup: false,
    };
  }

  if (group.entries.length > 0) {
    const analysis = analyzeWorkGroup(group.entries);
    analysis.running = false;
    return {
      ...group,
      isRunning: false,
      isTailGroup: false,
      completedDurationLabel: formatDuration(analysis.durationMs),
      summary: summarizeAnalyzedWorkGroup(group.entries, analysis, projectRoot),
    };
  }

  const runtimeSteps = group.steps.filter(
    (step): step is TimelineRuntimeThinkingStep | TimelineRuntimeToolStep =>
      step.kind === "runtime-thinking" || step.kind === "runtime-tool",
  );
  if (group.isWaitingGroup) {
    const awaitSteps = runtimeSteps.filter(
      (step): step is TimelineRuntimeToolStep =>
        step.kind === "runtime-tool" && isRuntimeAwaitToolStep(step),
    );
    return {
      ...group,
      isRunning: false,
      isTailGroup: false,
      completedDurationLabel: formatDuration(runtimeGroupDurationMs(runtimeSteps)),
      summary: formatMonitoringBackgroundSummary({
        running: false,
        ...countAwaitJobStats(awaitSteps),
      }),
    };
  }
  if (group.isBrowserGroup) {
    const browserCount = countRuntimeBrowserMcpToolSteps(runtimeSteps);
    return {
      ...group,
      isRunning: false,
      isTailGroup: false,
      completedDurationLabel: formatDuration(runtimeGroupDurationMs(runtimeSteps)),
      summary: {
        action: "Ran",
        details: formatBrowserActionCountDetails(browserCount),
      },
    };
  }
  const thinkingCount = runtimeSteps.filter((step) => step.kind === "runtime-thinking").length;
  const toolSteps = runtimeSteps.filter((step): step is TimelineRuntimeToolStep => step.kind === "runtime-tool");
  const commandCount = toolSteps.filter(isRuntimeCommandToolStep).length;
  const browserCount = toolSteps.filter(isRuntimeBrowserToolStep).length;
  const hasError = toolSteps.some(
    (step) => step.tool.status === "error" || step.tool.isError === true,
  );
  const toolAnalysis = analyzeRuntimeToolSteps(toolSteps);

  return {
    ...group,
    isRunning: false,
    isTailGroup: false,
    completedDurationLabel: formatDuration(runtimeGroupDurationMs(runtimeSteps)),
    summary: summarizeRuntimeGroupSteps({
      browserCount,
      commandCount,
      hasError,
      running: false,
      steps: runtimeSteps,
      thinkingCount,
      toolAnalysis,
      toolCount: toolSteps.length,
    }),
  };
}

function isRunningRuntimeStep(step: TimelineRuntimeThinkingStep | TimelineRuntimeToolStep): boolean {
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
  return (
    toolName.includes("edit") ||
    toolName.includes("write") ||
    toolName.includes("patch")
  );
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

function runtimeGroupDurationMs(
  steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>,
): number {
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
    if (
      entry.requestKind === "file-read" ||
      entry.itemType === "file_read" ||
      hasReadArtifact
    ) {
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

  const explorationSegments = buildExplorationSegments({
    exploredFileCount: Math.max(exploredFiles.size, readCount),
    searchCount: searchCount + webSearchCount,
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
    if (display?.kind === "mcp") {
      const provider = display.providerIdentifier?.toLowerCase() ?? "";
      if (provider.includes("fetch")) {
        fetchCount += 1;
      }
    }
  }

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
    explorationSegments: buildExplorationSegments({
      exploredFileCount: Math.max(exploredFiles.size, readCount),
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
    details:
      stepCount === undefined || stepCount === 1 ? "1 step" : `${stepCount} steps`,
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
  return browserActionCount === 1
    ? "1 browser action"
    : `${browserActionCount} browser actions`;
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
  running: boolean,
): boolean {
  if (steps.length === 0) {
    return false;
  }
  const entries = steps.map((step) => step.entry);
  const analysis = analyzeWorkGroup(entries);
  if (analysis.thinkingCount === entries.length) {
    return true;
  }
  if (steps.length === 1) {
    const entry = entries[0]!;
    if (isCommandWorkEntry(entry)) {
      return shouldGroupShells(density) || running;
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
  if (entry.tone === "thinking") {
    return true;
  }
  if (isCommandWorkEntry(entry)) {
    return shouldGroupShells(density);
  }
  if (isWorkEditEntry(entry)) {
    return shouldGroupEdits(density);
  }
  return true;
}

function isRuntimeStepGroupableForDensity(
  step: TimelineRuntimeThinkingStep | TimelineRuntimeToolStep,
  density: ConversationDensity,
): boolean {
  if (step.kind === "runtime-thinking") {
    return true;
  }
  if (step.tool.status === "running" && isRuntimePreviewGroupableToolStep(step)) {
    return true;
  }
  if (isRuntimeCommandToolStep(step)) {
    return shouldGroupShells(density);
  }
  if (isRuntimeEditToolStep(step)) {
    return shouldGroupEdits(density);
  }
  return true;
}

function isRuntimePreviewGroupableToolStep(step: TimelineRuntimeToolStep): boolean {
  return isRuntimeCommandToolStep(step) || isRuntimeEditToolStep(step);
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
