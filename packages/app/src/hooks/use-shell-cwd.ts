import { useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";

import { SHELL_LAYOUT_CHANGED_EVENT } from "../lib/shell-runtime-constants";
import { readStoredProjectCwd } from "../lib/project-state";
import { useServerAvailableEditors } from "../rpc/server-state";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { useRouteThreadId } from "./use-route-thread-id";

function basename(cwd: string | null) {
  if (!cwd) return null;
  const clean = cwd.replace(/[\\/]+$/, "");
  const cut = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return cut >= 0 ? clean.slice(cut + 1) : clean;
}

function subscribe(listener: () => void) {
  window.addEventListener(SHELL_LAYOUT_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener(SHELL_LAYOUT_CHANGED_EVENT, listener);
  };
}

export function resolveShellCwd(input: {
  projects: ReadonlyArray<{ id: string; cwd: string }>;
  threads: ReadonlyArray<{ id: string; projectId: string | null; worktreePath: string | null }>;
  routeThreadId: string | null;
  stored: string | null;
}) {
  const byId = new Map(input.projects.map((item) => [item.id, item]));
  const thread = input.routeThreadId
    ? (input.threads.find((item) => item.id === input.routeThreadId) ?? null)
    : null;
  if (thread?.projectId === null) {
    return "~";
  }
  const storedProject = input.projects.find((item) => item.cwd === input.stored) ?? null;
  const threadProject = thread ? (byId.get(thread.projectId) ?? null) : null;
  const project = threadProject ?? storedProject ?? input.projects[0] ?? null;
  return thread?.worktreePath ?? project?.cwd ?? null;
}

export function useShellState() {
  const editors = useServerAvailableEditors();
  const routeThreadId = useRouteThreadId();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectThreadsAcrossEnvironments));
  const stored = useSyncExternalStore(subscribe, readStoredProjectCwd, () => null);

  return useMemo(() => {
    const cwd = resolveShellCwd({ projects, threads, routeThreadId, stored });

    return {
      cwd,
      name: basename(cwd),
      home: null,
      availableEditors: [...editors],
    };
  }, [editors, projects, routeThreadId, stored, threads]);
}
