import { type EnvironmentId, type MessageId, type TurnId } from "@multi/contracts";
import { useThrottledCallback } from "@tanstack/react-pacer";
import {
  createContext,
  memo,
  use,
  useCallback,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
} from "@tanstack/react-virtual";
import { Spinner } from "@multi/ui/spinner";
import { deriveTimelineEntries } from "../../../session-logic";
import { type ChatMessage, type TurnDiffSummary } from "../../../types";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import { ProposedPlanCard } from "../message/proposed-plan-card";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./messages-timeline.logic";
import { cn } from "~/lib/utils";
import { HumanMessage } from "../message/human-message";
import { AssistantMessage } from "../message/assistant-message";
import { WorkingStatusRow } from "../message/status-row";
import { ToolCallMessage } from "../message/tool-message";

type UserMessageTimelineRow = Extract<MessagesTimelineRow, { kind: "message" }>;

// ---------------------------------------------------------------------------
// Context — shared state consumed by every row component via useContext.
// ---------------------------------------------------------------------------

export interface TimelineRowSharedState {
  activeTurnInProgress: boolean;
  activeTurnId: TurnId | null | undefined;
  isWorking: boolean;
  isRevertingCheckpoint: boolean;
  completionSummary: string | null;
  routeThreadKey: string;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  projectRoot: string | undefined;
  activeThreadEnvironmentId: EnvironmentId;
  isServerThread: boolean;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
  renderEditComposer: ((message: ChatMessage) => ReactNode) | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}

export const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);

const DEFAULT_VIRTUALIZER_RECT = { width: 0, height: 720 };
const VIRTUAL_ROW_GAP_PX = 12;
const VIRTUALIZER_OVERSCAN = 8;
const keepScrollOffsetOnMeasuredRowResize = () => false;

interface MessagesTimelineScrollState {
  isAtBottom: boolean;
}

export interface MessagesTimelineController {
  scrollToBottom: (options?: { animated?: boolean }) => void;
  getScrollState: () => MessagesTimelineScrollState;
}

// ---------------------------------------------------------------------------
// Props (public API)
// ---------------------------------------------------------------------------

interface MessagesTimelineProps {
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnId?: TurnId | null;
  activeTurnStartedAt: string | null;
  bottomClearancePx?: number | undefined;
  timelineControllerRef: React.RefObject<MessagesTimelineController | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  completionSummary: string | null;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  routeThreadKey: string;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  projectRoot: string | undefined;
  isServerThread: boolean;
  editingUserMessageId?: MessageId | null | undefined;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
  renderEditComposer?: ((message: ChatMessage) => ReactNode) | undefined;
  showEmptyState?: boolean | undefined;
  awaitingServerThreadDetail?: boolean | undefined;
  onIsAtBottomChange: (isAtBottom: boolean) => void;
}

// ---------------------------------------------------------------------------
// MessagesTimeline — list owner
// ---------------------------------------------------------------------------

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  activeTurnInProgress,
  activeTurnId,
  activeTurnStartedAt,
  bottomClearancePx = 0,
  timelineControllerRef,
  timelineEntries,
  completionDividerBeforeEntryId,
  completionSummary,
  turnDiffSummaryByAssistantMessageId,
  routeThreadKey,
  onOpenTurnDiff,
  revertTurnCountByUserMessageId,
  isRevertingCheckpoint,
  onImageExpand,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  projectRoot,
  isServerThread,
  editingUserMessageId = null,
  onBeginEditUserMessage,
  renderEditComposer,
  showEmptyState = true,
  awaitingServerThreadDetail = false,
  onIsAtBottomChange,
}: MessagesTimelineProps) {
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        completionDividerBeforeEntryId,
        isWorking,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
        revertTurnCountByUserMessageId,
      }),
    [
      timelineEntries,
      completionDividerBeforeEntryId,
      isWorking,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
      revertTurnCountByUserMessageId,
    ],
  );
  const rows = useStableRows(rawRows);
  const stickyUserRowIndices = useMemo(
    () => rows.flatMap((row, index) => (isUserMessageRow(row) ? [index] : [])),
    [rows],
  );
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const programmaticScrollDeadlineRef = useRef(0);
  const programmaticScrollTargetRef = useRef<number | null>(null);
  const initializedScrollRef = useRef(false);
  const stickyUserRowIndicesRef = useRef(stickyUserRowIndices);
  const virtualizerBottomPadding = Math.max(0, Math.ceil(bottomClearancePx));

  stickyUserRowIndicesRef.current = stickyUserRowIndices;

  const reportIsAtBottom = useCallback(
    (isAtBottom: boolean, options?: { force?: boolean }) => {
      if (!options?.force && isAtBottomRef.current === isAtBottom) {
        return;
      }
      isAtBottomRef.current = isAtBottom;
      onIsAtBottomChange(isAtBottom);
    },
    [onIsAtBottomChange],
  );

  const getIsAtBottom = useCallback(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      return true;
    }

    const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    return maxScrollTop <= 1 || scrollElement.scrollTop >= maxScrollTop - 2;
  }, []);

  const clearProgrammaticScrollTracking = useCallback(() => {
    programmaticScrollTargetRef.current = null;
    if (programmaticScrollFrameRef.current != null) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
      programmaticScrollFrameRef.current = null;
    }
  }, []);

  const scheduleProgrammaticScrollResolution = useCallback(() => {
    if (programmaticScrollFrameRef.current != null) {
      return;
    }

    const resolveProgrammaticScroll = () => {
      programmaticScrollFrameRef.current = null;
      if (programmaticScrollTargetRef.current === null) {
        return;
      }

      const isAtBottom = getIsAtBottom();
      if (isAtBottom || window.performance.now() >= programmaticScrollDeadlineRef.current) {
        programmaticScrollTargetRef.current = null;
        reportIsAtBottom(isAtBottom);
        return;
      }

      programmaticScrollFrameRef.current = window.requestAnimationFrame(resolveProgrammaticScroll);
    };

    programmaticScrollFrameRef.current = window.requestAnimationFrame(resolveProgrammaticScroll);
  }, [getIsAtBottom, reportIsAtBottom]);

  const scrollToBottom = useCallback(
    (options?: { animated?: boolean }) => {
      const scrollElement = scrollElementRef.current;
      if (!scrollElement) {
        return;
      }

      const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
      const animated = options?.animated === true;
      if (animated) {
        programmaticScrollTargetRef.current = maxScrollTop;
        programmaticScrollDeadlineRef.current = window.performance.now() + 1600;
      } else {
        clearProgrammaticScrollTracking();
      }

      scrollElement.scrollTo({
        top: maxScrollTop,
        behavior: animated ? "smooth" : "auto",
      });
      if (animated) {
        scheduleProgrammaticScrollResolution();
      } else {
        reportIsAtBottom(true);
      }
    },
    [clearProgrammaticScrollTracking, reportIsAtBottom, scheduleProgrammaticScrollResolution],
  );

  const scheduleStickToBottom = useThrottledCallback(
    (options?: { animated?: boolean }) => {
      scrollToBottom({ animated: options?.animated ?? false });
    },
    { wait: 16, leading: true, trailing: true },
  );

  useEffect(() => {
    const controller: MessagesTimelineController = {
      scrollToBottom,
      getScrollState: () => ({ isAtBottom: getIsAtBottom() }),
    };

    timelineControllerRef.current = controller;
    return () => {
      if (timelineControllerRef.current === controller) {
        timelineControllerRef.current = null;
      }
    };
  }, [getIsAtBottom, timelineControllerRef, scrollToBottom]);

  useEffect(
    () => () => {
      clearProgrammaticScrollTracking();
    },
    [clearProgrammaticScrollTracking],
  );

  const handleScroll = useCallback(() => {
    const isAtBottom = getIsAtBottom();
    if (programmaticScrollTargetRef.current !== null) {
      if (isAtBottom) {
        clearProgrammaticScrollTracking();
        reportIsAtBottom(true);
      }
      return;
    }

    reportIsAtBottom(isAtBottom);
  }, [clearProgrammaticScrollTracking, getIsAtBottom, reportIsAtBottom]);

  useEffect(() => {
    if (rows.length === 0) {
      return;
    }

    if (!initializedScrollRef.current) {
      initializedScrollRef.current = true;
      reportIsAtBottom(true);
      scheduleStickToBottom();
      return;
    }

    if (!isAtBottomRef.current) {
      return;
    }

    scheduleStickToBottom();
  }, [reportIsAtBottom, rows, scheduleStickToBottom]);

  useEffect(() => {
    if (!isWorking && !activeTurnInProgress) {
      return;
    }
    if (!isAtBottomRef.current) {
      return;
    }

    scheduleStickToBottom();
  }, [activeTurnInProgress, isWorking, scheduleStickToBottom]);

  const rangeExtractor = useCallback((range: Range) => {
    const defaultRange = defaultRangeExtractor(range);
    const activeStickyIndex = findActiveStickyUserRowIndex(
      stickyUserRowIndicesRef.current,
      range.startIndex,
    );

    if (activeStickyIndex === null || defaultRange.includes(activeStickyIndex)) {
      return defaultRange;
    }

    return [activeStickyIndex, ...defaultRange].toSorted((left, right) => left - right);
  }, []);

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: (index) => estimateTimelineRowSize(rows[index]),
    getItemKey: (index) => rows[index]?.id ?? index,
    rangeExtractor,
    overscan: VIRTUALIZER_OVERSCAN,
    paddingEnd: virtualizerBottomPadding,
    initialRect: DEFAULT_VIRTUALIZER_RECT,
    useAnimationFrameWithResizeObserver: true,
    onChange: (_instance, sync) => {
      if (!sync && isAtBottomRef.current) {
        scheduleStickToBottom();
      }
    },
  });
  rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = keepScrollOffsetOnMeasuredRowResize;

  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      activeTurnInProgress,
      activeTurnId: activeTurnId ?? null,
      isWorking,
      isRevertingCheckpoint,
      completionSummary,
      routeThreadKey,
      markdownCwd,
      resolvedTheme,
      projectRoot,
      activeThreadEnvironmentId,
      isServerThread,
      onBeginEditUserMessage,
      renderEditComposer,
      onImageExpand,
      onOpenTurnDiff,
    }),
    [
      activeTurnInProgress,
      activeTurnId,
      isWorking,
      isRevertingCheckpoint,
      completionSummary,
      routeThreadKey,
      markdownCwd,
      resolvedTheme,
      projectRoot,
      activeThreadEnvironmentId,
      isServerThread,
      onBeginEditUserMessage,
      renderEditComposer,
      onImageExpand,
      onOpenTurnDiff,
    ],
  );

  if (rows.length === 0 && !isWorking && awaitingServerThreadDetail) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0 && !isWorking && showEmptyState) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  const virtualItems = rowVirtualizer.getVirtualItems();
  const activeStickyUserRowIndex = findActiveStickyUserRowIndex(
    stickyUserRowIndices,
    rowVirtualizer.range?.startIndex ?? virtualItems[0]?.index ?? 0,
  );
  const virtualContentStyle = {
    height: rowVirtualizer.getTotalSize(),
    position: "relative",
  } satisfies CSSProperties;

  return (
    <TimelineRowCtx.Provider value={sharedState}>
      <div
        className={cn(
          "agent-panel-meta-agent-chat-shell ui-imsg-thread relative flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden",
          "pt-(--chat-timeline-padding-block-start)",
          "[--meta-agent-thread-stack-gap:8px]",
          "[--meta-agent-thread-stack-horizontal-inset:20px]",
          "[--meta-agent-thread-stack-bottom-inset:24px]",
          "[--meta-agent-thread-stack-top-inset:16px]",
        )}
      >
        <div
          ref={scrollElementRef}
          onScroll={handleScroll}
          onPointerDown={clearProgrammaticScrollTracking}
          onTouchStart={clearProgrammaticScrollTracking}
          onWheel={clearProgrammaticScrollTracking}
          className="agent-panel-meta-agent-chat h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [overflow-anchor:none] scrollbar-gutter-stable-both-edges scrollbar-thin"
        >
          <div className="mx-auto box-border w-full max-w-composer" style={virtualContentStyle}>
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) {
                return null;
              }

              const isActiveStickyUserRow = virtualRow.index === activeStickyUserRowIndex;

              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  data-sticky={isActiveStickyUserRow ? "true" : undefined}
                  className={cn(
                    "virtualized-composer-messages-row w-full px-(--composer-messages-padding-inline) pb-(--chat-timeline-row-gap)",
                    isActiveStickyUserRow &&
                      "isolate bg-[color-mix(in_srgb,var(--multi-composer-overlay-bg)_72%,transparent)] backdrop-blur-[18px] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-[linear-gradient(to_bottom,var(--multi-composer-overlay-bg),transparent)]",
                  )}
                  style={virtualRowStyle(virtualRow, isActiveStickyUserRow)}
                >
                  <TimelineRowContent
                    row={row}
                    isSticky={isActiveStickyUserRow}
                    isEditingUserMessage={
                      row.kind === "message" &&
                      row.message.role === "user" &&
                      row.message.id === editingUserMessageId
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </TimelineRowCtx.Provider>
  );
});

function isUserMessageRow(row: MessagesTimelineRow): row is UserMessageTimelineRow {
  return row.kind === "message" && row.message.role === "user";
}

function findActiveStickyUserRowIndex(indices: readonly number[], visibleStartIndex: number) {
  let activeIndex: number | null = null;
  for (const index of indices) {
    if (index > visibleStartIndex) {
      break;
    }
    activeIndex = index;
  }
  return activeIndex;
}

function estimateTimelineRowSize(row: MessagesTimelineRow | undefined) {
  if (!row) {
    return 96 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "message") {
    return (row.message.role === "user" ? 88 : 156) + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "proposed-plan") {
    return 180 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "working") {
    return 52 + VIRTUAL_ROW_GAP_PX;
  }

  return 76 + VIRTUAL_ROW_GAP_PX;
}

function virtualRowStyle(virtualRow: VirtualItem, isSticky: boolean): CSSProperties {
  if (isSticky) {
    return {
      position: "sticky",
      top: 0,
      zIndex: 20,
    };
  }

  return {
    position: "absolute",
    top: 0,
    left: 0,
    transform: `translateY(${virtualRow.start}px)`,
  };
}

// ---------------------------------------------------------------------------
// TimelineRowContent — dispatcher into extracted components
// ---------------------------------------------------------------------------

type TimelineRow = MessagesTimelineRow;

const TimelineRowContent = memo(function TimelineRowContent({
  row,
  isSticky = false,
  isEditingUserMessage = false,
}: {
  row: TimelineRow;
  isSticky?: boolean;
  isEditingUserMessage?: boolean;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div
      className={cn(
        "agent-panel-meta-agent-chat__message-entry flex w-full min-w-0 flex-col gap-1 overflow-x-hidden",
        !isSticky && "[content-visibility:auto] [contain-intrinsic-size:96px]",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
      )}
      data-meta-agent-chat-bubble-id={row.id}
      data-meta-agent-chat-message-kind={timelineRowKind(row)}
      data-timeline-root="true"
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" && (
        <div className="agent-panel-meta-agent-chat__row agent-panel-meta-agent-chat__row--tool-call flex w-full min-w-0">
          <WorkGroupSection groupedEntries={row.groupedEntries} />
        </div>
      )}

      {row.kind === "message" && row.message.role === "user" && (
        <div className="agent-panel-meta-agent-chat__row agent-panel-meta-agent-chat__row--human box-border flex w-full min-w-0 px-0">
          <HumanMessage
            message={row.message}
            revertTurnCount={row.revertTurnCount}
            isEditing={isEditingUserMessage}
            editDisabled={ctx.isWorking || ctx.activeTurnInProgress || ctx.isRevertingCheckpoint}
            isServerThread={ctx.isServerThread}
            editComposer={
              isEditingUserMessage ? (ctx.renderEditComposer?.(row.message) ?? null) : null
            }
            onImageExpand={ctx.onImageExpand}
            onBeginEditUserMessage={ctx.onBeginEditUserMessage}
          />
        </div>
      )}

      {row.kind === "message" && row.message.role === "assistant" && (
        <div className="agent-panel-meta-agent-chat__row agent-panel-meta-agent-chat__row--assistant box-border flex w-full min-w-0 px-0">
          <AssistantMessage
            message={row.message}
            showCompletionDivider={row.showCompletionDivider}
            assistantTurnDiffSummary={row.assistantTurnDiffSummary}
            completionSummary={ctx.completionSummary}
            routeThreadKey={ctx.routeThreadKey}
            markdownCwd={ctx.markdownCwd}
            resolvedTheme={ctx.resolvedTheme}
            onOpenTurnDiff={ctx.onOpenTurnDiff}
          />
        </div>
      )}

      {row.kind === "proposed-plan" && (
        <div className="agent-panel-meta-agent-chat__row agent-panel-meta-agent-chat__row--tool-call min-w-0 px-1 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            environmentId={ctx.activeThreadEnvironmentId}
            cwd={ctx.markdownCwd}
            projectRoot={ctx.projectRoot}
          />
        </div>
      )}

      {row.kind === "working" && (
        <div className="agent-panel-meta-agent-chat__row agent-panel-meta-agent-chat__row--loading flex w-full min-w-0 opacity-75">
          <WorkingStatusRow createdAt={row.createdAt} />
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// WorkGroupSection — tool activity group with overflow control
// ---------------------------------------------------------------------------

const WorkGroupSection = memo(function WorkGroupSection({
  groupedEntries,
}: {
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
}) {
  const { projectRoot } = use(TimelineRowCtx);

  return (
    <div className="min-w-0 max-w-full flex-1">
      <div className="w-full min-w-0">
        <div className="flex w-fit max-w-composer flex-col gap-1.5">
          {groupedEntries.map((workEntry) => (
            <ToolCallMessage
              key={`work-row:${workEntry.id}`}
              workEntry={workEntry}
              projectRoot={projectRoot}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

function timelineRowKind(row: TimelineRow): "human" | "assistant" | "tool-call" | "loading" {
  if (row.kind === "message") return row.message.role === "user" ? "human" : "assistant";
  if (row.kind === "working") return "loading";
  return "tool-call";
}

// ---------------------------------------------------------------------------
// Structural sharing — reuse old row references when data hasn't changed
// ---------------------------------------------------------------------------

function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
    prevState.current = nextState;
    return nextState.result;
  }, [rows]);
}
