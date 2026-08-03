import * as stylex from "@stylexjs/stylex";
import type { ConversationDensity } from "@honk/shared/conversation-density";
import { ChangeReceipt, ToolCallLine, WorkGroup } from "@honk/ui";
import { CompactionDivider } from "@honk/ui/compaction-divider";
import { NoticeRow } from "@honk/ui/notice-row";
import { ReasoningBlock } from "@honk/ui/reasoning-block";
import type { TimelineNavigatorItem } from "@honk/ui/timeline-navigator";
import { conversationVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { ThreadMessageEdit } from "../composer/types";
import { Markdown } from "../markdown";
import { ToolArtifactPreview } from "../tool-artifact";
import { toolArtifact, type ToolDiffArtifact } from "../tool-artifact-normalizer";
import { ToolMessage } from "../tool-message";
import {
  toolCategory,
  toolDetail,
  toolOutput,
  toolVerb,
  type ToolCategory,
} from "../tool-presentation";
import {
  isQueuedTasksStart,
  isPartActive,
  type ReasoningPart,
  type RenderableThreadDiff,
  type TextPart,
  type ThreadPart,
  type ThreadTurn,
  type ToolPart,
  type TranscriptBlock,
  type TranscriptRow,
  type WorkPart,
} from "./transcript-model";
import type { TaskChildLink } from "./subagent-session";
import { TaskMessage } from "./task-message";
import { AssistantText } from "./transcript-text";
import { UserThreadMessageRow } from "./transcript-user-row";

const PREVIEW_SCROLLABLE_ROWS = 5;
const EMPTY_PARTS: readonly ThreadPart[] = Object.freeze([]);
const EMPTY_TASK_LINKS: ReadonlyMap<string, TaskChildLink> = new Map();

const styles = stylex.create({
  reasoningGroup: {
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-row-gap"],
  },
});

export function turnTimelineItem(
  turn: ThreadTurn,
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): TimelineNavigatorItem {
  const userParts =
    turn.user === null ? EMPTY_PARTS : (partsByMessageId.get(turn.user.id) ?? EMPTY_PARTS);
  const planExecutionPart = userParts.find(
    (part): part is TextPart =>
      part.type === "text" &&
      typeof part.metadata?.honkPlanExecution === "object" &&
      part.metadata.honkPlanExecution !== null,
  );
  const rawPlanExecutionTitle =
    planExecutionPart === undefined
      ? null
      : Reflect.get(planExecutionPart.metadata?.honkPlanExecution ?? {}, "planTitle");
  const planExecutionTitle =
    planExecutionPart === undefined
      ? null
      : typeof rawPlanExecutionTitle === "string"
        ? rawPlanExecutionTitle
        : "Plan";
  const queuedTasksStart = isQueuedTasksStart(userParts);
  const userText =
    planExecutionTitle !== null
      ? `Build ${planExecutionTitle}`
      : queuedTasksStart
        ? "Queued tasks"
        : timelineMessageText(turn.user === null ? [] : [turn.user.id], partsByMessageId);
  const assistantText = timelineMessageText(
    turn.assistants.map((message) => message.id),
    partsByMessageId,
  );
  return {
    id: turn.key,
    userText: userText.length > 0 ? userText : "User message",
    assistantText: assistantText.length > 0 ? assistantText : null,
  };
}

function timelineMessageText(
  messageIDs: readonly string[],
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): string {
  return messageIDs
    .flatMap((messageID) => partsByMessageId.get(messageID) ?? EMPTY_PARTS)
    .filter(
      (part): part is TextPart =>
        part.type === "text" && part.synthetic !== true && part.ignored !== true,
    )
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ThreadTranscriptRow({
  row,
  conversationDensity,
  isThreadRunning = false,
  isLiveWorkBlock = false,
  onEditMessage,
  onReviewChanges,
  onOpenFile,
  editDraft = null,
  editComposer = null,
  onOpenTask,
  openTaskPartID = null,
  taskLinkByPartID = EMPTY_TASK_LINKS,
}: {
  readonly row: TranscriptRow;
  readonly conversationDensity: ConversationDensity;
  readonly isThreadRunning?: boolean;
  readonly isLiveWorkBlock?: boolean;
  readonly onEditMessage?: ((draft: ThreadMessageEdit) => void) | undefined;
  readonly onReviewChanges?: (() => void) | undefined;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly editDraft?: ThreadMessageEdit | null;
  readonly editComposer?: React.ReactNode;
  readonly onOpenTask?: ((part: ToolPart) => void) | undefined;
  readonly openTaskPartID?: string | null | undefined;
  readonly taskLinkByPartID?: ReadonlyMap<string, TaskChildLink> | undefined;
}): React.ReactElement | null {
  switch (row.kind) {
    case "human":
      return (
        <UserThreadMessageRow
          messageID={row.message.id}
          parts={row.parts}
          requiresRevertConfirmation={row.requiresRevertConfirmation}
          onEditMessage={onEditMessage}
          editDraft={editDraft}
          editComposer={editComposer}
          todoSummary={row.todoSummary}
        />
      );
    case "block":
      return (
        <BlockRow
          // Density remounts the block so disclosure state resets with the mode.
          key={`${conversationDensity}:${row.block.key}`}
          block={row.block}
          conversationDensity={conversationDensity}
          isThreadRunning={isThreadRunning}
          isLive={isThreadRunning && isLiveWorkBlock}
          onOpenFile={onOpenFile}
          onOpenTask={onOpenTask}
          openTaskPartID={openTaskPartID}
          taskLinkByPartID={taskLinkByPartID}
        />
      );
    case "diff":
      return (
        <TurnDiffSummary diffs={row.diffs} onReview={onReviewChanges} onOpenFile={onOpenFile} />
      );
  }
}

function TurnDiffSummary({
  diffs,
  onReview,
  onOpenFile,
}: {
  readonly diffs: readonly RenderableThreadDiff[];
  readonly onReview?: (() => void) | undefined;
  readonly onOpenFile?: ((path: string) => void) | undefined;
}): React.ReactElement {
  return (
    <ChangeReceipt
      files={diffs.map((diff) => ({
        path: diff.file,
        additions: diff.additions,
        deletions: diff.deletions,
        status: diff.status,
      }))}
      onReview={onReview}
      onFileClick={
        onOpenFile === undefined
          ? undefined
          : (file) => {
              onOpenFile(file.path);
            }
      }
    />
  );
}

function BlockRow({
  block,
  conversationDensity,
  isThreadRunning,
  isLive,
  onOpenFile,
  onOpenTask,
  openTaskPartID,
  taskLinkByPartID,
}: {
  block: TranscriptBlock;
  conversationDensity: ConversationDensity;
  isThreadRunning: boolean;
  isLive: boolean;
  onOpenFile: ((path: string) => void) | undefined;
  onOpenTask: ((part: ToolPart) => void) | undefined;
  openTaskPartID: string | null;
  taskLinkByPartID: ReadonlyMap<string, TaskChildLink>;
}): React.ReactElement | null {
  switch (block.kind) {
    case "prose":
      return (
        <AssistantText
          text={block.part.text}
          isStreaming={isThreadRunning && isPartActive(block.part)}
          onOpenFile={onOpenFile}
        />
      );
    case "reasoning":
      return (
        <ReasoningPartRow
          part={block.part}
          isThreadRunning={isThreadRunning}
          onOpenFile={onOpenFile}
        />
      );
    case "task": {
      return (
        <TaskMessage
          part={block.part}
          link={taskLinkByPartID.get(block.part.id) ?? null}
          isThreadRunning={isThreadRunning}
          isOpen={block.part.id === openTaskPartID}
          onOpen={onOpenTask}
        />
      );
    }
    case "work":
      return (
        <WorkBlock
          parts={block.parts}
          conversationDensity={conversationDensity}
          isThreadRunning={isThreadRunning}
          isLive={isLive}
        />
      );
    case "notice":
      return <NoticePartRow part={block.part} />;
    case "error":
      return <NoticeRow severity="error" name="Assistant error" message={block.message} />;
  }
}

function ReasoningPartRow({
  part,
  isThreadRunning,
  onOpenFile,
}: {
  readonly part: ReasoningPart;
  readonly isThreadRunning: boolean;
  readonly onOpenFile: ((path: string) => void) | undefined;
}): React.ReactElement {
  const isStreaming = isThreadRunning && isPartActive(part);
  const [isExpanded, setExpanded] = React.useState(isStreaming);
  return (
    <div {...stylex.props(styles.reasoningGroup)}>
      <ToolCallLine
        verb={isStreaming ? "Thinking" : "Thought"}
        detail={reasoningDuration(part)}
        state={isStreaming ? "running" : "done"}
        isExpanded={isExpanded}
        onToggle={() => {
          setExpanded((current) => !current);
        }}
      />
      {isExpanded ? (
        <ReasoningBlock isStreaming={isStreaming}>
          <Markdown text={part.text} isStreaming={isStreaming} onOpenFile={onOpenFile} />
        </ReasoningBlock>
      ) : null}
    </div>
  );
}

function reasoningDuration(part: ReasoningPart): string | undefined {
  if (part.time.end === undefined) {
    return undefined;
  }
  const durationMs = Math.max(0, part.time.end - part.time.start);
  if (durationMs < 500) {
    return "briefly";
  }
  return `for ${String(Math.max(1, Math.round(durationMs / 1_000)))}s`;
}

function NoticePartRow({ part }: { part: ThreadPart }): React.ReactElement | null {
  if (part.type === "retry") {
    return (
      <NoticeRow
        severity="warning"
        name={`Retry ${String(part.attempt)}`}
        message={part.error.data.message}
      />
    );
  }
  if (part.type === "compaction") {
    return (
      <CompactionDivider
        summary={part.auto ? "Context compacted automatically" : "Context compacted"}
      />
    );
  }
  return null;
}

function WorkBlock({
  parts,
  conversationDensity,
  isThreadRunning,
  isLive,
}: {
  parts: readonly WorkPart[];
  conversationDensity: ConversationDensity;
  isThreadRunning: boolean;
  isLive: boolean;
}): React.ReactElement | null {
  const [isExpanded, setExpanded] = React.useState(false);
  // Running presentation follows the thread-level status (via the live-tail block),
  // not per-part state: parts complete while the session keeps working.
  const isRunning = isLive;
  const rows = parts
    .map((part) => (
      <WorkPartRow
        key={`${conversationDensity}:${part.id}`}
        part={part}
        allowToolDisclosure={
          conversationDensity !== "compact-all-grouped" || !isRunning || parts.length === 1
        }
        defaultToolExpanded={conversationDensity === "detailed"}
        isThreadRunning={isThreadRunning}
      />
    ))
    .filter((node): node is React.ReactElement => node !== null);
  if (rows.length === 0) {
    return null;
  }

  // A single part presents itself; the grouped header only earns its place when it
  // summarizes several parts at once.
  if (conversationDensity !== "compact-all-grouped" || parts.length === 1) {
    return <WorkGroup isRunning={isRunning}>{rows}</WorkGroup>;
  }

  const summary = summarizeWork(parts, isRunning);

  if (isRunning) {
    const tail = latestWork(parts);
    return (
      <WorkGroup isRunning>
        <WorkGroup.Header verb={summary.verb} detail={summary.detail} isRunning />
        <WorkGroup.Preview isScrollable={rows.length > PREVIEW_SCROLLABLE_ROWS}>
          {rows}
        </WorkGroup.Preview>
        {tail?.kind === "output" ? (
          <WorkGroup.OutputStrip isPreview>{tail.text}</WorkGroup.OutputStrip>
        ) : tail?.kind === "diff" ? (
          <ToolArtifactPreview artifact={tail.artifact} isExpanded={false} />
        ) : null}
      </WorkGroup>
    );
  }

  return (
    <WorkGroup>
      <WorkGroup.Header
        verb={summary.verb}
        detail={summary.detail}
        isExpanded={isExpanded}
        onToggle={() => {
          setExpanded((current) => !current);
        }}
      />
      {isExpanded ? rows : null}
    </WorkGroup>
  );
}

type LatestWork =
  | { readonly kind: "output"; readonly text: string }
  | { readonly kind: "diff"; readonly artifact: ToolDiffArtifact };

function latestWork(parts: readonly ThreadPart[]): LatestWork | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part === undefined || part.type !== "tool") continue;
    const output = toolOutput(part);
    if (output !== undefined && output.length > 0) return { kind: "output", text: output };
    // A settled file edit hands its content to the diff artifact (toolOutput is undefined
    // by design), so the live tail shows that diff: Editing → Edited swaps the streaming
    // text for the finished patch instead of closing the block.
    const artifact = toolArtifact(part);
    if (artifact?.kind === "diff") return { kind: "diff", artifact };
  }
  return undefined;
}

const CATEGORY_VERB: Record<ToolCategory, string> = {
  edit: "Edited",
  run: "Ran",
  explore: "Explored",
  delegate: "Worked",
  plan: "Planned",
  other: "Worked",
};
// A live group keeps shimmering between tool calls, so its verb must stay
// present tense; a shimmering "Explored" reads as finished work stuck running.
const CATEGORY_VERB_RUNNING: Record<ToolCategory, string> = {
  edit: "Editing",
  run: "Running",
  explore: "Exploring",
  delegate: "Working",
  plan: "Planning",
  other: "Working",
};
const CATEGORY_PRECEDENCE: readonly ToolCategory[] = [
  "edit",
  "run",
  "explore",
  "delegate",
  "plan",
  "other",
];

function summarizeWork(
  parts: readonly WorkPart[],
  isRunning: boolean,
): {
  readonly verb: string;
  readonly detail: string | undefined;
} {
  const active = parts.findLast(
    (part): part is ToolPart => part.type === "tool" && isPartActive(part),
  );
  if (active !== undefined) {
    return { verb: toolVerb(active), detail: toolDetail(active) };
  }

  const counts = new Map<ToolCategory, number>();
  let steps = 0;
  for (const part of parts) {
    steps += 1;
    const category =
      part.type === "tool"
        ? toolCategory(part.tool)
        : part.type === "subtask" || part.type === "agent"
          ? "delegate"
          : "other";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  let best: ToolCategory = "other";
  let bestCount = 0;
  for (const category of CATEGORY_PRECEDENCE) {
    const count = counts.get(category) ?? 0;
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }

  return {
    verb: (isRunning ? CATEGORY_VERB_RUNNING : CATEGORY_VERB)[best],
    detail: steps > 1 ? `${String(steps)} steps` : undefined,
  };
}

function WorkPartRow({
  part,
  allowToolDisclosure,
  defaultToolExpanded,
  isThreadRunning,
}: {
  part: WorkPart;
  allowToolDisclosure: boolean;
  defaultToolExpanded: boolean;
  isThreadRunning: boolean;
}): React.ReactElement | null {
  switch (part.type) {
    case "tool":
      return (
        <ToolMessage
          part={part}
          allowDisclosure={allowToolDisclosure}
          defaultExpanded={defaultToolExpanded}
          // Only an idle thread proves a still-"running" part is orphaned. A part in a
          // non-tail block of a running turn is genuinely live and keeps its own state.
          stateOverride={!isThreadRunning && isPartActive(part) ? "done" : undefined}
        />
      );
    case "file":
      return <ToolCallLine verb="Attached" detail={part.filename ?? part.url} />;
    case "subtask":
      return <ToolCallLine verb="Worked" detail={part.description} />;
    case "agent":
      return <ToolCallLine verb="Agent" detail={part.name} />;
    default:
      return null;
  }
}
