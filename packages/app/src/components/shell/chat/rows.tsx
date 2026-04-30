// @ts-nocheck
import type { UiWorkingState, Json } from "~/lib/ui-session-types";
import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { Collapsible } from "@multi/ui/collapsible";
import {
  IconBrain,
  IconChevronBottom,
  IconClipboard,
  IconConsole,
  IconCrossSmall,
  IconFileBend,
  IconImages1,
  IconLoader,
  IconToolbox,
} from "central-icons";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { ChatMarkdown } from "~/lib/chat-markdown";
import { useDiffStylePreference } from "~/hooks/use-environment-git";
import { useTheme } from "~/hooks/use-theme";
import { userAttachmentFileRow, userAttachmentImageCard } from "~/lib/chat-attachment-styles";
import {
  type ChatRow,
  type ChatUserAttachment,
  type TimelineRow,
  type ToolCallStatus,
} from "~/lib/chat-timeline";
import type { WorkLogEntry } from "~/lib/work-log";
import type { ProposedPlan } from "~/types";
import { VsFileIcon } from "~/lib/vscode-file-icon";
import {
  humanTool,
  isFileTool,
  isShellTool,
  resolvedToolName,
  toolBody,
  toolDiffStat,
  toolFileDiff,
  toolPathFromCall,
} from "~/lib/tool-renderers";
import { cn } from "~/lib/utils";

/* ── Card primitives (Cursor-matched) ─────────────────────────────── */

function CardShell(props: { children: React.ReactNode; className?: string }) {
  return (
    <li
      className={cn(
        "min-w-0 overflow-hidden rounded-[10px] border border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] bg-[color-mix(in_srgb,var(--background)_94%,transparent)]",
        props.className,
      )}
    >
      {props.children}
    </li>
  );
}

function CardTrigger(props: {
  icon?: React.ReactNode;
  open: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Collapsible.Trigger
      className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] focus:outline-none focus-visible:outline-none focus-visible:ring-0"
      {...(props.title ? { title: props.title } : {})}
    >
      {props.icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] [&>svg]:size-3.5">
          {props.icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {props.children}
      </div>
      <IconChevronBottom
        className={cn(
          "size-3 shrink-0 text-[color-mix(in_srgb,var(--foreground)_50%,transparent)] transition-transform duration-200",
          !props.open && "-rotate-90",
        )}
      />
    </Collapsible.Trigger>
  );
}

function CardPanel(props: { children: React.ReactNode; className?: string }) {
  return (
    <Collapsible.Panel>
      <div
        className={cn(
          "flex flex-col gap-1.5 border-t border-[color-mix(in_srgb,var(--foreground)_6%,transparent)]",
          props.className,
        )}
      >
        {props.children}
      </div>
    </Collapsible.Panel>
  );
}

function CardTitle(props: { children: React.ReactNode }) {
  return (
    <span className="min-w-0 shrink-0 truncate text-[13px] font-medium leading-[18px] text-foreground">
      {props.children}
    </span>
  );
}

function CardSummary(props: { mono?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-[13px] leading-[18px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]",
        props.mono && "font-multi-mono text-[12px]",
      )}
    >
      {props.children}
    </span>
  );
}

/* ── Shared hooks / helpers ───────────────────────────────────────── */

function useSyncedExpand(expanded: boolean) {
  const [open, setOpen] = useState(expanded);
  useEffect(() => {
    setOpen(expanded);
  }, [expanded]);
  return [open, setOpen] as const;
}

type RuntimeState = ToolCallStatus;

function runtimeState(row: ChatRow): RuntimeState {
  if (row.kind === "tool") return row.status;
  if (row.kind === "bash") {
    if (row.cancelled) return "errored";
    if (row.code !== null && row.code !== 0) return "errored";
    if (row.output.trim() || row.code !== null) return "completed";
    return "running";
  }
  return "completed";
}

function StatusBadge(props: { state: RuntimeState; label?: string }) {
  if (props.state === "completed" && !props.label) return null;
  if (props.state === "errored") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[12px] leading-[16px] text-destructive/90">
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[12px] leading-[16px] text-[color-mix(in_srgb,var(--foreground)_50%,transparent)]">
      {(props.state === "pending" || props.state === "running") && (
        <IconLoader className="size-2.5 shrink-0 animate-spin" />
      )}
      {props.label}
    </span>
  );
}

/* ── Card composite (replaces RuntimeRailCard) ────────────────────── */

function Card(props: {
  icon?: React.ReactNode;
  title: string;
  summary?: string | null;
  trailing?: React.ReactNode;
  expanded: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useSyncedExpand(props.expanded);
  return (
    <CardShell>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <CardTrigger icon={props.icon} open={open}>
          <CardTitle>{props.title}</CardTitle>
          {props.summary ? <CardSummary>{props.summary}</CardSummary> : null}
          {props.trailing ? <span className="shrink-0">{props.trailing}</span> : null}
        </CardTrigger>
        <CardPanel>{props.children}</CardPanel>
      </Collapsible.Root>
    </CardShell>
  );
}

/* ── Human bubble / assistant ─────────────────────────────────────── */

const AttachmentTile = memo(function AttachmentTile(props: { item: ChatUserAttachment }) {
  if (props.item.kind === "image") {
    return (
      <div className={userAttachmentImageCard}>
        {props.item.data ? (
          <img
            alt={props.item.name}
            className="aspect-[4/3] w-full object-cover"
            src={`data:${props.item.mimeType ?? "image/png"};base64,${props.item.data}`}
          />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center bg-multi-hover/20 text-muted-foreground/70">
            <IconImages1 className="size-7" />
          </div>
        )}
        <div className="flex flex-col gap-1 px-3 py-2">
          <div className="truncate text-body/[1.2] font-medium text-foreground/85">
            {props.item.name}
          </div>
          {props.item.note ? (
            <div className="line-clamp-2 text-detail/[1.35] text-muted-foreground/80">
              {props.item.note}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={userAttachmentFileRow}>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-multi-card bg-multi-hover/25 text-muted-foreground/75">
        <IconFileBend className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body/[1.2] font-medium text-foreground/85">
          {props.item.name}
        </span>
        <span className="block truncate text-detail/[1.2] text-muted-foreground/75">
          {props.item.path}
        </span>
        {props.item.note ? (
          <span className="mt-1 line-clamp-2 block text-detail/[1.35] text-muted-foreground/75">
            {props.item.note}
          </span>
        ) : null}
      </span>
    </div>
  );
});

const HumanBubble = memo(function HumanBubble(props: {
  text: string;
  attachments: ChatUserAttachment[];
}) {
  return (
    <li className="flex min-w-0 justify-end">
      <div className="flex max-w-[min(100%,38rem)] flex-col items-end gap-2">
        {props.attachments.length ? (
          <div className="flex max-w-full flex-wrap justify-end gap-2">
            {props.attachments.map((item) => (
              <AttachmentTile
                key={`${item.kind}:${item.path ?? item.name}:${item.note}`}
                item={item}
              />
            ))}
          </div>
        ) : null}
        {props.text ? (
          <div className="max-w-[min(100%,36rem)] whitespace-pre-wrap break-words rounded-[20px] border border-multi-border/40 bg-multi-active px-3.5 py-2 text-body/5 text-foreground shadow-multi-card backdrop-blur-sm">
            {props.text}
          </div>
        ) : null}
      </div>
    </li>
  );
});

const AssistantBlock = memo(function AssistantBlock(props: { text: string }) {
  return (
    <li className="min-w-0 py-1">
      <ChatMarkdown>{props.text}</ChatMarkdown>
    </li>
  );
});

const ThinkingBlock = memo(function ThinkingBlock(props: { text: string; summary: string | null }) {
  const content = props.text || props.summary || "";
  if (!content) return null;
  return (
    <li className="min-w-0 py-1">
      <div className="text-foreground/75">
        <ChatMarkdown>{content}</ChatMarkdown>
      </div>
    </li>
  );
});

/* ── Working / streaming state ────────────────────────────────────── */

function workSpan(ms: number) {
  if (!Number.isFinite(ms) || ms < 1_000) return "0s";
  const sec = Math.floor(ms / 1_000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  if (min < 60) return rest > 0 ? `${min}m ${rest}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const left = min % 60;
  return left > 0 ? `${hr}h ${left}m` : `${hr}h`;
}

function workLabel(since: string | null, now: number) {
  if (!since) return "Working...";
  const start = Date.parse(since);
  if (Number.isNaN(start)) return "Working...";
  return `Working for ${workSpan(Math.max(0, now - start))}`;
}

function workTitle(work: UiWorkingState | null) {
  const text =
    work?.summary?.trim() ||
    work?.task?.summary?.trim() ||
    work?.task?.description?.trim() ||
    work?.tool?.title?.trim() ||
    "Thinking";
  const line = text.split(/\r?\n/u, 1)[0] ?? "Thinking";
  return line.length <= 56 ? line : `${line.slice(0, 53)}\u2026`;
}

function workMeta(work: UiWorkingState | null) {
  if (work?.tool?.title?.trim()) return work.tool.title.trim();
  if (work?.tool?.detail?.trim()) return work.tool.detail.trim();
  if (work?.task?.description?.trim()) return work.task.description.trim();
  return null;
}

function workBody(work: UiWorkingState | null) {
  const head = work?.summary?.trim() || work?.task?.summary?.trim() || null;
  const text = work?.text.trim() || null;
  const meta = workMeta(work);
  const showHead = Boolean(head && head !== text);

  if (!meta && !showHead && !text) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2 pt-1.5 pb-2">
      {meta ? <div className="text-detail/[1.45] text-muted-foreground/68">{meta}</div> : null}
      {showHead && head ? (
        <div className="min-w-0 text-body/[1.5] text-foreground/82">
          <ChatMarkdown>{head}</ChatMarkdown>
        </div>
      ) : null}
      {text ? (
        <pre className="tool-terminal max-h-[min(40vh,20rem)] whitespace-pre-wrap break-words text-body/[1.5] text-foreground/88">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

const ChatWorkingRow = memo(function ChatWorkingRow(props: {
  work: UiWorkingState | null;
  busy: boolean;
  thinking: boolean;
  since: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!props.busy) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearInterval(id);
    };
  }, [props.busy]);

  if (!props.busy && !props.work) return null;

  if (!props.work || (!props.work.tool && !props.work.task)) {
    if (props.thinking) return null;
    return (
      <li className="min-w-0 py-0.5">
        <div className="px-1 text-body/[1.375]">
          <span className="thinking-shimmer text-muted-foreground/68">
            {workLabel(props.work?.startedAt ?? props.since, now)}
          </span>
        </div>
      </li>
    );
  }

  return (
    <Card
      icon={<IconBrain className="size-3 shrink-0 text-foreground/48" />}
      title={workTitle(props.work)}
      trailing={
        <StatusBadge state="running" label={workLabel(props.work.startedAt ?? props.since, now)} />
      }
      expanded={Boolean(props.work.summary?.trim() || props.work.text.trim())}
    >
      {workBody(props.work)}
    </Card>
  );
});

/* ── Rich output helpers ──────────────────────────────────────────── */

function linkRowKey(l: { url: string; title?: string; snippet?: string }) {
  return `${l.url}\0${l.title ?? ""}\0${l.snippet ?? ""}`;
}

function renderValue(value: Json | undefined, depth: number, path = "$"): React.ReactNode {
  if (value === null) return <span className="text-destructive/80">null</span>;
  if (value === undefined) return <span className="text-muted-foreground/60">undefined</span>;
  if (typeof value === "boolean")
    return <span className="text-accent-foreground">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-info-foreground">{value}</span>;
  if (typeof value === "string") {
    if (value.length > 200 && depth > 0) {
      return (
        <span className="text-success-foreground/90">
          &ldquo;{value.slice(0, 200)}&hellip;&rdquo;
        </span>
      );
    }
    return <span className="text-success-foreground/90">&ldquo;{value}&rdquo;</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground/50">[]</span>;
    return (
      <span>
        <span className="text-muted-foreground/50">[</span>
        <div className="pl-4">
          {value.map((item, i) => {
            const childPath = `${path}[${String(i)}]`;
            return (
              <div key={childPath}>
                {renderValue(item, depth + 1, childPath)}
                {i < value.length - 1 && <span className="text-muted-foreground/50">,</span>}
              </div>
            );
          })}
        </div>
        <span className="text-muted-foreground/50">]</span>
      </span>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, Json>);
    if (entries.length === 0) return <span className="text-muted-foreground/50">{"{}"}</span>;
    return (
      <span>
        <span className="text-muted-foreground/50">{"{"}</span>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 pl-4">
          {entries.map(([key, val], i) => (
            <React.Fragment key={`${path}.${key}`}>
              <span className="text-primary/80 font-medium">{key}</span>
              <span className="text-muted-foreground/40">:</span>
              <span className="min-w-0">{renderValue(val, depth + 1, `${path}.${key}`)}</span>
              {i < entries.length - 1 && <span className="text-muted-foreground/50">,</span>}
            </React.Fragment>
          ))}
        </div>
        <span className="text-muted-foreground/50">{"}"}</span>
      </span>
    );
  }
  return <span className="text-muted-foreground/60">{String(value)}</span>;
}

function extractLinksFromPayload(
  data: Json | undefined,
): Array<{ url: string; title?: string; snippet?: string }> {
  const out: Array<{ url: string; title?: string; snippet?: string }> = [];
  const add = (u: Json | undefined, t?: Json, s?: Json) => {
    if (typeof u !== "string" || !u.startsWith("http")) return;
    const item: { url: string; title?: string; snippet?: string } = { url: u };
    if (typeof t === "string") item.title = t;
    if (typeof s === "string") item.snippet = s;
    out.push(item);
  };
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object") {
        const o = item as Record<string, Json>;
        add(o.url ?? o.href ?? o.link, o.title ?? o.name, o.snippet ?? o.description);
      }
    }
    if (out.length) return out;
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, Json>;
    const nested = o.results ?? o.links ?? o.items ?? o.visited ?? o.sources;
    if (Array.isArray(nested)) return extractLinksFromPayload(nested);
    add(o.url, o.title, o.snippet);
    if (out.length) return out;
  }
  return out;
}

function JsonSection(props: { label: string; text: string }) {
  if (!props.text.trim()) return null;

  const parsed = useMemo(() => {
    try {
      return JSON.parse(props.text);
    } catch {
      return null;
    }
  }, [props.text]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(props.text);
  }, [props.text]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-detail/[1.1] font-medium tracking-wide text-muted-foreground/45 uppercase">
          {props.label}
        </span>
        <button
          onClick={copy}
          className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-muted-foreground/40 transition-colors hover:bg-multi-hover/20 hover:text-muted-foreground/70"
        >
          <IconClipboard className="size-3" />
          <span>copy</span>
        </button>
      </div>
      {parsed !== null ? (
        <div className="tool-output-surface font-multi-mono text-detail/[1.5]">
          {renderValue(parsed, 0)}
        </div>
      ) : (
        <pre className="tool-terminal whitespace-pre-wrap text-detail/[1.45] text-foreground/75">
          {props.text}
        </pre>
      )}
    </div>
  );
}

/* ── Error card ───────────────────────────────────────────────────── */

const AssistantErrorBlock = memo(function AssistantErrorBlock(props: {
  text: string;
  expanded: boolean;
}) {
  const line = props.text.trim().split(/\r?\n/u, 1)[0] ?? "";
  const title = !line ? "Error" : line.length <= 52 ? line : `${line.slice(0, 49)}\u2026`;
  return (
    <Card
      icon={<IconCrossSmall className="size-3 shrink-0 text-destructive/80" />}
      title={title}
      trailing={
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[12px] leading-[16px] text-destructive/90">
          Error
        </span>
      }
      expanded={props.expanded}
    >
      <div className="min-w-0 pt-1.5 pb-2">
        <pre className="tool-terminal max-h-[min(40vh,20rem)] overflow-y-auto whitespace-pre-wrap break-words font-multi-mono text-detail/[1.45] text-foreground/80">
          {props.text}
        </pre>
      </div>
    </Card>
  );
});

/* ── Diff helpers ─────────────────────────────────────────────────── */

function embedToolDiffOptions(opts: {
  diffStyle: "unified" | "split";
  theme: "pierre-dark" | "pierre-light";
}) {
  return {
    theme: opts.theme,
    diffStyle: opts.diffStyle,
    overflow: "wrap" as const,
    disableFileHeader: true,
    disableBackground: false,
    disableLineNumbers: true,
    diffIndicators: "none" as const,
    lineDiffType: "none" as const,
    expandUnchanged: false,
    hunkSeparators: "simple" as const,
    unsafeCSS: "[data-separator] { display: none !important; }",
  };
}

/* ── Tool title / summary extraction ──────────────────────────────── */

function toolArgs(row: Extract<ChatRow, { kind: "tool" }>): Record<string, Json> | null {
  const fromCall = row.call?.arguments;
  if (fromCall && typeof fromCall === "object") return fromCall as Record<string, Json>;
  try {
    const o = JSON.parse(row.args) as Json;
    if (o && typeof o === "object") return o as Record<string, Json>;
  } catch {}
  return null;
}

function shellCmd(args: Record<string, Json> | null): string | null {
  if (!args) return null;
  const actions = args.commandActions;
  if (Array.isArray(actions) && actions[0] && typeof actions[0] === "object") {
    const cmd = (actions[0] as Record<string, Json>).command;
    if (typeof cmd === "string" && cmd.trim()) return cmd.trim();
  }
  const raw = typeof args.command === "string" ? args.command.trim() : null;
  if (!raw) return null;
  const m = raw.match(/^\/bin\/(?:ba|z)?sh\s+-\S+\s+['"](.+)['"]$/s);
  return m?.[1] ?? raw;
}

function toolTitle(row: Extract<ChatRow, { kind: "tool" }>): string {
  const name = resolvedToolName(row.name);
  const args = toolArgs(row);

  if (name === "bash") {
    if (!args) return "Ran command";
    if (typeof args.description === "string" && args.description.trim())
      return args.description.trim();
    const cmd = shellCmd(args);
    if (cmd) return cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd;
    return "Ran command";
  }

  if (!["read", "edit", "write", "grep", "find", "ls", "ask", "websearch"].includes(name))
    return humanTool(row.name);

  const path = toolPathFromCall(row.call, row.args);
  if (path) {
    const pos = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return pos < 0 ? path : path.slice(pos + 1);
  }

  if (!args) return humanTool(row.name);
  if (typeof args.pattern === "string" && args.pattern.trim()) return args.pattern;
  if (typeof args.query === "string" && args.query.trim()) return args.query;
  if (typeof args.command === "string" && args.command.trim()) return args.command;
  if (row.name === "ask" && Array.isArray(args.questions) && args.questions[0]) {
    const text = (args.questions[0] as { question?: Json }).question;
    if (typeof text === "string" && text.trim()) return text.trim();
    return "Questions";
  }
  return humanTool(row.name);
}

function toolSummary(row: Extract<ChatRow, { kind: "tool" }>): string | null {
  const name = resolvedToolName(row.name);
  const args = toolArgs(row);

  if (name === "bash" && args) {
    const cmd = shellCmd(args);
    if (!cmd) return null;
    if (typeof args.description === "string" && args.description.trim()) {
      const parts = cmd.split(/\s+/);
      return parts.length <= 4 ? cmd : `${parts.slice(0, 3).join(" ")}...`;
    }
    return null;
  }

  const path = toolPathFromCall(row.call, row.args);
  if (path) {
    const pos = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return pos >= 0 ? path.slice(0, pos) : null;
  }

  return null;
}

/* ── Tool cards ───────────────────────────────────────────────────── */

function toolIcon(row: Extract<ChatRow, { kind: "tool" }>, state: RuntimeState) {
  const path = toolPathFromCall(row.call, row.args);
  if (path) return <VsFileIcon path={path} errored={state === "errored"} />;
  if (isFileTool(row.name))
    return <IconFileBend className={cn(state === "errored" && "text-destructive/80")} />;
  if (isShellTool(row.name, row.call, row.args))
    return <IconConsole className={cn(state === "errored" && "text-destructive/80")} />;
  return <IconToolbox className={cn(state === "errored" && "text-destructive/80")} />;
}

const LiteToolRow = memo(function LiteToolRow(props: {
  row: Extract<ChatRow, { kind: "tool" }>;
  expanded: boolean;
}) {
  const [open, setOpen] = useSyncedExpand(props.expanded);
  const body = useMemo(
    () =>
      toolBody({
        name: props.row.name,
        call: props.row.call,
        args: props.row.args,
        result: props.row.result,
        error: props.row.error,
        details: props.row.details,
        expanded: true,
      }),
    [props.row],
  );

  return (
    <li className="min-w-0">
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className="group flex h-8 max-h-8 w-full cursor-pointer items-center gap-2 py-0 text-left outline-none transition-colors hover:bg-multi-hover/8 focus:outline-none focus-visible:outline-none focus-visible:ring-0">
          <CardTitle>Web Search</CardTitle>
          <span className="shrink-0">
            <StatusBadge state={runtimeState(props.row)} />
          </span>
          <IconChevronBottom
            className={cn(
              "size-3 shrink-0 text-[color-mix(in_srgb,var(--foreground)_50%,transparent)] transition-transform duration-200",
              !open && "-rotate-90",
            )}
          />
        </Collapsible.Trigger>
        <Collapsible.Panel>
          {body ? (
            <div className="mt-1 max-h-[min(40vh,20rem)] min-h-0 overflow-auto rounded-multi-control border border-multi-border/35 bg-muted/20 px-3 py-2">
              {body}
            </div>
          ) : null}
        </Collapsible.Panel>
      </Collapsible.Root>
    </li>
  );
});

const FileEditToolCard = memo(function FileEditToolCard(props: {
  row: Extract<ChatRow, { kind: "tool" }>;
  diff: FileDiffMetadata;
  path: string;
  expanded: boolean;
  state: RuntimeState;
}) {
  const [diffStyle] = useDiffStylePreference();
  const theme =
    useTheme().resolvedTheme === "dark" ? ("pierre-dark" as const) : ("pierre-light" as const);
  const [open, setOpen] = useSyncedExpand(props.expanded);
  const [full, setFull] = useState(false);
  const stat = useMemo(() => toolDiffStat(props.diff), [props.diff]);
  const base = useMemo(() => {
    const p = props.path;
    const pos = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return pos < 0 ? p : p.slice(pos + 1);
  }, [props.path]);

  return (
    <CardShell>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <CardTrigger
          icon={<VsFileIcon path={props.path} errored={props.state === "errored"} />}
          open={open}
          title={props.path}
        >
          <CardTitle>{base}</CardTitle>
          <span className="flex shrink-0 items-baseline gap-2 font-multi-mono text-[12px] tabular-nums">
            {stat.add > 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400">+{stat.add}</span>
            ) : null}
            {stat.del > 0 ? (
              <span className="text-red-600 dark:text-red-400/95">-{stat.del}</span>
            ) : null}
            {stat.add === 0 && stat.del === 0 ? (
              <span className="text-muted-foreground/45">---</span>
            ) : null}
          </span>
          <span className="shrink-0">
            <StatusBadge state={runtimeState(props.row)} />
          </span>
        </CardTrigger>
        <CardPanel className="gap-0">
          <div
            className={cn(
              "relative min-h-0 overflow-x-auto",
              full ? "max-h-[min(56vh,28rem)] overflow-y-auto" : "max-h-[80px] overflow-y-hidden",
            )}
          >
            <div className="embed-diff min-h-[72px] bg-transparent">
              <FileDiff
                fileDiff={props.diff}
                options={embedToolDiffOptions({ diffStyle, theme })}
              />
            </div>
            {!full ? (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[color-mix(in_srgb,var(--color-multi-bubble)_96%,var(--background))] to-transparent dark:from-[color-mix(in_srgb,var(--color-multi-bubble)_90%,var(--background))]"
                aria-hidden
              />
            ) : null}
          </div>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-t border-[color-mix(in_srgb,var(--foreground)_6%,transparent)] py-1.5 text-detail text-muted-foreground outline-none transition-colors hover:bg-multi-hover/8 hover:text-foreground/85 focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFull((v) => !v);
            }}
          >
            <IconChevronBottom
              className={cn("size-3 shrink-0 transition-transform", full && "rotate-180")}
            />
            <span>{full ? "Show less" : "Show more"}</span>
          </button>
        </CardPanel>
      </Collapsible.Root>
    </CardShell>
  );
});

const ToolCard = memo(function ToolCard(props: {
  row: Extract<ChatRow, { kind: "tool" }>;
  expanded: boolean;
}) {
  const [diffStyle] = useDiffStylePreference();
  const theme =
    useTheme().resolvedTheme === "dark" ? ("pierre-dark" as const) : ("pierre-light" as const);
  const s = runtimeState(props.row);
  const file = isFileTool(props.row.name);
  const title = useMemo(() => toolTitle(props.row), [props.row]);
  const summary = useMemo(() => toolSummary(props.row), [props.row]);
  const path = useMemo(
    () => toolPathFromCall(props.row.call, props.row.args),
    [props.row.call, props.row.args],
  );

  const diff = useMemo(
    () => (file ? toolFileDiff(props.row.name, props.row.call) : null),
    [file, props.row.name, props.row.call],
  );

  const detail = useMemo(
    () =>
      file
        ? null
        : toolBody({
            name: props.row.name,
            call: props.row.call,
            args: props.row.args,
            result: props.row.result,
            error: props.row.error,
            details: props.row.details,
            expanded: true,
          }),
    [
      file,
      props.row.name,
      props.row.call,
      props.row.args,
      props.row.result,
      props.row.error,
      props.row.details,
    ],
  );

  const payload = Boolean(props.row.args.trim() || props.row.result.trim());

  if (file && diff && path) {
    return (
      <FileEditToolCard
        row={props.row}
        diff={diff}
        path={path}
        expanded={props.expanded}
        state={s}
      />
    );
  }

  return (
    <Card
      icon={toolIcon(props.row, s)}
      title={title}
      summary={summary}
      trailing={<StatusBadge state={s} />}
      expanded={props.expanded}
    >
      {file && diff ? (
        <div className="embed-diff tool-output-surface max-h-[min(56vh,28rem)] overflow-auto">
          <FileDiff fileDiff={diff} options={embedToolDiffOptions({ diffStyle, theme })} />
        </div>
      ) : null}
      {!file && payload && detail ? (
        <div className="max-h-[min(56vh,28rem)] min-h-0 overflow-auto">{detail}</div>
      ) : null}
      {!file && payload && !detail ? (
        <JsonSection
          label={props.row.error ? "Error" : "Details"}
          text={props.row.result.trim() ? props.row.result : props.row.args}
        />
      ) : null}
      {file && props.row.error && props.row.result.trim() ? (
        <div className="text-detail/[1.4] text-destructive/85">{props.row.result}</div>
      ) : null}
    </Card>
  );
});

/* ── Bash card ────────────────────────────────────────────────────── */

const BashCard = memo(function BashCard(props: {
  row: Extract<ChatRow, { kind: "bash" }>;
  expanded: boolean;
}) {
  const [open, setOpen] = useSyncedExpand(props.expanded);
  const s = runtimeState(props.row);
  const cmd = props.row.command.trim();
  const parts = cmd.split(/\s+/);
  const summary = parts.length <= 4 ? cmd : `${parts.slice(0, 3).join(" ")}...`;

  return (
    <CardShell>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <CardTrigger
          icon={<IconConsole className={cn(s === "errored" && "text-destructive/80")} />}
          open={open}
        >
          <CardTitle>Ran command</CardTitle>
          <CardSummary mono>{summary}</CardSummary>
          <span className="shrink-0">
            <StatusBadge state={s} />
          </span>
        </CardTrigger>
        <CardPanel className="gap-0">
          <code className="block whitespace-pre-wrap break-all px-2.5 py-1.5 font-multi-mono text-[12px] leading-[1.6] text-foreground/85">
            <span className="select-none text-[color-mix(in_srgb,var(--foreground)_40%,transparent)]">
              ${" "}
            </span>
            {cmd}
          </code>
          {props.row.output.trim() ? (
            <pre className="whitespace-pre-wrap break-all px-2.5 py-1.5 font-multi-mono text-[12px] leading-[1.5] text-[color-mix(in_srgb,var(--foreground)_75%,transparent)]">
              {props.row.output}
              {props.row.truncated ? "\n\n[truncated]" : ""}
            </pre>
          ) : null}
        </CardPanel>
      </Collapsible.Root>
    </CardShell>
  );
});

/* ── Generic / text card ──────────────────────────────────────────── */

const TextCard = memo(function TextCard(props: {
  label: string;
  text: string;
  expanded: boolean;
  error?: boolean;
}) {
  const body = useMemo(() => {
    const t = props.text.trim();
    if (!t) return null;
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        const j = JSON.parse(t) as Json;
        const links = extractLinksFromPayload(j);
        if (links.length > 0) {
          return (
            <ul className="flex flex-col gap-2">
              {links.map((l) => (
                <li key={linkRowKey(l)} className="text-body/[1.375]">
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
                  >
                    {l.title ?? l.url}
                  </a>
                  {l.snippet ? (
                    <span className="mt-0.5 block text-muted-foreground/70">{l.snippet}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <div className="max-h-[min(24rem,50vh)] overflow-auto">
            <div className="font-multi-mono text-detail/[1.5]">{renderValue(j, 0)}</div>
          </div>
        );
      } catch {
        return <ChatMarkdown>{props.text}</ChatMarkdown>;
      }
    }
    return <ChatMarkdown>{props.text}</ChatMarkdown>;
  }, [props.text]);

  return (
    <Card icon={<IconToolbox />} title={props.label} expanded={props.expanded}>
      {body ? (
        <div
          className={cn(
            "max-h-[min(56vh,28rem)] min-h-0 overflow-auto",
            props.error && "text-destructive/90",
          )}
        >
          {body}
        </div>
      ) : null}
    </Card>
  );
});

/* ── Task / approval / activity cards ─────────────────────────────── */

const TaskToolCard = memo(function TaskToolCard(props: {
  row: Extract<ChatRow, { kind: "tool" }>;
  expanded: boolean;
}) {
  const s = runtimeState(props.row);
  const title = useMemo(() => toolTitle(props.row), [props.row]);
  const body = useMemo(
    () =>
      props.row.result.trim()
        ? toolBody({
            name: props.row.name,
            call: props.row.call,
            args: props.row.args,
            result: props.row.result,
            error: props.row.error,
            details: props.row.details,
            expanded: true,
          })
        : null,
    [props.row],
  );

  return (
    <Card
      icon={
        <IconBrain
          className={cn(
            "size-3 shrink-0",
            s === "errored" ? "text-destructive/80" : "text-foreground/48",
          )}
        />
      }
      title={title}
      trailing={<StatusBadge state={s} />}
      expanded={props.expanded}
    >
      {body ? <div className="max-h-[min(56vh,28rem)] min-h-0 overflow-auto">{body}</div> : null}
    </Card>
  );
});

const ApprovalCard = memo(function ApprovalCard(props: {
  row: Extract<ChatRow, { kind: "approval" }>;
  expanded: boolean;
}) {
  const resolved = props.row.decision !== null;
  return (
    <CardShell>
      <Collapsible.Root defaultOpen={props.expanded && !resolved}>
        <CardTrigger
          icon={
            <IconToolbox className={cn(resolved ? "text-foreground/48" : "text-amber-500/80")} />
          }
          open={props.expanded && !resolved}
        >
          <CardTitle>{props.row.summary}</CardTitle>
          <span className="shrink-0">
            {resolved ? (
              <span className="text-[12px] leading-[16px] text-[color-mix(in_srgb,var(--foreground)_50%,transparent)]">
                {props.row.decision}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[12px] leading-[16px] text-amber-600 dark:text-amber-400">
                <IconLoader className="size-2.5 animate-spin" />
                Awaiting
              </span>
            )}
          </span>
        </CardTrigger>
        <CardPanel>
          <div className="px-2.5 pt-1 pb-2">
            {props.row.detail ? (
              <div className="text-[12px] leading-[1.45] text-muted-foreground/70">
                {props.row.detail}
              </div>
            ) : (
              <div className="text-[12px] leading-[1.45] text-muted-foreground/50">
                {approvalLabelForKind(props.row.requestKind)}
              </div>
            )}
          </div>
        </CardPanel>
      </Collapsible.Root>
    </CardShell>
  );
});

function approvalLabelForKind(requestKind: WorkLogEntry["requestKind"] | null): string {
  switch (requestKind) {
    case "command":
      return "Command execution approval";
    case "file-read":
      return "File read approval";
    case "file-change":
      return "File change approval";
    case "permissions":
      return "Permissions approval";
    case "mcp-elicitation":
      return "MCP input request";
    case "dynamic-tool":
      return "Tool approval";
    case "auth-refresh":
      return "Auth refresh request";
    default:
      return "Approval request";
  }
}

const TaskActivityCard = memo(function TaskActivityCard(props: {
  row: Extract<ChatRow, { kind: "taskActivity" }>;
  expanded: boolean;
}) {
  const active = props.row.taskStatus === "running";
  return (
    <CardShell>
      <div className="flex w-full items-center gap-2 px-2.5 py-2">
        <span className="flex size-4 shrink-0 items-center justify-center text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] [&>svg]:size-3.5">
          <IconBrain
            className={cn("size-3 shrink-0", active ? "text-primary/70" : "text-foreground/48")}
          />
        </span>
        <CardTitle>{props.row.summary}</CardTitle>
        <span className="ml-auto shrink-0">
          {active ? (
            <span className="inline-flex items-center gap-1 text-[12px] leading-[16px] text-[color-mix(in_srgb,var(--foreground)_50%,transparent)]">
              <IconLoader className="size-2.5 animate-spin" />
              Running
            </span>
          ) : (
            <span
              className={cn(
                "text-[12px] leading-[16px]",
                props.row.taskStatus === "failed"
                  ? "text-destructive/80"
                  : "text-[color-mix(in_srgb,var(--foreground)_50%,transparent)]",
              )}
            >
              {props.row.taskStatus === "failed"
                ? "Failed"
                : props.row.taskStatus === "stopped"
                  ? "Stopped"
                  : "Done"}
            </span>
          )}
        </span>
      </div>
    </CardShell>
  );
});

/* ── Work entry row ──────────────────────────────────────────────── */

const WorkEntryRow = memo(function WorkEntryRow(props: { entry: WorkLogEntry; expanded: boolean }) {
  const tone = props.entry.tone;
  const label = (props.entry.toolTitle ?? props.entry.label)
    .replace(/\s+(?:complete|completed)\s*$/i, "")
    .trim();
  const preview =
    props.entry.command ??
    props.entry.detail ??
    (props.entry.changedFiles?.length ? props.entry.changedFiles[0] : null);
  const icon =
    tone === "error" ? (
      <IconCrossSmall className="text-destructive/80" />
    ) : tone === "thinking" ? (
      <IconBrain className="text-foreground/48" />
    ) : (
      <IconToolbox className="text-foreground/48" />
    );

  if (!preview) {
    return (
      <CardShell>
        <div className="flex w-full items-center gap-2 px-2.5 py-2">
          <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-3.5">
            {icon}
          </span>
          <CardTitle>{label || "Tool call"}</CardTitle>
        </div>
      </CardShell>
    );
  }

  return (
    <Card icon={icon} title={label || "Tool call"} summary={preview} expanded={props.expanded}>
      {props.entry.detail ? (
        <pre className="max-h-[min(40vh,20rem)] whitespace-pre-wrap break-words px-2.5 pt-1.5 pb-2 font-multi-mono text-detail/[1.45] text-foreground/75">
          {props.entry.detail}
        </pre>
      ) : null}
      {props.entry.changedFiles && props.entry.changedFiles.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-2.5 pt-1 pb-2">
          {props.entry.changedFiles.slice(0, 6).map((f) => (
            <span
              key={f}
              className="rounded-md border border-multi-border/45 bg-muted/15 px-1.5 py-0.5 font-multi-mono text-[10px] text-muted-foreground/70"
              title={f}
            >
              {f.split(/[\\/]/).at(-1) ?? f}
            </span>
          ))}
          {props.entry.changedFiles.length > 6 ? (
            <span className="px-1 text-[10px] text-muted-foreground/50">
              +{props.entry.changedFiles.length - 6}
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
});

/* ── Proposed plan row ───────────────────────────────────────────── */

const ProposedPlanRow = memo(function ProposedPlanRow(props: {
  plan: ProposedPlan;
  expanded: boolean;
}) {
  const implemented = props.plan.implementedAt !== null;
  return (
    <Card
      icon={<IconBrain className={cn(implemented ? "text-foreground/48" : "text-primary/70")} />}
      title="Proposed Plan"
      summary={implemented ? "Implemented" : "Pending"}
      expanded={props.expanded && !implemented}
    >
      <div className="max-h-[min(56vh,28rem)] min-h-0 overflow-auto px-2.5 pt-1.5 pb-2">
        <ChatMarkdown>{props.plan.planMarkdown}</ChatMarkdown>
      </div>
    </Card>
  );
});

/* ── Timeline row dispatch ───────────────────────────────────────── */

export function TimelineRowContent(props: { row: TimelineRow; expanded: boolean }) {
  if (props.row.kind === "work")
    return <WorkEntryRow key={props.row.id} entry={props.row.entry} expanded={props.expanded} />;
  if (props.row.kind === "proposed-plan")
    return <ProposedPlanRow key={props.row.id} plan={props.row.plan} expanded={props.expanded} />;
  if (props.row.kind === "working") return null;
  return draw(props.row, props.expanded);
}

function draw(row: ChatRow, expanded: boolean) {
  if (row.kind === "user")
    return <HumanBubble key={row.id} text={row.text || ""} attachments={row.attachments} />;
  if (row.kind === "assistant") return <AssistantBlock key={row.id} text={row.text} />;
  if (row.kind === "thinking")
    return <ThinkingBlock key={row.id} text={row.text} summary={row.summary} />;
  if (row.kind === "assistantError")
    return <AssistantErrorBlock key={row.id} text={row.text} expanded={expanded} />;
  if (row.kind === "tool") {
    if (row.toolKind === "websearch")
      return <LiteToolRow key={row.id} row={row} expanded={expanded} />;
    if (row.toolKind === "task") return <TaskToolCard key={row.id} row={row} expanded={expanded} />;
    return <ToolCard key={row.id} row={row} expanded={expanded} />;
  }
  if (row.kind === "bash") return <BashCard key={row.id} row={row} expanded={expanded} />;
  if (row.kind === "custom")
    return <TextCard key={row.id} label={row.name} text={row.text} expanded={expanded} />;
  if (row.kind === "compaction")
    return (
      <TextCard
        key={row.id}
        label="Compaction"
        text={`Compacted from ${row.tokens.toLocaleString()} tokens\n\n${row.summary}`}
        expanded={expanded}
      />
    );
  if (row.kind === "branch")
    return <TextCard key={row.id} label="Branch" text={row.summary} expanded={expanded} />;
  if (row.kind === "system")
    return <TextCard key={row.id} label="System" text={row.text} expanded={expanded} />;
  if (row.kind === "approval") return <ApprovalCard key={row.id} row={row} expanded={expanded} />;
  if (row.kind === "taskActivity")
    return <TaskActivityCard key={row.id} row={row} expanded={expanded} />;
  if (row.kind === "other")
    return <TextCard key={row.id} label={row.role} text={row.text} expanded={expanded} />;
  return null;
}

export { ChatWorkingRow };
