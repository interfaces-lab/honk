import * as stylex from "@stylexjs/stylex";
import {
  openCodeLocationRef,
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeSessionRef,
} from "@honk/opencode";
import { Icon, IconButton, Text } from "@honk/ui";
import { IconClipboard } from "@honk/ui/icons";
import { controlVars, conversationVars, motionVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { HomeComposer } from "../composer/home-composer";
import type { ThreadMessageEdit } from "../composer/types";
import type { AppChildSessionSummary, ThreadViewState } from "../open-code-view";
import { copySessionDebugInfo } from "../session-debug-info";
import { useWorkspaceWatchSelector } from "../use-sdk-watch";
import { getOpenCodeClient, type AdapterWatchStatus } from "../watch-registry";
import { ThreadComposer } from "./composer";
import { InlineMessageEditComposer } from "./inline-message-edit-composer";
import { ThreadRuntimeContext, type ThreadRuntime } from "./runtime";
import { projectTaskChildLinks, taskToolControlID } from "./subagent-session";
import { SubagentTray } from "./subagent-tray";
import { taskMission, taskModelLabel } from "./task-message";
import { ThreadStream } from "./transcript";
import type { ToolPart } from "./transcript-model";
import { DebugTray, PlanTray } from "./trays";

const THREAD_MAX_WIDTH = "840px";
const COMPOSER_COLLAPSED_MIN_HEIGHT_PX = 44;
const COMPOSER_STREAM_CLEARANCE_PX = 52;
// Match the new-session page's centered composer measure and bottom bias.
const EMPTY_COMPOSER_MAX_WIDTH = "720px";
const EMPTY_COMPOSER_BOTTOM_BIAS = "12vh";
const EMPTY_CHILD_SESSIONS: readonly AppChildSessionSummary[] = Object.freeze([]);
const EMPTY_DIRECTORIES: readonly string[] = Object.freeze([]);

const styles = stylex.create({
  root: {
    position: "relative",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    width: "100%",
    maxWidth: THREAD_MAX_WIDTH,
    marginInline: "auto",
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInline: spaceVars["--honk-space-gutter"],
    boxSizing: "border-box",
    overflow: "hidden",
  },
  conversation: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    opacity: 1,
    transitionProperty: "opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  conversationDimmed: { opacity: 0.45 },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    minWidth: 0,
    paddingInline: conversationVars["--honk-conversation-inset"],
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
  },
  connectionStatus: {
    flexShrink: 0,
    paddingInline: conversationVars["--honk-conversation-inset"],
  },
  emptyArea: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingBlockEnd: EMPTY_COMPOSER_BOTTOM_BIAS,
  },
  emptyComposer: {
    width: "100%",
    maxWidth: EMPTY_COMPOSER_MAX_WIDTH,
    maxHeight: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
});

export type ThreadSurfaceProps = {
  readonly sessionRef: OpenCodeSessionRef;
  readonly state: ThreadViewState;
  readonly watchStatus: AdapterWatchStatus;
  readonly showHeader?: boolean;
  readonly disconnectedMessage?: string | null;
  readonly onReviewChanges?: () => void;
  readonly onViewPlan?: () => void;
};

export function ThreadSurface({
  sessionRef,
  state,
  showHeader = false,
  watchStatus,
  disconnectedMessage = null,
  onReviewChanges,
  onViewPlan,
}: ThreadSurfaceProps): React.ReactElement {
  const { server, sessionID: threadId } = sessionRef;
  const client = getOpenCodeClient(server);
  const ref = openCodeSessionRef(server, threadId);
  const runtime: ThreadRuntime = { ref, client, tabKey: openCodeSessionKey(ref) };
  const composerElementRef = React.useRef<HTMLFormElement | null>(null);
  const [composerHeight, setComposerHeight] = React.useState(COMPOSER_COLLAPSED_MIN_HEIGHT_PX);
  const [editDraft, setEditDraft] = React.useState<ThreadMessageEdit | null>(null);
  const childSessions = useWorkspaceWatchSelector(
    (snapshot) => snapshot.state?.childSessions ?? EMPTY_CHILD_SESSIONS,
  );
  const taskLinks = projectTaskChildLinks({
    parts: state.parts,
    children: childSessions,
    parentSessionID: threadId,
    server,
  });
  const taskLinkByPartID = new Map(taskLinks.map((link) => [link.partID, link] as const));
  const [selectedTaskPartID, setSelectedTaskPartID] = React.useState<string | null>(null);
  const selectedTaskLink =
    selectedTaskPartID === null ? null : (taskLinkByPartID.get(selectedTaskPartID) ?? null);
  const selectedTaskPart =
    selectedTaskPartID === null
      ? null
      : (state.parts.find(
          (part): part is ToolPart =>
            part.id === selectedTaskPartID && part.type === "tool" && part.tool === "task",
        ) ?? null);
  const invalidTaskPartID =
    selectedTaskPartID !== null && selectedTaskLink === null ? selectedTaskPartID : null;

  React.useEffect(() => {
    if (invalidTaskPartID === null) return;
    setSelectedTaskPartID(null);
    restoreTaskFocus(invalidTaskPartID, composerElementRef.current);
  }, [invalidTaskPartID]);

  const minimizeTaskPreview = (): void => {
    const partID = selectedTaskPartID;
    setSelectedTaskPartID(null);
    if (partID !== null) restoreTaskFocus(partID, composerElementRef.current);
  };
  const attachComposer: React.RefCallback<HTMLFormElement> = (element) => {
    composerElementRef.current = element;
    if (element === null) return;

    let measureFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => {
        measureFrame = 0;
        setComposerHeight(Math.ceil(element.getBoundingClientRect().height));
      });
    });
    observer.observe(element);

    return () => {
      cancelAnimationFrame(measureFrame);
      observer.disconnect();
    };
  };

  // A thread with no messages reads as a fresh draft: show the home composer centered like the
  // new-session page. Submitting opens the configured session and closes this stale tab.
  const isEmptyThread = state.messages.length === 0 && state.summary.status !== "running";
  const [pickedDirectory, setPickedDirectory] = React.useState<string | null>(null);
  const recentDirectories = useWorkspaceWatchSelector(
    (snapshot) => snapshot.state?.recentDirectories ?? EMPTY_DIRECTORIES,
  );

  const inlineEditComposer =
    editDraft === null ? null : (
      <InlineMessageEditComposer
        key={editDraft.messageID}
        threadId={threadId}
        isRunning={state.summary.status === "running"}
        cwd={state.cwd}
        draft={editDraft}
        onCancel={() => {
          setEditDraft(null);
        }}
        onSubmitted={() => {
          setEditDraft(null);
        }}
      />
    );

  return (
    <ThreadRuntimeContext.Provider value={runtime}>
      <div {...stylex.props(styles.root)}>
        <div
          {...stylex.props(
            styles.conversation,
            selectedTaskLink !== null && styles.conversationDimmed,
          )}
        >
          {showHeader && !isEmptyThread ? (
            <header {...stylex.props(styles.header)}>
              <div {...stylex.props(styles.headerRow)}>
                <Text
                  as="div"
                  size="xl"
                  weight="semibold"
                  truncate
                  style={{ minWidth: 0, flexGrow: 1 }}
                >
                  {state.summary.title}
                </Text>
                {import.meta.env.DEV ? (
                  <IconButton
                    size="sm"
                    variant="quiet"
                    aria-label="Copy session debug info"
                    title="Copy session debug info"
                    onClick={() => {
                      void copySessionDebugInfo({ ref: sessionRef, state, watchStatus });
                    }}
                  >
                    <Icon icon={IconClipboard} size="sm" tone="faint" />
                  </IconButton>
                ) : null}
              </div>
              <Text as="p" size="xs" tone="faint" family="mono" truncate>
                {state.cwd}
              </Text>
            </header>
          ) : null}
          {disconnectedMessage !== null ? (
            <div {...stylex.props(styles.connectionStatus)}>
              <Text as="p" size="sm" tone="faint">
                {disconnectedMessage}
              </Text>
            </div>
          ) : null}
          {isEmptyThread ? (
            <div {...stylex.props(styles.emptyArea)}>
              <div {...stylex.props(styles.emptyComposer)}>
                <HomeComposer
                  autoFocus
                  server={server}
                  location={openCodeLocationRef({ directory: pickedDirectory ?? state.cwd })}
                  recentDirectories={recentDirectories}
                  replaceSessionKey={runtime.tabKey}
                  onDirectoryPicked={setPickedDirectory}
                />
              </div>
            </div>
          ) : (
            <ThreadStream
              threadId={threadId}
              state={state}
              bottomClearancePx={composerHeight + COMPOSER_STREAM_CLEARANCE_PX}
              editDraft={editDraft}
              editComposer={inlineEditComposer}
              {...(onReviewChanges === undefined ? {} : { onReviewChanges })}
              openTaskPartID={selectedTaskLink?.partID ?? null}
              taskLinkByPartID={taskLinkByPartID}
              hasActiveSubagent={taskLinks.some(
                (link) => link.ownsLiveState && link.state === "running",
              )}
              onOpenTask={(part) => {
                if (part.id === selectedTaskLink?.partID) {
                  minimizeTaskPreview();
                } else {
                  setSelectedTaskPartID(part.id);
                }
              }}
              onEditMessage={setEditDraft}
            />
          )}
        </div>
        {isEmptyThread ? null : (
          <ThreadComposer
            formRef={attachComposer}
            threadId={threadId}
            isRunning={state.summary.status === "running"}
            cwd={state.cwd}
            attachedDirectories={state.attachedDirectories}
          >
            {selectedTaskLink === null && editDraft === null ? (
              <>
                <PlanTray
                  threadId={threadId}
                  state={state}
                  {...(onViewPlan === undefined ? {} : { onViewPlan })}
                />
                <DebugTray threadId={threadId} state={state} />
              </>
            ) : null}
          </ThreadComposer>
        )}
        {selectedTaskLink !== null ? (
          <SubagentTray
            partID={selectedTaskLink.partID}
            child={selectedTaskLink.child}
            mission={
              selectedTaskPart === null
                ? selectedTaskLink.child.title
                : taskMission(selectedTaskPart, selectedTaskLink.child)
            }
            model={
              selectedTaskPart === null
                ? null
                : taskModelLabel(selectedTaskPart, selectedTaskLink.child)
            }
            anchorRef={composerElementRef}
            onMinimize={minimizeTaskPreview}
          />
        ) : null}
      </div>
    </ThreadRuntimeContext.Provider>
  );
}

function restoreTaskFocus(partID: string, composer: HTMLFormElement | null): void {
  window.requestAnimationFrame(() => {
    const control = document.getElementById(taskToolControlID(partID));
    if (control !== null) {
      control.focus();
      return;
    }
    composer?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  });
}
