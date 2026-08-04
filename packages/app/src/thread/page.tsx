import { openCodeSessionKey } from "@honk/opencode";
import { Text } from "@honk/ui";
import { useParams } from "@tanstack/react-router";
import * as React from "react";

import { openCodeSessionRefFromRouteParams } from "../opencode/tab-route";
import { useSessionWatch } from "../use-sdk-watch";
import { workbenchActions } from "../workbench-controller";
import { ThreadPageCenter, ThreadPageFrame, ThreadPageLoading } from "./page-layout";
import { ThreadSurface } from "./surface";
import { threadViewState } from "./view-state";

export function ThreadPage(): React.ReactElement {
  // Match-scoped params stay coherent while this tree renders its final transition frame;
  // the global location does not.
  const params = useParams({ from: "/server/$serverKey/session/$sessionId" });
  const sessionRef = openCodeSessionRefFromRouteParams(params.serverKey, params.sessionId);
  if (sessionRef === null) {
    throw new Error("The session route is invalid.");
  }

  const threadId = sessionRef.sessionID;
  const watch = useSessionWatch(sessionRef);
  const state = threadViewState(watch.state);
  const isConnecting = watch.status === "connecting" && state === null;
  const isDisconnected = watch.status === "closed" || watch.status === "unauthorized";

  if (isConnecting) {
    return <ThreadPageLoading />;
  }
  if (state === null) {
    return (
      <ThreadPageFrame>
        <ThreadPageCenter>
          <Text as="p" size="lg" tone="muted" weight="regular">
            Thread unavailable
          </Text>
          <Text as="p" size="xs" tone="faint" family="mono">
            {threadId}
          </Text>
        </ThreadPageCenter>
      </ThreadPageFrame>
    );
  }

  return (
    <ThreadPageFrame panel>
      <ThreadSurface
        key={openCodeSessionKey(sessionRef)}
        sessionRef={sessionRef}
        state={state}
        watchStatus={watch.status}
        showHeader
        onReviewChanges={() => {
          workbenchActions.setTab("changes");
        }}
        onOpenFile={(path) => {
          workbenchActions.openFile(path);
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
    </ThreadPageFrame>
  );
}
