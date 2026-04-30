// @ts-nocheck
import type { UiSkill } from "~/lib/ui-session-types";

import type { ChatDraftSkill } from "./types";
import type { SlashMatch } from "./search";

function sort(skills: ChatDraftSkill[]) {
  return skills.toSorted((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return left.end - right.end;
  });
}

function token(skill: Pick<ChatDraftSkill, "name">) {
  return `/${skill.name}`;
}

function valid(text: string, skill: ChatDraftSkill) {
  if (skill.start < 0 || skill.end <= skill.start || skill.end > text.length) return false;
  return text.slice(skill.start, skill.end) === token(skill);
}

function edit(prev: string, next: string) {
  let start = 0;
  const limit = Math.min(prev.length, next.length);
  while (start < limit && prev[start] === next[start]) {
    start += 1;
  }

  let left = prev.length;
  let right = next.length;
  while (left > start && right > start && prev[left - 1] === next[right - 1]) {
    left -= 1;
    right -= 1;
  }

  return {
    start,
    prevEnd: left,
    nextEnd: right,
    delta: right - left,
  };
}

export function shiftSkills(prev: string, next: string, skills: ChatDraftSkill[]) {
  const change = edit(prev, next);
  return sort(
    skills.flatMap((skill) => {
      if (!valid(prev, skill)) return [];
      if (skill.end <= change.start) return [skill];
      if (skill.start >= change.prevEnd) {
        return [
          {
            ...skill,
            start: skill.start + change.delta,
            end: skill.end + change.delta,
          },
        ];
      }
      return [];
    }),
  );
}

export function applySkill(
  value: string,
  hit: SlashMatch,
  item: Pick<UiSkill, "id" | "name">,
  skills: ChatDraftSkill[],
) {
  const next = `${value.slice(0, hit.start)}/${item.name} ${value.slice(hit.end)}`;
  return {
    value: next,
    cursor: hit.start + item.name.length + 2,
    skills: sort([
      ...shiftSkills(value, next, skills),
      {
        id: item.id,
        name: item.name,
        start: hit.start,
        end: hit.start + item.name.length + 1,
      },
    ]),
  };
}

export function touchSkill(
  text: string,
  skills: ChatDraftSkill[],
  pos: number,
  dir: "left" | "right",
) {
  return (
    sort(skills.filter((skill) => valid(text, skill))).find((skill) =>
      dir === "left" ? skill.end === pos : skill.start === pos,
    ) ?? null
  );
}

export function snapSkillSelection(
  text: string,
  skills: ChatDraftSkill[],
  start: number,
  end: number,
) {
  let left = Math.min(start, end);
  let right = Math.max(start, end);
  let changed = false;

  for (const skill of sort(skills.filter((skill) => valid(text, skill)))) {
    if (right <= skill.start || left >= skill.end) continue;
    if (left <= skill.start && right >= skill.end) continue;
    left = Math.min(left, skill.start);
    right = Math.max(right, skill.end);
    changed = true;
  }

  return changed ? { start: left, end: right } : null;
}

export function dropSkill(value: string, skills: ChatDraftSkill[], skill: ChatDraftSkill) {
  let start = skill.start;
  let end = skill.end;

  if (value[end] === " ") {
    end += 1;
  } else if (start > 0 && value[start - 1] === " ") {
    start -= 1;
  }

  const next = `${value.slice(0, start)}${value.slice(end)}`;
  return {
    value: next,
    cursor: start,
    skills: shiftSkills(value, next, skills),
  };
}

export function expandSkills(text: string, skills: ChatDraftSkill[], defs: UiSkill[]) {
  const map = new Map(defs.map((item) => [item.id, item]));
  let out = "";
  let at = 0;

  for (const skill of sort(skills.filter((skill) => valid(text, skill)))) {
    if (skill.start < at) continue;
    out += text.slice(at, skill.start);
    const item = map.get(skill.id);
    out += item && item.name === skill.name ? item.body : text.slice(skill.start, skill.end);
    at = skill.end;
  }

  return `${out}${text.slice(at)}`;
}
