import {
  DesktopRemoteHostStateSchema,
  DesktopRemotePairingLinkSchema,
} from "@honk/shared/desktop-api";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

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

export const issueRemotePairing = makeIpcMethod({
  channel: IpcChannels.ISSUE_REMOTE_PAIRING_CHANNEL,
  payload: Schema.NullOr(Schema.String),
  result: DesktopRemotePairingLinkSchema,
  handler: Effect.fn("desktop.ipc.remoteHost.issuePairing")(function* (label) {
    const remoteHost = yield* DesktopRemoteHost.DesktopRemoteHost;
    return yield* remoteHost.issuePairing(label);
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
