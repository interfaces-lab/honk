import {
  type MessageId,
  type RuntimeDisplayTimelineCustomMessageItem,
  type RuntimeDisplayTimelineExtensionUiRequestItem,
  type RuntimeDisplayTimelineMessageItem,
  type RuntimeDisplayTimelineToolItem,
} from "@multi/contracts";

import {
  formatDuration,
  type TimelineEntry,
  type ToolDiffArtifact,
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

export interface TimelineCustomMessageStep {
  kind: "custom-message";
  id: string;
  createdAt: string;
  customMessage: RuntimeDisplayTimelineCustomMessageItem;
}

export interface TimelineRuntimeToolStep {
  kind: "runtime-tool";
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
}

export type TimelineStep =
  | TimelineMessageStep
  | TimelineProposedPlanStep
  | TimelineCustomMessageStep
  | TimelineRuntimeThinkingStep
  | TimelineRuntimeToolStep
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
  isThinkingGroup: boolean;
  isCommandGroup: boolean;
  summary: WorkGroupSummary;
  steps: TimelineGroupedStep[];
  entries: WorkLogEntry[];
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
        | TimelineCustomMessageStep
        | TimelineRuntimeThinkingStep
        | TimelineRuntimeToolStep
        | TimelineRuntimeExtensionUiRequestStep;
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
  isWorking: boolean;
  isTurnRunning: boolean;
  activeTurnStartedAt: string | null;
  editableUserMessageIds: ReadonlySet<MessageId>;
  projectRoot?: string | undefined;
}): TimelineRenderItem[] {
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
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        if ((timelineEntry.entry.tone === "thinking") !== (nextEntry.entry.tone === "thinking")) {
          break;
        }
        appendWorkStep(nextEntry);
        cursor += 1;
      }
      const firstStep = steps[0]!;
      const analysis = analyzeWorkGroup(entries);
      if (!input.isTurnRunning) {
        analysis.running = false;
      }
      const group: GroupedSteps = {
        id: firstStep.id,
        createdAt: firstStep.createdAt,
        completedDurationLabel: analysis.running ? null : formatDuration(analysis.durationMs),
        isRunning: analysis.running,
        isThinkingGroup: analysis.thinkingCount === entries.length && analysis.thinkingCount > 0,
        isCommandGroup: analysis.commandCount === entries.length && analysis.commandCount > 0,
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
      index = cursor - 1;
      continue;
    }

    if (isRuntimeGroupableTimelineEntry(timelineEntry)) {
      const steps: Array<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep> = [];
      const appendRuntimeStep = (
        entry: Extract<TimelineEntry, { kind: "runtime-thinking" | "runtime-tool" }>,
      ) => {
        steps.push(runtimeTimelineEntryToStep(entry));
      };
      appendRuntimeStep(timelineEntry);
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || !isRuntimeGroupableTimelineEntry(nextEntry)) break;
        appendRuntimeStep(nextEntry);
        cursor += 1;
      }
      const shouldGroup = steps.length > 1 || steps.some(isRunningRuntimeStep);
      if (!shouldGroup) {
        const step = steps[0]!;
        items.push({
          kind: "single",
          id: step.id,
          createdAt: step.createdAt,
          step,
        });
      } else {
        const group = summarizeRuntimeGroup(steps, { isTurnRunning: input.isTurnRunning });
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

    if (timelineEntry.kind === "custom-message") {
      items.push({
        kind: "single",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        step: {
          kind: "custom-message",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          customMessage: timelineEntry.customMessage,
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

  const lastItem = items.at(-1);
  const hasActiveGroupedTail = lastItem?.kind === "group" && lastItem.group.isRunning;
  if (input.isWorking && !hasActiveGroupedTail) {
    const step: TimelineWaitingStep = {
      kind: "waiting",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
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
  }

  return items;
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
  return entry.kind === "runtime-thinking" || entry.kind === "runtime-tool";
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
  input: { isTurnRunning: boolean },
): GroupedSteps {
  const firstStep = steps[0]!;
  const running = input.isTurnRunning && steps.some(isRunningRuntimeStep);
  const thinkingCount = steps.filter((step) => step.kind === "runtime-thinking").length;
  const toolSteps = steps.filter((step) => step.kind === "runtime-tool");
  const commandCount = toolSteps.filter(isRuntimeCommandToolStep).length;
  const hasError = toolSteps.some((step) => step.tool.status === "error" || step.tool.isError === true);
  return {
    id: firstStep.id,
    createdAt: firstStep.createdAt,
    completedDurationLabel: running ? null : formatDuration(runtimeGroupDurationMs(steps)),
    isRunning: running,
    isThinkingGroup: thinkingCount === steps.length && thinkingCount > 0,
    isCommandGroup: commandCount === steps.length && commandCount > 0,
    summary: summarizeRuntimeGroupSteps({
      commandCount,
      hasError,
      running,
      steps,
      thinkingCount,
      toolCount: toolSteps.length,
    }),
    steps: [...steps],
    entries: [],
  };
}

function summarizeRuntimeGroupSteps(input: {
  readonly commandCount: number;
  readonly hasError: boolean;
  readonly running: boolean;
  readonly steps: ReadonlyArray<TimelineRuntimeThinkingStep | TimelineRuntimeToolStep>;
  readonly thinkingCount: number;
  readonly toolCount: number;
}): WorkGroupSummary {
  if (input.thinkingCount === input.steps.length && input.thinkingCount > 0) {
    return {
      action: input.running ? "Thinking" : "Thought",
      details: input.running
        ? ""
        : formatDuration(runtimeGroupDurationMs(input.steps), {
            subSecond: "briefly",
            prefix: "for ",
          }),
    };
  }
  if (input.commandCount === input.steps.length && input.commandCount > 0) {
    return {
      action: input.running ? "Running" : "Ran",
      details: input.commandCount === 1 ? "1 command" : `${input.commandCount} commands`,
    };
  }
  if (input.hasError) {
    return {
      action: "Error",
      details: input.toolCount === 1 ? "1 tool" : `${input.toolCount} tools`,
    };
  }
  if (input.toolCount > 0 && input.thinkingCount > 0) {
    return {
      action: input.running ? "Working" : "Worked",
      details: [
        input.thinkingCount === 1 ? "1 thought" : `${input.thinkingCount} thoughts`,
        input.toolCount === 1 ? "1 tool" : `${input.toolCount} tools`,
      ].join(", "),
    };
  }
  if (input.toolCount > 0) {
    return {
      action: input.running ? "Using tools" : "Used tools",
      details: input.toolCount === 1 ? "1 tool" : `${input.toolCount} tools`,
    };
  }
  return {
    action: input.running ? "Working" : "Worked",
    details: input.steps.length === 1 ? "1 step" : `${input.steps.length} steps`,
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
      details: analysis.running
        ? ""
        : formatDuration(analysis.durationMs, {
            subSecond: "briefly",
            prefix: "for ",
          }),
    };
  }

  if (analysis.commandCount === entries.length && analysis.commandCount > 0) {
    return {
      action: analysis.running ? "Running" : "Ran",
      details: analysis.commandCount === 1 ? "1 command" : `${analysis.commandCount} commands`,
    };
  }

  if (analysis.editedFiles.size > 0) {
    const editedSegment =
      analysis.editedFiles.size === 1
        ? (formatPrimaryEditedFileLabel(analysis.primaryEditedFilePath, projectRoot) ?? "1 file")
        : `${analysis.editedFiles.size} files`;
    const trailingSegments = [
      ...analysis.explorationSegments,
      ...(analysis.commandCount > 0
        ? [analysis.commandCount === 1 ? "1 command" : `${analysis.commandCount} commands`]
        : []),
    ];
    const detailParts = [
      editedSegment,
      ...trailingSegments.map((segment, index) => (index === 0 ? `explored ${segment}` : segment)),
    ];
    return {
      action: analysis.running ? "Editing" : "Edited",
      details: detailParts.join(", "),
      ...(analysis.additions > 0 ? { additions: analysis.additions } : {}),
      ...(analysis.deletions > 0 ? { deletions: analysis.deletions } : {}),
    };
  }

  if (analysis.explorationSegments.length > 0) {
    return {
      action: analysis.running ? "Exploring" : "Explored",
      details: analysis.explorationSegments.join(", "),
    };
  }

  return {
    action: analysis.running ? "Working" : "Worked",
    details: entries.length === 1 ? "1 step" : `${entries.length} steps`,
  };
}

interface WorkGroupAnalysis {
  running: boolean;
  thinkingCount: number;
  commandCount: number;
  editedFiles: Set<string>;
  primaryEditedFilePath: string | null;
  additions: number;
  deletions: number;
  durationMs: number;
  explorationSegments: string[];
}

function analyzeWorkGroup(entries: ReadonlyArray<WorkLogEntry>): WorkGroupAnalysis {
  const editedFiles = new Set<string>();
  const exploredFiles = new Set<string>();
  let primaryEditedFilePath: string | null = null;
  let running = false;
  let thinkingCount = 0;
  let commandCount = 0;
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

    addPaths(editedFiles, entry.changedFiles);
    if (primaryEditedFilePath === null) {
      primaryEditedFilePath = entry.changedFiles?.[0] ?? null;
    }
    for (const artifact of diffArtifacts) {
      for (const file of artifact.files) {
        addPath(editedFiles, file.path);
        if (primaryEditedFilePath === null) {
          primaryEditedFilePath = file.path;
        }
        additions += file.additions ?? 0;
        deletions += file.deletions ?? 0;
      }
    }
  }

  const fileCount = exploredFiles.size || readCount;
  const explorationSegments = [
    ...(fileCount > 0 ? [fileCount === 1 ? "1 file" : `${fileCount} files`] : []),
    ...(searchCount > 0 ? [searchCount === 1 ? "1 search" : `${searchCount} searches`] : []),
    ...(webSearchCount > 0
      ? [webSearchCount === 1 ? "1 web search" : `${webSearchCount} web searches`]
      : []),
    ...(webFetchCount > 0 ? [webFetchCount === 1 ? "1 fetch" : `${webFetchCount} fetches`] : []),
  ];
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
    editedFiles,
    primaryEditedFilePath,
    additions,
    deletions,
    durationMs: Math.max(timelineDurationMs, artifactDurationMs),
    explorationSegments,
  };
}

function formatPrimaryEditedFileLabel(
  path: string | null,
  projectRoot: string | undefined,
): string | null {
  if (!path) {
    return null;
  }
  return formatEditedFileLabel(path, projectRoot);
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
