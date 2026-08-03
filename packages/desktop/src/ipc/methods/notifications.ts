import { DesktopThreadNotificationInputSchema } from "@honk/shared/desktop-api";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopWindow from "../../window/desktop-window";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

export const showThreadNotification = makeIpcMethod({
  channel: IpcChannels.SHOW_THREAD_NOTIFICATION_CHANNEL,
  payload: DesktopThreadNotificationInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.notifications.showThreadNotification")(function* (input) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.showThreadNotification(input);
  }),
});
