import {
  DesktopServerExposureModeSchema,
  DesktopServerExposureStateSchema,
} from "@honk/shared/desktop-api";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopLifecycle from "../../app/desktop-lifecycle";
import * as DesktopServerExposure from "../../backend/desktop-server-exposure";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

export const getServerExposureState = makeIpcMethod({
  channel: IpcChannels.GET_SERVER_EXPOSURE_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopServerExposureStateSchema,
  handler: Effect.fn("desktop.ipc.serverExposure.getState")(function* () {
    const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
    return yield* serverExposure.getState;
  }),
});

export const setServerExposureMode = makeIpcMethod({
  channel: IpcChannels.SET_SERVER_EXPOSURE_MODE_CHANNEL,
  payload: DesktopServerExposureModeSchema,
  result: DesktopServerExposureStateSchema,
  handler: Effect.fn("desktop.ipc.serverExposure.setMode")(function* (mode) {
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    const serverExposure = yield* DesktopServerExposure.DesktopServerExposure;
    const change = yield* serverExposure.setMode(mode);
    if (change.requiresRelaunch) {
      yield* lifecycle.relaunch(`serverExposureMode=${mode}`);
    }
    return change.state;
  }),
});
