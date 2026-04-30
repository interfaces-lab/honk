// @ts-nocheck
import type { ModelSelection, ServerConfig } from "@multi/contracts";
import type {
  UiSessionActiveEvent,
  UiSessionItem,
  UiSessionSnapshot,
  SessionListSummary,
  UiWorkingState,
  UiWorkingUpdate,
  HarnessKind,
  HarnessModelRef,
  ThinkingLevel,
} from "~/lib/ui-session-types";
import { create } from "zustand";

import { readNativeApi } from "./native-runtime-api";
import { getServerConfig } from "../rpc/server-state";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "../store";
import type { Project, Thread } from "../types";
import { assistantBlocks } from "./assistant-content";

export type ThreadBootStatus = "loading" | "ready" | "error";

type State = {
  cfg: ServerConfig | null;
  cfgStatus: ThreadBootStatus;
  cfgError: string | null;
  ids: string[];
  sums: Record<string, SessionListSummary>;
  sumsStatus: ThreadBootStatus;
  sumsError: string | null;
  snaps: Record<string, UiSessionSnapshot>;
  work: Record<string, UiWorkingState>;
  ready: boolean;
  boot: () => Promise<void>;
  refreshCfg: () => Promise<void>;
  refreshSums: () => Promise<void>;
  putSnap: (snap: UiSessionSnapshot) => void;
  syncWork: (items: ReadonlyArray<UiWorkingState>) => void;
  putWork: (item: UiWorkingUpdate) => void;
  applyActs: (_events: UiSessionActiveEvent[]) => void;
  syncDomain: () => void;
};

function nowStatus(cfg: ThreadBootStatus, sums: ThreadBootStatus) {
  return cfg === "ready" && sums === "ready";
}

function toHarness(provider: "codex" | "claudeAgent" | null | undefined): HarnessKind {
  if (provider === "claudeAgent") return "claudeCode";
  if (provider === "codex") return "codex";
  return "codex";
}

function toModel(selection: ModelSelection | null | undefined): HarnessModelRef | null {
  if (!selection) return null;
  return {
    provider: selection.provider,
    id: selection.model,
    name: selection.model,
    reasoning:
      selection.provider === "codex"
        ? Boolean(selection.options?.reasoningEffort)
        : Boolean(selection.options?.thinking) || Boolean(selection.options?.effort),
  };
}

function toThinking(selection: ModelSelection | null | undefined): ThinkingLevel {
  if (!selection) return "off";
  if (selection.provider === "codex") {
    switch (selection.options?.reasoningEffort) {
      case "low":
        return "low";
      case "medium":
        return "medium";
      case "high":
        return "high";
      case "xhigh":
        return "xhigh";
      default:
        return "off";
    }
  }

  if (selection.options?.thinking === false) {
    return "off";
  }

  switch (selection.options?.effort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "max":
    case "ultrathink":
      return "xhigh";
    default:
      return selection.options?.thinking ? "medium" : "off";
  }
}

function attachText(
  text: string,
  items: ReadonlyArray<Thread["messages"][number]["attachments"]>[number],
) {
  if (!items || items.length === 0) return text;
  const suffix = items.map((item) => `<file name="${item.name}">${item.name}</file>`).join("\n");
  return text.length > 0 ? `${text}\n\n${suffix}` : suffix;
}

function toMsg(item: Thread["messages"][number]): UiSessionItem {
  if (item.role === "user") {
    return {
      id: item.id,
      createdAt: item.createdAt,
      message: {
        role: "user",
        content: attachText(item.text, item.attachments),
      },
    };
  }

  if (item.role === "assistant") {
    return {
      id: item.id,
      createdAt: item.createdAt,
      message: {
        role: "assistant",
        content: assistantBlocks(item),
      },
    };
  }

  if (item.role === "toolResult") {
    return {
      id: item.id,
      createdAt: item.createdAt,
      message: {
        role: "toolResult",
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        content: item.text,
        isError: item.isError,
        details: item.details,
      },
    };
  }

  return {
    id: item.id,
    createdAt: item.createdAt,
    message: {
      role: "system",
      content: item.text,
    },
  };
}

function buildItems(thread: Thread) {
  return thread.messages.map(toMsg);
}

function threadCwd(thread: Thread, project: Project | undefined) {
  return thread.worktreePath ?? project?.cwd ?? "";
}

function threadStreaming(thread: Thread) {
  const status = thread.session?.orchestrationStatus;
  return status === "starting" || status === "running";
}

function summaryPreview(thread: Thread) {
  const first = thread.messages.find((item) => item.role === "user")?.text.trim();
  if (first) return first;
  return thread.title;
}

const summarySearch = (thread: Thread) => thread.messages.map((item) => item.text).join("\n\n");

function toSummary(thread: Thread, project: Project | undefined): SessionListSummary {
  return {
    id: thread.id,
    harness: toHarness(thread.session?.provider ?? thread.modelSelection.provider),
    path: thread.worktreePath ?? project?.cwd ?? "",
    cwd: threadCwd(thread, project),
    name: thread.title,
    createdAt: thread.createdAt,
    modifiedAt: thread.updatedAt ?? thread.createdAt,
    messageCount: thread.messages.length,
    firstMessage: summaryPreview(thread),
    allMessagesText: summarySearch(thread),
    isStreaming: threadStreaming(thread),
  };
}

function toSnapshot(
  thread: Thread,
  project: Project | undefined,
  work: UiWorkingState | null | undefined,
): UiSessionSnapshot {
  return {
    id: thread.id,
    harness: toHarness(thread.session?.provider ?? thread.modelSelection.provider),
    file: thread.worktreePath,
    cwd: threadCwd(thread, project),
    name: thread.title,
    model: toModel(thread.modelSelection),
    thinkingLevel: toThinking(thread.modelSelection),
    messages: buildItems(thread),
    live: null,
    working: work ?? null,
    isStreaming: threadStreaming(thread),
    pending: { steering: [], followUp: [] },
  };
}

function rank(sums: Record<string, SessionListSummary>) {
  return Object.values(sums)
    .toSorted((left, right) =>
      left.modifiedAt < right.modifiedAt ? 1 : left.modifiedAt > right.modifiedAt ? -1 : 0,
    )
    .map((item) => item.id);
}

function domainState(work: Record<string, UiWorkingState>) {
  const state = useStore.getState();
  const projects = selectProjectsAcrossEnvironments(state);
  const projectById = new Map(projects.map((item) => [item.id, item]));
  const threads = selectThreadsAcrossEnvironments(state).filter((item) => item.archivedAt === null);
  const sums = Object.fromEntries(
    threads.map((item) => [item.id, toSummary(item, projectById.get(item.projectId))]),
  ) as Record<string, SessionListSummary>;
  const snaps = Object.fromEntries(
    threads.map((item) => [
      item.id,
      toSnapshot(item, projectById.get(item.projectId), work[item.id]),
    ]),
  ) as Record<string, UiSessionSnapshot>;
  return { sums, snaps, ids: rank(sums) };
}

async function loadCfg() {
  const cached = getServerConfig();
  if (cached) return cached;
  const api = readNativeApi();
  if (!api) return null;
  return api.server.getConfig();
}

export const useThreadSessionStore = create<State>()((set) => ({
  cfg: null,
  cfgStatus: "loading",
  cfgError: null,
  ids: [],
  sums: {},
  sumsStatus: "loading",
  sumsError: null,
  snaps: {},
  work: {},
  ready: false,
  boot: async () => {
    await Promise.all([
      useThreadSessionStore.getState().refreshCfg(),
      useThreadSessionStore.getState().refreshSums(),
    ]);
  },
  refreshCfg: async () => {
    try {
      const cfg = await loadCfg();
      set((state) => ({
        ...state,
        cfg,
        cfgStatus: "ready",
        cfgError: null,
        ready: nowStatus("ready", state.sumsStatus),
      }));
    } catch (err) {
      set((state) => ({
        ...state,
        cfg: null,
        cfgStatus: "error",
        cfgError: err instanceof Error ? err.message : String(err),
        ready: false,
      }));
    }
  },
  refreshSums: async () => {
    try {
      const next = domainState(useThreadSessionStore.getState().work);
      set((state) => ({
        ...state,
        ...next,
        sumsStatus: "ready",
        sumsError: null,
        ready: nowStatus(state.cfgStatus, "ready"),
      }));
    } catch (err) {
      set((state) => ({
        ...state,
        sumsStatus: "error",
        sumsError: err instanceof Error ? err.message : String(err),
        ready: false,
      }));
    }
  },
  putSnap: (snap) => {
    set((state) => ({
      ...state,
      snaps: {
        ...state.snaps,
        [snap.id]: {
          ...snap,
          working: state.work[snap.id] ?? snap.working ?? null,
        },
      },
    }));
  },
  syncWork: (items) => {
    set((state) => {
      const work = Object.fromEntries(items.map((item) => [item.threadId, item])) as Record<
        string,
        UiWorkingState
      >;
      const snaps = Object.fromEntries(
        Object.entries(state.snaps).map(([id, snap]) => [
          id,
          {
            ...snap,
            working: work[id] ?? null,
          },
        ]),
      ) as Record<string, UiSessionSnapshot>;
      return { ...state, work, snaps };
    });
  },
  putWork: (item) => {
    set((state) => {
      const work = { ...state.work };
      if (item.working) {
        work[item.threadId] = item.working;
      } else {
        delete work[item.threadId];
      }

      const snap = state.snaps[item.threadId];
      if (!snap) {
        return { ...state, work };
      }

      return {
        ...state,
        work,
        snaps: {
          ...state.snaps,
          [item.threadId]: {
            ...snap,
            working: item.working,
          },
        },
      };
    });
  },
  applyActs: () => {
    useThreadSessionStore.getState().syncDomain();
  },
  syncDomain: () => {
    const next = domainState(useThreadSessionStore.getState().work);
    set((state) => ({
      ...state,
      ...next,
      sumsStatus: "ready",
      sumsError: null,
      ready: nowStatus(state.cfgStatus, "ready"),
    }));
  },
}));

export const useThreadBootReady = () => useThreadSessionStore((state) => state.ready);
export const usePiCfg = () => useThreadSessionStore((state) => state.cfg);
export const usePiCfgStatus = () => useThreadSessionStore((state) => state.cfgStatus);
export const useThreadIds = () => useThreadSessionStore((state) => state.ids);
export const useThreadSummaries = () => useThreadSessionStore((state) => state.sums);
export const useThreadSummariesStatus = () => useThreadSessionStore((state) => state.sumsStatus);

export function useThreadSummary(sessionId: string | null | undefined) {
  const pick = (state: State) => (sessionId ? (state.sums[sessionId] ?? null) : null);
  return useThreadSessionStore(pick);
}

const pending = new Set<string>();

export function markThreadPending(id: string) {
  pending.add(id);
}

export function clearThreadPending(id: string) {
  pending.delete(id);
}

export function isThreadPending(id: string) {
  return pending.has(id);
}
