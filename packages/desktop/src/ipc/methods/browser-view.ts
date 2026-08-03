import {
  DesktopBrowserViewCommandInput,
  DesktopBrowserViewDetachInput,
  DesktopBrowserViewDestroyInput,
  DesktopBrowserViewState,
  DesktopBrowserViewSyncInput,
} from "@honk/shared/desktop-api";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopBrowserViews from "../../browser/browser-views";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

export const syncBrowserView = makeIpcMethod({
  channel: IpcChannels.SYNC_BROWSER_VIEW_CHANNEL,
  payload: DesktopBrowserViewSyncInput,
  result: DesktopBrowserViewState,
  trace: false,
  handler: Effect.fnUntraced(function* (input) {
    const browserViews = yield* DesktopBrowserViews.DesktopBrowserViews;
    return yield* browserViews.sync(input);
  }),
});

export const detachBrowserView = makeIpcMethod({
  channel: IpcChannels.DETACH_BROWSER_VIEW_CHANNEL,
  payload: DesktopBrowserViewDetachInput,
  result: Schema.Void,
  trace: false,
  handler: Effect.fnUntraced(function* (input) {
    const browserViews = yield* DesktopBrowserViews.DesktopBrowserViews;
    yield* browserViews.detach(input);
  }),
});

export const commandBrowserView = makeIpcMethod({
  channel: IpcChannels.COMMAND_BROWSER_VIEW_CHANNEL,
  payload: DesktopBrowserViewCommandInput,
  result: DesktopBrowserViewState,
  trace: false,
  handler: Effect.fnUntraced(function* (input) {
    const browserViews = yield* DesktopBrowserViews.DesktopBrowserViews;
    return yield* browserViews.command(input);
  }),
});

export const destroyBrowserView = makeIpcMethod({
  channel: IpcChannels.DESTROY_BROWSER_VIEW_CHANNEL,
  payload: DesktopBrowserViewDestroyInput,
  result: Schema.Void,
  trace: false,
  handler: Effect.fnUntraced(function* (input) {
    const browserViews = yield* DesktopBrowserViews.DesktopBrowserViews;
    yield* browserViews.destroy(input.browserId);
  }),
});
