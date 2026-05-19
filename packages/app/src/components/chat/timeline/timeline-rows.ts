import { type TimelineEntry, type WorkLogEntry } from "../../../session-logic";
import { type ChatMessage, type ProposedPlan } from "../../../types";
import { type MessageId } from "@multi/contracts";
import { formatProjectRelativePath } from "../shared/file-path-display";

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export interface WorkTimelineRow {
  kind: "work";
  id: string;
  createdAt: string;
  durationStart: string;
  durationMs: number;
  isRunning: boolean;
  summary: WorkGroupSummary;
  groupedEntries: WorkLogEntry[];
}

export interface WorkGroupSummary {
  action: string;
  details: string;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface MessageTimelineRow {
  kind: "message";
  id: string;
  createdAt: string;
  message: ChatMessage;
  durationStart: string;
  revertTurnCount?: number | undefined;
}

export interface ProposedPlanTimelineRow {
  kind: "proposed-plan";
  id: string;
  createdAt: string;
  proposedPlan: ProposedPlan;
}

export interface WorkingTimelineRow {
  kind: "working";
  id: string;
  createdAt: string | null;
}

export type BaseMessagesTimelineRow =
  | WorkTimelineRow
  | MessageTimelineRow
  | ProposedPlanTimelineRow
  | WorkingTimelineRow;

export type MessagesTimelineRow = BaseMessagesTimelineRow;

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

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

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  isWorking: boolean;
  activeTurnStartedAt: string | null;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
  projectRoot?: string | undefined;
}): MessagesTimelineRow[] {
  const baseRows: BaseMessagesTimelineRow[] = [];
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      baseRows.push({
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        durationStart: groupedEntries[0]?.createdAt ?? timelineEntry.createdAt,
        durationMs: computeWorkGroupDurationMs(groupedEntries),
        isRunning: groupedEntries.some((entry) => entry.status === "running"),
        summary: summarizeWorkGroup(groupedEntries, input.projectRoot),
        groupedEntries,
      });
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      baseRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    baseRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  if (input.isWorking) {
    baseRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  return baseRows;
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

/** Shallow field comparison per row variant — avoids deep equality cost. */
function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "working":
      return a.createdAt === (b as typeof a).createdAt;

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "work":
      return isWorkRowUnchanged(a, b as typeof a);

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        a.durationStart === bm.durationStart &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}

export function summarizeWorkGroup(
  entries: ReadonlyArray<WorkLogEntry>,
  projectRoot?: string | undefined,
): WorkGroupSummary {
  const running = entries.some((entry) => entry.status === "running");
  const commandCount = entries.filter(isCommandWorkEntry).length;
  const editedFiles = collectEditedFilePaths(entries);
  const stats = summarizeEditedFileStats(entries);
  const explorationSegments = collectExplorationSegments(entries);

  if (commandCount === entries.length && commandCount > 0) {
    return {
      action: running ? "Running" : "Ran",
      details: countLabel(commandCount, "command"),
    };
  }

  if (editedFiles.size > 0) {
    const editedSegment =
      editedFiles.size === 1
        ? primaryEditedFileLabel(entries, projectRoot) ?? countLabel(1, "file")
        : countLabel(editedFiles.size, "file");
    const trailingSegments = [
      ...explorationSegments,
      ...(commandCount > 0 ? [countLabel(commandCount, "command")] : []),
    ];
    const detailParts = [
      editedSegment,
      ...trailingSegments.map((segment, index) =>
        index === 0 ? `explored ${segment}` : segment,
      ),
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
    details: countLabel(entries.length, "step"),
  };
}

function computeWorkGroupDurationMs(entries: ReadonlyArray<WorkLogEntry>): number {
  const firstEntry = entries[0];
  const lastEntry = entries.at(-1);
  if (!firstEntry || !lastEntry) {
    return 0;
  }

  const startMs = Date.parse(firstEntry.createdAt);
  const endMs = Date.parse(lastEntry.createdAt);
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

function collectExplorationSegments(
  entries: ReadonlyArray<WorkLogEntry>,
): string[] {
  const exploredFiles = collectExploredFilePaths(entries);
  const readCount = entries.filter(isFileReadWorkEntry).length;
  const searchCount = entries.filter(isFileSearchWorkEntry).length;
  const webSearchCount = entries.filter((entry) => entry.itemType === "web_search").length;
  const webFetchCount = entries.filter((entry) => entry.itemType === "web_fetch").length;
  const fileCount = exploredFiles.size || readCount;
  return [
    ...(fileCount > 0 ? [countLabel(fileCount, "file")] : []),
    ...(searchCount > 0 ? [countLabel(searchCount, "search")] : []),
    ...(webSearchCount > 0 ? [countLabel(webSearchCount, "web search")] : []),
    ...(webFetchCount > 0 ? [countLabel(webFetchCount, "fetch")] : []),
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

function formatEditedFileLabel(
  path: string,
  projectRoot: string | undefined,
): string {
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

function isCommandWorkEntry(entry: WorkLogEntry): boolean {
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

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isWorkRowUnchanged(a: WorkTimelineRow, b: WorkTimelineRow): boolean {
  if (a.isRunning || b.isRunning) {
    return false;
  }

  return (
    a.createdAt === b.createdAt &&
    a.durationStart === b.durationStart &&
    a.durationMs === b.durationMs &&
    a.isRunning === b.isRunning &&
    a.summary.action === b.summary.action &&
    a.summary.details === b.summary.details &&
    a.summary.additions === b.summary.additions &&
    a.summary.deletions === b.summary.deletions &&
    areSameWorkEntries(a.groupedEntries, b.groupedEntries)
  );
}

function areSameWorkEntries(
  left: ReadonlyArray<WorkLogEntry>,
  right: ReadonlyArray<WorkLogEntry>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
