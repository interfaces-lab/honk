import { DesktopRendererDiagnosticInputSchema } from "@honk/shared/desktop-api";
import * as EffectLogger from "@honk/shared/effect-logger";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

const elog = EffectLogger.create({ service: "app-renderer" });

export const logRendererDiagnostic = makeIpcMethod({
  channel: IpcChannels.LOG_RENDERER_DIAGNOSTIC_CHANNEL,
  payload: DesktopRendererDiagnosticInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.rendererDiagnostics.log")(function* (input) {
    const log =
      input.level === "error"
        ? elog.error
        : input.level === "warn"
          ? elog.warn
          : input.level === "debug"
            ? elog.debug
            : elog.info;
    yield* log(input.message, input.details);
  }),
});
