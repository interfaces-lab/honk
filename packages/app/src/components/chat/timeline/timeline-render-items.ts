import { type MessageId } from "@multi/contracts";

import { formatDuration, type TimelineEntry, type WorkLogEntry } from "../../../session-logic";
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
  | TimelineWorkStep
  | TimelineWaitingStep;

export interface GroupedSteps {
  id: string;
  createdAt: string;
  durationStart: string;
  durationMs: number;
  isRunning: boolean;
  summary: WorkGroupSummary;
  steps: TimelineWorkStep[];
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
      step: TimelineMessageStep | TimelineProposedPlanStep;
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
  activeTurnStartedAt: string | null;
  editableUserMessageIds: ReadonlySet<MessageId>;
  projectRoot?: string | undefined;
}): TimelineRenderItem[] {
  const items: TimelineRenderItem[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  let currentPairId: MessageId | null = null;
  let messageIndex = 0;

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const steps: TimelineWorkStep[] = [
        {
          kind: "work",
          id: timelineEntry.id,
          createdAt: timelineEntry.createdAt,
          entry: timelineEntry.entry,
        },
      ];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        if ((timelineEntry.entry.tone === "thinking") !== (nextEntry.entry.tone === "thinking")) {
          break;
        }
        steps.push({
          kind: "work",
          id: nextEntry.id,
          createdAt: nextEntry.createdAt,
          entry: nextEntry.entry,
        });
        cursor += 1;
      }
      const entries = steps.map((step) => step.entry);
      const firstStep = steps[0]!;
      const group: GroupedSteps = {
        id: firstStep.id,
        createdAt: firstStep.createdAt,
        durationStart: entries[0]?.createdAt ?? firstStep.createdAt,
        durationMs: computeWorkGroupDurationMs(entries),
        isRunning: entries.some((entry) => entry.status === "running"),
        summary: summarizeWorkGroup(entries, input.projectRoot),
        steps,
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
    const step: TimelineMessageStep = {
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message,
      durationStart: durationStartByMessageId.get(message.id) ?? message.createdAt,
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
  }

  if (input.isWorking) {
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
  projectRoot?: string | undefined,
): WorkGroupSummary {
  const running = entries.some((entry) => entry.status === "running");
  const thinkingCount = entries.filter((entry) => entry.tone === "thinking").length;
  const commandCount = entries.filter(isCommandWorkEntry).length;
  const editedFiles = collectEditedFilePaths(entries);
  const stats = summarizeEditedFileStats(entries);
  const explorationSegments = collectExplorationSegments(entries);

  if (thinkingCount === entries.length && thinkingCount > 0) {
    return {
      action: running ? "Thinking" : "Thought",
      details: running
        ? ""
        : formatDuration(computeWorkGroupDurationMs(entries), {
            subSecond: "briefly",
            prefix: "for ",
          }),
    };
  }

  if (commandCount === entries.length && commandCount > 0) {
    return {
      action: running ? "Running" : "Ran",
      details: commandCount === 1 ? "1 command" : `${commandCount} commands`,
    };
  }

  if (editedFiles.size > 0) {
    const editedSegment =
      editedFiles.size === 1
        ? (primaryEditedFileLabel(entries, projectRoot) ?? "1 file")
        : `${editedFiles.size} files`;
    const trailingSegments = [
      ...explorationSegments,
      ...(commandCount > 0 ? [commandCount === 1 ? "1 command" : `${commandCount} commands`] : []),
    ];
    const detailParts = [
      editedSegment,
      ...trailingSegments.map((segment, index) => (index === 0 ? `explored ${segment}` : segment)),
    ];
    return {
      action: running ? "Editing" : "Edited",
      details: detailParts.join(", "),
      ...(stats.additions > 0 ? { additions: stats.additions } : {}),
      ...(stats.deletions > 0 ? { deletions: stats.deletions } : {}),
    };
  }

  if (explorationSegments.length > 0) {
    return {
      action: running ? "Exploring" : "Explored",
      details: explorationSegments.join(", "),
    };
  }

  return {
    action: running ? "Working" : "Worked",
    details: entries.length === 1 ? "1 step" : `${entries.length} steps`,
  };
}

function computeWorkGroupDurationMs(entries: ReadonlyArray<WorkLogEntry>): number {
  const firstEntry = entries[0];
  const lastEntry = entries.at(-1);
  if (!firstEntry || !lastEntry) {
    return 0;
  }

  const startMs = Date.parse(firstEntry.createdAt);
  const endMs = Date.parse(lastEntry.completedAt ?? lastEntry.createdAt);
  const timelineDurationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
  const artifactDurationMs = entries.reduce((total, entry) => {
    const commandArtifactDurationMs =
      entry.artifacts
        ?.filter((artifact) => artifact.type === "command")
        .reduce((artifactTotal, artifact) => artifactTotal + (artifact.durationMs ?? 0), 0) ?? 0;
    return total + commandArtifactDurationMs;
  }, 0);

  return Math.max(timelineDurationMs, artifactDurationMs);
}

function collectExplorationSegments(entries: ReadonlyArray<WorkLogEntry>): string[] {
  const exploredFiles = collectExploredFilePaths(entries);
  const readCount = entries.filter(isFileReadWorkEntry).length;
  const searchCount = entries.filter(isFileSearchWorkEntry).length;
  const webSearchCount = entries.filter((entry) => entry.itemType === "web_search").length;
  const webFetchCount = entries.filter((entry) => entry.itemType === "web_fetch").length;
  const fileCount = exploredFiles.size || readCount;
  return [
    ...(fileCount > 0 ? [fileCount === 1 ? "1 file" : `${fileCount} files`] : []),
    ...(searchCount > 0 ? [searchCount === 1 ? "1 search" : `${searchCount} searches`] : []),
    ...(webSearchCount > 0
      ? [webSearchCount === 1 ? "1 web search" : `${webSearchCount} web searches`]
      : []),
    ...(webFetchCount > 0 ? [webFetchCount === 1 ? "1 fetch" : `${webFetchCount} fetches`] : []),
  ];
}

function primaryEditedFileLabel(
  entries: ReadonlyArray<WorkLogEntry>,
  projectRoot: string | undefined,
): string | null {
  for (const entry of entries) {
    if (!isFileChangeWorkEntry(entry)) continue;
    const path = entry.changedFiles?.[0];
    if (path) return formatEditedFileLabel(path, projectRoot);
    for (const artifact of diffArtifactsForEntry(entry)) {
      const filePath = artifact.files[0]?.path;
      if (filePath) return formatEditedFileLabel(filePath, projectRoot);
    }
  }
  return null;
}

function formatEditedFileLabel(path: string, projectRoot: string | undefined): string {
  if (projectRoot) {
    return formatProjectRelativePath(path, projectRoot);
  }
  const trimmed = path.trim();
  const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return lastSeparator === -1 ? trimmed : trimmed.slice(lastSeparator + 1);
}

function collectEditedFilePaths(entries: ReadonlyArray<WorkLogEntry>): Set<string> {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!isFileChangeWorkEntry(entry)) {
      continue;
    }
    addPaths(paths, entry.changedFiles);
    for (const artifact of diffArtifactsForEntry(entry)) {
      addPaths(
        paths,
        artifact.files.map((file) => file.path),
      );
    }
  }
  return paths;
}

function collectExploredFilePaths(entries: ReadonlyArray<WorkLogEntry>): Set<string> {
  const paths = new Set<string>();
  for (const entry of entries) {
    for (const artifact of entry.artifacts ?? []) {
      if (artifact.type === "read") {
        addPath(paths, artifact.path);
      }
      if (artifact.type === "search") {
        addPaths(paths, artifact.matchedFiles);
      }
    }
  }
  return paths;
}

function summarizeEditedFileStats(entries: ReadonlyArray<WorkLogEntry>): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const entry of entries) {
    for (const artifact of diffArtifactsForEntry(entry)) {
      for (const file of artifact.files) {
        additions += file.additions ?? 0;
        deletions += file.deletions ?? 0;
      }
    }
  }
  return { additions, deletions };
}

function diffArtifactsForEntry(entry: WorkLogEntry) {
  const diffArtifacts = entry.artifacts?.filter((artifact) => artifact.type === "diff") ?? [];
  const resultArtifacts = diffArtifacts.filter((artifact) => artifact.source === "result");
  return resultArtifacts.length > 0 ? resultArtifacts : diffArtifacts;
}

export function isCommandWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.requestKind === "command" ||
    entry.itemType === "command_execution" ||
    Boolean(entry.command) ||
    Boolean(entry.artifacts?.some((artifact) => artifact.type === "command"))
  );
}

function isFileChangeWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.requestKind === "file-change" ||
    entry.itemType === "file_change" ||
    (entry.changedFiles?.length ?? 0) > 0 ||
    Boolean(entry.artifacts?.some((artifact) => artifact.type === "diff"))
  );
}

function isFileReadWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.requestKind === "file-read" ||
    entry.itemType === "file_read" ||
    Boolean(entry.artifacts?.some((artifact) => artifact.type === "read"))
  );
}

function isFileSearchWorkEntry(entry: WorkLogEntry): boolean {
  return (
    entry.itemType === "file_search" ||
    Boolean(entry.artifacts?.some((artifact) => artifact.type === "search"))
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
