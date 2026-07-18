import {
  openCodeSessionKey,
  projectOpenCodeTranscriptMessage,
  resolveOpenCodeProjectDirectories,
  type OpenCodeClient,
  type OpenCodeDurableSessionEvent,
  type OpenCodeServerKey,
  type OpenCodeSessionInfo,
  type OpenCodeSessionRef,
  type Part,
} from "@honk/opencode";

import {
  appSessionState,
  appSessionStatusFromActivity,
  type AppSessionState,
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

export type SessionWatchContext = {
  readonly client: OpenCodeClient;
  readonly server: OpenCodeServerKey;
  readonly projectDirectories: Map<string, string>;
  readonly sessionInfos: Map<string, OpenCodeSessionInfo>;
  readonly signalSeqBySession: Map<string, number>;
  signalSeq: number;
};

export type SessionEntry = {
  readonly ref: OpenCodeSessionRef;
  refCount: number;
  info: OpenCodeSessionInfo | null;
  fetchSeq: number;
  fetchPromise: Promise<void> | null;
  refetchAfterFetch: boolean;
  teardownTimer: ReturnType<typeof setTimeout> | null;
  requestSeq: number;
  eventCursor: number | null;
  eventCursorInitialized: boolean;
  eventSnapshotReady: boolean;
  eventGeneration: number;
  eventRunning: boolean;
  eventClosed: boolean;
  eventController: AbortController | null;
  readonly liveDeltas: Map<
    string,
    { readonly kind: "text" | "tool-input"; readonly value: string }
  >;
  readonly settledParts: Map<string, number>;
  snapshot: SessionWatchSnapshot;
  readonly listeners: Set<() => void>;
};

const SESSION_HISTORY_LIMIT = 100;
const PUMP_RECONNECT_BASE_MS = 250;
const PUMP_RECONNECT_CEILING_MS = 10_000;

export const INITIAL_SESSION_SNAPSHOT: SessionWatchSnapshot = Object.freeze({
  state: null,
  status: "connecting",
});

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
  readonly noteBusy: (context: Context, sessionID: string) => void;
  readonly publishDerived: (context: Context) => void;
}) {
  const retainedCursors = new Map<string, number | null>();

  function publish(entry: SessionEntry, next: SessionWatchSnapshot): void {
    if (entry.snapshot.state === next.state && entry.snapshot.status === next.status) return;
    entry.snapshot = Object.freeze(next);
    for (const listener of entry.listeners) listener();
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
    if (
      canonical.type === "tool" &&
      canonical.state.status === "pending" &&
      overlay.type === "tool" &&
      overlay.state.status === "pending"
    ) {
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

  function recordLiveDelta(
    context: Context,
    event: {
      readonly sessionID: string;
      readonly partID: string;
      readonly kind: "text" | "tool-input";
      readonly delta: string;
      readonly timestamp: number;
    },
  ): void {
    const entry = input.getEntryBySession(context, event.sessionID);
    if (entry === undefined || (entry.settledParts.get(event.partID) ?? -1) >= event.timestamp)
      return;
    const buffered = entry.liveDeltas.get(event.partID);
    entry.liveDeltas.set(event.partID, {
      kind: event.kind,
      value: buffered?.kind === event.kind ? buffered.value + event.delta : event.delta,
    });
    updateApp(context, event.sessionID, (app) => {
      const index = app.parts.findIndex((part) => part.id === event.partID);
      const part = index === -1 ? undefined : app.parts[index];
      const next = part === undefined ? null : appendLiveDelta(part, event.kind, event.delta);
      if (next === null) return null;
      return Object.freeze({
        ...app,
        parts: Object.freeze(
          app.parts.map((current, currentIndex) => (currentIndex === index ? next : current)),
        ),
      });
    });
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
      entry.eventSnapshotReady = true;
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
        status: "live",
      });
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
        status: isUnauthorized(error) ? "unauthorized" : "reconnecting",
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

  function durableEventSequence(entry: SessionEntry, event: OpenCodeDurableSessionEvent): number {
    const sequence = event.durable?.seq;
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error(`Durable session event ${event.type} has an invalid aggregate sequence.`);
    }
    if (
      event.data.sessionID !== entry.ref.sessionID ||
      event.durable?.aggregateID !== entry.ref.sessionID
    ) {
      throw new Error(`Durable session event ${event.type} belongs to another session.`);
    }
    return sequence;
  }

  function durableEventMessageID(event: OpenCodeDurableSessionEvent): string | null {
    switch (event.type) {
      case "session.next.prompted":
        return event.data.messageID;
      case "session.next.step.started":
      case "session.next.step.ended":
      case "session.next.step.failed":
      case "session.next.text.started":
      case "session.next.text.ended":
      case "session.next.reasoning.started":
      case "session.next.reasoning.ended":
      case "session.next.tool.input.started":
      case "session.next.tool.input.ended":
      case "session.next.tool.called":
      case "session.next.tool.progress":
      case "session.next.tool.success":
      case "session.next.tool.failed":
        return event.data.assistantMessageID;
      case "session.next.compaction.ended":
        return event.data.messageID;
      default:
        return null;
    }
  }

  function settleDurableEventPart(entry: SessionEntry, event: OpenCodeDurableSessionEvent): void {
    const part =
      event.type === "session.next.text.ended"
        ? event.data.textID
        : event.type === "session.next.reasoning.ended"
          ? event.data.reasoningID
          : event.type === "session.next.tool.input.ended"
            ? event.data.callID
            : null;
    if (part === null) return;
    entry.liveDeltas.delete(part);
    entry.settledParts.set(part, event.data.timestamp);
  }

  async function reconcileDurableEvent(
    context: Context,
    entry: SessionEntry,
    event: OpenCodeDurableSessionEvent,
    generation: number,
  ): Promise<void> {
    settleDurableEventPart(entry, event);
    if (
      event.type === "session.next.prompted" ||
      event.type === "session.next.step.started" ||
      event.type === "session.next.retried"
    ) {
      input.noteBusy(context, entry.ref.sessionID);
    }
    if (
      event.type === "session.next.agent.switched" ||
      event.type === "session.next.model.switched" ||
      event.type === "session.next.moved" ||
      event.type === "session.next.revert.committed"
    ) {
      if (event.type === "session.next.revert.committed") {
        entry.liveDeltas.clear();
        entry.settledParts.clear();
      }
      await fetchSession(entry, { queueIfFetching: true });
      if (entry.snapshot.status !== "live") throw new Error("Session reconciliation failed.");
      return;
    }
    const messageID = durableEventMessageID(event);
    if (messageID === null) return;
    const source = await context.client.sessions.message(entry.ref, messageID);
    if (
      generation !== entry.eventGeneration ||
      input.getContext(entry.ref.server) !== context ||
      input.getEntry(entry.ref) !== entry
    ) {
      return;
    }
    const info = entry.info;
    const state = entry.snapshot.state;
    if (info === null || state === null) throw new Error("Session snapshot is not initialized.");
    const existing = state.app.messages.find(
      (message) => message.id === messageID && message.role === "assistant",
    );
    const parentID =
      existing?.role === "assistant"
        ? existing.parentID
        : (state.app.messages.findLast(
            (message) => message.role === "user" && message.time.created <= source.time.created,
          )?.id ?? "");
    const projection = projectOpenCodeTranscriptMessage(info, source, parentID);
    if (projection.messages.length === 0) return;
    updateApp(context, entry.ref.sessionID, (app) => {
      const messages = projection.messages.reduce<readonly (typeof app.messages)[number][]>(
        (current, message) => {
          const index = current.findIndex((entry) => entry.id === message.id);
          return index === -1
            ? Object.freeze([...current, message])
            : Object.freeze(
                current.map((entry, currentIndex) => (currentIndex === index ? message : entry)),
              );
        },
        app.messages,
      );
      const projectedMessageIDs = new Set(projection.messages.map((message) => message.id));
      const messageOrder = new Map(messages.map((message, index) => [message.id, index]));
      const parts = [
        ...app.parts.filter((part) => !projectedMessageIDs.has(part.messageID)),
        ...applyBufferedLiveDeltas(entry, projection.parts, app.parts),
      ].sort(
        (left, right) =>
          (messageOrder.get(left.messageID) ?? Number.MAX_SAFE_INTEGER) -
          (messageOrder.get(right.messageID) ?? Number.MAX_SAFE_INTEGER),
      );
      return Object.freeze({
        ...app,
        messages: Object.freeze(messages),
        parts: Object.freeze(parts),
      });
    });
  }

  async function latestDurableCursor(
    context: Context,
    entry: SessionEntry,
  ): Promise<number | null> {
    let after: number | undefined;
    let latest: number | null = null;
    let hasMore = true;
    while (hasMore) {
      const page = await context.client.sessions.history(entry.ref, {
        limit: SESSION_HISTORY_LIMIT,
        ...(after === undefined ? {} : { after }),
      });
      const sequences = page.data.map((event) => durableEventSequence(entry, event));
      if (sequences.some((sequence, index) => sequence <= (sequences[index - 1] ?? latest ?? -1))) {
        throw new Error("Durable session history is not strictly ordered.");
      }
      const next = sequences.at(-1);
      if (next !== undefined) {
        latest = next;
        after = next;
      }
      if (page.hasMore && next === undefined) {
        throw new Error("Durable session history reported another page without a cursor.");
      }
      hasMore = page.hasMore;
    }
    return latest;
  }

  function pumpIsCurrent(entry: SessionEntry, generation: number): boolean {
    return (
      generation === entry.eventGeneration &&
      !entry.eventClosed &&
      entry.refCount > 0 &&
      input.getEntry(entry.ref) === entry &&
      input.getContext(entry.ref.server) !== undefined
    );
  }

  function entryIsUnauthorized(entry: SessionEntry): boolean {
    return entry.snapshot.status === "unauthorized";
  }

  async function initializePump(
    context: Context,
    entry: SessionEntry,
    generation: number,
  ): Promise<boolean> {
    if (!entry.eventSnapshotReady) await fetchSession(entry);
    if (!pumpIsCurrent(entry, generation) || entryIsUnauthorized(entry)) return false;
    if (entry.info === null || entry.snapshot.state === null) {
      throw new Error("Session snapshot failed to load.");
    }
    if (entry.eventCursorInitialized) return true;
    const cursor = await latestDurableCursor(context, entry);
    if (!pumpIsCurrent(entry, generation)) return false;
    await fetchSession(entry);
    if (!pumpIsCurrent(entry, generation) || entryIsUnauthorized(entry)) return false;
    if (entry.snapshot.status !== "live")
      throw new Error("Session watermark reconciliation failed.");
    entry.eventCursor = cursor;
    entry.eventCursorInitialized = true;
    retainedCursors.set(openCodeSessionKey(entry.ref), cursor);
    return true;
  }

  async function runPump(entry: SessionEntry, generation: number): Promise<void> {
    let attempt = 0;
    while (pumpIsCurrent(entry, generation)) {
      const context = input.getContext(entry.ref.server);
      if (context === undefined) return;
      try {
        if (!(await initializePump(context, entry, generation))) return;
        const controller = new AbortController();
        entry.eventController = controller;
        for await (const event of context.client.sessions.events(
          entry.ref,
          entry.eventCursor === null ? undefined : { after: String(entry.eventCursor) },
          controller.signal,
        )) {
          if (!pumpIsCurrent(entry, generation)) return;
          const sequence = durableEventSequence(entry, event);
          if (entry.eventCursor !== null && sequence <= entry.eventCursor) continue;
          await reconcileDurableEvent(context, entry, event, generation);
          if (!pumpIsCurrent(entry, generation)) return;
          entry.eventCursor = sequence;
          retainedCursors.set(openCodeSessionKey(entry.ref), sequence);
          attempt = 0;
          publish(entry, { state: entry.snapshot.state, status: "live" });
        }
      } catch (error) {
        if (!pumpIsCurrent(entry, generation)) return;
        if (entryIsUnauthorized(entry)) return;
        if (isUnauthorized(error)) {
          publish(entry, { state: entry.snapshot.state, status: "unauthorized" });
          return;
        }
      } finally {
        entry.eventController = null;
      }
      if (!pumpIsCurrent(entry, generation)) return;
      publish(entry, { state: entry.snapshot.state, status: "reconnecting" });
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(PUMP_RECONNECT_BASE_MS * 2 ** Math.min(attempt, 6), PUMP_RECONNECT_CEILING_MS),
        ),
      );
      attempt += 1;
    }
  }

  function ensurePump(entry: SessionEntry): void {
    if (
      entry.eventRunning ||
      entry.eventClosed ||
      entry.refCount === 0 ||
      entryIsUnauthorized(entry) ||
      input.getContext(entry.ref.server) === undefined
    ) {
      return;
    }
    const generation = ++entry.eventGeneration;
    entry.eventRunning = true;
    void runPump(entry, generation).finally(() => {
      entry.eventRunning = false;
      if (
        entry.refCount > 0 &&
        !entryIsUnauthorized(entry) &&
        input.getContext(entry.ref.server) !== undefined
      ) {
        ensurePump(entry);
      }
    });
  }

  function stopPump(entry: SessionEntry): void {
    entry.eventGeneration += 1;
    entry.eventController?.abort();
    entry.eventController = null;
  }

  function createEntry(ref: OpenCodeSessionRef): SessionEntry {
    const key = openCodeSessionKey(ref);
    return {
      ref,
      refCount: 0,
      info: null,
      fetchSeq: 0,
      fetchPromise: null,
      refetchAfterFetch: false,
      teardownTimer: null,
      requestSeq: 0,
      eventCursor: retainedCursors.get(key) ?? null,
      eventCursorInitialized: retainedCursors.has(key),
      eventSnapshotReady: false,
      eventGeneration: 0,
      eventRunning: false,
      eventClosed: false,
      eventController: null,
      liveDeltas: new Map(),
      settledParts: new Map(),
      snapshot: INITIAL_SESSION_SNAPSHOT,
      listeners: new Set(),
    };
  }

  function close(entry: SessionEntry): void {
    entry.eventClosed = true;
    stopPump(entry);
    retainedCursors.delete(openCodeSessionKey(entry.ref));
    publish(entry, { state: entry.snapshot.state, status: "closed" });
  }

  function dispose(entry: SessionEntry): void {
    stopPump(entry);
    entry.fetchSeq += 1;
    entry.fetchPromise = null;
    entry.refetchAfterFetch = false;
    entry.requestSeq += 1;
    entry.eventSnapshotReady = false;
  }

  return Object.freeze({
    close,
    createEntry,
    dispose,
    ensurePump,
    publish,
    recordLiveDelta,
    refreshRequests,
    stopPump,
  });
}

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = Reflect.get(error, "status") ?? Reflect.get(error, "statusCode");
  return status === 401 || status === 403;
}
