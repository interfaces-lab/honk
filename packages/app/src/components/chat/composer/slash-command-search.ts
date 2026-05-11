import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@multi/shared/search-ranking";

import type { ComposerCommandItem } from "./command-menu";
import { formatProviderSkillDisplayName } from "~/provider-skill-presentation";

function scoreSlashCommandItem(
  item: Extract<
    ComposerCommandItem,
    { type: "slash-command" | "provider-slash-command" | "skill" }
  >,
  query: string,
): number | null {
  const primaryValue =
    item.type === "slash-command"
      ? item.command.toLowerCase()
      : item.type === "provider-slash-command"
        ? item.command.name.toLowerCase()
        : item.skill.name.toLowerCase();
  const displayValue =
    item.type === "skill"
      ? formatProviderSkillDisplayName(item.skill).toLowerCase()
      : item.label.toLowerCase();
  const description = item.description.toLowerCase();

  const scores = [
    scoreQueryMatch({
      value: primaryValue,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    scoreQueryMatch({
      value: displayValue,
      query,
      exactBase: 10,
      prefixBase: 12,
      boundaryBase: 14,
      includesBase: 16,
    }),
    scoreQueryMatch({
      value: description,
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.min(...scores);
}

export function searchSlashCommandItems(
  items: ReadonlyArray<
    Extract<ComposerCommandItem, { type: "slash-command" | "provider-slash-command" | "skill" }>
  >,
  query: string,
): Array<
  Extract<ComposerCommandItem, { type: "slash-command" | "provider-slash-command" | "skill" }>
> {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalizedQuery) {
    return [...items];
  }

  const ranked: Array<{
    item: Extract<
      ComposerCommandItem,
      { type: "slash-command" | "provider-slash-command" | "skill" }
    >;
    score: number;
    tieBreaker: string;
  }> = [];

  for (const item of items) {
    const score = scoreSlashCommandItem(item, normalizedQuery);
    if (score === null) {
      continue;
    }

    insertRankedSearchResult(
      ranked,
      {
        item,
        score,
        tieBreaker:
          item.type === "slash-command"
            ? `0\u0000${item.command}`
            : item.type === "provider-slash-command"
              ? `1\u0000${item.command.name}\u0000${item.provider}`
              : [
                  "2",
                  formatProviderSkillDisplayName(item.skill).toLowerCase(),
                  item.skill.name,
                  item.provider,
                ].join("\u0000"),
      },
      Number.POSITIVE_INFINITY,
    );
  }

  return ranked.map((entry) => entry.item);
}
