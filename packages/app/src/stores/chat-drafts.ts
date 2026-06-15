import {
  type EnvironmentId,
  EnvironmentId as EnvironmentIdSchema,
  ProjectId,
  AgentInteractionMode,
  type ScopedProjectRef,
  type ScopedThreadRef,
  ThreadId,
} from "@honk/contracts";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "~/lib/environment-scope";
import * as Schema from "effect/Schema";
import { DeepMutable } from "effect/Types";
import { DEFAULT_INTERACTION_MODE, type ChatImageAttachment } from "../types";
import {
  type TerminalContextDraft,
  ensureInlineTerminalContextPlaceholders,
  normalizeTerminalContextText,
} from "../lib/terminal-context";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createDebouncedJSONStorage, createMemoryStorage } from "../lib/storage";

export const COMPOSER_DRAFT_STORAGE_KEY = "honk:composer-drafts:v1";
const COMPOSER_DRAFT_STORAGE_VERSION = 7;
const DraftThreadEnvModeSchema = Schema.Literals(["local", "worktree"]);
const isAgentInteractionMode = Schema.is(AgentInteractionMode);
export type DraftThreadEnvMode = typeof DraftThreadEnvModeSchema.Type;

export const DraftId = Schema.String.pipe(Schema.brand("DraftId"));
export type DraftId = typeof DraftId.Type;

const COMPOSER_PERSIST_DEBOUNCE_MS = 300;

const composerDebouncedStorage = createDebouncedJSONStorage<PersistedComposerDraftStoreState>(
  typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
  COMPOSER_PERSIST_DEBOUNCE_MS,
);

// Flush pending composer draft writes before page unload to prevent data loss.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    composerDebouncedStorage.flush();
  });
}

export const PersistedComposerImageAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
});
export type PersistedComposerImageAttachment = typeof PersistedComposerImageAttachment.Type;

export interface ComposerImageAttachment extends Omit<ChatImageAttachment, "previewUrl"> {
  previewUrl: string;
  file: File;
}

const PersistedTerminalContextDraft = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  createdAt: Schema.String,
  terminalId: Schema.String,
  terminalLabel: Schema.String,
  lineStart: Schema.Number,
  lineEnd: Schema.Number,
});
type PersistedTerminalContextDraft = typeof PersistedTerminalContextDraft.Type;

const PersistedComposerThreadDraftState = Schema.Struct({
  prompt: Schema.String,
  richText: Schema.optionalKey(Schema.String),
  attachments: Schema.Array(PersistedComposerImageAttachment),
  terminalContexts: Schema.optionalKey(Schema.Array(PersistedTerminalContextDraft)),
  interactionMode: Schema.optionalKey(AgentInteractionMode),
});
type PersistedComposerThreadDraftState = typeof PersistedComposerThreadDraftState.Type;

const PersistedDraftThreadState = Schema.Struct({
  threadId: ThreadId,
  environmentId: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  logicalProjectKey: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.optionalKey(Schema.String),
  interactionMode: AgentInteractionMode,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  envMode: DraftThreadEnvModeSchema,
  promotedTo: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        environmentId: Schema.String,
        threadId: Schema.String,
      }),
    ),
  ),
  promotedTitle: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
type PersistedDraftThreadState = typeof PersistedDraftThreadState.Type;

const PersistedComposerDraftStoreState = Schema.Struct({
  draftsByThreadKey: Schema.Record(Schema.String, PersistedComposerThreadDraftState),
  draftThreadsByThreadKey: Schema.Record(Schema.String, PersistedDraftThreadState),
  logicalProjectDraftThreadKeyByLogicalProjectKey: Schema.Record(Schema.String, Schema.String),
});
type PersistedComposerDraftStoreState = typeof PersistedComposerDraftStoreState.Type;

const PersistedComposerDraftStoreStorage = Schema.Struct({
  version: Schema.Number,
  state: PersistedComposerDraftStoreState,
});

/**
 * Composer content keyed by either a draft session (`DraftId`) or a real server
 * thread (`ScopedThreadRef`). This is the editable payload shown in the composer.
 */
export interface ComposerThreadDraftState {
  prompt: string;
  richTextJson: string | null;
  images: ComposerImageAttachment[];
  terminalContexts: TerminalContextDraft[];
  interactionMode: AgentInteractionMode | null;
}

/**
 * App-facing composer identity:
 * - `DraftId` for pre-thread draft sessions
 * - `ScopedThreadRef` for server-backed threads
 *
 * Raw `ThreadId` is intentionally excluded so callers cannot drop environment
 * identity for real threads.
 */
export type ComposerThreadTarget = ScopedThreadRef | DraftId;

export type ComposerDraftContentPatch = {
  prompt?: string;
  richTextJson?: string | null;
};

/**
 * Mutable routing and execution context for a pre-thread draft session.
 *
 * Unlike a real server thread, a draft session can still change target
 * environment/worktree configuration before the first send.
 */
export interface DraftThreadState {
  threadId: ThreadId;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  logicalProjectKey: string;
  createdAt: string;
  updatedAt: string;
  interactionMode: AgentInteractionMode;
  branch: string | null;
  worktreePath: string | null;
  envMode: DraftThreadEnvMode;
  promotedTo?: ScopedThreadRef | null;
  /** First-message title shown in the sidebar while the promoted thread is still syncing. */
  promotedTitle?: string | null;
}

/**
 * Draft session metadata paired with its stable draft-session identity.
 */
export interface ProjectDraftSession extends DraftThreadState {
  draftId: DraftId;
}

/**
 * Persisted store for composer content plus draft-session metadata.
 *
 * The store intentionally models two domains:
 * - draft sessions keyed by `DraftId`
 * - server thread composer state keyed by `ScopedThreadRef`
 */
interface ComposerDraftStoreState {
  draftsByThreadKey: Record<string, ComposerThreadDraftState>;
  draftThreadsByThreadKey: Record<string, DraftThreadState>;
  logicalProjectDraftThreadKeyByLogicalProjectKey: Record<string, string>;
  /** Returns the editable composer content for a draft session or server thread. */
  getComposerDraft: (target: ComposerThreadTarget) => ComposerThreadDraftState | null;
  /** Looks up the active draft session for a logical project identity. */
  getDraftThreadByLogicalProjectKey: (logicalProjectKey: string) => ProjectDraftSession | null;
  getDraftSessionByLogicalProjectKey: (logicalProjectKey: string) => ProjectDraftSession | null;
  getDraftThreadByProjectRef: (projectRef: ScopedProjectRef) => ProjectDraftSession | null;
  getDraftSessionByProjectRef: (projectRef: ScopedProjectRef) => ProjectDraftSession | null;
  /** Reads mutable draft-session metadata by `DraftId`. */
  getDraftSession: (draftId: DraftId) => DraftThreadState | null;
  /** Resolves a server-thread ref back to a matching draft session when one exists. */
  getDraftSessionByRef: (threadRef: ScopedThreadRef) => DraftThreadState | null;
  getDraftThreadByRef: (threadRef: ScopedThreadRef) => DraftThreadState | null;
  getDraftThread: (threadRef: ComposerThreadTarget) => DraftThreadState | null;
  listDraftThreadKeys: () => string[];
  hasDraftThreadsInEnvironment: (environmentId: EnvironmentId) => boolean;
  getProjectlessDraftSession: (environmentId: EnvironmentId) => ProjectDraftSession | null;
  setProjectlessDraftThreadId: (
    environmentId: EnvironmentId,
    draftId: DraftId,
    options?: {
      threadId?: ThreadId;
      createdAt?: string;
      interactionMode?: AgentInteractionMode;
    },
  ) => void;
  /** Creates or updates the draft session tracked for a logical project. */
  setLogicalProjectDraftThreadId: (
    logicalProjectKey: string,
    projectRef: ScopedProjectRef,
    draftId: DraftId,
    options?: {
      threadId?: ThreadId;
      branch?: string | null;
      worktreePath?: string | null;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      interactionMode?: AgentInteractionMode;
    },
  ) => void;
  /** Creates or updates the draft session tracked for a concrete project ref. */
  setProjectDraftThreadId: (
    projectRef: ScopedProjectRef,
    draftId: DraftId,
    options?: {
      threadId?: ThreadId;
      branch?: string | null;
      worktreePath?: string | null;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      interactionMode?: AgentInteractionMode;
    },
  ) => void;
  /** Updates mutable draft-session metadata without touching composer content. */
  setDraftThreadContext: (
    threadRef: ComposerThreadTarget,
    options: {
      branch?: string | null;
      worktreePath?: string | null;
      projectRef?: ScopedProjectRef;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      interactionMode?: AgentInteractionMode;
    },
  ) => void;
  clearProjectDraftThreadId: (projectRef: ScopedProjectRef) => void;
  clearProjectDraftThreadById: (
    projectRef: ScopedProjectRef,
    threadRef: ComposerThreadTarget,
  ) => void;
  /** Marks a draft session as being promoted to a real server thread. */
  markDraftThreadPromoting: (
    threadRef: ComposerThreadTarget,
    promotedTo?: ScopedThreadRef,
    promotedTitle?: string,
  ) => void;
  /** Clears premature promotion markers when navigating back after a failed first send. */
  cancelDraftThreadPromotion: (threadRef: ComposerThreadTarget) => void;
  /** Removes draft-session metadata after promotion is complete. */
  finalizePromotedDraftThread: (threadRef: ComposerThreadTarget) => void;
  clearDraftThread: (threadRef: ComposerThreadTarget) => void;
  setPrompt: (threadRef: ComposerThreadTarget, prompt: string) => void;
  updateComposerDraft: (threadRef: ComposerThreadTarget, patch: ComposerDraftContentPatch) => void;
  clearComposerText: (threadRef: ComposerThreadTarget) => void;
  setTerminalContexts: (threadRef: ComposerThreadTarget, contexts: TerminalContextDraft[]) => void;
  setInteractionMode: (
    threadRef: ComposerThreadTarget,
    interactionMode: AgentInteractionMode | null | undefined,
  ) => void;
  addImage: (threadRef: ComposerThreadTarget, image: ComposerImageAttachment) => void;
  addImages: (threadRef: ComposerThreadTarget, images: ComposerImageAttachment[]) => void;
  removeImage: (threadRef: ComposerThreadTarget, imageId: string) => void;
  insertTerminalContext: (
    threadRef: ComposerThreadTarget,
    prompt: string,
    context: TerminalContextDraft,
    index: number,
  ) => boolean;
  addTerminalContext: (threadRef: ComposerThreadTarget, context: TerminalContextDraft) => void;
  addTerminalContexts: (threadRef: ComposerThreadTarget, contexts: TerminalContextDraft[]) => void;
  removeTerminalContext: (threadRef: ComposerThreadTarget, contextId: string) => void;
  clearTerminalContexts: (threadRef: ComposerThreadTarget) => void;
  clearComposerContent: (threadRef: ComposerThreadTarget) => void;
}

const EMPTY_PERSISTED_DRAFT_STORE_STATE = Object.freeze<PersistedComposerDraftStoreState>({
  draftsByThreadKey: {},
  draftThreadsByThreadKey: {},
  logicalProjectDraftThreadKeyByLogicalProjectKey: {},
});

const EMPTY_IMAGES: ComposerImageAttachment[] = [];
const EMPTY_TERMINAL_CONTEXTS: TerminalContextDraft[] = [];
Object.freeze(EMPTY_IMAGES);
const EMPTY_THREAD_DRAFT = Object.freeze<ComposerThreadDraftState>({
  prompt: "",
  richTextJson: null,
  images: EMPTY_IMAGES,
  terminalContexts: EMPTY_TERMINAL_CONTEXTS,
  interactionMode: null,
});

function createEmptyThreadDraft(): ComposerThreadDraftState {
  return {
    prompt: "",
    richTextJson: null,
    images: [],
    terminalContexts: [],
    interactionMode: null,
  };
}

function hasComposerDraftText(
  draft: Pick<ComposerThreadDraftState, "prompt" | "richTextJson">,
): boolean {
  return draft.prompt.length > 0 || (draft.richTextJson?.length ?? 0) > 0;
}

function composerImageDedupKey(image: ComposerImageAttachment): string {
  // Keep this independent from File.lastModified so dedupe is stable for hydrated
  // images reconstructed from localStorage (which get a fresh lastModified value).
  return `${image.mimeType}\u0000${image.sizeBytes}\u0000${image.name}`;
}

function terminalContextDedupKey(context: TerminalContextDraft): string {
  return `${context.terminalId}\u0000${context.lineStart}\u0000${context.lineEnd}`;
}

function coerceTerminalContextForThread(
  threadId: ThreadId,
  context: TerminalContextDraft,
): TerminalContextDraft | null {
  const terminalId = context.terminalId.trim();
  const terminalLabel = context.terminalLabel.trim();
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const lineStart = Math.max(1, Math.floor(context.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(context.lineEnd));
  return {
    ...context,
    threadId,
    terminalId,
    terminalLabel,
    lineStart,
    lineEnd,
    text: normalizeTerminalContextText(context.text),
  };
}

function dedupeTerminalContextsForThread(
  threadId: ThreadId,
  contexts: ReadonlyArray<TerminalContextDraft>,
): TerminalContextDraft[] {
  const existingIds = new Set<string>();
  const existingDedupKeys = new Set<string>();
  const nextContexts: TerminalContextDraft[] = [];

  for (const context of contexts) {
    const coercedContext = coerceTerminalContextForThread(threadId, context);
    if (!coercedContext) {
      continue;
    }
    const dedupKey = terminalContextDedupKey(coercedContext);
    if (existingIds.has(coercedContext.id) || existingDedupKeys.has(dedupKey)) {
      continue;
    }
    nextContexts.push(coercedContext);
    existingIds.add(coercedContext.id);
    existingDedupKeys.add(dedupKey);
  }

  return nextContexts;
}

function shouldRemoveDraft(draft: ComposerThreadDraftState): boolean {
  return (
    !hasComposerDraftText(draft) &&
    draft.images.length === 0 &&
    draft.terminalContexts.length === 0 &&
    draft.interactionMode === null
  );
}

function revokeObjectPreviewUrl(previewUrl: string): void {
  if (typeof URL === "undefined") {
    return;
  }
  if (!previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

function revokeDraftThreadPreviewUrls(draft: ComposerThreadDraftState | undefined): void {
  if (!draft) {
    return;
  }
  for (const image of draft.images) {
    revokeObjectPreviewUrl(image.previewUrl);
  }
}

function isIndexableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePersistedAttachment(value: unknown): PersistedComposerImageAttachment | null {
  if (!isIndexableRecord(value)) {
    return null;
  }
  const candidate = value;
  const id = candidate.id;
  const name = candidate.name;
  const mimeType = candidate.mimeType;
  const sizeBytes = candidate.sizeBytes;
  const dataUrl = candidate.dataUrl;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    typeof dataUrl !== "string" ||
    id.length === 0 ||
    dataUrl.length === 0
  ) {
    return null;
  }
  return {
    id,
    name,
    mimeType,
    sizeBytes,
    dataUrl,
  };
}

function normalizePersistedTerminalContextDraft(
  value: unknown,
): PersistedTerminalContextDraft | null {
  if (!isIndexableRecord(value)) {
    return null;
  }
  const candidate = value;
  const id = candidate.id;
  const threadId = candidate.threadId;
  const createdAt = candidate.createdAt;
  const lineStart = candidate.lineStart;
  const lineEnd = candidate.lineEnd;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    typeof createdAt !== "string" ||
    createdAt.length === 0 ||
    typeof lineStart !== "number" ||
    !Number.isFinite(lineStart) ||
    typeof lineEnd !== "number" ||
    !Number.isFinite(lineEnd)
  ) {
    return null;
  }
  const terminalId = typeof candidate.terminalId === "string" ? candidate.terminalId.trim() : "";
  const terminalLabel =
    typeof candidate.terminalLabel === "string" ? candidate.terminalLabel.trim() : "";
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const parsedLineStart = Math.max(1, Math.floor(lineStart));
  const parsedLineEnd = Math.max(parsedLineStart, Math.floor(lineEnd));
  return {
    id,
    threadId: ThreadId.make(threadId),
    createdAt,
    terminalId,
    terminalLabel,
    lineStart: parsedLineStart,
    lineEnd: parsedLineEnd,
  };
}

function draftEnvModeFromStorage(
  value: unknown,
  fallbackWorktreePath: string | null,
): DraftThreadEnvMode {
  if (value === "local" || value === "worktree") {
    return value;
  }
  return fallbackWorktreePath ? "worktree" : "local";
}

type ComposerThreadLookupState = Pick<
  ComposerDraftStoreState,
  "draftsByThreadKey" | "draftThreadsByThreadKey"
>;

function resolveComposerDraftKey(
  state: ComposerThreadLookupState,
  target: ComposerThreadTarget,
): string | null {
  if (typeof target !== "string") {
    const scopedKey = scopedThreadKey(target);
    if (state.draftsByThreadKey[scopedKey]) {
      return scopedKey;
    }
    for (const [draftId, draftSession] of Object.entries(state.draftThreadsByThreadKey)) {
      if (
        draftSession.environmentId === target.environmentId &&
        draftSession.threadId === target.threadId
      ) {
        return draftId;
      }
    }
    return scopedKey;
  }

  const draftId = target.trim();
  return draftId.length > 0 ? draftId : null;
}

function resolveComposerThreadId(
  state: ComposerThreadLookupState,
  target: ComposerThreadTarget,
): ThreadId | null {
  if (typeof target !== "string") {
    return target.threadId;
  }

  const draftId = target.trim();
  if (draftId.length === 0) {
    return null;
  }
  return state.draftThreadsByThreadKey[draftId]?.threadId ?? null;
}

function getComposerDraftState(
  state: Pick<ComposerDraftStoreState, "draftsByThreadKey" | "draftThreadsByThreadKey">,
  target: ComposerThreadTarget,
): ComposerThreadDraftState | null {
  const threadKey = resolveComposerDraftKey(state, target);
  if (!threadKey) {
    return null;
  }
  return state.draftsByThreadKey[threadKey] ?? null;
}

function toProjectDraftSession(
  draftId: DraftId,
  draftSession: DraftThreadState,
): ProjectDraftSession {
  return {
    draftId,
    ...draftSession,
  };
}

function createDraftThreadState(
  projectRef: ScopedProjectRef,
  threadId: ThreadId,
  logicalProjectKey: string,
  existingThread: DraftThreadState | undefined,
  options?: {
    threadId?: ThreadId;
    branch?: string | null;
    worktreePath?: string | null;
    createdAt?: string;
    envMode?: DraftThreadEnvMode;
    interactionMode?: AgentInteractionMode;
  },
): DraftThreadState {
  const projectChanged =
    existingThread !== undefined &&
    (existingThread.environmentId !== projectRef.environmentId ||
      existingThread.projectId !== projectRef.projectId);
  const nextWorktreePath =
    options?.worktreePath === undefined
      ? projectChanged
        ? null
        : (existingThread?.worktreePath ?? null)
      : (options.worktreePath ?? null);
  const nextBranch =
    options?.branch === undefined
      ? projectChanged
        ? null
        : (existingThread?.branch ?? null)
      : (options.branch ?? null);
  return {
    threadId,
    environmentId: projectRef.environmentId,
    projectId: projectRef.projectId,
    logicalProjectKey,
    createdAt: options?.createdAt ?? existingThread?.createdAt ?? new Date().toISOString(),
    updatedAt: existingThread?.updatedAt ?? options?.createdAt ?? new Date().toISOString(),
    interactionMode:
      options?.interactionMode ?? existingThread?.interactionMode ?? DEFAULT_INTERACTION_MODE,
    branch: nextBranch,
    worktreePath: nextWorktreePath,
    envMode:
      options?.envMode ??
      (nextWorktreePath
        ? "worktree"
        : projectChanged
          ? "local"
          : (existingThread?.envMode ?? "local")),
    promotedTo: null,
  };
}

function scopedThreadRefsEqual(
  left: ScopedThreadRef | null | undefined,
  right: ScopedThreadRef | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.environmentId === right.environmentId && left.threadId === right.threadId;
}

function isDraftThreadPromoting(draftThread: DraftThreadState | null | undefined): boolean {
  return draftThread?.promotedTo !== null && draftThread?.promotedTo !== undefined;
}

function draftThreadsEqual(left: DraftThreadState | undefined, right: DraftThreadState): boolean {
  return (
    !!left &&
    left.threadId === right.threadId &&
    left.environmentId === right.environmentId &&
    left.projectId === right.projectId &&
    left.logicalProjectKey === right.logicalProjectKey &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.interactionMode === right.interactionMode &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.envMode === right.envMode &&
    scopedThreadRefsEqual(left.promotedTo, right.promotedTo) &&
    (left.promotedTitle ?? null) === (right.promotedTitle ?? null)
  );
}

function projectlessDraftKey(environmentId: EnvironmentId): string {
  return `projectless:${environmentId}`;
}

function touchDraftThreadUpdatedAt(
  state: Pick<ComposerDraftStoreState, "draftThreadsByThreadKey">,
  threadKey: string,
  updatedAt: string,
): Record<string, DraftThreadState> {
  const existing = state.draftThreadsByThreadKey[threadKey];
  if (!existing || existing.updatedAt === updatedAt) {
    return state.draftThreadsByThreadKey;
  }
  return {
    ...state.draftThreadsByThreadKey,
    [threadKey]: {
      ...existing,
      updatedAt,
    },
  };
}

function removeDraftThreadReferences(
  state: Pick<
    ComposerDraftStoreState,
    | "draftThreadsByThreadKey"
    | "draftsByThreadKey"
    | "logicalProjectDraftThreadKeyByLogicalProjectKey"
  >,
  threadKey: string,
): Pick<
  ComposerDraftStoreState,
  | "draftThreadsByThreadKey"
  | "draftsByThreadKey"
  | "logicalProjectDraftThreadKeyByLogicalProjectKey"
> {
  const nextLogicalMappings = Object.fromEntries(
    Object.entries(state.logicalProjectDraftThreadKeyByLogicalProjectKey).filter(
      ([, draftThreadKey]) => draftThreadKey !== threadKey,
    ),
  ) as Record<string, string>;
  const { [threadKey]: _removedDraftThread, ...restDraftThreadsByThreadKey } =
    state.draftThreadsByThreadKey;
  const { [threadKey]: removedComposerDraft, ...restDraftsByThreadKey } = state.draftsByThreadKey;
  revokeDraftThreadPreviewUrls(removedComposerDraft);
  return {
    draftsByThreadKey: restDraftsByThreadKey,
    draftThreadsByThreadKey: restDraftThreadsByThreadKey,
    logicalProjectDraftThreadKeyByLogicalProjectKey: nextLogicalMappings,
  };
}

function normalizePersistedDraftThreads(
  rawDraftThreadsByThreadKey: unknown,
  rawLogicalProjectDraftThreadKeyByLogicalProjectKey: unknown,
): Pick<
  PersistedComposerDraftStoreState,
  "draftThreadsByThreadKey" | "logicalProjectDraftThreadKeyByLogicalProjectKey"
> {
  const draftThreadsByThreadKey: Record<string, PersistedDraftThreadState> = {};
  if (isIndexableRecord(rawDraftThreadsByThreadKey)) {
    for (const [threadKey, rawDraftThread] of Object.entries(rawDraftThreadsByThreadKey)) {
      if (typeof threadKey !== "string" || threadKey.length === 0) {
        continue;
      }
      if (!isIndexableRecord(rawDraftThread)) {
        continue;
      }
      const candidateDraftThread = rawDraftThread;
      const threadId =
        typeof candidateDraftThread.threadId === "string" &&
        candidateDraftThread.threadId.length > 0
          ? ThreadId.make(candidateDraftThread.threadId)
          : null;
      const environmentId =
        typeof candidateDraftThread.environmentId === "string" &&
        candidateDraftThread.environmentId.length > 0
          ? EnvironmentIdSchema.make(candidateDraftThread.environmentId)
          : null;
      const projectId = candidateDraftThread.projectId;
      const createdAt = candidateDraftThread.createdAt;
      const branch = candidateDraftThread.branch;
      const worktreePath = candidateDraftThread.worktreePath;
      const normalizedWorktreePath = typeof worktreePath === "string" ? worktreePath : null;
      const promotedToCandidate = candidateDraftThread.promotedTo;
      const promotedToRecord = isIndexableRecord(promotedToCandidate) ? promotedToCandidate : null;
      const promotedTo =
        promotedToRecord &&
        typeof promotedToRecord.environmentId === "string" &&
        promotedToRecord.environmentId.length > 0 &&
        typeof promotedToRecord.threadId === "string" &&
        promotedToRecord.threadId.length > 0
          ? scopeThreadRef(
              EnvironmentIdSchema.make(promotedToRecord.environmentId),
              ThreadId.make(promotedToRecord.threadId),
            )
          : null;
      const promotedTitle =
        typeof candidateDraftThread.promotedTitle === "string" &&
        candidateDraftThread.promotedTitle.length > 0
          ? candidateDraftThread.promotedTitle
          : null;
      const normalizedProjectId =
        projectId === null
          ? null
          : typeof projectId === "string" && projectId.length > 0
            ? ProjectId.make(projectId)
            : undefined;
      if (threadId === null || normalizedProjectId === undefined || environmentId === null) {
        continue;
      }
      draftThreadsByThreadKey[threadKey] = {
        threadId,
        environmentId,
        projectId: normalizedProjectId,
        logicalProjectKey:
          typeof candidateDraftThread.logicalProjectKey === "string" &&
          candidateDraftThread.logicalProjectKey.length > 0
            ? candidateDraftThread.logicalProjectKey
            : normalizedProjectId === null
              ? projectlessDraftKey(environmentId)
              : scopedProjectKey(scopeProjectRef(environmentId, normalizedProjectId)),
        createdAt:
          typeof createdAt === "string" && createdAt.length > 0
            ? createdAt
            : new Date().toISOString(),
        updatedAt:
          typeof candidateDraftThread.updatedAt === "string" &&
          candidateDraftThread.updatedAt.length > 0
            ? candidateDraftThread.updatedAt
            : typeof createdAt === "string" && createdAt.length > 0
              ? createdAt
              : new Date().toISOString(),
        interactionMode: isAgentInteractionMode(candidateDraftThread.interactionMode)
          ? candidateDraftThread.interactionMode
          : DEFAULT_INTERACTION_MODE,
        branch: typeof branch === "string" ? branch : null,
        worktreePath: normalizedWorktreePath,
        envMode: draftEnvModeFromStorage(candidateDraftThread.envMode, normalizedWorktreePath),
        promotedTo,
        promotedTitle,
      };
    }
  }

  const logicalProjectDraftThreadKeyByLogicalProjectKey: Record<string, string> = {};
  if (isIndexableRecord(rawLogicalProjectDraftThreadKeyByLogicalProjectKey)) {
    for (const [logicalProjectKey, threadKey] of Object.entries(
      rawLogicalProjectDraftThreadKeyByLogicalProjectKey,
    )) {
      if (typeof threadKey !== "string" || threadKey.length === 0) {
        continue;
      }
      const existingDraftThread = draftThreadsByThreadKey[threadKey];
      if (existingDraftThread) {
        logicalProjectDraftThreadKeyByLogicalProjectKey[logicalProjectKey] = threadKey;
        if (existingDraftThread.logicalProjectKey !== logicalProjectKey) {
          draftThreadsByThreadKey[threadKey] = {
            ...existingDraftThread,
            logicalProjectKey,
          };
        }
      }
    }
  }

  return { draftThreadsByThreadKey, logicalProjectDraftThreadKeyByLogicalProjectKey };
}

function normalizePersistedDraftsByThreadKey(
  rawDraftMap: unknown,
): PersistedComposerDraftStoreState["draftsByThreadKey"] {
  if (!isIndexableRecord(rawDraftMap)) {
    return {};
  }

  const nextDraftsByThreadKey: DeepMutable<PersistedComposerDraftStoreState["draftsByThreadKey"]> =
    {};
  for (const [threadKey, draftValue] of Object.entries(rawDraftMap)) {
    if (typeof threadKey !== "string" || threadKey.length === 0) {
      continue;
    }
    if (!isIndexableRecord(draftValue)) {
      continue;
    }
    const draftCandidate = draftValue;
    const promptCandidate = typeof draftCandidate.prompt === "string" ? draftCandidate.prompt : "";
    if (Array.isArray(draftCandidate.attachments)) {
      for (const entry of draftCandidate.attachments) {
        normalizePersistedAttachment(entry);
      }
    }
    const terminalContexts = Array.isArray(draftCandidate.terminalContexts)
      ? draftCandidate.terminalContexts.flatMap((entry) => {
          const normalized = normalizePersistedTerminalContextDraft(entry);
          return normalized ? [normalized] : [];
        })
      : [];
    const interactionMode = isAgentInteractionMode(draftCandidate.interactionMode)
      ? draftCandidate.interactionMode
      : null;
    const richTextCandidate =
      typeof draftCandidate.richText === "string" ? draftCandidate.richText : "";
    const prompt = ensureInlineTerminalContextPlaceholders(
      promptCandidate,
      terminalContexts.length,
    );
    if (
      promptCandidate.length === 0 &&
      richTextCandidate.length === 0 &&
      terminalContexts.length === 0 &&
      !interactionMode
    ) {
      continue;
    }
    nextDraftsByThreadKey[threadKey] = {
      prompt,
      attachments: [],
      ...(richTextCandidate.length > 0 ? { richText: richTextCandidate } : {}),
      ...(terminalContexts.length > 0 ? { terminalContexts } : {}),
      ...(interactionMode ? { interactionMode } : {}),
    };
  }

  return nextDraftsByThreadKey;
}

function partializeComposerDraftStoreState(
  state: ComposerDraftStoreState,
): PersistedComposerDraftStoreState {
  const persistedDraftsByThreadKey: DeepMutable<
    PersistedComposerDraftStoreState["draftsByThreadKey"]
  > = {};
  for (const [threadKey, draft] of Object.entries(state.draftsByThreadKey)) {
    if (typeof threadKey !== "string" || threadKey.length === 0) {
      continue;
    }
    if (
      !hasComposerDraftText(draft) &&
      draft.terminalContexts.length === 0 &&
      draft.interactionMode === null
    ) {
      continue;
    }
    const persistedDraft: DeepMutable<PersistedComposerThreadDraftState> = {
      prompt: draft.prompt,
      // Do not persist image data URLs in localStorage. The live File objects stay
      // in memory until send; binary payloads are read only when submitting.
      attachments: [],
      ...(draft.richTextJson && draft.richTextJson.length > 0
        ? { richText: draft.richTextJson }
        : {}),
      ...(draft.terminalContexts.length > 0
        ? {
            terminalContexts: draft.terminalContexts.map((context) => ({
              id: context.id,
              threadId: context.threadId,
              createdAt: context.createdAt,
              terminalId: context.terminalId,
              terminalLabel: context.terminalLabel,
              lineStart: context.lineStart,
              lineEnd: context.lineEnd,
            })),
          }
        : {}),
      ...(draft.interactionMode ? { interactionMode: draft.interactionMode } : {}),
    };
    persistedDraftsByThreadKey[threadKey] = persistedDraft;
  }
  return {
    draftsByThreadKey: persistedDraftsByThreadKey,
    draftThreadsByThreadKey: state.draftThreadsByThreadKey,
    logicalProjectDraftThreadKeyByLogicalProjectKey:
      state.logicalProjectDraftThreadKeyByLogicalProjectKey,
  };
}

function normalizeCurrentPersistedComposerDraftStoreState(
  persistedState: unknown,
): PersistedComposerDraftStoreState {
  if (!isIndexableRecord(persistedState)) {
    return EMPTY_PERSISTED_DRAFT_STORE_STATE;
  }
  const { draftThreadsByThreadKey, logicalProjectDraftThreadKeyByLogicalProjectKey } =
    normalizePersistedDraftThreads(
      persistedState.draftThreadsByThreadKey,
      persistedState.logicalProjectDraftThreadKeyByLogicalProjectKey,
    );

  return {
    draftsByThreadKey: normalizePersistedDraftsByThreadKey(persistedState.draftsByThreadKey),
    draftThreadsByThreadKey,
    logicalProjectDraftThreadKeyByLogicalProjectKey,
  };
}

function toHydratedThreadDraft(
  persistedDraft: PersistedComposerThreadDraftState,
): ComposerThreadDraftState {
  const richTextJson =
    typeof persistedDraft.richText === "string" && persistedDraft.richText.length > 0
      ? persistedDraft.richText
      : null;
  return {
    prompt: persistedDraft.prompt,
    richTextJson,
    images: [],
    terminalContexts:
      persistedDraft.terminalContexts?.map((context) => ({
        ...context,
        text: "",
      })) ?? [],
    interactionMode: persistedDraft.interactionMode ?? null,
  };
}

function toHydratedDraftThreadState(
  persistedDraftThread: PersistedDraftThreadState,
): DraftThreadState {
  return {
    threadId: persistedDraftThread.threadId,
    environmentId: EnvironmentIdSchema.make(persistedDraftThread.environmentId),
    projectId: persistedDraftThread.projectId,
    logicalProjectKey:
      persistedDraftThread.logicalProjectKey ??
      (persistedDraftThread.projectId === null
        ? projectlessDraftKey(EnvironmentIdSchema.make(persistedDraftThread.environmentId))
        : scopedProjectKey(
            scopeProjectRef(
              EnvironmentIdSchema.make(persistedDraftThread.environmentId),
              persistedDraftThread.projectId,
            ),
          )),
    createdAt: persistedDraftThread.createdAt,
    updatedAt: persistedDraftThread.updatedAt ?? persistedDraftThread.createdAt,
    interactionMode: persistedDraftThread.interactionMode,
    branch: persistedDraftThread.branch,
    worktreePath: persistedDraftThread.worktreePath,
    envMode: persistedDraftThread.envMode,
    promotedTo: persistedDraftThread.promotedTo
      ? scopeThreadRef(
          EnvironmentIdSchema.make(persistedDraftThread.promotedTo.environmentId),
          ThreadId.make(persistedDraftThread.promotedTo.threadId),
        )
      : null,
    promotedTitle: persistedDraftThread.promotedTitle ?? null,
  };
}

const composerDraftStore = create<ComposerDraftStoreState>()(
  persist(
    (setBase, get) => {
      const set = setBase;

      return {
        draftsByThreadKey: {},
        draftThreadsByThreadKey: {},
        logicalProjectDraftThreadKeyByLogicalProjectKey: {},
        getComposerDraft: (target) => getComposerDraftState(get(), target),
        getDraftThreadByLogicalProjectKey: (logicalProjectKey) => {
          return get().getDraftSessionByLogicalProjectKey(logicalProjectKey);
        },
        getDraftSessionByLogicalProjectKey: (logicalProjectKey) => {
          const trimmedLogicalProjectKey = logicalProjectKey.trim();
          if (trimmedLogicalProjectKey.length === 0) {
            return null;
          }
          const draftId =
            get().logicalProjectDraftThreadKeyByLogicalProjectKey[trimmedLogicalProjectKey];
          if (!draftId) {
            return null;
          }
          const draftThread = get().draftThreadsByThreadKey[draftId];
          if (!draftThread || isDraftThreadPromoting(draftThread)) {
            return null;
          }
          return toProjectDraftSession(DraftId.make(draftId), draftThread);
        },
        getDraftThreadByProjectRef: (projectRef) => {
          return get().getDraftSessionByProjectRef(projectRef);
        },
        getDraftSessionByProjectRef: (projectRef) => {
          for (const [draftId, draftThread] of Object.entries(get().draftThreadsByThreadKey)) {
            if (isDraftThreadPromoting(draftThread)) {
              continue;
            }
            if (
              draftThread.projectId === projectRef.projectId &&
              draftThread.environmentId === projectRef.environmentId
            ) {
              return toProjectDraftSession(DraftId.make(draftId), draftThread);
            }
          }
          return null;
        },
        getDraftSession: (draftId) => get().draftThreadsByThreadKey[draftId] ?? null,
        getDraftSessionByRef: (threadRef) => {
          for (const draftSession of Object.values(get().draftThreadsByThreadKey)) {
            if (
              draftSession.environmentId === threadRef.environmentId &&
              draftSession.threadId === threadRef.threadId
            ) {
              return draftSession;
            }
          }
          return null;
        },
        getDraftThread: (threadRef) => {
          if (typeof threadRef === "string") {
            return get().getDraftSession(DraftId.make(threadRef));
          }
          return get().getDraftSessionByRef(threadRef);
        },
        getDraftThreadByRef: (threadRef) => {
          return get().getDraftSessionByRef(threadRef);
        },
        listDraftThreadKeys: () =>
          Object.values(get().draftThreadsByThreadKey).map((draftThread) =>
            scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
          ),
        hasDraftThreadsInEnvironment: (environmentId) =>
          Object.values(get().draftThreadsByThreadKey).some(
            (draftThread) => draftThread.environmentId === environmentId,
          ),
        getProjectlessDraftSession: (environmentId) => {
          const draftId =
            get().logicalProjectDraftThreadKeyByLogicalProjectKey[
              projectlessDraftKey(environmentId)
            ];
          if (!draftId) {
            return null;
          }
          const draftThread = get().draftThreadsByThreadKey[draftId];
          if (
            !draftThread ||
            draftThread.projectId !== null ||
            isDraftThreadPromoting(draftThread)
          ) {
            return null;
          }
          return toProjectDraftSession(DraftId.make(draftId), draftThread);
        },
        setProjectlessDraftThreadId: (environmentId, draftId, options) => {
          if (environmentId.length === 0 || draftId.length === 0) {
            return;
          }
          const logicalProjectKey = projectlessDraftKey(environmentId);
          set((state) => {
            const existingThread = state.draftThreadsByThreadKey[draftId];
            const previousThreadKeyForProjectless =
              state.logicalProjectDraftThreadKeyByLogicalProjectKey[logicalProjectKey];
            const nextDraftThread: DraftThreadState = {
              threadId: options?.threadId ?? existingThread?.threadId ?? ThreadId.make(draftId),
              environmentId,
              projectId: null,
              logicalProjectKey,
              createdAt:
                options?.createdAt ?? existingThread?.createdAt ?? new Date().toISOString(),
              updatedAt:
                existingThread?.updatedAt ?? options?.createdAt ?? new Date().toISOString(),
              interactionMode:
                options?.interactionMode ??
                existingThread?.interactionMode ??
                DEFAULT_INTERACTION_MODE,
              branch: null,
              worktreePath: null,
              envMode: "local",
              promotedTo: null,
            };
            const hasSameMapping = previousThreadKeyForProjectless === draftId;
            if (hasSameMapping && draftThreadsEqual(existingThread, nextDraftThread)) {
              return state;
            }
            const nextLogicalProjectDraftThreadKeyByLogicalProjectKey = {
              ...state.logicalProjectDraftThreadKeyByLogicalProjectKey,
              [logicalProjectKey]: draftId,
            };
            const nextDraftThreadsByThreadKey = {
              ...state.draftThreadsByThreadKey,
              [draftId]: nextDraftThread,
            };
            return {
              draftThreadsByThreadKey: nextDraftThreadsByThreadKey,
              logicalProjectDraftThreadKeyByLogicalProjectKey:
                nextLogicalProjectDraftThreadKeyByLogicalProjectKey,
            };
          });
        },
        setLogicalProjectDraftThreadId: (logicalProjectKey, projectRef, draftId, options) => {
          const trimmedLogicalProjectKey = logicalProjectKey.trim();
          if (trimmedLogicalProjectKey.length === 0 || draftId.length === 0) {
            return;
          }
          set((state) => {
            const existingThread = state.draftThreadsByThreadKey[draftId];
            const previousThreadKeyForLogicalProject =
              state.logicalProjectDraftThreadKeyByLogicalProjectKey[trimmedLogicalProjectKey];
            const nextDraftThread = createDraftThreadState(
              projectRef,
              options?.threadId ?? existingThread?.threadId ?? ThreadId.make(draftId),
              trimmedLogicalProjectKey,
              existingThread,
              options,
            );
            const hasSameLogicalMapping = previousThreadKeyForLogicalProject === draftId;
            if (hasSameLogicalMapping && draftThreadsEqual(existingThread, nextDraftThread)) {
              return state;
            }
            const nextLogicalProjectDraftThreadKeyByLogicalProjectKey: Record<string, string> = {
              ...state.logicalProjectDraftThreadKeyByLogicalProjectKey,
              [trimmedLogicalProjectKey]: draftId,
            };
            const nextDraftThreadsByThreadKey: Record<string, DraftThreadState> = {
              ...state.draftThreadsByThreadKey,
              [draftId]: nextDraftThread,
            };
            return {
              draftThreadsByThreadKey: nextDraftThreadsByThreadKey,
              logicalProjectDraftThreadKeyByLogicalProjectKey:
                nextLogicalProjectDraftThreadKeyByLogicalProjectKey,
            };
          });
        },
        setProjectDraftThreadId: (projectRef, draftId, options) => {
          get().setLogicalProjectDraftThreadId(
            scopedProjectKey(projectRef),
            projectRef,
            draftId,
            options,
          );
        },
        setDraftThreadContext: (threadRef, options) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftThreadsByThreadKey[threadKey];
            if (!existing) {
              return state;
            }
            const nextProjectRef = options.projectRef ?? {
              environmentId: existing.environmentId,
              projectId: existing.projectId,
            };
            if (nextProjectRef.projectId === null) {
              return state;
            }
            if (
              nextProjectRef.projectId.length === 0 ||
              nextProjectRef.environmentId.length === 0
            ) {
              return state;
            }
            const projectChanged =
              nextProjectRef.environmentId !== existing.environmentId ||
              nextProjectRef.projectId !== existing.projectId;
            const nextWorktreePath =
              options.worktreePath === undefined
                ? projectChanged
                  ? null
                  : existing.worktreePath
                : (options.worktreePath ?? null);
            const nextBranch =
              options.branch === undefined
                ? projectChanged
                  ? null
                  : existing.branch
                : (options.branch ?? null);
            const nextDraftThread: DraftThreadState = {
              threadId: existing.threadId,
              environmentId: nextProjectRef.environmentId,
              projectId: nextProjectRef.projectId,
              logicalProjectKey: existing.logicalProjectKey,
              createdAt:
                options.createdAt === undefined
                  ? existing.createdAt
                  : options.createdAt || existing.createdAt,
              updatedAt: existing.updatedAt,
              interactionMode: options.interactionMode ?? existing.interactionMode,
              branch: nextBranch,
              worktreePath: nextWorktreePath,
              envMode:
                options.envMode ??
                (nextWorktreePath
                  ? "worktree"
                  : projectChanged
                    ? "local"
                    : (existing.envMode ?? "local")),
              promotedTo: existing.promotedTo ?? null,
              promotedTitle: existing.promotedTitle ?? null,
            };
            const isUnchanged =
              nextDraftThread.environmentId === existing.environmentId &&
              nextDraftThread.projectId === existing.projectId &&
              nextDraftThread.logicalProjectKey === existing.logicalProjectKey &&
              nextDraftThread.createdAt === existing.createdAt &&
              nextDraftThread.updatedAt === existing.updatedAt &&
              nextDraftThread.interactionMode === existing.interactionMode &&
              nextDraftThread.branch === existing.branch &&
              nextDraftThread.worktreePath === existing.worktreePath &&
              nextDraftThread.envMode === existing.envMode &&
              scopedThreadRefsEqual(nextDraftThread.promotedTo, existing.promotedTo);
            if (isUnchanged) {
              return state;
            }
            return {
              draftThreadsByThreadKey: {
                ...state.draftThreadsByThreadKey,
                [threadKey]: nextDraftThread,
              },
            };
          });
        },
        clearProjectDraftThreadId: (projectRef) => {
          set((state) => {
            const matchingThreadEntry = Object.entries(state.draftThreadsByThreadKey).find(
              ([, draftThread]) =>
                draftThread.projectId === projectRef.projectId &&
                draftThread.environmentId === projectRef.environmentId,
            );
            if (!matchingThreadEntry) {
              return state;
            }
            return removeDraftThreadReferences(state, matchingThreadEntry[0]);
          });
        },
        clearProjectDraftThreadById: (projectRef, threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const draftThread = state.draftThreadsByThreadKey[threadKey];
            if (
              !draftThread ||
              draftThread.projectId !== projectRef.projectId ||
              draftThread.environmentId !== projectRef.environmentId
            ) {
              return state;
            }
            return removeDraftThreadReferences(state, threadKey);
          });
        },
        markDraftThreadPromoting: (threadRef, promotedTo, promotedTitle) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          if (!threadKey) {
            return;
          }
          set((state) => {
            const existing = state.draftThreadsByThreadKey[threadKey];
            if (!existing) {
              return state;
            }
            const nextPromotedTo =
              promotedTo ?? scopeThreadRef(existing.environmentId, existing.threadId);
            const nextPromotedTitle = promotedTitle?.trim() || (existing.promotedTitle ?? null);
            if (
              scopedThreadRefsEqual(existing.promotedTo, nextPromotedTo) &&
              (existing.promotedTitle ?? null) === nextPromotedTitle
            ) {
              return state;
            }
            return {
              draftThreadsByThreadKey: {
                ...state.draftThreadsByThreadKey,
                [threadKey]: {
                  ...existing,
                  promotedTo: nextPromotedTo,
                  promotedTitle: nextPromotedTitle,
                },
              },
            };
          });
        },
        cancelDraftThreadPromotion: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          if (!threadKey) {
            return;
          }
          set((state) => {
            const existing = state.draftThreadsByThreadKey[threadKey];
            if (
              existing === undefined ||
              existing.promotedTo === undefined ||
              existing.promotedTo === null
            ) {
              return state;
            }
            return {
              draftThreadsByThreadKey: {
                ...state.draftThreadsByThreadKey,
                [threadKey]: {
                  ...existing,
                  promotedTo: null,
                  promotedTitle: null,
                },
              },
            };
          });
        },
        finalizePromotedDraftThread: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const existing = state.draftThreadsByThreadKey[threadKey];
            if (!isDraftThreadPromoting(existing)) {
              return state;
            }
            return removeDraftThreadReferences(state, threadKey);
          });
        },
        clearDraftThread: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          set((state) => {
            const hasDraftThread = state.draftThreadsByThreadKey[threadKey] !== undefined;
            const hasLogicalProjectMapping = Object.values(
              state.logicalProjectDraftThreadKeyByLogicalProjectKey,
            ).includes(threadKey);
            const hasComposerDraft = state.draftsByThreadKey[threadKey] !== undefined;
            if (!hasDraftThread && !hasLogicalProjectMapping && !hasComposerDraft) {
              return state;
            }
            return removeDraftThreadReferences(state, threadKey);
          });
        },
        setPrompt: (threadRef, prompt) => {
          get().updateComposerDraft(threadRef, { prompt });
        },
        updateComposerDraft: (threadRef, patch) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const existing = get().draftsByThreadKey[threadKey];
          const nextPrompt = patch.prompt ?? existing?.prompt ?? "";
          const nextRichTextJson =
            patch.richTextJson === undefined
              ? (existing?.richTextJson ?? null)
              : patch.richTextJson;
          if (!existing && nextPrompt.length === 0 && (nextRichTextJson?.length ?? 0) === 0) {
            return;
          }
          if (
            existing?.prompt === nextPrompt &&
            existing.richTextJson === nextRichTextJson &&
            patch.prompt === undefined &&
            patch.richTextJson === undefined
          ) {
            return;
          }
          const updatedAt = new Date().toISOString();
          set((state) => {
            const base = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const nextDraft: ComposerThreadDraftState = {
              ...base,
              prompt: nextPrompt,
              richTextJson: nextRichTextJson,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              draftThreadsByThreadKey: touchDraftThreadUpdatedAt(state, threadKey, updatedAt),
            };
          });
        },
        clearComposerText: (threadRef) => {
          get().updateComposerDraft(threadRef, { prompt: "", richTextJson: null });
        },
        setTerminalContexts: (threadRef, contexts) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId) {
            return;
          }
          const normalizedContexts = dedupeTerminalContextsForThread(threadId, contexts);
          const updatedAt = new Date().toISOString();
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const nextPrompt = ensureInlineTerminalContextPlaceholders(
              existing.prompt,
              normalizedContexts.length,
            );
            const nextDraft: ComposerThreadDraftState = {
              ...existing,
              prompt: nextPrompt,
              terminalContexts: normalizedContexts,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              draftThreadsByThreadKey: touchDraftThreadUpdatedAt(state, threadKey, updatedAt),
            };
          });
        },
        setInteractionMode: (threadRef, interactionMode) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const nextInteractionMode = isAgentInteractionMode(interactionMode)
            ? interactionMode
            : null;
          const updatedAt = new Date().toISOString();
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey];
            const existingDraftThread = state.draftThreadsByThreadKey[threadKey];
            if (!existing && !existingDraftThread && nextInteractionMode === null) {
              return state;
            }
            const base = existing ?? createEmptyThreadDraft();
            const nextDraftThreadInteractionMode =
              nextInteractionMode ?? DEFAULT_INTERACTION_MODE;
            const draftThreadModeChanged =
              existingDraftThread !== undefined &&
              existingDraftThread.interactionMode !== nextDraftThreadInteractionMode;
            if (base.interactionMode === nextInteractionMode && !draftThreadModeChanged) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...base,
              interactionMode: nextInteractionMode,
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            const nextDraftThreadsByThreadKey = draftThreadModeChanged
              ? {
                  ...state.draftThreadsByThreadKey,
                  [threadKey]: {
                    ...existingDraftThread,
                    interactionMode: nextDraftThreadInteractionMode,
                    updatedAt,
                  },
                }
              : touchDraftThreadUpdatedAt(state, threadKey, updatedAt);
            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              draftThreadsByThreadKey: nextDraftThreadsByThreadKey,
            };
          });
        },
        addImage: (threadRef, image) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId) {
            return;
          }
          get().addImages(typeof threadRef === "string" ? DraftId.make(threadKey) : threadRef, [
            image,
          ]);
        },
        addImages: (threadRef, images) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0 || images.length === 0) {
            return;
          }
          const updatedAt = new Date().toISOString();
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const existingIds = new Set(existing.images.map((image) => image.id));
            const existingDedupKeys = new Set(
              existing.images.map((image) => composerImageDedupKey(image)),
            );
            const acceptedPreviewUrls = new Set(existing.images.map((image) => image.previewUrl));
            const dedupedIncoming: ComposerImageAttachment[] = [];
            for (const image of images) {
              const dedupKey = composerImageDedupKey(image);
              if (existingIds.has(image.id) || existingDedupKeys.has(dedupKey)) {
                // Avoid revoking a blob URL that's still referenced by an accepted image.
                if (!acceptedPreviewUrls.has(image.previewUrl)) {
                  revokeObjectPreviewUrl(image.previewUrl);
                }
                continue;
              }
              dedupedIncoming.push(image);
              existingIds.add(image.id);
              existingDedupKeys.add(dedupKey);
              acceptedPreviewUrls.add(image.previewUrl);
            }
            if (dedupedIncoming.length === 0) {
              return state;
            }
            return {
              draftsByThreadKey: {
                ...state.draftsByThreadKey,
                [threadKey]: {
                  ...existing,
                  images: [...existing.images, ...dedupedIncoming],
                },
              },
              draftThreadsByThreadKey: touchDraftThreadUpdatedAt(state, threadKey, updatedAt),
            };
          });
        },
        removeImage: (threadRef, imageId) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const existing = get().draftsByThreadKey[threadKey];
          if (!existing) {
            return;
          }
          const removedImage = existing.images.find((image) => image.id === imageId);
          if (removedImage) {
            revokeObjectPreviewUrl(removedImage.previewUrl);
          }
          const updatedAt = new Date().toISOString();
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              images: current.images.filter((image) => image.id !== imageId),
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              draftThreadsByThreadKey: touchDraftThreadUpdatedAt(state, threadKey, updatedAt),
            };
          });
        },
        insertTerminalContext: (threadRef, prompt, context, index) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId) {
            return false;
          }
          let inserted = false;
          const updatedAt = new Date().toISOString();
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const normalizedContext = coerceTerminalContextForThread(threadId, context);
            if (!normalizedContext) {
              return state;
            }
            const dedupKey = terminalContextDedupKey(normalizedContext);
            if (
              existing.terminalContexts.some((entry) => entry.id === normalizedContext.id) ||
              existing.terminalContexts.some((entry) => terminalContextDedupKey(entry) === dedupKey)
            ) {
              return state;
            }
            inserted = true;
            const boundedIndex = Math.max(0, Math.min(existing.terminalContexts.length, index));
            const nextDraft: ComposerThreadDraftState = {
              ...existing,
              prompt,
              terminalContexts: [
                ...existing.terminalContexts.slice(0, boundedIndex),
                normalizedContext,
                ...existing.terminalContexts.slice(boundedIndex),
              ],
            };
            return {
              draftsByThreadKey: {
                ...state.draftsByThreadKey,
                [threadKey]: nextDraft,
              },
              draftThreadsByThreadKey: touchDraftThreadUpdatedAt(state, threadKey, updatedAt),
            };
          });
          return inserted;
        },
        addTerminalContext: (threadRef, context) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId) {
            return;
          }
          get().addTerminalContexts(
            typeof threadRef === "string" ? DraftId.make(threadKey) : threadRef,
            [context],
          );
        },
        addTerminalContexts: (threadRef, contexts) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef);
          const threadId = resolveComposerThreadId(get(), threadRef);
          if (!threadKey || !threadId || contexts.length === 0) {
            return;
          }
          const updatedAt = new Date().toISOString();
          set((state) => {
            const existing = state.draftsByThreadKey[threadKey] ?? createEmptyThreadDraft();
            const acceptedContexts = dedupeTerminalContextsForThread(threadId, [
              ...existing.terminalContexts,
              ...contexts,
            ]).slice(existing.terminalContexts.length);
            if (acceptedContexts.length === 0) {
              return state;
            }
            const nextPrompt = ensureInlineTerminalContextPlaceholders(
              existing.prompt,
              existing.terminalContexts.length + acceptedContexts.length,
            );
            return {
              draftsByThreadKey: {
                ...state.draftsByThreadKey,
                [threadKey]: {
                  ...existing,
                  prompt: nextPrompt,
                  terminalContexts: [...existing.terminalContexts, ...acceptedContexts],
                },
              },
              draftThreadsByThreadKey: touchDraftThreadUpdatedAt(state, threadKey, updatedAt),
            };
          });
        },
        removeTerminalContext: (threadRef, contextId) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0 || contextId.length === 0) {
            return;
          }
          const updatedAt = new Date().toISOString();
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              terminalContexts: current.terminalContexts.filter(
                (context) => context.id !== contextId,
              ),
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              draftThreadsByThreadKey: touchDraftThreadUpdatedAt(state, threadKey, updatedAt),
            };
          });
        },
        clearTerminalContexts: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const updatedAt = new Date().toISOString();
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current || current.terminalContexts.length === 0) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              terminalContexts: [],
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              draftThreadsByThreadKey: touchDraftThreadUpdatedAt(state, threadKey, updatedAt),
            };
          });
        },
        clearComposerContent: (threadRef) => {
          const threadKey = resolveComposerDraftKey(get(), threadRef) ?? "";
          if (threadKey.length === 0) {
            return;
          }
          const updatedAt = new Date().toISOString();
          set((state) => {
            const current = state.draftsByThreadKey[threadKey];
            if (!current) {
              return state;
            }
            const nextDraft: ComposerThreadDraftState = {
              ...current,
              prompt: "",
              richTextJson: null,
              images: [],
              terminalContexts: [],
            };
            const nextDraftsByThreadKey = { ...state.draftsByThreadKey };
            if (shouldRemoveDraft(nextDraft)) {
              delete nextDraftsByThreadKey[threadKey];
            } else {
              nextDraftsByThreadKey[threadKey] = nextDraft;
            }
            return {
              draftsByThreadKey: nextDraftsByThreadKey,
              draftThreadsByThreadKey: touchDraftThreadUpdatedAt(state, threadKey, updatedAt),
            };
          });
        },
      };
    },
    {
      name: COMPOSER_DRAFT_STORAGE_KEY,
      version: COMPOSER_DRAFT_STORAGE_VERSION,
      storage: composerDebouncedStorage,
      partialize: partializeComposerDraftStoreState,
      merge: (persistedState, currentState) => {
        const normalizedPersisted =
          normalizeCurrentPersistedComposerDraftStoreState(persistedState);
        const draftsByThreadKey = Object.fromEntries(
          Object.entries(normalizedPersisted.draftsByThreadKey).map(([threadKey, draft]) => [
            threadKey,
            toHydratedThreadDraft(draft),
          ]),
        );
        const draftThreadsByThreadKey = Object.fromEntries(
          Object.entries(normalizedPersisted.draftThreadsByThreadKey).map(
            ([threadKey, draftThread]) => [threadKey, toHydratedDraftThreadState(draftThread)],
          ),
        ) as Record<string, DraftThreadState>;
        return {
          ...currentState,
          draftsByThreadKey,
          draftThreadsByThreadKey,
          logicalProjectDraftThreadKeyByLogicalProjectKey:
            normalizedPersisted.logicalProjectDraftThreadKeyByLogicalProjectKey,
        };
      },
    },
  ),
);

export const useComposerDraftStore = composerDraftStore;

const NEW_THREAD_DRAFT_PREFIX = "new-thread-draft";

export function isNewThreadDraftId(draftId: DraftId): boolean {
  return draftId.startsWith(`${NEW_THREAD_DRAFT_PREFIX}:`);
}

export function isNewThreadDraftThreadId(threadId: ThreadId | string): boolean {
  return threadId.startsWith(`${NEW_THREAD_DRAFT_PREFIX}:thread:`);
}

export function draftIdFromNewThreadDraftThreadId(threadId: ThreadId | string): DraftId | null {
  const projectMatch = /^new-thread-draft:thread:project:([^:]+):([^:]+)(?::(.+))?$/.exec(threadId);
  if (projectMatch) {
    const suffix = projectMatch[3] ? `:${projectMatch[3]}` : "";
    return DraftId.make(`new-thread-draft:project:${projectMatch[1]}:${projectMatch[2]}${suffix}`);
  }
  const projectlessMatch = /^new-thread-draft:thread:projectless:([^:]+)(?::(.+))?$/.exec(threadId);
  if (projectlessMatch) {
    const suffix = projectlessMatch[2] ? `:${projectlessMatch[2]}` : "";
    return DraftId.make(`new-thread-draft:projectless:${projectlessMatch[1]}${suffix}`);
  }
  return null;
}

export function projectRefFromNewThreadDraftThreadRef(
  threadRef: ScopedThreadRef,
): ScopedProjectRef | null {
  const projectMatch = /^new-thread-draft:thread:project:([^:]+):([^:]+)(?::.+)?$/.exec(
    threadRef.threadId,
  );
  const environmentId = projectMatch?.[1];
  const projectIdValue = projectMatch?.[2];
  if (!environmentId || !projectIdValue) {
    return null;
  }
  return scopeProjectRef(EnvironmentIdSchema.make(environmentId), ProjectId.make(projectIdValue));
}

/** Read-only fallback when the URL names a pre-thread draft before persisted store hydration. */
export function draftThreadStateFromNewThreadDraftThreadRef(
  threadRef: ScopedThreadRef,
): DraftThreadState | null {
  const projectMatch = /^new-thread-draft:thread:project:([^:]+):([^:]+)(?::.+)?$/.exec(
    threadRef.threadId,
  );
  const projectEnvironmentId = projectMatch?.[1];
  const projectIdValue = projectMatch?.[2];
  if (projectEnvironmentId && projectIdValue) {
    return {
      threadId: threadRef.threadId,
      environmentId: EnvironmentIdSchema.make(projectEnvironmentId),
      projectId: ProjectId.make(projectIdValue),
      logicalProjectKey: "",
      createdAt: "",
      updatedAt: "",
      interactionMode: DEFAULT_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      envMode: "local",
      promotedTo: null,
    };
  }
  const projectlessMatch = /^new-thread-draft:thread:projectless:(.+)$/.exec(threadRef.threadId);
  const projectlessEnvironmentId = projectlessMatch?.[1];
  if (projectlessEnvironmentId) {
    return {
      threadId: threadRef.threadId,
      environmentId: EnvironmentIdSchema.make(projectlessEnvironmentId),
      projectId: null,
      logicalProjectKey: "",
      createdAt: "",
      updatedAt: "",
      interactionMode: DEFAULT_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      envMode: "local",
      promotedTo: null,
    };
  }
  return null;
}

export function useComposerThreadDraft(threadRef: ComposerThreadTarget): ComposerThreadDraftState {
  return useComposerDraftStore((state) => {
    return getComposerDraftState(state, threadRef) ?? EMPTY_THREAD_DRAFT;
  });
}

/**
 * Mark a draft thread as promoting once the server has materialized the same thread id.
 *
 * Use the single-thread helper for live `thread.created` events and the
 * iterable helper for bootstrap/recovery paths that discover multiple server
 * threads at once.
 */
export function markPromotedDraftThread(threadId: ThreadId): void {
  const store = useComposerDraftStore.getState();
  const draftThreadTargets: ComposerThreadTarget[] = [];
  for (const [draftId, draftThread] of Object.entries(store.draftThreadsByThreadKey)) {
    if (draftThread.threadId === threadId) {
      draftThreadTargets.push(DraftId.make(draftId));
    }
  }
  if (draftThreadTargets.length === 0) {
    return;
  }
  for (const draftThreadTarget of draftThreadTargets) {
    store.markDraftThreadPromoting(draftThreadTarget);
  }
}

export function markPromotedDraftThreadByRef(threadRef: ScopedThreadRef): void {
  const draftStore = useComposerDraftStore.getState();
  for (const [draftId, draftThread] of Object.entries(draftStore.draftThreadsByThreadKey)) {
    if (
      draftThread.environmentId === threadRef.environmentId &&
      draftThread.threadId === threadRef.threadId
    ) {
      draftStore.markDraftThreadPromoting(DraftId.make(draftId), threadRef);
    }
  }
}

export function markPromotedDraftThreads(serverThreadIds: Iterable<ThreadId>): void {
  for (const threadId of serverThreadIds) {
    markPromotedDraftThread(threadId);
  }
}

export function markPromotedDraftThreadsByRef(serverThreadRefs: Iterable<ScopedThreadRef>): void {
  for (const threadRef of serverThreadRefs) {
    markPromotedDraftThreadByRef(threadRef);
  }
}

export function finalizePromotedDraftThreadByRef(threadRef: ScopedThreadRef): ScopedThreadRef[] {
  const draftStore = useComposerDraftStore.getState();
  const finalizedDraftRefs: ScopedThreadRef[] = [];
  for (const [draftId, draftThread] of Object.entries(draftStore.draftThreadsByThreadKey)) {
    if (
      draftThread.promotedTo &&
      draftThread.promotedTo.environmentId === threadRef.environmentId &&
      draftThread.promotedTo.threadId === threadRef.threadId
    ) {
      finalizedDraftRefs.push(scopeThreadRef(draftThread.environmentId, draftThread.threadId));
      draftStore.finalizePromotedDraftThread(DraftId.make(draftId));
    }
  }
  return finalizedDraftRefs;
}
