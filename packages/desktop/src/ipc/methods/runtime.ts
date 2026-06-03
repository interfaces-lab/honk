import {
  AgentCredentialConfigureInput,
  AgentPreferences,
  AgentPreferencesPatch,
  DesktopExtensionUiRespondInput,
  MultiRuntimeHostEvent,
  MultiRuntimeHostSnapshot,
  ThreadAgentRuntimeAbortInput,
  ThreadAgentRuntimeSendTurnInput,
  TurnId,
} from "@multi/contracts";
import type { DesktopRuntimeHost } from "@multi/runtime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAppIdentity from "../../app/desktop-app-identity";
import * as DesktopEnvironment from "../../app/desktop-environment";
import * as ElectronShell from "../../electron/electron-shell";
import * as ElectronWindow from "../../electron/electron-window";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

let runtimeHost: DesktopRuntimeHost | null = null;
const encodeHostEvent = Schema.encodeUnknownSync(MultiRuntimeHostEvent);

const getRuntimeHost = Effect.gen(function* () {
  if (runtimeHost) {
    return runtimeHost;
  }

  const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const userDataPath = yield* appIdentity.resolveUserDataPath;
  const Runtime = yield* Effect.promise(() => import("@multi/runtime"));
  runtimeHost = new Runtime.DesktopRuntimeHost({
    agentDir: environment.path.join(userDataPath, "pi-agent"),
  });
  return runtimeHost;
});

export const installRuntimeHostEventBridge = Effect.acquireRelease(
  Effect.gen(function* () {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const host = yield* getRuntimeHost;
    return host.onHostEvent((event) => {
      Effect.runSync(
        electronWindow.sendAll(IpcChannels.RUNTIME_HOST_EVENT_CHANNEL, encodeHostEvent(event)),
      );
    });
  }),
  (unsubscribe) => Effect.sync(unsubscribe),
);

export const getRuntimeHostSnapshot = makeIpcMethod({
  channel: IpcChannels.RUNTIME_GET_HOST_SNAPSHOT_CHANNEL,
  payload: Schema.Void,
  result: MultiRuntimeHostSnapshot,
  handler: () => Effect.flatMap(getRuntimeHost, (host) => Effect.promise(() => host.getHostSnapshot())),
});

export const getRuntimePreferences = makeIpcMethod({
  channel: IpcChannels.RUNTIME_GET_PREFERENCES_CHANNEL,
  payload: Schema.Void,
  result: AgentPreferences,
  handler: () => Effect.flatMap(getRuntimeHost, (host) => Effect.promise(() => host.getPreferences())),
});

export const updateRuntimePreferences = makeIpcMethod({
  channel: IpcChannels.RUNTIME_UPDATE_PREFERENCES_CHANNEL,
  payload: AgentPreferencesPatch,
  result: AgentPreferences,
  handler: (patch) =>
    Effect.flatMap(getRuntimeHost, (host) => Effect.promise(() => host.updatePreferences(patch))),
});

function createRuntimeCredentialLoginCallbacks(
  shell: ElectronShell.ElectronShellShape,
): Parameters<DesktopRuntimeHost["configureCredential"]>[1] {
  return {
    onAuth: (info) => {
      void Effect.runPromise(shell.openExternal(info.url));
    },
    onDeviceCode: (info) => {
      void Effect.runPromise(shell.copyText(info.userCode));
      void Effect.runPromise(shell.openExternal(info.verificationUri));
    },
    onPrompt: async () => {
      throw new Error("This OAuth login prompt is not available in the desktop settings window.");
    },
    onProgress: () => undefined,
    onManualCodeInput: async () => {
      throw new Error("Manual OAuth code entry is not available in the desktop settings window.");
    },
    onSelect: async (prompt) =>
      prompt.options.find((option) => option.id === "device_code")?.id ??
      prompt.options[0]?.id,
  };
}

export const configureRuntimeCredential = makeIpcMethod({
  channel: IpcChannels.RUNTIME_CONFIGURE_CREDENTIAL_CHANNEL,
  payload: AgentCredentialConfigureInput,
  result: MultiRuntimeHostSnapshot,
  handler: (input) =>
    Effect.gen(function* () {
      const host = yield* getRuntimeHost;
      const shell = yield* ElectronShell.ElectronShell;
      const callbacks = createRuntimeCredentialLoginCallbacks(shell);
      return yield* Effect.promise(() => host.configureCredential(input, callbacks));
    }),
});

export const sendRuntimeTurn = makeIpcMethod({
  channel: IpcChannels.RUNTIME_SEND_TURN_CHANNEL,
  payload: ThreadAgentRuntimeSendTurnInput,
  result: TurnId,
  handler: (input) =>
    Effect.flatMap(getRuntimeHost, (host) => Effect.promise(() => host.sendTurn(input))),
});

export const abortRuntimeThread = makeIpcMethod({
  channel: IpcChannels.RUNTIME_ABORT_CHANNEL,
  payload: ThreadAgentRuntimeAbortInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.flatMap(getRuntimeHost, (host) => Effect.promise(() => host.abort(input))),
});

export const respondToRuntimeExtensionUiRequest = makeIpcMethod({
  channel: IpcChannels.RUNTIME_RESPOND_EXTENSION_UI_CHANNEL,
  payload: DesktopExtensionUiRespondInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.flatMap(getRuntimeHost, (host) =>
      Effect.promise(() => host.respondToExtensionUiRequest(input)),
    ),
});
