import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopWindow from "../../window/desktop-window";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

export const completeOnboarding = makeIpcMethod({
  channel: IpcChannels.COMPLETE_ONBOARDING_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.onboarding.complete")(function* () {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.completeOnboarding;
  }),
});

export const finishOnboarding = makeIpcMethod({
  channel: IpcChannels.FINISH_ONBOARDING_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.onboarding.finish")(function* () {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.finishOnboarding;
  }),
});

export const dismissOnboarding = makeIpcMethod({
  channel: IpcChannels.DISMISS_ONBOARDING_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.onboarding.dismiss")(function* () {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.dismissOnboarding;
  }),
});

export const replayOnboarding = makeIpcMethod({
  channel: IpcChannels.REPLAY_ONBOARDING_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.onboarding.replay")(function* () {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.replayOnboarding;
  }),
});
