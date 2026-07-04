import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAuxEndpoint from "../../app/desktop-aux-endpoint";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

const DesktopAuxEndpointSnapshotSchema = Schema.Struct({
  baseUrl: Schema.String,
  bearer: Schema.String,
});

export const getAuxEndpoint = makeIpcMethod({
  channel: IpcChannels.GET_AUX_ENDPOINT_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(DesktopAuxEndpointSnapshotSchema),
  handler: Effect.fn("desktop.ipc.auxEndpoint.get")(function* () {
    const auxEndpoint = yield* DesktopAuxEndpoint.DesktopAuxEndpoint;
    return yield* auxEndpoint.get;
  }),
});
