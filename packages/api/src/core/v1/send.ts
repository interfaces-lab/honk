import { Schema } from "effect";
import { EntryId, MessageId, ThreadId, TurnId } from "./id";
import { NonNegativeInt, strictDecode, TrimmedNonEmptyString } from "./primitives";

export const SEND_MAX_INPUT_CHARS = 120_000;
export const SEND_MAX_ATTACHMENTS = 8;
export const SEND_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * What happens when input hits a busy thread (see CONTEXT.md): queue waits,
 * steer injects without stopping, interrupt stops the turn immediately and
 * starts a new one. On an idle thread a turn simply starts; on a busy thread
 * with `delivery` absent, the Core defaults to queue.
 */
export const Delivery = Schema.Literals(["queue", "steer", "interrupt"]);
export type Delivery = typeof Delivery.Type;

/**
 * Per-send, never pinned (plan→implement flips it mid-thread; see CONTEXT.md:
 * Interaction Mode — distinct from Mode). The Core owns each mode's meaning
 * (toolsets, prompt posture) and every Harness projects what it can honor
 * (ADR 0007's safety story, ADR 0015's projection rule). Absent = agent.
 */
export const InteractionMode = Schema.Literals(["agent", "ask", "plan", "debug", "multitask"]);
export type InteractionMode = typeof InteractionMode.Type;

/** Upload shape only — the projection always carries AttachmentRef, never inline data. */
export const ImageAttachmentUpload = Schema.Struct({
	name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
	mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
	sizeBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: SEND_MAX_IMAGE_BYTES })),
	dataUrl: Schema.String.check(Schema.isMaxLength(14_000_000)),
});
export type ImageAttachmentUpload = typeof ImageAttachmentUpload.Type;

/**
 * A send is admitted, not executed (ADR 0005). The Client mints `messageId`;
 * exact replay returns the same receipt, same id with a different payload is
 * a conflict. `replacesMessageId` + `parentEntryId` make an edit/resend a
 * sibling branch of the tree. `parentEntryId` is tri-state: absent = the
 * current leaf, null = the tree root, value = an explicit branch point.
 */
export const SendMessageInput = Schema.Struct({
	messageId: MessageId,
	text: Schema.String.check(Schema.isMaxLength(SEND_MAX_INPUT_CHARS)),
	attachments: Schema.optional(
		Schema.Array(ImageAttachmentUpload).check(Schema.isMaxLength(SEND_MAX_ATTACHMENTS)),
	),
	delivery: Schema.optional(Delivery),
	interactionMode: Schema.optional(InteractionMode),
	parentEntryId: Schema.optional(Schema.NullOr(EntryId)),
	replacesMessageId: Schema.optional(MessageId),
});
export type SendMessageInput = typeof SendMessageInput.Type;

export const Disposition = Schema.Literals(["started", "queued", "steered", "interrupted"]);
export type Disposition = typeof Disposition.Type;

/** "Recorded", not "executed": durable admission precedes any processing. */
export const AdmissionReceipt = Schema.Struct({
	threadId: ThreadId,
	messageId: MessageId,
	turnId: Schema.NullOr(TurnId),
	disposition: Disposition,
	seq: NonNegativeInt,
});
export type AdmissionReceipt = typeof AdmissionReceipt.Type;

export const decodeSendMessageInput = strictDecode(SendMessageInput);
export const decodeAdmissionReceipt = strictDecode(AdmissionReceipt);
