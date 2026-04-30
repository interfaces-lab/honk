import type { Json, UiBlock, UiSessionItem, UiToolCallBlock } from "~/lib/ui-session-types";
import type { WorkLogEntry } from "./work-log";
import type { ProviderRequestKind } from "@multi/contracts";
import type { ProposedPlan } from "../types";
import { resolvedToolName as resolve } from "./tool-renderers";

const tag = /<file\s+name="([^"]+)"\s*>([\s\S]*?)<\/file>/g;
const imgs = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

// ── Attachment types ────────────────────────────────────────────────

export type ChatUserAttachment =
  | { kind: "file"; name: string; path: string; note: string }
  | {
      kind: "image";
      name: string;
      path: string | null;
      note: string;
      mimeType: string | null;
      data?: string;
    };

// ── Tool metadata types ─────────────────────────────────────────────

export type ToolCallKind =
  | "edit"
  | "write"
  | "read"
  | "bash"
  | "grep"
  | "find"
  | "ls"
  | "ask"
  | "websearch"
  | "mcp"
  | "task"
  | "other";

export type ToolCallStatus = "pending" | "running" | "completed" | "errored";

function toolKind(name: string): ToolCallKind {
  const r = resolve(name);
  if (
    r === "edit" ||
    r === "write" ||
    r === "read" ||
    r === "bash" ||
    r === "grep" ||
    r === "find" ||
    r === "ls" ||
    r === "ask" ||
    r === "websearch"
  )
    return r;
  if (name.toLowerCase().startsWith("mcp_") || name.toLowerCase().includes("mcp")) return "mcp";
  if (name.toLowerCase() === "task" || name.toLowerCase().startsWith("subagent")) return "task";
  return "other";
}

function toolStatus(row: { args: string; result: string; error: boolean }): ToolCallStatus {
  if (row.error) return "errored";
  if (row.result.trim()) return "completed";
  if (row.args.trim()) return "running";
  return "pending";
}

// ── ChatRow — content-parsed render rows ────────────────────────────

export type ChatRow =
  | { id: string; kind: "user"; text: string; attachments: ChatUserAttachment[] }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "thinking"; text: string; summary: string | null }
  | { id: string; kind: "assistantError"; text: string }
  | {
      id: string;
      kind: "tool";
      name: string;
      toolKind: ToolCallKind;
      status: ToolCallStatus;
      toolUseId: string | null;
      args: string;
      result: string;
      error: boolean;
      call: UiToolCallBlock | null;
      details: Json | null;
    }
  | { id: string; kind: "custom"; name: string; text: string }
  | { id: string; kind: "compaction"; summary: string; tokens: number }
  | { id: string; kind: "branch"; summary: string }
  | {
      id: string;
      kind: "bash";
      command: string;
      output: string;
      code: number | null;
      cancelled: boolean;
      truncated: boolean;
      path: string | null;
      exclude: boolean;
    }
  | { id: string; kind: "system"; text: string }
  | {
      id: string;
      kind: "approval";
      requestKind: ProviderRequestKind | null;
      summary: string;
      detail: string | null;
      decision: string | null;
    }
  | {
      id: string;
      kind: "taskActivity";
      taskId: string;
      summary: string;
      taskStatus: "running" | "completed" | "failed" | "stopped";
    }
  | { id: string; kind: "other"; role: string; text: string };

// ── Timeline types ──────────────────────────────────────────────────

export type TimelineEntry =
  | { kind: "message"; id: string; createdAt: string; item: UiSessionItem }
  | { kind: "work"; id: string; createdAt: string; entry: WorkLogEntry }
  | { kind: "proposed-plan"; id: string; createdAt: string; plan: ProposedPlan };

export type TimelineRow =
  | ChatRow
  | { id: string; kind: "work"; entry: WorkLogEntry }
  | { id: string; kind: "proposed-plan"; plan: ProposedPlan }
  | { id: string; kind: "working" };

export interface StableTimelineRowsState {
  byId: Map<string, TimelineRow>;
  result: TimelineRow[];
}

// ── Timeline pipeline ───────────────────────────────────────────────

export function deriveTimelineEntries(
  items: UiSessionItem[],
  plans: ProposedPlan[],
  work: WorkLogEntry[],
): TimelineEntry[] {
  const extra: TimelineEntry[] = [
    ...plans.map(
      (p): TimelineEntry => ({
        kind: "proposed-plan",
        id: `plan:${p.id}`,
        createdAt: p.createdAt,
        plan: p,
      }),
    ),
    ...work.map(
      (e): TimelineEntry => ({
        kind: "work",
        id: `work:${e.id}`,
        createdAt: e.createdAt,
        entry: e,
      }),
    ),
  ].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (extra.length === 0) {
    return items.map(
      (item): TimelineEntry => ({
        kind: "message",
        id: item.id,
        createdAt: item.createdAt,
        item,
      }),
    );
  }

  const out: TimelineEntry[] = [];
  let ei = 0;
  for (const item of items) {
    while (ei < extra.length && extra[ei]!.createdAt <= item.createdAt) {
      out.push(extra[ei]!);
      ei += 1;
    }
    out.push({ kind: "message", id: item.id, createdAt: item.createdAt, item });
  }
  while (ei < extra.length) {
    out.push(extra[ei]!);
    ei += 1;
  }
  return out;
}

export function deriveMessagesTimelineRows(input: {
  entries: ReadonlyArray<TimelineEntry>;
  isWorking: boolean;
  since: string | null;
}): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const map = new Map<string, number>();
  for (const entry of input.entries) {
    if (entry.kind === "work") {
      rows.push({ id: entry.id, kind: "work", entry: entry.entry });
      continue;
    }
    if (entry.kind === "proposed-plan") {
      rows.push({ id: entry.id, kind: "proposed-plan", plan: entry.plan });
      continue;
    }
    appendMessageRows(rows, map, entry.item);
  }
  if (input.isWorking) {
    rows.push({ id: "working-indicator", kind: "working" });
  }
  return rows;
}

export function computeStableTimelineRows(
  rows: TimelineRow[],
  prev: StableTimelineRowsState,
): StableTimelineRowsState {
  const next = new Map<string, TimelineRow>();
  let changed = rows.length !== prev.byId.size;
  const result = rows.map((row, i) => {
    const old = prev.byId.get(row.id);
    const out = old && rowUnchanged(old, row) ? old : row;
    next.set(row.id, out);
    if (!changed && prev.result[i] !== out) changed = true;
    return out;
  });
  return changed ? { byId: next, result } : prev;
}

function rowUnchanged(a: TimelineRow, b: TimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === "working") return true;
  if (a.kind === "work") return a.entry === (b as typeof a).entry;
  if (a.kind === "proposed-plan") return a.plan === (b as typeof a).plan;
  return a === b;
}

// ── Content parsing ─────────────────────────────────────────────────

function list(value: Json) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, Json>;
    if (typeof r.type !== "string") return [];
    return [item as UiBlock];
  });
}

function clean(text: string) {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parts(text: string) {
  const files = [] as Array<{ path: string; note: string }>;
  let body = "";
  let last = 0;
  for (const hit of text.matchAll(tag)) {
    const pos = hit.index ?? 0;
    body += text.slice(last, pos);
    last = pos + hit[0].length;
    files.push({ path: hit[1] ?? "", note: (hit[2] ?? "").trim() });
  }
  body += text.slice(last);
  return { text: clean(body), files };
}

function plain(value: Json | undefined) {
  if (value === undefined) return "";
  if (typeof value === "string") return clean(value);
  return list(value)
    .flatMap((item) => {
      if (item.type === "text") return [item.text];
      if (item.type === "thinking") return [];
      if (item.type === "image") return ["[image]"];
      if (item.type === "toolCall") return [`[${item.name}]`];
      return [`[${item.type}]`];
    })
    .join("");
}

function user(value: Json | undefined) {
  if (value === undefined) return { text: "", attachments: [] as ChatUserAttachment[] };
  if (typeof value === "string") {
    const next = parts(value);
    return {
      text: next.text,
      attachments: next.files.map((item) => ({
        kind: "file" as const,
        name: item.path.split(/[\\/]/).at(-1) ?? item.path,
        path: item.path,
        note: item.note,
      })),
    };
  }
  const blocks = list(value);
  const text = blocks.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("");
  const next = parts(text);
  const raw = next.files;
  const pics = raw.filter((item) => imgs.test(item.path));
  const rest = raw.filter((item) => !imgs.test(item.path));
  const used = [] as boolean[];
  let img = 0;
  const attachments = [] as ChatUserAttachment[];
  for (const item of blocks) {
    if (item.type !== "image") continue;
    const meta = pics[img] ?? null;
    if (meta) used[img] = true;
    attachments.push({
      kind: "image",
      name: meta?.path.split(/[\\/]/).at(-1) ?? `Image ${img + 1}`,
      path: meta?.path ?? null,
      note: meta?.note ?? "",
      mimeType: typeof item.mimeType === "string" ? item.mimeType : null,
      ...(typeof item.data === "string" ? { data: item.data } : {}),
    });
    img += 1;
  }
  for (const item of rest) {
    attachments.push({
      kind: "file",
      name: item.path.split(/[\\/]/).at(-1) ?? item.path,
      path: item.path,
      note: item.note,
    });
  }
  for (const [i, item] of pics.entries()) {
    if (used[i]) continue;
    attachments.push({
      kind: "file",
      name: item.path.split(/[\\/]/).at(-1) ?? item.path,
      path: item.path,
      note: item.note,
    });
  }
  return { text: next.text, attachments };
}

function pretty(value: Json | undefined) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  const out = JSON.stringify(value, null, 2);
  return typeof out === "string" ? out : String(value);
}

function strJ(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function recJ(value: Json | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Json>;
}

function toolArgsFromEntry(value: Json | undefined): Record<string, Json> | null {
  const data = recJ(value);
  if (!data) return null;
  const direct = recJ(data.input) ?? recJ(data.arguments) ?? recJ(data.args);
  if (direct) return direct;
  const item = recJ(data.item);
  const nested = item ? (recJ(item.input) ?? recJ(item.arguments) ?? recJ(item.args)) : null;
  if (nested) return nested;
  const source = item ?? data;
  const omit = new Set([
    "id",
    "type",
    "kind",
    "status",
    "result",
    "output",
    "aggregatedOutput",
    "durationMs",
    "duration_ms",
    "exitCode",
    "exit_code",
    "processId",
    "process_id",
    "source",
    "threadId",
    "thread_id",
    "turnId",
    "turn_id",
    "raw",
    "item",
    "details",
    "detail",
    "text",
    "summary",
  ]);
  const next = Object.fromEntries(
    Object.entries(source).filter(([key, val]) => !omit.has(key) && val !== undefined),
  ) as Record<string, Json>;
  return Object.keys(next).length > 0 ? next : null;
}

function toolNameFromEntry(value: Record<string, Json>, fallback: string) {
  const item = recJ(value.item);
  return (
    strJ(value.toolName) ??
    strJ(value.tool_name) ??
    strJ(value.name) ??
    strJ(item?.toolName) ??
    strJ(item?.tool_name) ??
    strJ(item?.name) ??
    strJ(value.itemType) ??
    strJ(item?.type) ??
    strJ(item?.kind) ??
    fallback
  );
}

function toolCallFromEntry(
  name: string,
  id: string | null,
  details: Json | undefined,
): UiToolCallBlock | null {
  const args = toolArgsFromEntry(details);
  if (!args && !name) return null;
  return { type: "toolCall", ...(id ? { id } : {}), name, ...(args ? { arguments: args } : {}) };
}

function isChatRow(row: TimelineRow): row is ChatRow {
  return row.kind !== "work" && row.kind !== "proposed-plan" && row.kind !== "working";
}

function appendMessageRows(rows: TimelineRow[], map: Map<string, number>, entry: UiSessionItem) {
  const msg = entry.message as Record<string, Json>;
  const role = typeof msg.role === "string" ? msg.role : "unknown";

  if (role === "user" || role === "user-with-attachments") {
    const out = user(msg.content);
    rows.push({ id: entry.id, kind: "user", text: out.text, attachments: out.attachments });
    return;
  }

  if (role === "assistant") {
    const items = list(msg.content ?? null);
    const call = items.some((p) => p.type === "toolCall");
    const errText =
      typeof msg.errorMessage === "string" && msg.errorMessage.trim()
        ? String(msg.errorMessage)
        : "";
    let thought = false;
    let acc = "";
    const flush = () => {
      if (!acc.trim()) return;
      rows.push({ id: `${entry.id}:a:${rows.length}`, kind: "assistant", text: clean(acc) });
      acc = "";
    };
    for (const part of items) {
      if (part.type === "thinking") {
        flush();
        const raw = typeof part.thinking === "string" ? part.thinking : "";
        const text = raw.trim();
        const summary =
          typeof part.summary === "string" && clean(part.summary).length > 0
            ? clean(part.summary)
            : null;
        if (!text && !summary) continue;
        thought = true;
        rows.push({ id: `${entry.id}:t:${rows.length}`, kind: "thinking", text, summary });
        continue;
      }
      if (part.type === "text") {
        acc += typeof part.text === "string" ? part.text : "";
        continue;
      }
      if (part.type === "toolCall") {
        flush();
        const key = typeof part.id === "string" ? part.id : `${rows.length}`;
        const n = String(part.name ?? "tool");
        const a = pretty(part.arguments as Json | undefined);
        rows.push({
          id: `${entry.id}:tool:${key}`,
          kind: "tool",
          name: n,
          toolKind: toolKind(n),
          status: toolStatus({ args: a, result: "", error: false }),
          toolUseId: typeof part.id === "string" ? part.id : null,
          args: a,
          result: "",
          error: false,
          call: part as UiToolCallBlock,
          details: null,
        });
        map.set(key, rows.length - 1);
        continue;
      }
    }
    flush();
    if (errText) rows.push({ id: `${entry.id}:a:err`, kind: "assistantError", text: errText });
    const seen = items.some(
      (p) => p.type === "text" && String((p as { text?: string }).text).trim(),
    );
    if (!call && !seen && !errText && !thought)
      rows.push({ id: entry.id, kind: "assistant", text: "..." });
    return;
  }

  if (role === "toolResult") {
    const key = typeof msg.toolCallId === "string" ? msg.toolCallId : "";
    const out = plain(msg.content);
    const pos = key ? map.get(key) : undefined;
    if (typeof pos === "number") {
      const row = rows[pos];
      if (row?.kind === "tool") {
        const merged = typeof msg.toolName === "string" ? msg.toolName : row.name;
        const nextCall =
          row.call ??
          toolCallFromEntry(
            merged,
            typeof msg.toolCallId === "string" ? msg.toolCallId : null,
            msg.details,
          );
        rows[pos] = {
          ...row,
          name: merged,
          toolKind: toolKind(merged),
          result: out,
          error: !!msg.isError,
          status: msg.isError ? "errored" : "completed",
          call: nextCall,
          details: msg.details === undefined ? null : msg.details,
        };
        return;
      }
    }
    const detail = recJ(msg.details);
    const orphan = detail
      ? toolNameFromEntry(detail, typeof msg.toolName === "string" ? msg.toolName : "tool")
      : typeof msg.toolName === "string"
        ? msg.toolName
        : "tool";
    const call = toolCallFromEntry(
      orphan,
      typeof msg.toolCallId === "string" ? msg.toolCallId : null,
      msg.details,
    );
    const args = call?.arguments ? pretty(call.arguments as Json) : "";
    rows.push({
      id: entry.id,
      kind: "tool",
      name: orphan,
      toolKind: toolKind(orphan),
      status: msg.isError ? "errored" : "completed",
      toolUseId: typeof msg.toolCallId === "string" ? msg.toolCallId : null,
      args,
      result: out,
      error: !!msg.isError,
      call,
      details: msg.details === undefined ? null : msg.details,
    });
    return;
  }

  if (role === "custom") {
    if (!msg.display) return;
    const type = typeof msg.customType === "string" ? msg.customType : "custom";
    const body = plain(msg.content);
    const data =
      msg.details && typeof msg.details === "object" && !Array.isArray(msg.details)
        ? (msg.details as Record<string, Json>)
        : null;
    if (type === "approval.requested" || type === "approval.resolved") {
      const rk = isProviderRequestKind(data?.requestKind) ? data.requestKind : null;
      rows.push({
        id: entry.id,
        kind: "approval",
        requestKind: rk,
        summary:
          body || (type === "approval.requested" ? "Approval requested" : "Approval resolved"),
        detail: strJ(data?.detail),
        decision: type === "approval.resolved" ? (strJ(data?.decision) ?? "approved") : null,
      });
      return;
    }
    if (type === "task.started" || type === "task.progress" || type === "task.completed") {
      const s = strJ(data?.status);
      rows.push({
        id: entry.id,
        kind: "taskActivity",
        taskId: strJ(data?.taskId) ?? entry.id,
        summary: body || strJ(data?.summary) || strJ(data?.detail) || "Task update",
        taskStatus:
          type === "task.completed"
            ? s === "failed"
              ? "failed"
              : s === "stopped"
                ? "stopped"
                : "completed"
            : "running",
      });
      return;
    }
    if (type.startsWith("tool.")) return;
    rows.push({ id: entry.id, kind: "custom", name: type, text: body });
    return;
  }

  if (role === "compactionSummary") {
    rows.push({
      id: entry.id,
      kind: "compaction",
      summary: String(msg.summary ?? ""),
      tokens: Number(msg.tokensBefore ?? 0),
    });
    return;
  }

  if (role === "branchSummary") {
    rows.push({ id: entry.id, kind: "branch", summary: String(msg.summary ?? "") });
    return;
  }

  if (role === "bashExecution") {
    rows.push({
      id: entry.id,
      kind: "bash",
      command: String(msg.command ?? ""),
      output: String(msg.output ?? ""),
      code: typeof msg.exitCode === "number" ? msg.exitCode : null,
      cancelled: Boolean(msg.cancelled),
      truncated: Boolean(msg.truncated),
      path: typeof msg.fullOutputPath === "string" ? msg.fullOutputPath : null,
      exclude: Boolean(msg.excludeFromContext),
    });
    return;
  }

  if (role === "system") {
    rows.push({ id: entry.id, kind: "system", text: plain(msg.content) });
    return;
  }

  rows.push({ id: entry.id, kind: "other", role, text: plain(msg.content) });
}

function isProviderRequestKind(value: unknown): value is ProviderRequestKind {
  switch (value) {
    case "command":
    case "file-read":
    case "file-change":
    case "permissions":
    case "mcp-elicitation":
    case "dynamic-tool":
    case "auth-refresh":
      return true;
    default:
      return false;
  }
}

export function parseMessageRows(entry: UiSessionItem): ChatRow[] {
  const rows: TimelineRow[] = [];
  appendMessageRows(rows, new Map<string, number>(), entry);
  return rows.flatMap((row) => (isChatRow(row) ? [row] : []));
}

export function buildChatRows(items: UiSessionItem[]): ChatRow[] {
  const rows: TimelineRow[] = [];
  const map = new Map<string, number>();
  for (const item of items) {
    appendMessageRows(rows, map, item);
  }
  return rows.flatMap((row) => (isChatRow(row) ? [row] : []));
}
