import type { OrchestrationProposedPlanId } from "@honk/shared/orchestration";
import type { ThreadId } from "@honk/shared/base-schemas";
import { create } from "zustand";

const STORAGE_KEY = "honk:proposed-plan-lifecycle:v1";

export type ProposedPlanBuildStatus = "none" | "active" | "complete";

interface PersistedProposedPlanLifecycleState {
  readonly dismissedPlanKeys?: unknown;
}

interface ProposedPlanLifecycleStoreState {
  readonly dismissedPlanKeys: readonly string[];
  readonly buildingPlanKeys: readonly string[];
  readonly dismissPlan: (threadId: ThreadId, planId: OrchestrationProposedPlanId) => void;
  readonly markPlanBuilding: (threadId: ThreadId, planId: OrchestrationProposedPlanId) => void;
  readonly clearPlanBuilding: (threadId: ThreadId, planId: OrchestrationProposedPlanId) => void;
}

export function proposedPlanLifecycleKey(
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
): string {
  return `${threadId}:${planId}`;
}

function uniqueStrings(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function readPersistedDismissedPlanKeys(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as PersistedProposedPlanLifecycleState;
    return Array.isArray(parsed.dismissedPlanKeys) ? uniqueStrings(parsed.dismissedPlanKeys) : [];
  } catch {
    return [];
  }
}

function persistDismissedPlanKeys(keys: readonly string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ dismissedPlanKeys: uniqueStrings(keys) }),
    );
  } catch {
    // Ignore storage errors; dismissal still works for the current process.
  }
}

function addKey(keys: readonly string[], key: string): readonly string[] {
  return keys.includes(key) ? keys : [...keys, key];
}

function removeKey(keys: readonly string[], key: string): readonly string[] {
  return keys.includes(key) ? keys.filter((existing) => existing !== key) : keys;
}

export const useProposedPlanLifecycleStore = create<ProposedPlanLifecycleStoreState>((set) => ({
  dismissedPlanKeys: readPersistedDismissedPlanKeys(),
  buildingPlanKeys: [],
  dismissPlan: (threadId, planId) => {
    const key = proposedPlanLifecycleKey(threadId, planId);
    set((state) => {
      const dismissedPlanKeys = addKey(state.dismissedPlanKeys, key);
      persistDismissedPlanKeys(dismissedPlanKeys);
      return { dismissedPlanKeys };
    });
  },
  markPlanBuilding: (threadId, planId) => {
    const key = proposedPlanLifecycleKey(threadId, planId);
    set((state) => {
      const dismissedPlanKeys = addKey(state.dismissedPlanKeys, key);
      persistDismissedPlanKeys(dismissedPlanKeys);
      return {
        dismissedPlanKeys,
        buildingPlanKeys: addKey(state.buildingPlanKeys, key),
      };
    });
  },
  clearPlanBuilding: (threadId, planId) => {
    const key = proposedPlanLifecycleKey(threadId, planId);
    set((state) => ({ buildingPlanKeys: removeKey(state.buildingPlanKeys, key) }));
  },
}));
