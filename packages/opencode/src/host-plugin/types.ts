// Local contract slices. Bare SDK imports cannot resolve in the emitted state directory.
// Re-check against the pinned OpenCode release on bumps.

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolResult {
  readonly title?: string;
  readonly output: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ToolContext {
  readonly sessionID: string;
  readonly agent: string;
}

export interface ToolDefinition {
  readonly description: string;
  // Legacy registry treats every listed property as required without zod.
  readonly args: Readonly<Record<string, JsonSchema>>;
  execute(args: unknown, context: ToolContext): Promise<ToolResult | string>;
}

interface Permission {
  readonly sessionID: string;
  readonly permission: string;
}

export interface PromptModel {
  readonly providerID: string;
  readonly modelID: string;
}

export interface ChatMessageInput {
  readonly sessionID: string;
  readonly agent?: string;
  readonly model?: PromptModel;
  readonly variant?: string;
}

export interface ChatHeadersInput {
  readonly sessionID: string;
  readonly agent: string;
  readonly model: {
    readonly id: string;
    readonly providerID: string;
  };
  readonly provider: Readonly<Record<string, unknown>>;
  readonly message: Readonly<Record<string, unknown>>;
}

export interface ChatHeadersOutput {
  readonly headers: Record<string, string>;
}

export interface CompactionHookOutput {
  readonly context: string[];
  prompt?: string;
}

export interface ToolHookInput {
  readonly tool: string;
  readonly sessionID: string;
  readonly callID: string;
}

export interface ToolAfterHookInput extends ToolHookInput {
  readonly args: unknown;
}

export interface ToolAfterHookOutput {
  readonly title: string;
  readonly output: string;
  metadata: unknown;
}

export interface PluginEvent {
  readonly type: string;
  readonly properties: unknown;
}

export interface PluginConfigModel {
  readonly [key: string]: unknown;
  readonly id?: string;
  readonly name?: string;
  readonly cost?: Readonly<Record<string, unknown>>;
}

export interface PluginConfig {
  provider?: Record<
    string,
    {
      models?: Record<string, PluginConfigModel>;
    }
  >;
}

export interface Hooks {
  config?: (input: PluginConfig) => Promise<void>;
  readonly tool?: Readonly<Record<string, ToolDefinition>>;
  event?: (input: { event: PluginEvent }) => Promise<void>;
  "chat.message"?: (input: ChatMessageInput, output: unknown) => Promise<void>;
  "chat.headers"?: (input: ChatHeadersInput, output: ChatHeadersOutput) => Promise<void>;
  "permission.ask"?: (
    input: Permission,
    output: { status: "ask" | "deny" | "allow" },
  ) => Promise<void>;
  "tool.execute.before"?: (input: ToolHookInput, output: { args: unknown }) => Promise<void>;
  "tool.execute.after"?: (input: ToolAfterHookInput, output: ToolAfterHookOutput) => Promise<void>;
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ) => Promise<void>;
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: CompactionHookOutput,
  ) => Promise<void>;
  dispose?: () => Promise<void>;
}

interface PluginResponse<Data> {
  readonly data?: Data;
}

export interface PluginMessageGroup {
  readonly info: {
    readonly role: string;
    readonly summary?: boolean;
    readonly finish?: string;
    readonly error?: unknown;
    readonly model?: {
      readonly providerID?: string;
      readonly modelID?: string;
    };
  };
  readonly parts: readonly Readonly<Record<string, unknown>>[];
}

export interface PluginSession {
  readonly id: string;
  readonly parentID?: string;
}

export interface PluginInput {
  readonly client: {
    readonly session: {
      readonly get: (options: {
        readonly path: { readonly id: string };
        readonly query: { readonly directory: string };
      }) => Promise<PluginResponse<PluginSession>>;
      readonly messages: (options: {
        readonly path: { readonly id: string };
        readonly query: { readonly directory: string };
      }) => Promise<PluginResponse<readonly PluginMessageGroup[]>>;
      readonly abort: (options: {
        readonly path: { readonly id: string };
        readonly query: { readonly directory: string };
      }) => Promise<PluginResponse<boolean>>;
    };
  };
  readonly directory: string;
}

export interface PermissionRule {
  action: string;
  resource: string;
  effect: "allow" | "ask" | "deny";
}

export interface AgentInfo {
  id: string;
  model?: { id: string; providerID: string; variant?: string };
  system?: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden: boolean;
  permissions: PermissionRule[];
}

export interface AgentDraft {
  update(id: string, update: (agent: AgentInfo) => void): void;
}

export interface PluginContext {
  readonly agent: {
    transform(update: (draft: AgentDraft) => void): Promise<void>;
  };
}
