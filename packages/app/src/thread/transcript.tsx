import * as stylex from "@stylexjs/stylex";
import { Matrix, StatusRow, Text } from "@honk/ui";
import { TimelineNavigator, type TimelineNavigatorItem } from "@honk/ui/timeline-navigator";
import { colorVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { useConversationDensity } from "../app-settings-store";
import type { ThreadMessageEdit } from "../composer/types";
import { errorMessage } from "../error-message";
import { interruptSession, type ThreadViewState } from "../open-code-view";
import { actions as toastActions } from "../toast-store";
import {
  groupMessagesIntoTurns,
  groupPartsByMessage,
  isSyntheticOnlyUserMessage,
  turnHasVisibleActivity,
  type ToolPart,
} from "./transcript-model";
import { useThreadRuntime } from "./runtime";
import { SessionRequests } from "./session-requests";
import type { TaskChildLink } from "./subagent-session";
import { ThreadTurnRow, turnTimelineItem } from "./transcript-turn";
import { VirtualConversation, type VirtualConversationController } from "./virtual-conversation";
import {
  activeTurnStartedAtMs,
  WAITING_PLANNING_LABEL,
  WAITING_REVEAL_DELAY_MS,
  WAITING_SLOW_THRESHOLD_MS,
  waitingStatusLabel,
} from "./waiting-status";

const EMPTY_TASK_LINKS: ReadonlyMap<string, TaskChildLink> = new Map();
const TRANSCRIPT_EMPTY_MIN_HEIGHT = "120px";
const TRANSCRIPT_MAX_WIDTH = "840px";
const TRANSCRIPT_TURN_ESTIMATE_PX = 180;
const TRANSCRIPT_ROW_GAP_PX = 12;
const TRANSCRIPT_INITIAL_VIEWPORT_HEIGHT_PX = 720;
const PREVIEW_INITIAL_VIEWPORT_HEIGHT_PX = 360;
const TRANSCRIPT_NEAR_END_PX = 48;
const TIMELINE_ACTIVATION_RATIO = 0.28;
// The fixed rail follows the visible transcript region, excluding the overlaid composer.
const TIMELINE_BLOCK_GAP_PX = 32;
const TIMELINE_PANEL_GAP_PX = 12;
const TIMELINE_VIEWPORT_GAP_PX = 8;
const styles = stylex.create({
  center: { minHeight: TRANSCRIPT_EMPTY_MIN_HEIGHT, display: "grid", placeItems: "center" },
  streamFrame: {
    position: "relative",
    flexGrow: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: TRANSCRIPT_MAX_WIDTH,
    marginInline: "auto",
  },
  stream: {
    height: "100%",
    width: "100%",
    paddingInline: spaceVars["--honk-space-panel-pad"],
    overflowY: "auto",
  },
  streamContent: {
    width: "100%",
  },
  previewContent: {
    width: "100%",
    minWidth: 0,
  },
  timelineLayer: {
    position: "fixed",
    zIndex: 1,
    width: 0,
    pointerEvents: "none",
    overflow: "visible",
  },
});
const dynamic = stylex.create({
  streamBottomClearance: (px: number) => ({ paddingBlockEnd: `${px}px` }),
  timelineInlineStart: (px: number) => ({ insetInlineStart: `${String(px)}px` }),
  timelineTop: (px: number) => ({ top: `${String(px)}px` }),
  timelineHeight: (px: number) => ({ height: `${String(px)}px` }),
});

const getWaitingServerSnapshot = (): null => null;

function useWaitingStatus(input: {
  readonly isRunning: boolean;
  readonly hasVisibleActivity: boolean;
  readonly turnStartedAtMs: number | null;
}): string | null {
  const { isRunning, hasVisibleActivity, turnStartedAtMs } = input;
  const subscribe = (notify: () => void): (() => void) => {
    if (!isRunning || hasVisibleActivity || turnStartedAtMs === null) {
      return () => undefined;
    }
    const nowMs = Date.now();
    const timers = [
      turnStartedAtMs + WAITING_REVEAL_DELAY_MS,
      turnStartedAtMs + WAITING_SLOW_THRESHOLD_MS,
    ]
      .filter((deadlineMs) => deadlineMs > nowMs)
      .map((deadlineMs) => window.setTimeout(notify, deadlineMs - nowMs + 1));
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  };
  const getSnapshot = (): string | null =>
    waitingStatusLabel({
      isRunning,
      hasVisibleActivity,
      turnStartedAtMs,
      nowMs: Date.now(),
    });
  return React.useSyncExternalStore(subscribe, getSnapshot, getWaitingServerSnapshot);
}

export function ThreadStream({
  threadId,
  state,
  bottomClearancePx,
  editDraft = null,
  editComposer = null,
  onEditMessage,
  onReviewChanges,
  onOpenTask,
  openTaskPartID = null,
  taskLinkByPartID = EMPTY_TASK_LINKS,
  hasActiveSubagent = false,
}: {
  threadId: string;
  state: ThreadViewState;
  bottomClearancePx: number;
  editDraft?: ThreadMessageEdit | null;
  editComposer?: React.ReactNode;
  onEditMessage: (draft: ThreadMessageEdit) => void;
  onReviewChanges?: () => void;
  onOpenTask?: (part: ToolPart) => void;
  openTaskPartID?: string | null;
  taskLinkByPartID?: ReadonlyMap<string, TaskChildLink>;
  hasActiveSubagent?: boolean;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const conversationDensity = useConversationDensity();
  const partsByMessageId = groupPartsByMessage(state.parts);
  const turns = groupMessagesIntoTurns(state.messages);
  const timelineItems: readonly TimelineNavigatorItem[] = turns.flatMap((turn) =>
    turn.user === null || isSyntheticOnlyUserMessage(partsByMessageId.get(turn.user.id) ?? [])
      ? []
      : [turnTimelineItem(turn, partsByMessageId)],
  );
  const turnElementsRef = React.useRef(new Map<string, HTMLDivElement>());
  const scrollportRef = React.useRef<HTMLDivElement | null>(null);
  const virtualControllerRef = React.useRef<VirtualConversationController | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const measureFrameRef = React.useRef(0);
  const [timelineState, setTimelineState] = React.useState<{
    readonly activeId: string | null;
    readonly isScrollable: boolean;
    readonly leftPx: number;
    readonly topPx: number;
    readonly heightPx: number;
    readonly availableWidthPx: number;
  }>({
    activeId: timelineItems[0]?.id ?? null,
    isScrollable: false,
    leftPx: 0,
    topPx: 0,
    heightPx: 0,
    availableWidthPx: 0,
  });
  const hasVisibleActivity =
    turnHasVisibleActivity(turns[turns.length - 1], partsByMessageId) ||
    hasActiveSubagent ||
    state.permissions.length > 0 ||
    state.questions.length > 0;
  const waitingLabel = useWaitingStatus({
    isRunning: state.summary.status === "running",
    hasVisibleActivity,
    turnStartedAtMs: activeTurnStartedAtMs(state.messages),
  });

  const measureTimeline = (): void => {
    const scrollport = scrollportRef.current;
    if (scrollport === null || turnElementsRef.current.size === 0) return;

    const maxScroll = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight);
    const scrollportRect = scrollport.getBoundingClientRect();
    const contentLeft = contentRef.current?.getBoundingClientRect().left ?? scrollportRect.left;
    const activationPoint =
      scrollport.scrollTop + scrollport.clientHeight * TIMELINE_ACTIVATION_RATIO;
    const scrollportTop = scrollportRect.top;
    const turnEntries = [...turnElementsRef.current.entries()]
      .map(([id, element]) => ({
        id,
        top: element.getBoundingClientRect().top - scrollportTop + scrollport.scrollTop,
      }))
      .sort((left, right) => left.top - right.top);
    let activeId = turnEntries[0]?.id ?? null;

    if (maxScroll > 0 && scrollport.scrollTop >= maxScroll - 1) {
      activeId = turnEntries[turnEntries.length - 1]?.id ?? activeId;
    } else {
      for (const entry of turnEntries) {
        if (entry.top > activationPoint) break;
        activeId = entry.id;
      }
    }

    const isScrollable = maxScroll > 1;
    const leftPx = Math.max(TIMELINE_VIEWPORT_GAP_PX, contentLeft - TIMELINE_PANEL_GAP_PX);
    const topPx = scrollportRect.top + TIMELINE_BLOCK_GAP_PX;
    const heightPx = Math.max(
      0,
      scrollportRect.height - bottomClearancePx - TIMELINE_BLOCK_GAP_PX * 2,
    );
    const availableWidthPx = Math.max(0, scrollportRect.right - leftPx - TIMELINE_VIEWPORT_GAP_PX);
    setTimelineState((current) =>
      current.activeId === activeId &&
      current.isScrollable === isScrollable &&
      Math.abs(current.leftPx - leftPx) < 0.5 &&
      Math.abs(current.topPx - topPx) < 0.5 &&
      Math.abs(current.heightPx - heightPx) < 0.5 &&
      Math.abs(current.availableWidthPx - availableWidthPx) < 0.5
        ? current
        : {
            activeId,
            isScrollable,
            leftPx,
            topPx,
            heightPx,
            availableWidthPx,
          },
    );
  };

  const scheduleTimelineMeasure = (): void => {
    cancelAnimationFrame(measureFrameRef.current);
    measureFrameRef.current = requestAnimationFrame(measureTimeline);
  };

  const attachScrollport: React.RefCallback<HTMLDivElement> = (element) => {
    scrollportRef.current = element;
    if (element === null) return;

    const observer = new ResizeObserver(scheduleTimelineMeasure);
    resizeObserverRef.current = observer;
    // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- React 19 runs the returned callback-ref teardown, which disconnects this observer.
    observer.observe(element);
    if (contentRef.current !== null) observer.observe(contentRef.current);
    scheduleTimelineMeasure();

    return () => {
      cancelAnimationFrame(measureFrameRef.current);
      observer.disconnect();
      if (resizeObserverRef.current === observer) resizeObserverRef.current = null;
      if (scrollportRef.current === element) scrollportRef.current = null;
    };
  };

  const attachContent: React.RefCallback<HTMLDivElement> = (element) => {
    contentRef.current = element;
    const observer = resizeObserverRef.current;
    if (element !== null) {
      const observedElement = element;
      // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- The callback-ref teardown below unobserves this exact element.
      observer?.observe(element);
      scheduleTimelineMeasure();
      return () => {
        observer?.unobserve(observedElement);
        if (contentRef.current === observedElement) contentRef.current = null;
      };
    }
  };

  const navigateToTurn = (id: string): void => {
    const index = turns.findIndex((turn) => turn.key === id);
    if (index < 0) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimelineState((current) => ({ ...current, activeId: id }));
    virtualControllerRef.current?.scrollToIndex(index, {
      align: "start",
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  };

  const interrupt = (): void => {
    const client = runtime.client;
    if (client === null) {
      return;
    }
    void interruptSession(client, threadId).catch((error: unknown) => {
      const message = errorMessage(error);
      toastActions.add({
        type: "error",
        title: "Stop failed",
        description: message,
        copyableError: message,
        threadKey: runtime.tabKey,
      });
    });
  };

  if (state.messages.length === 0) {
    return (
      <div {...stylex.props(styles.streamFrame)}>
        <div
          ref={attachScrollport}
          data-honk-scrollport="balanced"
          {...stylex.props(styles.stream, dynamic.streamBottomClearance(bottomClearancePx))}
        >
          <div ref={attachContent} {...stylex.props(styles.center)}>
            {state.summary.status === "running" ? (
              <Matrix
                variant="compass"
                color={colorVars["--honk-color-text-muted"]}
                style={{ marginBlockEnd: spaceVars["--honk-space-gutter"] }}
              />
            ) : null}
            <Text as="p" size="sm" tone="muted" weight="regular">
              {state.summary.status === "running" ? WAITING_PLANNING_LABEL : "Empty thread"}
            </Text>
            <Text as="p" size="xs" tone="faint">
              {state.summary.status === "running"
                ? "Your message was accepted. Waiting for agent activity."
                : "Send a message below to start the conversation."}
            </Text>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.streamFrame)}>
      {timelineState.isScrollable ? (
        <div
          {...stylex.props(
            styles.timelineLayer,
            dynamic.timelineInlineStart(timelineState.leftPx),
            dynamic.timelineTop(timelineState.topPx),
            dynamic.timelineHeight(timelineState.heightPx),
          )}
        >
          <TimelineNavigator
            items={timelineItems}
            activeId={timelineState.activeId}
            availableWidthPx={timelineState.availableWidthPx}
            onNavigate={navigateToTurn}
          />
        </div>
      ) : null}
      <div
        ref={attachScrollport}
        data-honk-scrollport="balanced"
        {...stylex.props(styles.stream)}
        aria-label="Thread transcript"
        onScroll={scheduleTimelineMeasure}
      >
        <div ref={attachContent} {...stylex.props(styles.streamContent)}>
          <VirtualConversation
            rows={turns}
            scrollElementRef={scrollportRef}
            controllerRef={virtualControllerRef}
            getRowId={(turn) => turn.key}
            estimateRowSize={() => TRANSCRIPT_TURN_ESTIMATE_PX}
            rowGapPx={TRANSCRIPT_ROW_GAP_PX}
            bottomClearancePx={bottomClearancePx}
            initialViewportHeightPx={TRANSCRIPT_INITIAL_VIEWPORT_HEIGHT_PX}
            nearEndThresholdPx={TRANSCRIPT_NEAR_END_PX}
            isStreaming={state.summary.status === "running"}
            restorationKey={runtime.tabKey}
            onRowElement={(turn, _index, element) => {
              if (
                turn.user === null ||
                isSyntheticOnlyUserMessage(partsByMessageId.get(turn.user.id) ?? [])
              ) {
                turnElementsRef.current.delete(turn.key);
                return;
              }
              if (element === null) {
                turnElementsRef.current.delete(turn.key);
              } else {
                turnElementsRef.current.set(turn.key, element);
              }
              scheduleTimelineMeasure();
            }}
            renderRow={(turn, index) => (
              <ThreadTurnRow
                turn={turn}
                partsByMessageId={partsByMessageId}
                isLast={index === turns.length - 1}
                isThreadRunning={state.summary.status === "running"}
                conversationDensity={conversationDensity}
                onInterrupt={interrupt}
                onEditMessage={editDraft === null ? onEditMessage : undefined}
                editDraft={editDraft}
                editComposer={editComposer}
                {...(onReviewChanges === undefined ? {} : { onReviewChanges })}
                onOpenTask={onOpenTask}
                openTaskPartID={openTaskPartID}
                taskLinkByPartID={taskLinkByPartID}
              />
            )}
            footer={
              waitingLabel === null &&
              state.permissions.length === 0 &&
              state.questions.length === 0 ? null : (
                <>
                  {waitingLabel === null ? null : <StatusRow>{waitingLabel}</StatusRow>}
                  <SessionRequests
                    threadId={threadId}
                    permissions={state.permissions}
                    questions={state.questions}
                  />
                </>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

export function ThreadTranscriptPreview({
  state,
  scrollElementRef,
  restorationKey,
}: {
  readonly state: ThreadViewState;
  readonly scrollElementRef: React.RefObject<HTMLDivElement | null>;
  readonly restorationKey?: string;
}): React.ReactElement {
  const conversationDensity = useConversationDensity();
  const partsByMessageId = groupPartsByMessage(state.parts);
  const turns = groupMessagesIntoTurns(state.messages);
  const hasVisibleActivity = turnHasVisibleActivity(turns[turns.length - 1], partsByMessageId);
  const waitingLabel = useWaitingStatus({
    isRunning: state.summary.status === "running",
    hasVisibleActivity,
    turnStartedAtMs: activeTurnStartedAtMs(state.messages),
  });

  if (turns.length === 0) {
    return (
      <div {...stylex.props(styles.center)}>
        <Text as="p" size="sm" tone="muted">
          {state.summary.status === "running" ? "Waiting for activity" : "No activity yet"}
        </Text>
      </div>
    );
  }

  return (
    <div aria-label="Work details" {...stylex.props(styles.previewContent)}>
      <VirtualConversation
        rows={turns}
        scrollElementRef={scrollElementRef}
        getRowId={(turn) => turn.key}
        estimateRowSize={() => TRANSCRIPT_TURN_ESTIMATE_PX}
        rowGapPx={TRANSCRIPT_ROW_GAP_PX}
        bottomClearancePx={0}
        initialViewportHeightPx={PREVIEW_INITIAL_VIEWPORT_HEIGHT_PX}
        nearEndThresholdPx={TRANSCRIPT_NEAR_END_PX}
        isStreaming={state.summary.status === "running"}
        {...(restorationKey === undefined ? {} : { restorationKey })}
        renderRow={(turn, index) => (
          <ThreadTurnRow
            turn={turn}
            partsByMessageId={partsByMessageId}
            isLast={index === turns.length - 1}
            isThreadRunning={state.summary.status === "running"}
            conversationDensity={conversationDensity}
            showDiffSummary={false}
          />
        )}
        footer={waitingLabel === null ? null : <StatusRow>{waitingLabel}</StatusRow>}
      />
    </div>
  );
}
