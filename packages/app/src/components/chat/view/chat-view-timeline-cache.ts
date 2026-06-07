import type { Thread } from "../../../types";

export function activeTimelineCacheKey(
  thread: Pick<Thread, "id" | "leafId"> | null | undefined,
): string {
  return thread?.id ?? "";
}
