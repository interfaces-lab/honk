// The native thread view over the opencode sidecar (atomic-round rework, 2026-07-11): the
// transcript renders opencode's Message/Part model directly — parts discriminate on `type`
// (text/reasoning/tool/file/subtask/step-start/step-finish/snapshot/patch/agent/retry/
// compaction), tool lifecycle lives in `part.state.status`, and streaming is `time.end`
// absence. There is NO server-side queue in opencode — the old QueueTray died with the honk
// wire. Send resends the birth-pinned preset via the sidecar seam (sidecar.ts).
//
// 2026-07-12 preview-group rework: assistant parts no longer render as a flat list of lines.
// They segment into BLOCKS — prose (text), thinking (consecutive reasoning), work (consecutive
// tool/subtask/file/patch/agent) — and the work/thinking blocks wear the locked §5
// work-group anatomy: a summary verb header (shimmering while live, Stop on hover), the 144px
// bottom-anchored live preview while running, and a collapsed disclosure once done. Thinking
// collapses to "Thought for Ns" (codex reasoning streams many short parts; the group is the
// honest unit, not each fragment).

import * as stylex from "@stylexjs/stylex";
import {
  Button,
  ChangeReceipt,
  Spinner,
  StatusRow,
  Text,
  ToolCallLine,
  UserMessage,
  WorkGroup,
} from "@honk/ui";
import { AssistantMessage } from "@honk/ui/assistant-message";
import { CompactionDivider } from "@honk/ui/compaction-divider";
import { NoticeRow } from "@honk/ui/notice-row";
import { PlanCard } from "@honk/ui/plan-card";
import { ReasoningBlock } from "@honk/ui/reasoning-block";
import {
  colorVars,
  controlVars,
  conversationVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";
import { useParams } from "@tanstack/react-router";
import * as React from "react";

import {
  ComposerAttachmentButton,
  ModeControl,
  PromptEditor,
  type PromptEditorHandle,
  type PromptSubmit,
} from "./composer";
import { DirectoryAccessControl } from "./directory-access-control";
import { canPickFolder, pickFolder } from "./desktop-bridge";
import { Markdown } from "./markdown";
import { actions as modeActions, modeAgentName, nextModeId, useThreadMode } from "./modes";
import type { SideChatSummary, ThreadState } from "./sidecar";
import { actions as toastActions } from "./toast-store";
import {
  ToolMessage,
  toolCategory,
  toolDetail,
  toolOutput,
  toolVerb,
  type ToolCategory,
} from "./tool-message";
import { useThreadWatch, useWorkspaceWatchSelector } from "./use-sdk-watch";
import { getBoundHonkClient } from "./watch-registry";
import { Workbench, workbenchActions } from "./workbench";

type ThreadMessage = ThreadState["messages"][number];
type ThreadPart = ThreadState["parts"][number];
type ToolPart = Extract<ThreadPart, { readonly type: "tool" }>;
type TextPart = Extract<ThreadPart, { readonly type: "text" }>;
type ReasoningPart = Extract<ThreadPart, { readonly type: "reasoning" }>;
type FilePart = Extract<ThreadPart, { readonly type: "file" }>;
type UserThreadMessage = Extract<ThreadMessage, { readonly role: "user" }>;
type AssistantThreadMessage = Extract<ThreadMessage, { readonly role: "assistant" }>;
type ThreadDiff = NonNullable<UserThreadMessage["summary"]>["diffs"][number];
type RenderableThreadDiff = ThreadDiff & { readonly file: string };
const EMPTY_SIDE_CHATS: readonly SideChatSummary[] = Object.freeze([]);
const EMPTY_DIRECTORIES: readonly string[] = Object.freeze([]);

// Thread column from locked §5; sized to the current app's readable chat lane.
const THREAD_MAX_WIDTH = "840px";
// The thread composer's compact height — one text line plus its controls on a single row.
const COMPOSER_COLLAPSED_MIN_HEIGHT = "44px";
// One text line for the editor (matches the shared editor's 20px leading); its min-height when
// collapsed, and the floor it grows from when expanded.
const COMPOSER_EDITOR_LINE = "20px";
// The expanded editor's scroll ceiling before it starts scrolling internally.
const COMPOSER_EDITOR_MAX_HEIGHT = "200px";
const RING_BASE = `inset 0 0 0 1px ${colorVars["--honk-color-border-base"]}`;
// The mode tray (plan / debug): a compact floating card that hovers directly above the composer
// rather than sitting in the column flow — so it never reflows the transcript or shoves the composer
// down (the "whole screen pushed down" glitch), and its buttons live in a deliberate layer instead
// of leaking into the page tab order. Cursor's tray recipe: an opaque card lifted by a hairline ring
// baked into a soft two-tier shadow, a calm 6-10px corner, and a committed fixed width. honk's tint
// is a progressive vertical fade — blue for plan (ALF accent-subtle → surface), violet for debug —
// so the tray reads as its mode at a glance while body text stays neutral for contrast.
const TRAY_WIDTH = "460px";
const TRAY_MAX_HEIGHT = "min(46vh, 380px)";
const TRAY_ELEVATION = elevationVars["--honk-elevation-floating"];
const TRAY_PLAN_RING = `inset 0 0 0 1px ${colorVars["--honk-color-info-border"]}`;
const TRAY_PLAN_FADE = `linear-gradient(180deg, ${colorVars["--honk-color-accent-subtle"]}, ${colorVars["--honk-color-bg-base"]})`;
const TRAY_DEBUG_RING = `inset 0 0 0 1px color-mix(in srgb, ${colorVars["--honk-color-preset-ultra"]} 30%, transparent)`;
const TRAY_DEBUG_FADE = `linear-gradient(180deg, color-mix(in srgb, ${colorVars["--honk-color-preset-ultra"]} 12%, ${colorVars["--honk-color-bg-base"]}), ${colorVars["--honk-color-bg-base"]})`;
// Transcript attachments use one compact media envelope in both user and tool messages.
const ATTACHMENT_MAX_WIDTH = "240px";
const ATTACHMENT_MAX_HEIGHT = "160px";
const ATTACHMENT_CHIP_PAD_Y = "1px";
// Above this many rows the 144px preview window clips — draw the top fade mask.
const PREVIEW_SCROLLABLE_ROWS = 5;

const styles = stylex.create({
  // The route row: the readable thread lane beside the (optional) workbench column.
  page: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    width: "100%",
    display: "flex",
    flexDirection: "row",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
  },
  headerTitle: {
    minWidth: 0,
    flexGrow: 1,
  },
  root: {
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
  header: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    minWidth: 0,
    paddingInline: conversationVars["--honk-conversation-inset"],
  },
  stream: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"],
    overflowY: "auto",
    // The transcript is the one vertical viewport inside the fixed shell. Stable gutter geometry
    // prevents the prose measure from shifting when a scrollbar appears, and contained overscroll
    // keeps a trackpad fling from leaking into the window behind it. Smooth programmatic/focus
    // movement mirrors the reference reading surface while reduced-motion keeps the jump immediate.
    scrollbarGutter: "stable",
    overscrollBehaviorY: "contain",
    scrollBehavior: {
      default: "smooth",
      "@media (prefers-reduced-motion: reduce)": "auto",
    },
    scrollPaddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingBlock: spaceVars["--honk-space-gutter"],
  },
  turn: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"],
    minWidth: 0,
    width: "100%",
  },
  assistantStack: {
    display: "flex",
    flexDirection: "column",
    gap: conversationVars["--honk-conversation-step-gap"],
    minWidth: 0,
    width: "100%",
  },
  preWrap: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  center: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  // The thread composer has two states, flipped by the editor's wrap state (PromptEditor's
  // onMultilineChange): a compact single-line box with its controls inline on the right, and — once
  // the reply wraps or gains a line break — an EXPANDED block whose toolbar drops to its own row.
  // This is the old composer's one-line → multi-line feel. Both share the same rounded-rectangle
  // corner (never a capsule — a full pill reads like an active-mode state, which this is not).
  composerCollapsed: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minHeight: COMPOSER_COLLAPSED_MIN_HEIGHT,
    paddingBlock: "6px",
    paddingInline: "10px",
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    boxShadow: `${RING_BASE}, ${elevationVars["--honk-elevation-raised"]}`,
  },
  composerExpanded: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    boxShadow: `${RING_BASE}, ${elevationVars["--honk-elevation-raised"]}`,
  },
  // The PromptEditor container: grows to fill the collapsed row, or spans the full expanded block.
  editorContainerCollapsed: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  editorContainerExpanded: {
    width: "100%",
  },
  // The contenteditable geometry per mode — overrides the shared 52px "hero" box. Longhand padding
  // keys (paddingTop/Bottom/Inline) so they win over the base editor's own longhands.
  editorCollapsed: {
    minHeight: COMPOSER_EDITOR_LINE,
    maxHeight: "120px",
    paddingTop: 0,
    paddingBottom: 0,
    paddingInline: "4px",
    lineHeight: COMPOSER_EDITOR_LINE,
  },
  editorExpanded: {
    minHeight: COMPOSER_EDITOR_LINE,
    maxHeight: COMPOSER_EDITOR_MAX_HEIGHT,
    paddingTop: spaceVars["--honk-space-gutter"],
    paddingBottom: 0,
    paddingInline: "12px",
    lineHeight: COMPOSER_EDITOR_LINE,
  },
  // The placeholder overlay, kept aligned to the editor's text origin in each mode.
  placeholderCollapsed: {
    insetInlineStart: "4px",
    insetBlockStart: 0,
    lineHeight: COMPOSER_EDITOR_LINE,
  },
  placeholderExpanded: {
    insetInlineStart: "12px",
    insetBlockStart: spaceVars["--honk-space-gutter"],
    lineHeight: COMPOSER_EDITOR_LINE,
  },
  // Controls: inline at the collapsed row's right edge, or a padded toolbar row beneath the editor.
  controlsCollapsed: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  controlsExpanded: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: "6px",
    paddingInline: "10px",
  },
  composerHint: {
    flexGrow: 1,
    minWidth: 0,
  },
  // User-message attachment chips — the prompt's file/image mentions, visible in the transcript
  // (an invisible upload is the "photo not added" bug's second half).
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
    maxWidth: ATTACHMENT_MAX_WIDTH,
    paddingBlock: ATTACHMENT_CHIP_PAD_Y,
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
  // An attached image renders as a real thumbnail, capped so the bubble stays a bubble.
  userAttachmentImage: {
    display: "block",
    maxWidth: ATTACHMENT_MAX_WIDTH,
    maxHeight: ATTACHMENT_MAX_HEIGHT,
    borderRadius: radiusVars["--honk-radius-control"],
    boxShadow: RING_BASE,
    objectFit: "cover",
  },
  // The relative anchor that holds the composer AND its floating tray. The tray positions against
  // this dock's top edge (bottom:100%), so the composer keeps its natural place and the tray hovers
  // above it without contributing any layout height.
  composerDock: {
    position: "relative",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
  },
  // The floating tray card — shared frame; the tone variants paint the tint, ring, and shadow.
  tray: {
    position: "absolute",
    insetInlineStart: 0,
    bottom: "100%",
    marginBottom: spaceVars["--honk-space-gutter"],
    zIndex: zVars["--honk-z-stage-float"],
    width: `min(${TRAY_WIDTH}, 100%)`,
    maxHeight: TRAY_MAX_HEIGHT,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-panel"],
    overflowY: "auto",
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  trayPlan: {
    backgroundImage: TRAY_PLAN_FADE,
    boxShadow: `${TRAY_PLAN_RING}, ${TRAY_ELEVATION}`,
  },
  trayDebug: {
    backgroundImage: TRAY_DEBUG_FADE,
    boxShadow: `${TRAY_DEBUG_RING}, ${TRAY_ELEVATION}`,
  },
  // Debug tray body — a short neutral hint; the full diagnosis stays in the transcript.
  trayHint: {
    minWidth: 0,
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  trayActions: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
});

function ThreadPage(): React.ReactElement {
  const { threadId } = useParams({ from: "/thread/$threadId" });
  const watch = useThreadWatch(threadId);
  const state = watch.state;
  const isConnecting = watch.status === "connecting" && state === null;
  const isDisconnected = watch.status === "closed" || watch.status === "unauthorized";

  if (isConnecting) {
    return (
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.center)}>
          <Spinner label="Connecting to thread" tone="muted" />
        </div>
      </div>
    );
  }

  if (state === null) {
    return (
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.center)}>
          <Text as="p" size="lg" tone="muted" weight="medium">
            Thread unavailable
          </Text>
          <Text as="p" size="xs" tone="faint" family="mono">
            {threadId}
          </Text>
        </div>
      </div>
    );
  }

  const createSideChat = async (prompt: string): Promise<void> => {
    const client = getBoundHonkClient();
    if (client === null) {
      throw new Error("The sidecar connection is not ready yet.");
    }
    const sideChat = await client.threads.createSideChat(threadId);
    workbenchActions.setSideChat(sideChat.id, threadId);
    const text = prompt.trim();
    if (text.length === 0) {
      return;
    }
    const title = titleFromPrompt(text);
    if (title.length > 0) {
      void client.threads.setTitle(sideChat.id, title).catch(() => {
        // Rename is cosmetic — the fork remains usable if it fails.
      });
    }
    await client.threads.send(sideChat.id, {
      messageId: newMessageId(),
      text,
      agent: modeAgentName("build"),
    });
  };

  return (
    <div {...stylex.props(styles.page)}>
      <ThreadSurface
        threadId={threadId}
        state={state}
        showHeader
        disconnectedMessage={
          isDisconnected
            ? watch.status === "unauthorized"
              ? "Thread watch unauthorized."
              : "Thread watch closed."
            : null
        }
        onCreateSideChat={createSideChat}
      />
      <Workbench
        parentThreadId={threadId}
        directory={state.cwd}
        isThreadRunning={state.summary.status === "running"}
        onCreateSideChat={() => createSideChat("")}
        renderSideChat={(sideChatId) => <SideChatThread threadId={sideChatId} />}
      />
    </div>
  );
}

function ThreadSurface({
  threadId,
  state,
  showHeader = false,
  disconnectedMessage = null,
  onCreateSideChat,
}: {
  readonly threadId: string;
  readonly state: ThreadState;
  readonly showHeader?: boolean;
  readonly disconnectedMessage?: string | null;
  readonly onCreateSideChat?: (prompt: string) => Promise<void>;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.root)}>
      {showHeader ? (
        <header {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.headerRow)}>
            <Text as="div" size="xl" weight="semibold" truncate xstyle={styles.headerTitle}>
              {state.summary.title}
            </Text>
          </div>
          <Text as="p" size="xs" tone="faint" family="mono" truncate>
            {state.cwd}
          </Text>
          {disconnectedMessage !== null ? (
            <Text as="p" size="sm" tone="faint">
              {disconnectedMessage}
            </Text>
          ) : null}
        </header>
      ) : null}
      <ThreadStream threadId={threadId} state={state} />
      <div {...stylex.props(styles.composerDock)}>
        <PlanTray threadId={threadId} state={state} />
        <DebugTray threadId={threadId} state={state} />
        <ThreadComposer
          threadId={threadId}
          isRunning={state.summary.status === "running"}
          cwd={state.cwd}
          attachedDirectories={state.attachedDirectories}
          title={state.summary.title}
          {...(onCreateSideChat !== undefined ? { onCreateSideChat } : {})}
        />
      </div>
    </div>
  );
}

function SideChatThread({ threadId }: { readonly threadId: string }): React.ReactElement {
  const watch = useThreadWatch(threadId);
  if (watch.status === "connecting" && watch.state === null) {
    return (
      <div {...stylex.props(styles.center)}>
        <Spinner label="Connecting to side chat" tone="muted" />
      </div>
    );
  }
  if (watch.state === null) {
    return (
      <div {...stylex.props(styles.center)}>
        <Text as="p" size="sm" tone="muted" weight="medium">
          Side chat unavailable
        </Text>
      </div>
    );
  }
  return <ThreadSurface threadId={threadId} state={watch.state} />;
}

// The structured plan the honk internal plugin's plan_submit tool records — its args land
// on the ToolPart's completed-state metadata (contract shared with the plugin in
// packages/desktop/src/backend).
type SubmittedPlan = {
  readonly title: string;
  readonly summary?: string;
  readonly steps: readonly { readonly title: string; readonly detail?: string }[];
  readonly files?: readonly string[];
};

function submittedPlanFrom(part: ThreadPart): SubmittedPlan | null {
  if (part.type !== "tool" || part.tool !== "plan_submit" || part.state.status !== "completed") {
    return null;
  }
  // The plugin nests the structured args under metadata.plan (verified live).
  const metadata = (part.state.metadata as { plan?: Partial<SubmittedPlan> }).plan;
  if (
    metadata === undefined ||
    typeof metadata.title !== "string" ||
    !Array.isArray(metadata.steps)
  ) {
    return null;
  }
  return {
    title: metadata.title,
    ...(typeof metadata.summary === "string" ? { summary: metadata.summary } : {}),
    steps: metadata.steps.filter(
      (step): step is { title: string; detail?: string } =>
        typeof (step as { title?: unknown }).title === "string",
    ),
    ...(Array.isArray(metadata.files)
      ? { files: metadata.files.filter((f) => typeof f === "string") }
      : {}),
  };
}

// The plan-mode tray. Preferred source: the plugin's plan_submit ToolPart (structured plan
// in its metadata — the honest "the plan is finished" signal). Fallback when the plugin is
// absent: the last completed assistant answer's text. Implementing flips the thread's mode
// to build and sends the go-ahead; the model pin never moves. Dismissal is per plan
// (part/message id), so a revised plan re-raises the tray.
function PlanTray({
  threadId,
  state,
}: {
  threadId: string;
  state: ThreadState;
}): React.ReactElement | null {
  const mode = useThreadMode(threadId);
  const [dismissedId, setDismissedId] = React.useState<string | null>(null);

  if (mode !== "plan") {
    return null;
  }

  // Structured path: the newest completed plan_submit part wins.
  const planPart = state.parts.findLast((part) => submittedPlanFrom(part) !== null);
  const submitted = planPart === undefined ? null : submittedPlanFrom(planPart);

  const lastAssistant = state.messages.findLast(
    (message): message is AssistantThreadMessage =>
      message.role === "assistant" && message.time.completed !== undefined,
  );

  const planKey = planPart?.id ?? lastAssistant?.id ?? null;
  if (planKey === null || planKey === dismissedId) {
    return null;
  }

  let planTitle = "Proposed plan";
  let planSummary: string | undefined;
  let planBody = "";
  if (submitted !== null) {
    planTitle = submitted.title;
    planSummary = submitted.summary;
    planBody = [
      ...submitted.steps.map(
        (step, index) =>
          `${String(index + 1)}. ${step.title}${step.detail !== undefined ? ` — ${step.detail}` : ""}`,
      ),
      ...(submitted.files !== undefined && submitted.files.length > 0
        ? ["", `Files: ${submitted.files.join(", ")}`]
        : []),
    ].join("\n");
  } else {
    if (lastAssistant === undefined) {
      return null;
    }
    planBody = state.parts
      .filter(
        (part): part is TextPart =>
          part.type === "text" && part.messageID === lastAssistant.id && part.ignored !== true,
      )
      .map((part) => part.text)
      .join("\n\n")
      .trim();
  }
  if (planBody.length === 0) {
    return null;
  }

  const implement = (): void => {
    const client = getBoundHonkClient();
    if (client === null) {
      return;
    }
    modeActions.setThreadMode(threadId, "build");
    void client.threads
      .send(threadId, {
        messageId: newMessageId(),
        text: "Implement the plan above.",
        agent: modeAgentName("build"),
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Implement failed",
          description: message,
          copyableError: message,
          threadKey: threadId,
        });
      });
  };

  return (
    <div {...stylex.props(styles.tray, styles.trayPlan)}>
      <PlanCard title={planTitle} summary={planSummary}>
        <Markdown text={planBody} />
      </PlanCard>
      <div {...stylex.props(styles.trayActions)}>
        <Button variant="primary" onClick={implement}>
          Implement plan
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDismissedId(planKey);
          }}
        >
          Keep planning
        </Button>
      </div>
    </div>
  );
}

// The debug-mode tray. Debug has no structured tool the way plan has plan_submit, and the full
// diagnosis already renders in the transcript — so this is a slim violet action bar, not a text
// dump: it surfaces once a diagnosis turn completes and offers to apply the recommended fix
// (flip to build + send the go-ahead, mirroring PlanTray.implement) or keep diagnosing. A short
// clamped hint from the last answer gives it context. Dismissal is per message id.
function DebugTray({
  threadId,
  state,
}: {
  threadId: string;
  state: ThreadState;
}): React.ReactElement | null {
  const mode = useThreadMode(threadId);
  const [dismissedId, setDismissedId] = React.useState<string | null>(null);

  if (mode !== "debug") {
    return null;
  }

  // Only offer the action once the diagnosis turn has actually finished — a still-running turn is
  // not yet a conclusion to act on.
  if (state.summary.status === "running") {
    return null;
  }

  const lastAssistant = state.messages.findLast(
    (message): message is AssistantThreadMessage =>
      message.role === "assistant" && message.time.completed !== undefined,
  );
  const diagnosisKey = lastAssistant?.id ?? null;
  if (diagnosisKey === null || diagnosisKey === dismissedId) {
    return null;
  }

  const hint = state.parts
    .filter(
      (part): part is TextPart =>
        part.type === "text" && part.messageID === lastAssistant?.id && part.ignored !== true,
    )
    .map((part) => part.text)
    .join(" ")
    .trim();
  if (hint.length === 0) {
    return null;
  }

  const applyFix = (): void => {
    const client = getBoundHonkClient();
    if (client === null) {
      return;
    }
    modeActions.setThreadMode(threadId, "build");
    void client.threads
      .send(threadId, {
        messageId: newMessageId(),
        text: "Apply the recommended fix.",
        agent: modeAgentName("build"),
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Apply fix failed",
          description: message,
          copyableError: message,
          threadKey: threadId,
        });
      });
  };

  return (
    <div {...stylex.props(styles.tray, styles.trayDebug)}>
      <p {...stylex.props(styles.trayHint)}>{hint}</p>
      <div {...stylex.props(styles.trayActions)}>
        <Button variant="primary" onClick={applyFix}>
          Apply fix
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDismissedId(diagnosisKey);
          }}
        >
          Keep debugging
        </Button>
      </div>
    </div>
  );
}

function ThreadStream({
  threadId,
  state,
}: {
  threadId: string;
  state: ThreadState;
}): React.ReactElement {
  const partsByMessageId = groupPartsByMessage(state.parts);
  const turns = groupMessagesIntoTurns(state.messages);
  const hasActivePart = state.parts.some(isPartActive);

  const interrupt = (): void => {
    const client = getBoundHonkClient();
    if (client === null) {
      return;
    }
    void client.threads.interrupt(threadId).catch((error: unknown) => {
      const message = errorMessage(error);
      toastActions.add({
        type: "error",
        title: "Stop failed",
        description: message,
        copyableError: message,
        threadKey: threadId,
      });
    });
  };

  if (state.messages.length === 0) {
    return (
      <div {...stylex.props(styles.stream)}>
        <div {...stylex.props(styles.center)}>
          <Text as="p" size="sm" tone="muted" weight="medium">
            Empty thread
          </Text>
          <Text as="p" size="xs" tone="faint">
            Send a message below to start the conversation.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.stream)} aria-label="Thread transcript">
      {turns.map((turn, index) => (
        <ThreadTurnRow
          key={turn.key}
          turn={turn}
          partsByMessageId={partsByMessageId}
          isLast={index === turns.length - 1}
          isThreadRunning={state.summary.status === "running"}
          onInterrupt={interrupt}
        />
      ))}
      {state.summary.status === "running" && !hasActivePart ? (
        <StatusRow>Planning next moves</StatusRow>
      ) : null}
    </div>
  );
}

const EMPTY_PARTS: readonly ThreadPart[] = Object.freeze([]);

type ThreadTurn = {
  readonly key: string;
  readonly user: UserThreadMessage | null;
  readonly assistants: readonly AssistantThreadMessage[];
};

function groupMessagesIntoTurns(messages: readonly ThreadMessage[]): readonly ThreadTurn[] {
  const turns: {
    key: string;
    user: UserThreadMessage | null;
    assistants: AssistantThreadMessage[];
  }[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ key: message.id, user: message, assistants: [] });
      continue;
    }
    const current = turns[turns.length - 1];
    if (current === undefined || current.user === null) {
      if (current === undefined) {
        turns.push({ key: message.id, user: null, assistants: [message] });
      } else {
        current.assistants.push(message);
      }
      continue;
    }
    current.assistants.push(message);
  }
  return turns;
}

function ThreadTurnRow({
  turn,
  partsByMessageId,
  isLast,
  isThreadRunning,
  onInterrupt,
}: {
  readonly turn: ThreadTurn;
  readonly partsByMessageId: ReadonlyMap<string, readonly ThreadPart[]>;
  readonly isLast: boolean;
  readonly isThreadRunning: boolean;
  readonly onInterrupt: () => void;
}): React.ReactElement {
  const diffs = turnDiffs(turn.user);
  const showDiffs = diffs.length > 0 && (!isLast || !isThreadRunning);

  return (
    <div {...stylex.props(styles.turn)}>
      {turn.user !== null ? (
        <ThreadMessageRow
          message={turn.user}
          parts={partsByMessageId.get(turn.user.id) ?? EMPTY_PARTS}
          onInterrupt={onInterrupt}
        />
      ) : null}
      {turn.assistants.map((message) => (
        <ThreadMessageRow
          key={message.id}
          message={message}
          parts={partsByMessageId.get(message.id) ?? EMPTY_PARTS}
          onInterrupt={onInterrupt}
        />
      ))}
      {showDiffs ? <TurnDiffSummary diffs={diffs} /> : null}
    </div>
  );
}

// OpenCode records each turn's snapshot diff on its UserMessage summary. Match its own TUI:
// keep the newest entry per path, preserve display order, and render the receipt after the turn.
function turnDiffs(message: UserThreadMessage | null): readonly RenderableThreadDiff[] {
  const diffs = message?.summary?.diffs ?? [];
  const seen = new Set<string>();
  const result: RenderableThreadDiff[] = [];
  for (let index = diffs.length - 1; index >= 0; index -= 1) {
    const diff = diffs[index];
    if (diff === undefined || typeof diff.file !== "string" || seen.has(diff.file)) {
      continue;
    }
    if (diff.additions === 0 && diff.deletions === 0 && diff.status !== "deleted") {
      continue;
    }
    seen.add(diff.file);
    result.push({ ...diff, file: diff.file });
  }
  return result.reverse();
}

function TurnDiffSummary({
  diffs,
}: {
  readonly diffs: readonly RenderableThreadDiff[];
}): React.ReactElement {
  return (
    <ChangeReceipt
      files={diffs.map((diff) => ({
        path: diff.file,
        additions: diff.additions,
        deletions: diff.deletions,
        status: diff.status,
      }))}
      onReview={() => {
        workbenchActions.setTab("changes");
      }}
    />
  );
}

function groupPartsByMessage(parts: readonly ThreadPart[]): Map<string, readonly ThreadPart[]> {
  const grouped = new Map<string, ThreadPart[]>();
  for (const part of parts) {
    const existing = grouped.get(part.messageID);
    if (existing === undefined) {
      grouped.set(part.messageID, [part]);
    } else {
      existing.push(part);
    }
  }
  return grouped;
}

// A part still doing work: tool pending/running, or a text/reasoning span whose clock has a
// start and no end (opencode's streaming signal).
function isPartActive(part: ThreadPart): boolean {
  if (part.type === "tool") {
    return part.state.status === "pending" || part.state.status === "running";
  }
  if (part.type === "text" || part.type === "reasoning") {
    return part.time?.start !== undefined && part.time.end === undefined;
  }
  return false;
}

// opencode's assistant error union carries the human message under data.message.
function messageError(message: ThreadMessage): string | null {
  if (message.role !== "assistant" || message.error === undefined) {
    return null;
  }
  const data = (message.error as { data?: { message?: unknown } }).data;
  const text = typeof data?.message === "string" ? data.message : null;
  return text ?? message.error.name;
}

function ThreadMessageRow({
  message,
  parts,
  onInterrupt,
}: {
  message: ThreadMessage;
  parts: readonly ThreadPart[];
  onInterrupt: () => void;
}): React.ReactElement {
  const error = messageError(message);

  if (message.role === "user") {
    const text = parts
      .filter((part): part is TextPart => part.type === "text" && part.synthetic !== true)
      .map((part) => part.text)
      .join("\n\n");
    const files = parts.filter((part): part is FilePart => part.type === "file");

    return (
      <UserMessage>
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
    );
  }

  const isCompleted = message.time.completed !== undefined;
  const blocks = segmentBlocks(parts);
  const rendered = blocks
    .map((block) => <BlockRow key={block.key} block={block} onInterrupt={onInterrupt} />)
    .filter((node) => node !== null);

  return (
    <div {...stylex.props(styles.assistantStack)}>
      {rendered.length === 0 && isCompleted && error === null ? (
        <AssistantText text="(empty response)" isStreaming={false} />
      ) : (
        rendered
      )}
      {error !== null ? (
        <NoticeRow severity="error" name="Assistant error" message={error} />
      ) : null}
    </div>
  );
}

// A user prompt's attachment: images render as a thumbnail (data:/file: urls both work in the
// desktop webview), everything else as a filename chip.
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
  if (url.startsWith("data:")) {
    return "attachment";
  }
  const trimmed = url.replace(/^file:\/\//, "").replace(/[\\/]+$/, "");
  const [last = trimmed] = trimmed.split(/[\\/]/).slice(-1);
  return last.length > 0 ? last : url;
}

// ── Block segmentation ───────────────────────────────────────────────────────────────────────
// The transcript's honest units. Consecutive reasoning parts are ONE thought; consecutive work
// parts (tool/subtask/file/patch/agent) are ONE work group. Text stays prose; retry/compaction
// pass through as their own rows; step-start/step-finish/snapshot are bookkeeping — the model
// and per-call token counts never render (the composer already shows the pinned preset).

type Block =
  | { readonly kind: "prose"; readonly key: string; readonly part: TextPart }
  | { readonly kind: "thinking"; readonly key: string; readonly parts: readonly ReasoningPart[] }
  | { readonly kind: "work"; readonly key: string; readonly parts: readonly ThreadPart[] }
  | { readonly kind: "notice"; readonly key: string; readonly part: ThreadPart };

function isWorkPart(part: ThreadPart): boolean {
  return (
    part.type === "tool" ||
    part.type === "subtask" ||
    part.type === "file" ||
    part.type === "patch" ||
    part.type === "agent"
  );
}

function segmentBlocks(parts: readonly ThreadPart[]): readonly Block[] {
  const blocks: Block[] = [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
        if (part.ignored === true || part.text.length === 0) {
          break;
        }
        blocks.push({ kind: "prose", key: part.id, part });
        break;
      case "reasoning": {
        const last = blocks[blocks.length - 1];
        if (last !== undefined && last.kind === "thinking") {
          blocks[blocks.length - 1] = { ...last, parts: [...last.parts, part] };
        } else {
          blocks.push({ kind: "thinking", key: part.id, parts: [part] });
        }
        break;
      }
      case "retry":
      case "compaction":
        blocks.push({ kind: "notice", key: part.id, part });
        break;
      case "step-start":
      case "step-finish":
      case "snapshot":
        break;
      default: {
        if (!isWorkPart(part)) {
          break;
        }
        const last = blocks[blocks.length - 1];
        if (last !== undefined && last.kind === "work") {
          blocks[blocks.length - 1] = { ...last, parts: [...last.parts, part] };
        } else {
          blocks.push({ kind: "work", key: part.id, parts: [part] });
        }
      }
    }
  }
  return blocks;
}

function BlockRow({
  block,
  onInterrupt,
}: {
  block: Block;
  onInterrupt: () => void;
}): React.ReactElement | null {
  switch (block.kind) {
    case "prose":
      return <AssistantText text={block.part.text} isStreaming={isPartActive(block.part)} />;
    case "thinking":
      return <ThinkingBlock parts={block.parts} />;
    case "work":
      return <WorkBlock parts={block.parts} onInterrupt={onInterrupt} />;
    case "notice":
      return <NoticePartRow part={block.part} />;
  }
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

// ── Thinking ─────────────────────────────────────────────────────────────────────────────────
// One thought = the whole reasoning run. Streaming shows the live dim prose with the caret;
// finished thought collapses to a "Thought for Ns" header (codex emits reasoning with empty or
// redacted text — an empty finished thought is a plain, non-disclosing header, never a blank
// prose block).

function ThinkingBlock({ parts }: { parts: readonly ReasoningPart[] }): React.ReactElement | null {
  const [isExpanded, setExpanded] = React.useState(false);
  const isStreaming = parts.some(isPartActive);
  const text = parts
    .map((part) => part.text)
    .filter((chunk) => chunk.length > 0)
    .join("\n\n");

  if (isStreaming) {
    return (
      <ReasoningBlock isStreaming label="Thinking">
        <Markdown text={text} isStreaming />
      </ReasoningBlock>
    );
  }

  const verb = thoughtVerb(parts);
  if (text.length === 0) {
    // Redacted/encrypted reasoning (codex): the duration is the only honest content.
    return (
      <WorkGroup>
        <WorkGroup.Header verb={verb} />
      </WorkGroup>
    );
  }

  return (
    <WorkGroup>
      <WorkGroup.Header
        verb={verb}
        isExpanded={isExpanded}
        onToggle={() => {
          setExpanded((current) => !current);
        }}
      />
      {isExpanded ? (
        <ReasoningBlock>
          <Markdown text={text} />
        </ReasoningBlock>
      ) : null}
    </WorkGroup>
  );
}

function thoughtVerb(parts: readonly ReasoningPart[]): string {
  let elapsedMs = 0;
  for (const part of parts) {
    if (part.time?.start !== undefined && part.time.end !== undefined) {
      elapsedMs += Math.max(0, part.time.end - part.time.start);
    }
  }
  const seconds = Math.round(elapsedMs / 1000);
  return seconds > 0 ? `Thought for ${String(seconds)}s` : "Thought";
}

// ── Work groups ──────────────────────────────────────────────────────────────────────────────

function WorkBlock({
  parts,
  onInterrupt,
}: {
  parts: readonly ThreadPart[];
  onInterrupt: () => void;
}): React.ReactElement | null {
  const [isExpanded, setExpanded] = React.useState(false);
  const isRunning = parts.some(isPartActive);
  const rows = parts
    .map((part) => (
      <WorkPartRow
        key={part.id}
        part={part}
        allowToolDisclosure={!isRunning || parts.length === 1}
      />
    ))
    .filter((node): node is React.ReactElement => node !== null);
  if (rows.length === 0) {
    return null;
  }

  const summary = summarizeWork(parts);

  // A single-step group IS its row — no summary header over one line (locked §5 groups exist
  // to compress runs, not to wrap every step in chrome).
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
          onStop={onInterrupt}
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

// The newest tool output in the run — the live group's mono tail.
function latestOutput(parts: readonly ThreadPart[]): string | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part !== undefined && part.type === "tool") {
      const output = toolOutput(part);
      if (output !== undefined && output.length > 0) {
        return output;
      }
    }
  }
  return undefined;
}

// Past-tense summary verbs per category, in the app's verb grammar; precedence favors the
// most consequential work in the run (edits beat reads).
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

function summarizeWork(parts: readonly ThreadPart[]): {
  readonly verb: string;
  readonly detail: string | undefined;
} {
  // A live run leads with what it is doing RIGHT NOW — present tense, current detail.
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
}: {
  part: ThreadPart;
  allowToolDisclosure: boolean;
}): React.ReactElement | null {
  switch (part.type) {
    case "tool":
      return <ToolMessage part={part} allowDisclosure={allowToolDisclosure} />;
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

function AssistantText({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}): React.ReactElement {
  return (
    <AssistantMessage isStreaming={isStreaming}>
      <Markdown
        text={text.length === 0 && !isStreaming ? "(empty response)" : text}
        isStreaming={isStreaming}
      />
    </AssistantMessage>
  );
}

function PlainText({
  text,
  fallback = "",
}: {
  text: string;
  fallback?: string;
}): React.ReactElement {
  const value = text.length === 0 ? fallback : text;
  return <span {...stylex.props(styles.preWrap)}>{value}</span>;
}

function PatchPartRow({ files }: { files: readonly string[] }): React.ReactElement {
  const detail =
    files.length === 0
      ? "No files"
      : `${String(files.length)} ${files.length === 1 ? "file" : "files"}`;
  return <ToolCallLine verb="Changed" detail={detail} />;
}

// The v2 core never titles sessions (runner/llm.ts TODO) — honk names a placeholder-titled
// thread from its first prompt line, exactly like the create path does.
const PLACEHOLDER_TITLE = /^(?:New session - \d{4}|Side Chat)$/;
const TITLE_MAX_LENGTH = 80;
const DIRECTORY_ACCESS_BUSY_MESSAGE =
  "Can't change folder access while the agent is working. Stop the run and try again.";
const CD_COMMAND = {
  name: "cd",
  description: "Allow access to an external directory",
  agent: null,
  model: null,
  template: "",
  subtask: false,
} as const;
const SIDE_CHAT_COMMANDS = [
  {
    name: "side",
    description: "Start a side chat",
    agent: null,
    model: null,
    template: "",
    subtask: false,
  },
  {
    name: "btw",
    description: "Start a side chat",
    agent: null,
    model: null,
    template: "",
    subtask: false,
  },
] as const;
const THREAD_COMMANDS = [CD_COMMAND] as const;
const THREAD_COMMANDS_WITH_SIDE_CHAT = [CD_COMMAND, ...SIDE_CHAT_COMMANDS] as const;

function titleFromPrompt(text: string): string {
  const [firstLine = ""] = text.split("\n");
  const trimmed = firstLine.trim();
  return trimmed.length > TITLE_MAX_LENGTH ? `${trimmed.slice(0, TITLE_MAX_LENGTH - 1)}…` : trimmed;
}

function ThreadComposer({
  threadId,
  isRunning,
  cwd,
  attachedDirectories,
  title,
  onCreateSideChat,
}: {
  threadId: string;
  isRunning: boolean;
  cwd: string;
  attachedDirectories: readonly string[];
  title: string;
  onCreateSideChat?: (prompt: string) => Promise<void>;
}): React.ReactElement {
  const mode = useThreadMode(threadId);
  const allSideChats = useWorkspaceWatchSelector(
    (snapshot) => snapshot.state?.sideChats ?? EMPTY_SIDE_CHATS,
  );
  const recentDirectories = useWorkspaceWatchSelector(
    (snapshot) => snapshot.state?.recentDirectories ?? EMPTY_DIRECTORIES,
  );
  const sideChats = allSideChats
    .filter((sideChat) => sideChat.parentThreadId === threadId)
    .map((sideChat) => ({ id: sideChat.id, title: sideChat.title }));
  const [hasText, setHasText] = React.useState(false);
  const [isSending, setSending] = React.useState(false);
  const [isDirectoryPickerOpen, setDirectoryPickerOpen] = React.useState(false);
  const [isUpdatingDirectories, setUpdatingDirectories] = React.useState(false);
  // The compact ↔ expanded-block flip: driven by the editor's wrap state (a reply that fits on one
  // line stays a single compact row; wrapping or a line break expands it, matching the old composer).
  const [expanded, setExpanded] = React.useState(false);
  const editorRef = React.useRef<PromptEditorHandle | null>(null);

  const reportDirectoryError = (error: unknown): void => {
    const message = errorMessage(error);
    toastActions.add({
      type: "error",
      title: "Folder access failed",
      description: message,
      copyableError: message,
      threadKey: threadId,
    });
  };

  const canChangeDirectories = (): boolean => {
    if (!isRunning) {
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

  const attachDirectory = (path: string): void => {
    if (!canChangeDirectories() || isUpdatingDirectories) {
      return;
    }
    const client = getBoundHonkClient();
    if (client === null) {
      reportDirectoryError(new Error("The sidecar connection is not ready yet."));
      return;
    }
    setUpdatingDirectories(true);
    void client.threads
      .attachDirectory(threadId, path)
      .then(() => {
        setDirectoryPickerOpen(false);
      })
      .catch(reportDirectoryError)
      .finally(() => {
        setUpdatingDirectories(false);
      });
  };

  const detachDirectory = (path: string): void => {
    if (!canChangeDirectories() || isUpdatingDirectories) {
      return;
    }
    const client = getBoundHonkClient();
    if (client === null) {
      reportDirectoryError(new Error("The sidecar connection is not ready yet."));
      return;
    }
    setUpdatingDirectories(true);
    void client.threads
      .detachDirectory(threadId, path)
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

  const handleSubmit = (payload: PromptSubmit): void => {
    const client = getBoundHonkClient();
    if (client === null) {
      toastActions.add({
        type: "error",
        title: "Not connected",
        description: "The sidecar connection is not ready yet.",
        threadKey: threadId,
      });
      return;
    }

    if (payload.command?.name === "cd") {
      if (payload.command.arguments.length === 0) {
        requestDirectoryPicker(true);
      } else {
        attachDirectory(payload.command.arguments);
      }
      return;
    }

    setSending(true);
    const isSideChatCommand =
      payload.command !== null &&
      (payload.command.name === "side" || payload.command.name === "btw") &&
      onCreateSideChat !== undefined;
    // Mode rides every prompt (soft); the model pin is resent by the seam (hard).
    const work = isSideChatCommand
      ? onCreateSideChat(payload.command?.arguments ?? "")
      : payload.command !== null
        ? client.threads.runCommand(threadId, {
            command: payload.command.name,
            arguments: payload.command.arguments,
            agent: modeAgentName(mode),
          })
        : client.threads.send(threadId, {
            messageId: newMessageId(),
            text: payload.text,
            agent: modeAgentName(mode),
            ...(payload.files.length > 0 ? { files: payload.files } : {}),
            ...(payload.sideChatIds.length > 0 ? { sideChatIds: payload.sideChatIds } : {}),
          });
    void work
      .then(() => {
        if (!isSideChatCommand && PLACEHOLDER_TITLE.test(title)) {
          const nextTitle = titleFromPrompt(payload.text);
          if (nextTitle.length > 0) {
            client.threads.setTitle(threadId, nextTitle).catch(() => {
              // Rename is cosmetic — a failure must never surface over a delivered prompt.
            });
          }
        }
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: isSideChatCommand
            ? "Side chat failed"
            : payload.command !== null
              ? "Command failed"
              : "Send failed",
          description: message,
          copyableError: message,
          threadKey: threadId,
        });
      })
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <form
      {...stylex.props(expanded ? styles.composerExpanded : styles.composerCollapsed)}
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
          modeActions.setThreadMode(threadId, nextModeId(mode));
        }
      }}
    >
      <PromptEditor
        placeholder="Reply…"
        ariaLabel="Reply"
        directory={cwd}
        localCommands={
          onCreateSideChat === undefined ? THREAD_COMMANDS : THREAD_COMMANDS_WITH_SIDE_CHAT
        }
        onCommandSelect={(name) => {
          if (name !== "cd") {
            return false;
          }
          requestDirectoryPicker(true);
          return true;
        }}
        sideChats={sideChats}
        onSubmit={handleSubmit}
        onHasTextChange={setHasText}
        onMultilineChange={setExpanded}
        containerStyle={expanded ? styles.editorContainerExpanded : styles.editorContainerCollapsed}
        editorStyle={expanded ? styles.editorExpanded : styles.editorCollapsed}
        placeholderStyle={expanded ? styles.placeholderExpanded : styles.placeholderCollapsed}
        handleRef={editorRef}
      />
      <div {...stylex.props(expanded ? styles.controlsExpanded : styles.controlsCollapsed)}>
        <ComposerAttachmentButton editorRef={editorRef} />
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
        <ModeControl
          value={mode}
          onValueChange={(id) => {
            modeActions.setThreadMode(threadId, id);
          }}
        />
        {expanded ? (
          <Text size="xs" tone="faint" xstyle={styles.composerHint}>
            {isRunning ? "The agent is working — a new prompt steers it." : ""}
          </Text>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          disabled={!hasText || isSending || isUpdatingDirectories}
        >
          Send
        </Button>
      </div>
    </form>
  );
}

function newMessageId(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { ThreadPage };
