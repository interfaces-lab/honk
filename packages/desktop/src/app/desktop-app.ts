import { createServer } from "node:net";

import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as ElectronApp from "../electron/electron-app";
import * as ElectronDialog from "../electron/electron-dialog";
import * as ElectronProtocol from "../electron/electron-protocol";
import * as ElectronTheme from "../electron/electron-theme";
import { installDesktopIpcHandlers } from "../ipc/desktop-ipc-handlers";
import * as DesktopAppIdentity from "./desktop-app-identity";
import * as DesktopApplicationMenu from "../window/desktop-application-menu";
import * as DesktopBackendManager from "../backend/desktop-backend-manager";
import * as DesktopEnvironment from "./desktop-environment";
import * as DesktopLifecycle from "./desktop-lifecycle";
import * as DesktopObservability from "./desktop-observability";
import * as DesktopServerExposure from "../backend/desktop-server-exposure";
import * as DesktopAppSettings from "../settings/desktop-app-settings";
import * as DesktopShellEnvironment from "../shell/desktop-shell-environment";
import * as DesktopState from "./desktop-state";
import * as DesktopUpdates from "../updates/desktop-updates";

const DESKTOP_BACKEND_SHUTDOWN_TIMEOUT = Duration.seconds(5);

class DesktopBackendPortUnavailableError extends Data.TaggedError(
  "DesktopBackendPortUnavailableError",
)<{
  readonly preferredPort?: number;
  readonly cause: unknown;
}> {
  override get message() {
    const target =
      this.preferredPort === undefined
        ? "an ephemeral loopback port"
        : `preferred loopback port ${this.preferredPort}`;
    return `No desktop backend port is available for ${target}.`;
  }
}

class DesktopDevelopmentBackendPortRequiredError extends Data.TaggedError(
  "DesktopDevelopmentBackendPortRequiredError",
)<{}> {
  override get message() {
    return "MULTI_PORT is required in desktop development.";
  }
}

const { logInfo: logBootstrapInfo, logWarning: logBootstrapWarning } =
  DesktopObservability.makeComponentLogger("desktop-bootstrap");

const { logInfo: logStartupInfo, logError: logStartupError } =
  DesktopObservability.makeComponentLogger("desktop-startup");

function reserveLoopbackPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const selectedPort = typeof address === "object" && address ? address.port : port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(selectedPort);
      });
    });
  });
}

const reserveBackendPort = (port: number) =>
  Effect.tryPromise({
    try: () => reserveLoopbackPort(port),
    catch: (cause) =>
      new DesktopBackendPortUnavailableError({
        ...(port > 0 ? { preferredPort: port } : {}),
        cause,
      }),
  });

const resolveDesktopBackendPort = Effect.fn("resolveDesktopBackendPort")(function* (input: {
  readonly configuredPort: Option.Option<number>;
  readonly lastBackendPort: number | undefined;
}) {
  const { configuredPort, lastBackendPort } = input;
  if (Option.isSome(configuredPort)) {
    return {
      port: configuredPort.value,
      source: "configured",
    } as const;
  }

  if (lastBackendPort !== undefined) {
    const port = yield* reserveBackendPort(lastBackendPort).pipe(Effect.option);
    if (Option.isSome(port)) {
      return {
        port: port.value,
        source: "last",
      } as const;
    }
  }

  return {
    port: yield* reserveBackendPort(0),
    source: "ephemeral",
  } as const;
});

const handleFatalStartupError = Effect.fn("desktop.startup.handleFatalStartupError")(function* (
  stage: string,
  error: unknown,
): Effect.fn.Return<
  void,
  never,
  | DesktopLifecycle.DesktopShutdown
  | DesktopState.DesktopState
  | ElectronApp.ElectronApp
  | ElectronDialog.ElectronDialog
> {
  const shutdown = yield* DesktopLifecycle.DesktopShutdown;
  const state = yield* DesktopState.DesktopState;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const message = error instanceof Error ? error.message : String(error);
  const detail =
    error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
  yield* logStartupError("fatal startup error", {
    stage,
    message,
    ...(detail.length > 0 ? { detail } : {}),
  });
  const wasQuitting = yield* Ref.getAndSet(state.quitting, true);
  if (!wasQuitting) {
    yield* electronDialog.showErrorBox(
      "Multi failed to start",
      `Stage: ${stage}\n${message}${detail}`,
    );
  }
  yield* shutdown.request;
  yield* electronApp.quit;
});

const fatalStartupCause = <E>(stage: string, cause: Cause.Cause<E>) =>
  handleFatalStartupError(stage, Cause.pretty(cause)).pipe(Effect.andThen(Effect.failCause(cause)));

const bootstrap = Effect.gen(function* () {
  const backendManager = yield* DesktopBackendManager.DesktopBackendManager;
  const state = yield* DesktopState.DesktopState;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
  yield* logBootstrapInfo("bootstrap start");

  if (environment.isDevelopment && Option.isNone(environment.configuredBackendPort)) {
    return yield* new DesktopDevelopmentBackendPortRequiredError();
  }

  const settings = yield* desktopSettings.get;
  const backendPortSelection = yield* resolveDesktopBackendPort({
    configuredPort: environment.configuredBackendPort,
    lastBackendPort: settings.lastBackendPort,
  });
  const backendPort = backendPortSelection.port;
  yield* logBootstrapInfo("selected backend port", {
    port: backendPort,
    source: backendPortSelection.source,
  });
  if (backendPortSelection.source !== "configured" && settings.lastBackendPort !== backendPort) {
    yield* desktopSettings.setLastBackendPort(backendPort).pipe(
      Effect.catch((error) =>
        logBootstrapWarning("failed to persist selected backend port", {
          error: error.message,
        }),
      ),
    );
  }

  if (settings.serverExposureMode !== environment.defaultDesktopSettings.serverExposureMode) {
    yield* logBootstrapInfo("bootstrap restoring persisted server exposure mode", {
      mode: settings.serverExposureMode,
    });
  }
  const serverExposureState = yield* serverExposure.configureFromSettings({ port: backendPort });
  const backendConfig = yield* serverExposure.backendConfig;
  yield* logBootstrapInfo("bootstrap resolved backend endpoint", {
    baseUrl: backendConfig.httpBaseUrl.href,
  });
  if (serverExposureState.endpointUrl) {
    yield* logBootstrapInfo("bootstrap enabled network access", {
      endpointUrl: serverExposureState.endpointUrl,
    });
  } else if (settings.serverExposureMode === "network-accessible") {
    yield* logBootstrapWarning(
      "bootstrap fell back to local-only because no advertised network host was available",
    );
  }

  yield* installDesktopIpcHandlers;
  yield* logBootstrapInfo("bootstrap ipc handlers registered");

  if (!(yield* Ref.get(state.quitting))) {
    yield* backendManager.start;
    yield* logBootstrapInfo("bootstrap backend start requested");
  }
  return yield* Effect.void;
}).pipe(Effect.withSpan("desktop.bootstrap"));

const startup = Effect.gen(function* () {
  const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
  const applicationMenu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
  const shellEnvironment = yield* DesktopShellEnvironment.DesktopShellEnvironment;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;

  yield* shellEnvironment.installIntoProcess;
  const userDataPath = yield* appIdentity.resolveUserDataPath;
  const fileSystem = yield* FileSystem.FileSystem;
  yield* fileSystem.makeDirectory(userDataPath, { recursive: true });
  yield* electronApp.appendCommandLineSwitch("user-data-dir", userDataPath);
  yield* electronApp.setPath("userData", userDataPath);
  yield* electronApp.setPath("sessionData", userDataPath);
  yield* logStartupInfo("runtime logging configured", { logDir: environment.logDir });
  const settings = yield* desktopSettings.load;
  yield* electronTheme.setSource(settings.themeSource);

  if (environment.platform === "linux") {
    yield* electronApp.appendCommandLineSwitch("class", environment.linuxWmClass);
  }

  yield* appIdentity.configure;
  yield* lifecycle.register;

  yield* electronApp.whenReady.pipe(
    Effect.withSpan("desktop.electron.whenReady"),
    Effect.catchCause((cause) => fatalStartupCause("whenReady", cause)),
  );
  yield* logStartupInfo("app ready");
  yield* appIdentity.configure;
  yield* electronProtocol.registerDesktopFileProtocol;
  yield* bootstrap.pipe(Effect.catchCause((cause) => fatalStartupCause("bootstrap", cause)));
  yield* applicationMenu.configure;
  yield* updates.configure;
}).pipe(Effect.withSpan("desktop.startup"));

const scopedProgram = Effect.scoped(
  Effect.gen(function* () {
    const { runId, processInstanceId, processRole } = DesktopObservability.desktopProcessMetadata;
    yield* Effect.annotateLogsScoped({ scope: "desktop", runId, processInstanceId, processRole });
    yield* Effect.annotateCurrentSpan({ scope: "desktop", runId, processInstanceId, processRole });

    const shutdown = yield* DesktopLifecycle.DesktopShutdown;
    const backendManager = yield* DesktopBackendManager.DesktopBackendManager;

    yield* Effect.addFinalizer(() =>
      backendManager
        .stop({ timeout: DESKTOP_BACKEND_SHUTDOWN_TIMEOUT })
        .pipe(Effect.ensuring(shutdown.markComplete)),
    );

    yield* startup;
    yield* shutdown.awaitRequest;
  }),
);

export const program = scopedProgram.pipe(Effect.withSpan("desktop.app"));
