import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as OpencodeSidecar from "../../backend/opencode-sidecar";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

// Snapshot of the opencode sidecar the renderer reads to point @opencode-ai/sdk
// at the local server. Mirrors the aux-endpoint bridge method shape.
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
