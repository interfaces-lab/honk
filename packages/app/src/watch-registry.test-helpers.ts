import {
  createOpenCodeServer,
  type OpenCodeClient,
  type OpenCodeEvent,
  type OpenCodeLocationQuery,
  type OpenCodeServerDescriptor,
  type OpenCodeSessionInfo,
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
    readonly model?: OpenCodeSessionInfo["model"];
    readonly parentID?: string;
    readonly updated?: number;
  },
): OpenCodeSessionInfo {
  return {
    id,
    ...(options?.agent === undefined ? {} : { agent: options.agent }),
    ...(options?.model === undefined ? {} : { model: options.model }),
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
  readonly sessionGet?: OpenCodeClient["sessions"]["get"];
  readonly transcript?: OpenCodeSessionTranscript;
  readonly loadTranscript?: OpenCodeClient["sessions"]["transcript"];
  readonly onTranscript?: () => void;
  readonly transcriptGate?: Promise<void>;
  readonly onSessionList?: () => void;
  readonly sessionList?: OpenCodeClient["sessions"]["list"];
  readonly sessionListGate?: Promise<void>;
  readonly sessionActivityGate?: Promise<void>;
  readonly onResolveLocation?: () => void;
  readonly resolvedProjectDirectory?: string;
  readonly onPump: () => void;
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
    health: async () => undefined,
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
      list:
        input.sessionList ??
        (async () => {
          input.onSessionList?.();
          await input.sessionListGate;
          return { data: inventory, cursor: {} };
        }),
      // Mirror the sidecar: status is per-directory instance state, so only
      // sessions in the queried location are reported.
      active: async (location?: OpenCodeLocationQuery) => {
        await input.sessionActivityGate;
        return Object.fromEntries(
          [...activeSessionIDs]
            .filter((sessionID) => {
              const sessionInfo = inventory.find((item) => item.id === sessionID);
              return (
                sessionInfo !== undefined && location?.directory === sessionInfo.location.directory
              );
            })
            .map((sessionID) => [sessionID, { type: "running" }]),
        );
      },
      get: input.sessionGet ?? (async () => input.info),
      messages: async () => ({ data: [], cursor: {} }),
      transcript: async (ref: Parameters<OpenCodeClient["sessions"]["transcript"]>[0]) => {
        input.onTranscript?.();
        if (input.loadTranscript !== undefined) return input.loadTranscript(ref);
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
  // Fixtures use the application event shape; global envelopes are covered at the client boundary.
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

export async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for watch state.");
}
