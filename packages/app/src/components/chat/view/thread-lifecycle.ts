import type { EnvironmentId, ScopedThreadRef } from "@honk/shared/environment";
import { ProjectId, type ThreadId } from "@honk/shared/base-schemas";
import type { ModelSelection } from "@honk/shared/model";
import type { TurnId } from "@honk/contracts";
import { Schema } from "effect";
import { type DraftId as DraftIdType, type DraftThreadState } from "../../../stores/chat-drafts";
import { useStore } from "../../../stores/thread-store";
import { selectThreadRouteLifecycleSurfaceByRef } from "../../../stores/thread-selectors";
import {
  DEFAULT_RUNTIME_MODE,
  type SessionPhase,
  type Thread,
  type ThreadSession,
} from "../../../types";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "honk:last-invoked-script-by-project";

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModelSelection: ModelSelection,
  error: string | null,
): Thread {
  return {
    id: threadId,
    environmentId: draftThread.environmentId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New Agent",
    modelSelection: fallbackModelSelection,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    leafId: null,
    entries: [],
    error,
    createdAt: draftThread.createdAt,
    archivedAt: null,
    latestTurn: null,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function shouldWriteThreadErrorToCurrentServerThread(input: {
  serverThread:
    | {
        environmentId: EnvironmentId;
        id: ThreadId;
      }
    | null
    | undefined;
  routeThreadRef: ScopedThreadRef;
  targetThreadId: ThreadId;
}): boolean {
  return Boolean(
    input.serverThread &&
    input.targetThreadId === input.routeThreadRef.threadId &&
    input.serverThread.environmentId === input.routeThreadRef.environmentId &&
    input.serverThread.id === input.targetThreadId,
  );
}

export function threadHasStarted(thread: Thread | null | undefined): boolean {
  return Boolean(
    thread && (thread.latestTurn !== null || thread.messages.length > 0 || thread.session !== null),
  );
}

export function isNewThreadHeroDraft(input: {
  readonly activeThread: Thread | null | undefined;
  readonly isLocalDraftThread: boolean;
  readonly pendingLocalSendCount: number;
  readonly promotedTo: ScopedThreadRef | null | undefined;
}): boolean {
  return Boolean(
    input.activeThread &&
    input.isLocalDraftThread &&
    !threadHasStarted(input.activeThread) &&
    input.pendingLocalSendCount === 0 &&
    !input.promotedTo,
  );
}

export function threadHasRenderableUserStart(thread: Thread | null | undefined): boolean {
  if (!thread) {
    return false;
  }
  return thread.messages.some(
    (message) => message.role === "user" && userMessageHasRenderableContent(message),
  );
}

function userMessageHasRenderableContent(message: Thread["messages"][number]): boolean {
  return (
    message.text.trim().length > 0 ||
    message.richText !== undefined ||
    (message.attachments?.length ?? 0) > 0
  );
}

export function resolveRenderableDraftCanonicalThreadRef(input: {
  readonly promotedTo: ScopedThreadRef | null | undefined;
  readonly serverThread: Thread | null | undefined;
}): ScopedThreadRef | null {
  if (!input.promotedTo || !threadHasRenderableUserStart(input.serverThread)) {
    return null;
  }
  return input.promotedTo;
}

export function resolveDraftPromotionRouteTarget(input: {
  readonly draftRouteId: DraftIdType | null;
  readonly serverThread: Thread | null | undefined;
  readonly serverThreadRef: ScopedThreadRef | null | undefined;
}):
  | { readonly kind: "draft"; readonly draftId: DraftIdType }
  | { readonly kind: "server"; readonly threadRef: ScopedThreadRef }
  | null {
  if (!input.serverThreadRef) {
    return null;
  }
  if (input.draftRouteId !== null && !threadHasRenderableUserStart(input.serverThread)) {
    return { kind: "draft", draftId: input.draftRouteId };
  }
  return { kind: "server", threadRef: input.serverThreadRef };
}

export function threadExistsBeforeSend(input: {
  readonly serverThreadExists: boolean;
  readonly draftPromotedTo: ScopedThreadRef | null | undefined;
  readonly targetThreadRef: ScopedThreadRef;
}): boolean {
  return (
    input.serverThreadExists ||
    (input.draftPromotedTo?.environmentId === input.targetThreadRef.environmentId &&
      input.draftPromotedTo.threadId === input.targetThreadRef.threadId)
  );
}

export async function waitForStartedServerThread(
  threadRef: ScopedThreadRef,
  timeoutMs = 1_000,
): Promise<boolean> {
  const getThreadHasStarted = () =>
    selectThreadRouteLifecycleSurfaceByRef(useStore.getState(), threadRef)?.hasStarted ?? false;

  if (getThreadHasStarted()) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = useStore.subscribe((state) => {
      if (!(selectThreadRouteLifecycleSurfaceByRef(state, threadRef)?.hasStarted ?? false)) {
        return;
      }
      finish(true);
    });

    if (getThreadHasStarted()) {
      finish(true);
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export interface LocalDispatchSnapshot {
  startedAt: string;
  preparingWorktree: boolean;
  latestTurnTurnId: TurnId | null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionOrchestrationStatus: ThreadSession["orchestrationStatus"] | null;
  sessionUpdatedAt: string | null;
}

export function createLocalDispatchSnapshot(
  activeThread: Thread | undefined,
  options?: { preparingWorktree?: boolean },
): LocalDispatchSnapshot {
  const latestTurn = activeThread?.latestTurn ?? null;
  const session = activeThread?.session ?? null;
  return {
    startedAt: new Date().toISOString(),
    preparingWorktree: Boolean(options?.preparingWorktree),
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionOrchestrationStatus: session?.orchestrationStatus ?? null,
    sessionUpdatedAt: session?.updatedAt ?? null,
  };
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }
  if (input.hasPendingApproval || input.hasPendingUserInput) {
    return true;
  }
  if (
    input.threadError &&
    input.latestTurn?.state === "error" &&
    input.latestTurn.completedAt !== null
  ) {
    return true;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);

  if (input.phase === "running") {
    if (!latestTurnChanged) {
      return false;
    }
    if (latestTurn === null || latestTurn.startedAt === null) {
      return false;
    }
    if (
      session?.activeTurnId !== undefined &&
      session.activeTurnId !== null &&
      latestTurn.turnId !== session.activeTurnId
    ) {
      return false;
    }
    return true;
  }

  if (latestTurnChanged) {
    return latestTurn === null || latestTurn.completedAt !== null;
  }

  return session?.orchestrationStatus === "starting" || session?.orchestrationStatus === "running";
}
