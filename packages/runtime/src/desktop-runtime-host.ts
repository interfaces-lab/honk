import {
  AuthProviderId,
  type AgentPreferences,
  type AgentPreferencesPatch,
  type AgentRuntimeEvent,
  type DesktopExtensionUiRequest,
  type DesktopExtensionUiRespondInput,
  type MultiRuntimeApi,
  type MultiRuntimeHostEvent,
  type MultiRuntimeHostSnapshot,
  type SessionTreeProjection,
  type ThreadAgentRuntimeSendInput,
  type ThreadAgentRuntimeStartInput,
} from "@multi/contracts";
import { createDesktopExtensionUi, type DesktopExtensionUiController } from "./extension-ui";
import { ThreadAgentRuntime } from "./thread-agent-runtime";

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

interface RuntimeEntry {
  readonly runtime: ThreadAgentRuntime;
  readonly ui: DesktopExtensionUiController;
  readonly unsubscribe: () => void;
}

export class DesktopRuntimeHost implements MultiRuntimeApi {
  private preferences: AgentPreferences;
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly runtimeEvents: AgentRuntimeEvent[] = [];
  private readonly sessionTrees = new Map<string, SessionTreeProjection>();
  private readonly listeners = new Set<(event: MultiRuntimeHostEvent) => void>();

  constructor(preferences: AgentPreferences = DEFAULT_AGENT_PREFERENCES) {
    this.preferences = preferences;
  }

  async getHostSnapshot(): Promise<MultiRuntimeHostSnapshot> {
    return {
      preferences: this.preferences,
      authStatuses: [...this.runtimes.values()].flatMap((entry) => entry.runtime.authStatus ?? []),
      diagnostics: [],
      runtimeEvents: this.runtimeEvents,
      sessionTrees: [...this.sessionTrees.values()],
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

  async startThread(input: ThreadAgentRuntimeStartInput) {
    this.disposeRuntime(input.threadId);
    const runtime = await ThreadAgentRuntime.create({
      threadId: input.threadId,
      cwd: input.cwd,
      ...(input.agentDir ? { agentDir: input.agentDir } : {}),
      policy: input.policy ?? {
        interactionMode: this.preferences.interactionMode,
        permissionMode: this.preferences.permissionMode,
        ...(this.preferences.modelId ? { modelId: this.preferences.modelId } : {}),
        ...(this.preferences.thinkingLevel ? { thinkingLevel: this.preferences.thinkingLevel } : {}),
      },
    });
    const ui = createDesktopExtensionUi();
    const unsubscribe = runtime.subscribe((event) => {
      this.runtimeEvents.push(event);
      this.emit({ type: "runtime-event", event });
      if (event.type === "tree.updated" || event.type === "turn.completed") {
        this.publishSessionTree(runtime);
      }
    });

    this.runtimes.set(input.threadId, { runtime, ui, unsubscribe });
    await runtime.bindExtensions(ui);
    this.publishSessionTree(runtime);
    this.emit({ type: "snapshot", snapshot: await this.getHostSnapshot() });
    return runtime.identity;
  }

  async send(input: ThreadAgentRuntimeSendInput) {
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      throw new Error(`No runtime thread exists for ${input.threadId}.`);
    }
    return entry.runtime.sendMessage(input.input);
  }

  async respondToExtensionUiRequest(input: DesktopExtensionUiRespondInput): Promise<void> {
    const entry = this.runtimes.get(input.threadId);
    if (!entry) {
      throw new Error(`No runtime thread exists for ${input.threadId}.`);
    }
    entry.ui.resolveRequest(input.requestId, input.value);
    this.emit({ type: "pending-extension-ui", requests: this.getPendingExtensionUiRequests() });
  }

  onHostEvent(listener: (event: MultiRuntimeHostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    for (const threadId of [...this.runtimes.keys()]) {
      this.disposeRuntime(threadId);
    }
    this.listeners.clear();
  }

  private publishSessionTree(runtime: ThreadAgentRuntime): void {
    const tree = runtime.getSessionTree();
    this.sessionTrees.set(runtime.threadId, tree);
    this.emit({ type: "session-tree", tree });
    this.emit({ type: "pending-extension-ui", requests: this.getPendingExtensionUiRequests() });
  }

  private getPendingExtensionUiRequests(): DesktopExtensionUiRequest[] {
    return [...this.runtimes.values()].flatMap((entry) =>
      entry.ui.pendingRequests.map((request) => ({
        ...request,
        threadId: entry.runtime.threadId,
        runtimeSessionId: entry.runtime.runtimeSessionId,
      })),
    );
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
    entry.unsubscribe();
    entry.runtime.dispose();
    this.runtimes.delete(threadId);
    this.sessionTrees.delete(threadId);
  }
}
