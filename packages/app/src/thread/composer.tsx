import * as stylex from "@stylexjs/stylex";
import { Text } from "@honk/ui";
import {
  composerVars,
  radiusVars,
  spaceVars,
  workbenchSurfaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { ComposerAttachmentButton, ModeControl, ThreadModelIndicator } from "../composer/controls";
import { readComposerDraft, writeComposerDraft } from "../composer/draft-store";
import { useFocusOnType, type FocusOnTypeScope } from "../composer/focus-on-type";
import { PromptEditor } from "../composer/prompt-editor";
import {
  enqueueThreadMessage,
  migrateThreadQueue,
  readThreadQueue,
  removeThreadMessage,
  removeThreadMessages,
  reorderThreadMessage,
  replaceThreadMessage,
  shiftThreadMessage,
  unshiftThreadMessage,
  useThreadQueue,
  type QueueItem,
} from "../composer/queue-store";
import { ComposerQueueTray, type ComposerQueueTrayHandle } from "../composer/queue-tray";
import { shouldQueueThreadPrompt } from "../composer/submission";
import { ComposerSubmitButton } from "../composer/submit-button";
import type { PromptEditorHandle, PromptSubmit } from "../composer/types";
import { DirectoryAccessControl } from "../directory-access-control";
import { canPickFolder, pickFolder } from "../desktop-bridge";
import { errorMessage } from "../error-message";
import {
  actions as modeActions,
  MODES,
  modeFromAgent,
  nextModeId,
  threadAgentName,
  threadBuildAgent,
  useThreadMode,
} from "../modes";
import {
  APP_HOST_CAPABILITIES,
  appSessionStatusFromActivity,
  gatedCapabilityError,
  interruptSession,
  promptFilesFromPaths,
} from "../open-code-view";
import { sendSessionPrompt } from "../session-prompt";
import { actions as toastActions } from "../toast-store";
import { useSessionWatchSelector, useWorkspaceWatchSelector } from "../use-sdk-watch";
import { getSessionWatchSnapshot } from "../watch-registry";
import { claimStrandedFollowUp, threadQueueCanDrain } from "./follow-up";
import { useThreadRuntime } from "./runtime";
import { queuedTasksSubmission } from "./queued-tasks";

const EMPTY_DIRECTORIES: readonly string[] = Object.freeze([]);
const EMPTY_QUEUE: readonly QueueItem[] = Object.freeze([]);
const claimedStrandedFollowUpMessageIDs = new Set<string>();
const DIRECTORY_ACCESS_BUSY_MESSAGE =
  "Can't change folder access while the agent is working. Stop the run and try again.";
const THREAD_COMMANDS = [
  {
    name: "cd",
    description: "Allow access to an external directory",
    agent: null,
    model: null,
    template: "",
    subtask: false,
    location: null,
  },
] as const;
const COMPOSER_COLLAPSED_PADDING_INLINE_PX = 10;
const COMPOSER_COLLAPSED_PADDING_INLINE = `${COMPOSER_COLLAPSED_PADDING_INLINE_PX}px`;
// Cursor's main conversation content padding is 16px.
const COMPOSER_OVERLAY_INLINE_INSET = `calc(${spaceVars["--honk-space-gutter"]} * 2)`;
const COMPOSER_EDITOR_LINE_HEIGHT = "20px";
const COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT = "120px";
// Screen-level backstop; the overlay's panel-relative maxHeight is the real bound.
const COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT = "calc(100dvh - 120px)";
const COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE = "4px";
const COMPOSER_CONTROLS_EXPANDED_PADDING_BLOCK = "6px";
const COMPOSER_RING = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border"]}`;
const COMPOSER_RING_ACTIVE = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border-active"]}`;
// 96px of the panel stays visible above a fully grown composer.
const COMPOSER_OVERLAY_MAX_HEIGHT = "calc(100% - 96px)";
const styles = stylex.create({
  // Cursor measures trays and the input as one obstruction while painting them as sibling
  // surfaces. The input's own height and radius therefore never change when a tray appears.
  composerStack: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    gap: spaceVars["--honk-space-gutter"],
  },
  inputBox: {
    flexShrink: 0,
    minHeight: 0,
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    boxShadow: {
      default: COMPOSER_RING,
      ":hover": { "@media (hover: hover)": COMPOSER_RING_ACTIVE },
      ":focus-within": COMPOSER_RING_ACTIVE,
    },
  },
  inputRowCollapsed: {
    minHeight: composerVars["--honk-composer-state-band-height"],
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: COMPOSER_COLLAPSED_PADDING_INLINE,
  },
  inputColumnExpanded: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  composerOverlay: {
    position: "absolute",
    zIndex: zVars["--honk-z-stage-float"],
    insetInlineStart: COMPOSER_OVERLAY_INLINE_INSET,
    insetInlineEnd: COMPOSER_OVERLAY_INLINE_INSET,
    // Must equal the thread surface root's paddingBlock: the transcript stream's bottom edge sits
    // panel-pad above the panel, and the measured obstruction clearance is applied from that edge,
    // so the composer's bottom has to rest on the same line for the fade and clearance to be exact.
    insetBlockEnd: spaceVars["--honk-space-panel-pad"],
    // Cap growth against the thread panel so a long reply keeps a strip of transcript visible and
    // never runs past the window; the editor scrolls internally once this binds.
    maxHeight: COMPOSER_OVERLAY_MAX_HEIGHT,
  },
  editorContainerCollapsed: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  editorContainerExpanded: { width: "100%" },
  editorCollapsed: {
    minHeight: COMPOSER_EDITOR_LINE_HEIGHT,
    maxHeight: COMPOSER_EDITOR_COLLAPSED_MAX_HEIGHT,
    paddingTop: 0,
    paddingBottom: 0,
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px collapsed-editor inline padding is fixed geometry, no spacing token owns 4px
    paddingInline: COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE,
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px editor line-height is a fixed intrinsic, no body-leading token matches (leading-body is 18px)
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
  },
  editorExpanded: {
    minHeight: COMPOSER_EDITOR_LINE_HEIGHT,
    maxHeight: COMPOSER_EDITOR_EXPANDED_MAX_HEIGHT,
    paddingTop: spaceVars["--honk-space-gutter"],
    paddingBottom: 0,
    paddingInline: spaceVars["--honk-space-panel-pad"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px editor line-height is a fixed intrinsic, no body-leading token matches (leading-body is 18px)
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
  },
  placeholderCollapsed: {
    insetInlineStart: COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE,
    insetBlockStart: 0,
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px placeholder line-height matches the editor's fixed intrinsic, no body-leading token matches (leading-body is 18px)
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
  },
  placeholderExpanded: {
    insetInlineStart: spaceVars["--honk-space-panel-pad"],
    insetBlockStart: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 20px placeholder line-height matches the editor's fixed intrinsic, no body-leading token matches (leading-body is 18px)
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
  },
  // Align the attachment strip with the editor's text inset in each layout.
  attachmentsCollapsed: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px collapsed-editor inline padding is fixed geometry, no spacing token owns 4px
    paddingInline: COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE,
  },
  attachmentsExpanded: {
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  controlsCollapsed: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  controlsExpanded: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 6px controls-row block padding is fixed geometry, control-gap is a gap token not a padding token
    paddingBlock: COMPOSER_CONTROLS_EXPANDED_PADDING_BLOCK,
    paddingInline: COMPOSER_COLLAPSED_PADDING_INLINE,
  },
});

export function ThreadComposer({
  formRef,
  threadId,
  cwd,
  attachedDirectories,
  ownsQueue,
  allowQueueBatchStart = true,
  focusOnTypeScope,
  renderTrays,
}: {
  formRef: React.RefCallback<HTMLFormElement>;
  threadId: string;
  cwd: string;
  attachedDirectories: readonly string[];
  ownsQueue: boolean;
  allowQueueBatchStart?: boolean;
  focusOnTypeScope?: FocusOnTypeScope;
  renderTrays?: (hasQueue: boolean) => React.ReactNode;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const coreMode = useSessionWatchSelector(runtime.ref, (snapshot) =>
    modeFromAgent(snapshot.state?.app.summary.agent),
  );
  const mode = useThreadMode(runtime.tabKey, coreMode);
  const sessionAgent = useSessionWatchSelector(runtime.ref, (snapshot) => {
    const app = snapshot.state?.app;
    return app === undefined ? null : threadBuildAgent(app.messages, app.summary.agent);
  });
  const sessionModel = useSessionWatchSelector(
    runtime.ref,
    (snapshot) => snapshot.state?.app.summary.model ?? null,
  );
  const sessionStatus = useSessionWatchSelector(runtime.ref, (snapshot) =>
    appSessionStatusFromActivity(snapshot.state?.activity ?? "idle"),
  );
  const queueCanDrain = useSessionWatchSelector(runtime.ref, (snapshot) => {
    const state = snapshot.state;
    return (
      state === null ||
      threadQueueCanDrain({
        activity: state.activity,
        needsAttention: state.needsAttention,
      })
    );
  });
  const needsAttention = useSessionWatchSelector(
    runtime.ref,
    (snapshot) => snapshot.state?.needsAttention ?? false,
  );
  const isSessionRunning = sessionStatus === "running";
  const queueKey = runtime.tabKey;
  const persistedQueue = useThreadQueue(queueKey);
  const queue = ownsQueue ? persistedQueue : EMPTY_QUEUE;
  React.useEffect(() => {
    if (!ownsQueue) return;
    // localStorage queues originally used raw session IDs. Move that external persisted
    // state once; all live queue ownership remains server-qualified after the migration.
    migrateThreadQueue(threadId, queueKey);
  }, [ownsQueue, queueKey, threadId]);
  const [initialDraft] = React.useState(() => readComposerDraft(runtime.tabKey));
  const recentDirectories = useWorkspaceWatchSelector(
    (snapshot) => snapshot.state?.recentDirectories ?? EMPTY_DIRECTORIES,
  );
  const [hasText, setHasText] = React.useState(false);
  const [editingQueueId, setEditingQueueId] = React.useState<string | null>(null);
  const [isStopping, setStopping] = React.useState(false);
  const [isStartingAll, setStartingAll] = React.useState(false);
  const [isDirectoryPickerOpen, setDirectoryPickerOpen] = React.useState(false);
  const [isUpdatingDirectories, setUpdatingDirectories] = React.useState(false);
  // Expand the composer when the editor wraps onto another line or holds attachments.
  const [expanded, setExpanded] = React.useState(false);
  const composerExpanded = expanded;
  const editorRef = React.useRef<PromptEditorHandle | null>(null);
  const queueTrayRef = React.useRef<ComposerQueueTrayHandle | null>(null);
  useFocusOnType(editorRef, focusOnTypeScope);
  const formElementRef = React.useRef<HTMLFormElement | null>(null);
  const controlsElementRef = React.useRef<HTMLDivElement | null>(null);
  const attachForm: React.RefCallback<HTMLFormElement> = (element) => {
    formElementRef.current = element;
    const detach = formRef(element);
    if (element === null) {
      return;
    }

    return () => {
      formElementRef.current = null;
      if (typeof detach === "function") {
        detach();
      } else {
        formRef(null);
      }
    };
  };

  // Use the compact width to decide whether text wraps. The expanded width would reverse the result.
  const measureCompactEditorWidth = (): number | null => {
    const form = formElementRef.current;
    const controls = controlsElementRef.current;
    if (form === null || controls === null) {
      return null;
    }

    const controlsStyle = window.getComputedStyle(controls);
    const gap = Number.parseFloat(controlsStyle.columnGap) || 0;
    const compactChildren = Array.from(controls.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute("data-composer-expanded-only"),
    );
    const controlsWidth = compactChildren.reduce(
      (width, child) => width + child.getBoundingClientRect().width,
      gap * Math.max(0, compactChildren.length - 1),
    );
    const width =
      form.getBoundingClientRect().width -
      COMPOSER_COLLAPSED_PADDING_INLINE_PX * 2 -
      gap -
      controlsWidth;
    return width > 0 ? width : null;
  };

  const reportDirectoryError = (error: unknown): void => {
    const message = errorMessage(error);
    toastActions.add({
      type: "error",
      title: "Folder access failed",
      description: message,
      copyableError: message,
      threadKey: runtime.tabKey,
    });
  };

  const canChangeDirectories = (): boolean => {
    if (!isSessionRunning) {
      return true;
    }
    reportDirectoryError(new Error(DIRECTORY_ACCESS_BUSY_MESSAGE));
    return false;
  };

  const requestDirectoryPicker = (open: boolean): void => {
    if (!open) {
      setDirectoryPickerOpen(false);
      return;
    }
    if (canChangeDirectories()) {
      setDirectoryPickerOpen(true);
    }
  };

  const attachDirectory = (_path: string): void => {
    if (!APP_HOST_CAPABILITIES.directoryAttach) {
      reportDirectoryError(gatedCapabilityError("Folder access changes"));
      return;
    }
    if (!canChangeDirectories() || isUpdatingDirectories) {
      return;
    }
    const client = runtime.client;
    if (client === null) {
      reportDirectoryError(new Error("The OpenCode connection is not ready yet."));
      return;
    }
    setUpdatingDirectories(true);
    void Promise.reject(gatedCapabilityError("Folder access changes"))
      .catch(reportDirectoryError)
      .finally(() => {
        setUpdatingDirectories(false);
      });
  };

  const detachDirectory = (_path: string): void => {
    if (!APP_HOST_CAPABILITIES.directoryAttach) {
      reportDirectoryError(gatedCapabilityError("Folder access changes"));
      return;
    }
    if (!canChangeDirectories() || isUpdatingDirectories) {
      return;
    }
    const client = runtime.client;
    if (client === null) {
      reportDirectoryError(new Error("The OpenCode connection is not ready yet."));
      return;
    }
    setUpdatingDirectories(true);
    void Promise.reject(gatedCapabilityError("Folder access changes"))
      .catch(reportDirectoryError)
      .finally(() => {
        setUpdatingDirectories(false);
      });
  };

  const browseForDirectory = (): void => {
    if (!canChangeDirectories() || isUpdatingDirectories) {
      return;
    }
    void pickFolder(cwd).then((path) => {
      if (path !== null) {
        attachDirectory(path);
      }
    });
  };

  const stopRun = (): void => {
    const client = runtime.client;
    if (isStopping || client === null) return;
    const request = interruptSession(client, threadId);
    setStopping(true);
    // A user stop must not fire the next queued message at the agent.
    suppressDrainRef.current = true;
    void request
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
        setStopping(false);
      });
  };

  // One dispatch in flight at a time; the queue holds everything else.
  const dispatchingRef = React.useRef(false);
  const suppressDrainRef = React.useRef(false);
  const prevQueueCanDrainRef = React.useRef(queueCanDrain);
  const queueCanDrainRef = React.useRef(queueCanDrain);
  const editingQueueIdRef = React.useRef(editingQueueId);
  React.useEffect(() => {
    queueCanDrainRef.current = queueCanDrain;
    editingQueueIdRef.current = editingQueueId;
  }, [editingQueueId, queueCanDrain]);

  const dispatchPrompt = (item: QueueItem, restoreToQueue: boolean): void => {
    const client = runtime.client;
    if (client === null) {
      if (restoreToQueue) unshiftThreadMessage(queueKey, item);
      return;
    }
    dispatchingRef.current = true;
    const request = sendSessionPrompt(client, threadId, {
      text: item.text,
      agent: item.agent ?? threadAgentName(mode, sessionAgent),
      ...(item.files.length > 0 ? { files: promptFilesFromPaths(item.files) } : {}),
    });
    void request
      .catch((error: unknown) => {
        // A queued message stays visible in the tray instead of vanishing with the failure.
        if (restoreToQueue) unshiftThreadMessage(queueKey, item);
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Send failed",
          description: message,
          copyableError: message,
          threadKey: runtime.tabKey,
        });
      })
      .finally(() => {
        dispatchingRef.current = false;
      });
  };

  // A follow-up sent mid-run renders as a delivered message, but the sidecar only picks
  // it up at a loop boundary; a run stopped before that boundary strands it unanswered.
  // Redeliver it under its own message ID — a fresh ID would duplicate the message the
  // transcript already shows.
  const redriveStrandedFollowUp = (): boolean => {
    const client = runtime.client;
    if (client === null || dispatchingRef.current) return false;
    const watch = getSessionWatchSnapshot(runtime.ref).state;
    if (watch === null) return false;
    const stranded = claimStrandedFollowUp(
      { ...watch.app, activity: watch.activity },
      claimedStrandedFollowUpMessageIDs,
    );
    if (stranded === null) return false;
    dispatchingRef.current = true;
    void sendSessionPrompt(client, threadId, {
      text: stranded.text,
      messageID: stranded.messageID,
      ...(stranded.files.length > 0 ? { files: stranded.files } : {}),
      ...(stranded.metadata !== undefined ? { metadata: stranded.metadata } : {}),
      ...(stranded.synthetic === true ? { synthetic: true } : {}),
    })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Send failed",
          description: message,
          copyableError: message,
          threadKey: runtime.tabKey,
        });
      })
      .finally(() => {
        dispatchingRef.current = false;
      });
    return true;
  };

  const startAllQueued = (): void => {
    const client = runtime.client;
    const items = readThreadQueue(queueKey);
    if (client === null || items.length === 0 || isStartingAll || dispatchingRef.current) {
      return;
    }

    const selectedIDs = new Set(items.map((item) => item.id));
    const submission = queuedTasksSubmission(items);
    const previousMode = mode;
    const previousAgent = threadAgentName(mode, sessionAgent);
    dispatchingRef.current = true;
    suppressDrainRef.current = false;
    setStartingAll(true);
    modeActions.setThreadMode(runtime.tabKey, "build");
    void sendSessionPrompt(client, threadId, {
      text: submission.text,
      agent: threadAgentName("build", sessionAgent),
      // Start All wraps each request in one synthetic payload, so an original request's inline
      // source offsets no longer address this text. Keep the files, but deliberately drop ranges.
      files: promptFilesFromPaths(
        items.flatMap((item) =>
          item.files.map((file) => ({
            path: file.path,
            ...(file.filename === undefined ? {} : { filename: file.filename }),
            ...(file.mime === undefined ? {} : { mime: file.mime }),
          })),
        ),
      ),
      metadata: submission.metadata,
      synthetic: true,
    })
      .then(() => {
        removeThreadMessages(queueKey, selectedIDs);
        if (editingQueueIdRef.current !== null && selectedIDs.has(editingQueueIdRef.current)) {
          setEditingQueueId(null);
          editorRef.current?.setDraft({ text: "", files: [] });
        }
      })
      .catch((error: unknown) => {
        modeActions.setThreadMode(runtime.tabKey, previousMode);
        void client.sessions.switchAgent(runtime.ref, previousAgent).catch(() => undefined);
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Start failed",
          description: "Failed to start the queued tasks.",
          copyableError: message,
          threadKey: runtime.tabKey,
        });
      })
      .finally(() => {
        dispatchingRef.current = false;
        setStartingAll(false);
      });
  };

  const tryDrainQueue = (): void => {
    if (!queueCanDrainRef.current || dispatchingRef.current) return;
    const head = readThreadQueue(queueKey)[0];
    if (head === undefined || head.id === editingQueueIdRef.current) return;
    shiftThreadMessage(queueKey);
    dispatchPrompt(head, true);
  };

  const handleRunEnded = React.useEffectEvent(() => {
    const suppressed = suppressDrainRef.current;
    suppressDrainRef.current = false;
    if (suppressed) return;
    if (redriveStrandedFollowUp()) return;
    tryDrainQueue();
  });

  // Queued messages drain one per turn after both the run and any request for input settle.
  React.useEffect(() => {
    if (!ownsQueue) return;
    const previous = prevQueueCanDrainRef.current;
    prevQueueCanDrainRef.current = queueCanDrain;
    if (previous || !queueCanDrain) return;
    handleRunEnded();
  }, [ownsQueue, queueCanDrain]);

  const sendQueueItemNow = (id: string): void => {
    const item = readThreadQueue(queueKey).find((entry) => entry.id === id);
    if (item === undefined || dispatchingRef.current) return;
    if (item.id === editingQueueId) setEditingQueueId(null);
    removeThreadMessage(queueKey, id);
    // promptAsync steers the existing root runner at its next loop boundary. It does not
    // interrupt the session, so independently running child jobs remain alive.
    dispatchPrompt(item, true);
  };

  const removeQueueItem = (id: string): void => {
    removeThreadMessage(queueKey, id);
    if (id === editingQueueId) {
      setEditingQueueId(null);
      editorRef.current?.setDraft({ text: "", files: [] });
    }
  };

  const editQueueItem = (id: string): void => {
    const item = readThreadQueue(queueKey).find((entry) => entry.id === id);
    if (item === undefined) return;
    editorRef.current?.setDraft({
      text: item.text,
      files: item.files,
      ...(item.editorState === undefined ? {} : { editorState: item.editorState }),
    });
    setEditingQueueId(id);
  };

  const handleSubmit = (payload: PromptSubmit): boolean => {
    const client = runtime.client;
    if (client === null) {
      toastActions.add({
        type: "error",
        title: "Not connected",
        description: "The OpenCode connection is not ready yet.",
        threadKey: runtime.tabKey,
      });
      return false;
    }

    if (payload.command?.name === "cd") {
      if (payload.command.arguments.length === 0) {
        requestDirectoryPicker(true);
      } else {
        attachDirectory(payload.command.arguments);
      }
      return true;
    }
    if (payload.command !== null) {
      const message = errorMessage(gatedCapabilityError("Slash commands"));
      toastActions.add({
        type: "error",
        title: "Command failed",
        description: message,
        copyableError: message,
        threadKey: runtime.tabKey,
      });
      return false;
    }

    const input = {
      text: payload.text,
      files: payload.files,
      editorState: payload.editorState,
      agent: threadAgentName(mode, sessionAgent),
    };
    // An edit replaces the queued message in place so it keeps its position in line.
    if (ownsQueue && editingQueueId !== null) {
      replaceThreadMessage(queueKey, editingQueueId, input);
      const editedId = editingQueueId;
      setEditingQueueId(null);
      if (payload.sendNow) {
        sendQueueItemNow(editedId);
        return true;
      }
      if (sessionStatus === "idle") tryDrainQueue();
      return true;
    }
    if (!shouldQueueThreadPrompt({ ownsQueue, sendNow: payload.sendNow })) {
      dispatchPrompt(
        {
          id: crypto.randomUUID(),
          text: input.text,
          files: input.files,
          editorState: input.editorState,
          ...(input.agent === undefined ? {} : { agent: input.agent }),
        },
        ownsQueue,
      );
      return true;
    }
    // Enter always enqueues; an idle drain makes it feel like a plain send.
    enqueueThreadMessage(queueKey, input);
    if (sessionStatus === "idle") tryDrainQueue();
    return true;
  };

  // Enter on an empty composer steers the earliest queued message into the root runner.
  const sendQueueHead = (): void => {
    if (editingQueueId !== null) return;
    const head = readThreadQueue(queueKey)[0];
    if (head !== undefined) sendQueueItemNow(head.id);
  };

  return (
    <form
      ref={attachForm}
      {...stylex.props(styles.composerOverlay, styles.composerStack)}
      onSubmit={(event) => {
        event.preventDefault();
        editorRef.current?.submit();
      }}
      onKeyDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-directory-picker]") !== null
        ) {
          return;
        }
        if (event.key === "Tab" && event.shiftKey && !event.defaultPrevented) {
          event.preventDefault();
          modeActions.setThreadMode(runtime.tabKey, nextModeId(mode));
        }
      }}
    >
      {renderTrays?.(queue.length > 0)}
      {queue.length > 0 ? (
        <ComposerQueueTray
          handleRef={queueTrayRef}
          items={queue}
          editingId={editingQueueId}
          showSendHint={!hasText}
          needsAttention={needsAttention}
          isStartingAll={isStartingAll}
          onEdit={editQueueItem}
          onSendNow={sendQueueItemNow}
          onRemove={removeQueueItem}
          onReorder={(movedId, targetId, insertAfter) => {
            reorderThreadMessage(queueKey, movedId, targetId, insertAfter);
          }}
          {...(allowQueueBatchStart ? { onStartAll: startAllQueued } : {})}
          onExit={() => {
            editorRef.current?.focus();
          }}
        />
      ) : null}
      <div data-thread-composer-input="" {...stylex.props(styles.inputBox)}>
        <div
          {...stylex.props(
            composerExpanded ? styles.inputColumnExpanded : styles.inputRowCollapsed,
          )}
        >
          <PromptEditor
            placeholder="Reply…"
            ariaLabel="Reply"
            directory={cwd}
            client={runtime.client}
            modes={MODES}
            currentMode={mode}
            onModeSelect={(id: (typeof MODES)[number]["id"]) => {
              modeActions.setThreadMode(runtime.tabKey, id);
            }}
            localCommands={APP_HOST_CAPABILITIES.directoryAttach ? THREAD_COMMANDS : []}
            onCommandSelect={(name) => {
              if (name === "cd") {
                requestDirectoryPicker(true);
                return true;
              }
              return false;
            }}
            onSubmit={handleSubmit}
            {...(ownsQueue
              ? {
                  onEmptySubmit: sendQueueHead,
                  onEmptyArrowUp: () => queueTrayRef.current?.enterFromPrompt() ?? false,
                }
              : {})}
            onHasTextChange={setHasText}
            onDraftChange={(draft) => writeComposerDraft(runtime.tabKey, draft)}
            onNeedsExpansionChange={setExpanded}
            multilineMeasureWidth={measureCompactEditorWidth}
            multilineMeasureStyle={styles.editorCollapsed}
            containerStyle={
              composerExpanded ? styles.editorContainerExpanded : styles.editorContainerCollapsed
            }
            editorStyle={composerExpanded ? styles.editorExpanded : styles.editorCollapsed}
            placeholderStyle={
              composerExpanded ? styles.placeholderExpanded : styles.placeholderCollapsed
            }
            attachmentsStyle={
              composerExpanded ? styles.attachmentsExpanded : styles.attachmentsCollapsed
            }
            {...(initialDraft === undefined ? {} : { initialDraft })}
            handleRef={editorRef}
          />
          <div
            ref={controlsElementRef}
            {...stylex.props(composerExpanded ? styles.controlsExpanded : styles.controlsCollapsed)}
          >
            <ComposerAttachmentButton editorRef={editorRef} />
            {APP_HOST_CAPABILITIES.directoryAttach ? (
              <DirectoryAccessControl
                cwd={cwd}
                attachedDirectories={attachedDirectories}
                recentDirectories={recentDirectories}
                isOpen={isDirectoryPickerOpen}
                isPending={isUpdatingDirectories}
                canBrowse={canPickFolder()}
                onOpenChange={requestDirectoryPicker}
                onAttach={attachDirectory}
                onDetach={detachDirectory}
                onBrowse={browseForDirectory}
              />
            ) : null}
            <ModeControl
              value={mode}
              onValueChange={(id) => {
                modeActions.setThreadMode(runtime.tabKey, id);
              }}
            />
            <ThreadModelIndicator
              agent={threadAgentName(mode, sessionAgent)}
              model={sessionModel}
            />
            {composerExpanded ? (
              <Text
                size="xs"
                tone="faint"
                style={{ flexGrow: 1, minWidth: 0 }}
                data-composer-expanded-only=""
              >
                {ownsQueue && isSessionRunning && hasText ? "⏎ queues · ⌘⏎ sends now" : ""}
              </Text>
            ) : null}
            {isSessionRunning && !hasText ? (
              <ComposerSubmitButton intent="stop" onClick={stopRun} disabled={isStopping} />
            ) : (
              <ComposerSubmitButton
                type="submit"
                ariaLabel={ownsQueue && isSessionRunning ? "Queue" : "Send"}
                disabled={!hasText || isUpdatingDirectories}
              />
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
