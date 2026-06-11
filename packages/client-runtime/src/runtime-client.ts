import {
  AuthProviderId,
  DEFAULT_AGENT_POLICY_MODEL_SELECTION,
  DEFAULT_AGENT_RESOURCE_PREFERENCES,
  decodeAgentPreferences,
  decodeMultiRuntimeHostEvent,
  decodeMultiRuntimeHostSnapshot,
  type AgentPreferences,
  type LocalApi,
  type MultiRuntimeApi,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
} from "@multi/contracts";

const now = () => new Date().toISOString();

const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
  agentMode: "deep",
  interactionMode: "agent",
  modelSelection: DEFAULT_AGENT_POLICY_MODEL_SELECTION,
  modelSettingsByModelId: {},
  thinkingLevel: "high",
  resources: DEFAULT_AGENT_RESOURCE_PREFERENCES,
  credentials: [
    {
      kind: "claude-api-key",
      label: "Claude API Key",
      authProviderId: AuthProviderId.make("anthropic"),
      accountId: null,
    },
    {
      kind: "claude-oauth",
      label: "Claude OAuth",
      authProviderId: AuthProviderId.make("anthropic"),
      accountId: null,
    },
    {
      kind: "codex-oauth",
      label: "Codex OAuth",
      authProviderId: AuthProviderId.make("openai-codex"),
      accountId: null,
    },
    {
      kind: "codex-api-key",
      label: "Codex API Key",
      authProviderId: AuthProviderId.make("openai"),
      accountId: null,
    },
  ],
};

let fallbackPreferences: AgentPreferences = DEFAULT_AGENT_PREFERENCES;

export function createEmptyRuntimeHostSnapshot(
  preferences: AgentPreferences = fallbackPreferences,
): MultiRuntimeHostSnapshot {
  return {
    preferences,
    models: [],
    authStatuses: [],
    credentialAuthFlows: [],
    diagnostics: [
      {
        state: "warning",
        title: "Runtime host unavailable",
        message: "No MultiRuntimeApi has been exposed yet.",
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

export type RuntimeApiResolver = () => MultiRuntimeApi | undefined;

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

function readDesktopRuntimeApiFromWindow(): MultiRuntimeApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.desktopBridge?.runtime ?? window.multiRuntime;
}

function resolveRuntimeApi(): MultiRuntimeApi | undefined {
  return (
    runtimeApiResolver?.() ??
    runtimeClientBootstrap?.readLocalApi()?.runtime ??
    readDesktopRuntimeApiFromWindow()
  );
}

export function createRuntimeClient(): MultiRuntimeApi {
  const runtime = resolveRuntimeApi();
  if (!runtime) {
    throw runtimeHostUnavailableError();
  }
  return createRuntimeClientFromApi(runtime);
}

export function readMultiRuntimeApi(): MultiRuntimeApi {
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
  await readMultiRuntimeApi().getHostSnapshot();
}

export function createRuntimeClientFromApi(runtime: MultiRuntimeApi): MultiRuntimeApi {
  return {
    getHostSnapshot: async () => decodeMultiRuntimeHostSnapshot(await runtime.getHostSnapshot()),
    getPreferences: async () => decodeAgentPreferences(await runtime.getPreferences()),
    updatePreferences: async (patch) =>
      decodeAgentPreferences(await runtime.updatePreferences(patch)),
    configureCredential: async (input) =>
      decodeMultiRuntimeHostSnapshot(await runtime.configureCredential(input)),
    hydrateThread: (input) => runtime.hydrateThread(input),
    sendTurn: (input) => runtime.sendTurn(input),
    abort: (input) => runtime.abort(input),
    respondToExtensionUiRequest: (input) => runtime.respondToExtensionUiRequest(input),
    onHostEvent: (listener) =>
      runtime.onHostEvent((event) => {
        listener(decodeMultiRuntimeHostEvent(event));
      }),
  };
}

export type { MultiRuntimeApi, MultiRuntimeHostEvent, MultiRuntimeHostSnapshot };
