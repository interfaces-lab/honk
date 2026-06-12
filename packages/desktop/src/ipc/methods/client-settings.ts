import { ClientSettingsSchema } from "@honk/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopAppIdentity from "../../app/desktop-app-identity";
import * as DesktopClientSettings from "../../settings/desktop-client-settings";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

export const getClientSettings = makeIpcMethod({
  channel: IpcChannels.GET_CLIENT_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(ClientSettingsSchema),
  handler: Effect.fn("desktop.ipc.clientSettings.get")(function* () {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    return Option.getOrNull(yield* clientSettings.get);
  }),
});

export const setClientSettings = makeIpcMethod({
  channel: IpcChannels.SET_CLIENT_SETTINGS_CHANNEL,
  payload: ClientSettingsSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.clientSettings.set")(function* (settings) {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    yield* clientSettings.set(settings);
    const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
    yield* appIdentity.applyAppIconVariant(settings.appIconVariant);
  }),
});
