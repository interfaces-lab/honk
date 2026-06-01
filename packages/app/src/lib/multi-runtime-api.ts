import {
  AuthProviderId,
  RuntimeSessionId,
  TurnId,
  type AgentPreferences,
  type AgentPreferencesPatch,
  type MultiRuntimeApi,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
} from "@multi/contracts";

const now = () => new Date().toISOString();

const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
  interactionMode: "default",
  permissionMode: "project-write",
  thinkingLevel: "medium",
  persistSessionTree: true,
  credentials: [
    {
      kind: "claude-api-key",
      label: "Claude API key",
      authProviderId: AuthProviderId.make("claude"),
      state: "unknown",
      enabled: true,
    },
    {
      kind: "codex-oauth",
      label: "Codex OAuth",
      authProviderId: AuthProviderId.make("codex"),
      state: "unknown",
      enabled: true,
    },
    {
      kind: "codex-api-key",
      label: "Codex API key",
      authProviderId: AuthProviderId.make("codex-api-key"),
      state: "unknown",
      enabled: true,
    },
    {
      kind: "xai-api-key",
      label: "xAI API key",
      authProviderId: AuthProviderId.make("xai"),
      state: "unknown",
      enabled: true,
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
    diagnostics: [
      {
        state: "warning",
        title: "Desktop runtime host unavailable",
        message: "No MultiRuntimeApi has been exposed by the desktop preload yet.",
        updatedAt: now(),
      },
    ],
    runtimeEvents: [],
    sessionTrees: [],
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

const fallbackRuntimeApi: MultiRuntimeApi = {
  getHostSnapshot: async () => createEmptyRuntimeHostSnapshot(),
  getPreferences: async () => fallbackPreferences,
  updatePreferences: async (patch) => {
    fallbackPreferences = applyPreferencesPatch(fallbackPreferences, patch);
    return fallbackPreferences;
  },
  startThread: async (input) => ({
    agentRuntime: "pi",
    threadId: input.threadId,
    runtimeSessionId: RuntimeSessionId.make(`fallback:${input.threadId}`),
  }),
  send: async (input) => TurnId.make(`fallback:${input.threadId}:${Date.now()}`),
  respondToExtensionUiRequest: async () => undefined,
  onHostEvent: (_listener: (event: MultiRuntimeHostEvent) => void) => () => undefined,
};

export function readMultiRuntimeApi(): MultiRuntimeApi {
  if (typeof window === "undefined") {
    return fallbackRuntimeApi;
  }
  return window.multiRuntime ?? fallbackRuntimeApi;
}

export function ensureMultiRuntimeApi(): MultiRuntimeApi {
  return readMultiRuntimeApi();
}
