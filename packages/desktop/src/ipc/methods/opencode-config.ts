import { DesktopMcpServerInput } from "@honk/shared/desktop-api";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/desktop-environment";
import { persistHonkMcpServer } from "../../backend/opencode-config";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

export const persistMcpServer = makeIpcMethod({
  channel: IpcChannels.PERSIST_MCP_SERVER_CHANNEL,
  payload: DesktopMcpServerInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.opencodeConfig.persistMcpServer")(function* (server) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    yield* persistHonkMcpServer({ stateDir: environment.stateDir, server });
  }),
});
