import type { Json, UiToolCallBlock } from "~/lib/ui-session-types";
import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import { memo } from "react";
import { ChatMarkdown } from "./chat-markdown";
import { cn } from "./utils";

export interface ToolData {
  name: string;
  call: UiToolCallBlock | null;
  args: string;
  result: string;
  error: boolean;
  details: Json | null;
  expanded: boolean;
  embedded?: boolean;
}

type Render = (data: ToolData) => React.ReactNode;

const renderers = new Map<string, Render>();

function register(name: string, fn: Render) {
  renderers.set(name, fn);
}

export function resolvedToolName(name: string): string {
  const n = name.toLowerCase();
  if (
    n === "str_replace" ||
    n === "search_replace" ||
    n === "replace" ||
    n === "apply_patch" ||
    n === "patch" ||
    n === "multi_edit"
  ) {
    return "edit";
  }
  if (n === "filechange" || n === "file_change") return "edit";
  if (
    n === "run_terminal_cmd" ||
    n === "run_command" ||
    n === "shell" ||
    n === "commandexecution" ||
    n === "command_execution" ||
    n === "terminal"
  )
    return "bash";
  if (n === "fileread" || n === "file_read") return "read";
  if (n === "list_dir" || n === "directory_list") return "ls";
  if (n === "web_search") return "websearch";
  return n;
}

export function humanTool(name: string) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (hit) => hit.toUpperCase());
}

export function toolBody(data: ToolData): React.ReactNode {
  const fn = renderers.get(resolvedToolName(data.name));
  if (fn) return fn(data);
  return fallback(data);
}

export function toolBodyEmbedded(data: Omit<ToolData, "embedded">): React.ReactNode {
  const d = { ...data, embedded: true };
  const r = resolvedToolName(d.name);

  if (r === "edit") return editEmbedded(d);
  if (r === "write") return writeEmbedded(d);
  if (r === "read") return readEmbedded(d);
  if (r === "bash") return bashEmbedded(d);

  return fallbackEmbedded(d);
}

export { type FileDiffMetadata };

function toolDetailsRecord(details: Json | null): Record<string, Json> | null {
  if (details === null || typeof details !== "object" || Array.isArray(details)) return null;
  return details as Record<string, Json>;
}

export function toolFileDiff(name: string, call: UiToolCallBlock | null): FileDiffMetadata | null {
  const r = resolvedToolName(name);
  const raw = (call?.arguments ?? {}) as Record<string, Json>;
  const path = editPath(raw);
  if (!path) return null;

  if (r === "write") {
    const body = typeof raw.content === "string" ? raw.content : "";
    if (!body.trim()) return null;
    return parseDiffFromFile({ name: path, contents: "" }, { name: path, contents: body });
  }

  if (r === "edit") {
    const args = raw as EditArgs;
    const list = edits(args);
    if (list.length === 0 && !args.patch) return null;
    const old = list.map((e) => e.oldText ?? "").join("\n");
    const next = list.map((e) => e.newText ?? "").join("\n");
    return parseDiffFromFile({ name: path, contents: old }, { name: path, contents: next });
  }

  return null;
}

/** Line additions / deletions for tool-call diff header (+n / -m), same rules as git diff stats. */
export function toolDiffStat(diff: FileDiffMetadata | null): { add: number; del: number } {
  if (!diff) return { add: 0, del: 0 };
  return diff.hunks.reduce(
    (sum, hunk) =>
      hunk.hunkContent.reduce(
        (cur, row) => {
          if (row.type !== "change") return cur;
          return {
            add: cur.add + row.additions,
            del: cur.del + row.deletions,
          };
        },
        { add: sum.add, del: sum.del },
      ),
    { add: 0, del: 0 },
  );
}

export function isFileTool(name: string) {
  const r = resolvedToolName(name);
  return r === "edit" || r === "write";
}

export function isShellTool(name: string, call: UiToolCallBlock | null, argsJson?: string) {
  if (resolvedToolName(name) === "bash") return true;
  const args = call?.arguments;
  if (
    args &&
    typeof args === "object" &&
    typeof (args as { command?: Json }).command === "string"
  ) {
    return true;
  }
  if (!argsJson?.trim()) return false;
  try {
    const o = JSON.parse(argsJson) as Json;
    if (
      o &&
      typeof o === "object" &&
      "command" in o &&
      typeof (o as { command: Json }).command === "string"
    ) {
      return true;
    }
  } catch {}
  return false;
}

export function toolHint(call: UiToolCallBlock | null): string | null {
  const args = call?.arguments;
  if (!args || typeof args !== "object") return null;

  const desc = args.description;
  if (typeof desc === "string" && desc.trim()) return desc.trim().slice(0, 72);

  for (const key of ["command", "path", "pattern", "query", "file", "url"]) {
    const val = args[key];
    if (typeof val === "string" && val.trim()) return val.trim().slice(0, 72);
  }

  const keys = Object.keys(args);
  if (keys.length === 0) return null;
  return `${keys.length} arg${keys.length === 1 ? "" : "s"}`;
}

function editPath(args: Record<string, Json>) {
  const path = args.path ?? args.file ?? args.target_file ?? args.file_path;
  if (typeof path === "string" && path.trim()) return path;
  const multi = args.multi;
  if (Array.isArray(multi) && multi[0] && typeof multi[0] === "object") {
    const p = (multi[0] as { path?: string }).path;
    if (typeof p === "string" && p.trim()) return p;
  }
  return "";
}

export function toolPathFromCall(call: UiToolCallBlock | null, argsJson?: string): string | null {
  const raw = call?.arguments;
  if (raw && typeof raw === "object") {
    const p = editPath(raw as Record<string, Json>).trim();
    if (p) return p;
  }
  if (!argsJson?.trim()) return null;
  try {
    const o = JSON.parse(argsJson) as Json;
    if (o && typeof o === "object") {
      const p = editPath(o as Record<string, Json>).trim();
      return p || null;
    }
  } catch {}
  return null;
}

export function toolLabel(name: string, call: UiToolCallBlock | null): string | null {
  const args = call?.arguments;
  if (!args || typeof args !== "object") return null;
  const r = resolvedToolName(name);

  if (r === "edit" || r === "write") {
    const path = editPath(args as Record<string, Json>);
    if (path.trim()) return basename(path);
    return null;
  }

  if (r === "bash") {
    const desc = args.description;
    if (typeof desc === "string" && desc.trim()) return desc.trim();
    return null;
  }

  return null;
}

function lineDelta(oldText: string, newText: string) {
  const o = oldText.split("\n");
  const n = newText.split("\n");
  const os = new Set(o);
  const ns = new Set(n);
  let add = 0;
  for (const l of n) if (!os.has(l)) add += 1;
  let del = 0;
  for (const l of o) if (!ns.has(l)) del += 1;
  return { add, del };
}

export function toolStats(
  name: string,
  call: UiToolCallBlock | null,
): { add: number; del: number } | null {
  if (resolvedToolName(name) !== "edit") return null;
  const args = (call?.arguments ?? {}) as EditArgs;
  const list = edits(args);
  if (list.length === 0 && !args.patch) return null;

  let add = 0;
  let del = 0;
  for (const entry of list) {
    const d = lineDelta(entry.oldText ?? "", entry.newText ?? "");
    add += d.add;
    del += d.del;
  }
  return { add, del };
}

const exts: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  md: "markdown",
  mdx: "mdx",
  py: "python",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

function langFor(path: string | null) {
  if (!path) return "";
  const pos = path.lastIndexOf(".");
  if (pos < 0 || pos === path.length - 1) return "";
  return exts[path.slice(pos + 1).toLowerCase()] ?? "";
}

function fenced(text: string, lang: string) {
  const body = text.replace(/\r\n/g, "\n");
  const head = body.trimStart();
  if (head.startsWith("```") || head.startsWith("~~~")) return body;
  let mark = "```";
  while (body.includes(mark)) mark += "`";
  return `${mark}${lang}\n${body}\n${mark}`;
}

function basename(path: string) {
  const pos = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return pos < 0 ? path : path.slice(pos + 1);
}

/** Plain tool output: no Streamdown code-block chrome (avoids white cards + horizontal-only scroll). */
const ToolTerminal = memo(function ToolTerminal(props: { text: string; error?: boolean }) {
  if (!props.text.trim()) return null;
  return (
    <pre
      className={cn(
        "tool-terminal max-h-[min(24rem,50vh)] w-full max-w-full overflow-y-auto whitespace-pre-wrap break-words font-multi-mono text-detail/[1.625]",
        props.error ? "text-destructive/90" : "text-foreground/85",
      )}
    >
      {props.text}
    </pre>
  );
});

function isPlainToolLang(lang: string | undefined) {
  const l = (lang ?? "").toLowerCase();
  return l === "" || l === "text" || l === "bash" || l === "sh" || l === "zsh" || l === "shell";
}

const CodeRaw = memo(function CodeRaw(props: { text: string; lang?: string }) {
  if (!props.text.trim()) return null;
  return <ChatMarkdown variant="tool">{fenced(props.text, props.lang ?? "")}</ChatMarkdown>;
});

const Code = memo(function Code(props: { text: string; lang?: string; error?: boolean }) {
  if (!props.text.trim()) return null;
  if (isPlainToolLang(props.lang)) {
    return (
      <ToolTerminal
        text={props.text}
        {...(props.error !== undefined ? { error: props.error } : {})}
      />
    );
  }
  return (
    <div
      className={cn(
        "embed-code max-h-[min(24rem,50vh)] overflow-auto",
        props.error ? "rounded-sm bg-destructive/[0.08] px-2 py-1.5" : "tool-output-surface",
      )}
    >
      <CodeRaw text={props.text} {...(props.lang ? { lang: props.lang } : {})} />
    </div>
  );
});

function Result(props: { text: string; error: boolean; lang?: string }) {
  if (!props.text.trim()) return null;
  if (isPlainToolLang(props.lang)) {
    return <ToolTerminal text={props.text} error={props.error} />;
  }
  return (
    <div
      className={cn(
        "embed-code max-h-[min(24rem,50vh)] overflow-auto",
        props.error ? "rounded-sm bg-destructive/[0.08] px-2 py-1.5" : "tool-output-surface",
      )}
    >
      <CodeRaw text={props.text} {...(props.lang ? { lang: props.lang } : {})} />
    </div>
  );
}

function Truncation(props: { truncated: boolean; limit?: number; noun: string }) {
  if (!props.truncated && props.limit == null) return null;
  return (
    <div className="text-caption/[1.2] text-muted-foreground/50">
      {typeof props.limit === "number" && `${props.limit} ${props.noun} limit reached. `}
      {props.truncated && "Output truncated."}
    </div>
  );
}

interface ReadArgs {
  path?: string;
  offset?: number;
  limit?: number;
}

function read(data: ToolData): React.ReactNode {
  const args = (data.call?.arguments ?? {}) as ReadArgs;
  const path = args.path ?? "";
  const lang = langFor(path);

  if (!data.expanded) {
    const text = data.result || data.args;
    if (!text.trim()) return null;
    return <Code text={text} lang={lang || "text"} error={data.error} />;
  }

  return <Result text={data.result} error={data.error} lang={lang || "text"} />;
}

interface EditEntry {
  oldText?: string;
  newText?: string;
}

interface EditArgs {
  path?: string;
  edits?: EditEntry[];
  oldText?: string;
  newText?: string;
  multi?: Array<{ path?: string; oldText?: string; newText?: string }>;
  patch?: string;
}

function edits(args: EditArgs): EditEntry[] {
  if (Array.isArray(args.edits) && args.edits.length > 0) return args.edits;
  if (typeof args.oldText === "string") {
    return [
      { oldText: args.oldText, ...(args.newText !== undefined ? { newText: args.newText } : {}) },
    ];
  }
  if (Array.isArray(args.multi)) {
    return args.multi.map((m) => ({
      ...(m.oldText !== undefined ? { oldText: m.oldText } : {}),
      ...(m.newText !== undefined ? { newText: m.newText } : {}),
    }));
  }
  return [];
}

function unified(entry: EditEntry): React.ReactNode[] {
  const old = (entry.oldText ?? "").split("\n");
  const next = (entry.newText ?? "").split("\n");
  const lines: React.ReactNode[] = [];

  for (const l of old) {
    lines.push(
      <div key={`d${lines.length}`} className="bg-multi-diff-deletion-bg text-multi-diff-deletion">
        <span className="select-none opacity-50">- </span>
        {l}
      </div>,
    );
  }
  for (const l of next) {
    lines.push(
      <div key={`a${lines.length}`} className="bg-multi-diff-addition-bg text-multi-diff-addition">
        <span className="select-none opacity-50">+ </span>
        {l}
      </div>,
    );
  }
  return lines;
}

function DiffRaw(props: { entries: EditEntry[] }) {
  const lines = props.entries.flatMap(unified);
  if (lines.length === 0) return null;
  return (
    <div className="font-[family-name:var(--multi-font-mono)] text-detail/[1.4] whitespace-pre-wrap">
      {lines}
    </div>
  );
}

function Diff(props: { entries: EditEntry[] }) {
  const lines = props.entries.flatMap(unified);
  if (lines.length === 0) return null;
  return (
    <div className="overflow-hidden">
      <div className="max-h-[min(24rem,50vh)] overflow-auto font-[family-name:var(--multi-font-mono)] text-detail/[1.4] whitespace-pre-wrap">
        {lines}
      </div>
    </div>
  );
}

function edit(data: ToolData): React.ReactNode {
  const raw = (data.call?.arguments ?? {}) as EditArgs & Record<string, Json>;
  const args = raw as EditArgs;
  const entries = edits(args);

  if (!data.expanded) {
    if (data.error && data.result.trim()) return <Code text={data.result} lang="text" error />;
    if (entries.length > 0) return <Diff entries={entries} />;
    if (args.patch) return <Code text={args.patch} lang="diff" />;
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      {args.patch ? <Code text={args.patch} lang="diff" /> : <Diff entries={entries} />}
      {data.error && data.result.trim() && <Result text={data.result} error lang="text" />}
    </div>
  );
}

interface WriteArgs {
  path?: string;
  content?: string;
}

function write(data: ToolData): React.ReactNode {
  const args = (data.call?.arguments ?? {}) as WriteArgs;
  const body = args.content ?? "";

  if (!data.expanded) {
    if (data.error && data.result.trim()) return <Code text={data.result} lang="text" error />;
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      {body && <Diff entries={[{ newText: body }]} />}
      {data.error && data.result.trim() && <Result text={data.result} error lang="text" />}
    </div>
  );
}

interface BashArgs {
  command?: string;
  timeout?: number;
}

function bash(data: ToolData): React.ReactNode {
  const args = (data.call?.arguments ?? {}) as BashArgs;
  const cmd = args.command ?? "";

  if (!data.expanded) {
    const text = data.result || cmd;
    if (!text.trim()) return null;
    return <Code text={text} lang="bash" error={data.error} />;
  }

  const out = data.result.trim();
  const combined = [cmd.trim() ? `$ ${cmd}` : "", out].filter(Boolean).join("\n\n");

  return (
    <div className="flex flex-col gap-1">
      {args.timeout != null ? (
        <div className="text-caption text-muted-foreground/50">{args.timeout}s timeout</div>
      ) : null}
      {combined.trim() ? <ToolTerminal text={combined} error={data.error} /> : null}
    </div>
  );
}

function grep(data: ToolData): React.ReactNode {
  if (!data.expanded) {
    const text = data.result || data.args;
    if (!text.trim()) return null;
    return <Code text={text} lang="text" error={data.error} />;
  }

  const dr = toolDetailsRecord(data.details);
  return (
    <div className="flex flex-col gap-1">
      <Result text={data.result} error={data.error} lang="text" />
      <Truncation
        truncated={dr?.truncation != null}
        {...(typeof dr?.matchLimitReached === "number" ? { limit: dr.matchLimitReached } : {})}
        noun="match"
      />
    </div>
  );
}

function find(data: ToolData): React.ReactNode {
  if (!data.expanded) {
    const text = data.result || data.args;
    if (!text.trim()) return null;
    return <Code text={text} lang="text" error={data.error} />;
  }

  const dr = toolDetailsRecord(data.details);
  return (
    <div className="flex flex-col gap-1">
      <Result text={data.result} error={data.error} lang="text" />
      <Truncation
        truncated={dr?.truncation != null}
        {...(typeof dr?.resultLimitReached === "number" ? { limit: dr.resultLimitReached } : {})}
        noun="results"
      />
    </div>
  );
}

function ask(data: ToolData): React.ReactNode {
  if (!data.result.trim()) return null;
  return <Result text={data.result} error={data.error} lang="text" />;
}

function ls(data: ToolData): React.ReactNode {
  if (!data.expanded) {
    const text = data.result || data.args;
    if (!text.trim()) return null;
    return <Code text={text} lang="text" error={data.error} />;
  }

  const dr = toolDetailsRecord(data.details);
  return (
    <div className="flex flex-col gap-1">
      <Result text={data.result} error={data.error} lang="text" />
      <Truncation
        truncated={dr?.truncation != null}
        {...(typeof dr?.entryLimitReached === "number" ? { limit: dr.entryLimitReached } : {})}
        noun="entries"
      />
    </div>
  );
}

function fallback(data: ToolData): React.ReactNode {
  if (!data.expanded) {
    const text = data.result || data.args;
    if (!text.trim()) return null;
    const lang = looksJson(text) ? "json" : "text";
    return <Code text={text} lang={lang} error={data.error} />;
  }

  const argsT = data.args.trim();
  const resT = data.result.trim();
  const argsJson = argsT && looksJson(data.args);
  const resJson = resT && looksJson(data.result);
  if (argsT && resT && !argsJson && !resJson) {
    return (
      <ToolTerminal
        text={`${data.args.trim()}\n\n---\n\n${data.result.trim()}`}
        error={data.error}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {argsT ? <Code text={data.args} lang={argsJson ? "json" : "text"} /> : null}
      {resT ? (
        <Result text={data.result} error={data.error} lang={resJson ? "json" : "text"} />
      ) : null}
    </div>
  );
}

function looksJson(text: string) {
  const head = text.trimStart();
  return head[0] === "{" || head[0] === "[";
}

register("read", read);
register("edit", edit);
register("write", write);
register("bash", bash);
register("grep", grep);
register("find", find);
register("ask", ask);
register("ls", ls);

export const TOOL_RENDERER_KEYS = [
  "read",
  "edit",
  "write",
  "bash",
  "grep",
  "find",
  "ask",
  "ls",
] as const;

// Embedded renderers: same logic but without outer wrapper containers
// for use inside collapsible panels that already provide structure

function readEmbedded(data: ToolData): React.ReactNode {
  const args = (data.call?.arguments ?? {}) as ReadArgs;
  const path = args.path ?? "";
  const lang = langFor(path);
  const text = data.result || data.args;
  if (!text.trim()) return null;
  return <CodeRaw text={text} lang={lang || "text"} />;
}

function editEmbedded(data: ToolData): React.ReactNode {
  const raw = (data.call?.arguments ?? {}) as EditArgs & Record<string, Json>;
  const args = raw as EditArgs;
  const entries = edits(args);

  if (data.error && data.result.trim()) {
    return <CodeRaw text={data.result} lang="text" />;
  }
  if (entries.length > 0) {
    return <DiffRaw entries={entries} />;
  }
  if (args.patch) {
    return <CodeRaw text={args.patch} lang="diff" />;
  }
  return null;
}

function writeEmbedded(data: ToolData): React.ReactNode {
  const args = (data.call?.arguments ?? {}) as WriteArgs;
  const body = args.content ?? "";

  if (data.error && data.result.trim()) {
    return <CodeRaw text={data.result} lang="text" />;
  }
  if (body) {
    return <DiffRaw entries={[{ newText: body }]} />;
  }
  return null;
}

function bashEmbedded(data: ToolData): React.ReactNode {
  const args = (data.call?.arguments ?? {}) as BashArgs;
  const text = data.result || args.command || "";
  if (!text.trim()) return null;
  return <CodeRaw text={text} lang="bash" />;
}

function fallbackEmbedded(data: ToolData): React.ReactNode {
  const text = data.result || data.args;
  if (!text.trim()) return null;
  const lang = looksJson(text) ? "json" : "text";
  return <CodeRaw text={text} lang={lang} />;
}
