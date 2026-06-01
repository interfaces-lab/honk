import type {
  AgentModelPolicy,
  AgentRuntimeEvent,
  AgentRuntimeIdentity,
  SessionTreeProjection,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import {
  AuthStorage,
  type CreateAgentSessionOptions,
  type ExtensionFactory,
  type PromptOptions,
  type ResourceLoader,
  type ToolDefinition,
  DefaultResourceLoader,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  authProviderIdFromPiModel,
  createAuthStatus,
  createModelPolicy,
  modelIdFromPiModel,
} from "./auth-model-policy";
import { createDesktopExtensionUi, type DesktopExtensionUiController } from "./extension-ui";
import { makeRuntimeEventId, makeRuntimeSessionId, makeTurnId } from "./ids";
import { projectPiAgentSessionEvent } from "./event-projection";
import { projectRuntimeSessionTree } from "./session-tree-projection";

export interface ThreadAgentRuntimeOptions {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly agentDir?: string;
  readonly model?: Model<string>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly scopedModels?: ReadonlyArray<{ readonly model: Model<string>; readonly thinkingLevel?: ThinkingLevel }>;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly customTools?: readonly ToolDefinition[];
  readonly extensionFactories?: readonly ExtensionFactory[];
  readonly resourceLoader?: ResourceLoader;
  readonly authStorage?: AuthStorage;
  readonly policy?: AgentModelPolicy;
}

export interface SendMessageOptions extends Pick<PromptOptions, "expandPromptTemplates" | "source"> {
  readonly streamingBehavior?: "steer" | "followUp";
}

export type AgentRuntimeEventListener = (event: AgentRuntimeEvent) => void;

export class ThreadAgentRuntime {
  private readonly listeners = new Set<AgentRuntimeEventListener>();
  private readonly unsubscribeSessionEvents: () => void;
  private eventSequence = 0;
  private turnSequence = 0;
  private activeTurnId: TurnId | undefined;

  private constructor(
    readonly threadId: ThreadId,
    private readonly options: ThreadAgentRuntimeOptions,
    private readonly sessionResult: Awaited<ReturnType<typeof createAgentSession>>,
    readonly policy: AgentModelPolicy,
  ) {
    this.unsubscribeSessionEvents = sessionResult.session.subscribe((event) => {
      this.emit(
        projectPiAgentSessionEvent(event, {
          threadId: this.threadId,
          runtimeSessionId: this.runtimeSessionId,
          ...(this.activeTurnId ? { turnId: this.activeTurnId } : {}),
          sequence: this.nextEventSequence(),
        }),
      );
    });
  }

  static async create(options: ThreadAgentRuntimeOptions): Promise<ThreadAgentRuntime> {
    const sessionOptions: CreateAgentSessionOptions = {
      cwd: options.cwd,
    };
    if (options.agentDir) sessionOptions.agentDir = options.agentDir;
    if (options.model) sessionOptions.model = options.model;
    if (options.thinkingLevel) sessionOptions.thinkingLevel = options.thinkingLevel;
    if (options.scopedModels) sessionOptions.scopedModels = [...options.scopedModels];
    if (options.tools) sessionOptions.tools = [...options.tools];
    if (options.excludeTools) sessionOptions.excludeTools = [...options.excludeTools];
    if (options.customTools) sessionOptions.customTools = [...options.customTools];
    if (options.resourceLoader) sessionOptions.resourceLoader = options.resourceLoader;
    if (!options.resourceLoader && options.extensionFactories) {
      const agentDir = options.agentDir ?? options.cwd;
      const resourceLoader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir,
        extensionFactories: [...options.extensionFactories],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      });
      await resourceLoader.reload();
      sessionOptions.resourceLoader = resourceLoader;
    }
    if (options.authStorage) sessionOptions.authStorage = options.authStorage;

    const sessionResult = await createAgentSession(sessionOptions);
    const model = sessionResult.session.model as Model<string> | undefined;
    const policyInput = {
      ...(model ? { model } : {}),
      thinkingLevel: sessionResult.session.thinkingLevel,
      ...(options.tools ? { allowedToolNames: options.tools } : {}),
      ...(options.excludeTools ? { excludedToolNames: options.excludeTools } : {}),
    };
    const policy = options.policy ?? createModelPolicy(policyInput);

    const runtime = new ThreadAgentRuntime(options.threadId, options, sessionResult, policy);
    runtime.emit(runtime.createEvent("session.started", "Pi session created"));
    runtime.emit(runtime.createEvent("session.ready", sessionResult.modelFallbackMessage));
    return runtime;
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

  get identity(): AgentRuntimeIdentity {
    const model = this.session.model as Model<string> | undefined;
    return {
      agentRuntime: "pi",
      threadId: this.threadId,
      runtimeSessionId: this.runtimeSessionId,
      ...(model ? { authProviderId: authProviderIdFromPiModel(model) } : {}),
      ...(model ? { modelId: modelIdFromPiModel(model) } : {}),
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

  async sendMessage(text: string, options: SendMessageOptions = {}): Promise<TurnId> {
    const turnId = makeTurnId(this.threadId, ++this.turnSequence);
    this.activeTurnId = turnId;
    this.emit(this.createEvent("turn.started", text, turnId));
    try {
      await this.session.prompt(text, options);
      this.emit(this.createEvent("tree.updated", "Session tree updated", turnId));
      return turnId;
    } finally {
      this.activeTurnId = undefined;
    }
  }

  async steer(text: string): Promise<void> {
    await this.session.steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.session.followUp(text);
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
    };
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
