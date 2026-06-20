"use client";

import type {
  AgentRuntimeEvent,
  RuntimeDisplayTimelineItem,
  RuntimeDisplayTimelineProjection,
  SessionTreeEntry,
  SessionTreeProjection,
  ThreadId,
} from "@honk/contracts";
import { ScrollArea } from "@honk/honkkit/scroll-area";
import { WorkbenchChromeRow } from "@honk/honkkit/workbench-chrome-row";
import {
  IconAiTokens,
  IconBug,
  IconBubbleText,
  IconCode,
  IconCodeTree,
  IconHistory,
} from "central-icons";
import { useState, type ComponentType, type ReactNode } from "react";

import {
  deriveLatestContextWindowSnapshot,
  formatContextUsagePercentage,
  formatContextWindowTokens,
  type ContextWindowSnapshot,
} from "~/lib/context-window";
import { cn } from "~/lib/utils";
import { useAgentRuntimeStore } from "~/stores/agent-runtime-store";
import type { ChatMessage, Thread } from "~/types";

type DevPanelSection = "messages" | "context" | "timeline" | "tree" | "events";

interface DevPanelSectionDefinition {
  id: DevPanelSection;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface DevRuntimeState {
  sessionTree: SessionTreeProjection | null;
  displayTimeline: RuntimeDisplayTimelineProjection | null;
  runtimeEvents: readonly AgentRuntimeEvent[];
  pendingExtensionUiRequests: number;
}

const DEV_PANEL_SECTIONS: readonly DevPanelSectionDefinition[] = [
  { id: "messages", label: "Messages", icon: IconBubbleText },
  { id: "context", label: "Context", icon: IconAiTokens },
  { id: "timeline", label: "Timeline", icon: IconHistory },
  { id: "tree", label: "Tree", icon: IconCodeTree },
  { id: "events", label: "Events", icon: IconBug },
];

const EMPTY_RUNTIME_EVENTS: AgentRuntimeEvent[] = [];

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatDuration(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  if (value < 1_000) {
    return `${Math.round(value)}ms`;
  }
  if (value < 60_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}s`;
  }
  return `${Math.round(value / 60_000)}m`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function compactText(value: string | null | undefined, maxLength = 140): string {
  const text = value?.trim().replace(/\s+/g, " ") ?? "";
  if (text.length === 0) {
    return "-";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function DevPanelHeader(props: {
  threadTitle: string | null;
  threadId: ThreadId | null;
  runtimeState: DevRuntimeState;
}) {
  const runtimeSessionId =
    props.runtimeState.sessionTree?.runtimeSessionId ??
    props.runtimeState.displayTimeline?.runtimeSessionId ??
    null;
  return (
    <WorkbenchChromeRow variant="panel">
      <IconCode className="size-4 shrink-0 text-honk-icon-accent-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-body font-medium text-honk-fg-primary">
        {props.threadTitle ?? "Dev Panel"}
      </span>
      {runtimeSessionId ? (
        <span className="max-w-36 shrink-0 truncate text-caption text-honk-fg-tertiary">
          {runtimeSessionId}
        </span>
      ) : props.threadId ? (
        <span className="max-w-36 shrink-0 truncate text-caption text-honk-fg-tertiary">
          {props.threadId}
        </span>
      ) : null}
    </WorkbenchChromeRow>
  );
}

function DevPanelTabs(props: {
  active: DevPanelSection;
  onActiveChange: (id: DevPanelSection) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Dev panel sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-honk-workbench-panel-border-muted px-2 py-1.5"
    >
      {DEV_PANEL_SECTIONS.map((section) => {
        const Icon = section.icon;
        const selected = section.id === props.active;
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => props.onActiveChange(section.id)}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2 rounded-honk-control border px-3 text-body font-medium transition-[background-color,border-color,color]",
              selected
                ? "border-honk-stroke-secondary bg-honk-bg-quinary text-honk-fg-primary shadow-xs"
                : "border-transparent text-honk-fg-secondary hover:border-honk-workbench-panel-border-muted hover:bg-honk-bg-tertiary hover:text-honk-fg-primary",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                selected ? "text-honk-icon-accent-primary" : "text-honk-icon-secondary",
              )}
              aria-hidden
            />
            <span>{section.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DevSection(props: { title: string; meta?: string | null; children: ReactNode }) {
  return (
    <section className="border-b border-honk-workbench-panel-border-muted px-3 py-3 last:border-b-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3 px-0.5">
        <h3 className="m-0 truncate text-detail font-medium text-honk-fg-tertiary">
          {props.title}
        </h3>
        {props.meta ? (
          <span className="shrink-0 text-caption text-honk-fg-tertiary tabular-nums">
            {props.meta}
          </span>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

function KeyValueRow(props: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="grid min-h-8 grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 rounded-honk-control px-2 py-1 text-detail hover:bg-honk-bg-secondary">
      <div className="truncate text-honk-fg-tertiary">{props.label}</div>
      <div className="min-w-0 truncate text-honk-fg-primary" title={props.title}>
        {props.value}
      </div>
    </div>
  );
}

function EmptyRows(props: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center px-4 py-6 text-center text-detail text-honk-fg-tertiary">
      {props.children}
    </div>
  );
}

type ContextUsageColor =
  | "gray"
  | "purple"
  | "green"
  | "yellow"
  | "pink"
  | "blue"
  | "orange"
  | "red";

function contextUsageColorValue(color: ContextUsageColor): string {
  switch (color) {
    case "gray":
      return "var(--honk-fg-tertiary)";
    case "purple":
      return "color-mix(in oklch, var(--primary) 78%, var(--honk-fg-red-primary))";
    case "green":
      return "var(--honk-fg-green-primary)";
    case "yellow":
      return "var(--honk-tone-yellow)";
    case "pink":
      return "color-mix(in oklch, var(--honk-fg-red-primary) 62%, var(--primary))";
    case "blue":
      return "var(--honk-fg-cyan-primary)";
    case "orange":
      return "var(--honk-fg-orange-primary)";
    case "red":
      return "var(--honk-fg-red-primary)";
  }
}

function contextUsageColorForCategory(id: string, index: number): ContextUsageColor {
  if (id === "system_prompt" || id === "uncategorized") return "gray";
  if (id === "tools" || id === "tool_definitions") return "purple";
  if (id === "rules") return "green";
  if (id === "skills") return "yellow";
  if (id === "mcp") return "pink";
  if (id === "subagents") return "blue";
  if (id === "summarized_conversation") return "red";
  if (id === "conversation") return "orange";
  return (
    (["gray", "purple", "green", "yellow", "pink", "blue", "orange", "red"] as const)[index % 8] ??
    "gray"
  );
}

function contextUsageCategories(usage: ContextWindowSnapshot) {
  const explicitCategories =
    usage.categories
      ?.filter((category) => category.tokens > 0)
      .map((category) => ({
        id: category.id,
        label: category.label,
        tokens: Math.round(category.tokens),
      })) ?? [];
  if (explicitCategories.length === 0) {
    return [{ id: "conversation", label: "Conversation", tokens: Math.round(usage.usedTokens) }];
  }
  const explicitTotal = explicitCategories.reduce((total, category) => total + category.tokens, 0);
  const uncategorizedTokens = Math.max(0, Math.round(usage.usedTokens - explicitTotal));
  return uncategorizedTokens > 0
    ? [...explicitCategories, { id: "uncategorized", label: "Other", tokens: uncategorizedTokens }]
    : explicitCategories;
}

function ContextSection(props: { usage: ContextWindowSnapshot | null }) {
  if (!props.usage) {
    return <EmptyRows>No context usage reported for this thread yet.</EmptyRows>;
  }

  const usage = props.usage;
  const categories = contextUsageCategories(usage);
  const usedPercentage = formatContextUsagePercentage(usage.usedPercentage);
  const remainingTokens = usage.remainingTokens;

  return (
    <>
      <DevSection
        title="Budget"
        meta={usage.updatedAt ? `Updated ${formatTimestamp(usage.updatedAt)}` : null}
      >
        <KeyValueRow
          label="Used"
          value={
            usage.maxTokens
              ? `${usedPercentage ?? "-"} · ${formatContextWindowTokens(usage.usedTokens)} / ${formatContextWindowTokens(usage.maxTokens)}`
              : formatContextWindowTokens(usage.usedTokens)
          }
        />
        <KeyValueRow
          label="Remaining"
          value={remainingTokens === null ? "-" : formatContextWindowTokens(remainingTokens)}
        />
        <KeyValueRow
          label="Processed"
          value={formatContextWindowTokens(usage.totalProcessedTokens ?? null)}
        />
        <KeyValueRow label="Turn Time" value={formatDuration(usage.durationMs)} />
        <KeyValueRow label="Tool Uses" value={formatCount(usage.toolUses ?? 0)} />
        <KeyValueRow label="Compaction" value={usage.compactsAutomatically ? "Automatic" : "-"} />
      </DevSection>

      <DevSection title="Breakdown" meta={`${categories.length} categories`}>
        <div
          className="mb-2 flex h-1.5 overflow-hidden rounded-full bg-honk-bg-secondary"
          role="img"
          aria-label="Context usage by category"
        >
          {categories.map((category, index) => (
            <span
              key={`${category.id}:${index}`}
              className="min-w-0.5 rounded-full"
              style={{
                backgroundColor: contextUsageColorValue(
                  contextUsageColorForCategory(category.id, index),
                ),
                flexGrow: Math.max(0, category.tokens),
              }}
              aria-hidden
            />
          ))}
        </div>
        <div className="grid gap-0.5">
          {categories.map((category, index) => (
            <div
              key={`${category.id}:${index}`}
              className="flex min-h-8 min-w-0 items-center gap-2 rounded-honk-control border border-honk-workbench-panel-border-muted bg-honk-bg-secondary px-2 py-1 text-detail"
            >
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{
                  backgroundColor: contextUsageColorValue(
                    contextUsageColorForCategory(category.id, index),
                  ),
                }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-honk-fg-primary">{category.label}</span>
              <span className="shrink-0 text-honk-fg-secondary tabular-nums">
                {formatContextWindowTokens(category.tokens)}
              </span>
            </div>
          ))}
        </div>
      </DevSection>

      <DevSection title="Latest Model Usage">
        <KeyValueRow
          label="Context"
          value={formatContextWindowTokens(usage.lastUsedTokens ?? null)}
        />
        <KeyValueRow
          label="Input"
          value={formatContextWindowTokens(usage.lastInputTokens ?? null)}
        />
        <KeyValueRow
          label="Cache Read"
          value={formatContextWindowTokens(usage.lastCachedInputTokens ?? null)}
        />
        <KeyValueRow
          label="Output"
          value={formatContextWindowTokens(usage.lastOutputTokens ?? null)}
        />
      </DevSection>
    </>
  );
}

type RuntimeMessageItem = Extract<RuntimeDisplayTimelineItem, { kind: "message" }>;
type RuntimeToolItem = Extract<RuntimeDisplayTimelineItem, { kind: "tool" }>;

interface DevMessageItem {
  id: string;
  role: RuntimeMessageItem["role"] | ChatMessage["role"];
  text: string | null;
  thinking: string | null;
  createdAt: string | null;
  streaming: boolean;
  source: "Live" | "Stored";
  turnId: string | null;
  attachmentCount: number;
}

function readableBlockText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
}

function messageRoleLabel(role: DevMessageItem["role"]): string {
  switch (role) {
    case "assistant":
      return "Assistant";
    case "user":
      return "User";
    case "system":
      return "System";
    case "toolResult":
      return "Tool Result";
    case "custom":
      return "Custom";
  }
}

function messageBubbleClassName(role: DevMessageItem["role"]): string {
  if (role === "user") {
    return "border-honk-stroke-secondary bg-(--honk-message-bubble-background) text-honk-fg-primary";
  }
  if (role === "assistant") {
    return "border-honk-workbench-panel-border-muted bg-honk-bg-tertiary text-honk-fg-primary";
  }
  if (role === "system") {
    return "border-honk-workbench-panel-border-muted bg-honk-bg-secondary text-honk-fg-secondary";
  }
  return "border-honk-workbench-panel-border-muted bg-honk-bg-secondary text-honk-fg-primary";
}

function messageAccentClassName(role: DevMessageItem["role"]): string {
  if (role === "user") {
    return "bg-honk-icon-accent-primary";
  }
  if (role === "assistant") {
    return "bg-(--honk-fg-green-primary)";
  }
  if (role === "system") {
    return "bg-(--honk-tone-yellow)";
  }
  return "bg-honk-icon-secondary";
}

function buildDevMessages(
  timeline: RuntimeDisplayTimelineProjection | null,
  thread: Thread | null,
): readonly DevMessageItem[] {
  const runtimeMessages =
    timeline?.items.filter((item): item is RuntimeMessageItem => item.kind === "message") ?? [];
  if (runtimeMessages.length > 0) {
    return runtimeMessages.map((item) => ({
      id: item.id,
      role: item.role,
      text: readableBlockText(item.text),
      thinking: readableBlockText(item.thinking),
      createdAt: item.createdAt,
      streaming: item.streaming ?? false,
      source: "Live" as const,
      turnId: item.turnId ?? null,
      attachmentCount: 0,
    }));
  }

  return (
    thread?.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: readableBlockText(message.text),
      thinking: null,
      createdAt: message.createdAt,
      streaming: message.streaming,
      source: "Stored" as const,
      turnId: message.turnId ?? null,
      attachmentCount: message.attachments?.length ?? 0,
    })) ?? []
  );
}

function MessagePill(props: { children: ReactNode; tone?: "default" | "active" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-honk-control border px-1.5 text-caption font-medium tabular-nums",
        props.tone === "active"
          ? "border-honk-stroke-secondary bg-honk-bg-quinary text-honk-fg-primary"
          : "border-honk-workbench-panel-border-muted bg-honk-bg-tertiary text-honk-fg-secondary",
      )}
    >
      {props.children}
    </span>
  );
}

function MessagesSection(props: {
  timeline: RuntimeDisplayTimelineProjection | null;
  thread: Thread | null;
}) {
  const messages = buildDevMessages(props.timeline, props.thread);
  if (messages.length === 0) {
    return <EmptyRows>No messages are available for this thread yet.</EmptyRows>;
  }

  return (
    <DevSection title="Messages" meta={`${messages.length} shown`}>
      <div className="grid gap-2">
        {messages.map((message, index) => {
          const roleLabel = messageRoleLabel(message.role);
          const text = message.text ?? message.thinking ?? "No visible text.";
          return (
            <article
              key={`${message.source}:${message.id}:${index}`}
              className={cn(
                "relative overflow-hidden rounded-honk-control border px-3 py-2.5 shadow-xs",
                messageBubbleClassName(message.role),
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-0 left-0 w-0.5",
                  messageAccentClassName(message.role),
                )}
                aria-hidden
              />
              <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-detail font-medium">{roleLabel}</span>
                <span className="text-caption text-honk-fg-tertiary">·</span>
                <span className="shrink-0 text-caption text-honk-fg-tertiary">
                  {formatTimestamp(message.createdAt)}
                </span>
                <span className="min-w-0 flex-1" />
                <MessagePill tone={message.source === "Live" ? "active" : "default"}>
                  {message.source}
                </MessagePill>
                {message.streaming ? <MessagePill tone="active">Streaming</MessagePill> : null}
              </div>
              {message.thinking && message.text ? (
                <div className="mb-2 rounded-honk-control border border-honk-workbench-panel-border-muted bg-honk-bg-secondary px-2 py-1.5 text-detail leading-5 text-honk-fg-secondary">
                  {message.thinking}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap break-words text-body leading-5">{text}</div>
              {message.turnId || message.attachmentCount > 0 ? (
                <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                  {message.turnId ? (
                    <MessagePill>Turn {compactText(message.turnId, 18)}</MessagePill>
                  ) : null}
                  {message.attachmentCount > 0 ? (
                    <MessagePill>
                      {message.attachmentCount} attachment{message.attachmentCount === 1 ? "" : "s"}
                    </MessagePill>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </DevSection>
  );
}

function timelineItemTitle(item: RuntimeDisplayTimelineItem): string {
  switch (item.kind) {
    case "message":
      return `${item.role} message`;
    case "tool":
      return item.toolName;
    case "extension-ui-request":
      return item.title;
    case "proposed-plan":
      return "Proposed plan";
  }
}

function timelineItemKindLabel(item: RuntimeDisplayTimelineItem): string {
  switch (item.kind) {
    case "message":
      return "Message";
    case "tool":
      return "Tool";
    case "extension-ui-request":
      return "User Input";
    case "proposed-plan":
      return "Plan";
  }
}

function toolDisplayDescription(item: RuntimeToolItem): string {
  const display = item.display;
  switch (display.kind) {
    case "bash":
      return display.command ? `Command: ${display.command}` : "Bash command";
    case "read":
      return display.path ? `Read ${display.path}` : "Read file";
    case "grep":
      return [display.query ? `Search "${display.query}"` : "Search", display.path]
        .filter(Boolean)
        .join(" in ");
    case "find":
      return [display.query ? `Find "${display.query}"` : "Find files", display.path]
        .filter(Boolean)
        .join(" in ");
    case "edit": {
      const changed = [
        display.additions ? `+${display.additions}` : null,
        display.deletions ? `-${display.deletions}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      return [display.path ? `Edit ${display.path}` : "Edit files", changed]
        .filter(Boolean)
        .join(" ");
    }
    case "mcp":
      return display.providerIdentifier ? `MCP: ${display.providerIdentifier}` : "MCP tool call";
    case "subagent":
      return `${display.runs.length} subagent run${display.runs.length === 1 ? "" : "s"}`;
    case "unknown":
      return display.output ? compactText(display.output, 160) : display.toolName;
  }
}

function timelineItemDescription(item: RuntimeDisplayTimelineItem): string {
  switch (item.kind) {
    case "message":
      return compactText(item.text ?? item.thinking, 160);
    case "tool":
      return item.summary ?? toolDisplayDescription(item);
    case "extension-ui-request":
      return item.message ?? item.placeholder ?? `${item.requestKind} request`;
    case "proposed-plan":
      return item.summary ?? compactText(item.planMarkdown, 160);
  }
}

function timelineStatusClassName(item: RuntimeDisplayTimelineItem): string {
  if (item.kind === "tool" && item.status === "running") {
    return "bg-honk-icon-accent-primary";
  }
  if (item.kind === "tool" && item.status === "error") {
    return "bg-(--honk-fg-red-primary)";
  }
  if (item.kind === "extension-ui-request" && item.status === "pending") {
    return "bg-(--honk-tone-yellow)";
  }
  return "bg-honk-stroke-secondary";
}

function TimelineSection(props: { timeline: RuntimeDisplayTimelineProjection | null }) {
  const items = props.timeline?.items.filter((item) => item.kind !== "message") ?? [];
  if (items.length === 0) {
    return <EmptyRows>No non-message runtime activity for this thread yet.</EmptyRows>;
  }

  return (
    <DevSection title="Runtime Timeline" meta={`${items.length} items`}>
      <div className="grid gap-1.5">
        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-honk-control border border-honk-workbench-panel-border-muted bg-honk-bg-tertiary px-2.5 py-2 text-detail text-honk-fg-secondary shadow-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn("size-2.5 shrink-0 rounded-full", timelineStatusClassName(item))}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-honk-fg-primary">
                {timelineItemTitle(item)}
              </span>
              <MessagePill>{timelineItemKindLabel(item)}</MessagePill>
              <span className="shrink-0 text-caption text-honk-fg-tertiary">
                {formatTimestamp(item.createdAt)}
              </span>
            </div>
            <div className="mt-1 whitespace-pre-wrap break-words pl-4 text-detail leading-5 text-honk-fg-tertiary">
              {timelineItemDescription(item)}
            </div>
            {item.kind === "extension-ui-request" && item.options?.length ? (
              <div className="mt-2 flex flex-wrap gap-1 pl-4">
                {item.options.map((option) => (
                  <MessagePill key={option}>{option}</MessagePill>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </DevSection>
  );
}

function entryLabel(entry: SessionTreeEntry | undefined): string {
  if (!entry) {
    return "Entry";
  }
  if (entry.kind === "message" && entry.role) {
    return `${entry.role} message`;
  }
  return entry.kind;
}

function treeEntryText(entry: SessionTreeEntry | undefined): string {
  if (!entry) {
    return "-";
  }
  return compactText(entry.text ?? entry.thinking ?? entry.id, 90);
}

function TreeSection(props: { sessionTree: SessionTreeProjection | null; thread: Thread | null }) {
  const sessionTree = props.sessionTree;
  const entryById = new Map<string, SessionTreeEntry>();
  for (const entry of sessionTree?.entries ?? []) {
    entryById.set(entry.id, entry);
  }

  if (!sessionTree || sessionTree.nodes.length === 0) {
    return (
      <>
        <EmptyRows>No live Pi session tree for this thread.</EmptyRows>
        {props.thread ? (
          <DevSection title="Durable Thread Tree">
            <KeyValueRow label="Entries" value={formatCount(props.thread.entries.length)} />
            <KeyValueRow
              label="Leaf"
              value={props.thread.leafId ?? "-"}
              title={props.thread.leafId ?? ""}
            />
          </DevSection>
        ) : null}
      </>
    );
  }

  const activePathCount = sessionTree.nodes.filter((node) => node.isActivePath).length;

  return (
    <>
      <DevSection title="Pi Session" meta={`${sessionTree.nodes.length} nodes`}>
        <KeyValueRow
          label="Session"
          value={sessionTree.runtimeSessionId}
          title={sessionTree.runtimeSessionId}
        />
        <KeyValueRow
          label="Leaf"
          value={sessionTree.leafEntryId ?? "-"}
          title={sessionTree.leafEntryId ?? ""}
        />
        <KeyValueRow label="Active Path" value={formatCount(activePathCount)} />
      </DevSection>

      <DevSection title="Navigation">
        <div className="grid gap-1">
          {sessionTree.nodes.map((node) => {
            const entry = entryById.get(node.entryId);
            return (
              <div
                key={node.entryId}
                className={cn(
                  "rounded-honk-control border px-2 py-2 text-detail shadow-xs",
                  node.isActiveLeaf
                    ? "border-honk-stroke-secondary bg-honk-bg-quinary text-honk-fg-primary"
                    : node.isActivePath
                      ? "border-honk-workbench-panel-border-muted bg-honk-bg-tertiary text-honk-fg-primary"
                      : "border-honk-workbench-panel-border-muted bg-honk-bg-secondary text-honk-fg-secondary",
                )}
                style={{ marginLeft: `${Math.min(node.depth, 8) * 10}px` }}
                aria-current={node.isActiveLeaf ? "true" : undefined}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      node.isActiveLeaf
                        ? "bg-honk-icon-accent-primary"
                        : node.isActivePath
                          ? "bg-honk-icon-secondary"
                          : "bg-honk-stroke-secondary",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{treeEntryText(entry)}</span>
                  <MessagePill>{entryLabel(entry)}</MessagePill>
                  {node.isActiveLeaf ? <MessagePill tone="active">Leaf</MessagePill> : null}
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap gap-1.5 pl-3.5">
                  <MessagePill>Entry {compactText(node.entryId, 18)}</MessagePill>
                  <MessagePill>Thread {compactText(node.threadEntryId, 18)}</MessagePill>
                  {node.parentEntryId ? (
                    <MessagePill>Parent {compactText(node.parentEntryId, 18)}</MessagePill>
                  ) : null}
                  {node.childCount > 0 ? (
                    <MessagePill>
                      {formatCount(node.childCount)} child{node.childCount === 1 ? "" : "ren"}
                    </MessagePill>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </DevSection>
    </>
  );
}

function eventTypeLabel(type: AgentRuntimeEvent["type"]): string {
  return type
    .split(/[.-]/)
    .map((part) => (part.length > 0 ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}` : part))
    .join(" ");
}

function eventDescription(event: AgentRuntimeEvent): string {
  return event.summary ?? compactText(event.text ?? event.thinking, 180);
}

function eventDotClassName(event: AgentRuntimeEvent): string {
  if (event.type === "runtime.error") {
    return "bg-(--honk-fg-red-primary)";
  }
  if (event.type === "runtime.warning") {
    return "bg-(--honk-tone-yellow)";
  }
  if (
    event.type === "turn.started" ||
    event.type === "message.started" ||
    event.type === "tool.started"
  ) {
    return "bg-honk-icon-accent-primary";
  }
  return "bg-honk-stroke-secondary";
}

function EventsSection(props: { events: readonly AgentRuntimeEvent[] }) {
  if (props.events.length === 0) {
    return <EmptyRows>No live Pi runtime events retained for this thread.</EmptyRows>;
  }

  const events = props.events.slice(-100).toReversed();

  return (
    <DevSection title="Runtime Events" meta={`${events.length} shown`}>
      <div className="grid gap-1.5">
        {events.map((event) => (
          <article
            key={event.id}
            className="rounded-honk-control border border-honk-workbench-panel-border-muted bg-honk-bg-tertiary px-2.5 py-2 text-detail text-honk-fg-secondary shadow-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn("size-2.5 shrink-0 rounded-full", eventDotClassName(event))} />
              <span className="min-w-0 flex-1 truncate text-honk-fg-primary">
                {eventTypeLabel(event.type)}
              </span>
              <span className="shrink-0 text-caption text-honk-fg-tertiary">
                {formatTimestamp(event.createdAt)}
              </span>
            </div>
            <div className="mt-1 whitespace-pre-wrap break-words pl-4 text-detail leading-5 text-honk-fg-tertiary">
              {eventDescription(event)}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap gap-1 pl-4">
              {event.messageRole ? (
                <MessagePill>{messageRoleLabel(event.messageRole)}</MessagePill>
              ) : null}
              {event.turnId ? (
                <MessagePill>Turn {compactText(event.turnId, 18)}</MessagePill>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </DevSection>
  );
}

export function DevWorkbenchPanel(props: {
  thread: Thread | null;
  threadId: ThreadId | null;
  threadTitle: string | null;
}) {
  const [activeSection, setActiveSection] = useState<DevPanelSection>("messages");
  const runtimeSnapshot = useAgentRuntimeStore((state) => state.snapshot);
  const runtimeState: DevRuntimeState = !props.threadId
    ? {
        sessionTree: null,
        displayTimeline: null,
        runtimeEvents: EMPTY_RUNTIME_EVENTS,
        pendingExtensionUiRequests: 0,
      }
    : {
        sessionTree:
          runtimeSnapshot.sessionTrees.find((tree) => tree.threadId === props.threadId) ?? null,
        displayTimeline:
          runtimeSnapshot.displayTimelines.find(
            (timeline) => timeline.threadId === props.threadId,
          ) ?? null,
        runtimeEvents: runtimeSnapshot.runtimeEvents.filter(
          (event) => event.threadId === props.threadId,
        ),
        pendingExtensionUiRequests: runtimeSnapshot.pendingExtensionUiRequests.filter(
          (request) => request.threadId === props.threadId,
        ).length,
      };
  const contextUsage = deriveLatestContextWindowSnapshot(props.thread?.activities ?? []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-(--honk-workbench-panel-background) font-honk text-detail text-honk-fg-primary">
      <DevPanelHeader
        threadTitle={props.threadTitle}
        threadId={props.threadId}
        runtimeState={runtimeState}
      />
      <DevPanelTabs active={activeSection} onActiveChange={setActiveSection} />
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="min-h-full">
          {activeSection === "messages" ? (
            <MessagesSection timeline={runtimeState.displayTimeline} thread={props.thread} />
          ) : null}
          {activeSection === "context" ? <ContextSection usage={contextUsage} /> : null}
          {activeSection === "timeline" ? (
            <TimelineSection timeline={runtimeState.displayTimeline} />
          ) : null}
          {activeSection === "tree" ? (
            <TreeSection sessionTree={runtimeState.sessionTree} thread={props.thread} />
          ) : null}
          {activeSection === "events" ? (
            <EventsSection events={runtimeState.runtimeEvents} />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
