import * as stylex from "@stylexjs/stylex";
import { openCodeSessionRef } from "@honk/opencode";
import { honkPairingForSidekick } from "@honk/opencode/pairing";
import { Icon, IconButton, Popover, Spinner, Text } from "@honk/ui";
import { IconMinusSmall } from "@honk/ui/icons";
import {
  colorVars,
  elevationVars,
  radiusVars,
  spaceVars,
  workbenchSurfaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { AppChildSessionSummary } from "../open-code-view";
import { useSessionWatch } from "../use-sdk-watch";
import type { AdapterWatchStatus } from "../watch-registry";
import { taskToolRegionID } from "./subagent-session";
import { ThreadTranscriptPreview } from "./transcript";
import { threadViewState } from "./view-state";

// These dimensions come from the prior main-branch tray, but the renderer stays on this
// branch's canonical transcript model and selected session watch.
const SUBAGENT_TRAY_MAX_HEIGHT = "min(70dvh, calc(100dvh - 12rem))";
const SUBAGENT_TRAY_MIN_HEIGHT = "220px";
const SUBAGENT_TRAY_BLUR = "10px";
const SUBAGENT_TRAY_EMPTY_MIN_HEIGHT = "160px";
const SUBAGENT_TRAY_SIDE_OFFSET_PX = 8;
const SUBAGENT_TRAY_HEADER_DIVIDER = `inset 0 -1px 0 ${colorVars["--honk-color-stroke-tertiary"]}`;
const SUBAGENT_TRAY_COLLISION_AVOIDANCE = {
  side: "shift",
  align: "shift",
  fallbackAxisSide: "none",
} as const;

const styles = stylex.create({
  anchor: {
    position: "absolute",
    insetInline: 0,
    insetBlockStart: 0,
    width: "100%",
    height: 0,
    pointerEvents: "none",
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
});

export function SubagentTray({
  partID,
  child,
  onMinimize,
}: {
  readonly partID: string;
  readonly child: AppChildSessionSummary;
  readonly onMinimize: () => void;
}): React.ReactElement {
  const watch = useSessionWatch(openCodeSessionRef(child.server, child.id));
  const state = threadViewState(watch.state);
  const role = sidekickRole(child.agent);
  const disconnected = disconnectedLabel(watch.status, state !== null);
  const scrollElementRef = React.useRef<HTMLDivElement | null>(null);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <>
      <div ref={anchorRef} aria-hidden="true" {...stylex.props(styles.anchor)} />
      <Popover.Root
        modal={false}
        open
        onOpenChange={(open) => {
          if (!open) onMinimize();
        }}
      >
        <Popover.Popup
          id={taskToolRegionID(partID)}
          aria-label={`Current subagent transcript: ${child.title}`}
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
            overflow: "hidden",
            padding: 0,
            borderRadius: radiusVars["--honk-radius-window"],
            backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
            boxShadow: elevationVars["--honk-elevation-floating"],
            backdropFilter: `blur(${SUBAGENT_TRAY_BLUR})`,
            pointerEvents: "auto",
          }}
        >
          <header {...stylex.props(styles.header)}>
            <div {...stylex.props(styles.heading)} title={`${role} ${child.title}`}>
              <Text size="sm" tone="muted" weight="medium">
                {role}
              </Text>
              <Text as="div" size="sm" weight="medium" truncate>
                {child.title}
              </Text>
            </div>
            <IconButton
              size="sm"
              variant="quiet"
              aria-label="Minimize subagent preview"
              title="Minimize subagent preview"
              onClick={onMinimize}
            >
              <Icon icon={IconMinusSmall} size="xs" tone="muted" />
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
                {watch.status === "connecting" || watch.status === "reconnecting" ? (
                  <Spinner label="Connecting to subagent" tone="muted" />
                ) : (
                  <Text as="p" size="sm" tone="muted">
                    Subagent transcript unavailable
                  </Text>
                )}
              </div>
            ) : (
              <ThreadTranscriptPreview
                state={state}
                scrollElementRef={scrollElementRef}
              />
            )}
          </div>
        </Popover.Popup>
      </Popover.Root>
    </>
  );
}

function sidekickRole(agent: string | null): string {
  const pairing = honkPairingForSidekick(agent ?? undefined);
  return pairing === undefined
    ? (agent ?? "Subagent")
    : `Sidekick · ${pairing.stop[0]?.toUpperCase() ?? ""}${pairing.stop.slice(1)}`;
}

function disconnectedLabel(status: AdapterWatchStatus, hasCachedState: boolean): string | null {
  if (!hasCachedState) return null;
  if (status === "unauthorized") return "Live updates are unauthorized.";
  if (status === "closed") return "Live updates are closed.";
  if (status === "reconnecting") return "Reconnecting live updates…";
  return null;
}
