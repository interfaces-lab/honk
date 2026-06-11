import { join } from "node:path";
import {
  AuthProviderId,
  DEFAULT_AGENT_POLICY_MODEL_SELECTION,
  DEFAULT_AGENT_RESOURCE_PREFERENCES,
  AGENT_THINKING_LEVELS,
  type AgentCredentialAuthFlow,
  type AgentCredentialConfigureInput,
  type AgentAuthStatus,
  type AgentCredentialKind,
  type AgentRuntimeModelDescriptor,
  type AgentPreferences,
  type AgentPreferencesPatch,
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type DesktopExtensionUiRespondInput,
  ModelId,
  type MultiRuntimeApi,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
  type RuntimeDisplayTimelineProjection,
  type SessionTreeProjection,
  type ThreadAgentRuntimeAbortInput,
  type ThreadAgentRuntimeHydrateInput,
  type ThreadAgentRuntimeSendTurnInput,
} from "@multi/contracts";
import { getSupportedThinkingLevels, type OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  ModelRegistry,
  type AuthCredential,
  type AuthStatus,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { createDesktopExtensionUi, type DesktopExtensionUiController } from "./extension-ui";
import { createDesktopAgentExtensionFactories } from "./desktop-agent-extensions";
import { applyFffEnvironment, resolveFffExtensionPaths } from "./fff-extension";
import { ThreadAgentRuntime } from "./thread-agent-runtime";
import {
  projectRuntimeDisplayTimeline,
  projectRuntimeDisplayTimelineEvent,
} from "./display-timeline-projection";

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
      return "Stored in Pi auth storage.";
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

function isOAuthCredentialKind(credentialKind: AgentCredentialKind): boolean {
  return credentialKind === "claude-oauth" || credentialKind === "codex-oauth";
}

function credentialKindMatchesStoredCredential(
  credentialKind: AgentCredentialKind,
  storedCredential: AuthCredential | undefined,
): boolean {
  const expectedType = isOAuthCredentialKind(credentialKind) ? "oauth" : "api_key";
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
  "threadId" | "input" | "interactionMode" | "sourceProposedPlan" | "clientMessageId" | "images"
>;

export interface DesktopRuntimeHostOptions {
  readonly preferences?: AgentPreferences | null;
  readonly agentDir: string;
  readonly authStorage?: AuthStorage | null;
  readonly extensionFactories?: readonly ExtensionFactory[] | null;
  readonly extensionPaths?: readonly string[] | null;
  readonly bindExtensions?:
    | ((runtime: ThreadAgentRuntime, ui: DesktopExtensionUiController) => Promise<void>)
    | null;
}

export class DesktopRuntimeHost implements MultiRuntimeApi {
  private preferences: AgentPreferences;
  private readonly agentDir: string;
  private readonly authStorage: AuthStorage | null;
  private readonly modelRegistry: ModelRegistry | null;
  private readonly extensionFactories: readonly ExtensionFactory[];
  private readonly extensionPaths: readonly string[];
  private readonly bindRuntimeExtensions:
    | ((runtime: ThreadAgentRuntime, ui: DesktopExtensionUiController) => Promise<void>)
    | null;
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly runtimeEvents: AgentRuntimeEvent[] = [];
  private readonly runtimeEventsByThreadId = new Map<string, AgentRuntimeEvent[]>();
  private readonly sessionTrees = new Map<string, SessionTreeProjection>();
  private readonly displayTimelines = new Map<string, RuntimeDisplayTimelineProjection>();
  private readonly credentialAuthFlows = new Map<string, AgentCredentialAuthFlow>();
  private readonly listeners = new Set<(event: MultiRuntimeHostEvent) => void>();
  private readonly startOperations = new Map<string, Promise<void>>();
  private readonly pendingDisplayTimelineThreadIds = new Set<string>();
  private displayTimelineFlushHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DesktopRuntimeHostOptions) {
    if (options.agentDir.trim().length === 0) {
      throw new Error("DesktopRuntimeHost requires a Multi agent directory.");
    }

    this.preferences = options?.preferences ?? DEFAULT_AGENT_PREFERENCES;
    this.agentDir = options.agentDir;
    applyFffEnvironment();
    this.authStorage =
      options.authStorage === undefined
        ? AuthStorage.create(join(this.agentDir, "auth.json"))
        : options.authStorage;
    this.modelRegistry = this.authStorage
      ? ModelRegistry.create(this.authStorage, join(this.agentDir, "models.json"))
      : null;
    this.extensionFactories =
      options.extensionFactories ??
      createDesktopAgentExtensionFactories({ agentDir: this.agentDir });
    this.extensionPaths =
      options.extensionPaths === undefined
        ? resolveFffExtensionPaths()
        : (options.extensionPaths ?? []);
    this.bindRuntimeExtensions = options?.bindExtensions ?? null;
  }

  async getHostSnapshot(): Promise<MultiRuntimeHostSnapshot> {
    return {
      preferences: this.preferences,
      models: this.getModelDescriptors(),
      authStatuses: this.getAuthStatuses(),
      credentialAuthFlows: [...this.credentialAuthFlows.values()],
      diagnostics: [],
      runtimeEvents: this.getRuntimeEventsSnapshot(),
      sessionTrees: [...this.sessionTrees.values()],
      displayTimelines: this.getDisplayTimelines(),
      pendingExtensionUiRequests: this.getPendingExtensionUiRequests(),
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
  ): Promise<MultiRuntimeHostSnapshot> {
    if (!this.authStorage) {
      throw new Error("Pi auth storage is unavailable.");
    }

    switch (input.method) {
      case "api-key":
        this.authStorage.set(input.authProviderId, { type: "api_key", key: input.apiKey });
        this.clearCredentialAuthFlow(input.authProviderId);
        break;
      case "oauth":
        if (!callbacks) {
          throw new Error("OAuth login callbacks are unavailable.");
        }
        await this.loginCredential(input.authProviderId, input.credentialKind ?? null, callbacks);
        break;
      case "logout":
        this.authStorage.logout(input.authProviderId);
        this.clearCredentialAuthFlow(input.authProviderId);
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
        policy: input.policy,
      });
      const ui = createDesktopExtensionUi();
      const unsubscribeRuntime = runtime.subscribe((event) => {
        this.recordRuntimeEvent(event);
        this.emit({ type: "runtime-event", event });
        this.applyRuntimeEventToDisplayTimeline(runtime, event);
        this.scheduleDisplayTimelineEmit(runtime.threadId);
        if (event.type === "tree.updated") {
          this.publishSessionTree(runtime);
        }
      });
      const unsubscribeUi = ui.onPendingRequestsChanged(() => {
        this.emit({ type: "pending-extension-ui", requests: this.getPendingExtensionUiRequests() });
        this.refreshDisplayTimeline(runtime);
        this.scheduleDisplayTimelineEmit(runtime.threadId);
      });
      const unsubscribe = () => {
        unsubscribeRuntime();
        unsubscribeUi();
      };

      this.runtimes.set(input.threadId, { runtime, ui, unsubscribe });
      if (this.bindRuntimeExtensions) {
        await this.bindRuntimeExtensions(runtime, ui);
      } else {
        await runtime.bindExtensions(ui);
      }
      this.publishSessionTree(runtime);
      this.emit({ type: "snapshot", snapshot: await this.getHostSnapshot() });
      return runtime.identity;
    } catch (error) {
      this.disposeRuntime(input.threadId);
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
      interactionMode: input.interactionMode,
      sourceProposedPlan: input.sourceProposedPlan,
      images: input.images,
      expandPromptTemplates: null,
      source: null,
      streamingBehavior: null,
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
    const sendInput: RuntimeThreadSendInput = {
      threadId: input.threadId,
      input: input.input,
      interactionMode: input.interactionMode,
      sourceProposedPlan: input.sourceProposedPlan,
      clientMessageId: input.clientMessageId,
      images: input.images,
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
      return await this.send(sendInput);
    } catch (error) {
      if (!isMissingRuntimeThreadError(error)) {
        throw error;
      }
    }

    await this.startThread(startInput);
    return this.send(sendInput);
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

  onHostEvent(listener: (event: MultiRuntimeHostEvent) => void): () => void {
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
    }
    this.pendingDisplayTimelineThreadIds.clear();
    this.listeners.clear();
  }

  private publishSessionTree(runtime: ThreadAgentRuntime): void {
    const tree = runtime.getSessionTree();
    this.sessionTrees.set(runtime.threadId, tree);
    this.emit({ type: "session-tree", tree });
    this.refreshDisplayTimeline(runtime);
    this.scheduleDisplayTimelineEmit(runtime.threadId);
    this.emit({ type: "pending-extension-ui", requests: this.getPendingExtensionUiRequests() });
  }

  private scheduleDisplayTimelineEmit(threadId: string): void {
    this.pendingDisplayTimelineThreadIds.add(threadId);
    if (this.displayTimelineFlushHandle === null) {
      this.displayTimelineFlushHandle = setTimeout(() => {
        this.displayTimelineFlushHandle = null;
        this.flushDisplayTimelineEmits();
      }, DISPLAY_TIMELINE_FLUSH_INTERVAL_MS);
    }
  }

  private flushDisplayTimelineEmits(): void {
    const threadIds = [...this.pendingDisplayTimelineThreadIds];
    this.pendingDisplayTimelineThreadIds.clear();
    for (const threadId of threadIds) {
      const timeline = this.displayTimelines.get(threadId);
      if (timeline) {
        this.emit({ type: "display-timeline", timeline });
      }
    }
  }

  private recordRuntimeEvent(event: AgentRuntimeEvent): void {
    boundedPush(this.runtimeEvents, event, MAX_RUNTIME_EVENTS_IN_SNAPSHOT);
    const threadEvents = this.runtimeEventsByThreadId.get(event.threadId);
    if (threadEvents) {
      boundedPush(threadEvents, event, MAX_RUNTIME_EVENTS_PER_THREAD);
    } else {
      this.runtimeEventsByThreadId.set(event.threadId, [event]);
    }
  }

  private getDisplayTimelines(): RuntimeDisplayTimelineProjection[] {
    for (const entry of this.runtimes.values()) {
      this.refreshDisplayTimeline(entry.runtime);
    }
    return [...this.displayTimelines.values()];
  }

  private getRuntimeEventsSnapshot(): AgentRuntimeEvent[] {
    return this.runtimeEvents.length <= MAX_RUNTIME_EVENTS_IN_SNAPSHOT
      ? [...this.runtimeEvents]
      : this.runtimeEvents.slice(this.runtimeEvents.length - MAX_RUNTIME_EVENTS_IN_SNAPSHOT);
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
    const timeline = projectRuntimeDisplayTimelineEvent({
      previousTimeline: this.displayTimelines.get(runtime.threadId),
      threadId: runtime.threadId,
      runtimeSessionId: runtime.runtimeSessionId,
      sessionTree: this.sessionTrees.get(runtime.threadId) ?? runtime.getSessionTree(),
      event,
      pendingExtensionUiRequests: this.getPendingExtensionUiRequestsForRuntime(runtime),
    });
    this.displayTimelines.set(runtime.threadId, timeline);
    return timeline;
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

  private getModelDescriptors(): AgentRuntimeModelDescriptor[] {
    if (!this.modelRegistry) {
      return [];
    }

    return this.modelRegistry.getAll().map((model) => {
      const supportedThinkingLevels = new Set<string>(getSupportedThinkingLevels(model));
      return {
        authProviderId: AuthProviderId.make(model.provider),
        modelId: ModelId.make(`${model.provider}/${model.id}`),
        provider: model.provider,
        id: model.id,
        name: model.name.trim() || model.id,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        thinkingLevels: AGENT_THINKING_LEVELS.filter((level) => supportedThinkingLevels.has(level)),
      };
    });
  }

  private getAuthStatuses(): AgentAuthStatus[] {
    const updatedAt = new Date().toISOString();
    const statuses: AgentAuthStatus[] = [];

    for (const credential of this.preferences.credentials) {
      const status = this.authStorage?.getAuthStatus(credential.authProviderId);
      const storedCredential = this.authStorage?.get(credential.authProviderId);
      const hasStoredCredential = credentialKindMatchesStoredCredential(
        credential.kind,
        storedCredential,
      );
      const hasExternalCredential =
        storedCredential === undefined &&
        !isOAuthCredentialKind(credential.kind) &&
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

  private emit(event: MultiRuntimeHostEvent): void {
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
    this.pendingDisplayTimelineThreadIds.delete(threadId);
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
