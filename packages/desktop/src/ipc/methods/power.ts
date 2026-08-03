import { powerSaveBlocker } from "electron";
import { Effect, Schema } from "effect";

import { SET_KEEP_AWAKE_CHANNEL } from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

let blockerID: number | undefined;

export const setKeepAwake = makeIpcMethod({
  channel: SET_KEEP_AWAKE_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.power.setKeepAwake")((enabled) =>
    Effect.sync(() => {
      if (enabled && !isKeepAwakeEnabled()) {
        blockerID = powerSaveBlocker.start("prevent-display-sleep");
      }
      if (!enabled) {
        stopKeepAwake();
      }
      return isKeepAwakeEnabled();
    }),
  ),
});

function isKeepAwakeEnabled(): boolean {
  return blockerID !== undefined && powerSaveBlocker.isStarted(blockerID);
}

function stopKeepAwake(): void {
  if (blockerID === undefined) {
    return;
  }
  if (powerSaveBlocker.isStarted(blockerID)) {
    powerSaveBlocker.stop(blockerID);
  }
  blockerID = undefined;
}
