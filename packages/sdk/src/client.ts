import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Duration, Effect, Fiber, ManagedRuntime, Option, Stream } from "effect";
import * as Sse from "effect/unstable/encoding/Sse";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import {
	type AdmissionReceipt,
	type AttachmentId,
	type AuthSnapshot,
	type CreateThreadInput,
	type CredentialKind,
	type EntryId,
	type LoginInput,
	type MessageId,
	type ModelCatalog,
	type PairingIssue,
	type PlanId,
	type QuestionId,
	type QueuedMessage,
	type SendMessageInput,
	type Session,
	type ThreadDetail,
	type ThreadId,
	type ThreadStreamEvent,
	type ThreadSummary,
	type ThreadSummaryEvent,
	type TurnId,
	type UpdateThreadInput,
	type UnknownRecord,
	decodeCoreDiscoveryText,
	decodeCoreHealth,
	decodeSessionGrant,
	decodeThreadStreamEvent,
	decodeThreadSummaryEvent,
	HonkApi,
	UnauthorizedError,
} from "@honk/api/core/v1";
import {
	applyThreadEvent,
	applyWorkspaceEvent,
	fromDetail,
	fromWorkspaceList,
	type ThreadState,
	type WorkspaceState,
} from "./reducer";
import { makeTerminalsSurface, type HonkTerminals } from "./terminals";

export type HonkEffectClient = HttpApiClient.ForApi<typeof HonkApi>;

export type ConnectOptions =
	| {
			readonly origin: string;
			readonly bearer: string;
	  }
	| {
			readonly origin: string;
			readonly pairingToken: string;
	  }
	| {
			readonly discover: {
				readonly home?: string;
			};
	  };

export type WatchStatus = "live" | "reconnecting" | "closed" | "unauthorized";

export interface ThreadWatchHandlers {
	readonly onChange: (state: ThreadState) => void;
	readonly onEvent?: (event: ThreadStreamEvent) => void;
	readonly onStatus?: (status: WatchStatus) => void;
}

export interface WorkspaceWatchHandlers {
	readonly onChange: (state: WorkspaceState) => void;
	readonly onEvent?: (event: ThreadSummaryEvent) => void;
	readonly onStatus?: (status: WatchStatus) => void;
}

export interface ThreadWatch {
	readonly state: () => ThreadState;
	readonly close: () => void;
}

export interface WorkspaceWatch {
	readonly state: () => WorkspaceState;
	readonly close: () => void;
}

export interface HonkClient {
	readonly effect: HonkEffectClient;
	readonly threads: {
		readonly list: (query?: { readonly archived?: boolean }) => Promise<{
			readonly threads: ReadonlyArray<ThreadSummary>;
			readonly seq: number;
		}>;
		readonly create: (payload: CreateThreadInput) => Promise<ThreadSummary>;
		readonly get: (threadId: ThreadId) => Promise<ThreadDetail>;
		readonly update: (threadId: ThreadId, payload: UpdateThreadInput) => Promise<ThreadSummary>;
		readonly archive: (threadId: ThreadId) => Promise<ThreadSummary>;
		readonly unarchive: (threadId: ThreadId) => Promise<ThreadSummary>;
		readonly remove: (threadId: ThreadId) => Promise<void>;
		readonly navigate: (threadId: ThreadId, payload: { readonly entryId: EntryId }) => Promise<ThreadDetail>;
		readonly send: (threadId: ThreadId, payload: SendMessageInput) => Promise<AdmissionReceipt>;
		readonly interrupt: (
			threadId: ThreadId,
			payload?: { readonly turnId?: TurnId },
		) => Promise<{ readonly turnId: TurnId | null }>;
		readonly cancelQueued: (threadId: ThreadId, messageId: MessageId) => Promise<QueuedMessage>;
		readonly answerQuestion: (
			threadId: ThreadId,
			questionId: QuestionId,
			payload: { readonly answers: UnknownRecord },
		) => Promise<void>;
		readonly implementPlan: (threadId: ThreadId, planId: PlanId) => Promise<void>;
		readonly attachmentUrl: (threadId: ThreadId, attachmentId: AttachmentId) => string;
		readonly watch: (threadId: ThreadId, handlers: ThreadWatchHandlers) => ThreadWatch;
	};
	readonly models: {
		readonly catalog: () => Promise<ModelCatalog>;
	};
	readonly auth: {
		readonly get: () => Promise<AuthSnapshot>;
		readonly login: (payload: LoginInput) => Promise<AuthSnapshot>;
		readonly logout: (payload: { readonly kind: CredentialKind }) => Promise<AuthSnapshot>;
		readonly cancelFlow: () => Promise<AuthSnapshot>;
	};
	readonly sessions: {
		readonly list: () => Promise<{ readonly sessions: ReadonlyArray<Session> }>;
		readonly revoke: (sessionId: Session["id"]) => Promise<void>;
		readonly pair: () => Promise<PairingIssue>;
	};
	readonly terminals: HonkTerminals;
	readonly workspace: {
		readonly watch: (handlers: WorkspaceWatchHandlers) => WorkspaceWatch;
	};
	readonly close: () => Promise<void>;
}

const GOODBYE = Symbol("goodbye");
const INITIAL_RECONNECT_DELAY_MS = 100;
const MAX_RECONNECT_DELAY_MS = 10_000;
const READ_IDLE_TIMEOUT = Duration.seconds(45);

const nextReconnectDelay = (baseMs: number): number => {
	const jitterFactor = 0.8 + Math.random() * 0.4;
	return Math.max(0, Math.round(baseMs * jitterFactor));
};

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const errorCode = (error: unknown): string | null => {
	if (typeof error !== "object" || error === null || !("code" in error)) return null;
	const code = (error as { readonly code?: unknown }).code;
	return typeof code === "string" ? code : null;
};

const isUnauthorizedError = (error: unknown): boolean => {
	if (error instanceof UnauthorizedError) return true;
	if (typeof error !== "object" || error === null) return false;
	if ("_tag" in error && (error as { readonly _tag?: unknown })._tag === "UnauthorizedError") {
		return true;
	}
	return "status" in error && (error as { readonly status?: unknown }).status === 401;
};

const makeCallbackReporter = (): ((error: unknown) => void) => {
	let reported = false;
	return (error) => {
		if (reported) return;
		reported = true;
		console.error("[honk/sdk] watch callback threw", error);
	};
};

const invokeWatchCallback = (
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

const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, "");

const resolveHonkHome = (override?: string): string =>
	override ?? process.env["HONK_HOME"] ?? join(homedir(), ".honk");

const discoveryPaths = (home: string): { readonly discoveryPath: string; readonly secretPath: string } => ({
	discoveryPath: join(home, "core", "core.json"),
	secretPath: join(home, "core", "core-app-secret"),
});

const readDiscoveryFile = (path: string): string => {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") {
			throw new Error(`Honk Core discovery file not found at ${path}`);
		}
		throw new Error(`Unable to read Honk Core discovery file at ${path}: ${errorMessage(error)}`);
	}
};

const readSecretFile = (path: string): string => {
	try {
		return readFileSync(path, "utf8").trim();
	} catch (error) {
		if (errorCode(error) === "ENOENT") {
			throw new Error(`Honk Core app secret file not found at ${path}`);
		}
		throw new Error(`Unable to read Honk Core app secret file at ${path}: ${errorMessage(error)}`);
	}
};

const probeDiscovery = async (
	homeOverride?: string,
): Promise<{ readonly origin: string; readonly bearer: string }> => {
	const home = resolveHonkHome(homeOverride);
	const paths = discoveryPaths(home);
	const discoveryText = readDiscoveryFile(paths.discoveryPath);
	const discoveryOption = decodeCoreDiscoveryText(discoveryText);
	if (Option.isNone(discoveryOption)) {
		throw new Error(`Honk Core discovery file at ${paths.discoveryPath} is missing required fields or is not valid JSON`);
	}
	const discovery = discoveryOption.value;
	const origin = normalizeOrigin(discovery.origin);
	const healthUrl = `${origin}/core/v1/health`;
	let response: Response;
	try {
		response = await fetch(healthUrl, {
			signal: AbortSignal.timeout(1000),
		});
	} catch (error) {
		throw new Error(`Honk Core health probe failed at ${healthUrl}: ${errorMessage(error)}`);
	}
	if (!response.ok) {
		throw new Error(`Honk Core health probe failed at ${healthUrl}: HTTP ${response.status}`);
	}
	let healthJson: unknown;
	try {
		healthJson = await response.json();
	} catch (error) {
		throw new Error(`Honk Core health response from ${healthUrl} was not valid JSON: ${errorMessage(error)}`);
	}
	const healthApiVersion =
		typeof healthJson === "object" && healthJson !== null && "apiVersion" in healthJson
			? (healthJson as { readonly apiVersion?: unknown }).apiVersion
			: undefined;
	if (typeof healthApiVersion === "string" && healthApiVersion !== discovery.apiVersion) {
		throw new Error(
			`Honk Core apiVersion mismatch at ${healthUrl}: discovery ${discovery.apiVersion}, health ${healthApiVersion}`,
		);
	}
	try {
		decodeCoreHealth(healthJson);
	} catch (error) {
		throw new Error(`Honk Core health response from ${healthUrl} did not decode: ${errorMessage(error)}`);
	}
	return {
		origin,
		bearer: readSecretFile(paths.secretPath),
	};
};

const exchangePairingToken = async (
	origin: string,
	pairingToken: string,
): Promise<{ readonly bearer: string }> => {
	const response = await fetch(`${origin}/core/v1/sessions/exchange`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: pairingToken }),
	});
	if (response.status === 401) {
		throw new UnauthorizedError();
	}
	if (!response.ok) {
		throw new Error(`Pairing exchange failed with HTTP ${response.status}`);
	}
	const grant = decodeSessionGrant(await response.json());
	return { bearer: grant.bearer };
};

const absoluteUrl = (origin: string, path: string, query?: Readonly<Record<string, string>>): URL => {
	const url = new URL(path, origin);
	for (const [key, value] of Object.entries(query ?? {})) {
		url.searchParams.set(key, value);
	}
	return url;
};

const sseRequest = (origin: string, bearer: string, path: string, after: number) =>
	HttpClientRequest.get(absoluteUrl(origin, path, { after: String(after) }), {
		headers: {
			accept: "text/event-stream",
			authorization: `Bearer ${bearer}`,
		},
	});

const checkSseResponse = (response: {
	readonly status: number;
	readonly text: Effect.Effect<string, unknown, never>;
}) =>
	response.status === 401
		? Effect.fail(new UnauthorizedError())
		: response.status >= 200 && response.status < 300
		? Effect.void
		: response.text.pipe(
				Effect.catch(() => Effect.succeed("")),
				Effect.flatMap((body) =>
					Effect.fail(
						new Error(
							body
								? `SSE request failed with HTTP ${response.status}: ${body}`
								: `SSE request failed with HTTP ${response.status}`,
						),
					),
				),
			);

const decodeThreadFrame = (event: Sse.Event): ThreadStreamEvent | typeof GOODBYE | null => {
	if (event.event === "goodbye") return GOODBYE;
	if (event.event !== "message") return null;
	try {
		const payload: unknown = JSON.parse(event.data);
		return decodeThreadStreamEvent(payload);
	} catch {
		return null;
	}
};

const decodeWorkspaceFrame = (event: Sse.Event): ThreadSummaryEvent | typeof GOODBYE | null => {
	if (event.event === "goodbye") return GOODBYE;
	if (event.event !== "message") return null;
	try {
		const payload: unknown = JSON.parse(event.data);
		return decodeThreadSummaryEvent(payload);
	} catch {
		return null;
	}
};

const invokeStatus = (
	reportError: (error: unknown) => void,
	callback: ((status: WatchStatus) => void) | undefined,
	status: WatchStatus,
): Effect.Effect<void> =>
	Effect.sync(() => {
		invokeWatchCallback(reportError, callback === undefined ? undefined : () => callback(status));
	});

export const connect = async (options: ConnectOptions): Promise<HonkClient> => {
	const resolved =
		"discover" in options
			? await probeDiscovery(options.discover.home)
			: "pairingToken" in options
				? {
						origin: normalizeOrigin(options.origin),
						...(await exchangePairingToken(normalizeOrigin(options.origin), options.pairingToken)),
					}
				: { origin: normalizeOrigin(options.origin), bearer: options.bearer };

	const runtime = ManagedRuntime.make(FetchHttpClient.layer);
	const apiClient = await runtime.runPromise(
		HttpApiClient.make(HonkApi, {
			baseUrl: resolved.origin,
			transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(resolved.bearer)),
		}),
	);

	const fibers = new Set<Fiber.Fiber<void, unknown>>();

	const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => runtime.runPromise(effect);

	const forkTracked = (effect: Effect.Effect<void, unknown, HttpClient.HttpClient>): Fiber.Fiber<void, unknown> => {
		let fiber: Fiber.Fiber<void, unknown>;
		const tracked = effect.pipe(
			Effect.ensuring(
				Effect.sync(() => {
					fibers.delete(fiber);
				}),
			),
		);
		fiber = runtime.runFork(tracked);
		fibers.add(fiber);
		return fiber;
	};

	const interruptFiber = (fiber: Fiber.Fiber<void, unknown>): void => {
		void runtime.runPromise(Fiber.interrupt(fiber)).catch(() => {});
	};

	const consumeThreadSse = (
		threadId: ThreadId,
		readState: () => ThreadState,
		writeState: (state: ThreadState) => void,
		onOpen: Effect.Effect<void>,
		handlers: ThreadWatchHandlers,
		reportCallbackError: (error: unknown) => void,
	): Effect.Effect<"closed", unknown, HttpClient.HttpClient> =>
		Effect.gen(function* () {
			const path = `/core/v1/threads/${encodeURIComponent(String(threadId))}/watch`;
			const response = yield* HttpClient.execute(
				sseRequest(resolved.origin, resolved.bearer, path, readState().seq),
			);
			yield* checkSseResponse(response);
			yield* onOpen;
			yield* response.stream.pipe(
				Stream.timeout(READ_IDLE_TIMEOUT),
				Stream.decodeText(),
				Stream.pipeThroughChannel(Sse.decode()),
				Stream.runForEach((event) =>
					Effect.gen(function* () {
						const decoded = decodeThreadFrame(event);
						if (decoded === null) return;
						if (decoded === GOODBYE) return yield* Effect.fail(GOODBYE);

						const previous = readState();
						const applied = applyThreadEvent(previous, decoded);
						const onEvent = handlers.onEvent;
						if (applied.refetch) {
							const detail = yield* apiClient.threads.get({ params: { threadId } });
							writeState(fromDetail(detail));
							invokeWatchCallback(
								reportCallbackError,
								onEvent === undefined ? undefined : () => onEvent(decoded),
							);
							return;
						}
						writeState(applied.state);
						invokeWatchCallback(
							reportCallbackError,
							onEvent === undefined ? undefined : () => onEvent(decoded),
						);
					}),
				),
			);
			return yield* Effect.fail(new Error("Thread watch ended without goodbye"));
		}).pipe(
			Effect.catch((error) =>
				error === GOODBYE ? Effect.succeed("closed" as const) : Effect.fail(error),
			),
		);

	const consumeWorkspaceSse = (
		readState: () => WorkspaceState,
		writeState: (state: WorkspaceState) => void,
		onOpen: Effect.Effect<void>,
		handlers: WorkspaceWatchHandlers,
		reportCallbackError: (error: unknown) => void,
	): Effect.Effect<"closed", unknown, HttpClient.HttpClient> =>
		Effect.gen(function* () {
			const response = yield* HttpClient.execute(
				sseRequest(resolved.origin, resolved.bearer, "/core/v1/threads/watch", readState().seq),
			);
			yield* checkSseResponse(response);
			yield* onOpen;
			yield* response.stream.pipe(
				Stream.timeout(READ_IDLE_TIMEOUT),
				Stream.decodeText(),
				Stream.pipeThroughChannel(Sse.decode()),
				Stream.runForEach((event) =>
					Effect.gen(function* () {
						const decoded = decodeWorkspaceFrame(event);
						if (decoded === null) return;
						if (decoded === GOODBYE) return yield* Effect.fail(GOODBYE);
						const next = applyWorkspaceEvent(readState(), decoded);
						writeState(next);
						const onEvent = handlers.onEvent;
						invokeWatchCallback(
							reportCallbackError,
							onEvent === undefined ? undefined : () => onEvent(decoded),
						);
					}),
				),
			);
			return yield* Effect.fail(new Error("Workspace watch ended without goodbye"));
		}).pipe(
			Effect.catch((error) =>
				error === GOODBYE ? Effect.succeed("closed" as const) : Effect.fail(error),
			),
		);

	const watchThread = (threadId: ThreadId, handlers: ThreadWatchHandlers): ThreadWatch => {
		let current: ThreadState | null = null;
		let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
		const reportCallbackError = makeCallbackReporter();
		const readState = (): ThreadState => {
			if (current === null) throw new Error("Thread watch has not received its initial snapshot");
			return current;
		};
		const writeState = (state: ThreadState): void => {
			current = state;
			invokeWatchCallback(reportCallbackError, () => handlers.onChange(state));
		};
		const runOnce = Effect.gen(function* () {
			const detail = yield* apiClient.threads.get({ params: { threadId } });
			writeState(fromDetail(detail));
			return yield* consumeThreadSse(
				threadId,
				readState,
				writeState,
				Effect.gen(function* () {
					reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
					yield* invokeStatus(reportCallbackError, handlers.onStatus, "live");
				}),
				handlers,
				reportCallbackError,
			);
		});
		const runLoop = Effect.gen(function* () {
			while (true) {
				const outcome = yield* runOnce.pipe(
					Effect.map((value) => ({ _tag: "success" as const, value })),
					Effect.catch((error) => Effect.succeed({ _tag: "failure" as const, error })),
				);
				if (outcome._tag === "success") {
					if (outcome.value === "closed") {
						yield* invokeStatus(reportCallbackError, handlers.onStatus, "closed");
					}
					return;
				}
				if (isUnauthorizedError(outcome.error)) {
					yield* invokeStatus(reportCallbackError, handlers.onStatus, "unauthorized");
					return;
				}
				yield* invokeStatus(reportCallbackError, handlers.onStatus, "reconnecting");
				const delayMs = nextReconnectDelay(reconnectDelayMs);
				reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
				yield* Effect.sleep(Duration.millis(delayMs));
			}
		});

		const fiber = forkTracked(runLoop);
		let closed = false;
		return {
			state: readState,
			close: () => {
				if (closed) return;
				closed = true;
				interruptFiber(fiber);
			},
		};
	};

	const watchWorkspace = (handlers: WorkspaceWatchHandlers): WorkspaceWatch => {
		let current: WorkspaceState | null = null;
		let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
		const reportCallbackError = makeCallbackReporter();
		const readState = (): WorkspaceState => {
			if (current === null) throw new Error("Workspace watch has not received its initial snapshot");
			return current;
		};
		const writeState = (state: WorkspaceState): void => {
			current = state;
			invokeWatchCallback(reportCallbackError, () => handlers.onChange(state));
		};
		const runOnce = Effect.gen(function* () {
			const snapshot = yield* apiClient.threads.list({ query: { archived: false } });
			writeState(fromWorkspaceList(snapshot));
			return yield* consumeWorkspaceSse(
				readState,
				writeState,
				Effect.gen(function* () {
					reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
					yield* invokeStatus(reportCallbackError, handlers.onStatus, "live");
				}),
				handlers,
				reportCallbackError,
			);
		});
		const runLoop = Effect.gen(function* () {
			while (true) {
				const outcome = yield* runOnce.pipe(
					Effect.map((value) => ({ _tag: "success" as const, value })),
					Effect.catch((error) => Effect.succeed({ _tag: "failure" as const, error })),
				);
				if (outcome._tag === "success") {
					if (outcome.value === "closed") {
						yield* invokeStatus(reportCallbackError, handlers.onStatus, "closed");
					}
					return;
				}
				if (isUnauthorizedError(outcome.error)) {
					yield* invokeStatus(reportCallbackError, handlers.onStatus, "unauthorized");
					return;
				}
				yield* invokeStatus(reportCallbackError, handlers.onStatus, "reconnecting");
				const delayMs = nextReconnectDelay(reconnectDelayMs);
				reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
				yield* Effect.sleep(Duration.millis(delayMs));
			}
		});

		const fiber = forkTracked(runLoop);
		let closed = false;
		return {
			state: readState,
			close: () => {
				if (closed) return;
				closed = true;
				interruptFiber(fiber);
			},
		};
	};

	return {
		effect: apiClient,
		threads: {
			list: (query = {}) => run(apiClient.threads.list({ query })),
			create: (payload) => run(apiClient.threads.create({ payload })),
			get: (threadId) => run(apiClient.threads.get({ params: { threadId } })),
			update: (threadId, payload) => run(apiClient.threads.update({ params: { threadId }, payload })),
			archive: (threadId) => run(apiClient.threads.archive({ params: { threadId } })),
			unarchive: (threadId) => run(apiClient.threads.unarchive({ params: { threadId } })),
			remove: (threadId) => run(apiClient.threads.remove({ params: { threadId } })),
			navigate: (threadId, payload) =>
				run(apiClient.threads.navigate({ params: { threadId }, payload })),
			send: (threadId, payload) => run(apiClient.messages.send({ params: { threadId }, payload })),
			interrupt: (threadId, payload = {}) =>
				run(apiClient.messages.interrupt({ params: { threadId }, payload })),
			cancelQueued: (threadId, messageId) =>
				run(apiClient.messages.cancelQueued({ params: { threadId, messageId } })),
			answerQuestion: (threadId, questionId, payload) =>
				run(
					apiClient.interactions.answerQuestion({
						params: { threadId, questionId },
						payload,
					}),
				),
			implementPlan: (threadId, planId) =>
				run(apiClient.interactions.implementPlan({ params: { threadId, planId } })),
			attachmentUrl: (threadId, attachmentId) =>
				absoluteUrl(
					resolved.origin,
					`/core/v1/threads/${encodeURIComponent(String(threadId))}/attachments/${encodeURIComponent(String(attachmentId))}`,
				).toString(),
			watch: watchThread,
		},
		models: {
			catalog: () => run(apiClient.models.catalog()),
		},
		auth: {
			get: () => run(apiClient.auth.get()),
			login: (payload) =>
				payload.kind === "codex-oauth"
					? run(apiClient.auth.login({ payload }))
					: run(apiClient.auth.login({ payload })),
			logout: (payload) => run(apiClient.auth.logout({ payload })),
			cancelFlow: () => run(apiClient.auth.cancelFlow()),
		},
		sessions: {
			list: () => run(apiClient.sessions.list()),
			revoke: (sessionId) => run(apiClient.sessions.revoke({ params: { sessionId } })),
			pair: () => run(apiClient.sessions.pair()),
		},
		terminals: makeTerminalsSurface(apiClient, run, resolved.origin),
		workspace: {
			watch: watchWorkspace,
		},
		close: async () => {
			await Promise.all([...fibers].map((fiber) => runtime.runPromise(Fiber.interrupt(fiber))));
			await runtime.dispose();
		},
	};
};
