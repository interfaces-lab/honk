import { HONK_MODEL_IDS } from "./pairing";
import type { Hooks, PluginConfig, PluginInput } from "./types";

// V2 reads the static provider catalog directly. The stable Claude plugin authors its
// own model catalog and cannot consume those raw config entries, so remove them only
// from the stable config before that plugin runs. Honk's main plugin restores Fast Opus
// after the Claude plugin has normalized its standard catalog.
export async function guardStableClaudeCatalog(_plugin: PluginInput): Promise<Hooks> {
  return {
    async config(config: PluginConfig) {
      const provider = config.provider?.[HONK_MODEL_IDS.opus5.providerID];
      if (provider !== undefined) delete provider.models;
    },
  };
}

export const id = "honk-claude-catalog-stable-guard";
export default { id, server: guardStableClaudeCatalog };
