import {
  HONK_DEFAULT_MODE,
  HONK_MODES,
  type HonkPermissionConfig,
  honkModeAgentName,
} from "./host-plugin/agents";
import {
  HONK_AGENT_PAIRINGS,
  HONK_MODEL_IDS,
  HONK_PRESET_STOPS,
  honkModelSpec,
  honkSidekickAgentName,
  type HonkPresetStop,
} from "./host-plugin/pairing";
import { HONK_OPENCODE_PLUGIN_MODULES } from "./host-plugin-manifest.generated";
import { MANAGED_ANTHROPIC_PLUGIN_SPEC } from "./provider-auth";

export {
  HONK_AGENT_PAIRINGS,
  HONK_DEFAULT_MODE,
  HONK_MODEL_IDS,
  HONK_MODES,
  HONK_OPENCODE_PLUGIN_MODULES,
  HONK_PRESET_STOPS,
  honkModeAgentName,
  honkSidekickAgentName,
};
export type { HonkPresetStop };

export const HONK_OPENCODE_PLUGIN_DIRECTORY = "honk-opencode-plugin";
export const HONK_OPENCODE_PLUGIN_ENTRY_FILE = "index.ts";

// Pin auth plugin versions. OpenCode installs npm plugins at runtime.
export const HONK_OPENCODE_DEFAULT_PLUGINS = [MANAGED_ANTHROPIC_PLUGIN_SPEC] as const;

interface OpencodeAgentConfig {
  readonly mode: "primary" | "subagent" | "all";
  readonly description: string;
  readonly model?: string;
  readonly variant?: string;
  readonly prompt?: string;
  readonly permission?: HonkPermissionConfig;
  readonly hidden?: boolean;
}

export interface HonkOpencodeConfig {
  readonly $schema: string;
  readonly plugin: readonly string[];
  readonly default_agent: string;
  readonly agent: Readonly<Record<string, OpencodeAgentConfig>>;
}

function sidekickDescription(stop: HonkPresetStop): string {
  return `Persistent execution sidekick paired with the main agent for the ${stop} preset.`;
}

/** Honk overlay merged via OPENCODE_CONFIG, written outside the user config directory. */
export function buildHonkOpencodeConfig(honkPluginPath: string): HonkOpencodeConfig {
  const agent: Record<string, OpencodeAgentConfig> = {};

  // Mode agent is a soft override. Model stays hard-pinned. Plugin picks the sidekick.
  for (const mode of HONK_MODES) {
    agent[mode.agent] = {
      mode: "primary",
      description: mode.description,
      ...(mode.prompt === null ? {} : { prompt: mode.prompt }),
      permission: mode.permission,
    };
  }

  for (const pairing of HONK_AGENT_PAIRINGS) {
    agent[honkSidekickAgentName(pairing.stop)] = {
      model: honkModelSpec(pairing.sidekick),
      variant: pairing.sidekick.variant,
      mode: "subagent",
      description: sidekickDescription(pairing.stop),
      permission: { task: "deny", todowrite: "deny" },
      hidden: true,
    };
  }

  return {
    $schema: "https://opencode.ai/config.json",
    plugin: [...HONK_OPENCODE_DEFAULT_PLUGINS, honkPluginPath],
    default_agent: honkModeAgentName(HONK_DEFAULT_MODE),
    agent,
  };
}
