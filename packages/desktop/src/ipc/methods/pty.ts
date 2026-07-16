import { DesktopPtyOpenOptions } from "@honk/shared/desktop-api";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopPty from "../../backend/desktop-pty";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";

// PTY IPC. The renderer chooses the ID so it can subscribe before spawning.

const PtyWriteInputSchema = Schema.Struct({
  id: Schema.String,
  data: Schema.String,
});

const PtyResizeInputSchema = Schema.Struct({
  id: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
});

const PtyCloseInputSchema = Schema.Struct({
  id: Schema.String,
});

export const openPty = makeIpcMethod({
  channel: IpcChannels.PTY_OPEN_CHANNEL,
  payload: DesktopPtyOpenOptions,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.pty.open")(function* (options) {
    const pty = yield* DesktopPty.DesktopPty;
    return yield* pty.open(options);
  }),
});

export const writePty = makeIpcMethod({
  channel: IpcChannels.PTY_WRITE_CHANNEL,
  payload: PtyWriteInputSchema,
  result: Schema.Void,
  trace: false,
  handler: Effect.fnUntraced(function* (input) {
    const pty = yield* DesktopPty.DesktopPty;
    yield* pty.write(input.id, input.data);
  }),
});

export const resizePty = makeIpcMethod({
  channel: IpcChannels.PTY_RESIZE_CHANNEL,
  payload: PtyResizeInputSchema,
  result: Schema.Void,
  trace: false,
  handler: Effect.fnUntraced(function* (input) {
    const pty = yield* DesktopPty.DesktopPty;
    yield* pty.resize(input.id, input.cols, input.rows);
  }),
});

export const closePty = makeIpcMethod({
  channel: IpcChannels.PTY_CLOSE_CHANNEL,
  payload: PtyCloseInputSchema,
  result: Schema.Void,
  trace: false,
  handler: Effect.fnUntraced(function* (input) {
    const pty = yield* DesktopPty.DesktopPty;
    yield* pty.close(input.id);
  }),
});
