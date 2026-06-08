import {
  AuthProviderId,
  DEFAULT_AGENT_RESOURCE_PREFERENCES,
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
    {
      kind: "xai-api-key",
      label: "xAI API Key",
      authProviderId: AuthProviderId.make("xai"),
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
  return runtime;
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
  return runtime;
}

export type { MultiRuntimeApi, MultiRuntimeHostEvent, MultiRuntimeHostSnapshot };
