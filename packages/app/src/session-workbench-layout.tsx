import * as stylex from "@stylexjs/stylex";
import { openCodeSessionRef } from "@honk/opencode";
import { Outlet, useParams } from "@tanstack/react-router";
import * as React from "react";

import { threadAgentName, threadBuildAgent } from "./modes";
import { openCodeSessionRefFromRouteParams } from "./opencode/tab-route";
import { latestSubmittedPlan } from "./thread/follow-up";
import { planExecutionProjection } from "./thread/plan-execution";
import { latestTodos } from "./tool-part-projection";
import { useSessionWatch } from "./use-sdk-watch";
import type { SessionWatchState } from "./watch-registry";
import { Workbench } from "./workbench";
import { useWorkbench } from "./workbench-controller";
import { workbenchWorkspaceKey, type ResolvedWorkbenchFrame } from "./workbench-frame";
import { useWorkbenchTabs } from "./workbench-tab-store";

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
  const plan = latestSubmittedPlan(state.app.parts);
  return Object.freeze({
    workspaceKey: workbenchWorkspaceKey(
      openCodeSessionRef(routeServer, routeSessionID),
      state.app.summary.location,
    ),
    sessionRef: openCodeSessionRef(routeServer, routeSessionID),
    directory: state.app.cwd,
    isThreadRunning: state.activity !== "idle",
    buildAgent: threadAgentName(
      "build",
      threadBuildAgent(state.app.messages, state.app.summary.agent),
    ),
    plan,
    planExecution:
      plan === null
        ? null
        : planExecutionProjection({ ...state.app, activity: state.activity }, plan),
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

  const frame = currentFrame ?? retainedFrame;
  // The shell can be expanded before a tool is chosen, so this gate intentionally does not depend
  // on a live active tab.
  const isPanelOpen = useWorkbenchTabs(frame?.workspaceKey ?? "").expanded;
  const isMaximized = useWorkbench((current) => current.isMaximized) && isPanelOpen;
  return (
    <div {...stylex.props(styles.frame)}>
      {/* Unmounting beats squeezing to zero: the transcript retains its scroll offset and
          measurement cache on unmount, and a zero-width column would re-wrap every row. */}
      {isMaximized ? null : <Outlet />}
      {frame === null ? null : (
        <Workbench
          key={frame.workspaceKey}
          workspaceKey={frame.workspaceKey}
          routeRef={routeRef}
          isRouteReady={currentFrame !== null}
          surfaceSessionRef={frame.sessionRef}
          directory={frame.directory}
          isThreadRunning={frame.isThreadRunning}
          buildAgent={frame.buildAgent}
          plan={frame.plan}
          planExecution={frame.planExecution}
          tasks={frame.tasks}
        />
      )}
    </div>
  );
}

export { SessionWorkbenchLayout };
