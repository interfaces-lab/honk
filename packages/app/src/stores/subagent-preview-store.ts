import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import { create } from "zustand";
import {
  isSubagentProviderSnapshotItemType,
  type WorkLogSubagent,
  type WorkLogSubagentLog,
} from "../session-logic";

export interface SubagentPreviewSelection {
  readonly key: string;
  readonly activeThreadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectRoot: string | undefined;
  readonly subagent: WorkLogSubagent;
}

export function subagentPreviewKey(subagent: WorkLogSubagent): string {
  return subagent.providerThreadId ?? subagent.threadId ?? subagent.agentId;
}

function subagentPreviewIds(subagent: WorkLogSubagent): ReadonlyArray<string> {
  return [subagent.providerThreadId, subagent.threadId, subagent.agentId].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function isSameSubagentPreview(
  current: SubagentPreviewSelection,
  nextSubagent: WorkLogSubagent,
): boolean {
  if (current.key === subagentPreviewKey(nextSubagent)) {
    return true;
  }

  const currentIds = new Set(subagentPreviewIds(current.subagent));
  return subagentPreviewIds(nextSubagent).some((id) => currentIds.has(id));
}

export function isSubagentPreviewLogVisible(
  log: WorkLogSubagentLog,
  hasCanonicalTranscript: boolean,
): boolean {
  if (log.kind === "subagent.content.delta") {
    return false;
  }
  if (!hasCanonicalTranscript) {
    return true;
  }
  if (log.kind === "subagent.thread.state.changed") {
    return false;
  }
  return !isSubagentProviderSnapshotItemType(log.itemType);
}

export function subagentPreviewUpdateSignature(subagent: WorkLogSubagent): string {
  return [
    subagentPreviewKey(subagent),
    subagent.providerThreadId?.trim() ?? "",
    subagent.threadId,
    subagent.agentId ?? "",
    subagent.title ?? "",
    subagent.nickname ?? "",
    subagent.role ?? "",
    subagent.model ?? "",
    subagent.prompt ?? "",
    subagent.parentItemId ?? "",
    subagent.rawStatus ?? "",
    subagent.latestUpdate ?? "",
    subagent.statusLabel ?? "",
    subagent.isActive === true ? "1" : "0",
    subagent.usedTokens ?? "",
    subagent.maxTokens ?? "",
    subagent.usedPercentage ?? "",
    subagent.hasDetails === true ? "1" : "0",
    subagentPreviewVisibleLogsSignature(subagent.logs),
    subagentPreviewTranscriptSignature(subagent.transcriptItems),
  ].join("\u001f");
}

function subagentPreviewTranscriptSignature(
  transcriptItems: WorkLogSubagent["transcriptItems"],
): string {
  if (!transcriptItems || transcriptItems.length === 0) {
    return "";
  }

  return transcriptItems
    .slice(-80)
    .map((item) =>
      [
        item.id,
        item.itemId,
        item.kind,
        item.role ?? "",
        item.title ?? "",
        item.text ?? "",
        item.itemType ?? "",
        item.status ?? "",
        item.streamKind ?? "",
        item.loading ? "1" : "0",
      ].join("\u001e"),
    )
    .join("\u001d");
}

function subagentPreviewVisibleLogsSignature(
  logs: ReadonlyArray<WorkLogSubagentLog> | undefined,
): string {
  if (!logs || logs.length === 0) {
    return "";
  }

  const visibleLogSignatures: string[] = [];
  for (const log of logs) {
    if (log.kind === "subagent.content.delta") {
      continue;
    }
    visibleLogSignatures.push(
      [
        log.id,
        log.kind,
        log.itemId ?? "",
        log.itemType ?? "",
        log.streamKind ?? "",
        log.status ?? "",
        log.label,
        log.detail ?? "",
      ].join("\u001e"),
    );
  }
  return visibleLogSignatures.slice(-80).join("\u001d");
}

interface SubagentPreviewStore {
  focus: SubagentPreviewSelection | null;
  presented: boolean;
  openPreview: (selection: SubagentPreviewSelection) => void;
  updatePreviewSubagent: (subagent: WorkLogSubagent) => void;
  setPreviewPresented: (presented: boolean) => void;
  closePreview: () => void;
}

export const useSubagentPreviewStore = create<SubagentPreviewStore>((set, get) => ({
  focus: null,
  presented: false,
  openPreview: (selection) => set({ focus: selection }),
  updatePreviewSubagent: (subagent) => {
    const current = get().focus;
    if (!current || !isSameSubagentPreview(current, subagent)) {
      return;
    }
    const currentSignature = subagentPreviewUpdateSignature(current.subagent);
    const nextSignature = subagentPreviewUpdateSignature(subagent);
    if (currentSignature === nextSignature) {
      return;
    }
    set({ focus: { ...current, key: subagentPreviewKey(subagent), subagent } });
  },
  setPreviewPresented: (presented) => {
    if (get().presented === presented) {
      return;
    }
    set({ presented });
  },
  closePreview: () => set({ focus: null, presented: false }),
}));
