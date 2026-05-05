import type { EnvironmentId, ProjectId, ThreadId } from "@multi/contracts";

export type InitialChatProject = {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
};

export type InitialChatServerThread = {
  readonly id: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly worktreePath: string | null;
  readonly updatedAt: string | undefined;
  readonly createdAt: string;
  readonly archivedAt: string | null;
};

export type InitialChatDraftThread = {
  readonly draftId: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly worktreePath: string | null;
  readonly createdAt: string;
  readonly promotedTo?: { environmentId: EnvironmentId; threadId: ThreadId } | null;
};

export type InitialChatTarget =
  | {
      readonly kind: "server";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | {
      readonly kind: "draft";
      readonly draftId: string;
    };

type Candidate =
  | {
      readonly kind: "server";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly cwd: string | null;
      readonly updatedAt: string;
    }
  | {
      readonly kind: "draft";
      readonly draftId: string;
      readonly cwd: string | null;
      readonly updatedAt: string;
    };

function toSortableTimestamp(iso: string): number {
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function resolveInitialChatTarget(input: {
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly bootstrapComplete: boolean;
  readonly storedProjectCwd: string | null;
  readonly projects: readonly InitialChatProject[];
  readonly threads: readonly InitialChatServerThread[];
  readonly drafts: readonly InitialChatDraftThread[];
}): InitialChatTarget | null {
  if (!input.bootstrapComplete || !input.activeEnvironmentId) {
    return null;
  }

  const activeEnvironmentId = input.activeEnvironmentId;
  const projectCwdByProjectId = new Map(
    input.projects
      .filter((project) => project.environmentId === activeEnvironmentId)
      .map((project) => [project.id, project.cwd] as const),
  );

  const serverCandidates: Candidate[] = input.threads.flatMap((thread) => {
    if (thread.environmentId !== activeEnvironmentId || thread.archivedAt !== null) {
      return [];
    }
    const projectCwd =
      thread.projectId === null ? null : projectCwdByProjectId.get(thread.projectId);
    if (projectCwd === undefined) {
      return [];
    }
    return [
      {
        kind: "server",
        environmentId: thread.environmentId,
        threadId: thread.id,
        cwd: thread.worktreePath ?? projectCwd,
        updatedAt: thread.updatedAt || thread.createdAt,
      } satisfies Candidate,
    ];
  });

  const draftCandidates: Candidate[] = input.drafts.flatMap((draft) => {
    if (draft.environmentId !== activeEnvironmentId || draft.promotedTo != null) {
      return [];
    }
    const projectCwd = draft.projectId === null ? null : projectCwdByProjectId.get(draft.projectId);
    if (projectCwd === undefined) {
      return [];
    }
    return [
      {
        kind: "draft",
        draftId: draft.draftId,
        cwd: draft.worktreePath ?? projectCwd,
        updatedAt: draft.createdAt,
      } satisfies Candidate,
    ];
  });

  const allCandidates = [...serverCandidates, ...draftCandidates];
  if (allCandidates.length === 0) {
    return null;
  }

  const sameProjectCandidates =
    input.storedProjectCwd === null
      ? []
      : allCandidates.filter((candidate) => candidate.cwd === input.storedProjectCwd);
  const candidates = sameProjectCandidates.length > 0 ? sameProjectCandidates : allCandidates;

  const [selected] = candidates.toSorted((left, right) => {
    const rightTimestamp = toSortableTimestamp(right.updatedAt);
    const leftTimestamp = toSortableTimestamp(left.updatedAt);
    if (rightTimestamp !== leftTimestamp) {
      return rightTimestamp - leftTimestamp;
    }
    if (left.kind !== right.kind) {
      return left.kind === "server" ? -1 : 1;
    }
    return 0;
  });

  if (!selected) {
    return null;
  }

  return selected.kind === "server"
    ? {
        kind: "server",
        environmentId: selected.environmentId,
        threadId: selected.threadId,
      }
    : {
        kind: "draft",
        draftId: selected.draftId,
      };
}
