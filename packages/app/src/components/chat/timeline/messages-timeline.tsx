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
  useState,
  type ReactNode,
} from "react";
import { IconChevronRightMedium } from "central-icons";
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
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./timeline-rows";
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
  expandedWorkedHeaderIds: ReadonlySet<string>;
  onWorkedHeaderOpenChange: (rowId: string, open: boolean) => void;
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
  editUserMessagesDisabled: boolean;
  activeTurnStartedAt: string | null;
  bottomClearancePx?: number | undefined;
  timelineControllerRef: React.RefObject<MessagesTimelineController | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  routeThreadKey: string;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  projectRoot: string | undefined;
  isServerThread: boolean;
  editingUserMessageId?: MessageId | null | undefined;
  onBeginEditUserMessage: ((messageId: MessageId) => void) | undefined;
  renderEditComposer?: ((message: ChatMessage) => ReactNode) | undefined;
  awaitingServerThreadDetail?: boolean | undefined;
  onIsAtBottomChange: (isAtBottom: boolean) => void;
}

// ---------------------------------------------------------------------------
// MessagesTimeline — list owner
// ---------------------------------------------------------------------------

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  activeTurnInProgress,
  editUserMessagesDisabled,
  activeTurnStartedAt,
  bottomClearancePx = 0,
  timelineControllerRef,
  timelineEntries,
  completionDividerBeforeEntryId,
  turnDiffSummaryByAssistantMessageId,
  routeThreadKey,
  onOpenTurnDiff,
  revertTurnCountByUserMessageId,
  onImageExpand,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  projectRoot,
  isServerThread,
  editingUserMessageId = null,
  onBeginEditUserMessage,
  renderEditComposer,
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
  const allRows = useStableRows(rawRows);
  const initialWorkedHeaderIdsRef = useRef<ReadonlySet<string> | null>(null);
  if (initialWorkedHeaderIdsRef.current === null) {
    initialWorkedHeaderIdsRef.current = getWorkedHeaderIds(allRows);
  }
  const [workedHeaderOpenOverrides, setWorkedHeaderOpenOverrides] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());
  const expandedWorkedHeaderIds = useMemo(() => {
    const initialWorkedHeaderIds = initialWorkedHeaderIdsRef.current ?? new Set<string>();
    const expandedIds = new Set<string>();
    for (const row of allRows) {
      if (row.kind !== "worked-header") {
        continue;
      }
      const openOverride = workedHeaderOpenOverrides.get(row.id);
      const defaultOpen = !initialWorkedHeaderIds.has(row.id);
      if (openOverride ?? defaultOpen) {
        expandedIds.add(row.id);
      }
    }
    return expandedIds;
  }, [allRows, workedHeaderOpenOverrides]);
  const rows = useMemo(
    () => allRows.filter((row) => isWorkedRowVisible(row, expandedWorkedHeaderIds)),
    [allRows, expandedWorkedHeaderIds],
  );
  useEffect(() => {
    setWorkedHeaderOpenOverrides((previousOverrides) => {
      if (previousOverrides.size === 0) {
        return previousOverrides;
      }

      const workedHeaderIds = getWorkedHeaderIds(allRows);
      const nextOverrides = new Map<string, boolean>();
      let changed = false;
      for (const [rowId, open] of previousOverrides) {
        if (workedHeaderIds.has(rowId)) {
          nextOverrides.set(rowId, open);
        } else {
          changed = true;
        }
      }
      return changed ? nextOverrides : previousOverrides;
    });
  }, [allRows]);
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
  const keepBottomPinnedThroughAnimation = useCallback(() => {
    const startedAt = window.performance.now();
    const tick = () => {
      scheduleStickToBottom();
      if (window.performance.now() - startedAt < 240) {
        window.requestAnimationFrame(tick);
      }
    };
    window.requestAnimationFrame(tick);
  }, [scheduleStickToBottom]);
  const handleWorkedHeaderOpenChange = useCallback(
    (rowId: string, open: boolean) => {
      const latestWorkedHeaderId =
        allRows.findLast((row) => row.kind === "worked-header")?.id ?? null;
      const shouldStickToBottom = open && (getIsAtBottom() || rowId === latestWorkedHeaderId);

      setWorkedHeaderOpenOverrides((previousOverrides) => {
        const nextOverrides = new Map(previousOverrides);
        nextOverrides.set(rowId, open);
        return nextOverrides;
      });

      if (shouldStickToBottom) {
        keepBottomPinnedThroughAnimation();
      }
    },
    [allRows, getIsAtBottom, keepBottomPinnedThroughAnimation],
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
      expandedWorkedHeaderIds,
      onWorkedHeaderOpenChange: handleWorkedHeaderOpenChange,
    }),
    [
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
      expandedWorkedHeaderIds,
      handleWorkedHeaderOpenChange,
    ],
  );

  if (rows.length === 0 && !isWorking && awaitingServerThreadDetail) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <Spinner className="size-6 text-muted-foreground" />
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
      <div className="relative flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden pt-(--chat-timeline-padding-block-start)">
        <div
          ref={scrollElementRef}
          onScroll={handleScroll}
          onPointerDown={clearProgrammaticScrollTracking}
          onTouchStart={clearProgrammaticScrollTracking}
          onWheel={clearProgrammaticScrollTracking}
          data-chat-timeline-scroll=""
          className="h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [overflow-anchor:none] scrollbar-gutter-stable-both-edges scrollbar-thin"
        >
          <div className="mx-auto box-border w-full max-w-agent-chat" style={virtualContentStyle}>
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
                    "w-full px-4 pb-(--chat-timeline-row-gap)",
                    isActiveStickyUserRow &&
                      "isolate bg-[color-mix(in_srgb,var(--multi-color-editor)_72%,transparent)]",
                  )}
                  style={virtualRowStyle(virtualRow, isActiveStickyUserRow)}
                >
                  <TimelineRowContent
                    row={row}
                    editUserMessagesDisabled={editUserMessagesDisabled}
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

function getWorkedHeaderIds(rows: ReadonlyArray<MessagesTimelineRow>): ReadonlySet<string> {
  const result = new Set<string>();
  for (const row of rows) {
    if (row.kind === "worked-header") {
      result.add(row.id);
    }
  }
  return result;
}

function isWorkedRowVisible(
  row: MessagesTimelineRow,
  expandedWorkedHeaderIds: ReadonlySet<string>,
): boolean {
  switch (row.kind) {
    case "work":
    case "message":
    case "proposed-plan":
      return !row.workedHeaderId || expandedWorkedHeaderIds.has(row.workedHeaderId);
    case "working":
    case "worked-header":
      return true;
  }
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

function estimateTimelineRowSize(row: MessagesTimelineRow | undefined): number {
  if (!row) {
    return 96 + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "message") {
    return (row.message.role === "user" ? 88 : 156) + VIRTUAL_ROW_GAP_PX;
  }

  if (row.kind === "worked-header") {
    return 32 + VIRTUAL_ROW_GAP_PX;
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
  editUserMessagesDisabled,
  isEditingUserMessage = false,
}: {
  row: TimelineRow;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage?: boolean;
}) {
  const ctx = use(TimelineRowCtx);

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
    >
      {row.kind === "worked-header" ? (
        <WorkedHeaderRow row={row} />
      ) : (
        <TimelineRowBody
          row={row}
          editUserMessagesDisabled={editUserMessagesDisabled}
          isEditingUserMessage={isEditingUserMessage}
          ctx={ctx}
        />
      )}
    </div>
  );
});

function TimelineRowBody({
  row,
  editUserMessagesDisabled,
  isEditingUserMessage,
  ctx,
}: {
  row: Exclude<TimelineRow, { kind: "worked-header" }>;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage: boolean;
  ctx: TimelineRowSharedState;
}) {
  return (
    <>
      {row.kind === "work" && (
        <div className="flex w-full min-w-0">
          <WorkGroupSection groupedEntries={row.groupedEntries} />
        </div>
      )}

      {row.kind === "message" && row.message.role === "user" && (
        <HumanTimelineRow
          row={row}
          editUserMessagesDisabled={editUserMessagesDisabled}
          isEditingUserMessage={isEditingUserMessage}
          ctx={ctx}
        />
      )}

      {row.kind === "message" && row.message.role === "assistant" && (
        <div className="box-border flex w-full min-w-0 px-0">
          <AssistantMessage
            message={row.message}
            assistantTurnDiffSummary={row.assistantTurnDiffSummary}
            routeThreadKey={ctx.routeThreadKey}
            markdownCwd={ctx.markdownCwd}
            resolvedTheme={ctx.resolvedTheme}
            onOpenTurnDiff={ctx.onOpenTurnDiff}
          />
        </div>
      )}

      {row.kind === "working" && (
        <div className="flex w-full min-w-0 opacity-75">
          <WorkingStatusRow />
        </div>
      )}
    </>
  );
}

const HumanTimelineRow = memo(function HumanTimelineRow({
  row,
  editUserMessagesDisabled,
  isEditingUserMessage,
  ctx,
}: {
  row: Extract<TimelineRow, { kind: "message" }>;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage: boolean;
  ctx: TimelineRowSharedState;
}) {
  return (
    <div className="box-border flex w-full min-w-0 px-0">
      <HumanMessage
        message={row.message}
        revertTurnCount={row.revertTurnCount}
        isEditing={isEditingUserMessage}
        editDisabled={editUserMessagesDisabled}
        isServerThread={ctx.isServerThread}
        editComposer={isEditingUserMessage ? (ctx.renderEditComposer?.(row.message) ?? null) : null}
        onImageExpand={ctx.onImageExpand}
        onBeginEditUserMessage={ctx.onBeginEditUserMessage}
      />
    </div>
  );
});

const WorkedHeaderRow = memo(function WorkedHeaderRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "worked-header" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const completionLabel = formatAssistantWorkedLabel(row.durationStart, row.completedAt);
  if (!completionLabel) {
    return null;
  }

  const hasCollapsibleRows = row.collapsibleRowIds.length > 0;
  const expanded = ctx.expandedWorkedHeaderIds.has(row.id);

  if (!hasCollapsibleRows) {
    return (
      <div className="inline-flex min-h-7 w-fit items-center gap-1 px-1 py-0.5 text-caption font-medium text-muted-foreground/75 tabular-nums">
        <span>{completionLabel}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "inline-flex w-fit items-center gap-1 px-0 py-0.5 text-left text-caption font-medium text-muted-foreground/75 tabular-nums hover:text-multi-fg-secondary",
        "motion-reduce:transition-none motion-reduce:active:scale-100",
      )}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} assistant turn, ${completionLabel}`}
      data-assistant-worked-trigger=""
      onClick={() => ctx.onWorkedHeaderOpenChange(row.id, !expanded)}
    >
      <span>{completionLabel}</span>
      <IconChevronRightMedium
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 overflow-visible transition-transform duration-150 motion-reduce:transition-none",
          expanded && "rotate-90",
        )}
      />
    </button>
  );
});

function formatAssistantWorkedLabel(startIso: string, completedAt: string | undefined) {
  if (!completedAt) return null;
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(completedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }
  return `Worked for ${formatCompactDuration(endMs - startMs)}`;
}

function formatCompactDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

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
        <div className="flex w-fit max-w-agent-chat flex-col gap-1.5">
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
  if (row.kind === "worked-header") return "assistant";
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
