import type { ScopedThreadRef } from "@multi/contracts";

export function areSameThreadRefs(
  left: readonly ScopedThreadRef[],
  right: readonly ScopedThreadRef[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (threadRef, index) =>
        threadRef.environmentId === right[index]?.environmentId &&
        threadRef.threadId === right[index]?.threadId,
    )
  );
}

export function createThreadRefsKey(threadRefs: readonly ScopedThreadRef[]): string {
  return threadRefs
    .map((threadRef) => `${threadRef.environmentId}:${threadRef.threadId}`)
    .join("\0");
}

export function createSectionItemIdsKey(items: readonly { id: string }[]): string {
  return items.map((item) => item.id).join("\0");
}

