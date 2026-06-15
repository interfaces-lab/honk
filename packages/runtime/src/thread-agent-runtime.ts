import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AccountId,
  AgentModelPolicy,
  AgentInteractionMode,
  AgentRuntimeEvent,
  AuthProviderId,
  MessageId,
  ModelId,
  RuntimeSessionId,
  SessionTreeProjection,
  SourceProposedPlanReference,
  ThreadAgentRuntimeImageAttachment,
  ThreadId,
  ThreadTokenUsageSnapshot,
  TurnId,
} from "@honk/contracts";
import { threadEntryIdForMessageId, type ThreadEntryId } from "@honk/contracts";
import {
  AuthStorage,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ExtensionFactory,
  type PromptOptions,
  type ResourceLoader,
  type SessionEntry,
  type ToolDefinition,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  authProviderIdFromPiModel,
  createAuthStatus,
  createModelPolicy,
  modelIdFromPiModel,
  thinkingLevelForAgentMode,
} from "./auth-model-policy";
import {
  createContextUsageExtension,
  type ContextUsageSnapshotSink,
} from "./context-usage-extension";
import { createCodexRuntimePolicyExtension } from "./codex-runtime-policy-extension";
import { createDesktopExtensionUi, type DesktopExtensionUiController } from "./extension-ui";
import { makeRuntimeEventId, makeRuntimeSessionId, makeTurnId } from "./ids";
import { projectPiAgentSessionEvent } from "./event-projection";
import { extractMessageText } from "./message-text";
import { DEBUG_LOGS_TOOL_NAME } from "./debug-logs-extension";
import { CREATE_PLAN_TOOL_NAME, extractCreatePlanToolResultMarkdown } from "./plan-extension";
import {
  CLIENT_MESSAGE_ID_SIDECAR_TYPE,
  collectClientMessageIdSidecars,
  projectRuntimeSessionTree,
} from "./session-tree-projection";

const DEFAULT_EXCLUDED_TOOL_NAMES: readonly string[] = [];
const PI_DEFAULT_SYSTEM_PROMPT_IDENTITY =
  "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
const HONK_SYSTEM_PROMPT_IDENTITY =
  "You are Honk, an AI coding assistant. You help users by reading files, executing commands, editing code, and writing new files.";

export interface ThreadAgentRuntimeIdentity {
  readonly agentRuntime: "pi";
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly authProviderId: AuthProviderId | null;
  readonly accountId: AccountId | null;
  readonly modelId: ModelId | null;
}

export interface ThreadAgentRuntimeOptions {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly agentDir: string;
  readonly model?: Model<string>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly scopedModels?: ReadonlyArray<{
    readonly model: Model<string>;
    readonly thinkingLevel?: ThinkingLevel;
  }>;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly customTools?: readonly ToolDefinition[];
  readonly extensionFactories?: readonly ExtensionFactory[];
  readonly extensionPaths?: readonly string[];
  readonly resourceLoader?: ResourceLoader;
  readonly authStorage?: AuthStorage;
  readonly modelRegistry?: CreateAgentSessionOptions["modelRegistry"];
  readonly sessionManager?: CreateAgentSessionOptions["sessionManager"];
  readonly policy: AgentModelPolicy;
}

export interface SendMessageOptions {
  readonly clientMessageId: MessageId | null;
  readonly replacesClientMessageId: MessageId | null;
  readonly parentEntryId?: ThreadEntryId | null;
  readonly interactionMode: AgentInteractionMode;
  readonly sourceProposedPlan: SourceProposedPlanReference | null;
  readonly images: readonly ThreadAgentRuntimeImageAttachment[];
  readonly expandPromptTemplates: NonNullable<PromptOptions["expandPromptTemplates"]> | null;
  readonly source: NonNullable<PromptOptions["source"]> | null;
  readonly streamingBehavior: "steer" | "followUp" | null;
}

export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void;

interface PendingInteractionMode {
  readonly sequence: number;
  readonly mode: AgentInteractionMode;
  consumed: boolean;
}

interface PendingPromptClientMessage {
  readonly text: string;
  readonly clientMessageId: MessageId;
  readonly entryIdsBeforePrompt: ReadonlySet<string>;
}

interface InteractionModeQueue {
  readonly enqueue: (mode: AgentInteractionMode) => PendingInteractionMode;
  readonly consume: () => AgentInteractionMode;
  readonly remove: (pending: PendingInteractionMode) => void;
}

interface BindableContextUsageSink extends ContextUsageSnapshotSink {
  readonly bind: (listener: (snapshot: ThreadTokenUsageSnapshot) => void) => void;
}

function createBindableContextUsageSink(): BindableContextUsageSink {
  const buffered: ThreadTokenUsageSnapshot[] = [];
  let listener: ((snapshot: ThreadTokenUsageSnapshot) => void) | null = null;
  return {
    publish(snapshot) {
      if (listener) {
        listener(snapshot);
        return;
      }
      buffered.push(snapshot);
    },
    bind(next) {
      listener = next;
      for (const snapshot of buffered.splice(0)) {
        next(snapshot);
      }
    },
  };
}

export class ThreadAgentRuntime {
  private readonly listeners = new Set<AgentRuntimeEventListener>();
  private readonly unsubscribeSessionEvents: () => void;
  private readonly clientMessageIdByEntryId = new Map<string, MessageId>();
  private readonly turnIdByEntryId = new Map<string, TurnId>();
  private readonly pendingMessageTurnIds: TurnId[] = [];
  private readonly pendingPromptClientMessages: PendingPromptClientMessage[] = [];
  private eventSequence = 0;
  private turnSequence = 0;
  private pendingFirstTurnId: TurnId | undefined;
  private activeTurnId: TurnId | undefined;
  private activeRunFirstTurnId: TurnId | undefined;
  private readonly sourceProposedPlanByTurnId = new Map<
    TurnId,
    SourceProposedPlanReference | null
  >();
  private readonly proposedPlanTurnIds = new Set<TurnId>();
  private readonly deferredEvents: AgentRuntimeEvent[] = [];

  private constructor(
    readonly threadId: ThreadId,
    private readonly options: ThreadAgentRuntimeOptions,
    private readonly sessionResult: Awaited<ReturnType<typeof createAgentSession>>,
    readonly policy: AgentModelPolicy,
    private readonly interactionModeQueue: InteractionModeQueue,
    contextUsageSink?: BindableContextUsageSink,
  ) {
    contextUsageSink?.bind((snapshot) => {
      this.emitOrDefer(
        this.createEvent(
          "context-window.updated",
          "Context usage updated",
          this.activeTurnId ?? this.activeRunFirstTurnId,
          snapshot,
        ),
      );
    });
    this.unsubscribeSessionEvents = sessionResult.session.subscribe((event) => {
      this.handlePiSessionEvent(event);
    });
  }

  static async create(options: ThreadAgentRuntimeOptions): Promise<ThreadAgentRuntime> {
    const policyThinkingLevel =
      options.policy.thinkingLevel ?? thinkingLevelForAgentMode(options.policy.agentMode);
    const effectiveThinkingLevel = options.thinkingLevel ?? policyThinkingLevel;
    const authStorage =
      options.authStorage ?? AuthStorage.create(join(options.agentDir, "auth.json"));
    const modelRegistry =
      options.modelRegistry ??
      ModelRegistry.create(authStorage, join(options.agentDir, "models.json"));
    const interactionModeQueue = createInteractionModeQueue();
    const contextUsageSink = createBindableContextUsageSink();
    const settingsManager = SettingsManager.create(options.cwd, options.agentDir, {
      projectTrusted: true,
    });
    const sessionOptions: CreateAgentSessionOptions = {
      cwd: options.cwd,
    };
    sessionOptions.agentDir = options.agentDir;
    const sessionManager =
      options.sessionManager ??
      createThreadSessionManager(options.threadId, options.cwd, options.agentDir);
    sessionOptions.sessionManager = sessionManager;
    // A thread is pinned to one model: a continued session restores its own persisted
    // model and thinking level, so the policy only seeds brand-new sessions. An explicit
    // options.model (subagents) still wins.
    const isNewSession = sessionManager.buildSessionContext().messages.length === 0;
    if (isNewSession || options.model) {
      const effectiveModel = resolvePolicyModel({
        policy: options.policy,
        model: options.model,
        modelRegistry,
      });
      if (effectiveModel) sessionOptions.model = effectiveModel;
      if (effectiveThinkingLevel) {
        sessionOptions.thinkingLevel = effectiveThinkingLevel;
      }
    }
    if (options.scopedModels) sessionOptions.scopedModels = [...options.scopedModels];
    if (options.tools) sessionOptions.tools = [...options.tools];
    const excludeTools = mergeExcludedToolNames(options.excludeTools);
    sessionOptions.excludeTools = excludeTools;
    if (options.customTools) sessionOptions.customTools = [...options.customTools];
    if (options.resourceLoader) sessionOptions.resourceLoader = options.resourceLoader;
    sessionOptions.modelRegistry = modelRegistry;
    sessionOptions.settingsManager = settingsManager;
    if (!options.resourceLoader) {
      const resourceLoader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir: options.agentDir,
        settingsManager,
        additionalExtensionPaths: [...(options.extensionPaths ?? [])],
        extensionFactories: [
          createHonkSystemPromptIdentityExtension(),
          createCodexRuntimePolicyExtension(options.policy),
          ...(options.extensionFactories ?? []),
          createInteractionModeExtension(interactionModeQueue),
          createContextUsageExtension(contextUsageSink),
        ],
        ...(options.extensionFactories
          ? {
              noExtensions: true,
              noPromptTemplates: true,
              noThemes: true,
            }
          : {}),
      });
      await resourceLoader.reload();
      warnExtensionLoadErrors(resourceLoader.getExtensions().errors);
      sessionOptions.resourceLoader = resourceLoader;
    }
    sessionOptions.authStorage = authStorage;

    const sessionResult = await createAgentSession(sessionOptions);
    let runtime: ThreadAgentRuntime | undefined;
    try {
      const model = sessionResult.session.model as Model<string> | undefined;
      const policyInput = {
        ...(model ? { model } : {}),
        agentMode: options.policy.agentMode,
        interactionMode: options.policy.interactionMode,
        thinkingLevel: sessionResult.session.thinkingLevel,
        fast: options.policy.fast,
        ...(options.tools ? { allowedToolNames: options.tools } : {}),
        excludedToolNames: excludeTools,
      };
      // The session's (possibly restored) model is authoritative, so the stored policy
      // reflects actual session state rather than the caller's preferences.
      const policy = createModelPolicy(policyInput);

      runtime = new ThreadAgentRuntime(
        options.threadId,
        options,
        sessionResult,
        policy,
        interactionModeQueue,
        contextUsageSink,
      );
      runtime.hydrateClientMessageIdSidecars();
      runtime.emit(runtime.createEvent("session.started", "Pi session created"));
      runtime.emit(runtime.createEvent("session.ready", sessionResult.modelFallbackMessage));
      return runtime;
    } catch (error) {
      if (runtime) {
        runtime.dispose();
      } else {
        sessionResult.session.dispose();
      }
      throw error;
    }
  }

  get session() {
    return this.sessionResult.session;
  }

  get extensionsResult() {
    return this.sessionResult.extensionsResult;
  }

  get runtimeSessionId() {
    return makeRuntimeSessionId(this.session.sessionId);
  }

  get identity(): ThreadAgentRuntimeIdentity {
    const model = this.session.model as Model<string> | undefined;
    return {
      agentRuntime: "pi",
      threadId: this.threadId,
      runtimeSessionId: this.runtimeSessionId,
      authProviderId: model ? authProviderIdFromPiModel(model) : null,
      accountId: null,
      modelId: model ? modelIdFromPiModel(model) : null,
    };
  }

  get authStatus() {
    const model = this.session.model as Model<string> | undefined;
    if (!model) {
      return undefined;
    }
    const authProviderId = authProviderIdFromPiModel(model);
    return createAuthStatus({
      authProviderId,
      hasCredential: this.session.modelRegistry.hasConfiguredAuth(model),
    });
  }

  subscribe(listener: AgentRuntimeEventListener): () => void {
    this.listeners.add(listener);
    for (const event of this.deferredEvents.splice(0)) {
      this.emit(event);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  async bindExtensions(ui = createDesktopExtensionUi()): Promise<DesktopExtensionUiController> {
    const bindings = {
      uiContext: ui.context,
      commandContextActions: {
        waitForIdle: () => this.session.agent.waitForIdle(),
        newSession: async () => ({ cancelled: false }),
        fork: async () => ({ cancelled: false }),
        navigateTree: async () => ({ cancelled: false }),
        switchSession: async () => ({ cancelled: false }),
        reload: async () => {},
      },
    };
    await this.session.bindExtensions(bindings);
    return ui;
  }

  async sendMessage(text: string, options: SendMessageOptions): Promise<TurnId> {
    if (options.parentEntryId !== undefined) {
      this.prepareParentBranch(options.parentEntryId);
    } else if (options.replacesClientMessageId !== null) {
      this.prepareRevisionBranch(options.replacesClientMessageId);
    }
    const turnId = makeTurnId(this.threadId, ++this.turnSequence);
    this.pendingFirstTurnId = turnId;
    this.activeRunFirstTurnId = turnId;
    const entryIdsBeforePrompt = new Set(
      this.session.sessionManager.getEntries().map((entry) => entry.id),
    );
    const { clientMessageId, images } = options;
    const pendingClientMessage =
      clientMessageId === null
        ? null
        : {
            text,
            clientMessageId,
            entryIdsBeforePrompt,
          };
    if (pendingClientMessage) {
      this.pendingPromptClientMessages.push(pendingClientMessage);
    }
    this.sourceProposedPlanByTurnId.set(turnId, options.sourceProposedPlan);
    this.emit(this.createPromptUserMessageEvent(text, turnId, clientMessageId));
    const interactionMode = this.interactionModeQueue.enqueue(options.interactionMode);
    const baselineActiveToolNames = this.session.getActiveToolNames();
    const modeToolProfileApplied = applyInteractionModeToolProfile(
      this.session,
      options.interactionMode,
    );
    try {
      const piImages = toPiImageContent(images);
      const promptOptions: PromptOptions = {
        images: piImages,
      };
      if (options.expandPromptTemplates !== null) {
        promptOptions.expandPromptTemplates = options.expandPromptTemplates;
      }
      if (options.source !== null) {
        promptOptions.source = options.source;
      }
      if (options.streamingBehavior !== null) {
        promptOptions.streamingBehavior = options.streamingBehavior;
      }
      const promptPromise = this.session.prompt(text, {
        ...promptOptions,
      });
      void promptPromise
        .then(() => {
          const newEntries = this.capturePromptEntries({
            text,
            entryIdsBeforePrompt,
            clientMessageId,
            fallbackTurnId: turnId,
            messageTurnIds: this.pendingMessageTurnIds.splice(0),
          });
          const planMarkdown =
            options.interactionMode === "plan" && !this.proposedPlanTurnIds.has(turnId)
              ? extractProposedPlanMarkdown(newEntries)
              : null;
          if (planMarkdown) {
            this.emit(
              this.createEvent("turn.proposed.completed", "Proposed plan captured", turnId, {
                planId: proposedPlanIdForTurn(this.threadId, turnId),
                planMarkdown,
              }),
            );
          }
          this.emit(this.createEvent("tree.updated", "Session tree updated", turnId));
        })
        .catch((error: unknown) => {
          this.emit(
            this.createEvent(
              "runtime.error",
              error instanceof Error ? error.message : "Runtime prompt failed",
              turnId,
            ),
          );
        })
        .finally(() => {
          this.removePendingPromptClientMessage(pendingClientMessage);
          this.interactionModeQueue.remove(interactionMode);
          if (modeToolProfileApplied) {
            this.session.setActiveToolsByName(baselineActiveToolNames);
          }
          this.sourceProposedPlanByTurnId.delete(turnId);
          this.proposedPlanTurnIds.delete(turnId);
          if (this.pendingFirstTurnId === turnId) {
            this.pendingFirstTurnId = undefined;
          }
          if (this.activeTurnId === turnId) {
            this.activeTurnId = undefined;
          }
          if (this.activeRunFirstTurnId === turnId) {
            this.activeRunFirstTurnId = undefined;
          }
        });
      return turnId;
    } catch (error) {
      this.removePendingPromptClientMessage(pendingClientMessage);
      this.interactionModeQueue.remove(interactionMode);
      if (modeToolProfileApplied) {
        this.session.setActiveToolsByName(baselineActiveToolNames);
      }
      this.sourceProposedPlanByTurnId.delete(turnId);
      this.proposedPlanTurnIds.delete(turnId);
      if (this.pendingFirstTurnId === turnId) {
        this.pendingFirstTurnId = undefined;
      }
      if (this.activeTurnId === turnId) {
        this.activeTurnId = undefined;
      }
      if (this.activeRunFirstTurnId === turnId) {
        this.activeRunFirstTurnId = undefined;
      }
      this.emit(
        this.createEvent(
          "runtime.error",
          error instanceof Error ? error.message : "Runtime prompt failed",
          turnId,
        ),
      );
      throw error;
    }
  }

  async steer(text: string, images: readonly ThreadAgentRuntimeImageAttachment[]): Promise<void> {
    await this.session.steer(text, toPiImageContent(images));
  }

  async followUp(
    text: string,
    images: readonly ThreadAgentRuntimeImageAttachment[],
  ): Promise<void> {
    await this.session.followUp(text, toPiImageContent(images));
  }

  async compactContext(customInstructions?: string): Promise<void> {
    await this.session.compact(customInstructions);
    this.emit(this.createEvent("tree.updated", "Session tree updated"));
  }

  async abort(): Promise<void> {
    const turnId = this.activeTurnId ?? this.activeRunFirstTurnId;
    await this.session.abort();
    if (turnId) {
      this.emit(this.createEvent("turn.interrupted", "Turn interrupted", turnId));
    }
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.session.setThinkingLevel(level);
  }

  getSessionTree(): SessionTreeProjection {
    return projectRuntimeSessionTree({
      threadId: this.threadId,
      sessionManager: this.session.sessionManager,
      clientMessageIdByEntryId: this.clientMessageIdByEntryId,
      turnIdByEntryId: this.turnIdByEntryId,
    });
  }

  dispose(): void {
    this.unsubscribeSessionEvents();
    this.session.dispose();
    this.listeners.clear();
  }

  private nextEventSequence(): number {
    this.eventSequence += 1;
    return this.eventSequence;
  }

  private handlePiSessionEvent(event: AgentSessionEvent): void {
    // Pi awaits session subscribers before it can emit later lifecycle events and clear
    // `isStreaming`. Honk projection/listener failures are integration failures; they must not
    // poison Pi's canonical run lifecycle.
    let turnId: TurnId | undefined;
    try {
      this.bindPendingPromptClientMessages();
      turnId = this.preparePiEventTurnId(event);
      const runtimeEvent = this.withSourceProposedPlanData(
        projectPiAgentSessionEvent(event, {
          threadId: this.threadId,
          runtimeSessionId: this.runtimeSessionId,
          ...(turnId ? { turnId } : {}),
          sequence: this.nextEventSequence(),
        }),
        turnId,
      );
      this.emit(runtimeEvent);
      this.emitCreatePlanEvent(event, turnId);
    } catch (error) {
      warnRuntimeBridgeError(`processing Pi session event ${event.type}`, error);
    } finally {
      try {
        this.finishPiEventTurn(event, turnId);
      } catch (error) {
        warnRuntimeBridgeError(`finishing Pi session event ${event.type}`, error);
      }
    }
  }

  private prepareRevisionBranch(replacesClientMessageId: MessageId): void {
    if (this.isTurnInProgress()) {
      throw new Error("Cannot revise a message while a runtime turn is in progress.");
    }

    const entryId = this.entryIdForClientMessageId(replacesClientMessageId);
    if (!entryId) {
      throw new Error(`Cannot revise message ${replacesClientMessageId}: message entry not found.`);
    }

    const entry = this.session.sessionManager
      .getEntries()
      .find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "user") {
      throw new Error(`Cannot revise message ${replacesClientMessageId}: message entry not found.`);
    }

    if (entry.parentId) {
      this.session.sessionManager.branch(entry.parentId);
    } else {
      this.session.sessionManager.resetLeaf();
    }
    this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
  }

  private prepareParentBranch(parentEntryId: ThreadEntryId | null): void {
    if (this.isTurnInProgress()) {
      throw new Error("Cannot branch a message while a runtime turn is in progress.");
    }

    if (parentEntryId === null) {
      this.session.sessionManager.resetLeaf();
      this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
      return;
    }

    const entryId = this.entryIdForThreadEntryId(parentEntryId);
    if (!entryId) {
      throw new Error(`Cannot branch from thread entry ${parentEntryId}: runtime entry not found.`);
    }

    this.session.sessionManager.branch(entryId);
    this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
  }

  private isTurnInProgress(): boolean {
    return (
      this.pendingFirstTurnId !== undefined ||
      this.activeTurnId !== undefined ||
      this.activeRunFirstTurnId !== undefined
    );
  }

  private entryIdForClientMessageId(clientMessageId: MessageId): string | null {
    for (const [entryId, mappedClientMessageId] of this.clientMessageIdByEntryId) {
      if (String(mappedClientMessageId) === String(clientMessageId)) {
        return entryId;
      }
    }
    return null;
  }

  private entryIdForThreadEntryId(threadEntryId: ThreadEntryId): string | null {
    const threadEntryIdValue = String(threadEntryId);
    const runtimeEntryPrefix = "runtime:";
    if (threadEntryIdValue.startsWith(runtimeEntryPrefix)) {
      const entryId = threadEntryIdValue.slice(runtimeEntryPrefix.length);
      return this.hasSessionEntry(entryId) ? entryId : null;
    }

    const runtimeMessagePrefix = `message:runtime:${this.runtimeSessionId}:`;
    if (threadEntryIdValue.startsWith(runtimeMessagePrefix)) {
      const entryId = threadEntryIdValue.slice(runtimeMessagePrefix.length);
      return this.hasSessionEntry(entryId) ? entryId : null;
    }

    for (const [entryId, clientMessageId] of this.clientMessageIdByEntryId) {
      if (String(threadEntryIdForMessageId(clientMessageId)) === threadEntryIdValue) {
        return this.hasSessionEntry(entryId) ? entryId : null;
      }
    }

    return null;
  }

  private hasSessionEntry(entryId: string): boolean {
    return this.session.sessionManager.getEntries().some((entry) => entry.id === entryId);
  }

  private createEvent(
    type: AgentRuntimeEvent["type"],
    summary: string | undefined,
    turnId?: TurnId,
    data?: unknown,
  ): AgentRuntimeEvent {
    return {
      id: makeRuntimeEventId(this.nextEventSequence()),
      type,
      agentRuntime: "pi",
      threadId: this.threadId,
      runtimeSessionId: this.runtimeSessionId,
      ...(turnId ? { turnId } : {}),
      createdAt: new Date().toISOString(),
      ...(summary ? { summary } : {}),
      ...(data !== undefined ? { data } : {}),
    };
  }

  private createPromptUserMessageEvent(
    text: string,
    turnId: TurnId,
    clientMessageId: MessageId | null,
  ): AgentRuntimeEvent {
    return {
      id: makeRuntimeEventId(this.nextEventSequence()),
      type: "message.completed",
      agentRuntime: "pi",
      threadId: this.threadId,
      runtimeSessionId: this.runtimeSessionId,
      turnId,
      createdAt: new Date().toISOString(),
      summary: "User message sent",
      messageRole: "user",
      text,
      ...(clientMessageId ? { data: { clientMessageId } } : {}),
    };
  }

  private preparePiEventTurnId(event: AgentSessionEvent): TurnId | undefined {
    switch (event.type) {
      case "agent_start":
      case "agent_end":
        return undefined;
      case "turn_start": {
        const turnId = this.pendingFirstTurnId ?? makeTurnId(this.threadId, ++this.turnSequence);
        this.pendingFirstTurnId = undefined;
        this.activeTurnId = turnId;
        if (!this.activeRunFirstTurnId) {
          this.activeRunFirstTurnId = turnId;
        }
        return turnId;
      }
      case "turn_end":
        return this.activeTurnId;
      default:
        return this.activeTurnId;
    }
  }

  private finishPiEventTurn(event: AgentSessionEvent, turnId: TurnId | undefined): void {
    if (event.type === "message_end" && turnId) {
      this.pendingMessageTurnIds.push(turnId);
      return;
    }
    if (event.type === "turn_end" && turnId && this.activeTurnId === turnId) {
      this.activeTurnId = undefined;
      return;
    }
    if (event.type === "agent_end" && !event.willRetry) {
      this.pendingFirstTurnId = undefined;
      this.activeTurnId = undefined;
      this.activeRunFirstTurnId = undefined;
    }
  }

  private capturePromptEntries(input: {
    readonly text: string;
    readonly clientMessageId: MessageId | null;
    readonly entryIdsBeforePrompt: ReadonlySet<string>;
    readonly fallbackTurnId: TurnId;
    readonly messageTurnIds: readonly TurnId[];
  }): SessionEntry[] {
    const newEntries = this.session.sessionManager
      .getEntries()
      .filter((entry) => !input.entryIdsBeforePrompt.has(entry.id));
    let messageTurnIndex = 0;
    for (const entry of newEntries) {
      if (entry.type === "message") {
        this.turnIdByEntryId.set(
          entry.id,
          input.messageTurnIds[messageTurnIndex] ?? input.fallbackTurnId,
        );
        messageTurnIndex += 1;
      }
    }

    if (input.clientMessageId !== null) {
      this.attachClientMessageIdToPromptEntry({
        text: input.text,
        clientMessageId: input.clientMessageId,
        entryIdsBeforePrompt: input.entryIdsBeforePrompt,
      });
    }
    return newEntries;
  }

  private bindPendingPromptClientMessages(): void {
    if (this.pendingPromptClientMessages.length === 0) {
      return;
    }

    const remaining: PendingPromptClientMessage[] = [];
    for (const pending of this.pendingPromptClientMessages) {
      if (!this.attachClientMessageIdToPromptEntry(pending)) {
        remaining.push(pending);
      }
    }
    this.pendingPromptClientMessages.splice(
      0,
      this.pendingPromptClientMessages.length,
      ...remaining,
    );
  }

  private attachClientMessageIdToPromptEntry(input: PendingPromptClientMessage): boolean {
    const matchingEntry = this.session.sessionManager.getEntries().find((entry) => {
      if (
        input.entryIdsBeforePrompt.has(entry.id) ||
        entry.type !== "message" ||
        entry.message.role !== "user" ||
        extractMessageText(entry.message) !== input.text
      ) {
        return false;
      }

      const existingClientMessageId = this.clientMessageIdByEntryId.get(entry.id);
      return (
        existingClientMessageId === undefined || existingClientMessageId === input.clientMessageId
      );
    });

    if (!matchingEntry) {
      return false;
    }

    this.clientMessageIdByEntryId.set(matchingEntry.id, input.clientMessageId);
    this.persistClientMessageIdSidecar({
      entryId: matchingEntry.id,
      clientMessageId: input.clientMessageId,
    });
    return true;
  }

  private hydrateClientMessageIdSidecars(): void {
    const sidecars = collectClientMessageIdSidecars(this.session.sessionManager.getEntries());
    for (const [entryId, clientMessageId] of sidecars) {
      this.clientMessageIdByEntryId.set(entryId, clientMessageId);
    }
  }

  private persistClientMessageIdSidecar(input: {
    readonly entryId: string;
    readonly clientMessageId: MessageId;
  }): void {
    const sidecarAlreadyExists = this.session.sessionManager.getEntries().some((entry) => {
      if (entry.type !== "custom" || entry.customType !== CLIENT_MESSAGE_ID_SIDECAR_TYPE) {
        return false;
      }
      const data = entry.data;
      return (
        typeof data === "object" &&
        data !== null &&
        "entryId" in data &&
        "clientMessageId" in data &&
        data.entryId === input.entryId &&
        data.clientMessageId === input.clientMessageId
      );
    });
    if (sidecarAlreadyExists) {
      return;
    }

    const leafIdBeforeSidecar = this.session.sessionManager.getLeafId();
    this.session.sessionManager.appendCustomEntry(CLIENT_MESSAGE_ID_SIDECAR_TYPE, {
      entryId: input.entryId,
      clientMessageId: input.clientMessageId,
    });
    if (leafIdBeforeSidecar) {
      this.session.sessionManager.branch(leafIdBeforeSidecar);
    } else {
      this.session.sessionManager.resetLeaf();
    }
  }

  private removePendingPromptClientMessage(input: PendingPromptClientMessage | null): void {
    if (!input) {
      return;
    }
    const index = this.pendingPromptClientMessages.indexOf(input);
    if (index >= 0) {
      this.pendingPromptClientMessages.splice(index, 1);
    }
  }

  private withSourceProposedPlanData(
    event: AgentRuntimeEvent,
    turnId: TurnId | undefined,
  ): AgentRuntimeEvent {
    if (event.type !== "turn.started" || !turnId) {
      return event;
    }
    const sourceProposedPlan = this.sourceProposedPlanByTurnId.get(turnId);
    if (!sourceProposedPlan) {
      return event;
    }
    const data =
      typeof event.data === "object" && event.data !== null && !Array.isArray(event.data)
        ? { ...event.data, sourceProposedPlan }
        : { value: event.data, sourceProposedPlan };
    return {
      ...event,
      data,
    };
  }

  private emitCreatePlanEvent(event: AgentSessionEvent, turnId: TurnId | undefined): void {
    if (
      !turnId ||
      event.type !== "tool_execution_end" ||
      event.toolName !== CREATE_PLAN_TOOL_NAME ||
      event.isError
    ) {
      return;
    }
    const planMarkdown = extractCreatePlanToolResultMarkdown(event.result);
    if (!planMarkdown) {
      return;
    }
    this.proposedPlanTurnIds.add(turnId);
    this.emit(
      this.createEvent("turn.proposed.completed", "Proposed plan captured", turnId, {
        planId: proposedPlanIdForTurn(this.threadId, turnId),
        planMarkdown,
      }),
    );
  }

  private emitOrDefer(event: AgentRuntimeEvent): void {
    if (this.listeners.size === 0) {
      this.deferredEvents.push(event);
      return;
    }
    this.emit(event);
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        warnRuntimeBridgeError(`emitting runtime event ${event.type}`, error);
      }
    }
  }
}

function warnRuntimeBridgeError(context: string, error: unknown): void {
  console.warn(`[runtime] Failed while ${context}: ${formatUnknownError(error)}`);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function mergeExcludedToolNames(excludeTools: readonly string[] | undefined): string[] {
  return [...new Set([...DEFAULT_EXCLUDED_TOOL_NAMES, ...(excludeTools ?? [])])];
}

function warnExtensionLoadErrors(
  errors: ReadonlyArray<{ readonly path: string; readonly error: unknown }>,
): void {
  for (const error of errors) {
    console.warn(
      `[runtime] Failed to load pi extension at ${error.path}:`,
      error.error instanceof Error ? error.error.message : error.error,
    );
  }
}

function proposedPlanIdForTurn(threadId: ThreadId, turnId: TurnId): string {
  return `plan:${threadId}:${turnId}`;
}

function createThreadSessionManager(
  threadId: ThreadId,
  cwd: string,
  agentDir: string,
): SessionManager {
  const sessionDir = join(agentDir, "honk-thread-sessions", encodeThreadIdForPath(threadId));
  mkdirSync(sessionDir, { recursive: true });
  return SessionManager.continueRecent(cwd, sessionDir);
}

export function encodeThreadIdForPath(threadId: ThreadId): string {
  return Buffer.from(threadId, "utf8").toString("base64url");
}

function rewriteDefaultPiSystemPromptForHonk(base: string): string {
  return base.replace(PI_DEFAULT_SYSTEM_PROMPT_IDENTITY, HONK_SYSTEM_PROMPT_IDENTITY);
}

function createHonkSystemPromptIdentityExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      const systemPrompt = rewriteDefaultPiSystemPromptForHonk(event.systemPrompt);
      return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
    });
  };
}

function resolvePolicyModel(input: {
  readonly policy: AgentModelPolicy;
  readonly model: Model<string> | undefined;
  readonly modelRegistry: ModelRegistry;
}): Model<string> | undefined {
  if (input.policy.modelSelection.type === "pi-managed") {
    return input.model;
  }

  const provider = input.policy.modelSelection.authProviderId;
  const modelId = runtimeModelIdFromPolicyModelId(input.policy.modelSelection.modelId);
  if (input.model && input.model.provider === provider && input.model.id === modelId) {
    return input.model;
  }
  const model = input.modelRegistry.find(provider, modelId);
  if (!model) {
    throw new Error(`Runtime model policy references unknown model ${provider}/${modelId}.`);
  }
  return model as Model<Api>;
}

function runtimeModelIdFromPolicyModelId(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
}

function extractProposedPlanMarkdown(entries: readonly SessionEntry[]): string | null {
  let lastAssistantMessage: SessionEntry | undefined;
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      lastAssistantMessage = entry;
    }
  }
  if (!lastAssistantMessage) {
    return null;
  }
  if (lastAssistantMessage.type !== "message") {
    return null;
  }
  const text = extractMessageText(lastAssistantMessage.message).trim();
  return looksLikeProposedPlanMarkdown(text) ? text : null;
}

function looksLikeProposedPlanMarkdown(text: string): boolean {
  return /^\s{0,3}#{1,6}\s+.*\bplan\b.*$/im.test(text);
}

function createInteractionModeQueue(): InteractionModeQueue {
  let sequence = 0;
  const pendingModes: PendingInteractionMode[] = [];

  return {
    enqueue(mode) {
      const pending = {
        sequence: ++sequence,
        mode,
        consumed: false,
      };
      pendingModes.push(pending);
      return pending;
    },
    consume() {
      const pending = pendingModes.shift();
      if (!pending) {
        return "agent";
      }
      pending.consumed = true;
      return pending.mode;
    },
    remove(pending) {
      if (pending.consumed) {
        return;
      }
      const index = pendingModes.findIndex((candidate) => candidate.sequence === pending.sequence);
      if (index !== -1) {
        pendingModes.splice(index, 1);
      }
    },
  };
}

function createInteractionModeExtension(queue: InteractionModeQueue): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      const guidance = interactionModeGuidance(queue.consume());
      if (!guidance) {
        return undefined;
      }
      return {
        systemPrompt: `${event.systemPrompt}\n\n${guidance}`,
      };
    });
  };
}

interface InteractionModeToolSession {
  getActiveToolNames(): string[];
  setActiveToolsByName(toolNames: string[]): void;
}

const READ_ONLY_MODE_TOOLS = ["read", "grep", "find", "ls", "ask_question"] as const;
const DEBUG_MODE_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "edit",
  "write",
  "ask_question",
  DEBUG_LOGS_TOOL_NAME,
] as const;
const PLAN_MODE_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "ask_question",
  CREATE_PLAN_TOOL_NAME,
] as const;

function applyInteractionModeToolProfile(
  session: InteractionModeToolSession,
  mode: AgentInteractionMode,
): boolean {
  const profile = interactionModeToolProfile(mode);
  if (!profile) {
    return false;
  }
  session.setActiveToolsByName([...profile]);
  return true;
}

function interactionModeToolProfile(mode: AgentInteractionMode): readonly string[] | null {
  switch (mode) {
    case "ask":
      return READ_ONLY_MODE_TOOLS;
    case "debug":
      return DEBUG_MODE_TOOLS;
    case "plan":
      return PLAN_MODE_TOOLS;
    case "agent":
      return null;
  }
}

function interactionModeGuidance(mode: AgentInteractionMode): string | undefined {
  switch (mode) {
    case "agent":
      return undefined;
    case "ask":
      return [
        "## Honk Interaction Mode: Ask",
        "Answer the user directly. Do not change files, run mutating shell commands, create commits, or perform long-running actions.",
        "Only read-only tools are enabled in this mode: read, grep, find, ls, and ask_question.",
        "Use read-only inspection only when it is needed to answer accurately.",
      ].join("\n");
    case "plan":
      return [
        "## Honk Interaction Mode: Plan",
        "Produce a concrete implementation plan through Honk's built-in Pi planning surface.",
        "Research the codebase to find relevant files and review relevant docs before planning.",
        "Ask clarifying questions when requirements are ambiguous or the plan depends on missing decisions.",
        "If the user gives feedback while still in plan mode, keep iterating the plan rather than starting implementation.",
        "Use the create_plan tool as the final action once the plan is ready for review.",
        "When refining a previous plan, call create_plan again with the updated complete plan.",
        "The create_plan payload should include a short name, overview, actionable todos, isProject, optional phases, and a complete Markdown plan.",
        "The Markdown plan should include diagnosis, implementation steps with file paths or code references, verification, risks, and non-goals.",
        "Stop after creating the plan so the user can review, edit, or approve it before implementation.",
        "Do not change files, run mutating shell commands, create commits, or execute the plan.",
      ].join("\n");
    case "debug":
      return [
        "## Honk Interaction Mode: Debug",
        "Systematically diagnose and fix bugs using runtime evidence.",
        "Start by identifying reproduction steps, expected behavior, actual behavior, and the smallest relevant code paths.",
        "Use debug_logs with action:path to get the log file path before running instrumented or reproduction commands, append command output to that file, then use debug_logs with action:read to inspect the latest traces.",
        "Use debug_logs with action:clear before a fresh reproduction when previous logs would pollute the diagnosis.",
        "Prefer narrow diagnostic commands and explain the evidence before editing.",
        "When the cause is clear, make the smallest fix and verify it. If temporary instrumentation was added, remove it before finishing.",
      ].join("\n");
    default:
      return undefined;
  }
}

function toPiImageContent(images: readonly ThreadAgentRuntimeImageAttachment[]): ImageContent[] {
  return images.map((image) => ({
    type: "image" as const,
    mimeType: image.mimeType,
    data: extractBase64ImageData(image.dataUrl),
  }));
}

function extractBase64ImageData(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Image attachment data URL is invalid.");
  }

  const header = dataUrl.slice(0, commaIndex).toLowerCase();
  if (!header.startsWith("data:") || !header.includes(";base64")) {
    throw new Error("Image attachment must be a base64 data URL.");
  }

  const data = dataUrl.slice(commaIndex + 1);
  if (!data) {
    throw new Error("Image attachment data URL is empty.");
  }
  return data;
}
