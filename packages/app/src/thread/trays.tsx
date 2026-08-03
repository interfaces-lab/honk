import { create, props } from "@stylexjs/stylex";
import { Button, Icon, IconButton, Text, Tray } from "@honk/ui";
import { IconCrossSmall } from "@honk/ui/icons";
import { controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import { Fragment, useRef, useState, type ReactElement, type ReactNode } from "react";

import { errorMessage } from "../error-message";
import {
  actions as modeActions,
  modeAgentName,
  modeFromAgent,
  threadAgentName,
  threadBuildAgent,
  useThreadMode,
} from "../modes";
import type { ThreadViewState } from "../open-code-view";
import { sendSessionPrompt } from "../session-prompt";
import { actions as toastActions } from "../toast-store";
import { debugBuildPrompt, type SubmittedPlanRecord } from "./follow-up";
import { PlanBuildControls } from "./plan-build-controls";
import type { PlanExecutionProjection } from "./plan-execution";
import { useThreadRuntime } from "./runtime";
import { SessionRequestTray } from "./session-requests";
import { threadTrayState } from "./tray-state";
import { usePlanBuild } from "./use-plan-build";

const styles = create({
  planHeader: {
    minWidth: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  planDescription: {
    paddingInline: spaceVars["--honk-space-panel-pad"],
    paddingBlockEnd: spaceVars["--honk-space-gutter"],
  },
  diagnosis: {
    paddingInline: spaceVars["--honk-space-panel-pad"],
    paddingBlockEnd: spaceVars["--honk-space-gutter"],
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  diagnosisSection: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-menu-pad"],
  },
  diagnosisList: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-menu-pad"],
    margin: 0,
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
  },
});

function ThreadTray({
  threadId,
  state,
  onViewPlan,
  renderStandalone,
}: {
  readonly threadId: string;
  readonly state: ThreadViewState;
  readonly onViewPlan?: () => void;
  readonly renderStandalone?: (hasWeightedTray: boolean) => ReactNode;
}): ReactElement | null {
  const runtime = useThreadRuntime();
  const mode = useThreadMode(runtime.tabKey, modeFromAgent(state.summary.agent));
  const [dismissedPlanKey, setDismissedPlanKey] = useState<string | null>(null);
  const [dismissedDebugKey, setDismissedDebugKey] = useState<string | null>(null);
  const pendingDebugActionRef = useRef<"apply" | "continue" | null>(null);
  const [pendingDebugAction, setPendingDebugAction] = useState<"apply" | "continue" | null>(null);
  const tray = threadTrayState(state, {
    planKey: dismissedPlanKey,
    debugKey: dismissedDebugKey,
  });
  const renderStack = (weightedTray: ReactNode): ReactElement => (
    <>
      <Fragment key="weighted">{weightedTray}</Fragment>
      <Fragment key="standalone">{renderStandalone?.(weightedTray !== null)}</Fragment>
    </>
  );
  if (tray === null) return renderStack(null);

  if (tray.kind === "request") {
    return renderStack(
      <SessionRequestTray
        threadId={threadId}
        permissions={tray.permissions}
        questions={tray.questions}
      />,
    );
  }

  if (tray.kind === "plan") {
    return renderStack(
      <PlanTray
        execution={tray.execution}
        plan={tray.followUp}
        state={state}
        onDismiss={() => {
          setDismissedPlanKey(tray.followUp.key);
        }}
        {...(onViewPlan === undefined ? {} : { onViewPlan })}
      />,
    );
  }

  const buildAgent = threadBuildAgent(state.messages, state.summary.agent);
  const beginDebugAction = (action: "apply" | "continue"): boolean => {
    if (pendingDebugActionRef.current !== null) return false;
    pendingDebugActionRef.current = action;
    setPendingDebugAction(action);
    return true;
  };
  const finishDebugAction = (): void => {
    pendingDebugActionRef.current = null;
    setPendingDebugAction(null);
  };
  const applyFix = (): void => {
    const client = runtime.client;
    if (client === null || !beginDebugAction("apply")) return;
    const previousMode = mode;
    const previousAgent = threadAgentName(mode, buildAgent);
    modeActions.setThreadMode(runtime.tabKey, "build");
    void sendSessionPrompt(client, threadId, {
      text: debugBuildPrompt(tray.followUp.diagnosis),
      agent: threadAgentName("build", buildAgent),
    })
      .then(() => {
        setDismissedDebugKey(tray.followUp.key);
      })
      .catch((error: unknown) => {
        modeActions.setThreadMode(runtime.tabKey, previousMode);
        void client.sessions.switchAgent(runtime.ref, previousAgent).catch(() => undefined);
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Apply fix failed",
          description: message,
          copyableError: message,
          threadKey: runtime.tabKey,
        });
      })
      .finally(finishDebugAction);
  };

  const continueDebugging = (): void => {
    const client = runtime.client;
    if (client === null || !beginDebugAction("continue")) return;
    const previousMode = mode;
    const previousAgent = threadAgentName(mode, buildAgent);
    modeActions.setThreadMode(runtime.tabKey, "debug");
    void sendSessionPrompt(client, threadId, {
      text: "Continue debugging. Do not edit files; investigate the diagnosis further and record an updated diagnosis when ready.",
      agent: modeAgentName("debug"),
    })
      .then(() => {
        setDismissedDebugKey(tray.followUp.key);
      })
      .catch((error: unknown) => {
        modeActions.setThreadMode(runtime.tabKey, previousMode);
        void client.sessions.switchAgent(runtime.ref, previousAgent).catch(() => undefined);
        const message = errorMessage(error);
        toastActions.add({
          type: "error",
          title: "Continue debugging failed",
          description: message,
          copyableError: message,
          threadKey: runtime.tabKey,
        });
      })
      .finally(finishDebugAction);
  };

  return renderStack(
    <Tray aria-label="Diagnosis ready">
      <Tray.Header rowsExpanded>
        <div {...props(styles.planHeader)}>
          <Text size="sm" tone="muted">
            Diagnosis ready
          </Text>
          <Text size="base" weight="semibold" truncate>
            {tray.followUp.diagnosis.title}
          </Text>
        </div>
        <IconButton
          type="button"
          size="sm"
          variant="quiet"
          aria-label="Dismiss diagnosis"
          disabled={pendingDebugAction !== null}
          onClick={() => {
            setDismissedDebugKey(tray.followUp.key);
          }}
        >
          <Icon icon={IconCrossSmall} size="sm" tone="faint" />
        </IconButton>
      </Tray.Header>
      <Tray.ScrollArea aria-label="Diagnosis" inset="block">
        <div {...props(styles.diagnosis)}>
          {tray.followUp.diagnosis.summary.length === 0 ? null : (
            <Text as="p" size="base" tone="muted">
              {tray.followUp.diagnosis.summary}
            </Text>
          )}
          <div {...props(styles.diagnosisSection)}>
            <Text size="sm" tone="muted">
              Root cause
            </Text>
            <Text as="p" size="base">
              {tray.followUp.diagnosis.rootCause}
            </Text>
          </div>
          {tray.followUp.diagnosis.reproduction === undefined ? null : (
            <div {...props(styles.diagnosisSection)}>
              <Text size="sm" tone="muted">
                Reproduction
              </Text>
              <Text as="p" size="base">
                {tray.followUp.diagnosis.reproduction}
              </Text>
            </div>
          )}
          <div {...props(styles.diagnosisSection)}>
            <Text size="sm" tone="muted">
              Recommended fix
            </Text>
            <Text as="p" size="base">
              {tray.followUp.diagnosis.recommendedFix}
            </Text>
          </div>
          {tray.followUp.diagnosis.files.length === 0 ? null : (
            <div {...props(styles.diagnosisSection)}>
              <Text size="sm" tone="muted">
                Relevant files
              </Text>
              <ul {...props(styles.diagnosisList)}>
                {tray.followUp.diagnosis.files.map((file, index) => (
                  <li key={`${String(index)}:${file}`}>
                    <Text size="sm" family="mono">
                      {file}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tray.followUp.diagnosis.verification.length === 0 ? null : (
            <div {...props(styles.diagnosisSection)}>
              <Text size="sm" tone="muted">
                Verification
              </Text>
              <ul {...props(styles.diagnosisList)}>
                {tray.followUp.diagnosis.verification.map((check, index) => (
                  <li key={`${String(index)}:${check}`}>
                    <Text size="base">{check}</Text>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Tray.ScrollArea>
      <Tray.Footer>
        <Button
          type="button"
          variant="primary"
          disabled={runtime.client === null || pendingDebugAction !== null}
          onClick={applyFix}
        >
          {pendingDebugAction === "apply" ? "Applying" : "Apply fix"}
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={runtime.client === null || pendingDebugAction !== null}
          onClick={continueDebugging}
        >
          {pendingDebugAction === "continue" ? "Continuing" : "Keep debugging"}
        </Button>
      </Tray.Footer>
    </Tray>,
  );
}

function PlanTray({
  execution,
  plan,
  state,
  onDismiss,
  onViewPlan,
}: {
  readonly execution: PlanExecutionProjection;
  readonly plan: SubmittedPlanRecord;
  readonly state: ThreadViewState;
  readonly onDismiss: () => void;
  readonly onViewPlan?: () => void;
}): ReactElement {
  const runtime = useThreadRuntime();
  const build = usePlanBuild({
    agent: threadAgentName("build", threadBuildAgent(state.messages, state.summary.agent)),
    execution,
    plan,
    sessionRef: runtime.ref,
  });

  return (
    <Tray aria-label="Plan ready">
      <Tray.Header rowsExpanded={plan.plan.summary !== undefined}>
        <div {...props(styles.planHeader)}>
          <Text size="sm" tone="muted">
            Review Plan
          </Text>
          <Text size="base" weight="semibold" truncate>
            {plan.plan.title}
          </Text>
        </div>
        <IconButton
          type="button"
          size="sm"
          variant="quiet"
          aria-label="Dismiss plan"
          onClick={onDismiss}
        >
          <Icon icon={IconCrossSmall} size="sm" tone="faint" />
        </IconButton>
      </Tray.Header>
      {plan.plan.summary === undefined ? null : (
        <Tray.ScrollArea aria-label="Plan overview" inset="block">
          <div {...props(styles.planDescription)}>
            <Text as="p" size="base" tone="muted">
              {plan.plan.summary}
            </Text>
          </div>
        </Tray.ScrollArea>
      )}
      <Tray.Footer>
        <PlanBuildControls controller={build} />
        {onViewPlan === undefined ? null : (
          <Button type="button" variant="quiet" onClick={onViewPlan}>
            View plan
          </Button>
        )}
      </Tray.Footer>
    </Tray>
  );
}

export { ThreadTray };
