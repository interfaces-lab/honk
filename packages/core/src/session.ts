import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Layer, Option, Redacted } from "effect";
import {
	CurrentSession,
	SessionAuth,
	SessionId,
	UnauthorizedError,
	type PairingIssue,
	type Session,
	type SessionGrant,
} from "@honk/api/core/v1";
import type { CoreHome } from "./home";
import type { CoreStore, StoredSession } from "./store";

const CORE_APP_SESSION_ID = "session_core-app";
const CORE_APP_LABEL = "core app";
const SECRET_BYTES = 36;
const PAIRING_BYTES = 9;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const now = (): string => new Date().toISOString();

const randomBase64Url = (bytes: number): string => randomBytes(bytes).toString("base64url");

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const constantTimeEqual = (left: string, right: string): boolean => {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const isExpired = (expiresAt: string | null, at: number): boolean => {
	if (expiresAt === null) return false;
	const time = Date.parse(expiresAt);
	return Number.isNaN(time) || time <= at;
};

const storedToSession = (stored: StoredSession): Session => ({
	id: SessionId.make(stored.id),
	role: stored.role,
	label: stored.label,
	createdAt: stored.createdAt,
	expiresAt: stored.expiresAt,
	lastSeenAt: stored.lastSeenAt,
});

export interface Sessions {
	readonly secretPath: string;
	readonly publishSecret: () => void;
	readonly authenticate: (bearer: string) => Session | null;
	readonly isLive: (sessionId: string) => boolean;
	readonly issuePairing: () => PairingIssue;
	readonly exchange: (token: string) => SessionGrant | null;
	readonly list: () => Array<Session>;
	readonly revoke: (id: SessionId) => boolean;
}

export const makeSessions = (
	home: CoreHome,
	store: CoreStore,
	origin: () => string | null,
): Sessions => {
	const secretPath = join(home.coreDir, "core-app-secret");
	const coreAppSecret = randomBase64Url(SECRET_BYTES);
	const startedAt = now();

	const publishSecret = (): void => {
		mkdirSync(home.coreDir, { recursive: true });
		writeFileSync(secretPath, coreAppSecret, { encoding: "utf8", mode: 0o600 });
		chmodSync(secretPath, 0o600);
	};

	const isPublishedSecretCurrent = (): boolean => {
		try {
			return constantTimeEqual(readFileSync(secretPath, "utf8"), coreAppSecret);
		} catch {
			return false;
		}
	};

	const pendingPairings = new Map<string, PairingIssue>();

	const sweepPendingPairings = (at: number): void => {
		for (const [tokenHash, pairing] of pendingPairings) {
			if (isExpired(pairing.expiresAt, at)) pendingPairings.delete(tokenHash);
		}
	};

	const coreAppSession = (): Session => ({
		id: SessionId.make(CORE_APP_SESSION_ID),
		role: "core-app",
		label: CORE_APP_LABEL,
		createdAt: startedAt,
		expiresAt: null,
		lastSeenAt: null,
	});

	const authenticate = (bearer: string): Session | null => {
		if (constantTimeEqual(bearer, coreAppSecret)) return coreAppSession();
		const stored = store.getSessionByHash(sha256(bearer));
		if (Option.isNone(stored)) return null;
		const at = Date.now();
		if (isExpired(stored.value.expiresAt, at)) return null;
		const lastSeenAt = new Date(at).toISOString();
		store.touchSession(stored.value.id, lastSeenAt);
		return { ...storedToSession(stored.value), lastSeenAt };
	};

	const isLive = (sessionId: string): boolean => {
		if (sessionId === CORE_APP_SESSION_ID) return isPublishedSecretCurrent();
		const stored = store.getSessionById(sessionId);
		return Option.isSome(stored) && !isExpired(stored.value.expiresAt, Date.now());
	};

	const issuePairing = (): PairingIssue => {
		const at = Date.now();
		sweepPendingPairings(at);
		const token = randomBase64Url(PAIRING_BYTES);
		const expiresAt = new Date(at + PAIRING_TTL_MS).toISOString();
		const base = origin() ?? "http://127.0.0.1";
		const issue = { token, url: `${base}/#token=${token}`, expiresAt };
		pendingPairings.set(sha256(token), issue);
		return issue;
	};

	const exchange = (token: string): SessionGrant | null => {
		const at = Date.now();
		sweepPendingPairings(at);
		const presentedHash = sha256(token);
		let pairing: PairingIssue | null = null;
		let pairingHash: string | null = null;
		for (const [pendingHash, pending] of pendingPairings) {
			if (!constantTimeEqual(pendingHash, presentedHash)) continue;
			pairing = pending;
			pairingHash = pendingHash;
			break;
		}
		if (pairing === null || pairingHash === null) return null;
		pendingPairings.delete(pairingHash);
		if (isExpired(pairing.expiresAt, at)) return null;
		const bearer = randomBase64Url(SECRET_BYTES);
		const createdAt = now();
		const session: Session = {
			id: SessionId.make(`session_${randomUUID()}`),
			role: "web",
			label: null,
			createdAt,
			expiresAt: new Date(Date.now() + WEB_SESSION_TTL_MS).toISOString(),
			lastSeenAt: null,
		};
		store.insertSession({
			id: String(session.id),
			role: "web",
			label: session.label,
			tokenHash: sha256(bearer),
			createdAt: session.createdAt,
			expiresAt: session.expiresAt,
			lastSeenAt: session.lastSeenAt,
		});
		return { bearer, session };
	};

	const list = (): Array<Session> => {
		const at = Date.now();
		return store
			.listSessions()
			.filter((session) => !isExpired(session.expiresAt, at))
			.map(storedToSession);
	};

	const revoke = (id: SessionId): boolean => store.deleteSession(String(id));

	return { secretPath, publishSecret, authenticate, isLive, issuePairing, exchange, list, revoke };
};

export const makeSessionAuthLayer = (sessions: Sessions) =>
	Layer.succeed(SessionAuth, {
		bearer: (httpEffect, { credential }) =>
			Effect.gen(function* () {
				const session = sessions.authenticate(Redacted.value(credential));
				if (session === null) {
					return yield* Effect.fail(new UnauthorizedError());
				}
				return yield* Effect.provideService(httpEffect, CurrentSession, session);
			}),
	});
