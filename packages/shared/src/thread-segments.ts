const THREAD_SEGMENT_MAX_CHARS = 80;

export function toSafeThreadSegment(threadId: string): string | null {
  const segment = threadId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, THREAD_SEGMENT_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  return segment.length > 0 ? segment : null;
}
