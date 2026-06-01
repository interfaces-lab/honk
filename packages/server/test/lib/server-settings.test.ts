import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch } from "@multi/contracts";
import { createModelSelection } from "@multi/shared/model";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ServerConfig } from "../../src/config.ts";
import { ServerSettingsLive, ServerSettingsService } from "../../src/server-settings.ts";

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "multi-server-settings-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("decodes nested settings patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(decodePatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }), {
        providers: { codex: { binaryPath: "/tmp/codex" } },
      });

      assert.deepEqual(
        decodePatch({
          textGenerationModelSelection: {
            options: [{ id: "fastMode", value: false }],
          },
        }),
        {
          textGenerationModelSelection: {
            options: [{ id: "fastMode", value: false }],
          },
        },
      );
    }),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/julius/.codex",
          },
          cursor: {
            binaryPath: "/usr/local/bin/agent",
            customModels: ["cursor-custom"],
          },
        },
        textGenerationModelSelection: {
          instanceId: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: createModelSelection(
            "codex",
            DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
            [
              { id: "reasoningEffort", value: "high" },
              { id: "fastMode", value: true },
            ],
          ).options!,
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        textGenerationModelSelection: {
          options: [{ id: "fastMode", value: false }],
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/julius/.codex",
        shadowHomePath: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.cursor, {
        enabled: true,
        binaryPath: "/usr/local/bin/agent",
        apiEndpoint: "",
        customModels: ["cursor-custom"],
      });
      assert.deepEqual(
        next.textGenerationModelSelection,
        createModelSelection("codex", DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model, [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: false },
        ]),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via textGenerationModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      // Start with Cursor text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: "cursor",
          model: "composer-1",
          options: createModelSelection("cursor", "composer-1", [
            { id: "fastMode", value: false },
          ]).options!,
        },
      });

      // Switch to Codex — stale Cursor options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: "codex",
          model: "gpt-5.4",
          options: createModelSelection("codex", "gpt-5.4", [
            { id: "reasoningEffort", value: "high" },
          ]).options!,
        },
      });

      assert.deepEqual(
        next.textGenerationModelSelection,
        createModelSelection("codex", "gpt-5.4", [{ id: "reasoningEffort", value: "high" }]),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("drops stale text generation options when resetting model selection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: createModelSelection(
            "codex",
            DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
            [
              { id: "reasoningEffort", value: "high" },
              { id: "fastMode", value: true },
            ],
          ).options!,
        },
      });

      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          cursor: {
            binaryPath: "  /opt/homebrew/bin/agent  ",
            apiEndpoint: "  https://cursor.example.test  ",
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        shadowHomePath: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.cursor, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/agent",
        apiEndpoint: "https://cursor.example.test",
        customModels: [],
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims observability settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "  ~/Development  ",
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.equal(next.addProjectBaseDirectory, "~/Development");
      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          cursor: {
            binaryPath: "",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.cursor.binaryPath, "agent");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes only non-default server settings to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
          cursor: {
            apiEndpoint: "https://cursor.example.test",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
          cursor: {
            apiEndpoint: "https://cursor.example.test",
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("prunes removed provider instances without dropping valid settings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const removedProviderId = `${"open"}code`;

      yield* fileSystem.makeDirectory(path.dirname(serverConfig.settingsPath), {
        recursive: true,
      });
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        `${JSON.stringify(
          {
            addProjectBaseDirectory: "~/Development",
            providerInstances: {
              codex_personal: {
                driver: "codex",
                displayName: "Personal Codex",
              },
              [removedProviderId]: {
                driver: removedProviderId,
                displayName: "Removed Provider",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const next = yield* serverSettings.getSettings;

      assert.equal(next.addProjectBaseDirectory, "~/Development");
      assert.deepEqual(next.providerInstances, {
        codex_personal: {
          driver: "codex",
          displayName: "Personal Codex",
        },
      });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        addProjectBaseDirectory: "~/Development",
        providerInstances: {
          codex_personal: {
            driver: "codex",
            displayName: "Personal Codex",
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
