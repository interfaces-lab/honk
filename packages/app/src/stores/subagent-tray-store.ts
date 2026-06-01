import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import { create } from "zustand";
import {
  isSubagentProviderSnapshotItemType,
  type WorkLogSubagent,
  type WorkLogSubagentLog,
} from "../session-logic";

export interface SubagentTraySelection {
  readonly key: string;
  readonly activeThreadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectRoot: string | undefined;
  readonly subagent: WorkLogSubagent;
}

export function subagentTrayKey(subagent: WorkLogSubagent): string {
  return subagent.providerThreadId ?? subagent.threadId ?? subagent.agentId;
}

function subagentTrayIds(subagent: WorkLogSubagent): ReadonlyArray<string> {
  return [subagent.providerThreadId, subagent.threadId, subagent.agentId].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function isSameSubagentTray(
  current: SubagentTraySelection,
  nextSubagent: WorkLogSubagent,
): boolean {
  if (current.key === subagentTrayKey(nextSubagent)) {
    return true;
  }

  const currentIds = new Set(subagentTrayIds(current.subagent));
  return subagentTrayIds(nextSubagent).some((id) => currentIds.has(id));
}

export function isSubagentTrayLogVisible(
  log: WorkLogSubagentLog,
  hasCanonicalTranscript: boolean,
): boolean {
  if (log.kind === "subagent.content.delta") {
    return false;
  }
  if (
    log.kind === "subagent.item.started" ||
    log.kind === "subagent.item.updated" ||
    log.kind === "subagent.item.completed"
  ) {
    return false;
  }
  if (!hasCanonicalTranscript) {
    return true;
  }
  if (log.kind === "subagent.thread.started" || log.kind === "subagent.thread.state.changed") {
    return false;
  }
  return !isSubagentProviderSnapshotItemType(log.itemType);
}

export function subagentTrayUpdateSignature(subagent: WorkLogSubagent): string {
  return [
    subagentTrayKey(subagent),
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
    subagentTrayVisibleLogsSignature(
      subagent.logs,
      (subagent.transcriptItems?.length ?? 0) > 0,
    ),
    subagentTrayTranscriptSignature(subagent.transcriptItems),
  ].join("\u001f");
}

function subagentTrayTranscriptSignature(
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
        item.command ?? "",
        item.rawCommand ?? "",
        item.output ?? "",
        item.itemType ?? "",
        item.status ?? "",
        item.streamKind ?? "",
        item.loading ? "1" : "0",
      ].join("\u001e"),
    )
    .join("\u001d");
}

function subagentTrayVisibleLogsSignature(
  logs: ReadonlyArray<WorkLogSubagentLog> | undefined,
  hasCanonicalTranscript: boolean,
): string {
  if (!logs || logs.length === 0) {
    return "";
  }

  const visibleLogSignatures: string[] = [];
  for (const log of logs) {
    if (!isSubagentTrayLogVisible(log, hasCanonicalTranscript)) {
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

interface SubagentTrayStore {
  focus: SubagentTraySelection | null;
  presented: boolean;
  openTray: (selection: SubagentTraySelection) => void;
  updateTraySubagent: (subagent: WorkLogSubagent) => void;
  setTrayPresented: (presented: boolean) => void;
  closeTray: () => void;
}

export const useSubagentTrayStore = create<SubagentTrayStore>((set, get) => ({
  focus: null,
  presented: false,
  openTray: (selection) => set({ focus: selection }),
  updateTraySubagent: (subagent) => {
    const current = get().focus;
    if (!current || !isSameSubagentTray(current, subagent)) {
      return;
    }
    const currentSignature = subagentTrayUpdateSignature(current.subagent);
    const nextSignature = subagentTrayUpdateSignature(subagent);
    if (currentSignature === nextSignature) {
      return;
    }
    set({ focus: { ...current, key: subagentTrayKey(subagent), subagent } });
  },
  setTrayPresented: (presented) => {
    if (get().presented === presented) {
      return;
    }
    set({ presented });
  },
  closeTray: () => set({ focus: null, presented: false }),
}));
