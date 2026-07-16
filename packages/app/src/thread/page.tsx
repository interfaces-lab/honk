import { openCodeSessionKey } from "@honk/opencode";
import { Spinner, Text } from "@honk/ui";
import { spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useLocation } from "@tanstack/react-router";
import * as React from "react";

import { parseOpenCodeTabHref } from "../opencode/tab-route";
import { useSessionWatch } from "../use-sdk-watch";
import { workbenchActions } from "../workbench-controller";
import { ThreadSurface } from "./surface";
import { threadViewState } from "./view-state";

const styles = stylex.create({
  page: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    width: "100%",
    display: "flex",
    flexDirection: "row",
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
});

export function ThreadPage(): React.ReactElement {
  const location = useLocation();
  const route = parseOpenCodeTabHref(location.href);
  if (route?.type !== "session") {
    throw new Error("The session route is invalid.");
  }

  const threadId = route.ref.sessionID;
  const watch = useSessionWatch(route.ref);
  const state = threadViewState(watch.state);
  const isConnecting = watch.status === "connecting" && state === null;
  const isDisconnected = watch.status === "closed" || watch.status === "unauthorized";

  if (isConnecting) {
    return (
      <div {...stylex.props(styles.page)}>
        <div {...stylex.props(styles.center)}>
          <Spinner label="Connecting to thread" tone="muted" />
        </div>
      </div>
    );
  }
  if (state === null) {
    return (
      <div {...stylex.props(styles.page)}>
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

  return (
    <div {...stylex.props(styles.page)}>
      <ThreadSurface
        key={openCodeSessionKey(route.ref)}
        sessionRef={route.ref}
        state={state}
        watchStatus={watch.status}
        showHeader
        onReviewChanges={() => {
          workbenchActions.setTab("changes");
        }}
        onViewPlan={() => {
          workbenchActions.setTab("tasks");
        }}
        disconnectedMessage={
          isDisconnected
            ? watch.status === "unauthorized"
              ? "Thread watch unauthorized."
              : "Thread watch closed."
            : null
        }
      />
    </div>
  );
}
