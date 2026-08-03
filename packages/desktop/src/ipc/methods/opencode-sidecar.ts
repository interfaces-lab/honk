import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as OpencodeSidecar from "../../backend/opencode-sidecar";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

// Sidecar endpoint snapshot for the renderer SDK client.
const OpencodeSidecarSnapshotSchema = Schema.Struct({
  status: Schema.Literals(["idle", "starting", "ready", "restarting", "stopped", "error"]),
  url: Schema.NullOr(Schema.String),
  password: Schema.NullOr(Schema.String),
});

export const getOpencodeSidecar = makeIpcMethod({
  channel: IpcChannels.GET_OPENCODE_SIDECAR_CHANNEL,
  payload: Schema.Void,
  result: OpencodeSidecarSnapshotSchema,
  handler: Effect.fn("desktop.ipc.opencodeSidecar.get")(function* () {
    const sidecar = yield* OpencodeSidecar.OpencodeSidecar;
    return yield* sidecar.snapshot;
  }),
});
