import { type EnvironmentId, type MessageId, type ThreadId } from "@honk/contracts";
import { Button } from "@honk/honkkit/button";
import {
  ConversationScroller,
  type ConversationScrollerController,
} from "@honk/honkkit/conversation-scroller";
import { IconChevronRightMedium } from "central-icons";
import {
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { useConversationDensity } from "~/hooks/use-conversation-density";
import {
  type PendingApproval,
  type TimelineEntry,
  type TimelineEntryId,
} from "../../../session-logic";
import { type ChatMessage, type ProposedPlan } from "../../../types";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  isCommandWorkEntry,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./timeline-rows";
import {
  EMPTY_PENDING_APPROVAL_KINDS,
  type PendingApprovalRequestKind,
} from "./timeline-render-items";
import { cn } from "~/lib/utils";
import {
  GroupedStepsRenderer,
  StepRenderer,
  countRenderableWorkGroupPreviewSteps,
  runningWorkGroupPreviewOutputStripExtraPx,
  WORK_GROUP_HEADER_GAP_PX,
  WORK_GROUP_HEADER_PX,
  WORK_GROUP_PREVIEW_ENTRY_PX,
  WORK_GROUP_PREVIEW_PX,
  WORK_GROUP_STEP_GAP_PX,
  type StepRendererContext,
} from "./step-renderer";

type UserMessageTimelineRow = Extract<MessagesTimelineRow, { kind: "message" }>;

const VIRTUAL_ROW_GAP_PX = 12;

interface MessagesTimelineProps {
  isTurnActive: boolean;
  isStreaming?: boolean;
  editUserMessagesDisabled: boolean;
  bottomClearancePx?: number | undefined;
  scrollerControllerRef: RefObject<ConversationScrollerController | null>;
  timelineEntries: ReadonlyArray<TimelineEntry>;
  pendingApprovals?: ReadonlyArray<PendingApproval> | undefined;
  editableUserMessageIds: ReadonlySet<MessageId>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  timelineCacheKey: string;
  markdownCwd: string | undefined;
  projectRoot: string | undefined;
  isServerThread: boolean;
  editingUserMessageId?: MessageId | null | undefined;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
  renderEditComposer?: ((message: ChatMessage) => ReactNode) | undefined;
  onUpdateProposedPlan?: (proposedPlan: ProposedPlan, nextMarkdown: string) => Promise<boolean>;
  onIsAtEndChange: (isAtEnd: boolean) => void;
}

export function MessagesTimeline({
  isTurnActive,
  isStreaming = false,
  editUserMessagesDisabled,
  bottomClearancePx = 0,
  scrollerControllerRef,
  timelineEntries,
  pendingApprovals,
  editableUserMessageIds,
  onImageExpand,
  activeThreadEnvironmentId,
  activeThreadId,
  timelineCacheKey,
  markdownCwd,
  projectRoot,
  isServerThread,
  editingUserMessageId = null,
  onBeginEditUserMessage,
  renderEditComposer,
  onUpdateProposedPlan,
  onIsAtEndChange,
}: MessagesTimelineProps) {
  const conversationDensity = useConversationDensity();
  const pendingApprovalKinds: ReadonlySet<PendingApprovalRequestKind> =
    pendingApprovals && pendingApprovals.length > 0
      ? new Set(pendingApprovals.map((approval) => approval.requestKind))
      : EMPTY_PENDING_APPROVAL_KINDS;
  const rawRows = deriveMessagesTimelineRows({
    timelineEntries,
    isTurnActive,
    editableUserMessageIds,
    projectRoot,
    conversationDensity,
    pendingApprovalKinds,
  });
  const rows = useStableRows(rawRows);
  const [expandedWorkGroupIds, setExpandedWorkGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleWorkGroupExpanded = (rowId: string) => {
    setExpandedWorkGroupIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };
  const sharedState: StepRendererContext = {
    markdownCwd,
    projectRoot,
    activeThreadId,
    activeThreadEnvironmentId,
    isServerThread,
    pendingApprovalKinds,
    onBeginEditUserMessage,
    renderEditComposer,
    onUpdateProposedPlan,
    onImageExpand,
  };
  return (
    <MessagesTimelineScroller
      bottomClearancePx={bottomClearancePx}
      editUserMessagesDisabled={editUserMessagesDisabled}
      editingUserMessageId={editingUserMessageId}
      expandedWorkGroupIds={expandedWorkGroupIds}
      isStreaming={isStreaming}
      onIsAtEndChange={onIsAtEndChange}
      onToggleWorkGroupExpanded={toggleWorkGroupExpanded}
      rows={rows}
      scrollerControllerRef={scrollerControllerRef}
      sharedState={sharedState}
      timelineCacheKey={timelineCacheKey}
    />
  );
}

function MessagesTimelineScroller({
  bottomClearancePx,
  editUserMessagesDisabled,
  editingUserMessageId,
  expandedWorkGroupIds,
  isStreaming,
  onIsAtEndChange,
  onToggleWorkGroupExpanded,
  rows,
  scrollerControllerRef,
  sharedState,
  timelineCacheKey,
}: {
  bottomClearancePx: number;
  editUserMessagesDisabled: boolean;
  editingUserMessageId: MessageId | null;
  expandedWorkGroupIds: ReadonlySet<string>;
  isStreaming: boolean;
  onIsAtEndChange: (isAtEnd: boolean) => void;
  onToggleWorkGroupExpanded: (rowId: string) => void;
  rows: ReadonlyArray<MessagesTimelineRow>;
  scrollerControllerRef: RefObject<ConversationScrollerController | null>;
  sharedState: StepRendererContext;
  timelineCacheKey: string;
}) {
  return (
    <ConversationScroller
      aria-label="Messages"
      cacheKey={timelineCacheKey}
      canReuseMeasurement={(row) => row.kind !== "work"}
      className="pt-(--chat-timeline-padding-block-start)"
      contentClassName="mx-auto box-border max-w-agent-chat"
      controllerRef={scrollerControllerRef}
      estimateRowSize={(row) => estimateVirtualTimelineRowSize(row, expandedWorkGroupIds)}
      getRowId={(row) => row.id}
      isAnchorRow={isUserMessageRow}
      isStreaming={isStreaming}
      onIsAtEndChange={onIsAtEndChange}
      bottomClearancePx={bottomClearancePx}
      rowClassName="px-4 pb-(--chat-timeline-row-gap)"
      rows={rows}
      shouldRenderStickyOverlay={(row) =>
        row.kind === "message" &&
        row.message.role === "user" &&
        row.message.id === editingUserMessageId
      }
      stickyOverlayClassName="z-(--z-index-chat-timeline-floating-edit-row)"
      stickyTop="var(--chat-timeline-padding-block-start)"
      viewportDataAttributes={{ "data-chat-timeline-scroll": "" }}
      viewportClassName="scrollbar-thin"
      renderRow={({ row, isActiveSticky }) => {
        const isEditingUserMessage =
          row.kind === "message" &&
          row.message.role === "user" &&
          row.message.id === editingUserMessageId;

        return (
          <div
            className="w-full"
            data-editing-user-message={isEditingUserMessage ? "true" : undefined}
            data-sticky={isActiveSticky ? "true" : undefined}
          >
            <TimelineRowContent
              row={row}
              workGroupExpanded={
                row.kind === "work" && "steps" in row && expandedWorkGroupIds.has(row.id)
              }
              onToggleWorkGroupExpanded={onToggleWorkGroupExpanded}
              editUserMessagesDisabled={editUserMessagesDisabled}
              isEditingUserMessage={isEditingUserMessage}
              ctx={sharedState}
            />
          </div>
        );
      }}
      renderStickyOverlay={({ row }) => (
        <div
          className="mx-auto box-border w-full max-w-agent-chat px-4 pb-(--chat-timeline-row-gap)"
          data-floating-edit-row-backplate="true"
        >
          <div
            className="pointer-events-auto w-full"
            data-editing-user-message="true"
            data-sticky="true"
          >
            <TimelineRowContent
              row={row}
              workGroupExpanded={false}
              onToggleWorkGroupExpanded={onToggleWorkGroupExpanded}
              editUserMessagesDisabled={editUserMessagesDisabled}
              isEditingUserMessage
              ctx={sharedState}
            />
          </div>
        </div>
      )}
      renderScrollToEndButton={({ scrollToEnd }) => (
        <div className="pointer-events-none absolute bottom-[calc(44px+1.25rem)] left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => scrollToEnd({ animated: true })}
            className="pointer-events-auto rounded-full bg-(--honk-composer-surface-background)! text-honk-icon-secondary hover:bg-(--honk-composer-surface-background)! data-pressed:bg-(--honk-composer-surface-background)!"
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
          >
            <IconChevronRightMedium
              className="size-3 rotate-90 text-honk-icon-secondary"
              aria-hidden="true"
            />
          </Button>
        </div>
      )}
    />
  );
}

function isUserMessageRow(row: MessagesTimelineRow): row is UserMessageTimelineRow {
  return row.kind === "message" && row.message.role === "user";
}

const ASSISTANT_MESSAGE_MIN_PX = 64;
const USER_MESSAGE_MIN_PX = 56;

function estimateVirtualTimelineRowSize(
  row: MessagesTimelineRow,
  expandedWorkGroupIds: ReadonlySet<string>,
): number {
  return estimateTimelineRowSize(
    row,
    row.kind === "work" && "steps" in row && expandedWorkGroupIds.has(row.id),
  );
}

const runningWorkGroupEstimateHeights = new Map<string, number>();

function estimateTimelineRowSize(row: MessagesTimelineRow, expanded = false): number {
  if (row.kind === "message") {
    return estimateMessageTimelineRowSize(row);
  }

  if (row.kind === "proposed-plan") {
    return 180 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "runtime-thinking") {
    return 96 + VIRTUAL_ROW_GAP_PX;
  }

  if (
    row.kind === "runtime-task" ||
    row.kind === "runtime-tool" ||
    row.kind === "runtime-extension-ui-request"
  ) {
    return 64 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "working") {
    return 52 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "work" && "entry" in row) {
    return 64 + VIRTUAL_ROW_GAP_PX;
  }

  if (expanded) {
    const hasExpandedSummary =
      row.groupedEntries.length > 0
        ? row.groupedEntries.some((entry) => !isCommandWorkEntry(entry))
        : !row.isCommandGroup && !row.isThinkingGroup;
    const expandedRowCount = row.steps.length + (hasExpandedSummary ? 1 : 0);
    const childRowsHeight = row.steps.length * WORK_GROUP_PREVIEW_ENTRY_PX;
    const expandedContentGap = Math.max(0, expandedRowCount - 1) * WORK_GROUP_STEP_GAP_PX;
    return (
      WORK_GROUP_HEADER_PX +
      WORK_GROUP_HEADER_GAP_PX +
      childRowsHeight +
      (hasExpandedSummary ? WORK_GROUP_PREVIEW_ENTRY_PX : 0) +
      expandedContentGap +
      VIRTUAL_ROW_GAP_PX
    );
  }

  if (row.isRunning) {
    const previewCount = countRenderableWorkGroupPreviewSteps(row.steps);
    const previewStepsHeight =
      previewCount > 0
        ? previewCount * WORK_GROUP_PREVIEW_ENTRY_PX +
          Math.max(0, previewCount - 1) * WORK_GROUP_STEP_GAP_PX
        : 0;
    const previewRawHeight =
      previewStepsHeight + runningWorkGroupPreviewOutputStripExtraPx(row.steps);
    const previewContentHeight = Math.min(WORK_GROUP_PREVIEW_PX, previewRawHeight);
    const previewPaddingTop =
      previewCount > 0 && previewContentHeight >= WORK_GROUP_PREVIEW_PX
        ? WORK_GROUP_STEP_GAP_PX
        : 0;
    const previewHeight = previewContentHeight + previewPaddingTop;
    const computedHeight =
      WORK_GROUP_HEADER_PX + WORK_GROUP_HEADER_GAP_PX + previewHeight + VIRTUAL_ROW_GAP_PX;
    const previousHeight = runningWorkGroupEstimateHeights.get(row.id);
    const totalHeight =
      previousHeight === undefined ? computedHeight : Math.max(previousHeight, computedHeight);
    runningWorkGroupEstimateHeights.set(row.id, totalHeight);
    return totalHeight;
  }

  if (row.kind === "work" && !("entry" in row)) {
    runningWorkGroupEstimateHeights.delete(row.id);
  }

  return WORK_GROUP_HEADER_PX + VIRTUAL_ROW_GAP_PX;
}

function estimateMessageTimelineRowSize(row: Extract<MessagesTimelineRow, { kind: "message" }>) {
  const minHeight = row.message.role === "user" ? USER_MESSAGE_MIN_PX : ASSISTANT_MESSAGE_MIN_PX;
  return minHeight + VIRTUAL_ROW_GAP_PX;
}

// Route each row model to its renderer.

type TimelineRow = MessagesTimelineRow;

function TimelineRowContent({
  row,
  workGroupExpanded,
  onToggleWorkGroupExpanded,
  editUserMessagesDisabled,
  isEditingUserMessage = false,
  ctx,
}: {
  row: TimelineRow;
  workGroupExpanded: boolean;
  onToggleWorkGroupExpanded: (rowId: string) => void;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage?: boolean;
  ctx: StepRendererContext;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 overflow-x-hidden",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
      )}
      data-meta-agent-chat-bubble-id={row.id}
      data-meta-agent-chat-message-kind={timelineRowKind(row)}
      data-timeline-root="true"
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
      data-message-kind={timelineRowMessageKind(row)}
      data-message-index={row.kind === "message" ? row.messageIndex : undefined}
      data-message-pair-id={row.kind === "message" ? (row.pairId ?? undefined) : undefined}
      data-tool-call-id={
        row.kind === "runtime-task" || row.kind === "runtime-tool" ? row.tool.toolCallId : undefined
      }
      data-tool-status={timelineRowToolStatus(row)}
      data-tool-has-error={timelineRowToolHasError(row) ? "true" : undefined}
    >
      <TimelineRowBody
        row={row}
        workGroupExpanded={workGroupExpanded}
        onToggleWorkGroupExpanded={onToggleWorkGroupExpanded}
        editUserMessagesDisabled={editUserMessagesDisabled}
        isEditingUserMessage={isEditingUserMessage}
        ctx={ctx}
      />
    </div>
  );
}

function TimelineRowBody({
  row,
  workGroupExpanded,
  onToggleWorkGroupExpanded,
  editUserMessagesDisabled,
  isEditingUserMessage,
  ctx,
}: {
  row: TimelineRow;
  workGroupExpanded: boolean;
  onToggleWorkGroupExpanded: (rowId: string) => void;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage: boolean;
  ctx: StepRendererContext;
}) {
  if (row.kind === "work" && "steps" in row) {
    return (
      <div className="flex w-full min-w-0">
        <GroupedStepsRenderer
          row={row}
          expanded={workGroupExpanded}
          onToggleExpanded={onToggleWorkGroupExpanded}
          editUserMessagesDisabled={editUserMessagesDisabled}
          ctx={ctx}
        />
      </div>
    );
  }

  return (
    <StepRenderer
      step={row.kind === "working" ? row.step : row}
      editUserMessagesDisabled={editUserMessagesDisabled}
      isEditingUserMessage={isEditingUserMessage}
      ctx={ctx}
    />
  );
}

function timelineRowKind(row: TimelineRow): "human" | "assistant" | "tool-call" | "loading" {
  if (row.kind === "message") return row.message.role === "user" ? "human" : "assistant";
  if (row.kind === "runtime-thinking") return "assistant";
  if (row.kind === "working") return "loading";
  return "tool-call";
}

// Matches Cursor's `data-message-kind` semantics: "message" for user/assistant
// text bubbles, "thinking" for reasoning rows, "tool" for tool-call rows.
// Proposed plans and working rows fall outside this taxonomy.
function timelineRowMessageKind(row: TimelineRow): "message" | "thinking" | "tool" | undefined {
  if (row.kind === "message") return "message";
  if (row.kind === "runtime-thinking") return "thinking";
  if (
    row.kind === "work" ||
    row.kind === "runtime-task" ||
    row.kind === "runtime-tool" ||
    row.kind === "runtime-extension-ui-request"
  ) {
    return "tool";
  }
  return undefined;
}

function timelineRowToolStatus(row: TimelineRow): "loading" | "completed" | "error" | undefined {
  switch (row.kind) {
    case "runtime-task":
    case "runtime-tool":
      if (row.tool.status === "error" || row.tool.isError === true) return "error";
      return row.tool.status === "running" ? "loading" : "completed";
    case "runtime-extension-ui-request":
      return row.request.status === "pending" ? "loading" : "completed";
    case "work":
      if ("entry" in row) {
        if (row.entry.tone === "error" || row.entry.status === "error") {
          return "error";
        }
        return row.entry.status === "running" ? "loading" : "completed";
      }
      // Error state belongs to the individual tool row. Group wrappers stay lifecycle-only so
      // a failed child does not turn the whole collapsed run into a persistent error status.
      return row.isRunning ? "loading" : "completed";
    default:
      return undefined;
  }
}

function timelineRowToolHasError(row: TimelineRow): boolean {
  return timelineRowToolStatus(row) === "error";
}

// Reuse old row references when data has not changed.

function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<TimelineEntryId, MessagesTimelineRow>(),
    result: [],
  });

  const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
  prevState.current = nextState;
  return nextState.result;
}
