import * as stylex from "@stylexjs/stylex";
import { openCodeSessionKey, openCodeSessionRef, type OpenCodeSessionRef } from "@honk/opencode";
import { Spinner, Text } from "@honk/ui";
import { spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { ThreadSurface } from "./thread/surface";
import { threadViewState } from "./thread/view-state";
import { useSessionWatch } from "./use-sdk-watch";

const styles = stylex.create({
  host: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  hidden: {
    display: "none",
  },
  state: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
});

type WorkbenchSideChatSurfaceProps = {
  readonly parentRef: OpenCodeSessionRef;
  readonly sessionID: string;
  readonly isVisible: boolean;
  readonly onReviewChanges: () => void;
  readonly onViewPlan: () => void;
};

function WorkbenchSideChatSurface({
  parentRef,
  sessionID,
  isVisible,
  onReviewChanges,
  onViewPlan,
}: WorkbenchSideChatSurfaceProps): React.ReactElement {
  const sessionRef = openCodeSessionRef(parentRef.server, sessionID);
  const watch = useSessionWatch(sessionRef);
  const state = threadViewState(watch.state);
  const isConnecting = watch.status === "connecting" && state === null;

  return (
    <div {...stylex.props(styles.host, !isVisible && styles.hidden)}>
      {isConnecting ? (
        <div {...stylex.props(styles.state)}>
          <Spinner label="Connecting to Side Chat" tone="muted" />
        </div>
      ) : state === null ? (
        <div {...stylex.props(styles.state)}>
          <Text as="p" size="sm" tone="muted">
            Side Chat unavailable
          </Text>
          <Text as="p" size="xs" tone="faint" family="mono">
            {sessionID}
          </Text>
        </div>
      ) : (
        <ThreadSurface
          key={openCodeSessionKey(sessionRef)}
          sessionRef={sessionRef}
          state={state}
          watchStatus={watch.status}
          onReviewChanges={onReviewChanges}
          onViewPlan={onViewPlan}
          disconnectedMessage={
            watch.status === "unauthorized"
              ? "Side Chat watch unauthorized."
              : watch.status === "closed"
                ? "Side Chat watch closed."
                : null
          }
        />
      )}
    </div>
  );
}

export { WorkbenchSideChatSurface };
export type { WorkbenchSideChatSurfaceProps };
