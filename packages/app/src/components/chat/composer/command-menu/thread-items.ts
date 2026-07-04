import type { EnvironmentId } from "@honk/shared/environment";
import type { ThreadId } from "@honk/shared/base-schemas";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
  type RankedSearchResult,
} from "@honk/shared/search-ranking";

import type { SidebarThreadSummary } from "~/types";

/**
 * Pure helpers for the "Past Threads" group in the `@` composer menu.
 *
 * Union-agnostic on purpose: this module must not import from `menu.tsx` or
 * `input.tsx`. The integrator maps {@link PastThreadCandidate} records onto
 * `ComposerCommandItem` variants and inserts {@link buildThreadMentionToken}
 * output through the composer's replacement plumbing.
 */

const PAST_THREAD_FALLBACK_TITLE = "Untitled";
const PAST_THREAD_TITLE_MAX_LENGTH = 50;
/** Recency pool cap applied BEFORE any query filtering (Cursor parity). */
const PAST_THREAD_POOL_LIMIT = 25;
/** Default number of candidates returned (spec: empty `@` query shows 5). */
const PAST_THREAD_DEFAULT_LIMIT = 5;

export interface PastThreadCandidate {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly description: "Past thread";
  readonly sortKey: string;
}

export interface BuildPastThreadCandidatesOptions {
  readonly activeThreadId: ThreadId | null;
  readonly environmentId: EnvironmentId;
  readonly query: string;
  readonly limit?: number | undefined;
  readonly poolLimit?: number | undefined;
}

/**
 * Sanitizes a thread title for use as an inline-token label: strips the
 * characters that would break the `[@label](uri)` token grammar (`[` `]` `(`
 * `)`), collapses whitespace, trims, caps at 50 characters (code points, so a
 * surrogate pair is never split), and falls back to "Untitled".
 */
export function sanitizeThreadMentionTitle(title: string | null | undefined): string {
  const sanitized = (title ?? "")
    .replace(/[[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length === 0) {
    return PAST_THREAD_FALLBACK_TITLE;
  }
  if (sanitized.length <= PAST_THREAD_TITLE_MAX_LENGTH) {
    return sanitized;
  }
  return Array.from(sanitized).slice(0, PAST_THREAD_TITLE_MAX_LENGTH).join("").trimEnd();
}

/**
 * Builds a `file://` URI for an absolute session-file path. Each path segment
 * is percent-encoded (keeping `/` separators), and `(` / `)` are additionally
 * encoded as `%28` / `%29`: `encodeURIComponent` leaves parens alone, and a
 * literal `)` in the URI would terminate the composer's
 * `MARKDOWN_INLINE_TOKEN_REGEX` match early.
 */
export function buildThreadSessionFileUri(absPath: string): string {
  const encodedPath = absPath
    .split("/")
    .map((segment) => encodeURIComponent(segment).replaceAll("(", "%28").replaceAll(")", "%29"))
    .join("/");
  return `file://${encodedPath}`;
}

/**
 * Builds the serialized mention token inserted into the prompt when a past
 * thread is selected, INCLUDING the trailing space the token grammar requires:
 * `[@<sanitized title>](file://<encoded abs path>) `.
 */
export function buildThreadMentionToken(title: string | null | undefined, absPath: string): string {
  return `[@${sanitizeThreadMentionTitle(title)}](${buildThreadSessionFileUri(absPath)}) `;
}

function toPastThreadCandidate(summary: SidebarThreadSummary): PastThreadCandidate {
  const title = summary.title.trim();
  return {
    threadId: summary.id,
    title: title.length > 0 ? title : PAST_THREAD_FALLBACK_TITLE,
    description: "Past thread",
    sortKey: summary.latestUserMessageAt ?? summary.updatedAt ?? summary.createdAt,
  };
}

function comparePastThreadCandidatesByRecency(
  left: PastThreadCandidate,
  right: PastThreadCandidate,
): number {
  if (left.sortKey < right.sortKey) return 1;
  if (left.sortKey > right.sortKey) return -1;
  return left.threadId.localeCompare(right.threadId);
}

function scorePastThreadTitle(title: string, normalizedQuery: string): number | null {
  return scoreQueryMatch({
    value: title.toLowerCase().replace(/\s+/g, " "),
    query: normalizedQuery,
    exactBase: 0,
    prefixBase: 2,
    boundaryBase: 4,
    includesBase: 6,
    fuzzyBase: 100,
  });
}

/**
 * Builds the "Past Threads" candidate records for the `@` menu:
 *
 * 1. Filter to the composer's environment, exclude the active thread, and
 *    require `latestUserMessageAt != null` (skips never-prompted drafts).
 * 2. Sort by `latestUserMessageAt ?? updatedAt ?? createdAt` descending and
 *    cap the pool at `poolLimit` (default 25) BEFORE any query filtering.
 * 3. Empty query: return the first `limit` (default 5) most recent threads.
 *    Non-empty query: rank pool titles with the shared tiered scorer and
 *    return the top `limit`; recency breaks score ties.
 */
export function buildPastThreadCandidates(
  summaries: ReadonlyArray<SidebarThreadSummary>,
  options: BuildPastThreadCandidatesOptions,
): PastThreadCandidate[] {
  const limit = Math.max(0, Math.floor(options.limit ?? PAST_THREAD_DEFAULT_LIMIT));
  const poolLimit = Math.max(0, Math.floor(options.poolLimit ?? PAST_THREAD_POOL_LIMIT));

  const recentFirst = summaries
    .filter(
      (summary) =>
        summary.environmentId === options.environmentId &&
        summary.id !== options.activeThreadId &&
        summary.latestUserMessageAt !== null,
    )
    .map(toPastThreadCandidate)
    .toSorted(comparePastThreadCandidatesByRecency)
    .slice(0, poolLimit);

  const normalizedQuery = normalizeSearchQuery(options.query, { trimLeadingPattern: /^@+/ });
  if (!normalizedQuery) {
    return recentFirst.slice(0, limit);
  }

  const ranked: RankedSearchResult<PastThreadCandidate>[] = [];
  for (const [poolIndex, candidate] of recentFirst.entries()) {
    const score = scorePastThreadTitle(candidate.title, normalizedQuery);
    if (score === null) continue;
    insertRankedSearchResult(
      ranked,
      {
        item: candidate,
        score,
        tieBreaker: `${String(poolIndex).padStart(10, "0")}\u0000${candidate.threadId}`,
      },
      limit,
    );
  }

  return ranked.map((entry) => entry.item);
}
