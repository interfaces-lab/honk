import {
  createDefaultAgentPreferences,
  decodeAgentPreferences,
  decodeHonkRuntimeHostEvent,
  decodeHonkRuntimeHostSnapshot,
  type AgentPreferences,
  type LocalApi,
  type HonkRuntimeApi,
  type HonkRuntimeHostEvent,
  type HonkRuntimeHostSnapshot,
} from "@honk/contracts";

const now = () => new Date().toISOString();

let fallbackPreferences: AgentPreferences = createDefaultAgentPreferences();

export function createEmptyRuntimeHostSnapshot(
  preferences: AgentPreferences = fallbackPreferences,
): HonkRuntimeHostSnapshot {
  return {
    preferences,
    runtimeIdentities: [],
    models: [],
    authStatuses: [],
    credentialAuthFlows: [],
    diagnostics: [
      {
        state: "warning",
        title: "Runtime host unavailable",
        message: "No HonkRuntimeApi has been exposed yet.",
        updatedAt: now(),
      },
    ],
    runtimeEvents: [],
    sessionTrees: [],
    displayTimelines: [],
    pendingExtensionUiRequests: [],
  };
}

export function runtimeHostUnavailableError(): Error {
  return new Error("Runtime host unavailable.");
}

export type RuntimeApiResolver = () => HonkRuntimeApi | undefined;

let runtimeApiResolver: RuntimeApiResolver | null = null;

export function registerRuntimeApiResolver(resolver: RuntimeApiResolver): void {
  runtimeApiResolver = resolver;
}

export function resetRuntimeApiResolverForTests(): void {
  runtimeApiResolver = null;
}

export type RuntimeClientBootstrap = {
  readonly readLocalApi: () => LocalApi | undefined;
};

let runtimeClientBootstrap: RuntimeClientBootstrap | null = null;

export function configureRuntimeClientBootstrap(bootstrap: RuntimeClientBootstrap): void {
  runtimeClientBootstrap = bootstrap;
}

export function resetRuntimeClientBootstrapForTests(): void {
  runtimeClientBootstrap = null;
}

function readDesktopRuntimeApiFromWindow(): HonkRuntimeApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.desktopBridge?.runtime ?? window.honkRuntime;
}

function resolveRuntimeApi(): HonkRuntimeApi | undefined {
  return (
    runtimeApiResolver?.() ??
    runtimeClientBootstrap?.readLocalApi()?.runtime ??
    readDesktopRuntimeApiFromWindow()
  );
}

export function createRuntimeClient(): HonkRuntimeApi {
  const runtime = resolveRuntimeApi();
  if (!runtime) {
    throw runtimeHostUnavailableError();
  }
  return createRuntimeClientFromApi(runtime);
}

export function readHonkRuntimeApi(): HonkRuntimeApi {
  return createRuntimeClient();
}

export function isDesktopRuntimeApiAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return resolveRuntimeApi() !== undefined;
}

export function assertRuntimeApiAvailable(): void {
  if (!isDesktopRuntimeApiAvailable()) {
    throw runtimeHostUnavailableError();
  }
}

export async function assertRuntimeHostAvailable(): Promise<void> {
  assertRuntimeApiAvailable();
}

export function createRuntimeClientFromApi(runtime: HonkRuntimeApi): HonkRuntimeApi {
  return {
    getHostSnapshot: async () => decodeHonkRuntimeHostSnapshot(await runtime.getHostSnapshot()),
    getPreferences: async () => decodeAgentPreferences(await runtime.getPreferences()),
    updatePreferences: async (patch) =>
      decodeAgentPreferences(await runtime.updatePreferences(patch)),
    configureCredential: async (input) =>
      decodeHonkRuntimeHostSnapshot(await runtime.configureCredential(input)),
    hydrateThread: (input) => runtime.hydrateThread(input),
    cloneThread: (input) => runtime.cloneThread(input),
    setThreadFocus: (input) => runtime.setThreadFocus(input),
    sendTurn: (input) => runtime.sendTurn(input),
    compactThread: async (input) => {
      const compactThread = Reflect.get(runtime, "compactThread");
      if (typeof compactThread !== "function") {
        throw new Error("Runtime host does not support context compaction.");
      }
      await Promise.resolve(compactThread.call(runtime, input));
    },
    abort: (input) => runtime.abort(input),
    respondToExtensionUiRequest: (input) => runtime.respondToExtensionUiRequest(input),
    // Older runtime bridges (e.g. a stale window.honkRuntime preload) predate these methods, so
    // degrade to empty results here instead of letting callers crash on a missing function.
    listSkills: async (input) =>
      typeof runtime.listSkills === "function" ? runtime.listSkills(input) : { skills: [] },
    getThreadSessionFile: async (input) =>
      typeof runtime.getThreadSessionFile === "function"
        ? runtime.getThreadSessionFile(input)
        : { path: null },
    onHostEvent: (listener) =>
      runtime.onHostEvent((event) => {
        listener(decodeHonkRuntimeHostEvent(event));
      }),
  };
}

export type { HonkRuntimeApi, HonkRuntimeHostEvent, HonkRuntimeHostSnapshot };
