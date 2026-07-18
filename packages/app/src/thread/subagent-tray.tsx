import * as stylex from "@stylexjs/stylex";
import { openCodeSessionRef } from "@honk/opencode";
import { Icon, IconButton, Popover, Spinner, Text } from "@honk/ui";
import { IconArrowUp, IconCrossSmall, IconExpand45 } from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { errorMessage } from "../error-message";
import type { AppChildSessionSummary, ThreadViewState } from "../open-code-view";
import { sendSessionPrompt } from "../session-prompt";
import { actions as toastActions } from "../toast-store";
import { useSessionWatch } from "../use-sdk-watch";
import type { AdapterWatchStatus } from "../watch-registry";
import { useThreadRuntime } from "./runtime";
import { taskToolRegionID } from "./subagent-session";
import { ThreadTranscriptPreview } from "./transcript";
import { threadViewState } from "./view-state";

// These dimensions come from the prior main-branch tray, but the renderer stays on this
// branch's canonical transcript model and selected session watch.
const SUBAGENT_TRAY_MAX_HEIGHT = "min(70dvh, calc(100dvh - 12rem))";
const SUBAGENT_TRAY_MIN_HEIGHT = "220px";
const SUBAGENT_TRAY_EMPTY_MIN_HEIGHT = "160px";
const SUBAGENT_TRAY_SIDE_OFFSET_PX = 8;
const SUBAGENT_FOLLOW_UP_MAX_ROWS = 6;
const SUBAGENT_FOLLOW_UP_MAX_HEIGHT = `calc(${fontVars["--honk-leading-body"]} * ${String(SUBAGENT_FOLLOW_UP_MAX_ROWS)})`;
const SUBAGENT_TRAY_HEADER_DIVIDER = `inset 0 -1px 0 ${colorVars["--honk-color-stroke-tertiary"]}`;
const SUBAGENT_TRAY_FOOTER_DIVIDER = `inset 0 1px 0 ${colorVars["--honk-color-stroke-tertiary"]}`;
const SUBAGENT_FOLLOW_UP_RING = `inset 0 0 0 1px ${colorVars["--honk-color-stroke-tertiary"]}`;
const SUBAGENT_TRAY_COLLISION_AVOIDANCE = {
  side: "shift",
  align: "shift",
  fallbackAxisSide: "none",
} as const;

type FollowUpDraft = {
  readonly partID: string;
  readonly text: string;
  readonly rows: number;
};

type SubagentPanelProps = {
  readonly mission: string;
  readonly model: string | null;
  readonly state: ThreadViewState | null;
  readonly watchStatus: AdapterWatchStatus;
  readonly disconnected: string | null;
  readonly restorationKey: string;
  readonly scrollElementRef: React.RefObject<HTMLDivElement | null>;
  readonly isFullscreen: boolean;
  readonly followUp: string;
  readonly followUpRows: number;
  readonly onToggleFullscreen: () => void;
  readonly onClose: () => void;
  readonly onFollowUpChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  readonly onFollowUpSubmit: React.FormEventHandler<HTMLFormElement>;
};

const styles = stylex.create({
  panel: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: elevationVars["--honk-elevation-floating"],
    pointerEvents: "auto",
  },
  fullscreenHost: {
    position: "absolute",
    zIndex: zVars["--honk-z-popover"],
    inset: spaceVars["--honk-space-gutter"],
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    pointerEvents: "auto",
  },
  header: {
    flexShrink: 0,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    boxShadow: SUBAGENT_TRAY_HEADER_DIVIDER,
  },
  heading: {
    flexGrow: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "baseline",
    gap: spaceVars["--honk-space-gutter"],
  },
  body: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: spaceVars["--honk-space-panel-pad"],
  },
  center: {
    minHeight: SUBAGENT_TRAY_EMPTY_MIN_HEIGHT,
    display: "grid",
    placeItems: "center",
  },
  disconnected: {
    marginBottom: spaceVars["--honk-space-gutter"],
  },
  footer: {
    flexShrink: 0,
    padding: spaceVars["--honk-space-panel-pad"],
    boxShadow: SUBAGENT_TRAY_FOOTER_DIVIDER,
  },
  followUpForm: {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "flex-end",
    gap: controlVars["--honk-control-gap"],
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    boxShadow: SUBAGENT_FOLLOW_UP_RING,
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
  },
  textarea: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    minHeight: fontVars["--honk-leading-body"],
    maxHeight: SUBAGENT_FOLLOW_UP_MAX_HEIGHT,
    boxSizing: "border-box",
    display: "block",
    overflowY: "auto",
    resize: "none",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    "::placeholder": {
      color: colorVars["--honk-color-text-muted"],
    },
  },
});

export function SubagentTray({
  partID,
  child,
  mission,
  model,
  anchorRef,
  onMinimize,
}: {
  readonly partID: string;
  readonly child: AppChildSessionSummary;
  readonly mission: string;
  readonly model: string | null;
  readonly anchorRef: React.RefObject<HTMLFormElement | null>;
  readonly onMinimize: () => void;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const watch = useSessionWatch(openCodeSessionRef(child.server, child.id));
  const state = threadViewState(watch.state);
  const disconnected = disconnectedLabel(watch.status, state !== null);
  const scrollElementRef = React.useRef<HTMLDivElement | null>(null);
  const [fullscreenPartID, setFullscreenPartID] = React.useState<string | null>(null);
  const [followUpDraft, setFollowUpDraft] = React.useState<FollowUpDraft>(() => ({
    partID,
    text: "",
    rows: 1,
  }));
  const isFullscreen = fullscreenPartID === partID;
  const followUp = followUpDraft.partID === partID ? followUpDraft.text : "";
  const followUpRows = followUpDraft.partID === partID ? followUpDraft.rows : 1;
  const restorationKey = `subagent-tray:${child.server}:${child.id}`;

  function toggleFullscreen(): void {
    setFullscreenPartID((current) => (current === partID ? null : partID));
  }

  // Stable so the fullscreen host's window keydown listener survives re-renders.
  const exitFullscreen = React.useCallback(() => {
    setFullscreenPartID(null);
  }, []);

  function closeDockedTray(open: boolean): void {
    if (!open) onMinimize();
  }

  function updateFollowUp(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    setFollowUpDraft({
      partID,
      text: event.currentTarget.value,
      rows: followUpRowCount(event.currentTarget),
    });
  }

  function submitFollowUp(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = followUp.trim();
    if (text.length === 0) return;
    const client = runtime.client;
    if (client === null) {
      reportFollowUpError(new Error("The OpenCode connection is not ready yet."), runtime.tabKey);
      return;
    }
    const submittedDraft = followUp;
    void sendSessionPrompt(client, child.id, { text })
      .then(() => {
        setFollowUpDraft((current) =>
          current.partID === partID && current.text === submittedDraft
            ? { partID, text: "", rows: 1 }
            : current,
        );
      })
      .catch((error: unknown) => {
        reportFollowUpError(error, runtime.tabKey);
      });
  }

  const panel = (
    <SubagentPanel
      mission={mission}
      model={model}
      state={state}
      watchStatus={watch.status}
      disconnected={disconnected}
      restorationKey={restorationKey}
      scrollElementRef={scrollElementRef}
      isFullscreen={isFullscreen}
      followUp={followUp}
      followUpRows={followUpRows}
      onToggleFullscreen={toggleFullscreen}
      onClose={onMinimize}
      onFollowUpChange={updateFollowUp}
      onFollowUpSubmit={submitFollowUp}
    />
  );

  if (isFullscreen) {
    return (
      <FullscreenSubagentHost partID={partID} mission={mission} onExit={exitFullscreen}>
        {panel}
      </FullscreenSubagentHost>
    );
  }

  return (
    <DockedSubagentHost
      partID={partID}
      mission={mission}
      anchorRef={anchorRef}
      onOpenChange={closeDockedTray}
    >
      {panel}
    </DockedSubagentHost>
  );
}

function SubagentPanel({
  mission,
  model,
  state,
  watchStatus,
  disconnected,
  restorationKey,
  scrollElementRef,
  isFullscreen,
  followUp,
  followUpRows,
  onToggleFullscreen,
  onClose,
  onFollowUpChange,
  onFollowUpSubmit,
}: SubagentPanelProps): React.ReactElement {
  const fullscreenLabel = isFullscreen ? "Exit full screen" : "Expand work details";

  return (
    <div {...stylex.props(styles.panel)}>
      <header {...stylex.props(styles.header)}>
        <div
          {...stylex.props(styles.heading)}
          title={`${mission}${model === null ? "" : ` · ${model}`}`}
        >
          <Text as="div" size="sm" weight="regular" truncate>
            {mission}
          </Text>
          {model === null ? null : (
            <Text size="sm" tone="muted" weight="regular" truncate>
              {model}
            </Text>
          )}
        </div>
        <IconButton
          size="sm"
          variant="quiet"
          aria-label={fullscreenLabel}
          aria-pressed={isFullscreen}
          title={fullscreenLabel}
          autoFocus={isFullscreen}
          onClick={onToggleFullscreen}
        >
          <Icon icon={IconExpand45} size="xs" tone="muted" />
        </IconButton>
        <IconButton
          size="sm"
          variant="quiet"
          aria-label="Close work details"
          title="Close work details"
          onClick={onClose}
        >
          <Icon icon={IconCrossSmall} size="xs" tone="muted" />
        </IconButton>
      </header>
      <div ref={scrollElementRef} data-honk-scrollport="" {...stylex.props(styles.body)}>
        {disconnected === null ? null : (
          <div {...stylex.props(styles.disconnected)}>
            <Text as="p" size="xs" tone="faint">
              {disconnected}
            </Text>
          </div>
        )}
        {state === null ? (
          <div {...stylex.props(styles.center)}>
            {watchStatus === "connecting" || watchStatus === "reconnecting" ? (
              <Spinner label="Connecting to work details" tone="muted" />
            ) : (
              <Text as="p" size="sm" tone="muted">
                Work details unavailable
              </Text>
            )}
          </div>
        ) : (
          <ThreadTranscriptPreview
            state={state}
            scrollElementRef={scrollElementRef}
            restorationKey={restorationKey}
          />
        )}
      </div>
      <footer {...stylex.props(styles.footer)}>
        <form
          aria-label="Send follow-up with subagent"
          {...stylex.props(styles.followUpForm)}
          onSubmit={onFollowUpSubmit}
        >
          <textarea
            rows={followUpRows}
            value={followUp}
            placeholder="Send follow-up with subagent"
            aria-label="Follow-up message"
            {...stylex.props(styles.textarea)}
            onChange={onFollowUpChange}
            onKeyDown={submitFollowUpOnEnter}
          />
          <IconButton
            type="submit"
            size="sm"
            variant="quiet"
            aria-label="Send follow-up"
            title="Send follow-up"
            disabled={followUp.trim().length === 0}
          >
            <Icon icon={IconArrowUp} size="xs" tone="muted" />
          </IconButton>
        </form>
      </footer>
    </div>
  );
}

function DockedSubagentHost({
  partID,
  mission,
  anchorRef,
  onOpenChange,
  children,
}: {
  readonly partID: string;
  readonly mission: string;
  readonly anchorRef: React.RefObject<HTMLFormElement | null>;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <Popover.Root modal={false} open onOpenChange={onOpenChange}>
      <Popover.Popup
        id={taskToolRegionID(partID)}
        aria-label={`Work details: ${mission}`}
        anchor={anchorRef}
        positionMethod="fixed"
        side="top"
        align="center"
        sideOffset={SUBAGENT_TRAY_SIDE_OFFSET_PX}
        collisionAvoidance={SUBAGENT_TRAY_COLLISION_AVOIDANCE}
        initialFocus={false}
        finalFocus={false}
        style={{
          width: "var(--anchor-width)",
          minWidth: 0,
          minHeight: SUBAGENT_TRAY_MIN_HEIGHT,
          maxHeight: SUBAGENT_TRAY_MAX_HEIGHT,
          display: "flex",
          flexDirection: "column",
          overflow: "visible",
          padding: 0,
          borderRadius: radiusVars["--honk-radius-panel"],
          backgroundColor: "transparent",
          boxShadow: "none",
          pointerEvents: "auto",
        }}
      >
        {children}
      </Popover.Popup>
    </Popover.Root>
  );
}

function FullscreenSubagentHost({
  partID,
  mission,
  onExit,
  children,
}: {
  readonly partID: string;
  readonly mission: string;
  readonly onExit: () => void;
  readonly children: React.ReactNode;
}): React.ReactElement {
  // Focus can land on document.body (clicks on non-focusable transcript text), so Escape
  // must be caught at the window; defaultPrevented lets menus and dialogs consume it first.
  React.useEffect(() => {
    function exitOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onExit();
    }
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      window.removeEventListener("keydown", exitOnEscape);
    };
  }, [onExit]);

  return (
    <section
      id={taskToolRegionID(partID)}
      aria-label={`Work details: ${mission}`}
      {...stylex.props(styles.fullscreenHost)}
    >
      {children}
    </section>
  );
}

function followUpRowCount(textarea: HTMLTextAreaElement): number {
  const renderedRows = textarea.rows;
  textarea.rows = 1;
  const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight);
  const measuredRows =
    lineHeight > 0 ? Math.ceil(textarea.scrollHeight / lineHeight) : renderedRows;
  textarea.rows = renderedRows;
  return Math.max(1, Math.min(SUBAGENT_FOLLOW_UP_MAX_ROWS, measuredRows));
}

function submitFollowUpOnEnter(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.defaultPrevented ||
    event.nativeEvent.isComposing
  ) {
    return;
  }
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function reportFollowUpError(error: unknown, threadKey: string): void {
  const message = errorMessage(error);
  toastActions.add({
    type: "error",
    title: "Send follow-up failed",
    description: message,
    copyableError: message,
    threadKey,
  });
}

function disconnectedLabel(status: AdapterWatchStatus, hasCachedState: boolean): string | null {
  if (!hasCachedState) return null;
  if (status === "unauthorized") return "Live updates are unauthorized.";
  if (status === "closed") return "Live updates are closed.";
  if (status === "reconnecting") return "Reconnecting live updates…";
  return null;
}
