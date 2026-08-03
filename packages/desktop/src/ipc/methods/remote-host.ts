import {
  DesktopRemoteHostStateSchema,
  DesktopRemotePairingLinkSchema,
  DesktopRemotePairingStateSchema,
} from "@honk/shared/desktop-api";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopLifecycle from "../../app/desktop-lifecycle";
import * as DesktopRemoteHost from "../../backend/desktop-remote-host";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

export const getRemoteHostState = makeIpcMethod({
  channel: IpcChannels.GET_REMOTE_HOST_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopRemoteHostStateSchema,
  handler: Effect.fn("desktop.ipc.remoteHost.getState")(function* () {
    const remoteHost = yield* DesktopRemoteHost.DesktopRemoteHost;
    return yield* remoteHost.getState;
  }),
});

export const restartRemoteHost = makeIpcMethod({
  channel: IpcChannels.RESTART_REMOTE_HOST_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.remoteHost.restart")(function* () {
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    yield* lifecycle.relaunch("remoteHostRetry");
  }),
});

export const issueRemotePairing = makeIpcMethod({
  channel: IpcChannels.ISSUE_REMOTE_PAIRING_CHANNEL,
  payload: Schema.Void,
  result: DesktopRemotePairingLinkSchema,
  handler: Effect.fn("desktop.ipc.remoteHost.issuePairing")(function* () {
    const remoteHost = yield* DesktopRemoteHost.DesktopRemoteHost;
    return yield* remoteHost.issuePairing;
  }),
});

export const getRemotePairingState = makeIpcMethod({
  channel: IpcChannels.GET_REMOTE_PAIRING_STATE_CHANNEL,
  payload: Schema.String,
  result: DesktopRemotePairingStateSchema,
  handler: Effect.fn("desktop.ipc.remoteHost.getPairingState")(function* (pairingID) {
    const remoteHost = yield* DesktopRemoteHost.DesktopRemoteHost;
    return yield* remoteHost.getPairingState(pairingID);
  }),
});

export const cancelRemotePairing = makeIpcMethod({
  channel: IpcChannels.CANCEL_REMOTE_PAIRING_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.remoteHost.cancelPairing")(function* (pairingID) {
    const remoteHost = yield* DesktopRemoteHost.DesktopRemoteHost;
    return yield* remoteHost.cancelPairing(pairingID);
  }),
});

export const setRemoteHostName = makeIpcMethod({
  channel: IpcChannels.SET_REMOTE_HOST_NAME_CHANNEL,
  payload: Schema.String,
  result: DesktopRemoteHostStateSchema,
  handler: Effect.fn("desktop.ipc.remoteHost.setName")(function* (name) {
    const remoteHost = yield* DesktopRemoteHost.DesktopRemoteHost;
    return yield* remoteHost.setName(name);
  }),
});

const RenameRemoteDeviceInput = Schema.Struct({
  deviceID: Schema.String,
  label: Schema.String,
});

export const renameRemoteDevice = makeIpcMethod({
  channel: IpcChannels.RENAME_REMOTE_DEVICE_CHANNEL,
  payload: RenameRemoteDeviceInput,
  result: DesktopRemoteHostStateSchema,
  handler: Effect.fn("desktop.ipc.remoteHost.renameDevice")(function* (input) {
    const remoteHost = yield* DesktopRemoteHost.DesktopRemoteHost;
    return yield* remoteHost.renameDevice(input.deviceID, input.label);
  }),
});

export const revokeRemoteDevice = makeIpcMethod({
  channel: IpcChannels.REVOKE_REMOTE_DEVICE_CHANNEL,
  payload: Schema.String,
  result: DesktopRemoteHostStateSchema,
  handler: Effect.fn("desktop.ipc.remoteHost.revokeDevice")(function* (deviceID) {
    const remoteHost = yield* DesktopRemoteHost.DesktopRemoteHost;
    return yield* remoteHost.revokeDevice(deviceID);
  }),
});
