import { Option, Schema } from "effect";
import { TerminalId, ThreadId } from "./id";
import { IsoTimestamp, strictDecode, TrimmedNonEmptyString } from "./primitives";

export const TERMINAL_CONNECT_TICKET_TTL_MS = 30_000;
export const TERMINAL_HISTORY_LINE_LIMIT = 5_000;
export const TERMINAL_COLS_MIN = 20;
export const TERMINAL_COLS_MAX = 400;
export const TERMINAL_ROWS_MIN = 5;
export const TERMINAL_ROWS_MAX = 200;
export const TERMINAL_DEFAULT_COLS = 120;
export const TERMINAL_DEFAULT_ROWS = 30;

export const TerminalCols = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(TERMINAL_COLS_MIN),
).check(Schema.isLessThanOrEqualTo(TERMINAL_COLS_MAX));
export type TerminalCols = typeof TerminalCols.Type;

export const TerminalRows = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(TERMINAL_ROWS_MIN),
).check(Schema.isLessThanOrEqualTo(TERMINAL_ROWS_MAX));
export type TerminalRows = typeof TerminalRows.Type;

export const Terminal = Schema.Struct({
  id: TerminalId,
  threadId: Schema.NullOr(ThreadId),
  title: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  cols: TerminalCols,
  rows: TerminalRows,
  createdAt: IsoTimestamp,
  status: Schema.Literals(["running", "exited"]),
  exitCode: Schema.NullOr(Schema.Int),
});
export type Terminal = typeof Terminal.Type;

export const TerminalList = Schema.Struct({
  terminals: Schema.Array(Terminal),
});
export type TerminalList = typeof TerminalList.Type;

export const CreateTerminalInput = Schema.Struct({
  cwd: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
  title: Schema.optional(TrimmedNonEmptyString),
  cols: Schema.optional(TerminalCols),
  rows: Schema.optional(TerminalRows),
});
export type CreateTerminalInput = typeof CreateTerminalInput.Type;

export const ConnectTicket = Schema.Struct({
  ticket: TrimmedNonEmptyString,
  expiresAt: IsoTimestamp,
});
export type ConnectTicket = typeof ConnectTicket.Type;

/**
 * PTY WebSocket attach framing.
 *
 * The socket is raw WebSocket, not WS-RPC. Each WebSocket text message is one
 * JSON-encoded frame. Client frames are write/resize commands; server frames
 * are output events, a single initial history backlog on attach, and exit.
 */
const TerminalClientWriteFrame = Schema.Struct({
  type: Schema.Literal("write"),
  data: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65_536)),
});

const TerminalClientResizeFrame = Schema.Struct({
  type: Schema.Literal("resize"),
  cols: TerminalCols,
  rows: TerminalRows,
});

export const TerminalClientFrame = Schema.Union([
  TerminalClientWriteFrame,
  TerminalClientResizeFrame,
]);
export type TerminalClientFrame = typeof TerminalClientFrame.Type;

const TerminalServerOutputFrame = Schema.Struct({
  type: Schema.Literal("output"),
  data: Schema.String,
});

const TerminalServerExitFrame = Schema.Struct({
  type: Schema.Literal("exit"),
  exitCode: Schema.NullOr(Schema.Int),
});

const TerminalServerHistoryFrame = Schema.Struct({
  type: Schema.Literal("history"),
  data: Schema.String,
});

export const TerminalServerFrame = Schema.Union([
  TerminalServerOutputFrame,
  TerminalServerExitFrame,
  TerminalServerHistoryFrame,
]);
export type TerminalServerFrame = typeof TerminalServerFrame.Type;

const TerminalClientFrameJson = Schema.fromJsonString(TerminalClientFrame);
const decodeTerminalClientFrameOption = Schema.decodeUnknownOption(TerminalClientFrameJson);

export const decodeTerminalClientFrame = (input: string): Option.Option<TerminalClientFrame> =>
  decodeTerminalClientFrameOption(input, { onExcessProperty: "error" });

export class TerminalNotFoundError extends Schema.TaggedErrorClass<TerminalNotFoundError>()(
  "TerminalNotFoundError",
  { terminalId: TerminalId },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `Terminal not found: ${this.terminalId}`;
  }
}

export const decodeTerminal = strictDecode(Terminal);
