import { Effect, Schema } from "effect";
import { AgentPreferences, AgentPreferencesPatch } from "@honk/shared/agent-model-policy";
import { TurnId } from "@honk/shared/base-schemas";
import {
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
import { RuntimeIngestionRecord } from "./orchestration";

export * from "@honk/shared/runtime";

export const HonkRuntimeHostSnapshot = Schema.Struct({
  preferences: AgentPreferences,
  runtimeIdentities: Schema.Array(RuntimeThreadIdentity).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  models: Schema.Array(AgentRuntimeModelDescriptor).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  authStatuses: Schema.Array(AgentAuthStatus).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  credentialAuthFlows: Schema.Array(AgentCredentialAuthFlow).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  diagnostics: Schema.Array(DesktopRuntimeDiagnostic).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  runtimeEvents: Schema.Array(AgentRuntimeEvent).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  sessionTrees: Schema.Array(SessionTreeProjection).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  displayTimelines: Schema.Array(RuntimeDisplayTimelineProjection).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  pendingExtensionUiRequests: Schema.Array(DesktopExtensionUiRequest).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  queuedFollowUps: Schema.Array(ThreadAgentRuntimeQueuedFollowUp).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type HonkRuntimeHostSnapshot = typeof HonkRuntimeHostSnapshot.Type;
const decodeHonkRuntimeHostSnapshotValue = Schema.decodeUnknownSync(HonkRuntimeHostSnapshot);

export const HonkRuntimeHostEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    snapshot: HonkRuntimeHostSnapshot,
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-event"),
    event: AgentRuntimeEvent,
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-identities"),
    identities: Schema.Array(RuntimeThreadIdentity),
    authStatuses: Schema.Array(AgentAuthStatus),
  }),
  Schema.Struct({
    type: Schema.Literal("session-tree"),
    tree: SessionTreeProjection,
  }),
  Schema.Struct({
    type: Schema.Literal("display-timeline"),
    timeline: RuntimeDisplayTimelineProjection,
  }),
  Schema.Struct({
    type: Schema.Literal("pending-extension-ui"),
    requests: Schema.Array(DesktopExtensionUiRequest),
  }),
  Schema.Struct({
    type: Schema.Literal("queued-follow-ups"),
    items: Schema.Array(ThreadAgentRuntimeQueuedFollowUp),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-ingestion-records"),
    records: Schema.Array(RuntimeIngestionRecord),
  }),
  Schema.Struct({
    type: Schema.Literal("credential-auth-flows"),
    flows: Schema.Array(AgentCredentialAuthFlow),
  }),
]);
export type HonkRuntimeHostEvent = typeof HonkRuntimeHostEvent.Type;
const decodeHonkRuntimeHostEventValue = Schema.decodeUnknownSync(HonkRuntimeHostEvent);

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateLegacyRuntimeDisplay(display: unknown): unknown {
  if (!isUnknownRecord(display) || display.kind !== "shell") {
    return display;
  }
  return {
    ...display,
    kind: "bash",
  };
}

function migrateLegacyRuntimeDisplayTimelineItem(item: unknown): unknown {
  if (!isUnknownRecord(item) || item.kind !== "tool") {
    return item;
  }
  return {
    ...item,
    display: migrateLegacyRuntimeDisplay(item.display),
  };
}

function migrateLegacyRuntimeDisplayTimeline(timeline: unknown): unknown {
  if (!isUnknownRecord(timeline) || !Array.isArray(timeline.items)) {
    return timeline;
  }
  return {
    ...timeline,
    items: timeline.items.map(migrateLegacyRuntimeDisplayTimelineItem),
  };
}

export function migrateLegacyRuntimeHostSnapshotInput(value: unknown): unknown {
  if (!isUnknownRecord(value) || !Array.isArray(value.displayTimelines)) {
    return value;
  }
  return {
    ...value,
    displayTimelines: value.displayTimelines.map(migrateLegacyRuntimeDisplayTimeline),
  };
}

export function migrateLegacyRuntimeHostEventInput(value: unknown): unknown {
  if (!isUnknownRecord(value)) {
    return value;
  }
  if (value.type === "snapshot") {
    return {
      ...value,
      snapshot: migrateLegacyRuntimeHostSnapshotInput(value.snapshot),
    };
  }
  if (value.type === "display-timeline") {
    return {
      ...value,
      timeline: migrateLegacyRuntimeDisplayTimeline(value.timeline),
    };
  }
  return value;
}

export function decodeHonkRuntimeHostSnapshot(value: unknown): HonkRuntimeHostSnapshot {
  return decodeHonkRuntimeHostSnapshotValue(migrateLegacyRuntimeHostSnapshotInput(value));
}

export function decodeHonkRuntimeHostEvent(value: unknown): HonkRuntimeHostEvent {
  return decodeHonkRuntimeHostEventValue(migrateLegacyRuntimeHostEventInput(value));
}
export interface HonkRuntimeApi {
  getHostSnapshot: () => Promise<HonkRuntimeHostSnapshot>;
  getPreferences: () => Promise<AgentPreferences>;
  updatePreferences: (patch: AgentPreferencesPatch) => Promise<AgentPreferences>;
  configureCredential: (input: AgentCredentialConfigureInput) => Promise<HonkRuntimeHostSnapshot>;
  hydrateThread: (input: ThreadAgentRuntimeHydrateInput) => Promise<void>;
  cloneThread: (input: ThreadAgentRuntimeCloneInput) => Promise<void>;
  compactThread: (input: ThreadAgentRuntimeCompactInput) => Promise<void>;
  setThreadFocus: (input: ThreadAgentRuntimeSetThreadFocusInput) => Promise<void>;
  sendTurn: (input: ThreadAgentRuntimeSendTurnInput) => Promise<TurnId>;
  enqueueFollowUp: (input: ThreadAgentRuntimeQueueFollowUpInput) => Promise<void>;
  updateQueuedFollowUp: (input: ThreadAgentRuntimeUpdateQueuedFollowUpInput) => Promise<void>;
  removeQueuedFollowUp: (input: ThreadAgentRuntimeQueuedFollowUpIdInput) => Promise<void>;
  reorderQueuedFollowUp: (input: ThreadAgentRuntimeReorderQueuedFollowUpInput) => Promise<void>;
  sendQueuedFollowUpNow: (input: ThreadAgentRuntimeQueuedFollowUpIdInput) => Promise<void>;
  abort: (input: ThreadAgentRuntimeAbortInput) => Promise<void>;
  respondToExtensionUiRequest: (input: DesktopExtensionUiRespondInput) => Promise<void>;
  listSkills: (input: RuntimeListSkillsInput) => Promise<RuntimeListSkillsResult>;
  getThreadSessionFile: (
    input: RuntimeGetThreadSessionFileInput,
  ) => Promise<RuntimeGetThreadSessionFileResult>;
  onHostEvent: (listener: (event: HonkRuntimeHostEvent) => void) => () => void;
}
