import {
  OPEN_CODE_SESSION_CAPABILITIES,
  openCodeLocationRef,
  openCodeSessionRef,
  type Message,
  type OpenCodeClient,
  type OpenCodeLocationRef,
  type OpenCodeModelRef,
  type OpenCodePermissionReply,
  type OpenCodePermissionRequest,
  type OpenCodePromptFileAttachment,
  type OpenCodeProvider,
  type OpenCodeProviderAuthMethod,
  type OpenCodeProviderAuthPrompt,
  type OpenCodeProviderInventory,
  type OpenCodeQuestionRequest,
  type OpenCodeQuestionReply,
  type OpenCodeServerKey,
  type OpenCodeSessionInfo,
  type OpenCodeSessionTranscript,
  type OpenCodeSessionTranscriptSources,
  type Part,
} from "@honk/opencode";

/** Capability gates for host-only APIs the canonical client does not expose. */
export const APP_HOST_CAPABILITIES = Object.freeze({
  providerAuth: true,
  fileBrowse: false,
  fileStatus: true,
  directoryAttach: false,
  commandExecution: OPEN_CODE_SESSION_CAPABILITIES.commandExecution,
  rename: OPEN_CODE_SESSION_CAPABILITIES.rename,
  archive: OPEN_CODE_SESSION_CAPABILITIES.archive,
  remove: OPEN_CODE_SESSION_CAPABILITIES.remove,
  fork: OPEN_CODE_SESSION_CAPABILITIES.fork,
});

export type ComposerCommand = {
  readonly name: string;
  readonly description: string;
  readonly agent: string | null;
  readonly model: string | null;
  readonly template: string;
  readonly subtask: boolean;
  // Skills carry their SKILL.md path so the composer can send a `[name][path]` pointer instead of
  // expanding the whole body into the message. Plain commands leave this null and keep templates.
  readonly location: string | null;
};

export type PromptComposerFile = {
  readonly path: string;
  readonly filename?: string;
  readonly mime?: string;
  // OpenCode's canonical prompt-source range identifies an inline file mention. It remains a file
  // part for the model, but composer presentation keeps it out of physical attachment chrome.
  readonly source?: {
    readonly text: string;
    readonly start: number;
    readonly end: number;
  };
  // Composer-only presentation metadata. The OpenCode boundary deliberately drops it in
  // promptFilesFromPaths; it lets in-memory drafts and queued edits restore chat/branch context as
  // inline Lexical tokens instead of repainting them as physical attachments.
  readonly context?: {
    readonly kind: "branch" | "chat";
    readonly sourceKey: string;
  };
};

export type WorkbenchChange = {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly status: "added" | "deleted" | "modified";
};

export type WorkbenchDiffHunk = {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
};

export type WorkbenchFileNode = {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "directory";
  readonly ignored?: boolean;
};

export type AppProviderAuthPrompt = OpenCodeProviderAuthPrompt;
export type AppProviderAuthMethod = OpenCodeProviderAuthMethod;
export type AppProvider = OpenCodeProvider;
export type ProviderInventory = OpenCodeProviderInventory;

export type ThreadViewState = AppSessionState & {
  readonly attachedDirectories: readonly string[];
  readonly activity: AppSessionActivity;
};

export type AppSessionStatus = "idle" | "running" | "failed";
export type AppSessionActivity = "busy" | "retry" | "idle";

export type AppSessionSummary = {
  readonly id: string;
  readonly server: OpenCodeServerKey;
  readonly agent: string | null;
  readonly model: OpenCodeModelRef | null;
  readonly title: string;
  readonly status: AppSessionStatus;
  readonly needsAttention: boolean;
  readonly archivedAt: string | null;
  readonly updatedAt: string;
  readonly revertMessageId: string | null;
  readonly projectId: string | null;
  readonly projectDirectory: string;
  readonly location: OpenCodeLocationRef;
  readonly worktree: {
    readonly path: string;
    readonly branch: string | null;
  } | null;
  readonly parentSessionId: string | null;
};

export type AppChildSessionSummary = AppSessionSummary & {
  readonly parentSessionId: string;
};

type AppSessionProjections = {
  /** Complete server-qualified inventory, including roots and children. */
  readonly sessions: readonly AppSessionSummary[];
  /** Root sessions with descendant activity, attention, and update time folded in. */
  readonly rootSessions: readonly AppSessionSummary[];
  /** Every child session; callers resolve task ownership from transcript evidence. */
  readonly childSessions: readonly AppChildSessionSummary[];
};

export type AppSessionState = {
  readonly summary: AppSessionSummary;
  readonly cwd: string;
  readonly messages: readonly Message[];
  readonly parts: readonly Part[];
  readonly transcriptSources: OpenCodeSessionTranscriptSources;
  readonly permissions: readonly OpenCodePermissionRequest[];
  readonly questions: readonly OpenCodeQuestionRequest[];
};

export function appSessionStatusFromActivity(activity: AppSessionActivity): AppSessionStatus {
  return activity === "busy" || activity === "retry" ? "running" : "idle";
}

function sessionIdentityKey(server: OpenCodeServerKey, sessionID: string): string {
  return JSON.stringify([server, sessionID]);
}

function compareSessionUpdatedAt(
  left: Pick<AppSessionSummary, "updatedAt">,
  right: Pick<AppSessionSummary, "updatedAt">,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function combinedSessionStatus(
  current: AppSessionStatus,
  next: AppSessionStatus,
): AppSessionStatus {
  if (current === "running" || next === "running") return "running";
  if (current === "failed" || next === "failed") return "failed";
  return "idle";
}

/**
 * Splits a complete inventory without dropping child sessions. Root summaries
 * fold in descendant state because a background child is still work owned by
 * its parent conversation. Child ownership is resolved later from task-call
 * transcript evidence; inventory parentage alone cannot distinguish a paired
 * agent from another child-session feature.
 */
export function projectSessionSummaries(
  sessions: readonly AppSessionSummary[],
): AppSessionProjections {
  const childrenByParent = new Map<string, AppSessionSummary[]>();
  for (const session of sessions) {
    if (session.parentSessionId === null) continue;
    const key = sessionIdentityKey(session.server, session.parentSessionId);
    const children = childrenByParent.get(key) ?? [];
    children.push(session);
    childrenByParent.set(key, children);
  }

  const projectedRoots = new Map<string, AppSessionSummary>();
  for (const root of sessions) {
    if (root.parentSessionId !== null) continue;
    let status = root.status;
    let needsAttention = root.needsAttention;
    let updatedAt = root.updatedAt;
    const visited = new Set<string>([sessionIdentityKey(root.server, root.id)]);
    const pending = [root.id];

    while (pending.length > 0) {
      const parentID = pending.pop();
      if (parentID === undefined) continue;
      for (const child of childrenByParent.get(sessionIdentityKey(root.server, parentID)) ?? []) {
        const childKey = sessionIdentityKey(child.server, child.id);
        if (visited.has(childKey)) continue;
        visited.add(childKey);
        pending.push(child.id);
        status = combinedSessionStatus(status, child.status);
        needsAttention ||= child.needsAttention;
        if (child.updatedAt > updatedAt) updatedAt = child.updatedAt;
      }
    }

    projectedRoots.set(
      sessionIdentityKey(root.server, root.id),
      status === root.status &&
        needsAttention === root.needsAttention &&
        updatedAt === root.updatedAt
        ? root
        : Object.freeze({ ...root, status, needsAttention, updatedAt }),
    );
  }

  const projectedSessions = sessions
    .map((session) => projectedRoots.get(sessionIdentityKey(session.server, session.id)) ?? session)
    .sort(compareSessionUpdatedAt);
  const rootSessions = projectedSessions.filter((session) => session.parentSessionId === null);
  const childSessions = projectedSessions.filter(
    (session): session is AppSessionSummary & { readonly parentSessionId: string } =>
      session.parentSessionId !== null,
  );

  return Object.freeze({
    sessions: Object.freeze(projectedSessions),
    rootSessions: Object.freeze(rootSessions),
    childSessions: Object.freeze(childSessions),
  });
}

export async function readProviderInventory(client: OpenCodeClient): Promise<ProviderInventory> {
  return client.providers.list();
}

export function promptFilesFromPaths(
  files: readonly PromptComposerFile[],
): OpenCodePromptFileAttachment[] {
  return files.map((file) => ({
    uri: file.path,
    ...(file.filename !== undefined ? { name: file.filename } : {}),
    ...(file.mime !== undefined ? { description: file.mime } : {}),
    ...(file.source !== undefined ? { source: file.source } : {}),
  }));
}

export async function interruptSession(client: OpenCodeClient, sessionID: string): Promise<void> {
  await client.sessions.interrupt(openCodeSessionRef(client.server.key, sessionID));
}

export async function revertSessionFromMessage(
  client: OpenCodeClient,
  sessionID: string,
  messageID: string,
): Promise<void> {
  const ref = openCodeSessionRef(client.server.key, sessionID);
  await client.sessions.revert(ref, { messageID });
}

export async function restoreSessionRevert(
  client: OpenCodeClient,
  sessionID: string,
): Promise<void> {
  await client.sessions.unrevert(openCodeSessionRef(client.server.key, sessionID));
}

export async function replySessionPermission(
  client: OpenCodeClient,
  sessionID: string,
  requestID: string,
  reply: OpenCodePermissionReply,
): Promise<void> {
  await client.sessions.replyPermission(
    openCodeSessionRef(client.server.key, sessionID),
    requestID,
    reply,
  );
}

export async function replySessionQuestion(
  client: OpenCodeClient,
  sessionID: string,
  requestID: string,
  reply: OpenCodeQuestionReply,
): Promise<void> {
  await client.sessions.replyQuestion(
    openCodeSessionRef(client.server.key, sessionID),
    requestID,
    reply,
  );
}

export async function rejectSessionQuestion(
  client: OpenCodeClient,
  sessionID: string,
  requestID: string,
): Promise<void> {
  await client.sessions.rejectQuestion(openCodeSessionRef(client.server.key, sessionID), requestID);
}

export function gatedCapabilityError(feature: string): Error {
  return new Error(`${feature} is not available from this OpenCode host.`);
}

export function appSessionSummary(
  info: OpenCodeSessionInfo,
  server: OpenCodeServerKey,
  status: AppSessionStatus,
  needsAttention: boolean,
  projectDirectory: string = info.location.directory,
): AppSessionSummary {
  return Object.freeze({
    id: info.id,
    server,
    agent: info.agent ?? null,
    model: info.model ?? null,
    title: info.title,
    status,
    needsAttention,
    archivedAt:
      info.time.archived === undefined ? null : new Date(info.time.archived).toISOString(),
    updatedAt: new Date(info.time.updated).toISOString(),
    revertMessageId: info.revert?.messageID ?? null,
    projectId: info.projectID.length > 0 ? info.projectID : null,
    projectDirectory,
    location: openCodeLocationRef(info.location),
    worktree: {
      path: info.location.directory,
      branch: null,
    },
    parentSessionId:
      info.parentID === undefined || info.parentID.length === 0 ? null : info.parentID,
  });
}

export function appSessionState(input: {
  readonly transcript: OpenCodeSessionTranscript;
  readonly server: OpenCodeServerKey;
  readonly status: AppSessionStatus;
  readonly permissions: readonly OpenCodePermissionRequest[];
  readonly questions: readonly OpenCodeQuestionRequest[];
  readonly projectDirectory?: string;
}): AppSessionState {
  const { transcript } = input;
  return Object.freeze({
    summary: appSessionSummary(
      transcript.info,
      input.server,
      input.status,
      input.permissions.length > 0 || input.questions.length > 0,
      input.projectDirectory,
    ),
    cwd: transcript.info.location.directory,
    messages: transcript.messages,
    parts: transcript.parts,
    transcriptSources: transcript.sources,
    permissions: Object.freeze([...input.permissions]),
    questions: Object.freeze([...input.questions]),
  });
}
