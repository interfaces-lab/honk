import { Cause, Effect, PubSub, Queue, Scope, Stream } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

const encoder = new TextEncoder();

/** One published unit on a bus: the seq lets late subscribers dedupe against replay. */
export interface BusEnvelope {
	readonly seq: number;
	readonly encoded: string;
}

const GOODBYE: BusEnvelope = { seq: -1, encoded: "" };

export const dataFrame = (encoded: string): Uint8Array => encoder.encode(`data: ${encoded}\n\n`);
const heartbeatFrame = encoder.encode(`: ping\n\n`);
const connectedFrame = encoder.encode(`: connected\n\n`);
const goodbyeFrame = encoder.encode(`event: goodbye\ndata: {}\n\n`);

const HEARTBEAT_MILLIS = 15_000;

export interface SseResponseOptions {
	readonly stillValid: () => boolean;
	readonly sessionId?: string;
}

export interface CoreBuses {
	readonly threadBus: (threadId: string) => Effect.Effect<PubSub.PubSub<BusEnvelope>>;
	readonly workspaceBus: () => Effect.Effect<PubSub.PubSub<BusEnvelope>>;
	readonly publishThread: (threadId: string, envelope: BusEnvelope) => Effect.Effect<void>;
	readonly publishWorkspace: (envelope: BusEnvelope) => Effect.Effect<void>;
	readonly closeThread: (threadId: string) => Effect.Effect<void>;
	readonly dispose: () => Effect.Effect<void>;
}

/**
 * The live fan-out plane. Buses are in-process PubSubs carrying
 * already-encoded events; correctness never depends on them — every event is
 * durable in the store first, and subscribers replay-then-tail with the seq
 * guard. dispose() broadcasts the goodbye sentinel so clients distinguish
 * clean shutdown from network failure.
 */
export const makeCoreBuses = (): CoreBuses => {
	const threads = new Map<string, PubSub.PubSub<BusEnvelope>>();
	let workspace: PubSub.PubSub<BusEnvelope> | null = null;

	const threadBus = (threadId: string): Effect.Effect<PubSub.PubSub<BusEnvelope>> =>
		Effect.gen(function* () {
			const existing = threads.get(threadId);
			if (existing !== undefined) return existing;
			const bus = yield* PubSub.unbounded<BusEnvelope>();
			const raced = threads.get(threadId);
			if (raced !== undefined) return raced;
			threads.set(threadId, bus);
			return bus;
		});

	const workspaceBus = (): Effect.Effect<PubSub.PubSub<BusEnvelope>> =>
		Effect.gen(function* () {
			if (workspace !== null) return workspace;
			const bus = yield* PubSub.unbounded<BusEnvelope>();
			workspace = bus;
			return bus;
		});

	return {
		threadBus,
		workspaceBus,
		publishThread: (threadId, envelope) =>
			threadBus(threadId).pipe(Effect.flatMap((bus) => PubSub.publish(bus, envelope))),
		publishWorkspace: (envelope) =>
			workspaceBus().pipe(Effect.flatMap((bus) => PubSub.publish(bus, envelope))),
		closeThread: (threadId) =>
			Effect.gen(function* () {
				const bus = threads.get(threadId);
				if (bus === undefined) return;
				threads.delete(threadId);
				yield* PubSub.publish(bus, GOODBYE);
			}),
		dispose: () =>
			Effect.gen(function* () {
				const buses = [...threads.values(), ...(workspace ? [workspace] : [])];
				yield* Effect.forEach(buses, (bus) => PubSub.publish(bus, GOODBYE), { discard: true });
			}),
	};
};

/**
 * Assemble one SSE response: subscribe EAGERLY (before the caller reads its
 * replay, so nothing published in between is lost — the seq guard drops the
 * overlap), replay everything after the client's high-water mark, then tail
 * live with heartbeats. Requires the request Scope: the producers die with
 * the connection, and the goodbye sentinel ends the stream cleanly.
 */
export const sseResponse = (
	bus: PubSub.PubSub<BusEnvelope>,
	readReplay: () => Array<{ seq: number; encoded: string }>,
	options: SseResponseOptions,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Scope.Scope> =>
	Effect.gen(function* () {
		const subscription = yield* PubSub.subscribe(bus);
		const replay = readReplay();
		const out = yield* Queue.make<Uint8Array, Cause.Done>();
		const response = (): HttpServerResponse.HttpServerResponse =>
			HttpServerResponse.stream(Stream.fromQueue(out), {
				contentType: "text/event-stream",
				headers: { "cache-control": "no-cache" },
			});
		let invalidSessionLogged = false;
		const endIfInvalid = (): Effect.Effect<boolean> =>
			options.stillValid()
				? Effect.succeed(false)
				: Effect.gen(function* () {
						if (!invalidSessionLogged && options.sessionId !== undefined) {
							invalidSessionLogged = true;
							yield* Effect.logWarning("sse session invalid", { sessionId: options.sessionId });
						}
						yield* Queue.end(out);
						return true;
					});
		// Flush headers immediately: an empty replay (the normal live-tail open)
		// writes no bytes, and node holds the response headers until the first
		// write — without this comment frame the client's fetch never resolves.
		yield* Queue.offer(out, connectedFrame);
		let highWater = 0;
		for (const item of replay) {
			if (yield* endIfInvalid()) return response();
			yield* Queue.offer(out, dataFrame(item.encoded));
			highWater = item.seq;
		}
		const tail = highWater;
		yield* Effect.forkScoped(
			Effect.gen(function* () {
				let last = tail;
				while (true) {
					const envelope = yield* PubSub.take(subscription);
					if (yield* endIfInvalid()) return;
					if (envelope.seq === -1) {
						yield* Queue.offer(out, goodbyeFrame);
						yield* Queue.end(out);
						return;
					}
					if (envelope.seq <= last) continue;
					last = envelope.seq;
					yield* Queue.offer(out, dataFrame(envelope.encoded));
				}
			}),
		);
		yield* Effect.forkScoped(
			Effect.gen(function* () {
				while (true) {
					yield* Effect.sleep(HEARTBEAT_MILLIS);
					if (yield* endIfInvalid()) return;
					yield* Queue.offer(out, heartbeatFrame);
				}
			}),
		);
		return response();
	});
