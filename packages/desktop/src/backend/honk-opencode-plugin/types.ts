// Minimal local types for the OpenCode v1 plugin surface. This emitted plugin
// cannot use bare package imports, so only the contract slices Honk consumes live
// here.

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
  // OpenCode's legacy registry builds an object schema from these raw property
  // schemas. Without zod, every listed property is required.
  readonly args: Readonly<Record<string, JsonSchema>>;
  execute(args: unknown, context: ToolContext): Promise<ToolResult | string>;
}

interface Permission {
  readonly sessionID: string;
  readonly permission: string;
}

export interface Hooks {
  readonly tool?: Readonly<Record<string, ToolDefinition>>;
  "chat.message"?: (input: { sessionID: string; agent?: string }, output: unknown) => Promise<void>;
  "permission.ask"?: (
    input: Permission,
    output: { status: "ask" | "deny" | "allow" },
  ) => Promise<void>;
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown },
  ) => Promise<void>;
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ) => Promise<void>;
  dispose?: () => Promise<void>;
}

interface PluginResponse<Data> {
  readonly data?: Data;
}

export interface PluginSession {
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PluginMessageGroup {
  readonly info: { readonly role: string };
  readonly parts: readonly Readonly<Record<string, unknown>>[];
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
    };
  };
  readonly directory: string;
}
