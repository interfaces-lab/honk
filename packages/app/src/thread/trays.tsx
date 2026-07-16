import * as stylex from "@stylexjs/stylex";
import { Button } from "@honk/ui";
import { PlanCard } from "@honk/ui/plan-card";
import {
  colorVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { errorMessage } from "../error-message";
import { Markdown } from "../markdown";
import { actions as modeActions, modeAgentName } from "../modes";
import { sendSessionPrompt, type ThreadViewState } from "../open-code-view";
import { actions as toastActions } from "../toast-store";
import { pendingDebugFollowUp, pendingPlanFollowUp, submittedPlanMarkdown } from "./follow-up";
import { useThreadRuntime } from "./runtime";

const TRAY_MAX_WIDTH = "460px";
const TRAY_MAX_HEIGHT = "min(46vh, 380px)";

const styles = stylex.create({
  tray: {
    position: "absolute",
    zIndex: zVars["--honk-z-popover"],
    insetInlineStart: 0,
    bottom: "100%",
    marginBottom: spaceVars["--honk-space-gutter"],
    width: `min(${TRAY_MAX_WIDTH}, 100%)`,
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
    backgroundImage: `linear-gradient(180deg, ${colorVars["--honk-color-accent-subtle"]}, ${colorVars["--honk-color-bg-base"]})`,
    boxShadow: elevationVars["--honk-elevation-floating"],
  },
  trayDebug: {
    backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${colorVars["--honk-color-preset-ultra"]} 12%, ${colorVars["--honk-color-bg-base"]}), ${colorVars["--honk-color-bg-base"]})`,
    boxShadow: elevationVars["--honk-elevation-floating"],
  },
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
  trayActions: { display: "flex", alignItems: "center", gap: spaceVars["--honk-space-gutter"] },
});

// Implement switches to build mode and sends approval without changing the selected model.
// Store the dismissed plan ID so a revised plan opens the tray again.
export function PlanTray({
  threadId,
  state,
  onViewPlan,
}: {
  threadId: string;
  state: ThreadViewState;
  onViewPlan?: () => void;
}): React.ReactElement | null {
  const runtime = useThreadRuntime();
  const [dismissedId, setDismissedId] = React.useState<string | null>(null);
  const followUp = pendingPlanFollowUp(state);
  if (followUp === null || followUp.key === dismissedId) return null;

  const implement = (): void => {
    const client = runtime.client;
    if (client === null) {
      return;
    }
    setDismissedId(followUp.key);
    modeActions.setThreadMode(runtime.tabKey, "build");
    void sendSessionPrompt(client, threadId, {
      text: "Implement the plan above.",
      agent: modeAgentName("build"),
    }).catch((error: unknown) => {
      const message = errorMessage(error);
      toastActions.add({
        type: "error",
        title: "Implement failed",
        description: message,
        copyableError: message,
        threadKey: runtime.tabKey,
      });
    });
  };

  return (
    <div {...stylex.props(styles.tray, styles.trayPlan)}>
      <PlanCard title={followUp.plan.title} summary={followUp.plan.summary}>
        <Markdown text={submittedPlanMarkdown(followUp.plan)} />
      </PlanCard>
      <div {...stylex.props(styles.trayActions)}>
        <Button type="button" variant="primary" onClick={implement}>
          Implement plan
        </Button>
        {onViewPlan === undefined ? null : (
          <Button type="button" variant="quiet" onClick={onViewPlan}>
            View plan
          </Button>
        )}
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            setDismissedId(followUp.key);
          }}
        >
          Keep planning
        </Button>
      </div>
    </div>
  );
}

// Show actions after a diagnosis finishes. Keep the diagnosis in the transcript.
// Store the dismissed message ID so a later diagnosis can open the tray again.
export function DebugTray({
  threadId,
  state,
}: {
  threadId: string;
  state: ThreadViewState;
}): React.ReactElement | null {
  const runtime = useThreadRuntime();
  const [dismissedId, setDismissedId] = React.useState<string | null>(null);
  const followUp = pendingDebugFollowUp(state);
  if (followUp === null || followUp.key === dismissedId) return null;

  const applyFix = (): void => {
    const client = runtime.client;
    if (client === null) {
      return;
    }
    setDismissedId(followUp.key);
    modeActions.setThreadMode(runtime.tabKey, "build");
    void sendSessionPrompt(client, threadId, {
      text: "Apply the recommended fix.",
      agent: modeAgentName("build"),
    }).catch((error: unknown) => {
      const message = errorMessage(error);
      toastActions.add({
        type: "error",
        title: "Apply fix failed",
        description: message,
        copyableError: message,
        threadKey: runtime.tabKey,
      });
    });
  };

  return (
    <div {...stylex.props(styles.tray, styles.trayDebug)}>
      <p {...stylex.props(styles.trayHint)}>{followUp.hint}</p>
      <div {...stylex.props(styles.trayActions)}>
        <Button type="button" variant="primary" onClick={applyFix}>
          Apply fix
        </Button>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            setDismissedId(followUp.key);
          }}
        >
          Keep debugging
        </Button>
      </div>
    </div>
  );
}
