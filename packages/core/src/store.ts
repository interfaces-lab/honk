import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Option, Schema } from "effect";
import {
	type AdmissionReceipt,
	type Message,
	type Part,
	type QueuedMessage,
	type ThreadEntry,
	type ThreadStreamEvent,
	type ThreadSummary,
	type ThreadSummaryEvent,
	AdmissionReceipt as AdmissionReceiptSchema,
	Message as MessageSchema,
	Part as PartSchema,
	QueuedMessage as QueuedMessageSchema,
	ThreadEntry as ThreadEntrySchema,
	ThreadStreamEvent as ThreadStreamEventSchema,
	ThreadSummary as ThreadSummarySchema,
	ThreadSummaryEvent as ThreadSummaryEventSchema,
} from "@honk/api/core/v1";

const STORE_VERSION = "4";

const codec = <T, E>(schema: Schema.Codec<T, E, never, never>) => {
	const json = Schema.fromJsonString(schema);
	return {
		encode: Schema.encodeSync(json),
		decode: Schema.decodeUnknownOption(json),
	};
};

const summaryCodec = codec(ThreadSummarySchema);
const entryCodec = codec(ThreadEntrySchema);
const messageCodec = codec(MessageSchema);
const partCodec = codec(PartSchema);
const queuedCodec = codec(QueuedMessageSchema);
const threadEventCodec = codec(ThreadStreamEventSchema);
const workspaceEventCodec = codec(ThreadSummaryEventSchema);
const receiptCodec = codec(AdmissionReceiptSchema);

const decodeRows = <A>(
	rows: Array<unknown>,
	decode: (input: unknown) => Option.Option<A>,
	onCorrupt: (row: unknown) => void,
): Array<A> => {
	const out: Array<A> = [];
	for (const row of rows) {
		const data = (row as { data?: unknown }).data;
		const decoded = decode(data);
		if (Option.isSome(decoded)) out.push(decoded.value);
		else onCorrupt(row);
	}
	return out;
};

export interface StoredAttachment {
	readonly id: string;
	readonly threadId: string;
	readonly name: string;
	readonly mimeType: string;
	readonly sizeBytes: number;
	readonly path: string;
}

export interface StoredSession {
	readonly id: string;
	readonly role: "web";
	readonly label: string | null;
	readonly tokenHash: string;
	readonly createdAt: string;
	readonly expiresAt: string | null;
	readonly lastSeenAt: string | null;
}

/**
 * The Core's one durable store (ADR 0009): node:sqlite, WAL, busy timeout for
 * the CLI-plus-desktop contention case, one JSON row per domain object via
 * Schema.fromJsonString codecs. Decode is fail-closed per row — a corrupt or
 * drifted row is quarantined (counted + reported), never silently trusted and
 * never fatal to its neighbors. The store also mints every sequence number:
 * seq lives inside the event JSON and is assigned inside the same transaction
 * that persists it, so replay and live tails can never disagree.
 *
 * Harness continuity is Canonical-Record-private (never on the wire): each
 * thread carries one opaque harness session ref (pi: the JSONL path; Claude
 * in its round: the resume id), and harness_leaves records, per tree entry,
 * where the harness's own session tree ended up after that entry's turn — the
 * lookup that lets an edit/resend branch the harness session as a sibling.
 */
export class CoreStore {
	readonly #db: DatabaseSync;
	#quarantined = 0;

	constructor(dbPath: string) {
		mkdirSync(dirname(dbPath), { recursive: true });
		this.#db = new DatabaseSync(dbPath, { timeout: 5000 });
		this.#db.exec("PRAGMA journal_mode = WAL;");
		this.#db.exec("PRAGMA foreign_keys = ON;");
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS threads (
				id TEXT PRIMARY KEY, cwd TEXT NOT NULL, leaf_id TEXT,
				harness_session TEXT,
				archived INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
				create_hash TEXT NOT NULL, data TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS entries (
				thread_id TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL,
				data TEXT NOT NULL, PRIMARY KEY (thread_id, id)
			);
			CREATE TABLE IF NOT EXISTS messages (
				thread_id TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL,
				data TEXT NOT NULL, PRIMARY KEY (thread_id, id)
			);
			CREATE TABLE IF NOT EXISTS parts (
				thread_id TEXT NOT NULL, id TEXT NOT NULL, message_id TEXT NOT NULL,
				ordinal INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (thread_id, id)
			);
			CREATE TABLE IF NOT EXISTS queue (
				thread_id TEXT NOT NULL, message_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
				parent_explicit INTEGER NOT NULL DEFAULT 0, parent_entry_id TEXT,
				data TEXT NOT NULL, PRIMARY KEY (thread_id, message_id)
			);
			CREATE TABLE IF NOT EXISTS thread_events (
				thread_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL,
				PRIMARY KEY (thread_id, seq)
			);
			CREATE TABLE IF NOT EXISTS workspace_events (
				seq INTEGER PRIMARY KEY, data TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS admissions (
				thread_id TEXT NOT NULL, message_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
				receipt TEXT NOT NULL, PRIMARY KEY (thread_id, message_id)
			);
			CREATE TABLE IF NOT EXISTS attachments (
				thread_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
				mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, path TEXT NOT NULL,
				PRIMARY KEY (thread_id, id)
			);
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY, role TEXT NOT NULL, label TEXT,
				token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL,
				expires_at TEXT, last_seen_at TEXT
			);
			CREATE TABLE IF NOT EXISTS harness_leaves (
				thread_id TEXT NOT NULL, entry_id TEXT NOT NULL, leaf TEXT NOT NULL,
				PRIMARY KEY (thread_id, entry_id)
			);
		`);
		this.#db
			.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('store_version', ?)")
			.run(STORE_VERSION);
		const version = this.#db
			.prepare("SELECT value FROM meta WHERE key = 'store_version'")
			.get() as { value: string };
		if (version.value !== STORE_VERSION) {
			this.#db.close();
			throw new Error(
				`core store version mismatch: found ${version.value}, expected ${STORE_VERSION} (reset-only pre-1.0, ADR 0009)`,
			);
		}
	}

	get quarantinedRowCount(): number {
		return this.#quarantined;
	}

	#onCorrupt = (row: unknown): void => {
		this.#quarantined += 1;
		console.warn("[core.store] quarantined undecodable row", row);
	};

	transaction<A>(body: () => A): A {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const result = body();
			this.#db.exec("COMMIT");
			return result;
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	}

	insertThread(summary: ThreadSummary, cwd: string, createHash: string): void {
		this.#db
			.prepare(
				"INSERT INTO threads (id, cwd, leaf_id, harness_session, archived, updated_at, create_hash, data) VALUES (?, ?, NULL, NULL, 0, ?, ?, ?)",
			)
			.run(String(summary.id), cwd, summary.updatedAt, createHash, summaryCodec.encode(summary));
	}

	getThread(threadId: string): Option.Option<{
		summary: ThreadSummary;
		cwd: string;
		leafId: string | null;
		harnessSession: string | null;
		createHash: string;
	}> {
		const row = this.#db
			.prepare("SELECT cwd, leaf_id, harness_session, create_hash, data FROM threads WHERE id = ?")
			.get(threadId) as
			| { cwd: string; leaf_id: string | null; harness_session: string | null; create_hash: string; data: string }
			| undefined;
		if (row === undefined) return Option.none();
		const summary = summaryCodec.decode(row.data);
		if (Option.isNone(summary)) {
			this.#onCorrupt(row);
			return Option.none();
		}
		return Option.some({
			summary: summary.value,
			cwd: row.cwd,
			leafId: row.leaf_id,
			harnessSession: row.harness_session,
			createHash: row.create_hash,
		});
	}

	updateThread(summary: ThreadSummary, leafId: string | null): void {
		this.#db
			.prepare("UPDATE threads SET data = ?, archived = ?, updated_at = ?, leaf_id = ? WHERE id = ?")
			.run(
				summaryCodec.encode(summary),
				summary.archivedAt === null ? 0 : 1,
				summary.updatedAt,
				leafId,
				String(summary.id),
			);
	}

	/**
	 * Ref replacement does NOT invalidate recorded leaves (grill 2026-07-02,
	 * round 2): leaf validity is the harness's own business — pi guards stale
	 * leaves at open (getEntry + root fallback), and Claude leaves are
	 * self-contained `${sessionId}/${messageUuid}` composites that outlive ref
	 * changes because every branch fork mints a new session id.
	 */
	setThreadHarnessSession(threadId: string, ref: string): void {
		this.#db.prepare("UPDATE threads SET harness_session = ? WHERE id = ?").run(ref, threadId);
	}

	putHarnessLeaf(threadId: string, entryId: string, leaf: string): void {
		this.#db
			.prepare(
				"INSERT INTO harness_leaves (thread_id, entry_id, leaf) VALUES (?, ?, ?) ON CONFLICT (thread_id, entry_id) DO UPDATE SET leaf = excluded.leaf",
			)
			.run(threadId, entryId, leaf);
	}

	getHarnessLeaf(threadId: string, entryId: string): string | null {
		const row = this.#db
			.prepare("SELECT leaf FROM harness_leaves WHERE thread_id = ? AND entry_id = ?")
			.get(threadId, entryId) as { leaf: string } | undefined;
		return row === undefined ? null : row.leaf;
	}

	deleteThread(threadId: string): void {
		for (const table of ["threads", "entries", "messages", "parts", "queue", "thread_events", "admissions", "attachments", "harness_leaves"]) {
			this.#db.prepare(`DELETE FROM ${table} WHERE ${table === "threads" ? "id" : "thread_id"} = ?`).run(threadId);
		}
	}

	listThreads(archived: boolean): Array<ThreadSummary> {
		const rows = this.#db
			.prepare("SELECT data FROM threads WHERE archived = ? ORDER BY updated_at DESC, id ASC")
			.all(archived ? 1 : 0) as Array<unknown>;
		return decodeRows(rows, summaryCodec.decode, this.#onCorrupt);
	}

	appendEntry(threadId: string, entry: ThreadEntry): void {
		this.#db
			.prepare(
				"INSERT INTO entries (thread_id, id, ordinal, data) VALUES (?, ?, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM entries WHERE thread_id = ?), ?)",
			)
			.run(threadId, String(entry.id), threadId, entryCodec.encode(entry));
	}

	listEntries(threadId: string): Array<ThreadEntry> {
		const rows = this.#db
			.prepare("SELECT data FROM entries WHERE thread_id = ? ORDER BY ordinal ASC")
			.all(threadId) as Array<unknown>;
		return decodeRows(rows, entryCodec.decode, this.#onCorrupt);
	}

	upsertMessage(threadId: string, message: Message): void {
		this.#db
			.prepare(
				"INSERT INTO messages (thread_id, id, ordinal, data) VALUES (?, ?, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM messages WHERE thread_id = ?), ?) ON CONFLICT (thread_id, id) DO UPDATE SET data = excluded.data",
			)
			.run(threadId, String(message.id), threadId, messageCodec.encode(message));
	}

	listMessages(threadId: string): Array<Message> {
		const rows = this.#db
			.prepare("SELECT data FROM messages WHERE thread_id = ? ORDER BY ordinal ASC")
			.all(threadId) as Array<unknown>;
		return decodeRows(rows, messageCodec.decode, this.#onCorrupt);
	}

	upsertPart(threadId: string, part: Part): void {
		this.#db
			.prepare(
				"INSERT INTO parts (thread_id, id, message_id, ordinal, data) VALUES (?, ?, ?, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM parts WHERE thread_id = ?), ?) ON CONFLICT (thread_id, id) DO UPDATE SET data = excluded.data",
			)
			.run(threadId, String(part.id), String(part.messageId), threadId, partCodec.encode(part));
	}

	getPart(threadId: string, partId: string): Option.Option<Part> {
		const row = this.#db
			.prepare("SELECT data FROM parts WHERE thread_id = ? AND id = ?")
			.get(threadId, partId) as { data: string } | undefined;
		if (row === undefined) return Option.none();
		const part = partCodec.decode(row.data);
		if (Option.isNone(part)) this.#onCorrupt(row);
		return part;
	}

	listParts(threadId: string): Array<Part> {
		const rows = this.#db
			.prepare("SELECT data FROM parts WHERE thread_id = ? ORDER BY ordinal ASC")
			.all(threadId) as Array<unknown>;
		return decodeRows(rows, partCodec.decode, this.#onCorrupt);
	}

	/**
	 * `parent` mirrors SendMessageInput.parentEntryId's tri-state (Canonical-
	 * Record-private, never in the wire QueuedMessage): explicit=false follows
	 * the then-current leaf at promotion; explicit=true pins the branch point
	 * (null = the tree root) — an edit/resend admitted while busy must still
	 * branch, not append.
	 */
	putQueued(
		threadId: string,
		item: QueuedMessage,
		parent: { explicit: boolean; entryId: string | null },
	): void {
		this.#db
			.prepare(
				"INSERT INTO queue (thread_id, message_id, ordinal, parent_explicit, parent_entry_id, data) VALUES (?, ?, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM queue WHERE thread_id = ?), ?, ?, ?)",
			)
			.run(
				threadId,
				String(item.messageId),
				threadId,
				parent.explicit ? 1 : 0,
				parent.entryId,
				queuedCodec.encode(item),
			);
	}

	/** Decode BEFORE delete: a corrupt queue row is quarantined in place, never destroyed unread. */
	removeQueued(threadId: string, messageId: string): Option.Option<QueuedMessage> {
		const row = this.#db
			.prepare("SELECT data FROM queue WHERE thread_id = ? AND message_id = ?")
			.get(threadId, messageId) as { data: string } | undefined;
		if (row === undefined) return Option.none();
		const item = queuedCodec.decode(row.data);
		if (Option.isNone(item)) {
			this.#onCorrupt(row);
			return item;
		}
		this.#db.prepare("DELETE FROM queue WHERE thread_id = ? AND message_id = ?").run(threadId, messageId);
		return item;
	}

	deleteMessage(threadId: string, messageId: string): void {
		this.#db.prepare("DELETE FROM messages WHERE thread_id = ? AND id = ?").run(threadId, messageId);
	}

	/** MUST be called inside transaction(): the dequeue and the promotion it feeds are one atomic unit (a crash between them loses the message). */
	shiftQueued(
		threadId: string,
	): Option.Option<{ item: QueuedMessage; parent: { explicit: boolean; entryId: string | null } }> {
		const row = this.#db
			.prepare(
				"SELECT message_id, parent_explicit, parent_entry_id, data FROM queue WHERE thread_id = ? ORDER BY ordinal ASC LIMIT 1",
			)
			.get(threadId) as
			| { message_id: string; parent_explicit: number; parent_entry_id: string | null; data: string }
			| undefined;
		if (row === undefined) return Option.none();
		const item = queuedCodec.decode(row.data);
		this.#db
			.prepare("DELETE FROM queue WHERE thread_id = ? AND message_id = ?")
			.run(threadId, row.message_id);
		if (Option.isNone(item)) {
			this.#onCorrupt(row);
			return Option.none();
		}
		return Option.some({
			item: item.value,
			parent: { explicit: row.parent_explicit === 1, entryId: row.parent_entry_id },
		});
	}

	queuedCount(threadId: string): number {
		const row = this.#db
			.prepare("SELECT COUNT(*) AS n FROM queue WHERE thread_id = ?")
			.get(threadId) as { n: number };
		return row.n;
	}

	/** Boot-recovery scan: threads whose durable summary says a turn is running (ADR 0005 sweep). */
	listRunningThreads(): Array<ThreadSummary> {
		const rows = this.#db.prepare("SELECT data FROM threads").all() as Array<unknown>;
		return decodeRows(rows, summaryCodec.decode, this.#onCorrupt).filter(
			(summary) => summary.status === "running",
		);
	}

	/** The turnId of the newest turn.started without a matching turn.settled, if any. */
	lastUnsettledTurnId(threadId: string): string | null {
		const row = this.#db
			.prepare(
				"SELECT data FROM thread_events WHERE thread_id = ? AND json_extract(data, '$._tag') IN ('turn.started', 'turn.settled') ORDER BY seq DESC LIMIT 1",
			)
			.get(threadId) as { data: string } | undefined;
		if (row === undefined) return null;
		try {
			const parsed = JSON.parse(row.data) as { _tag?: string; turnId?: string };
			return parsed._tag === "turn.started" && typeof parsed.turnId === "string"
				? parsed.turnId
				: null;
		} catch {
			return null;
		}
	}

	listQueued(threadId: string): Array<QueuedMessage> {
		const rows = this.#db
			.prepare("SELECT data FROM queue WHERE thread_id = ? ORDER BY ordinal ASC")
			.all(threadId) as Array<unknown>;
		return decodeRows(rows, queuedCodec.decode, this.#onCorrupt);
	}

	/** Mints the thread seq and persists the encoded event in one statement pair (call inside a transaction). */
	appendThreadEvent(threadId: string, build: (seq: number) => ThreadStreamEvent): { seq: number; encoded: string } {
		const row = this.#db
			.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM thread_events WHERE thread_id = ?")
			.get(threadId) as { seq: number };
		const event = build(row.seq);
		const encoded = threadEventCodec.encode(event);
		this.#db
			.prepare("INSERT INTO thread_events (thread_id, seq, data) VALUES (?, ?, ?)")
			.run(threadId, row.seq, encoded);
		return { seq: row.seq, encoded };
	}

	listThreadEvents(threadId: string, afterSeq: number): Array<{ seq: number; encoded: string }> {
		const rows = this.#db
			.prepare("SELECT seq, data FROM thread_events WHERE thread_id = ? AND seq > ? ORDER BY seq ASC")
			.all(threadId, afterSeq) as Array<{ seq: number; data: string }>;
		return rows.map((row) => ({ seq: row.seq, encoded: row.data }));
	}

	threadEventHighWater(threadId: string): number {
		const row = this.#db
			.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM thread_events WHERE thread_id = ?")
			.get(threadId) as { seq: number };
		return row.seq;
	}

	appendWorkspaceEvent(build: (seq: number) => ThreadSummaryEvent): { seq: number; encoded: string } {
		const row = this.#db
			.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM workspace_events")
			.get() as { seq: number };
		const event = build(row.seq);
		const encoded = workspaceEventCodec.encode(event);
		this.#db.prepare("INSERT INTO workspace_events (seq, data) VALUES (?, ?)").run(row.seq, encoded);
		return { seq: row.seq, encoded };
	}

	listWorkspaceEvents(afterSeq: number): Array<{ seq: number; encoded: string }> {
		const rows = this.#db
			.prepare("SELECT seq, data FROM workspace_events WHERE seq > ? ORDER BY seq ASC")
			.all(afterSeq) as Array<{ seq: number; data: string }>;
		return rows.map((row) => ({ seq: row.seq, encoded: row.data }));
	}

	workspaceEventHighWater(): number {
		const row = this.#db
			.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM workspace_events")
			.get() as { seq: number };
		return row.seq;
	}

	getAdmission(threadId: string, messageId: string): Option.Option<{ payloadHash: string; receipt: AdmissionReceipt }> {
		const row = this.#db
			.prepare("SELECT payload_hash, receipt FROM admissions WHERE thread_id = ? AND message_id = ?")
			.get(threadId, messageId) as { payload_hash: string; receipt: string } | undefined;
		if (row === undefined) return Option.none();
		const receipt = receiptCodec.decode(row.receipt);
		if (Option.isNone(receipt)) {
			this.#onCorrupt(row);
			return Option.none();
		}
		return Option.some({ payloadHash: row.payload_hash, receipt: receipt.value });
	}

	putAdmission(threadId: string, messageId: string, payloadHash: string, receipt: AdmissionReceipt): void {
		this.#db
			.prepare("INSERT INTO admissions (thread_id, message_id, payload_hash, receipt) VALUES (?, ?, ?, ?)")
			.run(threadId, messageId, payloadHash, receiptCodec.encode(receipt));
	}

	putAttachment(attachment: StoredAttachment): void {
		this.#db
			.prepare(
				"INSERT INTO attachments (thread_id, id, name, mime_type, size_bytes, path) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(
				attachment.threadId,
				attachment.id,
				attachment.name,
				attachment.mimeType,
				attachment.sizeBytes,
				attachment.path,
			);
	}

	getAttachment(threadId: string, attachmentId: string): Option.Option<StoredAttachment> {
		const row = this.#db
			.prepare("SELECT name, mime_type, size_bytes, path FROM attachments WHERE thread_id = ? AND id = ?")
			.get(threadId, attachmentId) as
			| { name: string; mime_type: string; size_bytes: number; path: string }
			| undefined;
		if (row === undefined) return Option.none();
		return Option.some({
			id: attachmentId,
			threadId,
			name: row.name,
			mimeType: row.mime_type,
			sizeBytes: row.size_bytes,
			path: row.path,
		});
	}

	insertSession(session: StoredSession): void {
		this.#db
			.prepare(
				"INSERT INTO sessions (id, role, label, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				session.id,
				session.role,
				session.label,
				session.tokenHash,
				session.createdAt,
				session.expiresAt,
				session.lastSeenAt,
			);
	}

	getSessionByHash(tokenHash: string): Option.Option<StoredSession> {
		const row = this.#db
			.prepare(
				"SELECT id, role, label, token_hash AS tokenHash, created_at AS createdAt, expires_at AS expiresAt, last_seen_at AS lastSeenAt FROM sessions WHERE token_hash = ?",
			)
			.get(tokenHash) as StoredSession | undefined;
		return row === undefined ? Option.none() : Option.some(row);
	}

	getSessionById(sessionId: string): Option.Option<StoredSession> {
		const row = this.#db
			.prepare(
				"SELECT id, role, label, token_hash AS tokenHash, created_at AS createdAt, expires_at AS expiresAt, last_seen_at AS lastSeenAt FROM sessions WHERE id = ?",
			)
			.get(sessionId) as StoredSession | undefined;
		return row === undefined ? Option.none() : Option.some(row);
	}

	listSessions(): Array<StoredSession> {
		return this.#db
			.prepare(
				"SELECT id, role, label, token_hash AS tokenHash, created_at AS createdAt, expires_at AS expiresAt, last_seen_at AS lastSeenAt FROM sessions ORDER BY created_at DESC",
			)
			.all() as unknown as Array<StoredSession>;
	}

	deleteSession(sessionId: string): boolean {
		const result = this.#db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
		return typeof result.changes === "bigint" ? result.changes !== 0n : result.changes !== 0;
	}

	touchSession(sessionId: string, lastSeenAt: string): void {
		this.#db
			.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
			.run(lastSeenAt, sessionId);
	}

	setSessionExpiresAt(sessionId: string, expiresAt: string | null): void {
		this.#db
			.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
			.run(expiresAt, sessionId);
	}

	close(): void {
		this.#db.close();
	}
}
