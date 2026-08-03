import * as React from "react";

import type { PromptComposerFile } from "../open-code-view";
import { parsePromptComposerFile } from "./prompt-files";

export type QueueItem = {
  readonly id: string;
  readonly text: string;
  readonly files: readonly PromptComposerFile[];
  readonly editorState?: string;
  readonly agent?: string;
};

const STORAGE_KEY = "honk:app:composer-queues:v1";
const EMPTY_QUEUE: readonly QueueItem[] = Object.freeze([]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseItem(value: unknown): QueueItem | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") {
    return null;
  }
  const files = (Array.isArray(value.files) ? value.files : []).flatMap((file) => {
    const parsed = parsePromptComposerFile(file);
    return parsed === null ? [] : [parsed];
  });
  return Object.freeze({
    id: value.id,
    text: value.text,
    files: Object.freeze(files),
    ...(typeof value.editorState === "string" ? { editorState: value.editorState } : {}),
    ...(typeof value.agent === "string" ? { agent: value.agent } : {}),
  });
}

function hydrate(): Readonly<Record<string, readonly QueueItem[]>> {
  if (typeof window === "undefined") return Object.freeze({});
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return Object.freeze({});
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return Object.freeze({});
    return Object.freeze(
      Object.fromEntries(
        Object.entries(parsed).flatMap(([threadId, items]) => {
          if (!Array.isArray(items)) return [];
          const queue = items.map(parseItem).filter((item): item is QueueItem => item !== null);
          return queue.length === 0 ? [] : [[threadId, Object.freeze(queue)]];
        }),
      ),
    );
  } catch {
    return Object.freeze({});
  }
}

let queues = hydrate();
const listeners = new Set<() => void>();

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(queues).map(([threadId, items]) => [
            threadId,
            // Pasted data:/blob: payloads are session-scoped, like drafts. Keep the message
            // text across reloads and drop only those attachments.
            items.map((item) => ({
              ...item,
              files: item.files.filter(
                (file) => !file.path.startsWith("data:") && !file.path.startsWith("blob:"),
              ),
              ...(item.files.some(
                (file) => file.path.startsWith("data:") || file.path.startsWith("blob:"),
              )
                ? { editorState: undefined }
                : {}),
            })),
          ]),
        ),
      ),
    );
  } catch {
    // Storage limits must not discard the in-memory queue.
  }
}

function setThreadQueue(threadId: string, items: readonly QueueItem[]): void {
  if (items.length === 0) {
    const { [threadId]: _removed, ...remaining } = queues;
    queues = Object.freeze(remaining);
  } else {
    queues = Object.freeze({ ...queues, [threadId]: Object.freeze(items) });
  }
  persist();
  for (const listener of listeners) listener();
}

/**
 * Claims a queue written before queues were keyed by server-qualified task identity.
 * The first matching task to mount owns the ambiguous legacy queue; a populated
 * destination always wins.
 */
export function migrateThreadQueue(legacyThreadId: string, threadKey: string): void {
  if (legacyThreadId === threadKey || queues[threadKey] !== undefined) return;
  const legacy = queues[legacyThreadId];
  if (legacy === undefined) return;
  const { [legacyThreadId]: _legacy, ...remaining } = queues;
  queues = Object.freeze({ ...remaining, [threadKey]: legacy });
  persist();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readThreadQueue(threadId: string): readonly QueueItem[] {
  return queues[threadId] ?? EMPTY_QUEUE;
}

export function useThreadQueue(threadId: string): readonly QueueItem[] {
  return React.useSyncExternalStore(subscribe, () => readThreadQueue(threadId));
}

export function enqueueThreadMessage(
  threadId: string,
  input: {
    readonly text: string;
    readonly files: readonly PromptComposerFile[];
    readonly editorState?: string;
    readonly agent?: string;
  },
): QueueItem {
  const item = Object.freeze({
    id: crypto.randomUUID(),
    text: input.text,
    files: Object.freeze([...input.files]),
    ...(input.editorState === undefined ? {} : { editorState: input.editorState }),
    ...(input.agent === undefined ? {} : { agent: input.agent }),
  });
  setThreadQueue(threadId, [...readThreadQueue(threadId), item]);
  return item;
}

export function removeThreadMessage(threadId: string, id: string): void {
  setThreadQueue(
    threadId,
    readThreadQueue(threadId).filter((item) => item.id !== id),
  );
}

export function removeThreadMessages(threadId: string, ids: ReadonlySet<string>): void {
  if (ids.size === 0) return;
  setThreadQueue(
    threadId,
    readThreadQueue(threadId).filter((item) => !ids.has(item.id)),
  );
}

/** Replaces a queued message in place so an edit keeps its position in line. */
export function replaceThreadMessage(
  threadId: string,
  id: string,
  input: {
    readonly text: string;
    readonly files: readonly PromptComposerFile[];
    readonly editorState?: string;
    readonly agent?: string;
  },
): void {
  setThreadQueue(
    threadId,
    readThreadQueue(threadId).map((item) =>
      item.id === id
        ? Object.freeze({
            id,
            text: input.text,
            files: Object.freeze([...input.files]),
            ...(input.editorState === undefined ? {} : { editorState: input.editorState }),
            ...(input.agent === undefined ? {} : { agent: input.agent }),
          })
        : item,
    ),
  );
}

export function shiftThreadMessage(threadId: string): QueueItem | undefined {
  const queue = readThreadQueue(threadId);
  const head = queue[0];
  if (head !== undefined) setThreadQueue(threadId, queue.slice(1));
  return head;
}

/** Puts a dispatched message back at the front after a failed send. */
export function unshiftThreadMessage(threadId: string, item: QueueItem): void {
  setThreadQueue(threadId, [item, ...readThreadQueue(threadId)]);
}

export function reorderThreadMessage(
  threadId: string,
  movedId: string,
  targetId: string,
  insertAfter: boolean,
): void {
  const queue = readThreadQueue(threadId);
  const moved = queue.find((item) => item.id === movedId);
  if (moved === undefined || movedId === targetId) return;
  const remaining = queue.filter((item) => item.id !== movedId);
  const targetIndex = remaining.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) return;
  const insertIndex = insertAfter ? targetIndex + 1 : targetIndex;
  setThreadQueue(threadId, [
    ...remaining.slice(0, insertIndex),
    moved,
    ...remaining.slice(insertIndex),
  ]);
}
