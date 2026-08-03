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
