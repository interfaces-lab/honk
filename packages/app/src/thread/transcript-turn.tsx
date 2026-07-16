import * as stylex from "@stylexjs/stylex";
import type { ConversationDensity } from "@honk/shared/conversation-density";
import { ChangeReceipt, ToolCallLine, type ToolCallState, UserMessage, WorkGroup } from "@honk/ui";
import { AssistantMessage } from "@honk/ui/assistant-message";
import { CompactionDivider } from "@honk/ui/compaction-divider";
import { NoticeRow } from "@honk/ui/notice-row";
import { ReasoningBlock } from "@honk/ui/reasoning-block";
import type { TimelineNavigatorItem } from "@honk/ui/timeline-navigator";
import {
  colorVars,
  controlVars,
  conversationVars,
  fontVars,
  radiusVars,
  spaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { ThreadMessageEdit } from "../composer/types";
import { Markdown } from "../markdown";
import { ToolMessage } from "../tool-message";
import {
  toolCategory,
  toolDetail,
  toolOutput,
  toolVerb,
  type ToolCategory,
} from "../tool-presentation";
import {
  isPartActive,
  segmentAssistantTurn,
  turnDiffs,
  type AssistantThreadMessage,
  type FilePart,
  type ReasoningPart,
  type RenderableThreadDiff,
  type TextPart,
  type ThreadPart,
  type ThreadTurn,
  type ToolPart,
  type TranscriptBlock,
  type WorkPart,
} from "./transcript-model";

const PREVIEW_SCROLLABLE_ROWS = 5;
const EMPTY_PARTS: readonly ThreadPart[] = Object.freeze([]);
const EMPTY_TASK_STATES: ReadonlyMap<string, ToolCallState> = new Map();
const USER_ATTACHMENT_MAX_WIDTH = "240px";
const USER_ATTACHMENT_IMAGE_MAX_HEIGHT = "160px";
const USER_ATTACHMENT_CHIP_PADDING_BLOCK = "1px";

const styles = stylex.create({
  turn: { display: "flex", flexDirection: "column", gap: spaceVars["--honk-space-panel-pad"] },
  pinnedUserMessage: {
    position: "sticky",
    top: 0,
    zIndex: zVars["--honk-z-thread-sticky-message"],
  },
  assistantStack: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
  },
  reasoningGroup: {
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-row-gap"],
  },
  preWrap: { whiteSpace: "pre-wrap" },
  userAttachments: {
    display: "flex",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
    marginTop: controlVars["--honk-control-gap"],
  },
  userAttachmentChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    maxWidth: USER_ATTACHMENT_MAX_WIDTH,
    paddingBlock: USER_ATTACHMENT_CHIP_PADDING_BLOCK,
    paddingInline: controlVars["--honk-control-gap"],
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  userAttachmentImage: {
    display: "block",
    maxWidth: USER_ATTACHMENT_MAX_WIDTH,
    maxHeight: USER_ATTACHMENT_IMAGE_MAX_HEIGHT,
    borderRadius: radiusVars["--honk-radius-control"],
    objectFit: "cover",
  },
});

export function turnTimelineItem(
  turn: ThreadTurn,
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>,
): TimelineNavigatorItem {
  const userText = timelineMessageText(turn.user === null ? [] : [turn.user.id], partsByMessageId);
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

export function ThreadTurnRow({
  rowRef,
  turn,
  partsByMessageId,
  isLast,
  isThreadRunning,
  conversationDensity,
  onInterrupt,
  onEditMessage,
  onReviewChanges,
  editDraft = null,
  editComposer = null,
  onOpenTask,
  openTaskPartID = null,
  taskStateByPartID = EMPTY_TASK_STATES,
  showDiffSummary = true,
}: {
  readonly rowRef?: React.Ref<HTMLDivElement>;
  readonly turn: ThreadTurn;
  readonly partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>;
  readonly isLast: boolean;
  readonly isThreadRunning: boolean;
  readonly conversationDensity: ConversationDensity;
  readonly onInterrupt?: (() => void) | undefined;
  readonly onEditMessage?: ((draft: ThreadMessageEdit) => void) | undefined;
  readonly onReviewChanges?: (() => void) | undefined;
  readonly editDraft?: ThreadMessageEdit | null;
  readonly editComposer?: React.ReactNode;
  readonly onOpenTask?: ((part: ToolPart) => void) | undefined;
  readonly openTaskPartID?: string | null | undefined;
  readonly taskStateByPartID?: ReadonlyMap<string, ToolCallState> | undefined;
  readonly showDiffSummary?: boolean | undefined;
}): React.ReactElement {
  const diffs = turnDiffs(turn.user);
  const showDiffs = showDiffSummary && diffs.length > 0 && (!isLast || !isThreadRunning);

  return (
    <div ref={rowRef} {...stylex.props(styles.turn)}>
      {turn.user !== null ? (
        <UserThreadMessageRow
          messageID={turn.user.id}
          parts={partsByMessageId.get(turn.user.id) ?? EMPTY_PARTS}
          requiresRevertConfirmation={!isLast || diffs.length > 0}
          onEditMessage={onEditMessage}
          editDraft={editDraft}
          editComposer={editComposer}
        />
      ) : null}
      {turn.assistants.length > 0 ? (
        <AssistantTurnRows
          messages={turn.assistants}
          partsByMessageId={partsByMessageId}
          conversationDensity={conversationDensity}
          onInterrupt={onInterrupt}
          onOpenTask={onOpenTask}
          openTaskPartID={openTaskPartID}
          taskStateByPartID={taskStateByPartID}
        />
      ) : null}
      {showDiffs ? <TurnDiffSummary diffs={diffs} onReview={onReviewChanges} /> : null}
    </div>
  );
}

function TurnDiffSummary({
  diffs,
  onReview,
}: {
  readonly diffs: readonly RenderableThreadDiff[];
  readonly onReview?: (() => void) | undefined;
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
    />
  );
}

function UserThreadMessageRow({
  messageID,
  parts,
  requiresRevertConfirmation,
  onEditMessage,
  editDraft,
  editComposer,
}: {
  readonly messageID: string;
  readonly parts: readonly ThreadPart[];
  readonly requiresRevertConfirmation: boolean;
  readonly onEditMessage: ((draft: ThreadMessageEdit) => void) | undefined;
  readonly editDraft: ThreadMessageEdit | null;
  readonly editComposer: React.ReactNode;
}): React.ReactElement {
  const text = parts
    .filter((part): part is TextPart => part.type === "text" && part.synthetic !== true)
    .map((part) => part.text)
    .join("\n\n");
  const files = parts.filter((part): part is FilePart => part.type === "file");

  if (editDraft?.messageID === messageID && editComposer !== null) {
    return <div {...stylex.props(styles.pinnedUserMessage)}>{editComposer}</div>;
  }

  const onEdit =
    onEditMessage === undefined
      ? undefined
      : (): void => {
          onEditMessage({
            messageID,
            requiresRevertConfirmation,
            text,
            files: files.map((file) => ({
              path: file.url,
              filename: file.filename ?? fileUrlBasename(file.url),
              mime: file.mime,
            })),
          });
        };

  return (
    <div {...stylex.props(styles.pinnedUserMessage)}>
      <UserMessage onEdit={onEdit}>
        <UserMessage.Preview>
          <PlainText text={text} fallback={files.length > 0 ? "" : "(empty message)"} />
        </UserMessage.Preview>
        {files.length > 0 && (
          <span {...stylex.props(styles.userAttachments)}>
            {files.map((file) => (
              <UserAttachment key={file.id} file={file} />
            ))}
          </span>
        )}
      </UserMessage>
    </div>
  );
}

function AssistantTurnRows({
  messages,
  partsByMessageId,
  conversationDensity,
  onInterrupt,
  onOpenTask,
  openTaskPartID,
  taskStateByPartID,
}: {
  messages: readonly AssistantThreadMessage[];
  partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>;
  conversationDensity: ConversationDensity;
  onInterrupt: (() => void) | undefined;
  onOpenTask: ((part: ToolPart) => void) | undefined;
  openTaskPartID: string | null;
  taskStateByPartID: ReadonlyMap<string, ToolCallState>;
}): React.ReactElement {
  const blocks = segmentAssistantTurn(messages, partsByMessageId);

  return (
    <div {...stylex.props(styles.assistantStack)}>
      {blocks.map((block) => (
        <BlockRow
          key={`${conversationDensity}:${block.key}`}
          block={block}
          conversationDensity={conversationDensity}
          onInterrupt={onInterrupt}
          onOpenTask={onOpenTask}
          openTaskPartID={openTaskPartID}
          taskStateByPartID={taskStateByPartID}
        />
      ))}
    </div>
  );
}

function UserAttachment({ file }: { file: FilePart }): React.ReactElement {
  const name = file.filename ?? fileUrlBasename(file.url);
  if (file.mime.startsWith("image/")) {
    return <img src={file.url} alt={name} {...stylex.props(styles.userAttachmentImage)} />;
  }
  return (
    <span {...stylex.props(styles.userAttachmentChip)} title={name}>
      {name}
    </span>
  );
}

function fileUrlBasename(url: string): string {
  if (url.startsWith("data:")) return "attachment";
  const trimmed = url.replace(/^file:\/\//, "").replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : url;
}

function BlockRow({
  block,
  conversationDensity,
  onInterrupt,
  onOpenTask,
  openTaskPartID,
  taskStateByPartID,
}: {
  block: TranscriptBlock;
  conversationDensity: ConversationDensity;
  onInterrupt: (() => void) | undefined;
  onOpenTask: ((part: ToolPart) => void) | undefined;
  openTaskPartID: string | null;
  taskStateByPartID: ReadonlyMap<string, ToolCallState>;
}): React.ReactElement | null {
  switch (block.kind) {
    case "prose":
      return <AssistantText text={block.part.text} isStreaming={isPartActive(block.part)} />;
    case "reasoning":
      return <ReasoningPartRow part={block.part} />;
    case "task": {
      const taskState = taskStateByPartID.get(block.part.id);
      return (
        <ToolMessage
          part={block.part}
          {...(taskState === undefined
            ? {}
            : {
                stateOverride: taskState,
                onOpenTask,
                taskSelected: block.part.id === openTaskPartID,
              })}
        />
      );
    }
    case "work":
      return (
        <WorkBlock
          parts={block.parts}
          conversationDensity={conversationDensity}
          onInterrupt={onInterrupt}
        />
      );
    case "notice":
      return <NoticePartRow part={block.part} />;
    case "error":
      return <NoticeRow severity="error" name="Assistant error" message={block.message} />;
  }
}

function ReasoningPartRow({ part }: { readonly part: ReasoningPart }): React.ReactElement {
  const isStreaming = isPartActive(part);
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
          <Markdown text={part.text} isStreaming={isStreaming} />
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
  onInterrupt,
}: {
  parts: readonly WorkPart[];
  conversationDensity: ConversationDensity;
  onInterrupt: (() => void) | undefined;
}): React.ReactElement | null {
  const [isExpanded, setExpanded] = React.useState(false);
  const isRunning = parts.some(isPartActive);
  const rows = parts
    .map((part) => (
      <WorkPartRow
        key={`${conversationDensity}:${part.id}`}
        part={part}
        allowToolDisclosure={
          conversationDensity !== "compact-all-grouped" || !isRunning || parts.length === 1
        }
        defaultToolExpanded={conversationDensity === "detailed"}
      />
    ))
    .filter((node): node is React.ReactElement => node !== null);
  if (rows.length === 0) {
    return null;
  }

  const summary = summarizeWork(parts);

  if (conversationDensity !== "compact-all-grouped") {
    return <WorkGroup isRunning={isRunning}>{rows}</WorkGroup>;
  }

  if (parts.length === 1) {
    return <WorkGroup isRunning={isRunning}>{rows}</WorkGroup>;
  }

  if (isRunning) {
    const tail = latestOutput(parts);
    return (
      <WorkGroup isRunning>
        <WorkGroup.Header
          verb={summary.verb}
          detail={summary.detail}
          isRunning
          {...(onInterrupt === undefined ? {} : { onStop: onInterrupt })}
        />
        <WorkGroup.Preview isScrollable={rows.length > PREVIEW_SCROLLABLE_ROWS}>
          {rows}
        </WorkGroup.Preview>
        {tail !== undefined ? <WorkGroup.OutputStrip>{tail}</WorkGroup.OutputStrip> : null}
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

function latestOutput(parts: readonly ThreadPart[]): string | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part !== undefined && part.type === "tool") {
      const output = toolOutput(part);
      if (output !== undefined && output.length > 0) return output;
    }
  }
  return undefined;
}

const CATEGORY_VERB: Record<ToolCategory, string> = {
  edit: "Edited",
  run: "Ran",
  explore: "Explored",
  delegate: "Delegated",
  plan: "Planned",
  other: "Worked",
};
const CATEGORY_PRECEDENCE: readonly ToolCategory[] = [
  "edit",
  "run",
  "explore",
  "delegate",
  "plan",
  "other",
];

function summarizeWork(parts: readonly WorkPart[]): {
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
        : part.type === "patch"
          ? "edit"
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
    verb: CATEGORY_VERB[best],
    detail: steps > 1 ? `${String(steps)} steps` : undefined,
  };
}

function WorkPartRow({
  part,
  allowToolDisclosure,
  defaultToolExpanded,
}: {
  part: WorkPart;
  allowToolDisclosure: boolean;
  defaultToolExpanded: boolean;
}): React.ReactElement | null {
  switch (part.type) {
    case "tool":
      return (
        <ToolMessage
          part={part}
          allowDisclosure={allowToolDisclosure}
          defaultExpanded={defaultToolExpanded}
        />
      );
    case "file":
      return <ToolCallLine verb="Attached" detail={part.filename ?? part.url} />;
    case "subtask":
      return <ToolCallLine verb="Delegated" detail={`${part.agent} · ${part.description}`} />;
    case "agent":
      return <ToolCallLine verb="Agent" detail={part.name} />;
    case "patch":
      return <PatchPartRow files={part.files} />;
    default:
      return null;
  }
}

function AssistantText(props: {
  readonly text: string;
  readonly isStreaming: boolean;
}): React.ReactElement {
  return (
    <AssistantMessage isStreaming={props.isStreaming}>
      <Markdown text={props.text} isStreaming={props.isStreaming} />
    </AssistantMessage>
  );
}

function PlainText({
  text,
  fallback = "",
}: {
  readonly text: string;
  readonly fallback?: string;
}): React.ReactElement {
  return <span {...stylex.props(styles.preWrap)}>{text.length === 0 ? fallback : text}</span>;
}

function PatchPartRow({ files }: { files: readonly string[] }): React.ReactElement {
  const detail =
    files.length === 0
      ? "No files"
      : `${String(files.length)} ${files.length === 1 ? "file" : "files"}`;
  return <ToolCallLine verb="Changed" detail={detail} />;
}
