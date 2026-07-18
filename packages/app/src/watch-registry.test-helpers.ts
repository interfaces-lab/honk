import {
  createOpenCodeServer,
  type OpenCodeClient,
  type OpenCodeDurableSessionEvent,
  type OpenCodeEvent,
  type OpenCodeServerDescriptor,
  type OpenCodeSessionInfo,
  type OpenCodeSessionMessage,
  type OpenCodeSessionTranscript,
} from "@honk/opencode";

export const local = createOpenCodeServer({
  origin: "http://127.0.0.1:4096",
  label: "This Mac",
  kind: "local",
});

export const cloud = createOpenCodeServer({
  origin: "https://cloud.example.test",
  label: "Cloud",
  kind: "cloud",
});

export function sessionInfo(
  id: string,
  title: string,
  directory: string,
  options?: {
    readonly agent?: string;
    readonly parentID?: string;
    readonly updated?: number;
  },
): OpenCodeSessionInfo {
  return {
    id,
    ...(options?.agent === undefined ? {} : { agent: options.agent }),
    ...(options?.parentID === undefined ? {} : { parentID: options.parentID }),
    projectID: `project-${id}`,
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: { created: 1, updated: options?.updated ?? 2 },
    title,
    location: { directory },
  };
}

export function createClient(input: {
  readonly server: OpenCodeServerDescriptor;
  readonly info: OpenCodeSessionInfo;
  readonly inventory?: readonly OpenCodeSessionInfo[];
  readonly activeSessionIDs?: readonly string[];
  readonly needsAttention?: boolean;
  readonly attentionRequestsFail?: boolean;
  readonly isActive?: boolean;
  readonly onAttentionRequest?: () => void;
  readonly events?: (signal?: AbortSignal) => AsyncIterable<OpenCodeEvent>;
  readonly history?: OpenCodeClient["sessions"]["history"];
  readonly sessionEvents?: OpenCodeClient["sessions"]["events"];
  readonly sessionMessage?: OpenCodeClient["sessions"]["message"];
  readonly transcript?: OpenCodeSessionTranscript;
  readonly onTranscript?: () => void;
  readonly transcriptGate?: Promise<void>;
  readonly onSessionList?: () => void;
  readonly sessionListGate?: Promise<void>;
  readonly onResolveLocation?: () => void;
  readonly resolvedProjectDirectory?: string;
  readonly healthFails?: boolean;
  readonly onHealth?: () => void;
  readonly onPump: () => void;
  readonly onSessionPump?: (after: string | undefined) => void;
}): OpenCodeClient {
  const inventory = input.inventory ?? [input.info];
  const activeSessionIDs = new Set(input.activeSessionIDs);
  if (input.isActive === true || input.needsAttention === true) {
    activeSessionIDs.add(input.info.id);
  }
  const waitForAbort = (signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal?.aborted === true) {
        resolve();
        return;
      }
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  const events =
    input.events ??
    ((signal?: AbortSignal): AsyncIterable<OpenCodeEvent> => ({
      async *[Symbol.asyncIterator]() {
        input.onPump();
        await waitForAbort(signal);
        yield* [] as OpenCodeEvent[];
      },
    }));
  return {
    server: input.server,
    health: async () => {
      input.onHealth?.();
      if (input.healthFails === true) throw new Error("health check failed");
    },
    resolveLocation: async (location: Parameters<OpenCodeClient["resolveLocation"]>[0]) => {
      input.onResolveLocation?.();
      const directory = location?.directory ?? input.info.location.directory;
      return {
        directory,
        project: {
          id: input.info.projectID,
          directory: input.resolvedProjectDirectory ?? directory,
        },
      };
    },
    requests: {
      permissions: async () => {
        input.onAttentionRequest?.();
        if (input.attentionRequestsFail === true) throw new Error("permission request failed");
        return {
          location: {
            directory: input.info.location.directory,
            project: { id: input.info.projectID, directory: input.info.location.directory },
          },
          data:
            input.needsAttention === true
              ? [
                  {
                    id: `permission-${input.info.id}`,
                    sessionID: input.info.id,
                    action: "read",
                    resources: [input.info.location.directory],
                  },
                ]
              : [],
        };
      },
      questions: async () => {
        input.onAttentionRequest?.();
        if (input.attentionRequestsFail === true) throw new Error("question request failed");
        return {
          location: {
            directory: input.info.location.directory,
            project: { id: input.info.projectID, directory: input.info.location.directory },
          },
          data: [],
        };
      },
    },
    sessions: {
      list: async () => {
        input.onSessionList?.();
        await input.sessionListGate;
        return { data: inventory, cursor: {} };
      },
      active: async () =>
        Object.fromEntries(
          [...activeSessionIDs].map((sessionID) => [sessionID, { type: "running" }]),
        ),
      get: async () => input.info,
      messages: async () => ({ data: [], cursor: {} }),
      history:
        input.history ??
        (async () => ({
          data: [],
          hasMore: false,
        })),
      events:
        input.sessionEvents ??
        ((_, eventInput, signal) => ({
          async *[Symbol.asyncIterator]() {
            input.onSessionPump?.(eventInput?.after);
            await waitForAbort(signal);
            yield* [] as OpenCodeDurableSessionEvent[];
          },
        })),
      message:
        input.sessionMessage ??
        (async (_, messageID) => {
          throw new Error(`Unexpected session message request: ${messageID}`);
        }),
      transcript: async () => {
        input.onTranscript?.();
        await input.transcriptGate;
        return (
          input.transcript ?? {
            info: input.info,
            messages: [],
            parts: [],
            sources: { persistedMessages: 0, projectedMessages: 0 },
          }
        );
      },
      permissions: async () => {
        if (input.attentionRequestsFail === true) throw new Error("permission request failed");
        return input.needsAttention === true
          ? [
              {
                id: `permission-${input.info.id}`,
                sessionID: input.info.id,
                action: "read",
                resources: [input.info.location.directory],
              },
            ]
          : [];
      },
      questions: async () => {
        if (input.attentionRequestsFail === true) throw new Error("question request failed");
        return [];
      },
    },
    events,
  } as unknown as OpenCodeClient;
}

export function createEventQueue(): {
  readonly push: (event: OpenCodeEvent) => void;
  readonly events: (signal?: AbortSignal) => AsyncIterable<OpenCodeEvent>;
} {
  // Fixtures are already normalized; raw global envelopes are covered at the client boundary.
  const queued: OpenCodeEvent[] = [];
  let resolveNext: ((event: OpenCodeEvent | null) => void) | null = null;

  return {
    push(event) {
      const resolve = resolveNext;
      if (resolve === null) {
        queued.push(event);
        return;
      }
      resolveNext = null;
      resolve(event);
    },
    events(signal) {
      return {
        async *[Symbol.asyncIterator]() {
          while (signal?.aborted !== true) {
            const next =
              queued.shift() ??
              (await new Promise<OpenCodeEvent | null>((resolve) => {
                resolveNext = resolve;
                signal?.addEventListener("abort", () => resolve(null), { once: true });
              }));
            if (next === null) return;
            yield next;
          }
        },
      };
    },
  };
}

export function createDurableEventQueue(): {
  readonly after: readonly (string | undefined)[];
  readonly push: (event: OpenCodeDurableSessionEvent) => void;
  readonly close: () => void;
  readonly events: OpenCodeClient["sessions"]["events"];
} {
  const after: (string | undefined)[] = [];
  const queued: OpenCodeDurableSessionEvent[] = [];
  let resolveNext: ((event: OpenCodeDurableSessionEvent | null) => void) | null = null;

  return {
    after,
    push(event) {
      const resolve = resolveNext;
      if (resolve === null) {
        queued.push(event);
        return;
      }
      resolveNext = null;
      resolve(event);
    },
    close() {
      const resolve = resolveNext;
      if (resolve === null) return;
      resolveNext = null;
      resolve(null);
    },
    events(_, input, signal) {
      return {
        async *[Symbol.asyncIterator]() {
          after.push(input?.after);
          while (signal?.aborted !== true) {
            const next =
              queued.shift() ??
              (await new Promise<OpenCodeDurableSessionEvent | null>((resolve) => {
                resolveNext = resolve;
                signal?.addEventListener("abort", () => resolve(null), { once: true });
              }));
            if (next === null) return;
            yield next;
          }
        },
      };
    },
  };
}

export function reasoningMessage(
  id: string,
  partID: string,
  text: string,
  completed?: number,
): OpenCodeSessionMessage {
  return {
    id,
    type: "assistant",
    time: { created: 10, ...(completed === undefined ? {} : { completed }) },
    agent: "build",
    model: { id: "gpt-5", providerID: "openai" },
    content: [
      {
        id: partID,
        type: "reasoning",
        text,
        time: { created: 11, ...(completed === undefined ? {} : { completed }) },
      },
    ],
  };
}

export function reasoningEvent(
  type: "session.next.reasoning.started" | "session.next.reasoning.ended",
  input: {
    readonly seq: number;
    readonly sessionID: string;
    readonly messageID: string;
    readonly partID: string;
    readonly text?: string;
    readonly timestamp?: number;
  },
): OpenCodeDurableSessionEvent {
  const shared = {
    id: `durable-${String(input.seq)}`,
    durable: { aggregateID: input.sessionID, seq: input.seq, version: 1 },
  };
  if (type === "session.next.reasoning.started") {
    return {
      ...shared,
      type,
      data: {
        timestamp: input.timestamp ?? input.seq,
        sessionID: input.sessionID,
        assistantMessageID: input.messageID,
        reasoningID: input.partID,
      },
    };
  }
  return {
    ...shared,
    type,
    data: {
      timestamp: input.timestamp ?? input.seq,
      sessionID: input.sessionID,
      assistantMessageID: input.messageID,
      reasoningID: input.partID,
      text: input.text ?? "",
    },
  };
}

export async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for watch state.");
}
