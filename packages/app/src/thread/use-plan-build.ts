import { openCodeSessionKey, type OpenCodeSessionRef } from "@honk/opencode";
import { useState } from "react";

import { errorMessage } from "../error-message";
import { actions as modeActions, modeFromAgent, useThreadMode } from "../modes";
import { sendSessionPrompt } from "../session-prompt";
import { actions as toastActions } from "../toast-store";
import { useSessionWatchSelector } from "../use-sdk-watch";
import { getOpenCodeClient } from "../watch-registry";
import type { SubmittedPlanRecord } from "./follow-up";
import {
  planExecutionMetadata,
  planExecutionPrompt,
  remainingPlanStepIDs,
  type PlanExecutionProjection,
} from "./plan-execution";

const admittedPlanBuilds = new Map<string, number>();

type PlanBuildController = {
  readonly build: () => void;
  readonly canBuild: boolean;
  readonly isStarting: boolean;
};

function usePlanBuild({
  agent,
  execution,
  plan,
  sessionRef,
}: {
  readonly agent: string;
  readonly execution: PlanExecutionProjection;
  readonly plan: SubmittedPlanRecord;
  readonly sessionRef: OpenCodeSessionRef;
}): PlanBuildController {
  const threadKey = openCodeSessionKey(sessionRef);
  const coreMode = useSessionWatchSelector(sessionRef, (snapshot) =>
    modeFromAgent(snapshot.state?.app.summary.agent),
  );
  const mode = useThreadMode(threadKey, coreMode);
  const [startingAttempt, setStartingAttempt] = useState<number | null>(null);
  const assignedStepIDs = remainingPlanStepIDs(plan, execution);
  const canBuild =
    assignedStepIDs.length > 0 &&
    execution.status !== "active" &&
    execution.status !== "complete" &&
    getOpenCodeClient(sessionRef.server) !== null;
  const isStarting = startingAttempt === execution.attemptCount;

  const build = (): void => {
    const client = getOpenCodeClient(sessionRef.server);
    const admissionKey = `${threadKey}:${plan.key}`;
    if (
      client === null ||
      !canBuild ||
      isStarting ||
      admittedPlanBuilds.get(admissionKey) === execution.attemptCount
    ) {
      return;
    }

    const previousMode = mode;
    admittedPlanBuilds.set(admissionKey, execution.attemptCount);
    setStartingAttempt(execution.attemptCount);
    modeActions.setThreadMode(threadKey, "build");
    void sendSessionPrompt(client, sessionRef.sessionID, {
      text: planExecutionPrompt(plan, assignedStepIDs),
      agent,
      metadata: planExecutionMetadata(plan, assignedStepIDs),
      synthetic: true,
    })
      .then(() => {
        if (admittedPlanBuilds.get(admissionKey) === execution.attemptCount) {
          admittedPlanBuilds.delete(admissionKey);
        }
      })
      .catch((error: unknown) => {
        if (admittedPlanBuilds.get(admissionKey) === execution.attemptCount) {
          admittedPlanBuilds.delete(admissionKey);
        }
        setStartingAttempt((current) => (current === execution.attemptCount ? null : current));
        modeActions.setThreadMode(threadKey, previousMode);
        void client.sessions.switchAgent(sessionRef, agent).catch(() => undefined);
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Build failed",
          description: message,
          copyableError: message,
          threadKey,
        });
      });
  };

  return { build, canBuild, isStarting };
}

export { usePlanBuild };
export type { PlanBuildController };
