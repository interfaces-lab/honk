import { Effect, Fiber } from "effect";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import {
	type AuthSnapshot,
	type CredentialKind,
	type CredentialStatus,
	type HarnessId,
	type HarnessStatus,
	type LoginFlow,
	type LoginInput,
	type ProviderId,
	LoginFlowConflictError,
} from "@honk/api/core/v1";
import type { CoreHome } from "./home";

/**
 * An async availability check a Harness supplies at wiring (claude-code: the
 * SDK accountInfo surface, ADR 0016/0018; cursor: its round). It must never
 * reject — failure IS an unavailable row.
 */
export type HarnessProbe = () => Promise<HarnessStatus>;

const now = (): string => new Date().toISOString();

/**
 * kind → provider key in the secret store. The store IS pi's auth.json
 * format at HONK_HOME/core/auth.json (0600 + proper-lockfile, both pi's):
 * because pi runs in-process (ADR 0006), the Core and the pi Harness share
 * this one AuthStorage instance, so pi's OAuth auto-refresh writes through
 * the same object and nothing can drift — ADR 0009's "absorbs pi's
 * auth.json" made literal. The cursor key rides the same file under a
 * provider key pi never queries.
 */
const PROVIDER_KEY: Record<CredentialKind, string> = {
	"codex-oauth": "openai-codex",
	"cursor-api-key": "cursor",
};

/** pi's exported OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD — the only flow the Core runs (grill decision: uniform across desktop and remote serve). */
const DEVICE_CODE_METHOD = "device_code";

/** Probes spawn subprocesses (the claude-code one runs an SDK query) — revalidate sparingly. */
const PROBE_TTL_MS = 300_000;

export interface CoreAuth {
	/**
	 * THE AuthStorage instance (ADR 0006/0009): the pi Harness is constructed
	 * over this same object, so pi's OAuth auto-refresh writes through it and
	 * credential state can never drift between the auth domain and the runner.
	 */
	readonly storage: AuthStorage;
	readonly snapshot: () => Effect.Effect<AuthSnapshot>;
	readonly login: (input: LoginInput) => Effect.Effect<AuthSnapshot, LoginFlowConflictError>;
	readonly logout: (kind: CredentialKind) => Effect.Effect<AuthSnapshot>;
	readonly cancelFlow: () => Effect.Effect<AuthSnapshot>;
	/** Per-provider availability for the catalog — sync, reads the same state snapshot() serves. */
	readonly availability: () => Record<ProviderId, boolean>;
	readonly dispose: () => Effect.Effect<void>;
}

/**
 * The auth domain (ADR 0016). Everything is fetch-only: snapshot() is the
 * single read, mutations return the next snapshot, and nothing is pushed —
 * a stale picker discovers reality at threads.create. Anthropic never
 * appears in the credential rows; its whole auth surface is the claude-code
 * harness probe.
 */
export const makeAuth = (
	home: CoreHome,
	probes: Partial<Record<HarnessId, HarnessProbe>> = {},
): CoreAuth => {
	const storage = AuthStorage.create(home.authPath);
	const bootAt = now();
	const updatedAt: Record<CredentialKind, string> = {
		"codex-oauth": bootAt,
		"cursor-api-key": bootAt,
	};
	const annotateCredentialKind = <A, E, R>(
		effect: Effect.Effect<A, E, R>,
		kind: CredentialKind,
	): Effect.Effect<A, E, R> => Effect.annotateLogs(effect, { credentialKind: kind });

	/**
	 * At most one flow is current, and `flowAbort` doubles as its generation
	 * token: every mutation a flow attempt makes is guarded by identity with
	 * the controller it was started under, so a cancelled attempt settling
	 * late can never clobber the flow that superseded it. `flowRecords`
	 * tracks every still-settling attempt (not just the current one) so
	 * dispose interrupts them all — the core.ts TurnRecord pattern.
	 */
	let flow: LoginFlow | null = null;
	let flowAbort: AbortController | null = null;
	const flowRecords = new Set<{ fiber: Fiber.Fiber<void, never> | null }>();

	/**
	 * The v1 probe: pi is in-process (always live); Claude Code and Cursor
	 * report unavailable until the harness round supplies real probes (the
	 * Claude one is Anthropic's auth surface — SDK accountInfo with a derived
	 * label, the t3code pattern). The boot rows ARE the boot probe (grill
	 * decision: probe at boot, serve cached) — a real async probe replaces
	 * both sites in the harness round.
	 */
	const bootRows: ReadonlyArray<HarnessStatus> = [
		{ harness: "pi", available: true, detail: null },
		{ harness: "claude-code", available: false, detail: null },
		{ harness: "cursor", available: false, detail: null },
	];
	/** pi is in-process and always alive; the others are whatever their supplied probe reports (absent probe = the boot row: unavailable). */
	const probeHarnesses = (): Promise<Array<HarnessStatus>> =>
		Promise.all(
			bootRows.map(async (row) => {
				const probe = probes[row.harness];
				if (probe === undefined) return row;
				try {
					return await probe();
				} catch {
					return { harness: row.harness, available: false, detail: null };
				}
			}),
		);

	let harnesses = bootRows;
	// Zero, not now(): the boot rows are placeholders, so the FIRST read must
	// fork the real probe instead of serving them for a whole TTL.
	let probedAt = 0;
	let probing = false;

	/**
	 * Stale-while-revalidate (grill decision): reads serve the cached rows
	 * instantly and fork a re-probe when older than the TTL, so external
	 * logins (Claude Code's, notably) surface on the next read — still
	 * fetch-only, never slow, no push. Uninterruptible because it runs on
	 * request fibers: an interrupt between the latch and the fork would leave
	 * `probing` stuck true and disable re-probes for the process lifetime.
	 */
	const revalidateIfStale = (): Effect.Effect<void> =>
		Effect.uninterruptible(
			Effect.gen(function* () {
				if (probing || Date.now() - probedAt < PROBE_TTL_MS) return;
				probing = true;
				yield* Effect.forkDetach(
					Effect.promise(probeHarnesses).pipe(
						Effect.flatMap((rows) =>
							Effect.sync(() => {
								harnesses = rows;
								probedAt = Date.now();
							}),
						),
						Effect.ensuring(
							Effect.sync(() => {
								probing = false;
							}),
						),
					),
				);
			}),
		);

	/** pi persists lazily and swallows write failures; drain and log them so a dead disk is at least visible (fail-loud logging, opencode's lesson). */
	const drainStoreErrors = (): Effect.Effect<void> =>
		Effect.gen(function* () {
			for (const error of storage.drainErrors()) {
				yield* Effect.logWarning("auth store persistence failed", error);
			}
		});

	/**
	 * "available" means stored, not verified (grill decision: keys are never
	 * validated at login — truth emerges at use). "expired"/"error" become
	 * real when observed harness failures wire in; pi auto-refreshes OAuth on
	 * use, so a stored token counts as available even past its expiry stamp.
	 */
	const credentialRow = (kind: CredentialKind): CredentialStatus => {
		const credential = storage.get(PROVIDER_KEY[kind]);
		const accountId = credential?.type === "oauth" ? credential["accountId"] : undefined;
		return {
			kind,
			state: credential === undefined ? "missing" : "available",
			label: typeof accountId === "string" && accountId.trim() !== "" ? accountId : null,
			message: null,
			updatedAt: updatedAt[kind],
		};
	};

	const snapshot = Effect.fn("CoreAuth.snapshot")(function* () {
			yield* revalidateIfStale();
			return {
				credentials: [credentialRow("codex-oauth"), credentialRow("cursor-api-key")],
				harnesses,
				flow,
			};
		});

	const startCodexFlow = (): Effect.Effect<void> =>
		Effect.gen(function* () {
			const abort = new AbortController();
			flowAbort = abort;
			flow = {
				kind: "codex-oauth",
				state: "pending",
				message: null,
				verificationUri: null,
				userCode: null,
				updatedAt: now(),
			};
			// Identity with the controller this attempt started under — a
			// superseded attempt must never touch newer flow state.
			const current = () => flowAbort === abort;
			const record: { fiber: Fiber.Fiber<void, never> | null } = { fiber: null };
			flowRecords.add(record);
			const attempt = Effect.tryPromise({
				try: () =>
					storage.login("openai-codex", {
						onSelect: () => Promise.resolve(DEVICE_CODE_METHOD),
						onDeviceCode: (info) => {
							if (!current()) return;
							flow = {
								kind: "codex-oauth",
								state: "pending",
								message: null,
								verificationUri: info.verificationUri,
								userCode: info.userCode,
								updatedAt: now(),
							};
						},
						// Device-code never reaches these; failing loud beats hanging silent.
						onAuth: () => {},
						onPrompt: () => Promise.reject(new Error("device-code login never prompts")),
						signal: abort.signal,
					}),
				catch: (error) => (error instanceof Error ? error : new Error(String(error))),
			}).pipe(
				Effect.flatMap(() =>
					Effect.sync(() => {
						// storage.login persisted the credential — that part is true even
						// for a superseded attempt the user completed anyway.
						updatedAt["codex-oauth"] = now();
						if (!current()) return;
						flow = null;
						flowAbort = null;
					}),
				),
				Effect.catch((error) =>
					Effect.sync(() => {
						if (!current()) return;
						flow = {
							kind: "codex-oauth",
							state: "error",
							message: error.message,
							verificationUri: null,
							userCode: null,
							updatedAt: now(),
						};
						// The flow settled; a new login may start over the error state.
						flowAbort = null;
					}),
				),
				Effect.flatMap(() => drainStoreErrors()),
				Effect.ensuring(
					Effect.sync(() => {
						flowRecords.delete(record);
					}),
				),
			);
			record.fiber = yield* Effect.forkDetach(attempt);
		});

	return {
		storage,
		snapshot,

		login: Effect.fn("CoreAuth.login")(
			function* (input: LoginInput) {
				if (input.kind === "cursor-api-key") {
					// Stored as-is, never validated: a dead key costs exactly one
					// typed rejection where everything else does (reject-on-use).
					storage.set(PROVIDER_KEY["cursor-api-key"], { type: "api_key", key: input.apiKey });
					updatedAt["cursor-api-key"] = now();
					yield* drainStoreErrors();
					return yield* snapshot();
				}
				if (flow !== null && flow.state === "pending") {
					return yield* Effect.fail(new LoginFlowConflictError({ kind: "codex-oauth" }));
				}
				yield* startCodexFlow();
				return yield* snapshot();
			},
			(effect, input) => annotateCredentialKind(effect, input.kind),
		),

		logout: Effect.fn("CoreAuth.logout")(
			function* (kind: CredentialKind) {
				storage.logout(PROVIDER_KEY[kind]);
				updatedAt[kind] = now();
				yield* drainStoreErrors();
				return yield* snapshot();
			},
			annotateCredentialKind,
		),

		cancelFlow: Effect.fn("CoreAuth.cancelFlow")(function* () {
				// User-initiated: clears, never an error state — and idempotent.
				// Nulling flowAbort supersedes the settling attempt (its guard fails).
				flowAbort?.abort();
				flowAbort = null;
				flow = null;
				return yield* snapshot();
			}),

		availability: () => ({
			anthropic: harnesses.some((status) => status.harness === "claude-code" && status.available),
			"openai-codex": storage.has(PROVIDER_KEY["codex-oauth"]),
			cursor: storage.has(PROVIDER_KEY["cursor-api-key"]),
		}),

		dispose: () =>
			Effect.gen(function* () {
				flowAbort?.abort();
				flowAbort = null;
				flow = null;
				const records = [...flowRecords];
				flowRecords.clear();
				for (const record of records) {
					if (record.fiber !== null) yield* Fiber.interrupt(record.fiber);
				}
			}),
	};
};
