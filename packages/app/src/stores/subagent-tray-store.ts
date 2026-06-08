import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import { create } from "zustand";
import {
  isSubagentSnapshotItemType,
  type WorkLogSubagent,
  type WorkLogSubagentLog,
} from "../session-logic";

export interface SubagentTraySelection {
  readonly key: string;
  readonly activeThreadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectRoot: string | undefined;
  readonly subagentThreadId?: string | undefined;
  readonly threadId?: string | undefined;
  readonly agentId?: string | undefined;
}

export function subagentTrayKey(subagent: WorkLogSubagent): string {
  return subagent.subagentThreadId ?? subagent.threadId ?? subagent.agentId;
}

export function subagentTraySelection(input: {
  readonly activeThreadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectRoot: string | undefined;
  readonly subagent: WorkLogSubagent;
}): SubagentTraySelection {
  return {
    key: subagentTrayKey(input.subagent),
    activeThreadId: input.activeThreadId,
    environmentId: input.environmentId,
    projectRoot: input.projectRoot,
    ...(input.subagent.subagentThreadId
      ? { subagentThreadId: input.subagent.subagentThreadId }
      : {}),
    ...(input.subagent.threadId ? { threadId: input.subagent.threadId } : {}),
    ...(input.subagent.agentId ? { agentId: input.subagent.agentId } : {}),
  };
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
  return !isSubagentSnapshotItemType(log.itemType);
}

interface SubagentTrayStore {
  focus: SubagentTraySelection | null;
  presented: boolean;
  openTray: (selection: SubagentTraySelection) => void;
  setTrayPresented: (presented: boolean) => void;
  closeTray: () => void;
}

export const useSubagentTrayStore = create<SubagentTrayStore>((set, get) => ({
  focus: null,
  presented: false,
  openTray: (selection) => set({ focus: selection }),
  setTrayPresented: (presented) => {
    if (get().presented === presented) {
      return;
    }
    set({ presented });
  },
  closeTray: () => set({ focus: null, presented: false }),
}));
