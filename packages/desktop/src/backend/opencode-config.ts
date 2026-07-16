import {
  buildHonkOpencodeConfig,
  HONK_OPENCODE_PLUGIN_DIRECTORY,
  HONK_OPENCODE_PLUGIN_ENTRY_FILE,
  HONK_OPENCODE_PLUGIN_MODULES,
} from "@honk/opencode/host";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import { Path } from "effect";

export {
  buildHonkOpencodeConfig,
  HONK_AGENT_PAIRINGS,
  HONK_DEFAULT_MODE as OPENCODE_DEFAULT_MODE,
  HONK_MODEL_IDS as OPENCODE_MODEL_IDS,
  HONK_MODES as OPENCODE_MODES,
  HONK_PRESET_STOPS as OPENCODE_PRESET_STOPS,
  honkModeAgentName as opencodeModeAgentName,
  honkSidekickAgentName as opencodePresetSidekickName,
} from "@honk/opencode/host";
export type { HonkPresetStop as OpencodePresetStop } from "@honk/opencode/host";

export interface HonkOpencodeConfigLocation {
  /** Honk-owned config dir, never the user's. */
  readonly configDir: string;
  readonly configPath: string;
  readonly pluginDir: string;
  readonly pluginPath: string;
}

export const resolveHonkOpencodeConfigLocation = Effect.fn(
  "desktop.opencodeConfig.resolveLocation",
)(function* (input: {
  readonly stateDir: string;
}): Effect.fn.Return<HonkOpencodeConfigLocation, never, Path.Path> {
  const path = yield* Path.Path;
  const configDir = path.join(input.stateDir, "opencode");
  const pluginDir = path.join(configDir, HONK_OPENCODE_PLUGIN_DIRECTORY);
  return {
    configDir,
    configPath: path.join(configDir, "opencode.json"),
    pluginDir,
    pluginPath: path.join(pluginDir, HONK_OPENCODE_PLUGIN_ENTRY_FILE),
  };
});

/**
 * Write the Honk OpenCode overlay for Electron. Plugin sources are inlined
 * strings because packaged builds have no workspace tree for OpenCode to import.
 */
export const writeHonkOpencodeConfig = Effect.fn("desktop.opencodeConfig.write")(function* (input: {
  readonly stateDir: string;
}): Effect.fn.Return<
  HonkOpencodeConfigLocation,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const location = yield* resolveHonkOpencodeConfigLocation({ stateDir: input.stateDir });
  const config = buildHonkOpencodeConfig(location.pluginPath);
  yield* fileSystem.makeDirectory(location.pluginDir, { recursive: true });
  yield* Effect.all(
    HONK_OPENCODE_PLUGIN_MODULES.map(({ fileName, source }) =>
      fileSystem.writeFileString(path.join(location.pluginDir, fileName), source),
    ),
    { concurrency: "unbounded", discard: true },
  );
  yield* fileSystem.writeFileString(location.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return location;
});
