import { rank } from "./search";
import { recentBoost, type SlashRecentsSnapshot } from "./slash-recents";
import type { SlashItemKind } from "./slash-types";

export type { SlashItemKind } from "./slash-types";

export type SlashAction =
  | "new-chat"
  | "open-settings"
  | "open-model-picker"
  | "plan-mode"
  | "fast-mode";

type SlashBase = {
  id: string;
  name: string;
  description?: string;
  pill: string;
};

export type SlashItem =
  | (SlashBase & { kind: "command"; action: SlashAction })
  | (SlashBase & { kind: "skill" });

export type SlashMenuRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "option"; item: SlashItem; optionIndex: number };

function rankSlashItems(
  items: SlashItem[],
  query: string,
  snap: SlashRecentsSnapshot,
): SlashItem[] {
  const base = query.trim() ? rank(items, query, (item) => item.name) : items;
  return base.toSorted((left, right) => {
    const a = recentBoost(left.id, left.kind, snap) * 4 + (100 - Math.min(left.name.length, 64));
    const b = recentBoost(right.id, right.kind, snap) * 4 + (100 - Math.min(right.name.length, 64));
    return b - a;
  });
}

export function buildSlashMenuRows(
  items: SlashItem[],
  query: string,
  snap: SlashRecentsSnapshot,
): SlashMenuRow[] {
  const ranked = rankSlashItems(items, query, snap);
  const byKind = (kind: SlashItemKind) => ranked.filter((item) => item.kind === kind);

  const rows: SlashMenuRow[] = [];
  let optionIndex = 0;

  const push = (kind: SlashItemKind, label: string, key: string) => {
    const list = byKind(kind);
    if (list.length === 0) return;
    rows.push({ kind: "header", key, label });
    for (const item of list) {
      rows.push({ kind: "option", item, optionIndex: optionIndex++ });
    }
  };

  push("command", "Commands", "commands");
  push("skill", "Skills", "skills");

  return rows;
}
