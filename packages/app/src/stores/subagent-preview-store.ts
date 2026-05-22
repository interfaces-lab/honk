import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import { create } from "zustand";
import { type WorkLogSubagent } from "../session-logic";

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

interface SubagentPreviewStore {
  preview: SubagentPreviewSelection | null;
  openPreview: (selection: SubagentPreviewSelection) => void;
  updatePreviewSubagent: (subagent: WorkLogSubagent) => void;
  closePreview: () => void;
}

export const useSubagentPreviewStore = create<SubagentPreviewStore>((set, get) => ({
  preview: null,
  openPreview: (selection) => set({ preview: selection }),
  updatePreviewSubagent: (subagent) => {
    const current = get().preview;
    if (!current || !isSameSubagentPreview(current, subagent)) {
      return;
    }
    set({ preview: { ...current, key: subagentPreviewKey(subagent), subagent } });
  },
  closePreview: () => set({ preview: null }),
}));
