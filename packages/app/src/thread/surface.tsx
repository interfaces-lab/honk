import * as stylex from "@stylexjs/stylex";
import {
  openCodeLocationRef,
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeSessionRef,
} from "@honk/opencode";
import { Icon, IconButton, Text } from "@honk/ui";
import { IconClipboard } from "@honk/ui/icons";
import { composerVars, controlVars, motionVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { HomeComposer } from "../composer/home-composer";
import { ownsThreadComposerQueue } from "../composer/submission";
import type { ThreadMessageEdit } from "../composer/types";
import type { AppChildSessionSummary, ThreadViewState } from "../open-code-view";
import { copySessionDebugInfo } from "../session-debug-info";
import { useWorkspaceWatchSelector } from "../use-sdk-watch";
import { getOpenCodeClient, type AdapterWatchStatus } from "../watch-registry";
import { ActiveSubagents } from "./active-subagents";
import { composerStateBandHeightPx, measuredComposerObstructionHeight } from "./composer-layout";
import { ThreadComposer } from "./composer";
import { InlineMessageEditComposer } from "./inline-message-edit-composer";
import { ThreadRuntimeContext, type ThreadRuntime } from "./runtime";
import { projectTaskChildLinks, taskToolControlID } from "./subagent-session";
import { SubagentTray } from "./subagent-tray";
import { taskMission, taskModelLabel } from "./task-message";
import { ThreadStream } from "./transcript";
import type { ToolPart } from "./transcript-model";
import { ThreadTray } from "./trays";

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
    maxWidth: composerVars["--honk-composer-max-width"],
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
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
  },
  connectionStatus: {
    flexShrink: 0,
    paddingInline: spaceVars["--honk-space-gutter"],
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
    paddingInline: spaceVars["--honk-space-gutter"],
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
  readonly onOpenFile?: (path: string) => void;
  readonly onViewPlan?: () => void;
  // "window" steals stray typing across the whole window (primary surface); "contained" only while
  // focus sits inside this surface, so a side chat never grabs keys from the main thread.
  readonly focusOnType?: "window" | "contained";
};

export function ThreadSurface({
  sessionRef,
  state,
  showHeader = false,
  watchStatus,
  disconnectedMessage = null,
  onReviewChanges,
  onOpenFile,
  onViewPlan,
  focusOnType = "window",
}: ThreadSurfaceProps): React.ReactElement {
  const { server, sessionID: threadId } = sessionRef;
  const client = getOpenCodeClient(server);
  const ref = openCodeSessionRef(server, threadId);
  const runtime: ThreadRuntime = { ref, client, tabKey: openCodeSessionKey(ref) };
  const ownsQueue = ownsThreadComposerQueue(state.summary.parentSessionId);
  const composerElementRef = React.useRef<HTMLFormElement | null>(null);
  const surfaceElementRef = React.useRef<HTMLDivElement | null>(null);
  const [composerObstructionHeight, setComposerObstructionHeight] = React.useState(
    composerStateBandHeightPx * 2,
  );
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
  const hasActiveSubagent = taskLinks.some(
    (link) => link.ownsLiveState && link.state === "running",
  );
  const hasPendingShell = state.parts.some(
    (part) =>
      part.type === "tool" &&
      part.tool === "bash" &&
      (part.state.status === "pending" || part.state.status === "running"),
  );
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
  // The subagent tray overlays the composer, so stray typing must not land under it.
  const focusOnTypeScope =
    selectedTaskLink !== null
      ? undefined
      : focusOnType === "contained"
        ? surfaceElementRef
        : ("window" as const);

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
        const inputHeight =
          element
            .querySelector<HTMLElement>("[data-thread-composer-input]")
            ?.getBoundingClientRect().height ?? composerStateBandHeightPx;
        // Cursor reserves one 44px prompt-header band even when the visible header is shorter.
        // Larger queue, plan, debug, and subagent trays replace that floor with their live height.
        setComposerObstructionHeight(
          measuredComposerObstructionHeight({
            composerHeightPx: element.getBoundingClientRect().height,
            inputHeightPx: inputHeight,
          }),
        );
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
  const isEmptyThread = state.messages.length === 0 && state.activity === "idle";
  const [pickedDirectory, setPickedDirectory] = React.useState<string | null>(null);
  const recentDirectories = useWorkspaceWatchSelector(
    (snapshot) => snapshot.state?.recentDirectories ?? EMPTY_DIRECTORIES,
  );

  const inlineEditComposer =
    editDraft === null ? null : (
      <InlineMessageEditComposer
        key={editDraft.messageID}
        threadId={threadId}
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
      <div
        ref={surfaceElementRef}
        {...(focusOnType === "contained" ? { "data-focus-on-type-scope": "" } : {})}
        {...stylex.props(styles.root)}
      >
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
                  {...(focusOnTypeScope === undefined ? {} : { focusOnTypeScope })}
                />
              </div>
            </div>
          ) : (
            <ThreadStream
              threadId={threadId}
              state={state}
              bottomClearancePx={composerObstructionHeight}
              editDraft={editDraft}
              editComposer={inlineEditComposer}
              {...(onReviewChanges === undefined ? {} : { onReviewChanges })}
              {...(onOpenFile === undefined ? {} : { onOpenFile })}
              openTaskPartID={selectedTaskLink?.partID ?? null}
              taskLinkByPartID={taskLinkByPartID}
              hasActiveSubagent={hasActiveSubagent}
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
            cwd={state.cwd}
            attachedDirectories={state.attachedDirectories}
            ownsQueue={ownsQueue}
            allowQueueBatchStart={ownsQueue && !hasActiveSubagent && !hasPendingShell}
            {...(focusOnTypeScope === undefined ? {} : { focusOnTypeScope })}
            renderTrays={(hasQueue) =>
              selectedTaskLink === null && editDraft === null ? (
                <ThreadTray
                  threadId={threadId}
                  state={state}
                  renderStandalone={(hasWeightedTray) =>
                    hasActiveSubagent ? (
                      <ActiveSubagents
                        links={taskLinks}
                        parts={state.parts}
                        onSelect={setSelectedTaskPartID}
                        suppressCompact={hasQueue || hasWeightedTray}
                      />
                    ) : null
                  }
                  {...(onViewPlan === undefined ? {} : { onViewPlan })}
                />
              ) : null
            }
          />
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
