import {
  DEFAULT_AGENT_PREFERENCES,
  type AgentPreferences,
  type AgentPreferencesPatch,
} from "@honk/shared/agent-model-policy";
import type { TurnId } from "@honk/shared/base-schemas";
import type {
  AgentAuthStatus,
  AgentCredentialAuthFlow,
  AgentCredentialConfigureInput,
  AgentRuntimeEvent,
  AgentRuntimeModelDescriptor,
  DesktopExtensionUiRequest,
  DesktopExtensionUiRespondInput,
  DesktopRuntimeDiagnostic,
  RuntimeDisplayTimelineProjection,
  RuntimeGetThreadSessionFileInput,
  RuntimeGetThreadSessionFileResult,
  RuntimeListSkillsInput,
  RuntimeListSkillsResult,
  RuntimeThreadIdentity,
  SessionTreeProjection,
  ThreadAgentRuntimeAbortInput,
  ThreadAgentRuntimeCloneInput,
  ThreadAgentRuntimeCompactInput,
  ThreadAgentRuntimeHydrateInput,
  ThreadAgentRuntimeQueueFollowUpInput,
  ThreadAgentRuntimeQueuedFollowUp,
  ThreadAgentRuntimeQueuedFollowUpIdInput,
  ThreadAgentRuntimeReorderQueuedFollowUpInput,
  ThreadAgentRuntimeSendTurnInput,
  ThreadAgentRuntimeSetThreadFocusInput,
  ThreadAgentRuntimeUpdateQueuedFollowUpInput,
} from "@honk/shared/runtime";

export interface HonkRuntimeHostSnapshot {
  readonly preferences: AgentPreferences;
  readonly runtimeIdentities: readonly RuntimeThreadIdentity[];
  readonly models: readonly AgentRuntimeModelDescriptor[];
  readonly authStatuses: readonly AgentAuthStatus[];
  readonly credentialAuthFlows: readonly AgentCredentialAuthFlow[];
  readonly diagnostics: readonly DesktopRuntimeDiagnostic[];
  readonly runtimeEvents: readonly AgentRuntimeEvent[];
  readonly sessionTrees: readonly SessionTreeProjection[];
  readonly displayTimelines: readonly RuntimeDisplayTimelineProjection[];
  readonly pendingExtensionUiRequests: readonly DesktopExtensionUiRequest[];
  readonly queuedFollowUps: readonly ThreadAgentRuntimeQueuedFollowUp[];
}

export type HonkRuntimeHostEvent =
  | { readonly type: "snapshot"; readonly snapshot: HonkRuntimeHostSnapshot }
  | { readonly type: "runtime-event"; readonly event: AgentRuntimeEvent }
  | {
      readonly type: "runtime-identities";
      readonly identities: readonly RuntimeThreadIdentity[];
      readonly authStatuses: readonly AgentAuthStatus[];
    }
  | { readonly type: "session-tree"; readonly tree: SessionTreeProjection }
  | { readonly type: "display-timeline"; readonly timeline: RuntimeDisplayTimelineProjection }
  | {
      readonly type: "pending-extension-ui";
      readonly requests: readonly DesktopExtensionUiRequest[];
    }
  | {
      readonly type: "queued-follow-ups";
      readonly items: readonly ThreadAgentRuntimeQueuedFollowUp[];
    }
  | {
      readonly type: "runtime-ingestion-records";
      readonly records: readonly unknown[];
    }
  | { readonly type: "credential-auth-flows"; readonly flows: readonly AgentCredentialAuthFlow[] };

export interface HonkRuntimeApi {
  readonly getHostSnapshot: () => Promise<HonkRuntimeHostSnapshot>;
  readonly getPreferences: () => Promise<AgentPreferences>;
  readonly updatePreferences: (patch: AgentPreferencesPatch) => Promise<AgentPreferences>;
  readonly configureCredential: (
    input: AgentCredentialConfigureInput,
  ) => Promise<HonkRuntimeHostSnapshot>;
  readonly hydrateThread: (input: ThreadAgentRuntimeHydrateInput) => Promise<void>;
  readonly cloneThread: (input: ThreadAgentRuntimeCloneInput) => Promise<void>;
  readonly compactThread: (input: ThreadAgentRuntimeCompactInput) => Promise<void>;
  readonly setThreadFocus: (input: ThreadAgentRuntimeSetThreadFocusInput) => Promise<void>;
  readonly sendTurn: (input: ThreadAgentRuntimeSendTurnInput) => Promise<TurnId>;
  readonly enqueueFollowUp: (input: ThreadAgentRuntimeQueueFollowUpInput) => Promise<void>;
  readonly updateQueuedFollowUp: (
    input: ThreadAgentRuntimeUpdateQueuedFollowUpInput,
  ) => Promise<void>;
  readonly removeQueuedFollowUp: (input: ThreadAgentRuntimeQueuedFollowUpIdInput) => Promise<void>;
  readonly reorderQueuedFollowUp: (
    input: ThreadAgentRuntimeReorderQueuedFollowUpInput,
  ) => Promise<void>;
  readonly sendQueuedFollowUpNow: (input: ThreadAgentRuntimeQueuedFollowUpIdInput) => Promise<void>;
  readonly abort: (input: ThreadAgentRuntimeAbortInput) => Promise<void>;
  readonly respondToExtensionUiRequest: (input: DesktopExtensionUiRespondInput) => Promise<void>;
  readonly listSkills: (input: RuntimeListSkillsInput) => Promise<RuntimeListSkillsResult>;
  readonly getThreadSessionFile: (
    input: RuntimeGetThreadSessionFileInput,
  ) => Promise<RuntimeGetThreadSessionFileResult>;
  readonly onHostEvent: (listener: (event: HonkRuntimeHostEvent) => void) => () => void;
}

let fallbackPreferences: AgentPreferences = { ...DEFAULT_AGENT_PREFERENCES };

function unavailable(): Error {
  return new Error("Runtime host unavailable after core cutover.");
}

function rejectUnavailable<T>(): Promise<T> {
  return Promise.reject(unavailable());
}

export function createEmptyRuntimeHostSnapshot(): HonkRuntimeHostSnapshot {
  return {
    preferences: fallbackPreferences,
    runtimeIdentities: [],
    models: [],
    authStatuses: [],
    credentialAuthFlows: [],
    diagnostics: [],
    runtimeEvents: [],
    sessionTrees: [],
    displayTimelines: [],
    pendingExtensionUiRequests: [],
    queuedFollowUps: [],
  };
}

export function isDesktopRuntimeApiAvailable(): boolean {
  return false;
}

export async function assertRuntimeHostAvailable(): Promise<void> {
  throw unavailable();
}

export function readHonkRuntimeApi(): HonkRuntimeApi {
  return {
    getHostSnapshot: async () => createEmptyRuntimeHostSnapshot(),
    getPreferences: async () => fallbackPreferences,
    updatePreferences: async (patch) => {
      fallbackPreferences = {
        ...fallbackPreferences,
        ...patch,
        modelSelection: patch.modelSelection ?? fallbackPreferences.modelSelection,
        modelSettingsByModelId:
          patch.modelSettingsByModelId ?? fallbackPreferences.modelSettingsByModelId,
        resources: patch.resources ?? fallbackPreferences.resources,
        credentials: patch.credentials ?? fallbackPreferences.credentials,
      };
      return fallbackPreferences;
    },
    configureCredential: () => rejectUnavailable(),
    hydrateThread: () => rejectUnavailable(),
    cloneThread: () => rejectUnavailable(),
    compactThread: () => rejectUnavailable(),
    setThreadFocus: async () => undefined,
    sendTurn: () => rejectUnavailable(),
    enqueueFollowUp: () => rejectUnavailable(),
    updateQueuedFollowUp: () => rejectUnavailable(),
    removeQueuedFollowUp: () => rejectUnavailable(),
    reorderQueuedFollowUp: () => rejectUnavailable(),
    sendQueuedFollowUpNow: () => rejectUnavailable(),
    abort: () => rejectUnavailable(),
    respondToExtensionUiRequest: () => rejectUnavailable(),
    listSkills: async () => ({ skills: [] }),
    getThreadSessionFile: async () => ({ path: null }),
    onHostEvent: () => () => undefined,
  };
}
