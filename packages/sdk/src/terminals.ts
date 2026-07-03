import { Option, Schema, type Effect } from "effect";
import {
	TerminalServerFrame,
	type CreateTerminalInput,
	type Terminal,
	type TerminalClientFrame,
	type TerminalId,
} from "@honk/api/core/v1";
import type { HonkEffectClient } from "./client";

export type TerminalSessionStatus = "open" | "closed" | "error" | "ticket-rejected";

export interface TerminalAttachHandlers {
	readonly onData: (data: string) => void;
	readonly onExit?: (code: number | null) => void;
	readonly onClose?: () => void;
	readonly onError?: (error: unknown) => void;
	readonly onStatus?: (status: TerminalSessionStatus) => void;
}

export interface TerminalSession {
	readonly write: (data: string) => void;
	readonly resize: (cols: number, rows: number) => void;
	readonly close: () => void;
}

export interface HonkTerminals {
	readonly list: () => Promise<Array<Terminal>>;
	readonly create: (input: CreateTerminalInput) => Promise<Terminal>;
	readonly close: (terminalId: TerminalId) => Promise<void>;
	readonly restart: (terminalId: TerminalId) => Promise<Terminal>;
	readonly attach: (
		terminalId: TerminalId,
		handlers: TerminalAttachHandlers,
	) => Promise<TerminalSession>;
}

const TerminalServerFrameJson = Schema.fromJsonString(TerminalServerFrame);
const decodeTerminalServerFrameOption = Schema.decodeUnknownOption(TerminalServerFrameJson);

const makeCallbackReporter = (): ((error: unknown) => void) => {
	let reported = false;
	return (error) => {
		if (reported) return;
		reported = true;
		console.error("[honk/sdk] terminal callback threw", error);
	};
};

const invokeCallback = (
	reportError: (error: unknown) => void,
	callback: (() => void) | undefined,
): void => {
	if (callback === undefined) return;
	try {
		callback();
	} catch (error) {
		reportError(error);
	}
};

const terminalAttachUrl = (origin: string, ticket: string): string => {
	const url = new URL("/core/v1/terminals/attach", origin);
	if (url.protocol === "https:") {
		url.protocol = "wss:";
	} else if (url.protocol === "http:") {
		url.protocol = "ws:";
	} else {
		throw new Error(`Unsupported Honk Core origin protocol for terminal attach: ${url.protocol}`);
	}
	url.searchParams.set("ticket", ticket);
	return url.toString();
};

const closeError = (event: CloseEvent): Error => {
	if (event.code === 4401) return new Error("Terminal attach ticket rejected");
	const reason = event.reason.length > 0 ? `: ${event.reason}` : "";
	return new Error(`Terminal WebSocket closed before open: ${event.code}${reason}`);
};

const sendFrame = (socket: WebSocket, frame: TerminalClientFrame): void => {
	if (socket.readyState !== globalThis.WebSocket.OPEN) {
		throw new Error("Terminal session is not open");
	}
	socket.send(JSON.stringify(frame));
};

const closeSocket = (socket: WebSocket): void => {
	if (
		socket.readyState === globalThis.WebSocket.CLOSED ||
		socket.readyState === globalThis.WebSocket.CLOSING
	) {
		return;
	}
	socket.close();
};

const openTerminalSession = (
	url: string,
	handlers: TerminalAttachHandlers,
): Promise<TerminalSession> =>
	new Promise((resolve, reject) => {
		if (typeof globalThis.WebSocket !== "function") {
			reject(new Error("WebSocket global is not available"));
			return;
		}

		const reportCallbackError = makeCallbackReporter();
		const socket = new globalThis.WebSocket(url);
		let settled = false;
		let closed = false;

		const session: TerminalSession = {
			write: (data) => {
				sendFrame(socket, { type: "write", data });
			},
			resize: (cols, rows) => {
				sendFrame(socket, { type: "resize", cols, rows });
			},
			close: () => {
				if (closed) return;
				closeSocket(socket);
			},
		};

		const cleanup = (): void => {
			socket.removeEventListener("open", handleOpen);
			socket.removeEventListener("message", handleMessage);
			socket.removeEventListener("error", handleError);
			socket.removeEventListener("close", handleClose);
		};

		const rejectBeforeOpen = (error: Error): void => {
			if (settled) return;
			settled = true;
			reject(error);
		};

		function handleOpen(): void {
			if (settled) return;
			settled = true;
			invokeCallback(reportCallbackError, () => handlers.onStatus?.("open"));
			resolve(session);
		}

		function handleMessage(event: MessageEvent): void {
			if (typeof event.data !== "string") return;
			const decoded = decodeTerminalServerFrameOption(event.data, { onExcessProperty: "error" });
			if (Option.isNone(decoded)) return;
			const frame = decoded.value;
			if (frame.type === "exit") {
				invokeCallback(reportCallbackError, () => handlers.onExit?.(frame.exitCode));
				return;
			}
			invokeCallback(reportCallbackError, () => handlers.onData(frame.data));
		}

		function handleError(): void {
			const error = new Error("Terminal WebSocket error");
			invokeCallback(reportCallbackError, () => handlers.onStatus?.("error"));
			invokeCallback(reportCallbackError, () => handlers.onError?.(error));
			rejectBeforeOpen(error);
			closeSocket(socket);
		}

		function handleClose(event: CloseEvent): void {
			closed = true;
			cleanup();
			const status: TerminalSessionStatus =
				event.code === 4401 ? "ticket-rejected" : "closed";
			invokeCallback(reportCallbackError, () => handlers.onStatus?.(status));
			invokeCallback(reportCallbackError, handlers.onClose);
			rejectBeforeOpen(closeError(event));
		}

		socket.addEventListener("open", handleOpen);
		socket.addEventListener("message", handleMessage);
		socket.addEventListener("error", handleError);
		socket.addEventListener("close", handleClose);
	});

export const makeTerminalsSurface = (
	apiClient: HonkEffectClient,
	run: <A, E>(effect: Effect.Effect<A, E, never>) => Promise<A>,
	origin: string,
): HonkTerminals => ({
	list: async () => {
		const list = await run(apiClient.terminals.list());
		return [...list.terminals];
	},
	create: (input) => run(apiClient.terminals.create({ payload: input })),
	close: (terminalId) => run(apiClient.terminals.close({ params: { terminalId } })),
	restart: (terminalId) => run(apiClient.terminals.restart({ params: { terminalId } })),
	attach: async (terminalId, handlers) => {
		const ticket = await run(apiClient.terminals.ticket({ params: { terminalId } }));
		return openTerminalSession(terminalAttachUrl(origin, ticket.ticket), handlers);
	},
});
