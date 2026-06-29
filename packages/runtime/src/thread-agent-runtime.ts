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
  RuntimeIngestionRecord,
  RuntimeSessionId,
  SessionTreeProjection,
  SourceProposedPlanReference,
  SubagentToolDetails,
  ThreadAgentRuntimeImageAttachment,
  ThreadAgentRuntimeQueuedFollowUp,
  BrowserAutomationController,
  ThreadId,
  ThreadTokenUsageSnapshot,
  TurnId,
} from "@honk/contracts";
import {
  DEFAULT_RUNTIME_MODE,
  RuntimeIngestionRecordId,
  threadEntryIdForMessageId,
  type ThreadEntryId,
} from "@honk/contracts";
import {
  AuthStorage,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ExtensionCommandContextActions,
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
import { createBrowserAutomationExtension } from "./browser-automation-extension";
import { createCodexApplyPatchExtension } from "./codex-apply-patch-extension";
import { createDesktopExtensionUi, type DesktopExtensionUiController } from "./extension-ui";
import { normalizeAdditionalExtensionPaths } from "./extension-paths";
import { makeRuntimeEventId, makeRuntimeSessionId, makeTurnId } from "./ids";
import { projectPiAgentSessionEvent } from "./event-projection";
import { extractMessageText } from "./message-text";
import { DEBUG_LOGS_TOOL_NAME } from "./debug-logs-extension";
import { CREATE_PLAN_TOOL_NAME, extractCreatePlanToolEventMarkdown } from "./plan-extension";
import {
  createToolCallDescriptionExtension,
  patchToolCallDescriptionAgentTools,
} from "./tool-call-description-extension";
import {
  CLIENT_MESSAGE_ID_SIDECAR_TYPE,
  TURN_ID_SIDECAR_TYPE,
  HIDDEN_PROMPT_SIDECAR_TYPE,
  collectClientMessageIdSidecars,
  collectTurnIdSidecars,
} from "./session-tree-projection";
import {
  canonicalThreadSessionTree,
  isRuntimeCanonicalTurnActive,
  projectRuntimeCanonicalThread,
  type RuntimeCanonicalThread,
} from "./runtime-canonical-projection";
import { registerCursorComposerProvider } from "./cursor-composer-provider";
import { cursorComposerFastEnabled } from "@honk/shared/cursor-composer";
import { createHonkPiModelRegistry } from "./honk-pi-models";
import {
  BACKGROUND_SUBAGENT_COMPLETION_DEBOUNCE_MS,
  buildBackgroundSubagentCompletionMessage,
  registerBackgroundSubagentController,
  type BackgroundSubagentController,
  type BackgroundSubagentRegistration,
} from "./background-subagents";

const DEFAULT_EXCLUDED_TOOL_NAMES: readonly string[] = [];
const PI_DEFAULT_SYSTEM_PROMPT_IDENTITY =
  "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
const HONK_SYSTEM_PROMPT_IDENTITY =
  "You are Honk, an AI coding assistant. You help users by reading files, executing commands, editing code, and writing new files.";
const HONK_ASK_SYSTEM_PROMPT_IDENTITY =
  "You are Honk, an AI coding assistant. You help users understand their codebase by reading and searching. In Ask mode, you do not modify files or run mutating commands.";

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
  readonly browserAutomation?: BrowserAutomationController | null;
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
  readonly createdAt?: string;
  readonly awaitPiQueueAcceptance?: boolean;
  readonly runtimeUserTurnStart?: PendingRuntimeUserTurnStart;
  readonly visibility?: "visible" | "hidden";
  readonly syntheticReason?: "background-subagent-completion";
}

export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void;
export type RuntimeQueueListener = (items: readonly ThreadAgentRuntimeQueuedFollowUp[]) => void;
export type RuntimeIngestionRecordListener = (records: readonly RuntimeIngestionRecord[]) => void;

interface PendingInteractionMode {
  readonly sequence: number;
  readonly mode: AgentInteractionMode;
  consumed: boolean;
}

interface PendingPromptClientMessage {
  readonly text: string;
  readonly clientMessageId: MessageId;
  readonly turnId: TurnId;
  readonly entryIdsBeforePrompt: ReadonlySet<string>;
  readonly images: readonly ThreadAgentRuntimeImageAttachment[];
  readonly interactionMode: AgentInteractionMode;
  readonly sourceProposedPlan: SourceProposedPlanReference | null;
  readonly parentEntryId?: ThreadEntryId | null;
  readonly runtimeUserTurnStart?: PendingRuntimeUserTurnStart;
}

interface PendingHiddenPromptMessage {
  readonly text: string;
  readonly turnId: TurnId;
  readonly entryIdsBeforePrompt: ReadonlySet<string>;
  readonly reason: "background-subagent-completion";
}

type RuntimeUserTurnStartPayload = Extract<
  RuntimeIngestionRecord,
  { kind: "user.turn-start" }
>["payload"];

export type PendingRuntimeUserTurnStart = {
  readonly modelSelection: NonNullable<RuntimeUserTurnStartPayload["modelSelection"]>;
  readonly runtimeMode?: RuntimeUserTurnStartPayload["runtimeMode"];
  readonly titleSeed?: RuntimeUserTurnStartPayload["titleSeed"];
};

type ForkSessionEntryOptions = Parameters<ExtensionCommandContextActions["fork"]>[1];

interface InteractionModeQueue {
  readonly enqueue: (mode: AgentInteractionMode) => PendingInteractionMode;
  readonly peek: () => AgentInteractionMode;
  readonly active: () => AgentInteractionMode;
  readonly activate: (mode: AgentInteractionMode) => void;
  readonly consume: () => AgentInteractionMode;
  readonly remove: (pending: PendingInteractionMode) => void;
  readonly reset: () => void;
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

export class ThreadAgentRuntime implements BackgroundSubagentController {
  private readonly listeners = new Set<AgentRuntimeEventListener>();
  private readonly unsubscribeSessionEvents: () => void;
  private unregisterBackgroundSubagentController: (() => void) | null = null;
  private readonly clientMessageIdByEntryId = new Map<string, MessageId>();
  private readonly turnIdByEntryId = new Map<string, TurnId>();
  private readonly pendingMessageTurnIds: TurnId[] = [];
  private readonly pendingPromptClientMessages: PendingPromptClientMessage[] = [];
  private readonly pendingHiddenPromptMessages: PendingHiddenPromptMessage[] = [];
  private readonly queuedComposerFollowUps: ThreadAgentRuntimeQueuedFollowUp[] = [];
  private readonly backgroundSubagents = new Map<string, BackgroundSubagentRegistration>();
  private readonly pendingBackgroundNotifications: string[] = [];
  private readonly queueListeners = new Set<RuntimeQueueListener>();
  private readonly ingestionRecordListeners = new Set<RuntimeIngestionRecordListener>();
  private readonly emittedRuntimeUserTurnStartTurnIds = new Set<string>();
  private eventSequence = 0;
  private turnSequence = 0;
  private readonly pendingFirstTurnIds: TurnId[] = [];
  private readonly pendingFollowUpTurnIds: TurnId[] = [];
  private activeTurnId: TurnId | undefined;
  private activePromptTurnId: TurnId | undefined;
  private activeRunFirstTurnId: TurnId | undefined;
  private dispatchingBackgroundNotification = false;
  private backgroundNotificationSubmitTimer: ReturnType<typeof setTimeout> | null = null;
  private nextPiTurnStartsFollowUpPrompt = false;
  private readonly sourceProposedPlanByTurnId = new Map<
    TurnId,
    SourceProposedPlanReference | null
  >();
  private readonly interactionModeByTurnId = new Map<TurnId, AgentInteractionMode>();
  private readonly proposedPlanTurnIds = new Set<TurnId>();
  private readonly deferredEvents: AgentRuntimeEvent[] = [];
  private queuedToolProfileRestore: (() => void) | null = null;
  private defaultToolNames: string[] = [];

  private constructor(
    readonly threadId: ThreadId,
    private readonly options: ThreadAgentRuntimeOptions,
    private readonly sessionResult: Awaited<ReturnType<typeof createAgentSession>>,
    readonly policy: AgentModelPolicy,
    private readonly interactionModeQueue: InteractionModeQueue,
    contextUsageSink?: BindableContextUsageSink,
  ) {
    this.defaultToolNames = sessionResult.session.getActiveToolNames();
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
    this.registerBackgroundSubagentControllerForCurrentSession();
  }

  static async create(options: ThreadAgentRuntimeOptions): Promise<ThreadAgentRuntime> {
    const policyThinkingLevel =
      options.policy.thinkingLevel ?? thinkingLevelForAgentMode(options.policy.agentMode);
    const effectiveThinkingLevel = options.thinkingLevel ?? policyThinkingLevel;
    const authStorage =
      options.authStorage ?? AuthStorage.create(join(options.agentDir, "auth.json"));
    const modelRegistry =
      options.modelRegistry ??
      createHonkPiModelRegistry(ModelRegistry, authStorage, join(options.agentDir, "models.json"));
    registerCursorComposerProvider(modelRegistry, {
      cwd: options.cwd,
      fastEnabled: cursorComposerFastEnabled(options.policy.modelSelection),
    });
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
        additionalExtensionPaths: normalizeAdditionalExtensionPaths(
          options.extensionPaths ?? [],
          options.cwd,
        ),
        extensionFactories: [
          createCodexApplyPatchExtension(options.policy),
          createToolCallDescriptionExtension(),
          createHonkSystemPromptIdentityExtension(interactionModeQueue),
          createCodexRuntimePolicyExtension(options.policy, () => interactionModeQueue.peek()),
          createBrowserAutomationExtension({
            controller: options.browserAutomation,
            threadId: options.threadId,
          }),
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
    applyToolCallDescriptionSupport(sessionResult.session);
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

  private refreshToolCallDescriptionSupport(): void {
    applyToolCallDescriptionSupport(this.session);
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

  subscribeQueue(listener: RuntimeQueueListener): () => void {
    this.queueListeners.add(listener);
    listener(this.getQueuedFollowUps());
    return () => {
      this.queueListeners.delete(listener);
    };
  }

  subscribeRuntimeIngestionRecords(listener: RuntimeIngestionRecordListener): () => void {
    this.ingestionRecordListeners.add(listener);
    return () => {
      this.ingestionRecordListeners.delete(listener);
    };
  }

  getQueuedFollowUps(): readonly ThreadAgentRuntimeQueuedFollowUp[] {
    return this.queuedComposerFollowUps.map((item) => ({ ...item, images: [...item.images] }));
  }

  canRunBackgroundSubagent = (): boolean => {
    return this.interactionModeQueue.active() === "multitask";
  };

  activeBackgroundSubagentTurnId = (): TurnId | null => {
    return this.activeTurnId ?? this.activePromptTurnId ?? this.activeRunFirstTurnId ?? null;
  };

  registerBackgroundSubagent = (registration: BackgroundSubagentRegistration): void => {
    this.backgroundSubagents.set(registration.toolCallId, registration);
    void registration.completion
      .then((completion) => {
        this.emitBackgroundSubagentToolEvent("tool.completed", registration, completion.details, {
          isError: completion.isError,
        });
        if (completion.notificationText) {
          this.pendingBackgroundNotifications.push(completion.notificationText);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Background subagent failed.";
        this.emitBackgroundSubagentToolEvent(
          "tool.completed",
          registration,
          registration.currentDetails(),
          { isError: true },
        );
        this.pendingBackgroundNotifications.push(
          formatBackgroundSubagentErrorNotification(registration.toolCallId, message),
        );
      })
      .finally(() => {
        this.backgroundSubagents.delete(registration.toolCallId);
        this.schedulePendingBackgroundNotificationsIfIdle();
      });
  };

  emitBackgroundSubagentUpdate = (toolCallId: string): void => {
    const registration = this.backgroundSubagents.get(toolCallId);
    if (!registration) {
      return;
    }
    this.emitBackgroundSubagentToolEvent(
      "tool.updated",
      registration,
      registration.currentLiveDetails(),
      { isError: false },
    );
  };

  enqueueFollowUp(item: ThreadAgentRuntimeQueuedFollowUp): void {
    const existingIndex = this.queuedComposerFollowUps.findIndex(
      (candidate) => candidate.clientMessageId === item.clientMessageId,
    );
    const nextItem = cloneQueuedFollowUp(item);
    if (existingIndex === -1) {
      this.queuedComposerFollowUps.push(nextItem);
    } else {
      this.queuedComposerFollowUps.splice(existingIndex, 1, nextItem);
    }
    this.emitQueueUpdate();
  }

  updateQueuedFollowUp(item: ThreadAgentRuntimeQueuedFollowUp): void {
    const existingIndex = this.queuedComposerFollowUps.findIndex(
      (candidate) => candidate.clientMessageId === item.clientMessageId,
    );
    if (existingIndex === -1) {
      throw new Error(`Queued follow-up ${item.clientMessageId} not found.`);
    }
    this.queuedComposerFollowUps.splice(existingIndex, 1, cloneQueuedFollowUp(item));
    this.emitQueueUpdate();
  }

  removeQueuedFollowUp(clientMessageId: MessageId): void {
    const existingIndex = this.queuedComposerFollowUps.findIndex(
      (candidate) => candidate.clientMessageId === clientMessageId,
    );
    if (existingIndex === -1) {
      return;
    }
    this.queuedComposerFollowUps.splice(existingIndex, 1);
    this.emitQueueUpdate();
  }

  reorderQueuedFollowUp(
    clientMessageId: MessageId,
    targetClientMessageId: MessageId | null,
    insertAfter: boolean,
  ): void {
    if (clientMessageId === targetClientMessageId) {
      return;
    }
    const existingIndex = this.queuedComposerFollowUps.findIndex(
      (candidate) => candidate.clientMessageId === clientMessageId,
    );
    if (existingIndex === -1) {
      return;
    }
    const [item] = this.queuedComposerFollowUps.splice(existingIndex, 1);
    if (!item) {
      return;
    }
    let targetIndex = insertAfter ? this.queuedComposerFollowUps.length : 0;
    if (targetClientMessageId !== null) {
      const resolvedTargetIndex = this.queuedComposerFollowUps.findIndex(
        (candidate) => candidate.clientMessageId === targetClientMessageId,
      );
      if (resolvedTargetIndex === -1) {
        this.queuedComposerFollowUps.splice(existingIndex, 0, item);
        return;
      }
      targetIndex = resolvedTargetIndex + (insertAfter ? 1 : 0);
    }
    this.queuedComposerFollowUps.splice(
      Math.max(0, Math.min(targetIndex, this.queuedComposerFollowUps.length)),
      0,
      item,
    );
    this.emitQueueUpdate();
  }

  async sendQueuedFollowUpNow(clientMessageId: MessageId): Promise<void> {
    const existingIndex = this.queuedComposerFollowUps.findIndex(
      (candidate) => candidate.clientMessageId === clientMessageId,
    );
    if (existingIndex === -1) {
      return;
    }
    const item = this.takeQueuedFollowUp(clientMessageId);
    if (!item) {
      return;
    }
    try {
      if (this.isBusy()) {
        await this.abort();
      }
      await this.submitQueuedComposerFollowUpWithPiPrompt(item, null);
    } catch (error) {
      this.restoreQueuedFollowUp(item);
      throw error;
    }
  }

  async bindExtensions(ui = createDesktopExtensionUi()): Promise<DesktopExtensionUiController> {
    const bindings = {
      uiContext: ui.context,
      commandContextActions: {
        waitForIdle: () => this.session.agent.waitForIdle(),
        newSession: (options) => this.createNewSession(options),
        fork: (entryId, options) => this.forkSessionEntry(entryId, options),
        navigateTree: (targetId, options) => this.navigateSessionTree(targetId, options),
        switchSession: (sessionPath, options) => this.switchSession(sessionPath, options),
        reload: () => this.reloadSession(),
      } satisfies ExtensionCommandContextActions,
    };
    await this.session.bindExtensions(bindings);
    return ui;
  }

  private async createNewSession(
    options?: Parameters<ExtensionCommandContextActions["newSession"]>[0],
  ): Promise<{ cancelled: boolean }> {
    if (this.isThreadTreeActionBlocked() || this.session.isStreaming) {
      throw new Error("Cannot create a new session while a turn is running.");
    }

    const beforeResult = await this.emitBeforeSessionSwitch("new");
    if (beforeResult.cancelled) {
      return beforeResult;
    }

    await this.emitSessionShutdown("new");
    this.session.sessionManager.newSession(
      options?.parentSession ? { parentSession: options.parentSession } : undefined,
    );
    if (options?.setup) {
      await options.setup(this.session.sessionManager);
    }
    this.syncReplacedSession("Pi session created");
    await options?.withSession?.(this.session.createReplacedSessionContext());
    return { cancelled: false };
  }

  private async switchSession(
    sessionPath: string,
    options?: Parameters<ExtensionCommandContextActions["switchSession"]>[1],
  ): Promise<{ cancelled: boolean }> {
    if (this.isThreadTreeActionBlocked() || this.session.isStreaming) {
      throw new Error("Cannot switch sessions while a turn is running.");
    }

    const beforeResult = await this.emitBeforeSessionSwitch("resume", sessionPath);
    if (beforeResult.cancelled) {
      return beforeResult;
    }

    await this.emitSessionShutdown("resume", sessionPath);
    this.session.sessionManager.setSessionFile(sessionPath);
    this.syncReplacedSession("Pi session switched");
    await options?.withSession?.(this.session.createReplacedSessionContext());
    return { cancelled: false };
  }

  private async navigateSessionTree(
    targetId: string,
    options?: Parameters<ExtensionCommandContextActions["navigateTree"]>[1],
  ): Promise<{ cancelled: boolean }> {
    if (this.isThreadTreeActionBlocked() || this.session.isStreaming) {
      throw new Error("Cannot navigate the session tree while a turn is running.");
    }

    const result = await this.session.navigateTree(targetId, options);
    if (result.cancelled) {
      return { cancelled: true };
    }
    this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
    this.pruneEntryMapsToCurrentSession();
    this.emit(this.createEvent("tree.updated", "Session tree updated"));
    return { cancelled: false };
  }

  private async reloadSession(): Promise<void> {
    await this.session.reload();
    this.refreshToolCallDescriptionSupport();
    this.hydrateClientMessageIdSidecars();
    this.emit(this.createEvent("session.ready", "Pi session reloaded"));
    this.emit(this.createEvent("tree.updated", "Session tree updated"));
  }

  private async emitBeforeSessionSwitch(
    reason: "new" | "resume",
    targetSessionFile?: string,
  ): Promise<{ cancelled: boolean }> {
    if (!this.session.hasExtensionHandlers("session_before_switch")) {
      return { cancelled: false };
    }
    const result = await this.session.extensionRunner.emit({
      type: "session_before_switch",
      reason,
      ...(targetSessionFile ? { targetSessionFile } : {}),
    });
    return result?.cancel === true ? { cancelled: true } : { cancelled: false };
  }

  private async emitSessionShutdown(
    reason: "new" | "resume" | "fork",
    targetSessionFile?: string,
  ): Promise<void> {
    if (!this.session.hasExtensionHandlers("session_shutdown")) {
      return;
    }
    await this.session.extensionRunner.emit({
      type: "session_shutdown",
      reason,
      ...(targetSessionFile ? { targetSessionFile } : {}),
    });
  }

  private syncReplacedSession(summary: string): void {
    this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
    this.pruneEntryMapsToCurrentSession();
    this.clientMessageIdByEntryId.clear();
    this.hydrateClientMessageIdSidecars();
    this.registerBackgroundSubagentControllerForCurrentSession();
    this.emit(this.createEvent("session.started", summary));
    this.emit(this.createEvent("tree.updated", "Session tree updated"));
  }

  async cloneActiveBranch(targetThreadId: ThreadId): Promise<ThreadAgentRuntime> {
    if (this.isThreadTreeActionBlocked() || this.session.isStreaming) {
      throw new Error("Cannot fork chat while a turn is running.");
    }

    const leafId = this.session.sessionManager.getLeafId();
    if (!leafId) {
      throw new Error("Cannot fork chat: no current session entry selected.");
    }

    const sourceSessionFile = this.session.sessionManager.getSessionFile();
    if (!sourceSessionFile) {
      throw new Error("Cannot fork chat: source session has not been persisted.");
    }

    const targetSessionDir = createThreadSessionDir(targetThreadId, this.options.agentDir);
    const sessionManager = SessionManager.open(sourceSessionFile, targetSessionDir);
    const forkedSessionPath = sessionManager.createBranchedSession(leafId);
    if (!forkedSessionPath) {
      throw new Error("Cannot fork chat: failed to create forked session.");
    }

    return ThreadAgentRuntime.create({
      ...this.options,
      threadId: targetThreadId,
      sessionManager,
    });
  }

  private async forkSessionEntry(
    entryId: string,
    options?: ForkSessionEntryOptions,
  ): Promise<{ cancelled: boolean }> {
    if (this.isThreadTreeActionBlocked() || this.session.isStreaming) {
      throw new Error("Cannot fork chat while a turn is running.");
    }

    const position = options?.position ?? "before";
    if (this.session.hasExtensionHandlers("session_before_fork")) {
      const result = await this.session.extensionRunner.emit({
        type: "session_before_fork",
        entryId,
        position,
      });
      if (result?.cancel === true) {
        return { cancelled: true };
      }
    }

    const selectedEntry = this.session.sessionManager.getEntry(entryId);
    if (!selectedEntry) {
      throw new Error("Cannot fork chat: entry not found.");
    }

    const targetLeafId = targetLeafIdForForkEntry(selectedEntry, position);
    const previousSessionFile = this.session.sessionManager.getSessionFile();
    if (targetLeafId) {
      const forkedSessionPath = this.session.sessionManager.createBranchedSession(targetLeafId);
      if (this.session.sessionManager.isPersisted() && !forkedSessionPath) {
        throw new Error("Cannot fork chat: failed to create forked session.");
      }
    } else {
      this.session.sessionManager.newSession({
        ...(previousSessionFile ? { parentSession: previousSessionFile } : {}),
      });
    }

    this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
    this.pruneEntryMapsToCurrentSession();
    this.clientMessageIdByEntryId.clear();
    this.hydrateClientMessageIdSidecars();
    this.emit(this.createEvent("session.started", "Pi session forked"));
    this.emit(this.createEvent("tree.updated", "Session tree updated"));
    await options?.withSession?.(this.session.createReplacedSessionContext());
    return { cancelled: false };
  }

  async sendMessage(text: string, options: SendMessageOptions): Promise<TurnId> {
    const queueIntoActiveRun = this.session.isStreaming && options.streamingBehavior !== null;
    const visibility = options.visibility ?? "visible";
    if (!queueIntoActiveRun && options.parentEntryId !== undefined) {
      this.prepareParentBranch(options.parentEntryId);
    } else if (!queueIntoActiveRun && options.replacesClientMessageId !== null) {
      this.prepareRevisionBranch(options.replacesClientMessageId);
    }
    const turnId = makeTurnId(this.threadId, ++this.turnSequence);
    if (queueIntoActiveRun && options.streamingBehavior === "followUp") {
      this.pendingFollowUpTurnIds.push(turnId);
    } else {
      this.pendingFirstTurnIds.push(turnId);
    }
    if (!this.activeRunFirstTurnId) {
      this.activeRunFirstTurnId = turnId;
    }
    const entryIdsBeforePrompt = new Set(
      this.session.sessionManager.getEntries().map((entry) => entry.id),
    );
    const { clientMessageId, images } = options;
    const pendingClientMessage =
      clientMessageId === null || visibility === "hidden"
        ? null
        : {
            text,
            clientMessageId,
            turnId,
            entryIdsBeforePrompt,
            images,
            interactionMode: options.interactionMode,
            sourceProposedPlan: options.sourceProposedPlan,
            ...(options.parentEntryId !== undefined
              ? { parentEntryId: options.parentEntryId }
              : {}),
            ...(options.runtimeUserTurnStart
              ? { runtimeUserTurnStart: options.runtimeUserTurnStart }
              : {}),
          };
    if (pendingClientMessage) {
      this.pendingPromptClientMessages.push(pendingClientMessage);
    }
    const pendingHiddenMessage: PendingHiddenPromptMessage | null =
      visibility === "hidden"
        ? {
            text,
            turnId,
            entryIdsBeforePrompt,
            reason: options.syntheticReason ?? "background-subagent-completion",
          }
        : null;
    if (pendingHiddenMessage) {
      this.pendingHiddenPromptMessages.push(pendingHiddenMessage);
    }
    this.sourceProposedPlanByTurnId.set(turnId, options.sourceProposedPlan);
    this.interactionModeByTurnId.set(turnId, options.interactionMode);
    if (!queueIntoActiveRun && visibility === "visible") {
      this.emit(
        this.createPromptUserMessageEvent(text, turnId, clientMessageId, options.createdAt),
      );
    }
    const interactionMode = this.interactionModeQueue.enqueue(options.interactionMode);
    const baselineActiveToolNames = this.session.getActiveToolNames();
    const modeToolProfileApplied = applyInteractionModeToolProfile(
      this.session,
      options.interactionMode,
    );
    if (modeToolProfileApplied) {
      this.refreshToolCallDescriptionSupport();
    }
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
      if (options.awaitPiQueueAcceptance && queueIntoActiveRun) {
        await promptPromise;
        this.interactionModeQueue.remove(interactionMode);
        if (modeToolProfileApplied) {
          this.session.setActiveToolsByName(baselineActiveToolNames);
          this.refreshToolCallDescriptionSupport();
        }
        return turnId;
      }
      void promptPromise
        .then(() => {
          if (queueIntoActiveRun) {
            return;
          }
          const newEntries = this.capturePromptEntries({
            text,
            entryIdsBeforePrompt,
            clientMessageId,
            visibility,
            hiddenReason: pendingHiddenMessage?.reason ?? null,
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
          if (queueIntoActiveRun) {
            this.removePendingPromptClientMessage(pendingClientMessage);
            this.clearTurnTracking(turnId);
          }
          this.emit(
            this.createEvent(
              "runtime.error",
              error instanceof Error ? error.message : "Runtime prompt failed",
              turnId,
            ),
          );
        })
        .finally(() => {
          if (!queueIntoActiveRun) {
            this.removePendingPromptClientMessage(pendingClientMessage);
            this.removePendingHiddenPromptMessage(pendingHiddenMessage);
          }
          this.interactionModeQueue.remove(interactionMode);
          if (modeToolProfileApplied) {
            this.session.setActiveToolsByName(baselineActiveToolNames);
            this.refreshToolCallDescriptionSupport();
          }
          if (!queueIntoActiveRun) {
            this.clearTurnTracking(turnId);
          }
        });
      return turnId;
    } catch (error) {
      this.removePendingPromptClientMessage(pendingClientMessage);
      this.removePendingHiddenPromptMessage(pendingHiddenMessage);
      this.interactionModeQueue.remove(interactionMode);
      if (modeToolProfileApplied) {
        this.session.setActiveToolsByName(baselineActiveToolNames);
        this.refreshToolCallDescriptionSupport();
      }
      this.clearTurnTracking(turnId);
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
    if (this.backgroundSubagents.size > 0) {
      throw new Error("Cannot compact context while background subagents are running.");
    }
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

  getCanonicalThread(input?: {
    readonly runtimeEvents?: ReadonlyArray<AgentRuntimeEvent>;
    readonly extraBridgeRecords?: ReadonlyArray<RuntimeIngestionRecord>;
  }): RuntimeCanonicalThread {
    return projectRuntimeCanonicalThread({
      threadId: this.threadId,
      sessionManager: this.session.sessionManager,
      clientMessageIdByEntryId: this.clientMessageIdByEntryId,
      turnIdByEntryId: this.turnIdByEntryId,
      runtimeEvents: input?.runtimeEvents ?? [],
      queuedFollowUps: this.getQueuedFollowUps(),
      ...(this.activeTurnId ? { activeTurnId: this.activeTurnId } : {}),
      ...(this.activeRunFirstTurnId ? { activeRunFirstTurnId: this.activeRunFirstTurnId } : {}),
      pendingTurnCount: this.pendingFirstTurnIds.length + this.pendingFollowUpTurnIds.length,
      extraBridgeRecords: input?.extraBridgeRecords ?? [],
    });
  }

  getSessionTree(): SessionTreeProjection {
    return canonicalThreadSessionTree(this.getCanonicalThread());
  }

  isBusy(): boolean {
    return this.isTurnInProgress() || this.session.isStreaming;
  }

  dispose(): void {
    for (const registration of this.backgroundSubagents.values()) {
      registration.abort();
    }
    if (this.backgroundNotificationSubmitTimer !== null) {
      clearTimeout(this.backgroundNotificationSubmitTimer);
      this.backgroundNotificationSubmitTimer = null;
    }
    this.backgroundSubagents.clear();
    this.unregisterBackgroundSubagentController?.();
    this.unregisterBackgroundSubagentController = null;
    this.unsubscribeSessionEvents();
    this.session.dispose();
    this.listeners.clear();
  }

  private registerBackgroundSubagentControllerForCurrentSession(): void {
    this.unregisterBackgroundSubagentController?.();
    this.unregisterBackgroundSubagentController = registerBackgroundSubagentController(
      this.session.sessionManager.getSessionId(),
      this,
    );
  }

  private emitBackgroundSubagentToolEvent(
    type: "tool.updated" | "tool.completed",
    registration: BackgroundSubagentRegistration,
    details: SubagentToolDetails,
    input: { readonly isError: boolean },
  ): void {
    const summary = registration.summarize(details);
    const result = {
      content: [{ type: "text" as const, text: summary }],
      details,
    };
    this.emit(
      this.createEvent(type, summary, registration.turnId ?? undefined, {
        toolCallId: registration.toolCallId,
        toolName: "subagent",
        ...(type === "tool.updated" ? { partialResult: result } : { result }),
        isError: input.isError,
      }),
    );
  }

  private schedulePendingBackgroundNotificationsIfIdle(): void {
    if (
      this.dispatchingBackgroundNotification ||
      this.pendingBackgroundNotifications.length === 0 ||
      this.isBusy() ||
      this.queuedComposerFollowUps.length > 0 ||
      this.backgroundNotificationSubmitTimer !== null
    ) {
      return;
    }
    this.backgroundNotificationSubmitTimer = setTimeout(() => {
      this.backgroundNotificationSubmitTimer = null;
      this.submitPendingBackgroundNotificationsIfIdle();
    }, BACKGROUND_SUBAGENT_COMPLETION_DEBOUNCE_MS);
  }

  private submitPendingBackgroundNotificationsIfIdle(): void {
    if (
      this.dispatchingBackgroundNotification ||
      this.pendingBackgroundNotifications.length === 0 ||
      this.isBusy() ||
      this.queuedComposerFollowUps.length > 0
    ) {
      return;
    }
    const notifications = this.pendingBackgroundNotifications.splice(0);
    this.dispatchingBackgroundNotification = true;
    void this.sendMessage(buildBackgroundSubagentCompletionMessage(notifications), {
      clientMessageId: null,
      replacesClientMessageId: null,
      interactionMode: "multitask",
      sourceProposedPlan: null,
      images: [],
      expandPromptTemplates: null,
      source: "extension",
      streamingBehavior: null,
      visibility: "hidden",
      syntheticReason: "background-subagent-completion",
    })
      .catch((error: unknown) => {
        this.pendingBackgroundNotifications.unshift(...notifications);
        this.emit(
          this.createEvent(
            "runtime.error",
            error instanceof Error
              ? error.message
              : "Failed to submit background subagent completion.",
          ),
        );
      })
      .finally(() => {
        this.dispatchingBackgroundNotification = false;
        this.schedulePendingBackgroundNotificationsIfIdle();
      });
  }

  private nextEventSequence(): number {
    this.eventSequence += 1;
    return this.eventSequence;
  }

  private handlePiSessionEvent(event: AgentSessionEvent): void {
    // Pi notifies session subscribers before it can emit later lifecycle events and clear
    // `isStreaming`. Honk projection/listener failures are integration failures; they must not
    // poison Pi's canonical run lifecycle.
    let turnId: TurnId | undefined;
    let suppressTerminalAgentEnd = false;
    try {
      turnId = this.preparePiEventTurnId(event);
      if (event.type === "message_start" && event.message.role === "user") {
        const pending = this.pendingPromptClientMessageForPiUserEvent(event, turnId);
        const mode =
          pending?.interactionMode ??
          (turnId ? this.interactionModeByTurnId.get(turnId) : undefined);
        if (mode) {
          this.interactionModeQueue.activate(mode);
        }
        const restore = this.queuedToolProfileRestore;
        if (restore) {
          this.queuedToolProfileRestore = null;
          restore();
        }
      }
      this.bindPendingPromptClientMessages();
      const suppressHiddenUserPromptEvent = this.isHiddenPromptUserEvent(event, turnId);
      suppressTerminalAgentEnd =
        event.type === "agent_end" &&
        !event.willRetry &&
        !isAbortedPiAgentEnd(event) &&
        this.submitNextQueuedComposerFollowUpWithPiFollowUp(event);
      if (!suppressTerminalAgentEnd && !suppressHiddenUserPromptEvent) {
        const runtimeEvent = this.projectRuntimePiSessionEvent(event, turnId);
        this.emit(runtimeEvent);
        this.emitRuntimeUserTurnStartRecord(event, runtimeEvent, turnId);
        this.emitCreatePlanEvent(event, turnId);
      }
    } catch (error) {
      warnRuntimeBridgeError(`processing Pi session event ${event.type}`, error);
    } finally {
      try {
        if (!suppressTerminalAgentEnd) {
          this.finishPiEventTurn(event, turnId);
          this.schedulePendingBackgroundNotificationsIfIdle();
        }
      } catch (error) {
        warnRuntimeBridgeError(`finishing Pi session event ${event.type}`, error);
      }
    }
  }

  private prepareRevisionBranch(replacesClientMessageId: MessageId): void {
    if (this.isThreadTreeActionBlocked()) {
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
    if (this.isThreadTreeActionBlocked()) {
      throw new Error("Cannot branch a message while a runtime turn is in progress.");
    }

    if (parentEntryId === null) {
      this.session.sessionManager.resetLeaf();
      this.session.agent.state.messages =
        this.session.sessionManager.buildSessionContext().messages;
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
      this.pendingFirstTurnIds.length > 0 ||
      this.pendingFollowUpTurnIds.length > 0 ||
      this.activeTurnId !== undefined ||
      this.activeRunFirstTurnId !== undefined
    );
  }

  private isThreadTreeActionBlocked(): boolean {
    return (
      this.backgroundSubagents.size > 0 ||
      isRuntimeCanonicalTurnActive(this.getCanonicalThread().turnState)
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

    const persistedRuntimeMessagePrefix = "message:runtime:";
    if (threadEntryIdValue.startsWith(persistedRuntimeMessagePrefix)) {
      const runtimeEntryId = threadEntryIdValue.split(":").slice(3).join(":");
      if (runtimeEntryId && this.hasSessionEntry(runtimeEntryId)) {
        return runtimeEntryId;
      }
    }

    for (const entry of this.getSessionTree().entries) {
      if (String(entry.threadEntryId) === threadEntryIdValue) {
        const entryId = String(entry.id);
        return this.hasSessionEntry(entryId) ? entryId : null;
      }
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

  private pruneEntryMapsToCurrentSession(): void {
    const entryIds = new Set(this.session.sessionManager.getEntries().map((entry) => entry.id));
    for (const entryId of this.clientMessageIdByEntryId.keys()) {
      if (!entryIds.has(entryId)) {
        this.clientMessageIdByEntryId.delete(entryId);
      }
    }
    for (const entryId of this.turnIdByEntryId.keys()) {
      if (!entryIds.has(entryId)) {
        this.turnIdByEntryId.delete(entryId);
      }
    }
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
    createdAt?: string,
  ): AgentRuntimeEvent {
    return {
      id: makeRuntimeEventId(this.nextEventSequence()),
      type: "message.completed",
      agentRuntime: "pi",
      threadId: this.threadId,
      runtimeSessionId: this.runtimeSessionId,
      turnId,
      createdAt: createdAt ?? new Date().toISOString(),
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
        const turnId = this.consumeTurnStartId();
        this.activeTurnId = turnId;
        this.activePromptTurnId = turnId;
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
      this.captureQueuedPromptEntriesForTurn(turnId);
      if (event.toolResults.length === 0 && this.pendingFollowUpTurnIds.length > 0) {
        this.nextPiTurnStartsFollowUpPrompt = true;
      }
      this.activeTurnId = undefined;
      this.clearTurnTracking(turnId, { clearActivePrompt: false, clearActiveRun: false });
      return;
    }
    if (event.type === "agent_end" && !event.willRetry) {
      this.pendingFirstTurnIds.splice(0);
      this.pendingFollowUpTurnIds.splice(0);
      this.nextPiTurnStartsFollowUpPrompt = false;
      const restore = this.queuedToolProfileRestore;
      if (restore) {
        this.queuedToolProfileRestore = null;
        restore();
      }
      this.interactionModeQueue.reset();
      this.activeTurnId = undefined;
      this.activePromptTurnId = undefined;
      this.activeRunFirstTurnId = undefined;
    }
  }

  private consumeTurnStartId(): TurnId {
    if (this.nextPiTurnStartsFollowUpPrompt) {
      this.nextPiTurnStartsFollowUpPrompt = false;
      const pendingFollowUpTurnId = this.pendingFollowUpTurnIds.shift();
      if (pendingFollowUpTurnId) {
        return pendingFollowUpTurnId;
      }
    }
    if (this.activePromptTurnId) {
      return this.activePromptTurnId;
    }
    return this.pendingFirstTurnIds.shift() ?? makeTurnId(this.threadId, ++this.turnSequence);
  }

  private capturePromptEntries(input: {
    readonly text: string;
    readonly clientMessageId: MessageId | null;
    readonly visibility: "visible" | "hidden";
    readonly hiddenReason: PendingHiddenPromptMessage["reason"] | null;
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
        const turnId = input.messageTurnIds[messageTurnIndex] ?? input.fallbackTurnId;
        this.turnIdByEntryId.set(entry.id, turnId);
        this.persistTurnIdSidecar({ entryId: entry.id, turnId });
        messageTurnIndex += 1;
      }
    }

    if (input.clientMessageId !== null) {
      this.attachClientMessageIdToPromptEntry({
        text: input.text,
        clientMessageId: input.clientMessageId,
        turnId: input.fallbackTurnId,
        entryIdsBeforePrompt: input.entryIdsBeforePrompt,
      });
    }
    if (input.visibility === "hidden" && input.hiddenReason) {
      this.attachHiddenPromptEntry({
        text: input.text,
        reason: input.hiddenReason,
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
      const attached = this.attachClientMessageIdToPromptEntry(pending);
      if (!attached || pending.runtimeUserTurnStart) {
        remaining.push(pending);
      }
    }
    this.pendingPromptClientMessages.splice(
      0,
      this.pendingPromptClientMessages.length,
      ...remaining,
    );
  }

  private attachClientMessageIdToPromptEntry(input: {
    readonly text: string;
    readonly clientMessageId: MessageId;
    readonly turnId: TurnId;
    readonly entryIdsBeforePrompt: ReadonlySet<string>;
  }): boolean {
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
    this.turnIdByEntryId.set(matchingEntry.id, input.turnId);
    this.persistClientMessageIdSidecar({
      entryId: matchingEntry.id,
      clientMessageId: input.clientMessageId,
    });
    this.persistTurnIdSidecar({ entryId: matchingEntry.id, turnId: input.turnId });
    return true;
  }

  private attachHiddenPromptEntry(input: {
    readonly text: string;
    readonly reason: PendingHiddenPromptMessage["reason"];
    readonly entryIdsBeforePrompt: ReadonlySet<string>;
  }): boolean {
    const matchingEntry = this.session.sessionManager.getEntries().find((entry) => {
      return (
        !input.entryIdsBeforePrompt.has(entry.id) &&
        entry.type === "message" &&
        entry.message.role === "user" &&
        extractMessageText(entry.message) === input.text
      );
    });
    if (!matchingEntry) {
      return false;
    }
    this.persistHiddenPromptSidecar({ entryId: matchingEntry.id, reason: input.reason });
    return true;
  }

  private captureQueuedPromptEntriesForTurn(turnId: TurnId): void {
    const pending = this.pendingPromptClientMessages.find(
      (message) => String(message.turnId) === String(turnId),
    );
    if (!pending) {
      return;
    }

    const entries = this.session.sessionManager.getEntries();
    const userEntryIndex = entries.findIndex(
      (entry) =>
        !pending.entryIdsBeforePrompt.has(entry.id) &&
        entry.type === "message" &&
        entry.message.role === "user" &&
        extractMessageText(entry.message) === pending.text,
    );
    if (userEntryIndex === -1) {
      return;
    }

    for (const entry of entries.slice(userEntryIndex)) {
      if (entry.type !== "message") {
        continue;
      }
      this.turnIdByEntryId.set(entry.id, turnId);
      this.persistTurnIdSidecar({ entryId: entry.id, turnId });
    }
    this.attachClientMessageIdToPromptEntry(pending);
    this.removePendingPromptClientMessage(pending);
    this.emit(this.createEvent("tree.updated", "Session tree updated", turnId));
  }

  private clearTurnTracking(
    turnId: TurnId,
    options: {
      readonly clearActivePrompt?: boolean;
      readonly clearActiveRun?: boolean;
    } = {},
  ): void {
    this.sourceProposedPlanByTurnId.delete(turnId);
    this.interactionModeByTurnId.delete(turnId);
    this.proposedPlanTurnIds.delete(turnId);
    this.emittedRuntimeUserTurnStartTurnIds.delete(String(turnId));
    for (let index = this.pendingHiddenPromptMessages.length - 1; index >= 0; index -= 1) {
      if (this.pendingHiddenPromptMessages[index]?.turnId === turnId) {
        this.pendingHiddenPromptMessages.splice(index, 1);
      }
    }
    const pendingTurnIndex = this.pendingFirstTurnIds.findIndex(
      (pendingTurnId) => pendingTurnId === turnId,
    );
    if (pendingTurnIndex !== -1) {
      this.pendingFirstTurnIds.splice(pendingTurnIndex, 1);
    }
    const pendingFollowUpTurnIndex = this.pendingFollowUpTurnIds.findIndex(
      (pendingTurnId) => pendingTurnId === turnId,
    );
    if (pendingFollowUpTurnIndex !== -1) {
      this.pendingFollowUpTurnIds.splice(pendingFollowUpTurnIndex, 1);
    }
    if (this.activeTurnId === turnId) {
      this.activeTurnId = undefined;
    }
    if ((options.clearActivePrompt ?? true) && this.activePromptTurnId === turnId) {
      this.activePromptTurnId = undefined;
    }
    if ((options.clearActiveRun ?? true) && this.activeRunFirstTurnId === turnId) {
      this.activeRunFirstTurnId = undefined;
    }
  }

  private emitQueueUpdate(): void {
    const items = this.getQueuedFollowUps();
    for (const listener of this.queueListeners) {
      listener(items);
    }
  }

  private emitRuntimeIngestionRecords(records: readonly RuntimeIngestionRecord[]): void {
    if (records.length === 0) {
      return;
    }
    for (const listener of this.ingestionRecordListeners) {
      listener(records);
    }
  }

  private submitNextQueuedComposerFollowUpWithPiFollowUp(
    terminalEvent: Extract<AgentSessionEvent, { type: "agent_end" }>,
  ): boolean {
    const item = this.takeQueuedFollowUp();
    if (!item) {
      return false;
    }
    const pending = this.registerQueuedComposerFollowUpTurn(item);
    this.nextPiTurnStartsFollowUpPrompt = true;
    const existingRestore = this.queuedToolProfileRestore;
    if (existingRestore) {
      this.queuedToolProfileRestore = null;
      existingRestore();
    }
    const baselineActiveToolNames = this.session.getActiveToolNames();
    const toolProfile = interactionModeToolProfile(item.interactionMode) ?? this.defaultToolNames;
    this.session.setActiveToolsByName([...toolProfile]);
    this.refreshToolCallDescriptionSupport();
    this.queuedToolProfileRestore = () => {
      this.session.setActiveToolsByName(baselineActiveToolNames);
      this.refreshToolCallDescriptionSupport();
    };
    void this.session
      .followUp(item.input, toPiImageContent(item.images))
      .catch((error: unknown) => {
        this.nextPiTurnStartsFollowUpPrompt = false;
        const restore = this.queuedToolProfileRestore;
        if (restore) {
          this.queuedToolProfileRestore = null;
          restore();
        }
        this.removePendingPromptClientMessage(pending);
        this.clearTurnTracking(pending.turnId);
        this.restoreQueuedFollowUp(item);
        this.emit(
          this.createEvent(
            "runtime.error",
            error instanceof Error ? error.message : "Failed to submit queued follow-up to Pi.",
          ),
        );
        this.emit(this.projectRuntimePiSessionEvent(terminalEvent, undefined));
        this.finishPiEventTurn(terminalEvent, undefined);
      });
    return true;
  }

  private registerQueuedComposerFollowUpTurn(
    item: ThreadAgentRuntimeQueuedFollowUp,
  ): PendingPromptClientMessage {
    const turnId = makeTurnId(this.threadId, ++this.turnSequence);
    this.pendingFollowUpTurnIds.push(turnId);
    if (!this.activeRunFirstTurnId) {
      this.activeRunFirstTurnId = turnId;
    }
    this.sourceProposedPlanByTurnId.set(turnId, item.sourceProposedPlan);
    this.interactionModeByTurnId.set(turnId, item.interactionMode);
    const pending = {
      text: item.input,
      clientMessageId: item.clientMessageId,
      turnId,
      entryIdsBeforePrompt: new Set(
        this.session.sessionManager.getEntries().map((entry) => entry.id),
      ),
      images: item.images,
      interactionMode: item.interactionMode,
      sourceProposedPlan: item.sourceProposedPlan,
      ...(item.parentEntryId !== undefined ? { parentEntryId: item.parentEntryId } : {}),
      runtimeUserTurnStart: {
        modelSelection: item.modelSelection,
        runtimeMode: item.runtimeMode,
        titleSeed: item.titleSeed,
      },
    } satisfies PendingPromptClientMessage;
    this.pendingPromptClientMessages.push(pending);
    return pending;
  }

  private takeQueuedFollowUp(clientMessageId?: MessageId): ThreadAgentRuntimeQueuedFollowUp | null {
    const index =
      clientMessageId === undefined
        ? 0
        : this.queuedComposerFollowUps.findIndex(
            (candidate) => candidate.clientMessageId === clientMessageId,
          );
    if (index < 0 || index >= this.queuedComposerFollowUps.length) {
      return null;
    }
    const [item] = this.queuedComposerFollowUps.splice(index, 1);
    this.emitQueueUpdate();
    return item ? cloneQueuedFollowUp(item) : null;
  }

  private restoreQueuedFollowUp(item: ThreadAgentRuntimeQueuedFollowUp): void {
    if (
      this.queuedComposerFollowUps.some(
        (candidate) => candidate.clientMessageId === item.clientMessageId,
      )
    ) {
      return;
    }
    this.queuedComposerFollowUps.unshift(cloneQueuedFollowUp(item));
    this.emitQueueUpdate();
  }

  private async submitQueuedComposerFollowUpWithPiPrompt(
    item: ThreadAgentRuntimeQueuedFollowUp,
    streamingBehavior: "followUp" | null,
  ): Promise<void> {
    const createdAt = new Date().toISOString();
    await this.sendMessage(item.input, {
      clientMessageId: item.clientMessageId,
      replacesClientMessageId: item.replacesClientMessageId,
      ...(item.parentEntryId !== undefined ? { parentEntryId: item.parentEntryId } : {}),
      interactionMode: item.interactionMode,
      sourceProposedPlan: item.sourceProposedPlan,
      images: item.images,
      expandPromptTemplates: null,
      source: null,
      streamingBehavior,
      createdAt,
      awaitPiQueueAcceptance: true,
      runtimeUserTurnStart: {
        modelSelection: item.modelSelection,
        runtimeMode: item.runtimeMode,
        titleSeed: item.titleSeed,
      },
    });
  }

  private hydrateClientMessageIdSidecars(): void {
    const sidecars = collectClientMessageIdSidecars(this.session.sessionManager.getEntries());
    for (const [entryId, clientMessageId] of sidecars) {
      this.clientMessageIdByEntryId.set(entryId, clientMessageId);
    }
    const turnIdSidecars = collectTurnIdSidecars(this.session.sessionManager.getEntries());
    let maxTurnSequence = this.turnSequence;
    for (const [entryId, turnId] of turnIdSidecars) {
      this.turnIdByEntryId.set(entryId, turnId);
      maxTurnSequence = Math.max(
        maxTurnSequence,
        turnSequenceForThread(this.threadId, turnId) ?? 0,
      );
    }
    this.turnSequence = maxTurnSequence;
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

  private persistTurnIdSidecar(input: { readonly entryId: string; readonly turnId: TurnId }): void {
    const sidecarAlreadyExists = this.session.sessionManager.getEntries().some((entry) => {
      if (entry.type !== "custom" || entry.customType !== TURN_ID_SIDECAR_TYPE) {
        return false;
      }
      const data = entry.data;
      return (
        typeof data === "object" &&
        data !== null &&
        "entryId" in data &&
        "turnId" in data &&
        data.entryId === input.entryId &&
        data.turnId === String(input.turnId)
      );
    });
    if (sidecarAlreadyExists) {
      return;
    }

    const leafIdBeforeSidecar = this.session.sessionManager.getLeafId();
    this.session.sessionManager.appendCustomEntry(TURN_ID_SIDECAR_TYPE, {
      entryId: input.entryId,
      turnId: String(input.turnId),
    });
    if (leafIdBeforeSidecar) {
      this.session.sessionManager.branch(leafIdBeforeSidecar);
    } else {
      this.session.sessionManager.resetLeaf();
    }
  }

  private persistHiddenPromptSidecar(input: {
    readonly entryId: string;
    readonly reason: PendingHiddenPromptMessage["reason"];
  }): void {
    const sidecarAlreadyExists = this.session.sessionManager.getEntries().some((entry) => {
      if (entry.type !== "custom" || entry.customType !== HIDDEN_PROMPT_SIDECAR_TYPE) {
        return false;
      }
      const data = entry.data;
      return (
        typeof data === "object" &&
        data !== null &&
        "entryId" in data &&
        data.entryId === input.entryId
      );
    });
    if (sidecarAlreadyExists) {
      return;
    }

    const leafIdBeforeSidecar = this.session.sessionManager.getLeafId();
    this.session.sessionManager.appendCustomEntry(HIDDEN_PROMPT_SIDECAR_TYPE, {
      entryId: input.entryId,
      reason: input.reason,
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

  private removePendingHiddenPromptMessage(input: PendingHiddenPromptMessage | null): void {
    if (!input) {
      return;
    }
    const index = this.pendingHiddenPromptMessages.indexOf(input);
    if (index >= 0) {
      this.pendingHiddenPromptMessages.splice(index, 1);
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

  private projectRuntimePiSessionEvent(
    event: AgentSessionEvent,
    turnId: TurnId | undefined,
  ): AgentRuntimeEvent {
    return this.withPromptClientMessageData(
      event,
      this.withSourceProposedPlanData(
        projectPiAgentSessionEvent(event, {
          threadId: this.threadId,
          runtimeSessionId: this.runtimeSessionId,
          ...(turnId ? { turnId } : {}),
          sequence: this.nextEventSequence(),
        }),
        turnId,
      ),
      turnId,
    );
  }

  private withPromptClientMessageData(
    piEvent: AgentSessionEvent,
    event: AgentRuntimeEvent,
    turnId: TurnId | undefined,
  ): AgentRuntimeEvent {
    const pending = this.pendingPromptClientMessageForPiUserEvent(piEvent, turnId);
    if (!pending) {
      return event;
    }
    const data =
      typeof event.data === "object" && event.data !== null && !Array.isArray(event.data)
        ? { ...event.data, clientMessageId: pending.clientMessageId }
        : { value: event.data, clientMessageId: pending.clientMessageId };
    return {
      ...event,
      data,
    };
  }

  private emitRuntimeUserTurnStartRecord(
    piEvent: AgentSessionEvent,
    event: AgentRuntimeEvent,
    turnId: TurnId | undefined,
  ): void {
    if (piEvent.type !== "message_end" || turnId === undefined) {
      return;
    }
    const pending = this.pendingPromptClientMessageForPiUserEvent(piEvent, turnId);
    if (!pending?.runtimeUserTurnStart) {
      return;
    }
    const turnKey = String(turnId);
    if (this.emittedRuntimeUserTurnStartTurnIds.has(turnKey)) {
      return;
    }
    this.emittedRuntimeUserTurnStartTurnIds.add(turnKey);
    this.emitRuntimeIngestionRecords([
      this.createRuntimeUserTurnStartRecord({
        pending,
        turnId,
        createdAt: event.createdAt,
      }),
    ]);
  }

  private pendingPromptClientMessageForPiUserEvent(
    event: AgentSessionEvent,
    turnId: TurnId | undefined,
  ): PendingPromptClientMessage | null {
    if (turnId === undefined || !("message" in event) || event.message.role !== "user") {
      return null;
    }
    const text = extractMessageText(event.message);
    return (
      this.pendingPromptClientMessages.find(
        (pending) => String(pending.turnId) === String(turnId) && pending.text === text,
      ) ?? null
    );
  }

  private isHiddenPromptUserEvent(event: AgentSessionEvent, turnId: TurnId | undefined): boolean {
    if (turnId === undefined || !("message" in event) || event.message.role !== "user") {
      return false;
    }
    const text = extractMessageText(event.message);
    return this.pendingHiddenPromptMessages.some(
      (pending) => String(pending.turnId) === String(turnId) && pending.text === text,
    );
  }

  private createRuntimeUserTurnStartRecord(input: {
    readonly pending: PendingPromptClientMessage;
    readonly turnId: TurnId;
    readonly createdAt: string;
  }): RuntimeIngestionRecord {
    const runtimeUserTurnStart = input.pending.runtimeUserTurnStart;
    if (!runtimeUserTurnStart) {
      throw new Error("Cannot create runtime user turn start record without metadata.");
    }
    const recordId = RuntimeIngestionRecordId.make(
      `runtime-user-turn:${this.threadId}:${this.runtimeSessionId}:${input.pending.clientMessageId}`,
    );
    return {
      recordId,
      threadId: this.threadId,
      runtimeSessionId: this.runtimeSessionId,
      sourceEventId: `runtime-user-turn:${input.turnId}`,
      createdAt: input.createdAt,
      kind: "user.turn-start",
      payload: {
        messageId: input.pending.clientMessageId,
        text: input.pending.text,
        attachments: input.pending.images.map((image) => ({ ...image })),
        modelSelection: runtimeUserTurnStart.modelSelection,
        titleSeed: runtimeUserTurnStart.titleSeed ?? input.pending.text,
        runtimeMode: runtimeUserTurnStart.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        interactionMode: input.pending.interactionMode,
        ...(input.pending.parentEntryId !== undefined
          ? { parentEntryId: input.pending.parentEntryId }
          : {}),
        ...(input.pending.sourceProposedPlan
          ? { sourceProposedPlan: input.pending.sourceProposedPlan }
          : {}),
      },
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
    const planMarkdown = extractCreatePlanToolEventMarkdown(event);
    if (!planMarkdown) {
      return;
    }
    const planId = proposedPlanIdForTurn(this.threadId, turnId);
    const proposedPlanEvent = this.createEvent(
      "turn.proposed.completed",
      "Proposed plan captured",
      turnId,
      {
        planId,
        planMarkdown,
      },
    );
    this.proposedPlanTurnIds.add(turnId);
    this.emit(proposedPlanEvent);
    this.emitRuntimeIngestionRecords([
      this.createRuntimeProposedPlanRecord({
        turnId,
        planId,
        planMarkdown,
        createdAt: proposedPlanEvent.createdAt,
        sourceEventId: proposedPlanEvent.id,
      }),
    ]);
  }

  private createRuntimeProposedPlanRecord(input: {
    readonly turnId: TurnId;
    readonly planId: string;
    readonly planMarkdown: string;
    readonly createdAt: string;
    readonly sourceEventId: string;
  }): RuntimeIngestionRecord {
    return {
      recordId: RuntimeIngestionRecordId.make(
        `runtime-proposed-plan:${this.threadId}:${this.runtimeSessionId}:${input.turnId}`,
      ),
      threadId: this.threadId,
      runtimeSessionId: this.runtimeSessionId,
      sourceEventId: input.sourceEventId,
      kind: "proposed-plan",
      createdAt: input.createdAt,
      payload: {
        proposedPlan: {
          id: input.planId,
          turnId: input.turnId,
          planMarkdown: input.planMarkdown.trim(),
          implementedAt: null,
          implementationThreadId: null,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        },
      },
    };
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

function isAbortedPiAgentEnd(event: AgentSessionEvent): boolean {
  if (event.type !== "agent_end") {
    return false;
  }
  return event.messages.some((message) => {
    if (message.role !== "assistant" || !("stopReason" in message)) {
      return false;
    }
    return message.stopReason === "aborted";
  });
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function formatBackgroundSubagentErrorNotification(toolCallId: string, message: string): string {
  return [
    "<agent_notification>",
    "kind: subagent",
    `agent_id: ${toolCallId}`,
    "status: error",
    "title: Background subagent",
    "response:",
    "<response>",
    message,
    "</response>",
    "</agent_notification>",
  ].join("\n");
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
  const sessionDir = createThreadSessionDir(threadId, agentDir);
  return SessionManager.continueRecent(cwd, sessionDir);
}

function createThreadSessionDir(threadId: ThreadId, agentDir: string): string {
  const sessionDir = join(agentDir, "honk-thread-sessions", encodeThreadIdForPath(threadId));
  mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

function targetLeafIdForForkEntry(
  entry: SessionEntry,
  position: NonNullable<ForkSessionEntryOptions>["position"],
): string | null {
  if (position === "at") {
    return entry.id;
  }
  if (entry.type !== "message" || entry.message.role !== "user") {
    throw new Error("Cannot fork chat before a non-user message.");
  }
  return entry.parentId;
}

export function encodeThreadIdForPath(threadId: ThreadId): string {
  return Buffer.from(threadId, "utf8").toString("base64url");
}

function rewriteDefaultPiSystemPromptForHonk(
  base: string,
  interactionMode: AgentInteractionMode,
): string {
  const identity =
    interactionMode === "ask" ? HONK_ASK_SYSTEM_PROMPT_IDENTITY : HONK_SYSTEM_PROMPT_IDENTITY;
  return base.replace(PI_DEFAULT_SYSTEM_PROMPT_IDENTITY, identity);
}

function createHonkSystemPromptIdentityExtension(queue: InteractionModeQueue): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      const systemPrompt = rewriteDefaultPiSystemPromptForHonk(event.systemPrompt, queue.peek());
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
  let activeMode: AgentInteractionMode = "agent";
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
    peek() {
      return pendingModes[0]?.mode ?? activeMode;
    },
    active() {
      return activeMode;
    },
    activate(mode) {
      activeMode = mode;
    },
    consume() {
      const pending = pendingModes.shift();
      if (!pending) {
        activeMode = "agent";
        return "agent";
      }
      pending.consumed = true;
      activeMode = pending.mode;
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
    reset() {
      activeMode = "agent";
      for (const pending of pendingModes) {
        pending.consumed = true;
      }
      pendingModes.splice(0);
    },
  };
}

function cloneQueuedFollowUp(
  item: ThreadAgentRuntimeQueuedFollowUp,
): ThreadAgentRuntimeQueuedFollowUp {
  return {
    ...item,
    images: item.images.map((image) => ({ ...image })),
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

    pi.on("tool_call", (event) => {
      const mode = queue.active();
      const profile = interactionModeToolProfile(mode);
      if (!profile || profile.includes(event.toolName)) {
        return undefined;
      }
      const reason =
        mode === "ask"
          ? gM
          : mode === "plan"
            ? "You are in plan mode and cannot run tools outside the planning profile. Switch to Build mode if edits are required."
            : "You are in debug mode and cannot run tools outside the debugging profile.";
      return {
        block: true,
        reason,
      };
    });

    pi.on("agent_end", () => {
      queue.reset();
    });
  };
}

function applyToolCallDescriptionSupport(
  session: Awaited<ReturnType<typeof createAgentSession>>["session"],
): void {
  session.agent.state.tools = patchToolCallDescriptionAgentTools(session.agent.state.tools);
}

interface InteractionModeToolSession {
  getActiveToolNames(): string[];
  setActiveToolsByName(toolNames: string[]): void;
}

const READ_ONLY_MODE_TOOLS = ["read", "grep", "find", "ls", "ask_question"] as const;
const gM =
  "You are in ask mode and cannot run non read-only tools. Ask the user to switch to agent mode if edits are required.";
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
    case "multitask":
      return null;
  }
}

function interactionModeGuidance(mode: AgentInteractionMode): string | undefined {
  switch (mode) {
    case "agent":
      return undefined;
    case "multitask":
      return [
        "## Honk Interaction Mode: Multitask",
        "Act as a coordinator for work that can proceed in parallel. Prefer delegation over doing all work yourself.",
        "For any non-trivial task involving codebase discovery, implementation, verification, review, or UI iteration, your first action should be one or more subagent tool calls with runInBackground: true.",
        "Use the subagent tool's tasks array when there are multiple independent workstreams; otherwise start a single focused background Worker.",
        "Do not perform broad local exploration or implementation before starting at least one background subagent. Use your own tools only for tiny single-step work, preparing subagent prompts, explicit user-facing coordination, or synthesizing/verification after notifications.",
        "After starting background subagents, return control to the user instead of waiting or polling for results. Say briefly what you delegated.",
        "When you receive <agent_notification> completion messages, synthesize completed work into the visible answer and decide whether more coordination is needed.",
        "Do not spawn duplicate background workers for the same task. Keep each worker prompt focused and include enough context for the child to work without this conversation.",
        "If you choose not to start a background subagent, the task must be obviously trivial and you should proceed normally.",
      ].join("\n");
    case "ask":
      return [
        "## Honk Interaction Mode: Ask",
        "Explore the codebase and answer the user's question without making changes.",
        "",
        "=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===",
        "You are STRICTLY PROHIBITED from:",
        "- Creating new files, editing existing files, deleting files, renaming files, or moving files.",
        "- Applying patches, writing commits, changing configuration, installing packages, or updating lockfiles.",
        "- Running shell commands or browser automation that modify files, processes, network state, credentials, or external systems.",
        "- Using subagents, MCP mutation tools, edit/write/apply_patch tools, or any tool outside the read-only profile.",
        "",
        "Only read-only tools are enabled in this mode: read, grep, find, ls, and ask_question.",
        "Answer directly when the existing context is enough; inspect with read-only tools only when needed for accuracy.",
        "Do not be eager to implement. If the user asks how something works, explain it rather than changing it.",
        "Cite important code references with line ranges in the form startLine:endLine:filepath.",
        "Use ask_question only when blocked on a user decision or missing requirement, not for trivia you can infer or inspect.",
        "If edits are required, tell the user to switch to Build or Plan mode instead of attempting the change.",
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
  }
}

function turnSequenceForThread(threadId: ThreadId, turnId: TurnId): number | null {
  const prefix = `${threadId}:turn:`;
  const value = String(turnId);
  if (!value.startsWith(prefix)) {
    return null;
  }
  const sequence = Number.parseInt(value.slice(prefix.length), 10);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
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
