import type { ThreadSummary } from "@honk/opencode";

export interface MobileProject {
  readonly key: string;
  readonly path: string | null;
  readonly title: string;
  readonly threads: readonly ThreadSummary[];
  readonly updatedAt: string;
}

const projectTitle = (path: string | null): string => {
  const normalized = path?.replace(/\/+$/, "") ?? "";
  return normalized.split("/").filter(Boolean).at(-1) ?? "Other tasks";
};

export const groupThreadsByProject = (
  threads: readonly ThreadSummary[],
): readonly MobileProject[] => {
  const groups = new Map<string, { path: string | null; threads: ThreadSummary[] }>();
  for (const thread of threads) {
    const path = thread.worktree?.path ?? null;
    const key = path ?? thread.projectId ?? "other";
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { path, threads: [thread] });
    else group.threads.push(thread);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      path: group.path,
      title: projectTitle(group.path),
      threads: group.threads,
      updatedAt: group.threads[0]?.updatedAt ?? "",
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};
