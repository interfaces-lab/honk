import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as HonkCoreHost from "../../backend/honk-core-host";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

const HonkCoreEndpoint = Schema.Struct({
  baseUrl: Schema.String,
});

export const getHonkCoreEndpoint = makeIpcMethod({
  channel: IpcChannels.GET_HONK_CORE_ENDPOINT_CHANNEL,
  payload: Schema.Void,
  result: HonkCoreEndpoint,
  handler: Effect.fn("desktop.ipc.honkCore.getEndpoint")(function* () {
    const host = yield* HonkCoreHost.HonkCoreHost;
    return { baseUrl: host.baseUrl };
  }),
});
