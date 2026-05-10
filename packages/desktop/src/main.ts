import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

import { NetService } from "@multi/shared/Net";

import * as DesktopIpc from "./ipc/DesktopIpc";
import * as ElectronApp from "./electron/ElectronApp";
import * as ElectronDialog from "./electron/ElectronDialog";
import * as ElectronMenu from "./electron/ElectronMenu";
import * as ElectronProtocol from "./electron/ElectronProtocol";
import * as DesktopSecretStorage from "./electron/ElectronSafeStorage";
import * as ElectronShell from "./electron/ElectronShell";
import * as ElectronTheme from "./electron/ElectronTheme";
import * as ElectronUpdater from "./electron/ElectronUpdater";
import * as ElectronWindow from "./electron/ElectronWindow";
import * as DesktopApp from "./app/DesktopApp";
import * as DesktopAppIdentity from "./app/DesktopAppIdentity";
import * as DesktopApplicationMenu from "./window/DesktopApplicationMenu";
import * as DesktopAssets from "./app/DesktopAssets";
import * as DesktopBackendConfiguration from "./backend/DesktopBackendConfiguration";
import * as DesktopBackendManager from "./backend/DesktopBackendManager";
import * as DesktopEnvironment from "./app/DesktopEnvironment";
import * as DesktopLifecycle from "./app/DesktopLifecycle";
import * as DesktopObservability from "./app/DesktopObservability";
import * as DesktopServerExposure from "./backend/DesktopServerExposure";
import * as DesktopClientSettings from "./settings/DesktopClientSettings";
import * as DesktopSavedEnvironments from "./settings/DesktopSavedEnvironments";
import * as DesktopAppSettings from "./settings/DesktopAppSettings";
import * as DesktopShellEnvironment from "./shell/DesktopShellEnvironment";
import * as DesktopState from "./app/DesktopState";
import * as DesktopUpdates from "./updates/DesktopUpdates";
import * as DesktopWindow from "./window/DesktopWindow";

const desktopEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const metadata = yield* Effect.service(ElectronApp.ElectronApp).pipe(
      Effect.flatMap((app) => app.metadata),
    );
    return DesktopEnvironment.layer({
      dirname: __dirname,
      homeDirectory: NodeOS.homedir(),
      platform: process.platform,
      processArch: process.arch,
      ...metadata,
    });
  }),
);

const electronLayer = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronMenu.layer,
  ElectronProtocol.layer,
  DesktopSecretStorage.layer,
  ElectronShell.layer,
  ElectronTheme.layer,
  ElectronUpdater.layer,
  ElectronWindow.layer,
  Layer.succeed(DesktopIpc.DesktopIpc, DesktopIpc.make(Electron.ipcMain)),
);

const desktopFoundationLayer = Layer.mergeAll(
  DesktopState.layer,
  DesktopLifecycle.layerShutdown,
  DesktopAppSettings.layer,
  DesktopClientSettings.layer,
  DesktopSavedEnvironments.layer,
  DesktopAssets.layer,
  DesktopObservability.layer,
).pipe(Layer.provideMerge(desktopEnvironmentLayer));

const desktopServerExposureLayer = DesktopServerExposure.layer.pipe(
  Layer.provideMerge(DesktopServerExposure.networkInterfacesLayer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopWindowLayer = DesktopWindow.layer.pipe(Layer.provideMerge(desktopServerExposureLayer));

const desktopBackendLayer = DesktopBackendManager.layer.pipe(
  Layer.provideMerge(DesktopAppIdentity.layer),
  Layer.provideMerge(DesktopBackendConfiguration.layer),
  Layer.provideMerge(desktopWindowLayer),
);

const desktopApplicationLayer = Layer.mergeAll(
  DesktopLifecycle.layer,
  DesktopApplicationMenu.layer,
  DesktopShellEnvironment.layer,
).pipe(Layer.provideMerge(DesktopUpdates.layer), Layer.provideMerge(desktopBackendLayer));

const desktopRuntimeLayer = ElectronProtocol.layerSchemePrivileges.pipe(
  Layer.flatMap(() =>
    desktopApplicationLayer.pipe(
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(NodeHttpClient.layerUndici),
      Layer.provideMerge(NetService.layer),
      Layer.provideMerge(electronLayer),
    ),
  ),
);

DesktopApp.program.pipe(Effect.provide(desktopRuntimeLayer), NodeRuntime.runMain);
