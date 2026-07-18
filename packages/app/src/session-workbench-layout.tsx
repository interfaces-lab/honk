import * as stylex from "@stylexjs/stylex";
import { openCodeSessionRef } from "@honk/opencode";
import { Outlet, useParams } from "@tanstack/react-router";
import * as React from "react";

import { openCodeSessionRefFromRouteParams } from "./opencode/tab-route";
import { latestSubmittedPlan } from "./thread/follow-up";
import { latestTodos } from "./tool-part-projection";
import { useSessionWatch } from "./use-sdk-watch";
import type { SessionWatchState } from "./watch-registry";
import { Workbench } from "./workbench";
import {
  retainResolvedWorkbenchFrame,
  workbenchWorkspaceKey,
  type ResolvedWorkbenchFrame,
} from "./workbench-frame";

const styles = stylex.create({
  frame: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    width: "100%",
    display: "flex",
    flexDirection: "row",
  },
});

function resolveWorkbenchFrame(
  routeServer: ReturnType<typeof openCodeSessionRef>["server"],
  routeSessionID: string,
  state: SessionWatchState | null,
): ResolvedWorkbenchFrame | null {
  if (state === null) return null;
  return Object.freeze({
    workspaceKey: workbenchWorkspaceKey(
      openCodeSessionRef(routeServer, routeSessionID),
      state.app.summary.location,
    ),
    sessionRef: openCodeSessionRef(routeServer, routeSessionID),
    directory: state.app.cwd,
    isThreadRunning: state.app.summary.status === "running",
    plan: latestSubmittedPlan(state.app.parts)?.plan ?? null,
    tasks: latestTodos(state.app.parts),
  });
}

function SessionWorkbenchLayout(): React.ReactElement {
  const params = useParams({ from: "/server/$serverKey/session/$sessionId" });
  const routeRef = openCodeSessionRefFromRouteParams(params.serverKey, params.sessionId);
  if (routeRef === null) {
    throw new Error("The session workbench route is invalid.");
  }
  const routeServer = routeRef.server;
  const routeSessionID = routeRef.sessionID;
  const watch = useSessionWatch(routeRef);
  const currentFrame = resolveWorkbenchFrame(routeServer, routeSessionID, watch.state);
  const [retainedFrame, setRetainedFrame] = React.useState(currentFrame);

  React.useLayoutEffect(() => {
    const next = resolveWorkbenchFrame(routeServer, routeSessionID, watch.state);
    if (next !== null) setRetainedFrame(next);
  }, [routeServer, routeSessionID, watch.state]);

  const frame = retainResolvedWorkbenchFrame(currentFrame, retainedFrame);
  return (
    <div {...stylex.props(styles.frame)}>
      <Outlet />
      {frame === null ? null : (
        <Workbench
          key={frame.workspaceKey}
          workspaceKey={frame.workspaceKey}
          routeRef={routeRef}
          isRouteReady={currentFrame !== null}
          surfaceSessionRef={frame.sessionRef}
          directory={frame.directory}
          isThreadRunning={frame.isThreadRunning}
          plan={frame.plan}
          tasks={frame.tasks}
        />
      )}
    </div>
  );
}

export { SessionWorkbenchLayout };
