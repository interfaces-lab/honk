import {
  resolveOpenCodeProjectDirectories,
  type OpenCodeClient,
  type OpenCodeEvent,
  type OpenCodeServerKey,
  type OpenCodeSessionInfo,
  type OpenCodeSessionRef,
  type Part,
} from "@honk/opencode";

import {
  appSessionState,
  appSessionStatusFromActivity,
  type AppSessionState,
  type AppSessionSummary,
} from "./open-code-view";

export type WatchStatus = "live" | "reconnecting" | "closed" | "unauthorized";
export type AdapterWatchStatus = "connecting" | WatchStatus;
export type SessionActivity = "busy" | "retry" | "idle";

export type SessionWatchState = {
  readonly app: AppSessionState;
  readonly attachedDirectories: readonly string[];
  readonly activity: SessionActivity;
  readonly needsAttention: boolean;
};

export type SessionWatchSnapshot = {
  readonly state: SessionWatchState | null;
  readonly status: AdapterWatchStatus;
};

export type SessionActivityTransition = {
  readonly activity: SessionActivity;
  readonly requests: "refresh" | "unchanged";
};

export type SessionWatchContext = {
  readonly client: OpenCodeClient;
  readonly server: OpenCodeServerKey;
  readonly eventStatus: AdapterWatchStatus;
  readonly projectDirectories: Map<string, string>;
  readonly sessionInfos: Map<string, OpenCodeSessionInfo>;
  readonly signalSeqBySession: Map<string, number>;
  signalSeq: number;
};

type SessionMetadata = Pick<AppSessionSummary, "title" | "agent" | "model" | "updatedAt">;

export type SessionEntry = {
  readonly ref: OpenCodeSessionRef;
  refCount: number;
  info: OpenCodeSessionInfo | null;
  fetchSeq: number;
  fetchPromise: Promise<void> | null;
  refetchAfterFetch: boolean;
  teardownTimer: ReturnType<typeof setTimeout> | null;
  requestSeq: number;
  readonly liveDeltas: Map<
    string,
    { readonly kind: "text" | "tool-input"; readonly value: string }
  >;
  transcriptEventSeq: number;
  readonly transcriptEvents: Array<{
    readonly sequence: number;
    readonly event: OpenCodePersistedTranscriptEvent;
  }>;
  snapshot: SessionWatchSnapshot;
  readonly listeners: Set<() => void>;
};

type OpenCodePersistedTranscriptEvent = Extract<
  OpenCodeEvent,
  {
    readonly type:
      | "message.updated"
      | "message.removed"
      | "message.part.updated"
      | "message.part.removed"
      | "message.part.delta";
  }
>;

export const INITIAL_SESSION_SNAPSHOT: SessionWatchSnapshot = Object.freeze({
  state: null,
  status: "connecting",
});

export function sessionActivityTransition(input: {
  readonly activity: SessionActivity;
  readonly needsAttention: boolean;
}): SessionActivityTransition {
  return Object.freeze({
    activity: input.activity,
    requests: input.activity === "idle" && input.needsAttention ? "refresh" : "unchanged",
  });
}

export function projectSessionSummaryMetadata(
  summary: AppSessionSummary,
  info: OpenCodeSessionInfo,
): AppSessionSummary {
  const metadata: SessionMetadata = Object.freeze({
    title: info.title,
    agent: info.agent ?? null,
    model: info.model ?? null,
    updatedAt: new Date(info.time.updated).toISOString(),
  });
  if (
    summary.title === metadata.title &&
    summary.agent === metadata.agent &&
    summary.model?.providerID === metadata.model?.providerID &&
    summary.model?.id === metadata.model?.id &&
    summary.model?.variant === metadata.model?.variant &&
    summary.updatedAt === metadata.updatedAt
  ) {
    return summary;
  }
  return Object.freeze({ ...summary, ...metadata });
}

export function createSessionWatchController<Context extends SessionWatchContext>(input: {
  readonly getContext: (server: OpenCodeServerKey) => Context | undefined;
  readonly getEntry: (ref: OpenCodeSessionRef) => SessionEntry | undefined;
  readonly getEntryBySession: (context: Context, sessionID: string) => SessionEntry | undefined;
  readonly activityOf: (context: Context, sessionID: string) => SessionActivity;
  readonly attentionOf: (context: Context, sessionID: string) => boolean;
  readonly replaceAttention: (
    context: Context,
    sessionID: string,
    requestIDs: readonly string[],
  ) => void;
  readonly noteActivity: (context: Context, sessionID: string, activity: SessionActivity) => void;
  readonly publishDerived: (context: Context) => void;
  readonly notify: (listeners: ReadonlySet<() => void>) => void;
}) {
  function publish(entry: SessionEntry, next: SessionWatchSnapshot): void {
    if (entry.snapshot.state === next.state && entry.snapshot.status === next.status) return;
    entry.snapshot = Object.freeze(next);
    input.notify(entry.listeners);
  }

  function updateApp(
    context: Context,
    sessionID: string,
    update: (app: AppSessionState) => AppSessionState | null,
  ): boolean {
    const entry = input.getEntryBySession(context, sessionID);
    const state = entry?.snapshot.state;
    if (entry === undefined || state === null || state === undefined) return false;
    const app = update(state.app);
    if (app === null) return false;
    publish(entry, {
      state: Object.freeze({ ...state, app }),
      status: entry.snapshot.status,
    });
    return true;
  }

  function applySessionInfo(context: Context, info: OpenCodeSessionInfo): void {
    const entry = input.getEntryBySession(context, info.id);
    if (entry === undefined || entry.snapshot.state === null) return;
    entry.info = info;
    updateApp(context, info.id, (app) => {
      const summary = projectSessionSummaryMetadata(app.summary, info);
      return summary === app.summary ? null : Object.freeze({ ...app, summary });
    });
  }

  function appendLiveDelta(part: Part, kind: "text" | "tool-input", delta: string): Part | null {
    if (kind === "text" && (part.type === "text" || part.type === "reasoning")) {
      return Object.freeze({ ...part, text: part.text + delta });
    }
    if (kind === "tool-input" && part.type === "tool" && part.state.status === "pending") {
      return Object.freeze({
        ...part,
        state: Object.freeze({ ...part.state, raw: part.state.raw + delta }),
      });
    }
    return null;
  }

  function mergeLiveValue(canonical: string, overlay: string): string {
    if (canonical.startsWith(overlay)) return canonical;
    if (overlay.startsWith(canonical)) return overlay;
    if (canonical.endsWith(overlay)) return canonical;
    // KMP keeps reconciliation linear even for long reasoning streams.
    const prefix = new Uint32Array(overlay.length);
    for (let index = 1; index < overlay.length; index += 1) {
      let length = prefix[index - 1] ?? 0;
      while (length > 0 && overlay[index] !== overlay[length]) length = prefix[length - 1] ?? 0;
      if (overlay[index] === overlay[length]) length += 1;
      prefix[index] = length;
    }
    let overlap = 0;
    const suffix = canonical.slice(-overlay.length);
    for (let index = 0; index < suffix.length; index += 1) {
      while (overlap > 0 && suffix[index] !== overlay[overlap]) {
        overlap = prefix[overlap - 1] ?? 0;
      }
      if (suffix[index] === overlay[overlap]) overlap += 1;
      if (overlap === overlay.length && index < suffix.length - 1) {
        overlap = prefix[overlap - 1] ?? 0;
      }
    }
    return canonical + overlay.slice(overlap);
  }

  function mergeLivePart(canonical: Part, overlay: Part): Part {
    if (
      (canonical.type === "text" || canonical.type === "reasoning") &&
      overlay.type === canonical.type
    ) {
      return Object.freeze({ ...canonical, text: mergeLiveValue(canonical.text, overlay.text) });
    }
    if (canonical.type === "tool" && overlay.type === "tool") {
      const canonicalRank =
        canonical.state.status === "pending" ? 0 : canonical.state.status === "running" ? 1 : 2;
      const overlayRank =
        overlay.state.status === "pending" ? 0 : overlay.state.status === "running" ? 1 : 2;
      if (overlayRank > canonicalRank) return overlay;
      if (
        overlayRank === canonicalRank &&
        overlayRank === 2 &&
        overlay.state.status !== "pending" &&
        overlay.state.status !== "running" &&
        canonical.state.status !== "pending" &&
        canonical.state.status !== "running" &&
        overlay.state.time.end > canonical.state.time.end
      ) {
        return overlay;
      }
      if (canonical.state.status !== "pending" || overlay.state.status !== "pending") {
        return canonical;
      }
      return Object.freeze({
        ...canonical,
        state: Object.freeze({
          ...canonical.state,
          raw: mergeLiveValue(canonical.state.raw, overlay.state.raw),
        }),
      });
    }
    return canonical;
  }

  function bufferedLivePart(
    part: Part,
    buffered: { readonly kind: "text" | "tool-input"; readonly value: string },
  ): Part | null {
    if (buffered.kind === "text" && (part.type === "text" || part.type === "reasoning")) {
      return Object.freeze({ ...part, text: buffered.value });
    }
    if (buffered.kind === "tool-input" && part.type === "tool" && part.state.status === "pending") {
      return Object.freeze({
        ...part,
        state: Object.freeze({ ...part.state, raw: buffered.value }),
      });
    }
    return null;
  }

  function applyBufferedLiveDeltas(
    entry: SessionEntry,
    parts: readonly Part[],
    current: readonly Part[] = [],
  ): readonly Part[] {
    const currentByID = new Map(current.map((part) => [part.id, part]));
    return Object.freeze(
      parts.map((part) => {
        const buffered = entry.liveDeltas.get(part.id);
        if (buffered === undefined) return part;
        const overlay = currentByID.get(part.id) ?? bufferedLivePart(part, buffered);
        return overlay === null || overlay === undefined ? part : mergeLivePart(part, overlay);
      }),
    );
  }

  function applyPersistedTranscriptEvent(
    context: Context,
    entry: SessionEntry,
    event: OpenCodePersistedTranscriptEvent,
  ): void {
    if (event.type === "message.part.delta") {
      if (event.data.field !== "text") return;
      const buffered = entry.liveDeltas.get(event.data.partID);
      entry.liveDeltas.set(event.data.partID, {
        kind: "text",
        value: buffered?.kind === "text" ? buffered.value + event.data.delta : event.data.delta,
      });
    }
    if (event.type === "message.removed") {
      for (const part of entry.snapshot.state?.app.parts ?? []) {
        if (part.messageID !== event.data.messageID) continue;
        entry.liveDeltas.delete(part.id);
      }
    }
    if (event.type === "message.part.removed") {
      entry.liveDeltas.delete(event.data.partID);
    }

    updateApp(context, event.data.sessionID, (app) => {
      if (event.type === "message.updated") {
        const index = app.messages.findIndex((message) => message.id === event.data.info.id);
        const messages =
          index === -1
            ? [...app.messages, event.data.info]
            : app.messages.map((message, messageIndex) =>
                messageIndex === index ? event.data.info : message,
              );
        messages.sort(
          (left, right) =>
            left.time.created - right.time.created || left.id.localeCompare(right.id),
        );
        const messageOrder = new Map(
          messages.map((message, messageIndex) => [message.id, messageIndex]),
        );
        const parts = [...app.parts];
        parts.sort(
          (left, right) =>
            (messageOrder.get(left.messageID) ?? Number.MAX_SAFE_INTEGER) -
            (messageOrder.get(right.messageID) ?? Number.MAX_SAFE_INTEGER),
        );
        return Object.freeze({
          ...app,
          messages: Object.freeze(messages),
          parts: Object.freeze(parts),
          // Streamed appends land from the persisted plane; keep the source
          // counters consistent with the rendered transcript instead of
          // pinned to the last full fetch.
          ...(index === -1
            ? {
                transcriptSources: Object.freeze({
                  ...app.transcriptSources,
                  persistedMessages: app.transcriptSources.persistedMessages + 1,
                }),
              }
            : {}),
        });
      }
      if (event.type === "message.removed") {
        return Object.freeze({
          ...app,
          messages: Object.freeze(
            app.messages.filter((message) => message.id !== event.data.messageID),
          ),
          parts: Object.freeze(app.parts.filter((part) => part.messageID !== event.data.messageID)),
        });
      }
      if (event.type === "message.part.updated") {
        const index = app.parts.findIndex((part) => part.id === event.data.part.id);
        const current = index === -1 ? undefined : app.parts[index];
        const buffered = entry.liveDeltas.get(event.data.part.id);
        entry.liveDeltas.delete(event.data.part.id);
        const overlay =
          current ??
          (buffered === undefined ? undefined : bufferedLivePart(event.data.part, buffered));
        const part =
          overlay === null || overlay === undefined
            ? event.data.part
            : mergeLivePart(event.data.part, overlay);
        const parts =
          index === -1
            ? [...app.parts, part]
            : app.parts.map((currentPart, partIndex) => (partIndex === index ? part : currentPart));
        const messageOrder = new Map(
          app.messages.map((message, messageIndex) => [message.id, messageIndex]),
        );
        parts.sort(
          (left, right) =>
            (messageOrder.get(left.messageID) ?? Number.MAX_SAFE_INTEGER) -
            (messageOrder.get(right.messageID) ?? Number.MAX_SAFE_INTEGER),
        );
        return Object.freeze({
          ...app,
          parts: Object.freeze(parts),
        });
      }
      if (event.type === "message.part.removed") {
        return Object.freeze({
          ...app,
          parts: Object.freeze(app.parts.filter((part) => part.id !== event.data.partID)),
        });
      }
      const index = app.parts.findIndex((part) => part.id === event.data.partID);
      const current = index === -1 ? undefined : app.parts[index];
      if (current === undefined) return null;
      const part = appendLiveDelta(current, "text", event.data.delta);
      if (part === null) return null;
      return Object.freeze({
        ...app,
        parts: Object.freeze(
          app.parts.map((currentPart, partIndex) => (partIndex === index ? part : currentPart)),
        ),
      });
    });
  }

  function recordPersistedTranscriptEvent(context: Context, event: OpenCodeEvent): void {
    switch (event.type) {
      case "message.updated":
      case "message.removed":
      case "message.part.updated":
      case "message.part.removed":
      case "message.part.delta":
        break;
      default:
        return;
    }
    const entry = input.getEntryBySession(context, event.data.sessionID);
    if (entry === undefined) return;
    entry.transcriptEventSeq += 1;
    if (entry.fetchPromise !== null || entry.snapshot.state === null) {
      entry.transcriptEvents.push({ sequence: entry.transcriptEventSeq, event });
    }
    applyPersistedTranscriptEvent(context, entry, event);
  }

  function fetchSession(
    entry: SessionEntry,
    options?: { readonly queueIfFetching?: boolean },
  ): Promise<void> {
    if (entry.fetchPromise !== null) {
      if (options?.queueIfFetching === true) entry.refetchAfterFetch = true;
      return entry.fetchPromise;
    }

    const promise = performSessionFetch(entry).finally(() => {
      if (entry.fetchPromise !== promise) return;
      entry.fetchPromise = null;
      const shouldRefetch = entry.refetchAfterFetch;
      entry.refetchAfterFetch = false;
      if (shouldRefetch && entry.refCount > 0 && input.getEntry(entry.ref) === entry) {
        void fetchSession(entry);
      }
    });
    entry.fetchPromise = promise;
    return promise;
  }

  async function performSessionFetch(entry: SessionEntry): Promise<void> {
    const context = input.getContext(entry.ref.server);
    if (context === undefined) return;
    const seq = ++entry.fetchSeq;
    const signalSeq = context.signalSeq;
    const transcriptEventSeq = entry.transcriptEventSeq;
    try {
      const [transcript, permissions, questions] = await Promise.all([
        context.client.sessions.transcript(entry.ref),
        context.client.sessions.permissions(entry.ref).catch(() => []),
        context.client.sessions.questions(entry.ref).catch(() => []),
      ]);
      const info = transcript.info;
      const projectDirectory =
        context.projectDirectories.get(info.projectID) ??
        (await resolveOpenCodeProjectDirectories(context.client, [info])).get(info.projectID) ??
        info.location.directory;
      if (
        seq !== entry.fetchSeq ||
        input.getContext(entry.ref.server) !== context ||
        input.getEntry(entry.ref) !== entry
      ) {
        return;
      }
      entry.info = info;
      context.projectDirectories.set(info.projectID, projectDirectory);
      context.sessionInfos.set(info.id, info);
      if ((context.signalSeqBySession.get(info.id) ?? -1) < signalSeq) {
        input.replaceAttention(context, info.id, [
          ...permissions.map((request) => request.id),
          ...questions.map((request) => request.id),
        ]);
      }
      const activity = input.activityOf(context, entry.ref.sessionID);
      const needsAttention = input.attentionOf(context, entry.ref.sessionID);
      const app = appSessionState({
        transcript,
        server: context.server,
        status: appSessionStatusFromActivity(activity),
        permissions,
        questions,
        projectDirectory,
      });
      publish(entry, {
        state: Object.freeze({
          app: Object.freeze({
            ...app,
            parts: applyBufferedLiveDeltas(entry, app.parts, entry.snapshot.state?.app.parts),
          }),
          attachedDirectories: Object.freeze([]),
          activity,
          needsAttention,
        }),
        status:
          context.eventStatus === "unauthorized"
            ? "unauthorized"
            : context.eventStatus === "reconnecting" || context.eventStatus === "closed"
              ? "reconnecting"
              : "live",
      });
      const replay = entry.transcriptEvents.filter(
        (recorded) => recorded.sequence > transcriptEventSeq,
      );
      entry.transcriptEvents.splice(0, entry.transcriptEvents.length);
      for (const recorded of replay) {
        if (recorded.event.type === "message.part.delta") continue;
        applyPersistedTranscriptEvent(context, entry, recorded.event);
      }
      input.publishDerived(context);
    } catch (error) {
      if (
        seq !== entry.fetchSeq ||
        input.getContext(entry.ref.server) !== context ||
        input.getEntry(entry.ref) !== entry
      ) {
        return;
      }
      publish(entry, {
        state: entry.snapshot.state,
        status: isUnauthorized(error)
          ? "unauthorized"
          : entry.snapshot.state === null
            ? "connecting"
            : "reconnecting",
      });
    }
  }

  async function refreshRequests(entry: SessionEntry): Promise<void> {
    const context = input.getContext(entry.ref.server);
    if (context === undefined) return;
    const seq = ++entry.requestSeq;
    const current = entry.snapshot.state;
    const [permissions, questions] = await Promise.all([
      context.client.sessions.permissions(entry.ref).catch(() => current?.app.permissions ?? []),
      context.client.sessions.questions(entry.ref).catch(() => current?.app.questions ?? []),
    ]);
    if (
      seq !== entry.requestSeq ||
      input.getContext(entry.ref.server) !== context ||
      input.getEntry(entry.ref) !== entry
    ) {
      return;
    }
    input.replaceAttention(context, entry.ref.sessionID, [
      ...permissions.map((request) => request.id),
      ...questions.map((request) => request.id),
    ]);
    const needsAttention = input.attentionOf(context, entry.ref.sessionID);
    const state = entry.snapshot.state;
    if (state !== null) {
      publish(entry, {
        state: Object.freeze({
          ...state,
          app: Object.freeze({
            ...state.app,
            summary: Object.freeze({ ...state.app.summary, needsAttention }),
            permissions: Object.freeze(permissions),
            questions: Object.freeze(questions),
          }),
          needsAttention,
        }),
        status: entry.snapshot.status,
      });
    }
    input.publishDerived(context);
  }

  function applyActivity(
    context: Context,
    sessionID: string,
    activity: SessionActivity,
  ): Promise<void> | undefined {
    const entry = input.getEntryBySession(context, sessionID);
    const transition = sessionActivityTransition({
      activity,
      needsAttention: entry?.snapshot.state?.needsAttention === true,
    });
    input.noteActivity(context, sessionID, transition.activity);
    if (transition.requests === "unchanged" || entry === undefined) return;
    return refreshRequests(entry);
  }

  function createEntry(ref: OpenCodeSessionRef): SessionEntry {
    return {
      ref,
      refCount: 0,
      info: null,
      fetchSeq: 0,
      fetchPromise: null,
      refetchAfterFetch: false,
      teardownTimer: null,
      requestSeq: 0,
      liveDeltas: new Map(),
      transcriptEventSeq: 0,
      transcriptEvents: [],
      snapshot: INITIAL_SESSION_SNAPSHOT,
      listeners: new Set(),
    };
  }

  function close(entry: SessionEntry): void {
    dispose(entry);
    publish(entry, { state: entry.snapshot.state, status: "closed" });
  }

  function markUnavailable(entry: SessionEntry, status: "reconnecting" | "unauthorized"): void {
    entry.fetchSeq += 1;
    entry.refetchAfterFetch = false;
    entry.requestSeq += 1;
    entry.liveDeltas.clear();
    entry.transcriptEvents.splice(0, entry.transcriptEvents.length);
    publish(entry, { state: entry.snapshot.state, status });
  }

  function dispose(entry: SessionEntry): void {
    entry.fetchSeq += 1;
    entry.fetchPromise = null;
    entry.refetchAfterFetch = false;
    entry.requestSeq += 1;
    entry.liveDeltas.clear();
    entry.transcriptEvents.splice(0, entry.transcriptEvents.length);
  }

  return Object.freeze({
    applyActivity,
    applySessionInfo,
    close,
    createEntry,
    dispose,
    markUnavailable,
    publish,
    recordPersistedTranscriptEvent,
    refresh: (entry: SessionEntry) => fetchSession(entry, { queueIfFetching: true }),
    refreshRequests,
  });
}

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = Reflect.get(error, "status") ?? Reflect.get(error, "statusCode");
  return status === 401 || status === 403;
}
