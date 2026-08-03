import * as stylex from "@stylexjs/stylex";
import { Icon, IconButton, Text, UserMessage } from "@honk/ui";
import {
  IconArrowRotateClockwise,
  IconArrowRotateCounterClockwise,
  IconBranch,
  IconStop,
  IconTodos,
} from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
  workbenchSurfaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { AttachmentList } from "../composer/attachments";
import { inlineContextKindFromDataUrl } from "../composer/submission";
import type { ThreadMessageEdit } from "../composer/types";
import { errorMessage } from "../error-message";
import { GIT_AGENT_ACTIONS, type GitAgentActionId } from "../lib/git-agent-actions";
import {
  interruptSession,
  restoreSessionRevert,
  revertSessionFromMessage,
} from "../open-code-view";
import { actions as toastActions } from "../toast-store";
import type { ToolTodo } from "../tool-part-projection";
import { useSessionWatchSelector } from "../use-sdk-watch";
import {
  gitAgentActionForParts,
  isQueuedTasksStart,
  type FilePart,
  type TextPart,
  type ThreadPart,
  type TranscriptTodoSummary,
} from "./transcript-model";
import { useThreadRuntime } from "./runtime";
import { TodoSummary } from "./todo-summary";
import { PlainText } from "./transcript-text";

const TODO_SUMMARY_FALLBACK_TOP_HEIGHT = 1;
const PLAN_TODO_TOP_OVERLAP = 4;
const EMPTY_TASKS: readonly ToolTodo[] = Object.freeze([]);
const PLAN_EXECUTION_RING = `inset 0 0 0 ${controlVars["--honk-control-border-width"]} ${workbenchSurfaceVars["--honk-workbench-input-border"]}`;

const styles = stylex.create({
  // The bubble's own 12px/8px content padding insets the strip, so the strip sheds its composer
  // padding. The 2px block-end tops the bubble's 6px content gap up to the edit editor's 8px block
  // inset, so the thumbnails and the text below them hold position when the bubble swaps into the
  // inline edit composer.
  // oxlint-disable-next-line honk/design-no-raw-values -- 2px closes the fixed gap delta between the bubble's content gap and the editor's block inset; no token owns it
  userAttachmentStrip: { paddingInline: 0, paddingBlockStart: 0, marginBlockEnd: "2px" },
  // Cursor keeps this human-message container mounted and swaps only its read/edit child.
  userMessageHost: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    width: "100%",
    minWidth: 0,
  },
  messageWithTodoTop: {
    position: "relative",
    zIndex: 2,
    width: "100%",
    minWidth: 0,
  },
  messageWithTodoBottom: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    minWidth: 0,
  },
  planExecutionAction: {
    boxSizing: "border-box",
    minHeight: controlVars["--honk-control-h-lg"],
    width: "100%",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderRadius: radiusVars["--honk-radius-bubble"],
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    boxShadow: PLAN_EXECUTION_RING,
  },
  planExecutionTitle: {
    minWidth: 0,
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  queuedTasksAction: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  queuedTasksIcon: {
    fontSize: fontVars["--honk-font-size-body"],
  },
  gitAction: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  gitActionLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

const dynamicStyles = stylex.create({
  messageWithTodoOffset: (topHeight: number) => ({
    marginBlockStart: `${String(-topHeight)}px`,
  }),
});

export function UserThreadMessageRow({
  messageID,
  parts,
  requiresRevertConfirmation,
  onEditMessage,
  editDraft,
  editComposer,
  todoSummary,
}: {
  readonly messageID: string;
  readonly parts: readonly ThreadPart[];
  readonly requiresRevertConfirmation: boolean;
  readonly onEditMessage: ((draft: ThreadMessageEdit) => void) | undefined;
  readonly editDraft: ThreadMessageEdit | null;
  readonly editComposer: React.ReactNode;
  readonly todoSummary: TranscriptTodoSummary | undefined;
}): React.ReactElement {
  if (todoSummary?.kind === "plan") {
    return <PlanExecutionMessage summary={todoSummary} />;
  }

  if (isQueuedTasksStart(parts)) {
    return (
      <QueuedTasksMessage todoSummary={todoSummary?.kind === "todo" ? todoSummary : undefined} />
    );
  }

  // A Git action reads as a fixed user-initiated command, never editable prose, so
  // it renders a read-only card and never wires edit or reveals the inline composer.
  const gitAction = gitAgentActionForParts(parts);
  if (gitAction !== null) {
    return <GitAgentActionMessage action={gitAction} />;
  }

  const text = parts
    .filter((part): part is TextPart => part.type === "text" && part.synthetic !== true)
    .map((part) => part.text)
    .join("\n\n");
  const files = parts.filter((part): part is FilePart => part.type === "file");
  const inlineContexts = files.flatMap((file) => {
    const kind = inlineContextKindFromDataUrl(file.url);
    if (kind === null) return [];
    return [
      {
        kind,
        label: file.filename ?? (kind === "chat" ? "Past chat" : "Current branch diff"),
      },
    ];
  });
  const attachments = files.filter(
    (file) => inlineContextKindFromDataUrl(file.url) === null && file.source === undefined,
  );

  if (editDraft?.messageID === messageID && editComposer !== null) {
    return <div {...stylex.props(styles.userMessageHost)}>{editComposer}</div>;
  }

  const onEdit =
    onEditMessage === undefined
      ? undefined
      : (): void => {
          onEditMessage({
            messageID,
            requiresRevertConfirmation,
            text,
            files: files.map((file) => {
              const kind = inlineContextKindFromDataUrl(file.url);
              const source = file.source?.type === "file" ? file.source : undefined;
              return {
                path: source?.path ?? file.url,
                filename: file.filename ?? fileUrlBasename(file.url),
                mime: file.mime,
                ...(source === undefined
                  ? {}
                  : {
                      source: {
                        text: source.text.value,
                        start: source.text.start,
                        end: source.text.end,
                      },
                    }),
                ...(kind === null ? {} : { context: { kind, sourceKey: `transcript:${file.id}` } }),
              };
            }),
          });
        };

  // Attachments render through the composer's own strip, above the text, so the thumbnails sit
  // exactly where the inline edit composer will keep them and entering edit mode never moves them.
  return (
    <MessageWithTodoSummary
      kind="todo"
      tasks={todoSummary?.kind === "todo" ? todoSummary.tasks : EMPTY_TASKS}
    >
      <UserMessage onEdit={onEdit}>
        <AttachmentList
          attachments={attachments.map((file) => ({
            key: file.id,
            label: file.filename ?? fileUrlBasename(file.url),
            path: file.url,
            mime: file.mime,
          }))}
          style={styles.userAttachmentStrip}
        />
        <UserMessage.Preview>
          <PlainText text={text} contexts={inlineContexts} />
        </UserMessage.Preview>
      </UserMessage>
    </MessageWithTodoSummary>
  );
}

function QueuedTasksMessage({
  todoSummary,
}: {
  readonly todoSummary: Extract<TranscriptTodoSummary, { readonly kind: "todo" }> | undefined;
}): React.ReactElement {
  return (
    <MessageWithTodoSummary kind="todo" tasks={todoSummary?.tasks ?? EMPTY_TASKS}>
      <UserMessage>
        <span {...stylex.props(styles.queuedTasksAction)}>
          <Icon icon={IconTodos} size="sm" tone="faint" style={styles.queuedTasksIcon} />
          <span>Queued tasks</span>
        </span>
      </UserMessage>
    </MessageWithTodoSummary>
  );
}

function PlanExecutionMessage({
  summary,
}: {
  readonly summary: Extract<TranscriptTodoSummary, { readonly kind: "plan" }>;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const revertedFromMessageID = useSessionWatchSelector(
    runtime.ref,
    (snapshot) => snapshot.state?.app.summary.revertMessageId ?? null,
  );
  const hasActiveOwnedWork = useSessionWatchSelector(
    runtime.ref,
    (snapshot) => snapshot.state?.app.summary.status === "running",
  );
  const [pendingAction, setPendingAction] = React.useState<"checkpoint" | "stop" | null>(null);

  const stop = (): void => {
    const client = runtime.client;
    if (client === null || pendingAction !== null) return;
    setPendingAction("stop");
    void interruptSession(client, runtime.ref.sessionID)
      .catch((error: unknown) => {
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Stop failed",
          description: message,
          copyableError: message,
          threadKey: runtime.tabKey,
        });
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const restoreCheckpoint = (): void => {
    const client = runtime.client;
    if (client === null || pendingAction !== null) return;
    const isRevertedCheckpoint = revertedFromMessageID === summary.messageID;
    setPendingAction("checkpoint");
    void (
      isRevertedCheckpoint
        ? restoreSessionRevert(client, runtime.ref.sessionID)
        : revertSessionFromMessage(client, runtime.ref.sessionID, summary.messageID)
    )
      .catch((error: unknown) => {
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: isRevertedCheckpoint ? "Restore latest failed" : "Restore checkpoint failed",
          description: message,
          copyableError: message,
          threadKey: runtime.tabKey,
        });
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const isRevertedCheckpoint = revertedFromMessageID === summary.messageID;

  return (
    <MessageWithTodoSummary kind="plan" tasks={summary.tasks}>
      <div {...stylex.props(styles.planExecutionAction)}>
        <Icon icon={IconTodos} size="sm" tone="faint" />
        <Text as="span" size="base" tone="muted">
          Build
        </Text>
        <span {...stylex.props(styles.planExecutionTitle)}>
          <Text as="span" size="base" tone="faint" truncate>
            {summary.title}
          </Text>
        </span>
        {summary.isActive ? (
          <IconButton
            size="sm"
            variant="quiet"
            aria-label="Stop plan build"
            disabled={runtime.client === null || pendingAction !== null}
            onClick={stop}
          >
            <Icon icon={IconStop} size="sm" />
          </IconButton>
        ) : isRevertedCheckpoint ? (
          <IconButton
            size="sm"
            variant="quiet"
            aria-label="Restore latest plan build"
            title="Restore latest plan build"
            disabled={runtime.client === null || pendingAction !== null}
            onClick={restoreCheckpoint}
          >
            <Icon icon={IconArrowRotateClockwise} size="sm" />
          </IconButton>
        ) : hasActiveOwnedWork || !summary.canRestoreCheckpoint ? null : (
          <IconButton
            size="sm"
            variant="quiet"
            aria-label="Restore plan checkpoint"
            title="Restore plan checkpoint"
            disabled={runtime.client === null || pendingAction !== null}
            onClick={restoreCheckpoint}
          >
            <Icon icon={IconArrowRotateCounterClockwise} size="sm" />
          </IconButton>
        )}
      </div>
    </MessageWithTodoSummary>
  );
}

function MessageWithTodoSummary({
  children,
  kind,
  tasks,
}: {
  readonly children: React.ReactElement;
  readonly kind: "plan" | "todo";
  readonly tasks: readonly ToolTodo[];
}): React.ReactElement {
  const [topHeight, setTopHeight] = React.useState(TODO_SUMMARY_FALLBACK_TOP_HEIGHT);
  const attachTop = React.useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;

    const measure = (): void => {
      setTopHeight(Math.max(TODO_SUMMARY_FALLBACK_TOP_HEIGHT, element.offsetHeight));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const visibleTasks = tasks.filter((task) => task.status !== "cancelled");

  if (visibleTasks.length === 0) {
    return <div {...stylex.props(styles.userMessageHost)}>{children}</div>;
  }

  return (
    <div {...stylex.props(styles.userMessageHost)}>
      <div
        ref={attachTop}
        data-slot="message-with-todo-top"
        {...stylex.props(styles.messageWithTodoTop)}
      >
        {children}
      </div>
      <div
        data-slot="message-with-todo-bottom"
        {...stylex.props(
          styles.messageWithTodoBottom,
          dynamicStyles.messageWithTodoOffset(topHeight),
        )}
      >
        <TodoSummary
          kind={kind}
          tasks={visibleTasks}
          topSpacerHeight={
            kind === "plan"
              ? Math.max(TODO_SUMMARY_FALLBACK_TOP_HEIGHT, topHeight - PLAN_TODO_TOP_OVERLAP)
              : topHeight
          }
        />
      </div>
    </div>
  );
}

// Reuses the user bubble geometry with no edit affordance: a compact, read-only
// record that this turn ran a Git action from Source Control.
function GitAgentActionMessage({
  action,
}: {
  readonly action: GitAgentActionId;
}): React.ReactElement {
  return (
    <UserMessage>
      <span {...stylex.props(styles.gitAction)}>
        <Icon icon={IconBranch} size="sm" tone="faint" />
        <span {...stylex.props(styles.gitActionLabel)}>{GIT_AGENT_ACTIONS[action].label}</span>
      </span>
    </UserMessage>
  );
}

function fileUrlBasename(url: string): string {
  if (url.startsWith("data:")) return "attachment";
  const trimmed = url.replace(/^file:\/\//, "").replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : url;
}
