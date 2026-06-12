import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "~/lib/environment-scope";
import type { ScopedThreadRef } from "@honk/contracts";
import { contractHomeDir } from "@honk/shared/paths";

import { formatCompactRelativeTimeLabel } from "~/lib/timestamp-format";
import type {
  SidebarChatItem,
  SidebarDraftSummary,
  SidebarProjectSummary,
  SidebarSectionModel,
  SidebarThreadState,
  SidebarThreadSummary,
} from "./types";

type SidebarThreadChatItem = Extract<SidebarChatItem, { kind: "thread" }>;

const MARKDOWN_SKILL_PREVIEW_TOKEN_REGEX =
  /(^|\s)\[\$([a-zA-Z][a-zA-Z0-9:_-]*)\]\([^)]*\)(?=\s|$)/g;

function compactSerializedSkillPreviewTokens(text: string): string {
  return text.replace(
    MARKDOWN_SKILL_PREVIEW_TOKEN_REGEX,
    (_match, prefix: string, skillName: string) => `${prefix}$${skillName}`,
  );
}

function shortProjectPathLabel(path: string, home: string | null): string {
  const normalizedPath = contractHomeDir(path, home);
  if (!normalizedPath) return "Project";

  const gitSsh = normalizedPath.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (gitSsh) return `${gitSsh[1]}/${gitSsh[2]}`;

  const gitHttps = normalizedPath.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (gitHttps) return `${gitHttps[1]}/${gitHttps[2]}`;

  if (normalizedPath === "~") return "~";
  if (normalizedPath.startsWith("~/")) {
    const relativeSegments = normalizedPath.slice(2).split("/").filter(Boolean);
    if (relativeSegments.length >= 2) {
      return `${relativeSegments[relativeSegments.length - 2]}/${relativeSegments[relativeSegments.length - 1]}`;
    }
    if (relativeSegments.length === 1) return `~/${relativeSegments[0]}`;
    return "~";
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
  }
  return segments[0] ?? "Project";
}

export function deriveSidebarDraftTitle(draft: {
  readonly attachmentCount: number;
  readonly firstAttachmentName: string | null;
  readonly text: string;
}) {
  const text = compactSerializedSkillPreviewTokens(draft.text).trim();
  if (text) {
    const line = text.split("\n")[0]?.trim();
    if (line) return line;
  }
  const head = draft.firstAttachmentName;
  if (!head) return "New chat";
  if (draft.attachmentCount === 1) return head;
  return `${head} +${draft.attachmentCount - 1}`;
}

function buildThreadChat(
  sum: SidebarThreadSummary,
  unreadIds?: ReadonlySet<string>,
  pinnedThreadKeys?: ReadonlySet<string>,
) {
  const threadRef = scopeThreadRef(sum.environmentId, sum.id);
  return {
    id: sum.id,
    kind: "thread",
    title: sum.name?.trim() || sum.firstMessage.trim() || "Untitled",
    state: threadState(sum),
    unread: unreadIds?.has(sum.id) ?? false,
    pinned: pinnedThreadKeys?.has(scopedThreadKey(threadRef)) ?? false,
    archived: sum.archived,
    updatedAt: sum.modifiedAt,
    latestReadableAt: sum.latestReadableAt ?? sum.modifiedAt,
    ago: formatCompactRelativeTimeLabel(sum.modifiedAt),
    cwd: sum.cwd || "/",
    environmentId: sum.environmentId,
    projectId: sum.projectId,
    workspaceProjectRef: sum.workspaceProjectRef,
    projectCwd: sum.projectCwd,
    threadRef,
  } satisfies SidebarChatItem;
}

export function threadState(sum: SidebarThreadSummary): SidebarThreadState {
  if (sum.orchestrationStatus === "error") return "error";
  if (sum.orchestrationStatus === "stopped" || sum.latestTurnState === "interrupted") {
    return "stopped";
  }
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
    title: "New chat",
    state: "draft",
    unread: false,
    updatedAt: draft.updatedAt,
    ago: formatCompactRelativeTimeLabel(draft.updatedAt),
    cwd: draft.cwd || "/",
    environmentId: draft.environmentId,
    projectId: draft.projectId,
    workspaceProjectRef: draft.workspaceProjectRef,
    projectCwd: draft.projectCwd,
  } satisfies SidebarChatItem;
}

function compareUpdatedAtDesc(
  left: Pick<SidebarChatItem, "id" | "updatedAt">,
  right: Pick<SidebarChatItem, "id" | "updatedAt">,
) {
  if (left.updatedAt < right.updatedAt) return 1;
  if (left.updatedAt > right.updatedAt) return -1;
  return left.id.localeCompare(right.id);
}

function sortSidebarChatItems<T extends SidebarChatItem>(items: readonly T[]): T[] {
  return items.toSorted(compareUpdatedAtDesc);
}

function isPinnedThreadItem(item: SidebarChatItem): item is SidebarThreadChatItem {
  return item.kind === "thread" && item.pinned;
}

export function buildProjectChatSections(
  threadSummaries: readonly SidebarThreadSummary[],
  drafts: readonly SidebarDraftSummary[],
  cwd: string | null,
  home: string | null,
  unreadIds?: ReadonlySet<string>,
  projectCwds: readonly string[] = [],
  pinnedThreadKeys?: ReadonlySet<string>,
  retainedProjects: readonly SidebarProjectSummary[] = [],
): SidebarSectionModel[] {
  const list: SidebarChatItem[] = [
    ...threadSummaries.map((sum) => buildThreadChat(sum, unreadIds, pinnedThreadKeys)),
    ...drafts.map(buildDraftChat),
  ];
  if (list.length === 0 && retainedProjects.length === 0) return [];

  const pinnedItems = sortSidebarChatItems(list.filter(isPinnedThreadItem));
  const projectItems = list.filter((item) => !isPinnedThreadItem(item));

  const by = new Map<string, SidebarChatItem[]>();
  for (const item of projectItems) {
    const key = item.cwd || "/";
    const cur = by.get(key);
    if (cur) cur.push(item);
    else by.set(key, [item]);
  }

  const projectCwdRank = new Map<string, number>();
  const projectsByCwd = new Map<string, SidebarProjectSummary[]>();
  const projectKeysWithItems = new Set<string>();
  for (const item of list) {
    if (item.workspaceProjectRef === null) {
      continue;
    }
    projectKeysWithItems.add(scopedProjectKey(item.workspaceProjectRef));
  }

  for (const projectCwd of projectCwds) {
    if (!projectCwd) {
      continue;
    }
    if (projectCwdRank.has(projectCwd)) {
      continue;
    }
    projectCwdRank.set(projectCwd, projectCwdRank.size);
  }

  for (const project of retainedProjects) {
    const projectsAtCwd = projectsByCwd.get(project.cwd) ?? [];
    projectsAtCwd.push(project);
    projectsByCwd.set(project.cwd, projectsAtCwd);

    const projectKey = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
    if (!projectKeysWithItems.has(projectKey) && !by.has(project.cwd)) {
      by.set(project.cwd, []);
    }
  }

  const groups = [...by.entries()].map(([dir, items], index) => {
    const sorted = sortSidebarChatItems(items);
    const retainedProjectCandidates = projectsByCwd.get(dir) ?? [];
    const retainedProjectCandidate =
      retainedProjectCandidates.length === 1 ? (retainedProjectCandidates[0] ?? null) : null;
    const retainedProject =
      sorted.length === 0 && retainedProjectCandidate
        ? {
            projectRef: scopeProjectRef(
              retainedProjectCandidate.environmentId,
              retainedProjectCandidate.id,
            ),
            projectCwd: dir,
          }
        : null;
    const retainedProjectTitle = sorted.length === 0 ? retainedProjectCandidate?.title : undefined;
    const label = retainedProjectTitle ?? shortProjectPathLabel(dir, home);
    return { dir, label, retainedProject, sorted, index };
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
    if (sum.workspaceProjectRef === null) {
      continue;
    }
    const threadRef = scopeThreadRef(sum.environmentId, sum.id);
    if (pinnedThreadKeys?.has(scopedThreadKey(threadRef))) {
      continue;
    }
    const key = scopedProjectKey(sum.workspaceProjectRef);
    const refs = threadRefsByProjectKey.get(key) ?? [];
    refs.push(threadRef);
    threadRefsByProjectKey.set(key, refs);
  }

  const sections = groups.map((group) => {
    const sectionThreadRefs = group.sorted.flatMap((item) =>
      item.kind === "thread" ? [item.threadRef] : [],
    );
    const rootProjectsByKey = new Map(
      group.sorted.flatMap((item) => {
        if (item.projectCwd !== group.dir) {
          return [];
        }
        if (item.workspaceProjectRef === null) {
          return [];
        }
        return [
          [
            scopedProjectKey(item.workspaceProjectRef),
            {
              projectRef: item.workspaceProjectRef,
              projectCwd: group.dir,
            },
          ] as const,
        ];
      }),
    );
    const rootProject =
      rootProjectsByKey.size === 1
        ? ([...rootProjectsByKey.values()][0] ?? null)
        : (group.retainedProject ?? null);
    const rootProjectKey = rootProject ? scopedProjectKey(rootProject.projectRef) : null;
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
      environmentId: rootProject.projectRef.environmentId,
      projectId: rootProject.projectRef.projectId,
      projectRef: rootProject.projectRef,
      projectCwd: rootProject.projectCwd,
    } satisfies Pick<
      SidebarSectionModel,
      "environmentId" | "projectId" | "projectRef" | "projectCwd"
    >);
  });

  if (pinnedItems.length === 0) {
    return sections;
  }

  const pinnedThreadRefs = pinnedItems.map((item) => item.threadRef);
  return [
    {
      id: "pinned",
      label: "Pinned",
      cwd: pinnedItems[0]?.cwd ?? cwd ?? "/",
      active: false,
      canCreateAgent: false,
      canOpenInEditor: false,
      sectionThreadRefs: pinnedThreadRefs,
      threadRefs: pinnedThreadRefs,
      items: pinnedItems,
    } satisfies SidebarSectionModel,
    ...sections,
  ];
}
