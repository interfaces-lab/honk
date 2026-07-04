import type { Effect, Queue } from "effect";
import type {
	InteractionMode,
	MessageId,
	ModelId,
	Part,
	PartId,
	QuestionId,
	ThinkingLevel,
	ThreadCapabilities,
	ThreadId,
	TurnId,
	UnknownRecord,
} from "@honk/api/core/v1";

/**
 * An image entering the model context. The Core loads the bytes from its
 * attachment store and hands them over decoded — a Harness never reads the
 * attachment directory or resolves AttachmentRef urls.
 */
export interface PromptImage {
	readonly mimeType: string;
	readonly base64: string;
}

/** One Steered delivery: the injected text plus any images it carried (CONTEXT.md: Steer). */
export interface SteeredInput {
	readonly text: string;
	readonly images: ReadonlyArray<PromptImage>;
}

/** One line of the active-path conversation — the Canonical-Record rebuild source. */
export interface TranscriptEntry {
	readonly role: "user" | "assistant" | "tool";
	readonly text: string;
}

/**
 * What a Harness may do while running one turn. Every mutation goes through
 * these callbacks so the Core owns durability and fan-out; the Harness never
 * touches the store or the buses directly.
 *
 * The callback set is dictated by the three harness event models (mapping
 * reports, harness round): text/reasoning stream as deltas; tool lifecycle is
 * state TRANSITIONS (pi tool_execution_*, Claude tool_use→tool_result, Cursor
 * tool_call_update), hence updatePart; and questions suspend the turn until a
 * client answers (Cursor's ask_question is a blocking JSON-RPC request,
 * Claude's elicitation the same shape) — the legacy adapters auto-answered
 * these empty, which the rewrite refuses to repeat.
 */
export interface TurnContext {
	readonly threadId: ThreadId;
	readonly turnId: TurnId;
	readonly assistantMessageId: MessageId;
	readonly userText: string;
	/** Image attachments on the user message, in send order (grill 2026-07-02: images reach the model; other files do not). */
	readonly images: ReadonlyArray<PromptImage>;
	/** The Thread's working directory — project-local resource discovery roots here, never in HONK_HOME. */
	readonly cwd: string;
	/** Pinned at creation and already catalog-validated at threads.create (ADR 0014/0016). */
	readonly model: ModelId;
	readonly thinkingLevel: ThinkingLevel;
	/** The mode this turn was sent under (per-send, CONTEXT.md: Interaction Mode); the adapter projects its toolset/prompt posture. */
	readonly interactionMode: InteractionMode;
	/**
	 * Steered input as an awaitable mailbox (grill 2026-07-02): Queue.take
	 * blocks until the next delivery — the pi adapter forks a delivery fiber
	 * that dies with the turn — and Queue.clear drains without blocking.
	 * Taking an item IS consuming it; whatever is still queued at settlement
	 * becomes the Core's leftover follow-up turn.
	 */
	readonly steered: Queue.Dequeue<SteeredInput>;
	/**
	 * The Harness's opaque session ref for this Thread — pi: the JSONL path
	 * under HONK_HOME/harness/pi; Claude (its round): the resume id. Null
	 * before the first turn ever runs. Setting a DIFFERENT ref means the
	 * harness rebuilt its session (stale/corrupt state): the Core drops every
	 * recorded leaf with the replaced session.
	 */
	readonly sessionRef: string | null;
	readonly setSessionRef: (ref: string) => Effect.Effect<void>;
	/**
	 * The harness leaf recorded at the nearest mapped ancestor of this turn's
	 * branch point — how an edit/resend becomes a SIBLING branch inside the
	 * harness's own session tree instead of an appended follow-up. Null with a
	 * live sessionRef means the branch point precedes every mapped entry
	 * (re-edit of the first message): the adapter restarts from the session
	 * root (pi: resetLeaf).
	 */
	readonly resumeLeaf: string | null;
	/** Records where the harness's session tree ended up, against this turn's entry — the next branch resumes here. */
	readonly setTurnLeaf: (leaf: string) => Effect.Effect<void>;
	/**
	 * The active-path conversation up to this turn's branch point, oldest
	 * first — the Canonical Record projected for engines that can neither
	 * branch nor restore (ACP): they rebuild context from this, the universal
	 * fallback. Lazy so only rebuild paths pay for it.
	 */
	readonly transcript: () => Effect.Effect<ReadonlyArray<TranscriptEntry>>;
	readonly createPart: (part: Part) => Effect.Effect<void>;
	readonly appendDelta: (
		partId: PartId,
		field: "text" | "output" | "markdown",
		delta: string,
	) => Effect.Effect<void>;
	/** Replaces the part wholesale and emits part.updated — tool state transitions, plan status, step usage. */
	readonly updatePart: (part: Part) => Effect.Effect<void>;
	readonly completePart: (partId: PartId) => Effect.Effect<void>;
	/**
	 * Suspends until a client answers the pending question Part with this id
	 * (interactions.answerQuestion). Fiber interruption (the turn being
	 * interrupted) propagates — an unanswered question dies with its turn.
	 */
	readonly awaitAnswer: (questionId: QuestionId) => Effect.Effect<UnknownRecord>;
	readonly newPartId: () => PartId;
}

/**
 * The Harness seam (ADR 0006): pi, Claude Code, and Cursor plug in here in
 * the harness rounds, keyed by Provider in the Core's harness map (ADR 0016:
 * each Provider executes through exactly one Harness — the map key IS the
 * identity, so the seam carries no origin field; adapters stamp PartOrigin
 * on the Parts they create). Interruption arrives as fiber interruption —
 * the adapter translates it into its engine's abort and must not swallow it;
 * settlement is owned by the Core's turn runner, never by the Harness.
 */
export interface Harness {
	/**
	 * What this engine can honor (ADR 0015: per-thread data, stable for the
	 * thread's life). steer: false (Claude — the SDK only queues further
	 * input; Cursor — ACP has no mid-turn injection) downgrades a Steer send
	 * to queue at admission, and the AdmissionReceipt's disposition says so.
	 */
	readonly capabilities: ThreadCapabilities;
	readonly runTurn: (ctx: TurnContext) => Effect.Effect<void>;
}
