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
  readonly metadata: unknown;
}

export interface Hooks {
  readonly tool?: Readonly<Record<string, ToolDefinition>>;
  "chat.message"?: (input: ChatMessageInput, output: unknown) => Promise<void>;
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
  dispose?: () => Promise<void>;
}

interface PluginResponse<Data> {
  readonly data?: Data;
}

export interface PluginMessageGroup {
  readonly info: { readonly role: string };
  readonly parts: readonly Readonly<Record<string, unknown>>[];
}

export interface PluginInput {
  readonly client: {
    readonly session: {
      readonly messages: (options: {
        readonly path: { readonly id: string };
        readonly query: { readonly directory: string };
      }) => Promise<PluginResponse<readonly PluginMessageGroup[]>>;
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
