import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Option from "effect/Option";

const trimNonEmptyOption = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

const trimmedString = (name: string) =>
  Config.string(name).pipe(Config.option, Config.map(Option.flatMap(trimNonEmptyOption)));

const optionalBoolean = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    Config.map((value) =>
      Option.match(value, {
        onNone: () => false,
        onSome: (raw) => {
          const normalized = raw.trim().toLowerCase();
          return normalized === "1" || normalized === "true" || normalized === "yes";
        },
      }),
    ),
  );

const compactEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

export const DesktopConfig = Config.all({
  appDataDirectory: trimmedString("APPDATA"),
  xdgConfigHome: trimmedString("XDG_CONFIG_HOME"),
  multiHome: trimmedString("MULTI_HOME"),
  devServerUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option),
  configuredBackendPort: Config.port("MULTI_PORT").pipe(Config.option),
  commitHashOverride: trimmedString("MULTI_COMMIT_HASH"),
  desktopLanHostOverride: trimmedString("MULTI_DESKTOP_LAN_HOST"),
  otlpTracesUrl: trimmedString("MULTI_OTLP_TRACES_URL"),
  otlpExportIntervalMs: Config.int("MULTI_OTLP_EXPORT_INTERVAL_MS").pipe(
    Config.withDefault(10_000),
  ),
  appImagePath: trimmedString("APPIMAGE"),
  disableAutoUpdate: optionalBoolean("MULTI_DISABLE_AUTO_UPDATE"),
  mockUpdates: optionalBoolean("MULTI_DESKTOP_MOCK_UPDATES"),
  mockUpdateServerPort: Config.port("MULTI_DESKTOP_MOCK_UPDATE_SERVER_PORT").pipe(
    Config.withDefault(3000),
  ),
});

export const layerTest = (env: Readonly<Record<string, string | undefined>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: compactEnv(env) }));
