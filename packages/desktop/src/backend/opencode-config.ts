import {
  buildHonkOpencodeConfig,
  HONK_CLAUDE_FAST_WRAPPER_FILE,
  HONK_CLAUDE_FAST_WRAPPER_WINDOWS_FILE,
  HONK_OPENCODE_MCP_SERVER_FILE,
  HONK_OPENCODE_PLUGIN_DIRECTORY,
  HONK_OPENCODE_PLUGIN_ENTRY_FILE,
  HONK_OPENCODE_PLUGIN_MODULES,
  type HonkMcpServerConfig,
} from "@honk/opencode/host";
import type { DesktopMcpServerInput } from "@honk/shared/desktop-api";
import { fromLenientJson } from "@honk/shared/schema-json";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
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

const McpServerSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("local"),
    command: Schema.Array(Schema.String),
    cwd: Schema.optionalKey(Schema.String),
    environment: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    enabled: Schema.optionalKey(Schema.Boolean),
    timeout: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({
    type: Schema.Literal("remote"),
    url: Schema.String,
    headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    oauth: Schema.optionalKey(
      Schema.Union([
        Schema.Literal(false),
        Schema.Struct({
          clientId: Schema.optionalKey(Schema.String),
          clientSecret: Schema.optionalKey(Schema.String),
          scope: Schema.optionalKey(Schema.String),
          callbackPort: Schema.optionalKey(Schema.Number),
          redirectUri: Schema.optionalKey(Schema.String),
        }),
      ]),
    ),
    enabled: Schema.optionalKey(Schema.Boolean),
    timeout: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({
    enabled: Schema.Boolean,
  }),
]);
const McpDocumentJson = fromLenientJson(
  Schema.Struct({
    mcp: Schema.optionalKey(Schema.Record(Schema.String, McpServerSchema)),
  }),
);
const ConfigDocumentJson = fromLenientJson(Schema.Record(Schema.String, Schema.Unknown));
const decodeMcpDocument = Schema.decodeEffect(McpDocumentJson);
const decodeConfigDocument = Schema.decodeEffect(ConfigDocumentJson);

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

const readPersistedMcpServers = (
  fileSystem: FileSystem.FileSystem,
  configPath: string,
): Effect.Effect<Readonly<Record<string, HonkMcpServerConfig>>> =>
  fileSystem.readFileString(configPath).pipe(
    Effect.flatMap(decodeMcpDocument),
    Effect.map((document) => document.mcp ?? {}),
    Effect.catch(() => Effect.succeed({})),
  );

/**
 * Write the Honk OpenCode overlay for Electron. Plugin sources are inlined
 * strings because packaged builds have no workspace tree for OpenCode to import.
 */
export const writeHonkOpencodeConfig = Effect.fn("desktop.opencodeConfig.write")(function* (input: {
  readonly stateDir: string;
  /** The sidecar binary doubles as the runtime for Honk's stdio MCP server. */
  readonly opencodeBinaryPath: string;
}): Effect.fn.Return<
  HonkOpencodeConfigLocation,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const location = yield* resolveHonkOpencodeConfigLocation({ stateDir: input.stateDir });
  const claudeFastWrapperPath = path.join(
    location.pluginDir,
    process.platform === "win32"
      ? HONK_CLAUDE_FAST_WRAPPER_WINDOWS_FILE
      : HONK_CLAUDE_FAST_WRAPPER_FILE,
  );
  const config = buildHonkOpencodeConfig(location.pluginPath, {
    claudeCliPath: claudeFastWrapperPath,
    mcp: yield* readPersistedMcpServers(fileSystem, location.configPath),
    mcpServerCommand: [
      input.opencodeBinaryPath,
      path.join(location.pluginDir, HONK_OPENCODE_MCP_SERVER_FILE),
    ],
  });
  yield* fileSystem.makeDirectory(location.pluginDir, { recursive: true });
  yield* Effect.all(
    HONK_OPENCODE_PLUGIN_MODULES.map(({ fileName, source }) =>
      fileSystem.writeFileString(path.join(location.pluginDir, fileName), source),
    ),
    { concurrency: "unbounded", discard: true },
  );
  if (process.platform !== "win32") {
    yield* fileSystem.chmod(claudeFastWrapperPath, 0o755);
  }
  yield* fileSystem.writeFileString(location.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return location;
});

export const persistHonkMcpServer = Effect.fn("desktop.opencodeConfig.persistMcpServer")(
  function* (input: {
    readonly stateDir: string;
    readonly server: DesktopMcpServerInput;
  }): Effect.fn.Return<
    void,
    Error | PlatformError.PlatformError | Schema.SchemaError,
    FileSystem.FileSystem | Path.Path
  > {
    const name = input.server.name.trim();
    if (name.length === 0) {
      return yield* Effect.fail(new Error("MCP server name is required."));
    }
    if (name === "honk") {
      return yield* Effect.fail(new Error('The MCP server name "honk" is reserved.'));
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const location = yield* resolveHonkOpencodeConfigLocation({ stateDir: input.stateDir });
    const raw = yield* fileSystem.readFileString(location.configPath);
    const document = yield* decodeConfigDocument(raw);
    const current = yield* decodeMcpDocument(raw);
    const tempPath = `${location.configPath}.${process.pid}.${crypto.randomUUID().replace(/-/g, "")}.tmp`;
    yield* fileSystem.writeFileString(
      tempPath,
      `${JSON.stringify(
        {
          ...document,
          mcp: {
            ...current.mcp,
            [name]: input.server.config,
          },
        },
        null,
        2,
      )}\n`,
    );
    yield* fileSystem.rename(tempPath, location.configPath);
  },
);
