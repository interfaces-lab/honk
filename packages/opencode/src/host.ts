import {
  HONK_BASE_SYSTEM,
  HONK_DEFAULT_MODE,
  HONK_FUSION_AGENTS,
  HONK_MODES,
  HONK_PRESET_AGENTS,
  HONK_PRIMARY_SYSTEM,
  type HonkPermissionConfig,
  honkModeAgentName,
  honkPresetAgentByName,
} from "./host-plugin/agents";
import {
  HONK_AGENT_PAIRINGS,
  HONK_CLAUDE_MODEL_COSTS,
  HONK_MODEL_IDS,
  HONK_PRESET_STOPS,
  honkFusionAgentName,
  honkModelSpec,
  honkSidekickAgentName,
  type HonkPresetStop,
} from "./host-plugin/pairing";
import { HONK_OPENCODE_PLUGIN_MODULES } from "./host-plugin-manifest.generated";

export {
  HONK_AGENT_PAIRINGS,
  HONK_DEFAULT_MODE,
  HONK_FUSION_AGENTS,
  HONK_MODEL_IDS,
  HONK_MODES,
  HONK_OPENCODE_PLUGIN_MODULES,
  HONK_PRESET_AGENTS,
  HONK_PRESET_STOPS,
  honkFusionAgentName,
  honkModeAgentName,
  honkPresetAgentByName,
  honkSidekickAgentName,
};
export type { HonkPresetStop };

export const HONK_OPENCODE_PLUGIN_DIRECTORY = "honk-opencode-plugin";
export const HONK_OPENCODE_PLUGIN_ENTRY_FILE = "index.ts";
export const HONK_OPENCODE_MCP_SERVER_FILE = "mcp-server.mjs";
export const HONK_CLAUDE_FAST_WRAPPER_FILE = "claude-fast-wrapper.sh";
export const HONK_CLAUDE_FAST_WRAPPER_WINDOWS_FILE = "claude-fast-wrapper.cmd";
export const HONK_CLAUDE_CATALOG_STABLE_GUARD_FILE = "claude-catalog-stable-guard.ts";

// Registers the `claude-code` provider by wrapping the user's local `claude` CLI, so the
// Claude arms authenticate through that CLI's login instead of an Anthropic key Honk stores.
// Pinned: the plugin owns a provider surface, so treat bumps as a reviewed dependency change.
export const HONK_CLAUDE_CODE_PLUGIN_PACKAGE = "@khalilgharbaoui/opencode-claude-code-plugin";
export const HONK_CLAUDE_CODE_PLUGIN = `${HONK_CLAUDE_CODE_PLUGIN_PACKAGE}@0.12.0`;

const HONK_TITLE_MODEL = {
  ...HONK_MODEL_IDS.luna,
} as const;

interface OpencodeAgentConfig {
  readonly mode?: "primary" | "subagent" | "all";
  readonly description?: string;
  readonly model?: string;
  readonly variant?: string;
  readonly prompt?: string;
  readonly permission?: HonkPermissionConfig;
  readonly hidden?: boolean;
}

interface OpencodeProviderConfig {
  readonly npm?: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly models?: Readonly<Record<string, OpencodeModelConfig>>;
}

interface OpencodeModelConfig {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly release_date: string;
  readonly attachment: boolean;
  readonly reasoning: boolean;
  readonly temperature: boolean;
  readonly tool_call: boolean;
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cache_read: number;
    readonly cache_write: number;
  };
  readonly limit: { readonly context: number; readonly output: number };
  readonly modalities: {
    readonly input: readonly ("text" | "image" | "pdf")[];
    readonly output: readonly ["text"];
  };
  readonly variants: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface HonkLocalMcpConfig {
  readonly type: "local";
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
  readonly timeout?: number;
}

export interface HonkRemoteMcpConfig {
  readonly type: "remote";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly oauth?:
    | false
    | {
        readonly clientId?: string;
        readonly clientSecret?: string;
        readonly scope?: string;
        readonly callbackPort?: number;
        readonly redirectUri?: string;
      };
  readonly enabled?: boolean;
  readonly timeout?: number;
}

export interface HonkMcpOverrideConfig {
  readonly enabled: boolean;
}

export type HonkMcpServerConfig = HonkLocalMcpConfig | HonkRemoteMcpConfig | HonkMcpOverrideConfig;

export interface HonkOpencodeConfig {
  readonly $schema: string;
  readonly plugin: readonly string[];
  readonly provider: Readonly<Record<string, OpencodeProviderConfig>>;
  readonly mcp?: Readonly<Record<string, HonkMcpServerConfig>>;
  readonly permission: HonkPermissionConfig;
  readonly default_agent: string;
  readonly small_model: string;
  readonly skills: { readonly paths: readonly string[] };
  readonly agent: Readonly<Record<string, OpencodeAgentConfig>>;
}

function sidekickDescription(stop: HonkPresetStop): string {
  return `Persistent execution sidekick paired with the main agent for the ${stop} preset.`;
}

const CLAUDE_REASONING_VARIANTS = Object.freeze({
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  xhigh: { reasoningEffort: "xhigh" },
  max: { reasoningEffort: "max" },
});

function claudeModelConfig(input: {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly releaseDate: string;
  readonly cost: (typeof HONK_CLAUDE_MODEL_COSTS)[keyof typeof HONK_CLAUDE_MODEL_COSTS];
}): OpencodeModelConfig {
  return {
    id: input.id,
    name: input.name,
    family: input.family,
    release_date: input.releaseDate,
    attachment: true,
    reasoning: true,
    temperature: false,
    tool_call: true,
    cost: {
      input: input.cost.input,
      output: input.cost.output,
      cache_read: input.cost.cacheRead,
      cache_write: input.cost.cacheWrite,
    },
    limit: { context: 1_000_000, output: 128_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    variants: CLAUDE_REASONING_VARIANTS,
  };
}

function siblingPluginPath(entryPath: string, fileName: string): string {
  const separator = Math.max(entryPath.lastIndexOf("/"), entryPath.lastIndexOf("\\"));
  return `${entryPath.slice(0, separator + 1)}${fileName}`;
}

/** Honk overlay merged via OPENCODE_CONFIG, written outside the user config directory. */
export function buildHonkOpencodeConfig(
  honkPluginPath: string,
  options?: {
    readonly claudeCliPath?: string;
    readonly mcpServerCommand?: readonly string[];
    readonly mcp?: Readonly<Record<string, HonkMcpServerConfig>>;
  },
): HonkOpencodeConfig {
  const agent: Record<string, OpencodeAgentConfig> = {
    title: {
      model: honkModelSpec(HONK_TITLE_MODEL),
    },
  };

  // Mode agent is a soft override. Model stays hard-pinned. Plugin picks the sidekick.
  for (const mode of HONK_MODES) {
    agent[mode.agent] = {
      mode: "primary",
      description: mode.description,
      prompt: HONK_PRIMARY_SYSTEM,
      permission: mode.permission,
    };
  }

  for (const fusion of HONK_FUSION_AGENTS) {
    agent[fusion.agent] = {
      mode: "primary",
      description: fusion.description,
      prompt: HONK_PRIMARY_SYSTEM,
      permission: fusion.permission,
    };
  }

  for (const pairing of HONK_AGENT_PAIRINGS) {
    agent[honkSidekickAgentName(pairing.stop)] = {
      model: honkModelSpec(pairing.sidekick),
      variant: pairing.sidekick.variant,
      mode: "subagent",
      description: sidekickDescription(pairing.stop),
      prompt: HONK_BASE_SYSTEM,
      permission: {
        task: "deny",
        todowrite: "deny",
        honk_plan_submit: "deny",
        honk_debug_submit: "deny",
        parent_chat: "deny",
        sidekick_status: "deny",
        sidekick_stop: "deny",
      },
      hidden: true,
    };
  }

  for (const preset of HONK_PRESET_AGENTS) {
    agent[preset.agent] = {
      model: honkModelSpec(preset.model),
      variant: preset.model.variant,
      mode: "subagent",
      description: preset.description,
      prompt: HONK_BASE_SYSTEM,
      permission: {
        edit: "deny",
        task: "deny",
        todowrite: "deny",
        honk_plan_submit: "deny",
        honk_debug_submit: "deny",
        parent_chat: "deny",
        sidekick_status: "deny",
        sidekick_stop: "deny",
      },
    };
  }

  return {
    $schema: "https://opencode.ai/config.json",
    // V2 keeps this static catalog. Stable execution removes it before the Claude plugin
    // normalizes its own models, then Honk's main plugin restores the Fast virtual model.
    plugin: [
      siblingPluginPath(honkPluginPath, HONK_CLAUDE_CATALOG_STABLE_GUARD_FILE),
      HONK_CLAUDE_CODE_PLUGIN,
      honkPluginPath,
    ],
    provider: {
      [HONK_MODEL_IDS.fable5.providerID]: {
        npm: HONK_CLAUDE_CODE_PLUGIN,
        options: {
          ...(options?.claudeCliPath === undefined ? {} : { cliPath: options.claudeCliPath }),
          // A stray ANTHROPIC_API_KEY in the environment would otherwise make the CLI bill
          // pay-as-you-go and silently bypass the user's subscription.
          ignoreAnthropicApiKey: true,
          // CLI-side tools run unprompted and control requests auto-approve; opencode's
          // agent permission config is the single gate, applied to the proxied tools.
          // AskUserQuestion keeps the plugin's built-in deny so questions can only reach
          // the user through the question proxy below, never a CLI-side prompt.
          skipPermissions: true,
          controlRequestBehavior: "allow",
          // Setting proxyTools replaces the plugin's default list, so the defaults are
          // restated. "task" disallows the CLI's internal Agent tool and routes subagent
          // dispatch through opencode's task tool, so delegations become real opencode
          // child sessions the app can render.
          proxyTools: ["bash", "edit", "write", "webfetch", "task", "question"],
          // Preset agents run in the foreground, so the proxy must outlive long model
          // turns; questions block on a human reply.
          proxyToolTimeoutMs: { task: 60 * 60 * 1000, question: 60 * 60 * 1000 },
        },
        models: {
          [HONK_MODEL_IDS.fable5.id]: claudeModelConfig({
            id: HONK_MODEL_IDS.fable5.id,
            name: "Claude Fable 5 (10×)",
            family: "fable",
            releaseDate: "2026-06-09",
            cost: HONK_CLAUDE_MODEL_COSTS.fable5,
          }),
          [HONK_MODEL_IDS.opus5.id]: claudeModelConfig({
            id: HONK_MODEL_IDS.opus5.id,
            name: "Claude Opus 5 (5×)",
            family: "opus",
            releaseDate: "2026-07-24",
            cost: HONK_CLAUDE_MODEL_COSTS.opus5,
          }),
          [HONK_MODEL_IDS.opus5Fast.id]: claudeModelConfig({
            id: HONK_MODEL_IDS.opus5Fast.id,
            name: "Claude Opus 5 Fast (10×)",
            family: "opus",
            releaseDate: "2026-07-24",
            cost: HONK_CLAUDE_MODEL_COSTS.opus5Fast,
          }),
        },
      },
    },
    // The sanctioned seam for Honk-owned tools that must reach every arm: native providers
    // load these servers in-process, and the claude-code plugin bridges this on-disk config
    // into the CLI with --mcp-config. Plugin `tool:` hooks reach only the native arms.
    // BUN_BE_BUN makes the opencode binary run the script as plain Bun instead of its CLI.
    ...(options?.mcpServerCommand === undefined && options?.mcp === undefined
      ? {}
      : {
          mcp: {
            ...options?.mcp,
            ...(options?.mcpServerCommand === undefined
              ? {}
              : {
                  // The built-in server is reserved and always wins over persisted input.
                  honk: {
                    type: "local" as const,
                    command: [...options.mcpServerCommand],
                    environment: { BUN_BE_BUN: "1" },
                    enabled: true,
                  },
                }),
          },
        }),
    // Global rules merge after opencode's defaults and before each agent's own block, so this
    // reaches every arm. An external-directory ask never times out, and an unattended subagent
    // has nobody to answer it. Bash is already unrestricted for agents that can leave the project.
    permission: { external_directory: "allow" },
    default_agent: honkModeAgentName(HONK_DEFAULT_MODE),
    small_model: honkModelSpec(HONK_TITLE_MODEL),
    // The V2 skill registry only scans opencode config directories, not the
    // .claude/.agents conventions the model-facing registry scans. Listing both here
    // keeps sdk.v2.skill.list (the composer's skill menu) in sync with what the model
    // sees. Relative paths resolve against the session directory and `~/` against the
    // home directory (personal skills); missing dirs are skipped.
    skills: {
      paths: [".claude/skills", ".agents/skills", "~/.claude/skills", "~/.agents/skills"],
    },
    agent,
  };
}
