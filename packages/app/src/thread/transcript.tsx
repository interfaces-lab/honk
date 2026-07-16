import * as stylex from "@stylexjs/stylex";
import { Button, Field, ListRow, StatusRow, Text, type ToolCallState } from "@honk/ui";
import { TimelineNavigator, type TimelineNavigatorItem } from "@honk/ui/timeline-navigator";
import { colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { useConversationDensity } from "../app-settings-store";
import type { ThreadMessageEdit } from "../composer/types";
import { errorMessage } from "../error-message";
import {
  interruptSession,
  rejectSessionQuestion,
  replySessionPermission,
  replySessionQuestion,
  type ThreadViewState,
} from "../open-code-view";
import { actions as toastActions } from "../toast-store";
import {
  groupMessagesIntoTurns,
  groupPartsByMessage,
  turnHasVisibleActivity,
  type ToolPart,
} from "./transcript-model";
import { useThreadRuntime } from "./runtime";
import { ThreadTurnRow, turnTimelineItem } from "./transcript-turn";
import {
  VirtualConversation,
  type VirtualConversationController,
} from "./virtual-conversation";
import {
  activeTurnStartedAtMs,
  WAITING_REVEAL_DELAY_MS,
  WAITING_SLOW_THRESHOLD_MS,
  waitingStatusLabel,
} from "./waiting-status";

const EMPTY_TASK_STATES: ReadonlyMap<string, ToolCallState> = new Map();
const TRANSCRIPT_EMPTY_MIN_HEIGHT = "120px";
const TRANSCRIPT_MAX_WIDTH = "840px";
const TRANSCRIPT_TURN_ESTIMATE_PX = 180;
const TRANSCRIPT_ROW_GAP_PX = 12;
const TRANSCRIPT_INITIAL_VIEWPORT_HEIGHT_PX = 720;
const PREVIEW_INITIAL_VIEWPORT_HEIGHT_PX = 360;
const TRANSCRIPT_NEAR_END_PX = 48;
const REQUEST_CARD_RING = `inset 0 0 0 1px ${colorVars["--honk-color-warn-border"]}`;
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
  requestStack: { display: "flex", flexDirection: "column", gap: spaceVars["--honk-space-gutter"] },
  requestCard: {
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    boxShadow: REQUEST_CARD_RING,
  },
  requestQuestion: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  requestOptions: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  requestActions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
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
  taskStateByPartID = EMPTY_TASK_STATES,
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
  taskStateByPartID?: ReadonlyMap<string, ToolCallState>;
  hasActiveSubagent?: boolean;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const conversationDensity = useConversationDensity();
  const partsByMessageId = groupPartsByMessage(state.parts);
  const turns = groupMessagesIntoTurns(state.messages);
  const timelineItems: readonly TimelineNavigatorItem[] = turns.flatMap((turn) =>
    turn.user === null ? [] : [turnTimelineItem(turn, partsByMessageId)],
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
            <Text as="p" size="sm" tone="muted" weight="medium">
              Empty thread
            </Text>
            <Text as="p" size="xs" tone="faint">
              Send a message below to start the conversation.
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
            onRowElement={(turn, _index, element) => {
              if (turn.user === null) return;
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
                taskStateByPartID={taskStateByPartID}
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
}: {
  readonly state: ThreadViewState;
  readonly scrollElementRef: React.RefObject<HTMLDivElement | null>;
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
          {state.summary.status === "running" ? "Waiting for subagent activity" : "No activity yet"}
        </Text>
      </div>
    );
  }

  return (
    <div aria-label="Subagent transcript" {...stylex.props(styles.previewContent)}>
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

type ThreadPermissionRequest = ThreadViewState["permissions"][number];
type ThreadQuestionRequest = ThreadViewState["questions"][number];

function SessionRequests({
  threadId,
  permissions,
  questions,
}: {
  readonly threadId: string;
  readonly permissions: readonly ThreadPermissionRequest[];
  readonly questions: readonly ThreadQuestionRequest[];
}): React.ReactElement | null {
  if (permissions.length === 0 && questions.length === 0) {
    return null;
  }

  return (
    <div {...stylex.props(styles.requestStack)} aria-label="Requests needing your input">
      {questions.map((request) => (
        <QuestionRequestCard key={request.id} threadId={threadId} request={request} />
      ))}
      {permissions.map((request) => (
        <PermissionRequestCard key={request.id} threadId={threadId} request={request} />
      ))}
    </div>
  );
}

function QuestionRequestCard({
  threadId,
  request,
}: {
  readonly threadId: string;
  readonly request: ThreadQuestionRequest;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const [answers, setAnswers] = React.useState<readonly (readonly string[])[]>(() =>
    request.questions.map(() => []),
  );
  const [custom, setCustom] = React.useState<readonly string[]>(() =>
    request.questions.map(() => ""),
  );
  const [pending, setPending] = React.useState<"answer" | "reject" | null>(null);
  const [requestError, setRequestError] = React.useState<string | null>(null);

  const toggleAnswer = (questionIndex: number, label: string, multiple: boolean): void => {
    setAnswers((current) =>
      current.map((answer, index) => {
        if (index !== questionIndex) {
          return answer;
        }
        if (!multiple) {
          return [label];
        }
        return answer.includes(label)
          ? answer.filter((candidate) => candidate !== label)
          : [...answer, label];
      }),
    );
  };

  const answer = (): void => {
    const resolved = answers.map((selected, index) => {
      const value = custom[index]?.trim() ?? "";
      return value.length > 0 ? [value] : selected;
    });
    if (resolved.some((selected) => selected.length === 0)) {
      setRequestError("Answer every question before sending.");
      return;
    }
    const client = runtime.client;
    if (client === null) {
      setRequestError("The OpenCode connection is not ready yet.");
      return;
    }
    setPending("answer");
    setRequestError(null);
    void replySessionQuestion(client, threadId, request.id, {
      answers: resolved.map((selected) => [...selected]),
    })
      .catch((cause: unknown) => {
        setRequestError(errorMessage(cause));
      })
      .finally(() => {
        setPending(null);
      });
  };

  const reject = (): void => {
    const client = runtime.client;
    if (client === null) {
      setRequestError("The OpenCode connection is not ready yet.");
      return;
    }
    setPending("reject");
    setRequestError(null);
    void rejectSessionQuestion(client, threadId, request.id)
      .catch((cause: unknown) => {
        setRequestError(errorMessage(cause));
      })
      .finally(() => {
        setPending(null);
      });
  };

  return (
    <section {...stylex.props(styles.requestCard)} aria-label="Question from the agent">
      {request.questions.map((question, questionIndex) => (
        <div
          key={`${request.id}:${String(questionIndex)}`}
          {...stylex.props(styles.requestQuestion)}
        >
          <Text as="p" size="xs" tone="faint" weight="semibold">
            {question.header}
          </Text>
          <Text as="p" size="sm" weight="medium">
            {question.question}
          </Text>
          <div
            role={question.multiple === true ? "group" : "radiogroup"}
            aria-label={question.header}
            {...stylex.props(styles.requestOptions)}
          >
            {question.options.map((option) => {
              const selected = answers[questionIndex]?.includes(option.label) ?? false;
              return (
                <ListRow
                  key={option.label}
                  role={question.multiple === true ? "checkbox" : "radio"}
                  aria-checked={selected}
                  isSelected={selected}
                  onClick={() => {
                    toggleAnswer(questionIndex, option.label, question.multiple === true);
                  }}
                >
                  <ListRow.Content>
                    <ListRow.Title>{option.label}</ListRow.Title>
                    <ListRow.Description>{option.description}</ListRow.Description>
                  </ListRow.Content>
                </ListRow>
              );
            })}
          </div>
          {question.custom === true ? (
            <Field size="md">
              <Field.Input
                value={custom[questionIndex] ?? ""}
                placeholder="Other response…"
                aria-label={`${question.header}: other response`}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setCustom((current) =>
                    current.map((entry, index) => (index === questionIndex ? value : entry)),
                  );
                }}
              />
            </Field>
          ) : null}
        </div>
      ))}
      {requestError === null ? null : (
        <Text as="p" role="alert" size="xs" tone="err">
          {requestError}
        </Text>
      )}
      <div {...stylex.props(styles.requestActions)}>
        <Button type="button" variant="quiet" disabled={pending !== null} onClick={reject}>
          {pending === "reject" ? "Dismissing…" : "Dismiss"}
        </Button>
        <Button type="button" variant="primary" disabled={pending !== null} onClick={answer}>
          {pending === "answer" ? "Sending…" : "Send answer"}
        </Button>
      </div>
    </section>
  );
}

function PermissionRequestCard({
  threadId,
  request,
}: {
  readonly threadId: string;
  readonly request: ThreadPermissionRequest;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const [pending, setPending] = React.useState<"once" | "always" | "reject" | null>(null);
  const [requestError, setRequestError] = React.useState<string | null>(null);

  const reply = (value: "once" | "always" | "reject"): void => {
    const client = runtime.client;
    if (client === null) {
      setRequestError("The OpenCode connection is not ready yet.");
      return;
    }
    setPending(value);
    setRequestError(null);
    void replySessionPermission(client, threadId, request.id, value)
      .catch((cause: unknown) => {
        setRequestError(errorMessage(cause));
      })
      .finally(() => {
        setPending(null);
      });
  };

  return (
    <section {...stylex.props(styles.requestCard)} aria-label="Permission requested by the agent">
      <Text as="p" size="xs" tone="faint" weight="semibold">
        Permission requested
      </Text>
      <Text as="p" size="sm" weight="medium">
        {request.action}
      </Text>
      {request.resources.map((resource) => (
        <Text
          key={resource}
          as="p"
          size="xs"
          tone="faint"
          family="mono"
          style={{ overflowWrap: "anywhere" }}
        >
          {resource}
        </Text>
      ))}
      {requestError === null ? null : (
        <Text as="p" role="alert" size="xs" tone="err">
          {requestError}
        </Text>
      )}
      <div {...stylex.props(styles.requestActions)}>
        <Button
          type="button"
          variant="quiet"
          disabled={pending !== null}
          onClick={() => {
            reply("reject");
          }}
        >
          {pending === "reject" ? "Rejecting…" : "Reject"}
        </Button>
        <Button
          type="button"
          variant="neutral"
          disabled={pending !== null}
          onClick={() => {
            reply("once");
          }}
        >
          {pending === "once" ? "Allowing…" : "Allow once"}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={pending !== null}
          onClick={() => {
            reply("always");
          }}
        >
          {pending === "always" ? "Allowing…" : "Always allow"}
        </Button>
      </div>
    </section>
  );
}
