import {
  AuthProviderId,
  DEFAULT_AGENT_RESOURCE_PREFERENCES,
  type AgentPreferences,
  type AgentPreferencesPatch,
  type MultiRuntimeApi,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
} from "@multi/contracts";
import { readLocalApi } from "~/local-api";

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

function applyPreferencesPatch(
  preferences: AgentPreferences,
  patch: AgentPreferencesPatch,
): AgentPreferences {
  return {
    ...preferences,
    ...patch,
    credentials: patch.credentials ? [...patch.credentials] : preferences.credentials,
  };
}

function runtimeHostUnavailable(): Error {
  return new Error("Runtime host unavailable.");
}

const fallbackRuntimeApi: MultiRuntimeApi = {
  getHostSnapshot: async () => createEmptyRuntimeHostSnapshot(),
  getPreferences: async () => fallbackPreferences,
  updatePreferences: async (patch) => {
    fallbackPreferences = applyPreferencesPatch(fallbackPreferences, patch);
    return fallbackPreferences;
  },
  configureCredential: async () => createEmptyRuntimeHostSnapshot(),
  hydrateThread: async () => undefined,
  sendTurn: async () => {
    throw runtimeHostUnavailable();
  },
  abort: async () => undefined,
  respondToExtensionUiRequest: async () => undefined,
  onHostEvent: (_listener: (event: MultiRuntimeHostEvent) => void) => () => undefined,
};

export function readMultiRuntimeApi(): MultiRuntimeApi {
  if (typeof window === "undefined") {
    return fallbackRuntimeApi;
  }
  return readLocalApi()?.runtime ?? window.multiRuntime ?? fallbackRuntimeApi;
}

export function isDesktopRuntimeApiAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    (readLocalApi()?.runtime !== undefined || window.multiRuntime !== undefined)
  );
}

export function assertRuntimeApiAvailable(): void {
  if (!isDesktopRuntimeApiAvailable()) {
    throw runtimeHostUnavailable();
  }
}

export async function assertRuntimeHostAvailable(): Promise<void> {
  assertRuntimeApiAvailable();
  await readMultiRuntimeApi().getHostSnapshot();
}
