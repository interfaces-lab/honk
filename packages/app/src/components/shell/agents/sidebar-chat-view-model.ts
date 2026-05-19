import { scopedProjectKey, scopeProjectRef, scopeThreadRef } from "@multi/client-runtime";
import type {
  EnvironmentId,
  OrchestrationSessionStatus,
  ProjectId,
  ScopedThreadRef,
  ThreadId,
} from "@multi/contracts";

import { formatCompactRelativeTimeLabel } from "~/lib/timestamp-format";
import type { HarnessKind } from "~/lib/ui-session-types";

export interface SidebarDraftSummary {
  id: string;
  text: string;
  attachmentCount: number;
  firstAttachmentName: string | null;
  cwd: string;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  projectCwd: string;
  updatedAt: string;
}

export interface SidebarThreadSummary {
  id: ThreadId;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  projectCwd: string;
  harness?: HarnessKind;
  path: string;
  cwd: string;
  name: string | null;
  createdAt: string;
  modifiedAt: string;
  latestReadableAt?: string | null;
  messageCount: number;
  firstMessage: string;
  isStreaming: boolean;
  orchestrationStatus?: OrchestrationSessionStatus | null;
  needsAttention?: boolean;
}

type SidebarThreadState = "idle" | "running" | "needs_attention" | "error";

interface SidebarChatItemBase {
  title: string;
  updatedAt: string;
  ago: string;
  cwd: string;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  projectCwd: string;
}

export type SidebarChatItem =
  | (SidebarChatItemBase & {
      id: ThreadId;
    kind: "thread";
    state: SidebarThreadState;
    unread: boolean;
    latestReadableAt: string | null;
    threadRef: ScopedThreadRef;
  })
  | (SidebarChatItemBase & {
      id: string;
      kind: "draft";
      state: "draft";
      unread: false;
    });

export interface SidebarSectionModel {
  id: string;
  label: string;
  cwd: string;
  active: boolean;
  environmentId?: EnvironmentId;
  projectId?: ProjectId;
  projectCwd?: string;
  projectStateKey?: string;
  sectionThreadRefs: readonly ScopedThreadRef[];
  threadRefs: readonly ScopedThreadRef[];
  items: readonly SidebarChatItem[];
}

function shortProjectPathLabel(path: string, home: string | null): string {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedPath) return "Project";

  const gitSsh = normalizedPath.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (gitSsh) return `${gitSsh[1]}/${gitSsh[2]}`;

  const gitHttps = normalizedPath.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (gitHttps) return `${gitHttps[1]}/${gitHttps[2]}`;

  if (home) {
    const normalizedHome = home.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalizedPath === normalizedHome) return "~";
    const homePrefix = `${normalizedHome}/`;
    if (normalizedPath.startsWith(homePrefix)) {
      const relativeSegments = normalizedPath.slice(homePrefix.length).split("/").filter(Boolean);
      if (relativeSegments.length >= 2) {
        return `${relativeSegments[relativeSegments.length - 2]}/${relativeSegments[relativeSegments.length - 1]}`;
      }
      if (relativeSegments.length === 1) return `~/${relativeSegments[0]}`;
      return "~";
    }
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
  }
  return segments[0] ?? "Project";
}

function draftTitle(draft: SidebarDraftSummary) {
  const text = draft.text.trim();
  if (text) {
    const line = text.split("\n")[0]?.trim();
    if (line) return line;
  }
  const head = draft.firstAttachmentName;
  if (!head) return "New chat";
  if (draft.attachmentCount === 1) return head;
  return `${head} +${draft.attachmentCount - 1}`;
}

function buildThreadChat(sum: SidebarThreadSummary, unreadIds?: ReadonlySet<string>) {
  return {
    id: sum.id,
    kind: "thread",
    title: sum.name?.trim() || sum.firstMessage.trim() || "Untitled",
    state: threadState(sum),
    unread: unreadIds?.has(sum.id) ?? false,
    updatedAt: sum.modifiedAt,
    latestReadableAt: sum.latestReadableAt ?? sum.modifiedAt,
    ago: formatCompactRelativeTimeLabel(sum.modifiedAt),
    cwd: sum.cwd || "/",
    environmentId: sum.environmentId,
    projectId: sum.projectId,
    projectCwd: sum.projectCwd,
    threadRef: scopeThreadRef(sum.environmentId, sum.id),
  } satisfies SidebarChatItem;
}

function threadState(sum: SidebarThreadSummary): SidebarThreadState {
  if (sum.orchestrationStatus === "error") return "error";
  if (sum.needsAttention === true) return "needs_attention";
  if (
    sum.isStreaming ||
    sum.orchestrationStatus === "starting" ||
    sum.orchestrationStatus === "running"
  ) {
    return "running";
  }
  return "idle";
}

function buildDraftChat(draft: SidebarDraftSummary) {
  return {
    id: draft.id,
    kind: "draft",
    title: draftTitle(draft),
    state: "draft",
    unread: false,
    updatedAt: draft.updatedAt,
    ago: formatCompactRelativeTimeLabel(draft.updatedAt),
    cwd: draft.cwd || "/",
    environmentId: draft.environmentId,
    projectId: draft.projectId,
    projectCwd: draft.projectCwd,
  } satisfies SidebarChatItem;
}

export function buildProjectChatSections(
  threadSummaries: readonly SidebarThreadSummary[],
  drafts: readonly SidebarDraftSummary[],
  cwd: string | null,
  home: string | null,
  unreadIds?: ReadonlySet<string>,
  projectCwds: readonly string[] = [],
): SidebarSectionModel[] {
  const list = [
    ...threadSummaries.map((sum) => buildThreadChat(sum, unreadIds)),
    ...drafts.map(buildDraftChat),
  ];
  if (list.length === 0) return [];

  const by = new Map<string, SidebarChatItem[]>();
  for (const item of list) {
    const key = item.cwd || "/";
    const cur = by.get(key);
    if (cur) cur.push(item);
    else by.set(key, [item]);
  }

  const projectCwdRank = new Map<string, number>();
  for (const projectCwd of projectCwds) {
    if (!projectCwd || projectCwdRank.has(projectCwd)) {
      continue;
    }
    projectCwdRank.set(projectCwd, projectCwdRank.size);
  }

  const groups = [...by.entries()].map(([dir, items], index) => {
    const sorted = items.toSorted((left, right) =>
      left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0,
    );
    return { dir, label: shortProjectPathLabel(dir, home), sorted, index };
  });

  groups.sort((left, right) => {
    const leftRank = projectCwdRank.get(left.dir);
    const rightRank = projectCwdRank.get(right.dir);
    if (leftRank !== undefined || rightRank !== undefined) {
      return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
    }
    if (left.index !== right.index) return left.index - right.index;
    return left.dir.localeCompare(right.dir);
  });

  const threadRefsByProjectKey = new Map<string, ScopedThreadRef[]>();
  for (const sum of threadSummaries) {
    if (sum.projectId === null) {
      continue;
    }
    const key = scopedProjectKey(scopeProjectRef(sum.environmentId, sum.projectId));
    const refs = threadRefsByProjectKey.get(key) ?? [];
    refs.push(scopeThreadRef(sum.environmentId, sum.id));
    threadRefsByProjectKey.set(key, refs);
  }

  return groups.map((group) => {
    const sectionThreadRefs = group.sorted.flatMap((item) =>
      item.kind === "thread" ? [item.threadRef] : [],
    );
    const rootProjectsByKey = new Map(
      group.sorted.flatMap((item) => {
        if (item.projectCwd !== group.dir) {
          return [];
        }
        if (item.projectId === null) {
          return [];
        }
        return [
          [
            scopedProjectKey(scopeProjectRef(item.environmentId, item.projectId)),
            {
              environmentId: item.environmentId,
              projectId: item.projectId,
              projectCwd: group.dir,
            },
          ] as const,
        ];
      }),
    );
    const rootProject =
      rootProjectsByKey.size === 1 ? ([...rootProjectsByKey.values()][0] ?? null) : null;
    const rootProjectKey = rootProject
      ? scopedProjectKey(scopeProjectRef(rootProject.environmentId, rootProject.projectId))
      : null;
    const threadRefs = rootProjectKey
      ? (threadRefsByProjectKey.get(rootProjectKey) ?? [])
      : sectionThreadRefs;

    const section = {
      id: `ws:${group.dir}`,
      label: group.label,
      cwd: group.dir,
      active: group.dir === cwd,
      sectionThreadRefs,
      threadRefs,
      items: group.sorted,
    } satisfies SidebarSectionModel;
    if (!rootProject) {
      return section;
    }
    return Object.assign(section, {
      environmentId: rootProject.environmentId,
      projectId: rootProject.projectId,
      projectCwd: rootProject.projectCwd,
    } satisfies Pick<SidebarSectionModel, "environmentId" | "projectId" | "projectCwd">);
  });
}
