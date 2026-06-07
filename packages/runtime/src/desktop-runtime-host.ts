import { join } from "node:path";
import {
  AuthProviderId,
  DEFAULT_AGENT_RESOURCE_PREFERENCES,
  type AgentCredentialAuthFlow,
  type AgentCredentialConfigureInput,
  type AgentAuthStatus,
  type AgentPreferences,
  type AgentPreferencesPatch,
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type DesktopExtensionUiRespondInput,
  type MultiRuntimeApi,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
  type RuntimeDisplayTimelineProjection,
  type SessionTreeProjection,
  type ThreadAgentRuntimeAbortInput,
  type ThreadAgentRuntimeHydrateInput,
  type ThreadAgentRuntimeSendTurnInput,
} from "@multi/contracts";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { AuthStorage, type AuthStatus, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createDesktopExtensionUi, type DesktopExtensionUiController } from "./extension-ui";
import { createDesktopAgentExtensionFactories } from "./desktop-agent-extensions";
import { ThreadAgentRuntime } from "./thread-agent-runtime";
import {
  projectRuntimeDisplayTimeline,
  projectRuntimeDisplayTimelineEvent,
} from "./display-timeline-projection";

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

const MAX_RUNTIME_EVENTS_IN_SNAPSHOT = 500;

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

interface RuntimeEntry {
  readonly runtime: ThreadAgentRuntime;
  readonly ui: DesktopExtensionUiController;
  readonly unsubscribe: () => void;
}

type RuntimeThreadStartInput = Pick<
  ThreadAgentRuntimeSendTurnInput,
  "threadId" | "cwd" | "policy"
>;

type RuntimeThreadSendInput = Pick<
  ThreadAgentRuntimeSendTurnInput,
  "threadId" | "input" | "interactionMode" | "sourceProposedPlan" | "clientMessageId" | "images"
>;

export interface DesktopRuntimeHostOptions {
  readonly preferences?: AgentPreferences | null;
  readonly agentDir: string;
  readonly authStorage?: AuthStorage | null;
  readonly extensionFactories?: readonly ExtensionFactory[] | null;
  readonly bindExtensions?:
    | ((runtime: ThreadAgentRuntime, ui: DesktopExtensionUiController) => Promise<void>)
    | null;
}

export class DesktopRuntimeHost implements MultiRuntimeApi {
  private preferences: AgentPreferences;
  private readonly agentDir: string;
  private readonly authStorage: AuthStorage | null;
  private readonly extensionFactories: readonly ExtensionFactory[];
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

  constructor(options: DesktopRuntimeHostOptions) {
    if (options.agentDir.trim().length === 0) {
      throw new Error("DesktopRuntimeHost requires a Multi agent directory.");
    }

    this.preferences = options?.preferences ?? DEFAULT_AGENT_PREFERENCES;
    this.agentDir = options.agentDir;
    this.authStorage =
      options.authStorage === undefined
        ? AuthStorage.create(join(this.agentDir, "auth.json"))
        : options.authStorage;
    this.extensionFactories =
      options.extensionFactories ??
      createDesktopAgentExtensionFactories({ agentDir: this.agentDir });
    this.bindRuntimeExtensions = options?.bindExtensions ?? null;
  }

  async getHostSnapshot(): Promise<MultiRuntimeHostSnapshot> {
    return {
      preferences: this.preferences,
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
        await this.loginCredential(input.authProviderId, callbacks);
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
    callbacks: OAuthLoginCallbacks,
  ): Promise<void> {
    this.setCredentialAuthFlow({
      authProviderId,
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
        policy: input.policy,
      });
      const ui = createDesktopExtensionUi();
      const unsubscribeRuntime = runtime.subscribe((event) => {
        this.runtimeEvents.push(event);
        this.pushRuntimeEventForThread(event);
        this.emit({ type: "runtime-event", event });
        this.emit({
          type: "display-timeline",
          timeline: this.applyRuntimeEventToDisplayTimeline(runtime, event),
        });
        if (event.type === "tree.updated") {
          this.publishSessionTree(runtime);
        }
      });
      const unsubscribeUi = ui.onPendingRequestsChanged(() => {
        this.emit({ type: "pending-extension-ui", requests: this.getPendingExtensionUiRequests() });
        this.emit({ type: "display-timeline", timeline: this.refreshDisplayTimeline(runtime) });
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
    this.emit({ type: "display-timeline", timeline: this.refreshDisplayTimeline(entry.runtime) });
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
    this.listeners.clear();
  }

  private publishSessionTree(runtime: ThreadAgentRuntime): void {
    const tree = runtime.getSessionTree();
    this.sessionTrees.set(runtime.threadId, tree);
    this.emit({ type: "session-tree", tree });
    this.emit({ type: "display-timeline", timeline: this.refreshDisplayTimeline(runtime) });
    this.emit({ type: "pending-extension-ui", requests: this.getPendingExtensionUiRequests() });
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

  private pushRuntimeEventForThread(event: AgentRuntimeEvent): void {
    const events = this.runtimeEventsByThreadId.get(event.threadId);
    if (events) {
      events.push(event);
      return;
    }
    this.runtimeEventsByThreadId.set(event.threadId, [event]);
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

  private getAuthStatuses(): AgentAuthStatus[] {
    const updatedAt = new Date().toISOString();
    const byProvider = new Map<string, AgentAuthStatus>();

    for (const credential of this.preferences.credentials) {
      const status = this.authStorage?.getAuthStatus(credential.authProviderId);
      const hasCredential = status?.configured === true || status?.source !== undefined;
      byProvider.set(credential.authProviderId, {
        authProviderId: credential.authProviderId,
        accountId: credential.accountId,
        state: hasCredential ? "available" : "missing",
        label: credential.label,
        message: describeAuthSource(status),
        updatedAt,
      });
    }

    for (const entry of this.runtimes.values()) {
      const status = entry.runtime.authStatus;
      if (status) {
        byProvider.set(status.authProviderId, status);
      }
    }

    return [...byProvider.values()];
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
