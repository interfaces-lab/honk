import {
  isToolLifecycleItemType,
  type OrchestrationThreadActivity,
  type ProviderRequestKind,
  type ToolLifecycleItemType,
  type TurnId,
} from "@multi/contracts";

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  command?: string;
  rawCommand?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  itemType?: ToolLifecycleItemType;
  requestKind?: ProviderRequestKind;
}

interface DerivedEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): WorkLogEntry[] {
  const ordered = sortActivities(activities);
  const entries = ordered
    .filter((a) => (latestTurnId ? a.turnId === latestTurnId : true))
    .filter((a) => !a.kind.startsWith("tool."))
    .filter((a) => a.kind !== "task.started")
    .filter((a) => a.kind !== "context-window.updated")
    .filter((a) => a.summary !== "Checkpoint captured")
    .filter((a) => !isPlanBoundary(a))
    .map(toDerived);
  const result = collapse(entries).map(({ activityKind: _, collapseKey: _k, ...e }) => e);
  return result;
}

export function sortActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity[] {
  return [...activities].toSorted((l, r) => {
    if (l.sequence !== undefined && r.sequence !== undefined) {
      if (l.sequence !== r.sequence) return l.sequence - r.sequence;
    } else if (l.sequence !== undefined) return 1;
    else if (r.sequence !== undefined) return -1;
    const d = l.createdAt.localeCompare(r.createdAt);
    if (d !== 0) return d;
    const k = rank(l.kind) - rank(r.kind);
    if (k !== 0) return k;
    return l.id.localeCompare(r.id);
  });
}

function rank(kind: string): number {
  if (kind.endsWith(".started") || kind === "tool.started") return 0;
  if (kind.endsWith(".progress") || kind.endsWith(".updated")) return 1;
  if (kind.endsWith(".completed") || kind.endsWith(".resolved")) return 2;
  return 1;
}

function isPlanBoundary(a: OrchestrationThreadActivity): boolean {
  if (a.kind !== "tool.updated" && a.kind !== "tool.completed") return false;
  const p = rec(a.payload);
  return typeof p?.detail === "string" && p.detail.startsWith("ExitPlanMode:");
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function toDerived(a: OrchestrationThreadActivity): DerivedEntry {
  const p = rec(a.payload);
  const cmd = extractCmd(p);
  const files = extractFiles(p);
  const title = str(p?.title);
  const isTask = a.kind === "task.progress" || a.kind === "task.completed";
  const taskSum =
    isTask && typeof p?.summary === "string" && p.summary.length > 0 ? p.summary : null;
  const taskDet =
    isTask && !taskSum && typeof p?.detail === "string" && p.detail.length > 0 ? p.detail : null;
  const label = taskSum || taskDet || a.summary;
  const entry: DerivedEntry = {
    id: a.id,
    createdAt: a.createdAt,
    label,
    tone:
      a.kind === "task.progress"
        ? "thinking"
        : a.tone === "approval"
          ? "info"
          : (a.tone as DerivedEntry["tone"]),
    activityKind: a.kind,
  };
  const itemType = extractItemType(p);
  const rk = extractRequestKind(p);
  if (!taskDet && p && typeof p.detail === "string" && p.detail.length > 0) {
    const d = stripExit(p.detail).output;
    if (d) entry.detail = d;
  }
  if (cmd.command) entry.command = cmd.command;
  if (cmd.rawCommand) entry.rawCommand = cmd.rawCommand;
  if (files.length > 0) entry.changedFiles = files;
  if (title) entry.toolTitle = title;
  if (itemType) entry.itemType = itemType;
  if (rk) entry.requestKind = rk;
  const ck = collapseKey(entry);
  if (ck) entry.collapseKey = ck;
  return entry;
}

function collapse(entries: ReadonlyArray<DerivedEntry>): DerivedEntry[] {
  const out: DerivedEntry[] = [];
  for (const e of entries) {
    const prev = out.at(-1);
    if (prev && shouldCollapse(prev, e)) {
      out[out.length - 1] = merge(prev, e);
      continue;
    }
    out.push(e);
  }
  return out;
}

function shouldCollapse(prev: DerivedEntry, next: DerivedEntry): boolean {
  if (prev.activityKind !== "tool.updated" && prev.activityKind !== "tool.completed") return false;
  if (next.activityKind !== "tool.updated" && next.activityKind !== "tool.completed") return false;
  if (prev.activityKind === "tool.completed") return false;
  return prev.collapseKey !== undefined && prev.collapseKey === next.collapseKey;
}

function merge(prev: DerivedEntry, next: DerivedEntry): DerivedEntry {
  const files = mergeFiles(prev.changedFiles, next.changedFiles);
  return {
    ...prev,
    ...next,
    ...((next.detail ?? prev.detail) ? { detail: next.detail ?? prev.detail } : {}),
    ...((next.command ?? prev.command) ? { command: next.command ?? prev.command } : {}),
    ...((next.rawCommand ?? prev.rawCommand)
      ? { rawCommand: next.rawCommand ?? prev.rawCommand }
      : {}),
    ...(files.length > 0 ? { changedFiles: files } : {}),
    ...((next.toolTitle ?? prev.toolTitle) ? { toolTitle: next.toolTitle ?? prev.toolTitle } : {}),
    ...((next.itemType ?? prev.itemType) ? { itemType: next.itemType ?? prev.itemType } : {}),
    ...((next.requestKind ?? prev.requestKind)
      ? { requestKind: next.requestKind ?? prev.requestKind }
      : {}),
    ...((next.collapseKey ?? prev.collapseKey)
      ? { collapseKey: next.collapseKey ?? prev.collapseKey }
      : {}),
  };
}

function mergeFiles(
  a: ReadonlyArray<string> | undefined,
  b: ReadonlyArray<string> | undefined,
): string[] {
  const m = [...(a ?? []), ...(b ?? [])];
  return m.length === 0 ? [] : [...new Set(m)];
}

function collapseKey(e: DerivedEntry): string | undefined {
  if (e.activityKind !== "tool.updated" && e.activityKind !== "tool.completed") return undefined;
  const label = (e.toolTitle ?? e.label).replace(/\s+(?:complete|completed)\s*$/i, "").trim();
  const detail = e.detail?.trim() ?? "";
  const it = e.itemType ?? "";
  if (label.length === 0 && detail.length === 0 && it.length === 0) return undefined;
  return [it, label, detail].join("\u001f");
}

function stripExit(v: string): { output: string | null; exitCode?: number } {
  const t = v.trim();
  const m = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(t);
  if (!m?.groups) return { output: t.length > 0 ? t : null };
  const code = Number.parseInt(m.groups.code ?? "", 10);
  const out = m.groups.output?.trim() ?? "";
  return {
    output: out.length > 0 ? out : null,
    ...(Number.isInteger(code) ? { exitCode: code } : {}),
  };
}

function extractItemType(p: Record<string, unknown> | null): ToolLifecycleItemType | undefined {
  if (typeof p?.itemType === "string" && isToolLifecycleItemType(p.itemType)) return p.itemType;
  return undefined;
}

function extractRequestKind(
  p: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (isProviderRequestKind(p?.requestKind)) {
    return p.requestKind;
  }
  switch (p?.requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return undefined;
  }
}

function isProviderRequestKind(value: unknown): value is ProviderRequestKind {
  switch (value) {
    case "command":
    case "file-read":
    case "file-change":
      return true;
    default:
      return false;
  }
}

function fmtCmd(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (!Array.isArray(v)) return null;
  const parts = v
    .map((e) => (typeof e === "string" ? e.trim() : null))
    .filter((e): e is string => e !== null);
  return parts.length > 0
    ? parts.map((p) => (/[\s"'`]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p)).join(" ")
    : null;
}

function unwrapShell(v: string): string {
  const t = v.trim();
  const ws = t.search(/\s/);
  if (ws < 0) return t;
  const exe = t.slice(0, ws);
  const rest = t.slice(ws).trim();
  const base = exe.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase() ?? "";
  const specs: Array<{ shells: string[]; pat: RegExp }> = [
    { shells: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"], pat: /(?:^|\s)-command\s+/i },
    { shells: ["cmd", "cmd.exe"], pat: /(?:^|\s)\/c\s+/i },
    { shells: ["bash", "sh", "zsh"], pat: /(?:^|\s)-(?:l)?c\s+/i },
  ];
  const spec = specs.find((s) => s.shells.includes(base));
  if (!spec) return t;
  const m = spec.pat.exec(rest);
  if (!m) return t;
  const cmd = rest.slice(m.index + m[0].length).trim();
  if (!cmd) return t;
  const trimmed = cmd.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const inner = trimmed.slice(1, -1).trim();
    return inner.length > 0 ? inner : t;
  }
  return cmd;
}

function extractCmd(p: Record<string, unknown> | null): {
  command: string | null;
  rawCommand: string | null;
} {
  const data = rec(p?.data);
  const item = rec(data?.item);
  const result = rec(item?.result);
  const input = rec(item?.input);
  const itemType = str(p?.itemType);
  const detail = str(p?.detail);
  const candidates: unknown[] = [
    item?.command,
    input?.command,
    result?.command,
    data?.command,
    itemType === "command_execution" && detail ? stripExit(detail).output : null,
  ];
  for (const c of candidates) {
    const raw = fmtCmd(c);
    if (!raw) continue;
    const cmd = unwrapShell(raw);
    return { command: cmd, rawCommand: raw === cmd ? null : raw };
  }
  return { command: null, rawCommand: null };
}

function pushFile(target: string[], seen: Set<string>, v: unknown) {
  const n = str(v);
  if (!n || seen.has(n)) return;
  seen.add(n);
  target.push(n);
}

function collectFiles(v: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) return;
  if (Array.isArray(v)) {
    for (const e of v) {
      collectFiles(e, target, seen, depth + 1);
      if (target.length >= 12) return;
    }
    return;
  }
  const r = rec(v);
  if (!r) return;
  for (const k of ["path", "filePath", "relativePath", "filename", "newPath", "oldPath"])
    pushFile(target, seen, r[k]);
  for (const k of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(k in r)) continue;
    collectFiles(r[k], target, seen, depth + 1);
    if (target.length >= 12) return;
  }
}

function extractFiles(p: Record<string, unknown> | null): string[] {
  const out: string[] = [];
  collectFiles(rec(p?.data), out, new Set(), 0);
  return out;
}
