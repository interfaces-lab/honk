import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_THINKING_LEVELS,
  AuthProviderId,
  createDefaultAgentPreferences,
  type AgentCredentialAuthFlow,
  type AgentCredentialConfigureInput,
  type AgentAuthStatus,
  type AgentCredentialKind,
  type AgentRuntimeModelDescriptor,
  type AgentPreferences,
  type AgentPreferencesPatch,
  type AgentRuntimeEvent,
  type BrowserAutomationController,
  type DesktopExtensionUiRequest,
  type DesktopExtensionUiRespondInput,
  ModelId,
  type HonkRuntimeApi,
  type HonkRuntimeHostEvent,
  type HonkRuntimeHostSnapshot,
  isOAuthAgentCredentialKind,
  type RuntimeDisplayTimelineProjection,
  type RuntimeIngestionRecord,
  type ThreadAgentRuntimeCloneInput,
  type RuntimeGetThreadSessionFileInput,
  type RuntimeGetThreadSessionFileResult,
  type RuntimeListSkillsInput,
  type RuntimeListSkillsResult,
  type RuntimeSkillSummary,
  type RuntimeThreadIdentity,
  resolveAgentCredentialPreferenceForConfigure,
  type SessionTreeProjection,
  type ThreadAgentRuntimeAbortInput,
  type ThreadAgentRuntimeCompactInput,
  type ThreadAgentRuntimeHydrateInput,
  type ThreadAgentRuntimeQueueFollowUpInput,
  type ThreadAgentRuntimeQueuedFollowUp,
  type ThreadAgentRuntimeQueuedFollowUpIdInput,
  type ThreadAgentRuntimeReorderQueuedFollowUpInput,
  type ThreadAgentRuntimeSetThreadFocusInput,
  type ThreadAgentRuntimeSendTurnInput,
  type ThreadAgentRuntimeUpdateQueuedFollowUpInput,
} from "@honk/contracts";
import { getSupportedThinkingLevels, type OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SettingsManager,
  type AuthCredential,
  type AuthStatus,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { createDesktopExtensionUi, type DesktopExtensionUiController } from "./extension-ui";
import { createDesktopAgentExtensionFactories } from "./desktop-agent-extensions";
import {
  ThreadAgentRuntime,
  encodeThreadIdForPath,
  type PendingRuntimeUserTurnStart,
} from "./thread-agent-runtime";
import {
  canonicalThreadSessionTree,
  runtimeBridgeFactsForRuntimeEvent,
} from "./runtime-canonical-projection";
import {
  projectRuntimeDisplayTimeline,
  projectRuntimeDisplayTimelineEvent,
} from "./display-timeline-projection";
import { toWireRuntimeEvent } from "./runtime-event-wire";
import { registerCursorComposerProvider } from "./cursor-composer-provider";
import { registerClaudeAgentProvider } from "./claude-agent-provider";
import { createHonkPiModelRegistry, isHonkPiSupportedProviderId } from "./honk-pi-models";

const MAX_RUNTIME_EVENTS_IN_SNAPSHOT = 500;
// Live runtime events are retained only to (a) feed the host snapshot and (b) re-project the live
// display timeline for the in-flight turn; committed history lives in the session tree. Both arrays
// were previously unbounded, which retained every streaming delta (and every full subagent activity
// snapshot) for a thread's whole lifetime — the O(n^2) growth behind the crash. Cap them.
const MAX_RUNTIME_EVENTS_PER_THREAD = 1000;
// Coalesce the (full-timeline) display-timeline broadcasts: each one re-encodes and re-broadcasts the
// entire projection to every window, so emitting one per streaming event is the dominant freeze/energy
// cost. We keep the projection current per event but flush at most one emit per thread per interval.
const DISPLAY_TIMELINE_FLUSH_INTERVAL_MS = 16;
const BACKGROUND_DISPLAY_TIMELINE_FLUSH_INTERVAL_MS = 250;

function defaultExtensionPaths(agentDir: string): readonly string[] {
  const extensionsDir = join(agentDir, "extensions");
  try {
    return statSync(extensionsDir).isDirectory() ? [join(extensionsDir, "*")] : [];
  } catch {
    return [];
  }
}

// Push with amortized O(1) trimming: let the array grow to 2x the cap, then trim back to the cap in a
// single splice, so steady-state retention is bounded without an O(n) shift on every push.
function boundedPush<T>(array: T[], item: T, max: number): void {
  array.push(item);
  if (array.length > max * 2) {
    array.splice(0, array.length - max);
  }
}

function describeAuthSource(status: AuthStatus | undefined): string | null {
  switch (status?.source) {
    case "stored":
      return "Credential saved.";
    case "runtime":
      return status.label ? `Runtime credential: ${status.label}.` : "Runtime credential.";
    case "environment":
      return status.label ? `Environment credential: ${status.label}.` : "Environment credential.";
    case "fallback":
      return status.label ?? "Custom provider credential.";
    case "models_json_key":
      return "models.json credential.";
    case "models_json_command":
      return "models.json credential command.";
    default:
      return null;
  }
}

function credentialKindMatchesStoredCredential(
  credentialKind: AgentCredentialKind,
  storedCredential: AuthCredential | undefined,
): boolean {
  const expectedType = isOAuthAgentCredentialKind(credentialKind) ? "oauth" : "api_key";
  return storedCredential?.type === expectedType;
}

interface RuntimeEntry {
  readonly runtime: ThreadAgentRuntime;
  readonly ui: DesktopExtensionUiController;
  readonly unsubscribe: () => void;
}

type RuntimeThreadStartInput = Pick<ThreadAgentRuntimeSendTurnInput, "threadId" | "cwd" | "policy">;

type RuntimeThreadSendInput = Pick<
  ThreadAgentRuntimeSendTurnInput,
  | "threadId"
  | "input"
  | "interactionMode"
  | "sourceProposedPlan"
  | "clientMessageId"
  | "replacesClientMessageId"
  | "parentEntryId"
  | "images"
  | "modelSelection"
> & {
  readonly streamingBehavior?: "steer" | "followUp" | null;
  readonly runtimeUserTurnStart?: PendingRuntimeUserTurnStart;
};

export interface DesktopRuntimeHostOptions {
  readonly preferences?: AgentPreferences | null;
  readonly agentDir: string;
  readonly authStorage?: AuthStorage | null;
  readonly extensionFactories?: readonly ExtensionFactory[] | null;
  readonly extensionPaths?: readonly string[] | null;
  readonly browserAutomation?: BrowserAutomationController | null;
  readonly bindExtensions?:
    | ((runtime: ThreadAgentRuntime, ui: DesktopExtensionUiController) => Promise<void>)
    | null;
}

export class DesktopRuntimeHost implements HonkRuntimeApi {
  private preferences: AgentPreferences;
  private readonly agentDir: string;
  private readonly authStorage: AuthStorage | null;
  private readonly modelRegistry: ModelRegistry | null;
  private readonly extensionFactories: readonly ExtensionFactory[];
  private readonly extensionPaths: readonly string[];
  private readonly browserAutomation: BrowserAutomationController | null;
  private readonly bindRuntimeExtensions:
    | ((runtime: ThreadAgentRuntime, ui: DesktopExtensionUiController) => Promise<void>)
    | null;
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly runtimeEvents: AgentRuntimeEvent[] = [];
  private readonly runtimeEventsByThreadId = new Map<string, AgentRuntimeEvent[]>();
  private readonly sessionTrees = new Map<string, SessionTreeProjection>();
  private readonly displayTimelines = new Map<string, RuntimeDisplayTimelineProjection>();
  private readonly credentialAuthFlows = new Map<string, AgentCredentialAuthFlow>();
  private readonly listeners = new Set<(event: HonkRuntimeHostEvent) => void>();
  private readonly startOperations = new Map<string, Promise<void>>();
  private readonly pendingDisplayTimelineDeadlines = new Map<string, number>();
  private readonly focusedThreadIds = new Set<string>();
  private displayTimelineFlushHandle: ReturnType<typeof setTimeout> | null = null;
  private displayTimelineFlushDeadline: number | null = null;

  constructor(options: DesktopRuntimeHostOptions) {
    if (options.agentDir.trim().length === 0) {
      throw new Error("DesktopRuntimeHost requires a Honk agent directory.");
    }

    this.preferences = options?.preferences ?? createDefaultAgentPreferences();
    this.agentDir = options.agentDir;
    this.authStorage =
      options.authStorage === undefined
        ? AuthStorage.create(join(this.agentDir, "auth.json"))
        : options.authStorage;
    this.modelRegistry = this.authStorage
      ? createHonkPiModelRegistry(
          ModelRegistry,
          this.authStorage,
          join(this.agentDir, "models.json"),
        )
      : null;
    if (this.modelRegistry) {
      registerCursorComposerProvider(this.modelRegistry, { cwd: this.agentDir });
      registerClaudeAgentProvider(this.modelRegistry, {
        cwd: this.agentDir,
        authStorage: this.authStorage ?? undefined,
      });
    }
    this.extensionPaths = options.extensionPaths ?? defaultExtensionPaths(this.agentDir);
    this.browserAutomation = options.browserAutomation ?? null;
    this.extensionFactories =
      options.extensionFactories ??
      createDesktopAgentExtensionFactories({
        agentDir: this.agentDir,
        extensionPaths: this.extensionPaths,
      });
    this.bindRuntimeExtensions = options?.bindExtensions ?? null;
  }

  async getHostSnapshot(): Promise<HonkRuntimeHostSnapshot> {
    return {
      preferences: this.preferences,
      runtimeIdentities: this.getRuntimeIdentities(),
      models: this.getModelDescriptors(),
      authStatuses: this.getAuthStatuses(),
      credentialAuthFlows: [...this.credentialAuthFlows.values()],
      diagnostics: [],
      runtimeEvents: this.getRuntimeEventsSnapshot(),
      sessionTrees: [...this.sessionTrees.values()],
      displayTimelines: this.getDisplayTimelines(),
      pendingExtensionUiRequests: this.getPendingExtensionUiRequests(),
      queuedFollowUps: this.getQueuedFollowUps(),
    };
  }

  async getPreferences(): Promise<AgentPreferences> {
    return this.preferences;
  }

  async updatePreferences(patch: AgentPreferencesPatch): Promise<AgentPreferences> {
    this.preferences = {
      ...this.preferences,
      ...patch,
      credentials: patch.credentials ? [...patch.credentials] : this.preferences.credentials,
    };
    this.emit({ type: "snapshot", snapshot: await this.getHostSnapshot() });
    return this.preferences;
  }

  async configureCredential(
    input: AgentCredentialConfigureInput,
    callbacks?: OAuthLoginCallbacks,
  ): Promise<HonkRuntimeHostSnapshot> {
    if (!this.authStorage) {
      throw new Error("Pi auth storage is unavailable.");
    }
    const credential = resolveAgentCredentialPreferenceForConfigure(this.preferences, input);
    if (!credential) {
      throw new Error(
        `Unsupported credential configuration: ${input.method} ${input.authProviderId}/${input.credentialKind}.`,
      );
    }

    switch (input.method) {
      case "api-key":
        this.authStorage.set(credential.authProviderId, { type: "api_key", key: input.apiKey });
        this.clearCredentialAuthFlow(credential.authProviderId);
        break;
      case "oauth":
        if (!callbacks) {
          throw new Error("OAuth login callbacks are unavailable.");
        }
        await this.loginCredential(credential.authProviderId, credential.kind, callbacks);
        break;
      case "logout":
        this.authStorage.logout(credential.authProviderId);
        this.clearCredentialAuthFlow(credential.authProviderId);
        break;
    }

    const snapshot = await this.getHostSnapshot();
    this.emit({ type: "snapshot", snapshot });
    return snapshot;
  }

  private async loginCredential(
    authProviderId: AuthProviderId,
    credentialKind: AgentCredentialKind | null,
    callbacks: OAuthLoginCallbacks,
  ): Promise<void> {
    this.setCredentialAuthFlow({
      authProviderId,
      credentialKind,
      state: "pending",
      kind: "oauth-browser",
      message: "Starting login...",
      verificationUri: null,
      userCode: null,
      updatedAt: new Date().toISOString(),
    });

    try {
      await this.authStorage!.login(authProviderId, {
        ...callbacks,
        onAuth: (info) => {
          this.setCredentialAuthFlow({
            authProviderId,
            credentialKind,
            state: "pending",
            kind: "oauth-browser",
            message: info.instructions ?? "Complete login in the browser.",
            verificationUri: info.url,
            userCode: null,
            updatedAt: new Date().toISOString(),
          });
          callbacks.onAuth(info);
        },
        onDeviceCode: (info) => {
          this.setCredentialAuthFlow({
            authProviderId,
            credentialKind,
            state: "pending",
            kind: "oauth-device-code",
            message: "Waiting for authentication.",
            verificationUri: info.verificationUri,
            userCode: info.userCode,
            updatedAt: new Date().toISOString(),
          });
          callbacks.onDeviceCode(info);
        },
        onProgress: (message) => {
          this.updateCredentialAuthFlowMessage(authProviderId, message);
          callbacks.onProgress?.(message);
        },
      });
      this.clearCredentialAuthFlow(authProviderId);
    } catch (error) {
      this.setCredentialAuthFlow({
        authProviderId,
        credentialKind,
        state: "error",
        kind: this.credentialAuthFlows.get(authProviderId)?.kind ?? "oauth-browser",
        message: error instanceof Error ? error.message : "Login failed.",
        verificationUri: this.credentialAuthFlows.get(authProviderId)?.verificationUri ?? null,
        userCode: this.credentialAuthFlows.get(authProviderId)?.userCode ?? null,
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private setCredentialAuthFlow(flow: AgentCredentialAuthFlow): void {
    this.credentialAuthFlows.set(flow.authProviderId, flow);
    this.emit({
      type: "credential-auth-flows",
      flows: [...this.credentialAuthFlows.values()],
    });
  }

  private updateCredentialAuthFlowMessage(authProviderId: AuthProviderId, message: string): void {
    const existing = this.credentialAuthFlows.get(authProviderId);
    if (!existing) {
      return;
    }
    this.setCredentialAuthFlow({
      ...existing,
      message,
      updatedAt: new Date().toISOString(),
    });
  }

  private clearCredentialAuthFlow(authProviderId: AuthProviderId): void {
    if (!this.credentialAuthFlows.delete(authProviderId)) {
      return;
    }
    this.emit({
      type: "credential-auth-flows",
      flows: [...this.credentialAuthFlows.values()],
    });
  }

  async startThread(input: RuntimeThreadStartInput) {
    const existingEntry = this.runtimes.get(input.threadId);
    if (existingEntry) {
      return existingEntry.runtime.identity;
    }

    const previousOperation = this.startOperations.get(input.threadId) ?? Promise.resolve();
    let finishOperation!: () => void;
    const currentGate = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });
    const currentOperation = previousOperation.catch(() => undefined).then(() => currentGate);
    this.startOperations.set(input.threadId, currentOperation);

    await previousOperation.catch(() => undefined);
    try {
      const existingEntryAfterWait = this.runtimes.get(input.threadId);
      if (existingEntryAfterWait) {
        return existingEntryAfterWait.runtime.identity;
      }
      return await this.startThreadUnsafe(input);
    } finally {
      finishOperation();
      if (this.startOperations.get(input.threadId) === currentOperation) {
        this.startOperations.delete(input.threadId);
      }
    }
  }

  private async startThreadUnsafe(input: RuntimeThreadStartInput) {
    this.disposeRuntime(input.threadId);
    try {
      const runtime = await ThreadAgentRuntime.create({
        threadId: input.threadId,
        cwd: input.cwd,
        agentDir: this.agentDir,
        ...(this.authStorage ? { authStorage: this.authStorage } : {}),
        extensionFactories: this.extensionFactories,
        extensionPaths: this.extensionPaths,
        browserAutomation: this.browserAutomation,
        policy: input.policy,
      });
      await this.installRuntime(runtime);
      return runtime.identity;
    } catch (error) {
      this.disposeRuntime(input.threadId);
      this.emit({ type: "snapshot", snapshot: await this.getHostSnapshot() });
      throw error;
    }
  }

  async cloneThread(input: ThreadAgentRuntimeCloneInput): Promise<void> {
    if (!this.runtimes.has(input.sourceThreadId)) {
      await this.startThread({
        threadId: input.sourceThreadId,
        cwd: input.cwd,
        policy: input.policy,
      });
    }

    const sourceEntry = this.runtimes.get(input.sourceThreadId);
    if (!sourceEntry) {
      throw new Error(`No runtime thread exists for ${input.sourceThreadId}.`);
    }

    this.disposeRuntime(input.targetThreadId);
    try {
      const runtime = await sourceEntry.runtime.cloneActiveBranch(input.targetThreadId);
      await this.installRuntime(runtime);
    } catch (error) {
      this.disposeRuntime(input.targetThreadId);
      this.emit({ type: "snapshot", snapshot: await this.getHostSnapshot() });
      throw error;
    }
  }

  async send(input: RuntimeThreadSendInput) {
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      throw new Error(`No runtime thread exists for ${input.threadId}.`);
    }
    return entry.runtime.sendMessage(input.input, {
      clientMessageId: input.clientMessageId,
      replacesClientMessageId: input.replacesClientMessageId ?? null,
      ...(input.parentEntryId !== undefined ? { parentEntryId: input.parentEntryId } : {}),
      interactionMode: input.interactionMode,
      sourceProposedPlan: input.sourceProposedPlan,
      images: input.images,
      expandPromptTemplates: null,
      source: null,
      streamingBehavior: input.streamingBehavior ?? null,
      ...(input.runtimeUserTurnStart ? { runtimeUserTurnStart: input.runtimeUserTurnStart } : {}),
    });
  }

  async hydrateThread(input: ThreadAgentRuntimeHydrateInput): Promise<void> {
    await this.startThread({
      threadId: input.threadId,
      cwd: input.cwd,
      policy: input.policy,
    });
  }

  async sendTurn(input: ThreadAgentRuntimeSendTurnInput) {
    if (!input.policy) {
      throw new Error("Runtime sendTurn requires AgentModelPolicy.");
    }
    const sendInputForRuntime = (runtime: ThreadAgentRuntime): RuntimeThreadSendInput => {
      const streamingBehavior = runtime.isBusy() ? (input.streamingBehavior ?? "followUp") : null;
      return {
        threadId: input.threadId,
        input: input.input,
        interactionMode: input.interactionMode,
        sourceProposedPlan: input.sourceProposedPlan,
        clientMessageId: input.clientMessageId,
        replacesClientMessageId: input.replacesClientMessageId,
        ...(!streamingBehavior && input.parentEntryId !== undefined
          ? { parentEntryId: input.parentEntryId }
          : {}),
        images: input.images,
        modelSelection: input.modelSelection,
        streamingBehavior,
        ...(streamingBehavior
          ? {
              runtimeUserTurnStart: {
                modelSelection: input.modelSelection,
                titleSeed: input.input,
              },
            }
          : {}),
      };
    };
    const startInput: RuntimeThreadStartInput = {
      threadId: input.threadId,
      cwd: input.cwd,
      policy: input.policy,
    };

    if (!this.runtimes.has(input.threadId)) {
      await this.startThread(startInput);
    }

    try {
      const entry = this.runtimes.get(input.threadId);
      if (!entry) {
        throw new Error(`No runtime thread exists for ${input.threadId}.`);
      }
      return await this.send(sendInputForRuntime(entry.runtime));
    } catch (error) {
      if (!isMissingRuntimeThreadError(error)) {
        throw error;
      }
    }

    await this.startThread(startInput);
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      throw new Error(`No runtime thread exists for ${input.threadId}.`);
    }
    return this.send(sendInputForRuntime(entry.runtime));
  }

  async enqueueFollowUp(input: ThreadAgentRuntimeQueueFollowUpInput): Promise<void> {
    const entry = await this.ensureRuntimeForQueuedFollowUp(input);
    entry.runtime.enqueueFollowUp(input);
  }

  async updateQueuedFollowUp(input: ThreadAgentRuntimeUpdateQueuedFollowUpInput): Promise<void> {
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      throw new Error(`No runtime thread exists for ${input.threadId}.`);
    }
    entry.runtime.updateQueuedFollowUp(input);
  }

  async removeQueuedFollowUp(input: ThreadAgentRuntimeQueuedFollowUpIdInput): Promise<void> {
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      return;
    }
    entry.runtime.removeQueuedFollowUp(input.clientMessageId);
  }

  async reorderQueuedFollowUp(input: ThreadAgentRuntimeReorderQueuedFollowUpInput): Promise<void> {
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      return;
    }
    entry.runtime.reorderQueuedFollowUp(
      input.clientMessageId,
      input.targetClientMessageId,
      input.insertAfter,
    );
  }

  async sendQueuedFollowUpNow(input: ThreadAgentRuntimeQueuedFollowUpIdInput): Promise<void> {
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      return;
    }
    await entry.runtime.sendQueuedFollowUpNow(input.clientMessageId);
  }

  async compactThread(input: ThreadAgentRuntimeCompactInput): Promise<void> {
    const startInput: RuntimeThreadStartInput = {
      threadId: input.threadId,
      cwd: input.cwd,
      policy: input.policy,
    };

    if (!this.runtimes.has(input.threadId)) {
      await this.startThread(startInput);
    }

    let entry = this.runtimes.get(input.threadId);
    if (!entry) {
      await this.startThread(startInput);
      entry = this.runtimes.get(input.threadId);
    }
    if (!entry) {
      throw new Error(`No runtime thread exists for ${input.threadId}.`);
    }

    await entry.runtime.compactContext(input.customInstructions);
  }

  async abort(input: ThreadAgentRuntimeAbortInput): Promise<void> {
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      throw new Error(`No runtime thread exists for ${input.threadId}.`);
    }
    await entry.runtime.abort();
  }

  async respondToExtensionUiRequest(input: DesktopExtensionUiRespondInput): Promise<void> {
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      throw new Error(`No runtime thread exists for ${input.threadId}.`);
    }
    entry.ui.resolveRequest(input.requestId, input.value);
    this.emit({ type: "pending-extension-ui", requests: this.getPendingExtensionUiRequests() });
    this.refreshDisplayTimeline(entry.runtime);
    this.scheduleDisplayTimelineEmit(entry.runtime.threadId);
  }

  async listSkills(input: RuntimeListSkillsInput): Promise<RuntimeListSkillsResult> {
    const resourceLoader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: this.agentDir,
      settingsManager: SettingsManager.create(input.cwd, this.agentDir, { projectTrusted: true }),
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    await resourceLoader.reload();
    const skills = resourceLoader.getSkills().skills.map(
      (skill): RuntimeSkillSummary => ({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        scope: skill.sourceInfo.scope === "user" ? "user" : "project",
      }),
    );
    return { skills };
  }

  async getThreadSessionFile(
    input: RuntimeGetThreadSessionFileInput,
  ): Promise<RuntimeGetThreadSessionFileResult> {
    const entry = this.runtimes.get(input.threadId);
    if (entry) {
      // A brand-new SessionManager names its file before the first persist, so only trust
      // live paths that exist on disk and fall through to the cold scan otherwise.
      const liveSessionFile = entry.runtime.session.sessionManager.getSessionFile();
      if (liveSessionFile && fileMtimeMs(liveSessionFile) !== null) {
        return { path: liveSessionFile };
      }
    }
    const sessionDir = join(
      this.agentDir,
      "honk-thread-sessions",
      encodeThreadIdForPath(input.threadId),
    );
    return { path: findNewestSessionFile(sessionDir) };
  }

  async setThreadFocus(input: ThreadAgentRuntimeSetThreadFocusInput): Promise<void> {
    if (input.focused) {
      this.focusedThreadIds.add(input.threadId);
      if (this.pendingDisplayTimelineDeadlines.has(input.threadId)) {
        this.flushDisplayTimelineEmit(input.threadId);
        this.rescheduleDisplayTimelineFlush();
      }
      return;
    }
    this.focusedThreadIds.delete(input.threadId);
  }

  onHostEvent(listener: (event: HonkRuntimeHostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    for (const threadId of this.runtimes.keys()) {
      this.disposeRuntime(threadId);
    }
    if (this.displayTimelineFlushHandle !== null) {
      clearTimeout(this.displayTimelineFlushHandle);
      this.displayTimelineFlushHandle = null;
      this.displayTimelineFlushDeadline = null;
    }
    this.pendingDisplayTimelineDeadlines.clear();
    this.focusedThreadIds.clear();
    this.listeners.clear();
  }

  private publishSessionTree(runtime: ThreadAgentRuntime): void {
    const canonicalThread = runtime.getCanonicalThread();
    const tree = canonicalThreadSessionTree(canonicalThread);
    this.sessionTrees.set(runtime.threadId, tree);
    this.emitRuntimeIngestionRecords(canonicalThread.bridgeFacts.map((fact) => fact.record));
    this.emit({ type: "session-tree", tree });
    this.refreshDisplayTimeline(runtime);
    this.scheduleDisplayTimelineEmit(runtime.threadId);
    this.emit({ type: "pending-extension-ui", requests: this.getPendingExtensionUiRequests() });
  }

  private async installRuntime(runtime: ThreadAgentRuntime): Promise<void> {
    const ui = createDesktopExtensionUi();
    const unsubscribeRuntime = runtime.subscribe((event) => {
      const wireEvent = toWireRuntimeEvent(event);
      this.recordRuntimeEvent(event, wireEvent);
      this.emit({ type: "runtime-event", event: wireEvent });
      this.emitRuntimeIngestionRecords(
        runtimeBridgeFactsForRuntimeEvent(event).map((fact) => fact.record),
      );
      this.applyRuntimeEventToDisplayTimeline(runtime, event);
      this.scheduleDisplayTimelineEmit(runtime.threadId);
      if (event.type === "session.started") {
        this.emit({
          type: "runtime-identities",
          identities: this.getRuntimeIdentities(),
          authStatuses: this.getAuthStatuses(),
        });
      }
      if (event.type === "tree.updated") {
        this.publishSessionTree(runtime);
      }
    });
    const unsubscribeUi = ui.onPendingRequestsChanged(() => {
      this.emit({ type: "pending-extension-ui", requests: this.getPendingExtensionUiRequests() });
      this.refreshDisplayTimeline(runtime);
      this.scheduleDisplayTimelineEmit(runtime.threadId);
    });
    const unsubscribeQueue = runtime.subscribeQueue(() => {
      this.emitQueuedFollowUps();
    });
    const unsubscribeIngestion = runtime.subscribeRuntimeIngestionRecords((records) => {
      this.emitRuntimeIngestionRecords(records);
    });
    const unsubscribe = () => {
      unsubscribeRuntime();
      unsubscribeUi();
      unsubscribeQueue();
      unsubscribeIngestion();
    };

    this.runtimes.set(runtime.threadId, { runtime, ui, unsubscribe });
    if (this.bindRuntimeExtensions) {
      await this.bindRuntimeExtensions(runtime, ui);
    } else {
      await runtime.bindExtensions(ui);
    }
    this.publishSessionTree(runtime);
    this.emit({
      type: "runtime-identities",
      identities: this.getRuntimeIdentities(),
      authStatuses: this.getAuthStatuses(),
    });
  }

  private scheduleDisplayTimelineEmit(threadId: string): void {
    const interval = this.focusedThreadIds.has(threadId)
      ? DISPLAY_TIMELINE_FLUSH_INTERVAL_MS
      : BACKGROUND_DISPLAY_TIMELINE_FLUSH_INTERVAL_MS;
    const deadline = Date.now() + interval;
    const existingDeadline = this.pendingDisplayTimelineDeadlines.get(threadId);
    if (existingDeadline === undefined || deadline < existingDeadline) {
      this.pendingDisplayTimelineDeadlines.set(threadId, deadline);
      if (
        this.displayTimelineFlushDeadline === null ||
        deadline < this.displayTimelineFlushDeadline
      ) {
        this.rescheduleDisplayTimelineFlush();
      }
    }
  }

  private flushDisplayTimelineEmits(): void {
    const now = Date.now();
    const threadIds: string[] = [];
    for (const [threadId, deadline] of this.pendingDisplayTimelineDeadlines) {
      if (deadline <= now) {
        threadIds.push(threadId);
      }
    }
    for (const threadId of threadIds) {
      this.flushDisplayTimelineEmit(threadId);
    }
    this.rescheduleDisplayTimelineFlush();
  }

  private flushDisplayTimelineEmit(threadId: string): void {
    this.pendingDisplayTimelineDeadlines.delete(threadId);
    const timeline = this.displayTimelines.get(threadId);
    if (timeline) {
      this.emit({ type: "display-timeline", timeline });
    }
  }

  private rescheduleDisplayTimelineFlush(): void {
    if (this.displayTimelineFlushHandle !== null) {
      clearTimeout(this.displayTimelineFlushHandle);
      this.displayTimelineFlushHandle = null;
    }
    this.displayTimelineFlushDeadline = null;
    let nextDeadline: number | null = null;
    for (const deadline of this.pendingDisplayTimelineDeadlines.values()) {
      if (nextDeadline === null || deadline < nextDeadline) {
        nextDeadline = deadline;
      }
    }
    if (nextDeadline === null) {
      return;
    }
    this.displayTimelineFlushDeadline = nextDeadline;
    this.displayTimelineFlushHandle = setTimeout(
      () => {
        this.displayTimelineFlushHandle = null;
        this.displayTimelineFlushDeadline = null;
        this.flushDisplayTimelineEmits();
      },
      Math.max(0, nextDeadline - Date.now()),
    );
  }

  private recordRuntimeEvent(event: AgentRuntimeEvent, wireEvent: AgentRuntimeEvent): void {
    boundedPush(this.runtimeEvents, wireEvent, MAX_RUNTIME_EVENTS_IN_SNAPSHOT);
    const threadEvents = this.runtimeEventsByThreadId.get(event.threadId);
    if (threadEvents) {
      boundedPush(threadEvents, event, MAX_RUNTIME_EVENTS_PER_THREAD);
    } else {
      this.runtimeEventsByThreadId.set(event.threadId, [event]);
    }
  }

  private getDisplayTimelines(): RuntimeDisplayTimelineProjection[] {
    return [...this.displayTimelines.values()];
  }

  private getRuntimeEventsSnapshot(): AgentRuntimeEvent[] {
    return this.runtimeEvents.length <= MAX_RUNTIME_EVENTS_IN_SNAPSHOT
      ? [...this.runtimeEvents]
      : this.runtimeEvents.slice(this.runtimeEvents.length - MAX_RUNTIME_EVENTS_IN_SNAPSHOT);
  }

  private getRuntimeIdentities(): RuntimeThreadIdentity[] {
    return [...this.runtimes.values()].map((entry) => {
      const identity = entry.runtime.identity;
      return {
        threadId: identity.threadId,
        runtimeSessionId: identity.runtimeSessionId,
        authProviderId: identity.authProviderId,
        modelId: identity.modelId,
      };
    });
  }

  private refreshDisplayTimeline(runtime: ThreadAgentRuntime): RuntimeDisplayTimelineProjection {
    const tree = this.sessionTrees.get(runtime.threadId) ?? runtime.getSessionTree();
    const timeline = projectRuntimeDisplayTimeline({
      threadId: runtime.threadId,
      runtimeSessionId: runtime.runtimeSessionId,
      sessionTree: tree,
      runtimeEvents: this.runtimeEventsByThreadId.get(runtime.threadId) ?? [],
      pendingExtensionUiRequests: this.getPendingExtensionUiRequestsForRuntime(runtime),
    });
    this.displayTimelines.set(runtime.threadId, timeline);
    return timeline;
  }

  private applyRuntimeEventToDisplayTimeline(
    runtime: ThreadAgentRuntime,
    event: AgentRuntimeEvent,
  ): RuntimeDisplayTimelineProjection {
    const sessionTree = this.sessionTreeForRuntimeEvent(runtime, event);
    const timeline = projectRuntimeDisplayTimelineEvent({
      previousTimeline: this.displayTimelines.get(runtime.threadId),
      threadId: runtime.threadId,
      runtimeSessionId: runtime.runtimeSessionId,
      sessionTree,
      event,
      pendingExtensionUiRequests: this.getPendingExtensionUiRequestsForRuntime(runtime),
    });
    this.displayTimelines.set(runtime.threadId, timeline);
    return timeline;
  }

  private sessionTreeForRuntimeEvent(
    runtime: ThreadAgentRuntime,
    event: AgentRuntimeEvent,
  ): SessionTreeProjection {
    if (event.type === "message.completed" && event.messageRole === "user") {
      const tree = runtime.getSessionTree();
      this.sessionTrees.set(runtime.threadId, tree);
      return tree;
    }
    return this.sessionTrees.get(runtime.threadId) ?? runtime.getSessionTree();
  }

  private getPendingExtensionUiRequestsForRuntime(
    runtime: ThreadAgentRuntime,
  ): DesktopExtensionUiRequest[] {
    const entry = this.runtimes.get(runtime.threadId);
    if (!entry) {
      return [];
    }
    return entry.ui.pendingRequests.map((request) => ({
      ...request,
      threadId: runtime.threadId,
      runtimeSessionId: runtime.runtimeSessionId,
    }));
  }

  private getPendingExtensionUiRequests(): DesktopExtensionUiRequest[] {
    return [...this.runtimes.values()].flatMap((entry) =>
      this.getPendingExtensionUiRequestsForRuntime(entry.runtime),
    );
  }

  private getQueuedFollowUps(): ThreadAgentRuntimeQueuedFollowUp[] {
    return [...this.runtimes.values()].flatMap((entry) => [...entry.runtime.getQueuedFollowUps()]);
  }

  private emitQueuedFollowUps(): void {
    this.emit({ type: "queued-follow-ups", items: this.getQueuedFollowUps() });
  }

  private emitRuntimeIngestionRecords(records: readonly RuntimeIngestionRecord[]): void {
    if (records.length === 0) {
      return;
    }
    this.emit({ type: "runtime-ingestion-records", records: records.map((record) => record) });
  }

  private async ensureRuntimeForQueuedFollowUp(
    input: ThreadAgentRuntimeQueueFollowUpInput,
  ): Promise<RuntimeEntry> {
    if (!this.runtimes.has(input.threadId)) {
      await this.startThread({
        threadId: input.threadId,
        cwd: input.cwd,
        policy: input.policy,
      });
    }
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      throw new Error(`No runtime thread exists for ${input.threadId}.`);
    }
    return entry;
  }

  private getModelDescriptors(): AgentRuntimeModelDescriptor[] {
    if (!this.modelRegistry) {
      return [];
    }

    return this.modelRegistry
      .getAll()
      .filter((model) => isHonkPiSupportedProviderId(model.provider))
      .map((model) => {
        const supportedThinkingLevels = new Set<string>(getSupportedThinkingLevels(model));
        return {
          authProviderId: AuthProviderId.make(model.provider),
          modelId: ModelId.make(`${model.provider}/${model.id}`),
          provider: model.provider,
          id: model.id,
          name: model.name.trim() || model.id,
          reasoning: model.reasoning,
          contextWindow: model.contextWindow,
          thinkingLevels: AGENT_THINKING_LEVELS.filter((level) =>
            supportedThinkingLevels.has(level),
          ),
        };
      });
  }

  private getAuthStatuses(): AgentAuthStatus[] {
    const updatedAt = new Date().toISOString();
    const statuses: AgentAuthStatus[] = [];

    for (const credential of this.preferences.credentials) {
      const status =
        this.modelRegistry?.getProviderAuthStatus(credential.authProviderId) ??
        this.authStorage?.getAuthStatus(credential.authProviderId);
      const storedCredential = this.authStorage?.get(credential.authProviderId);
      const hasStoredCredential = credentialKindMatchesStoredCredential(
        credential.kind,
        storedCredential,
      );
      const hasExternalCredential =
        storedCredential === undefined &&
        !isOAuthAgentCredentialKind(credential.kind) &&
        status?.source !== undefined;
      const hasCredential = hasStoredCredential || hasExternalCredential;
      statuses.push({
        authProviderId: credential.authProviderId,
        credentialKind: credential.kind,
        accountId: credential.accountId,
        state: hasCredential ? "available" : "missing",
        label: credential.label,
        message: hasCredential ? describeAuthSource(status) : null,
        updatedAt,
      });
    }

    for (const entry of this.runtimes.values()) {
      const status = entry.runtime.authStatus;
      if (status) {
        statuses.push(status);
      }
    }

    return statuses;
  }

  private emit(event: HonkRuntimeHostEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private disposeRuntime(threadId: string): void {
    const entry = this.runtimes.get(threadId);
    if (!entry) {
      return;
    }
    entry.ui.dispose();
    entry.unsubscribe();
    entry.runtime.dispose();
    this.runtimes.delete(threadId);
    this.sessionTrees.delete(threadId);
    this.runtimeEventsByThreadId.delete(threadId);
    this.displayTimelines.delete(threadId);
    this.pendingDisplayTimelineDeadlines.delete(threadId);
    this.focusedThreadIds.delete(threadId);
    this.rescheduleDisplayTimelineFlush();
    this.emitQueuedFollowUps();
    for (let index = this.runtimeEvents.length - 1; index >= 0; index -= 1) {
      if (this.runtimeEvents[index]?.threadId === threadId) {
        this.runtimeEvents.splice(index, 1);
      }
    }
  }
}

function isMissingRuntimeThreadError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No runtime thread exists");
}

function fileMtimeMs(path: string): number | null {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.mtimeMs : null;
  } catch {
    return null;
  }
}

function findNewestSessionFile(sessionDir: string): string | null {
  let fileNames: string[];
  try {
    fileNames = readdirSync(sessionDir);
  } catch {
    return null;
  }
  let newestPath: string | null = null;
  let newestMtimeMs = Number.NEGATIVE_INFINITY;
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".jsonl")) {
      continue;
    }
    const filePath = join(sessionDir, fileName);
    const mtimeMs = fileMtimeMs(filePath);
    if (mtimeMs !== null && mtimeMs > newestMtimeMs) {
      newestMtimeMs = mtimeMs;
      newestPath = filePath;
    }
  }
  return newestPath;
}
