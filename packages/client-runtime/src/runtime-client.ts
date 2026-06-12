import {
  AuthProviderId,
  DEFAULT_AGENT_POLICY_MODEL_SELECTION,
  DEFAULT_AGENT_RESOURCE_PREFERENCES,
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
    setThreadFocus: (input) => runtime.setThreadFocus(input),
    sendTurn: (input) => runtime.sendTurn(input),
    abort: (input) => runtime.abort(input),
    respondToExtensionUiRequest: (input) => runtime.respondToExtensionUiRequest(input),
    onHostEvent: (listener) =>
      runtime.onHostEvent((event) => {
        listener(decodeHonkRuntimeHostEvent(event));
      }),
  };
}

export type { HonkRuntimeApi, HonkRuntimeHostEvent, HonkRuntimeHostSnapshot };
