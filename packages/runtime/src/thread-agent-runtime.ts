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
  TurnId,
} from "@multi/contracts";
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
import { createDesktopExtensionUi, type DesktopExtensionUiController } from "./extension-ui";
import { makeRuntimeEventId, makeRuntimeSessionId, makeTurnId } from "./ids";
import { projectPiAgentSessionEvent } from "./event-projection";
import { extractMessageText } from "./message-text";
import { CREATE_PLAN_TOOL_NAME, extractCreatePlanToolResultMarkdown } from "./plan-extension";
import { projectRuntimeSessionTree } from "./session-tree-projection";

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
  readonly scopedModels?: ReadonlyArray<{ readonly model: Model<string>; readonly thinkingLevel?: ThinkingLevel }>;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly customTools?: readonly ToolDefinition[];
  readonly extensionFactories?: readonly ExtensionFactory[];
  readonly resourceLoader?: ResourceLoader;
  readonly authStorage?: AuthStorage;
  readonly modelRegistry?: CreateAgentSessionOptions["modelRegistry"];
  readonly policy: AgentModelPolicy;
}

export interface SendMessageOptions {
  readonly clientMessageId: MessageId | null;
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

  private constructor(
    readonly threadId: ThreadId,
    private readonly options: ThreadAgentRuntimeOptions,
    private readonly sessionResult: Awaited<ReturnType<typeof createAgentSession>>,
    readonly policy: AgentModelPolicy,
    private readonly interactionModeQueue: InteractionModeQueue,
  ) {
    this.unsubscribeSessionEvents = sessionResult.session.subscribe((event) => {
      this.bindPendingPromptClientMessages();
      const turnId = this.preparePiEventTurnId(event);
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
      this.finishPiEventTurn(event, turnId);
    });
  }

  static async create(options: ThreadAgentRuntimeOptions): Promise<ThreadAgentRuntime> {
    const policyThinkingLevel =
      options.policy.thinkingLevel ?? thinkingLevelForAgentMode(options.policy.agentMode);
    const effectiveThinkingLevel = options.thinkingLevel ?? policyThinkingLevel;
    const authStorage = options.authStorage ?? AuthStorage.create(join(options.agentDir, "auth.json"));
    const modelRegistry =
      options.modelRegistry ??
      ModelRegistry.create(authStorage, join(options.agentDir, "models.json"));
    const effectiveModel = resolvePolicyModel({
      policy: options.policy,
      model: options.model,
      modelRegistry,
    });
    const interactionModeQueue = createInteractionModeQueue();
    const sessionOptions: CreateAgentSessionOptions = {
      cwd: options.cwd,
    };
    sessionOptions.agentDir = options.agentDir;
    if (effectiveModel) sessionOptions.model = effectiveModel;
    if (effectiveThinkingLevel) {
      sessionOptions.thinkingLevel = effectiveThinkingLevel;
    }
    if (options.scopedModels) sessionOptions.scopedModels = [...options.scopedModels];
    if (options.tools) sessionOptions.tools = [...options.tools];
    if (options.excludeTools) sessionOptions.excludeTools = [...options.excludeTools];
    if (options.customTools) sessionOptions.customTools = [...options.customTools];
    if (options.resourceLoader) sessionOptions.resourceLoader = options.resourceLoader;
    sessionOptions.modelRegistry = modelRegistry;
    if (!options.resourceLoader) {
      const resourceLoader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir: options.agentDir,
        extensionFactories: [
          ...(options.extensionFactories ?? []),
          createInteractionModeExtension(interactionModeQueue),
        ],
        ...(options.extensionFactories
          ? {
              noExtensions: true,
              noSkills: true,
              noPromptTemplates: true,
              noThemes: true,
            }
          : {}),
      });
      await resourceLoader.reload();
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
        ...(options.tools ? { allowedToolNames: options.tools } : {}),
        ...(options.excludeTools ? { excludedToolNames: options.excludeTools } : {}),
      };
      const resolvedPolicy = createModelPolicy(policyInput);
      const policy = {
        ...resolvedPolicy,
        ...options.policy,
        thinkingLevel: options.policy.thinkingLevel ?? resolvedPolicy.thinkingLevel,
      };

      runtime = new ThreadAgentRuntime(
        options.threadId,
        options,
        sessionResult,
        policy,
        interactionModeQueue,
      );
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
    const interactionMode = this.interactionModeQueue.enqueue(options.interactionMode);
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

  async steer(
    text: string,
    images: readonly ThreadAgentRuntimeImageAttachment[],
  ): Promise<void> {
    await this.session.steer(text, toPiImageContent(images));
  }

  async followUp(
    text: string,
    images: readonly ThreadAgentRuntimeImageAttachment[],
  ): Promise<void> {
    await this.session.followUp(text, toPiImageContent(images));
  }

  async abort(): Promise<void> {
    const turnId = this.activeTurnId ?? this.activeRunFirstTurnId;
    await this.session.abort();
    if (turnId) {
      this.emit(this.createEvent("turn.interrupted", "Turn interrupted", turnId));
    }
  }

  async setModel(model: Model<string>): Promise<void> {
    await this.session.setModel(model);
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
    if (event.type === "agent_end") {
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
        existingClientMessageId === undefined ||
        existingClientMessageId === input.clientMessageId
      );
    });

    if (!matchingEntry) {
      return false;
    }

    this.clientMessageIdByEntryId.set(matchingEntry.id, input.clientMessageId);
    return true;
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

  private emit(event: AgentRuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function proposedPlanIdForTurn(threadId: ThreadId, turnId: TurnId): string {
  return `plan:${threadId}:${turnId}`;
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

function interactionModeGuidance(mode: AgentInteractionMode): string | undefined {
  switch (mode) {
    case "agent":
      return undefined;
    case "ask":
      return [
        "## Multi Interaction Mode: Ask",
        "Answer the user directly. Do not change files, run mutating shell commands, create commits, or perform long-running actions.",
        "Use read-only inspection only when it is needed to answer accurately.",
      ].join("\n");
    case "plan":
      return [
        "## Multi Interaction Mode: Plan",
        "Produce a concrete implementation plan through Multi's built-in Pi planning surface.",
        "Research the codebase to find relevant files and review relevant docs before planning.",
        "Ask clarifying questions when requirements are ambiguous or the plan depends on missing decisions.",
        "Use the create_plan tool as the final action once the plan is ready for review.",
        "The create_plan payload should include a short name, overview, actionable todos, isProject, optional phases, and a complete Markdown plan.",
        "The Markdown plan should include diagnosis, implementation steps with file paths or code references, verification, risks, and non-goals.",
        "Stop after creating the plan so the user can review, edit, or approve it before implementation.",
        "Do not change files, run mutating shell commands, create commits, or execute the plan.",
      ].join("\n");
    case "debug":
      return [
        "## Multi Interaction Mode: Debug",
        "Diagnose the issue first and report evidence, likely cause, and next steps.",
        "Prefer read-only inspection and safe diagnostic commands. Do not change files until the cause is clear and the user asks for a fix.",
      ].join("\n");
    default:
      return undefined;
  }
}

function toPiImageContent(
  images: readonly ThreadAgentRuntimeImageAttachment[],
): ImageContent[] {
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
