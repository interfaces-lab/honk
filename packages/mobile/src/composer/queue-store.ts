import * as React from "react";
import { createMMKV } from "react-native-mmkv";
import { openCodeSessionKey, type OpenCodeSessionRef } from "@honk/opencode";

import type { ComposerImage } from "../chat-composer";

export interface QueueItem {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly ComposerImage[];
  readonly agent?: string;
}

export interface QueueInput {
  readonly text: string;
  readonly attachments: readonly ComposerImage[];
  readonly agent?: string;
}

const EMPTY_QUEUE: readonly QueueItem[] = Object.freeze([]);

// MMKV is synchronous, which is what `useSyncExternalStore` needs: the snapshot has to be readable
// during render, so a promise-backed store (SecureStore, file system) cannot hold the queue.
const storage = createMMKV({ id: "honk.mobile" });
const STORAGE_KEY = "honk.mobile.composer.queues.v1";

let queues = hydrate();
let nextItemSequence = 0;
const listeners = new Set<() => void>();

export function readThreadQueue(ref: OpenCodeSessionRef): readonly QueueItem[] {
  return queues[openCodeSessionKey(ref)] ?? EMPTY_QUEUE;
}

export function useThreadQueue(ref: OpenCodeSessionRef | null): readonly QueueItem[] {
  return React.useSyncExternalStore(subscribeThreadQueues, () =>
    ref === null ? EMPTY_QUEUE : readThreadQueue(ref),
  );
}

export function enqueueThreadMessage(ref: OpenCodeSessionRef, input: QueueInput): QueueItem {
  const item = Object.freeze({
    id: `q${(nextItemSequence += 1).toString(36)}.${Date.now().toString(36)}`,
    text: input.text,
    attachments: Object.freeze([...input.attachments]),
    ...(input.agent === undefined ? {} : { agent: input.agent }),
  });
  setThreadQueue(ref, [...readThreadQueue(ref), item]);
  return item;
}

export function removeThreadMessage(ref: OpenCodeSessionRef, id: string): void {
  setThreadQueue(
    ref,
    readThreadQueue(ref).filter((item) => item.id !== id),
  );
}

/** Replaces a queued message in place so an edit keeps its position in line. */
export function replaceThreadMessage(ref: OpenCodeSessionRef, id: string, input: QueueInput): void {
  setThreadQueue(
    ref,
    readThreadQueue(ref).map((item) =>
      item.id === id
        ? Object.freeze({
            id,
            text: input.text,
            attachments: Object.freeze([...input.attachments]),
            ...(input.agent === undefined ? {} : { agent: input.agent }),
          })
        : item,
    ),
  );
}

export function shiftThreadMessage(ref: OpenCodeSessionRef): QueueItem | undefined {
  const queue = readThreadQueue(ref);
  const head = queue[0];
  if (head !== undefined) setThreadQueue(ref, queue.slice(1));
  return head;
}

/** Puts a dispatched message back at the front after a failed send. */
export function unshiftThreadMessage(ref: OpenCodeSessionRef, item: QueueItem): void {
  setThreadQueue(ref, [item, ...readThreadQueue(ref)]);
}

export function subscribeThreadQueues(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setThreadQueue(ref: OpenCodeSessionRef, items: readonly QueueItem[]): void {
  const key = openCodeSessionKey(ref);
  const { [key]: _drained, ...remaining } = queues;
  queues = Object.freeze(
    items.length === 0 ? remaining : { ...remaining, [key]: Object.freeze(items) },
  );
  storage.set(
    STORAGE_KEY,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(queues).map(([queueKey, queued]) => [
          queueKey,
          // Picked images are inlined as data: URIs, which are session-scoped like a draft's
          // pasted payload. The message text survives a relaunch; the images do not.
          queued.map((item) => ({
            ...item,
            attachments: item.attachments.filter(
              (attachment) =>
                !attachment.file.uri.startsWith("data:") &&
                !attachment.file.uri.startsWith("blob:"),
            ),
          })),
        ]),
      ),
    ),
  );
  for (const listener of listeners) listener();
}

function hydrate(): Readonly<Record<string, readonly QueueItem[]>> {
  const raw = storage.getString(STORAGE_KEY);
  if (raw === undefined) return Object.freeze({});
  // A corrupt blob must not take the composer down at import time, and JSON.parse is the only
  // way to find out that it is corrupt.
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  if (!isRecord(parsed)) return Object.freeze({});
  return Object.freeze(
    Object.fromEntries(
      Object.entries(parsed).flatMap(([queueKey, items]) => {
        if (!Array.isArray(items)) return [];
        const queue = items.map(parseQueueItem).filter((item): item is QueueItem => item !== null);
        return queue.length === 0 ? [] : [[queueKey, Object.freeze(queue)] as const];
      }),
    ),
  );
}

function parseQueueItem(value: unknown): QueueItem | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") {
    return null;
  }
  const attachments = (Array.isArray(value.attachments) ? value.attachments : []).flatMap(
    (candidate: unknown) => {
      if (!isRecord(candidate) || typeof candidate.id !== "string") return [];
      if (typeof candidate.uri !== "string" || !isRecord(candidate.file)) return [];
      const file = candidate.file;
      if (typeof file.uri !== "string") return [];
      return [
        Object.freeze({
          id: candidate.id,
          uri: candidate.uri,
          file: Object.freeze({
            uri: file.uri,
            ...(typeof file.name === "string" ? { name: file.name } : {}),
          }),
        }),
      ];
    },
  );
  // An image-only message loses its data: attachments on the way to storage, so it comes back with
  // nothing to send. Drop it rather than leaving an empty row that dispatches a blank prompt.
  if (value.text.trim() === "" && attachments.length === 0) return null;
  return Object.freeze({
    id: value.id,
    text: value.text,
    attachments: Object.freeze(attachments),
    ...(typeof value.agent === "string" ? { agent: value.agent } : {}),
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
