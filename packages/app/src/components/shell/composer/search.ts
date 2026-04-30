import type { ShellFileHit } from "~/lib/ui-session-types";

const marks = new Set([" ", "\t", '"', "'", "="]);

export type FileMatch = {
  token: string;
  query: string;
  start: number;
  end: number;
  quoted: boolean;
};

export type SlashMatch = {
  query: string;
  start: number;
  end: number;
};

function last(text: string) {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (marks.has(text[i] ?? "")) return i;
  }
  return -1;
}

function quote(text: string) {
  let on = false;
  let at = -1;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '"') continue;
    on = !on;
    if (on) at = i;
  }

  return on ? at : null;
}

function quoted(text: string) {
  const at = quote(text);
  if (at === null) return null;
  if (at > 0 && text[at - 1] === "@") {
    if (!(at - 1 === 0 || marks.has(text[at - 2] ?? ""))) return null;
    return text.slice(at - 1);
  }
  if (!(at === 0 || marks.has(text[at - 1] ?? ""))) return null;
  return text.slice(at);
}

function line(value: string, cursor: number) {
  const start = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const next = value.indexOf("\n", cursor);
  const end = next < 0 ? value.length : next;
  return {
    start,
    end,
    before: value.slice(start, cursor),
    after: value.slice(cursor, end),
  };
}

function parse(prefix: string) {
  if (prefix.startsWith('@"')) {
    return { raw: prefix.slice(2), at: true, quoted: true };
  }
  if (prefix.startsWith('"')) {
    return { raw: prefix.slice(1), at: false, quoted: true };
  }
  if (prefix.startsWith("@")) {
    return { raw: prefix.slice(1), at: true, quoted: false };
  }
  return { raw: prefix, at: false, quoted: false };
}

export function fileMatch(value: string, cursor: number): FileMatch | null {
  const row = line(value, cursor);
  const hit = quoted(row.before);
  if (hit?.startsWith('@"')) {
    return {
      token: hit,
      query: parse(hit).raw,
      start: row.start + row.before.length - hit.length,
      end: cursor,
      quoted: true,
    };
  }

  const cut = last(row.before);
  const start = cut < 0 ? 0 : cut + 1;
  if (row.before[start] !== "@") return null;
  const token = row.before.slice(start);
  return {
    token,
    query: token.slice(1),
    start: row.start + start,
    end: cursor,
    quoted: false,
  };
}

export function slashMatch(value: string, cursor: number): SlashMatch | null {
  const row = line(value, cursor);
  if (!row.before.startsWith("/")) return null;
  const cut = row.before.indexOf(" ");
  if (cut >= 0) return null;
  return {
    query: row.before.slice(1),
    start: row.start,
    end: cursor,
  };
}

export function draftSlash(value: string): SlashMatch | null {
  const text = value.trim();
  if (text.length < 2 || !text.startsWith("/") || /\s/.test(text.slice(1))) return null;
  const start = value.indexOf(text);
  if (start < 0) return null;
  return {
    query: text.slice(1),
    start,
    end: start + text.length,
  };
}

export function slashPrefix(hit: SlashMatch | null, name: string) {
  const query = hit?.query.trim().toLowerCase() ?? "";
  if (!query) return false;
  return name.startsWith(query);
}

export function rank<T>(items: T[], query: string, pick: (item: T) => string) {
  const raw = query.trim().toLowerCase();
  if (!raw) return items;

  const seq = (text: string) => {
    let pos = 0;
    for (const char of raw) {
      pos = text.indexOf(char, pos);
      if (pos < 0) return false;
      pos += 1;
    }
    return true;
  };

  const score = (item: T) => {
    const text = pick(item).toLowerCase();
    if (text === raw) return 100;
    if (text.startsWith(raw)) return 80 - text.length / 64;
    if (text.includes(raw)) return 60 - text.indexOf(raw) / 8;
    if (seq(text)) return 30 - text.length / 96;
    return -1;
  };

  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((item) => item.score >= 0)
    .toSorted((left, right) => right.score - left.score)
    .map((item) => item.item);
}

export function clearSlash(value: string, hit: SlashMatch) {
  const next = `${value.slice(0, hit.start)}${value.slice(hit.end)}`;
  return {
    value: next.trim() ? next : "",
    cursor: next.trim() ? hit.start : 0,
  };
}

function buildFileValue(path: string, opts: { dir: boolean; quoted: boolean }) {
  const need = opts.quoted || path.includes(" ");
  if (!need) return `@${path}`;
  return `@"${path}"`;
}

export function applyFile(value: string, hit: FileMatch, item: ShellFileHit) {
  const next = buildFileValue(item.path, { dir: item.kind === "dir", quoted: hit.quoted });
  const tail = value.slice(hit.end);
  const keep = hit.quoted && next.endsWith('"') && tail.startsWith('"') ? tail.slice(1) : tail;
  const gap = item.kind === "dir" ? "" : " ";
  const text = `${value.slice(0, hit.start)}${next}${gap}${keep}`;
  const close = item.kind === "dir" && next.endsWith('"') ? next.length - 1 : next.length;
  return {
    value: text,
    cursor: hit.start + close + gap.length,
    reopen: item.kind === "dir",
  };
}

export function rankFileHits(hits: ShellFileHit[], query: string): ShellFileHit[] {
  const raw = query.trim().toLowerCase();
  if (!raw) {
    return hits.toSorted((a, b) => {
      const diff =
        a.path.split("/").filter(Boolean).length - b.path.split("/").filter(Boolean).length;
      if (diff !== 0) return diff;
      return a.path.localeCompare(b.path);
    });
  }
  const base = rank(hits, query, (h) => h.name);
  return base.toSorted((a, b) => {
    const diff =
      a.path.split("/").filter(Boolean).length - b.path.split("/").filter(Boolean).length;
    if (diff !== 0) return diff;
    return a.path.localeCompare(b.path);
  });
}

export type MirrorSeg = {
  kind: "plain" | "skill" | "mention";
  text: string;
  start: number;
  end: number;
};

export type MirrorMark = {
  kind: Exclude<MirrorSeg["kind"], "plain" | "mention">;
  start: number;
  end: number;
};

type MirrorRange = {
  kind: Exclude<MirrorSeg["kind"], "plain">;
  start: number;
  end: number;
};

function pushSeg(out: MirrorSeg[], kind: MirrorSeg["kind"], text: string, at: number) {
  if (!text) return;
  out.push({ kind, text, start: at, end: at + text.length });
}

function rangeOrder(kind: MirrorRange["kind"]) {
  if (kind === "skill") return 0;
  if (kind === "mention") return 1;
  return 2;
}

function mentionRanges(line: string, base: number): MirrorRange[] {
  const out: MirrorRange[] = [];
  let i = 0;
  while (i < line.length) {
    const at = line.indexOf("@", i);
    if (at < 0) break;
    if (line.startsWith('@"', at)) {
      const end = line.indexOf('"', at + 2);
      if (end < 0) {
        out.push({ kind: "mention", start: base + at, end: base + line.length });
        break;
      }
      out.push({ kind: "mention", start: base + at, end: base + end + 1 });
      i = end + 1;
      continue;
    }
    let j = at + 1;
    while (j < line.length && !/\s/.test(line[j] ?? "")) j += 1;
    if (j > at + 1) {
      out.push({ kind: "mention", start: base + at, end: base + j });
    }
    i = j;
  }
  return out;
}

export function mirrorSegmentsDraft(
  value: string,
  ranges: ReadonlyArray<MirrorMark> = [],
): MirrorSeg[] {
  const lines = value.split("\n");
  let offset = 0;
  const marks: MirrorRange[] = [];
  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li] ?? "";
    marks.push(...mentionRanges(line, offset));
    offset += line.length;
    if (li < lines.length - 1) offset += 1;
  }

  marks.push(
    ...ranges
      .filter((item) => item.start >= 0 && item.end > item.start && item.end <= value.length)
      .map((item) => ({ kind: item.kind, start: item.start, end: item.end })),
  );

  const out: MirrorSeg[] = [];
  let at = 0;
  for (const item of marks.toSorted(
    (left, right) =>
      left.start - right.start ||
      rangeOrder(left.kind) - rangeOrder(right.kind) ||
      right.end - left.end,
  )) {
    if (item.start < at) continue;
    pushSeg(out, "plain", value.slice(at, item.start), at);
    pushSeg(out, item.kind, value.slice(item.start, item.end), item.start);
    at = item.end;
  }
  pushSeg(out, "plain", value.slice(at), at);
  return out;
}

export function mirrorActiveSeg(
  segs: MirrorSeg[],
  cursor: number,
  at: FileMatch | null,
): number | null {
  if (at) {
    const idx = segs.findIndex(
      (s) => s.kind === "mention" && at.start >= s.start && at.end <= s.end,
    );
    return idx >= 0 ? idx : null;
  }
  const skill = segs.findIndex((s) => s.kind === "skill" && cursor >= s.start && cursor <= s.end);
  if (skill >= 0) return skill;
  return null;
}
