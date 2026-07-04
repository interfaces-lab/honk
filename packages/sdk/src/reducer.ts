import type {
	EntryId,
	Message,
	Part,
	QueuedMessage,
	ThreadDetail,
	ThreadEntry,
	ThreadStreamEvent,
	ThreadSummary,
	ThreadSummaryEvent,
	TurnId,
	TurnSettledState,
} from "@honk/api/core/v1";

export interface ThreadState {
	readonly summary: ThreadSummary;
	readonly cwd: string;
	readonly capabilities: ThreadDetail["capabilities"];
	readonly entries: Array<ThreadEntry>;
	readonly leafId: EntryId | null;
	readonly messages: Array<Message>;
	readonly parts: Array<Part>;
	readonly allMessages: Array<Message>;
	readonly allParts: Array<Part>;
	readonly queue: Array<QueuedMessage>;
	readonly seq: number;
	readonly activeTurn: TurnId | null;
	readonly lastSettled: {
		readonly turnId: TurnId;
		readonly state: TurnSettledState;
		readonly error?: string;
	} | null;
}

export interface WorkspaceState {
	readonly threads: Array<ThreadSummary>;
	readonly seq: number;
}

const idKey = (value: unknown): string => String(value);

const upsertById = <Item extends { readonly id: unknown }>(
	items: ReadonlyArray<Item>,
	item: Item,
): Array<Item> => {
	const index = items.findIndex((existing) => idKey(existing.id) === idKey(item.id));
	if (index === -1) return [...items, item];
	return items.map((existing, current) => (current === index ? item : existing));
};

const removeById = <Item extends { readonly id: unknown }>(
	items: ReadonlyArray<Item>,
	id: unknown,
): Array<Item> => items.filter((item) => idKey(item.id) !== idKey(id));

const sortThreads = (threads: ReadonlyArray<ThreadSummary>): Array<ThreadSummary> =>
	[...threads].sort((left, right) => {
		const updated = right.updatedAt.localeCompare(left.updatedAt);
		return updated === 0 ? String(left.id).localeCompare(String(right.id)) : updated;
	});

const foldDelta = (
	part: Part,
	field: "text" | "output" | "markdown",
	delta: string,
): Part | null => {
	if (field === "text" && (part._tag === "text" || part._tag === "reasoning")) {
		return { ...part, text: part.text + delta };
	}
	if (field === "markdown" && part._tag === "plan") {
		return { ...part, markdown: part.markdown + delta };
	}
	if (field === "output" && part._tag === "tool") {
		const display = part.display;
		if (display._tag === "raw") {
			return { ...part, display: { ...display, text: display.text + delta } };
		}
		if (
			display._tag === "bash" ||
			display._tag === "read" ||
			display._tag === "grep" ||
			display._tag === "find" ||
			display._tag === "mcp" ||
			display._tag === "generic"
		) {
			return { ...part, display: { ...display, output: (display.output ?? "") + delta } };
		}
	}
	return null;
};

const materializeActivePath = (
	state: ThreadState,
	leafId: EntryId | null,
): { readonly refetch: boolean; readonly messages: Array<Message>; readonly parts: Array<Part> } => {
	if (leafId === null) return { refetch: false, messages: [], parts: [] };

	const entriesById = new Map(state.entries.map((entry) => [idKey(entry.id), entry]));
	const path: Array<ThreadEntry> = [];
	let cursor: EntryId | null = leafId;
	while (cursor !== null) {
		const entry = entriesById.get(idKey(cursor));
		if (entry === undefined) {
			return { refetch: true, messages: state.messages, parts: state.parts };
		}
		path.push(entry);
		cursor = entry.parentId;
	}
	path.reverse();

	const messagesById = new Map(state.allMessages.map((message) => [idKey(message.id), message]));
	const messages: Array<Message> = [];
	for (const entry of path) {
		if (entry.messageId === null) continue;
		const message = messagesById.get(idKey(entry.messageId));
		if (message === undefined) {
			return { refetch: true, messages: state.messages, parts: state.parts };
		}
		messages.push(message);
	}

	const partsByMessage = new Map<string, Array<Part>>();
	for (const part of state.allParts) {
		const messageId = idKey(part.messageId);
		const existing = partsByMessage.get(messageId);
		if (existing === undefined) partsByMessage.set(messageId, [part]);
		else existing.push(part);
	}
	const parts: Array<Part> = [];
	for (const message of messages) {
		const messageParts = partsByMessage.get(idKey(message.id));
		if (messageParts === undefined) {
			if (message.role === "user") {
				return { refetch: true, messages: state.messages, parts: state.parts };
			}
			continue;
		}
		parts.push(...messageParts);
	}
	return {
		refetch: false,
		messages,
		parts,
	};
};

const projectCurrentPath = (
	state: ThreadState,
): { readonly state: ThreadState; readonly refetch: boolean } => {
	const materialized = materializeActivePath(state, state.leafId);
	return {
		state: {
			...state,
			messages: materialized.messages,
			parts: materialized.parts,
		},
		refetch: materialized.refetch,
	};
};

export const fromDetail = (detail: ThreadDetail): ThreadState => ({
	summary: detail.summary,
	cwd: detail.cwd,
	capabilities: detail.capabilities,
	entries: [...detail.entries],
	leafId: detail.leafId,
	messages: [...detail.messages],
	parts: [...detail.parts],
	allMessages: [...detail.messages],
	allParts: [...detail.parts],
	queue: [...detail.queue],
	seq: detail.seq,
	activeTurn: null,
	lastSettled: null,
});

export const fromWorkspaceList = (snapshot: {
	readonly threads: ReadonlyArray<ThreadSummary>;
	readonly seq: number;
}): WorkspaceState => ({
	threads: sortThreads(snapshot.threads),
	seq: snapshot.seq,
});

export const applyThreadEvent = (
	state: ThreadState,
	event: ThreadStreamEvent,
): { readonly state: ThreadState; readonly refetch: boolean } => {
	if (event.seq <= state.seq) return { state, refetch: false };

	switch (event._tag) {
		case "part.created":
			return projectCurrentPath({
				...state,
				allParts: upsertById(state.allParts, event.part),
				seq: event.seq,
			});
		case "part.delta": {
			const index = state.allParts.findIndex((part) => idKey(part.id) === idKey(event.partId));
			if (index === -1) return { state: { ...state, seq: event.seq }, refetch: false };
			const part = state.allParts[index];
			if (part === undefined) return { state: { ...state, seq: event.seq }, refetch: false };
			const folded = foldDelta(part, event.field, event.delta);
			if (folded === null) return { state: { ...state, seq: event.seq }, refetch: false };
			return projectCurrentPath({
				...state,
				allParts: state.allParts.map((part, current) => (current === index ? folded : part)),
				seq: event.seq,
			});
		}
		case "part.updated":
			return projectCurrentPath({
				...state,
				allParts: upsertById(state.allParts, event.part),
				seq: event.seq,
			});
		case "part.completed":
			return projectCurrentPath({
				...state,
				allParts: state.allParts.map((part) =>
					idKey(part.id) === idKey(event.partId) ? { ...part, state: "complete" } : part,
				),
				seq: event.seq,
			});
		case "part.removed":
			return projectCurrentPath({
				...state,
				allParts: removeById(state.allParts, event.partId),
				seq: event.seq,
			});
		case "message.created":
			return projectCurrentPath({
				...state,
				entries: upsertById(state.entries, event.entry),
				allMessages: upsertById(state.allMessages, event.message),
				seq: event.seq,
			});
		case "message.updated":
			return projectCurrentPath({
				...state,
				allMessages: upsertById(state.allMessages, event.message),
				seq: event.seq,
			});
		case "turn.started":
			return {
				state: { ...state, activeTurn: event.turnId, seq: event.seq },
				refetch: false,
			};
		case "turn.settled":
			return {
				state: {
					...state,
					activeTurn: null,
					lastSettled: {
						turnId: event.turnId,
						state: event.state,
						...(event.error === undefined ? {} : { error: event.error }),
					},
					seq: event.seq,
				},
				refetch: false,
			};
		case "queue.updated":
			return {
				state: { ...state, queue: [...event.queue], seq: event.seq },
				refetch: false,
			};
		case "thread.updated":
			return {
				state: { ...state, summary: event.summary, seq: event.seq },
				refetch: false,
			};
		case "tree.moved": {
			const moved = { ...state, leafId: event.leafId, seq: event.seq };
			return projectCurrentPath(moved);
		}
	}
};

export const applyWorkspaceEvent = (
	state: WorkspaceState,
	event: ThreadSummaryEvent,
): WorkspaceState => {
	if (event.seq <= state.seq) return state;
	switch (event._tag) {
		case "thread.updated":
			if (event.summary.archivedAt !== null) {
				return {
					threads: removeById(state.threads, event.summary.id),
					seq: event.seq,
				};
			}
			return {
				threads: sortThreads(upsertById(state.threads, event.summary)),
				seq: event.seq,
			};
		case "thread.removed":
			return {
				threads: state.threads.filter((thread) => idKey(thread.id) !== idKey(event.threadId)),
				seq: event.seq,
			};
	}
};
