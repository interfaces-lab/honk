import * as stylex from "@stylexjs/stylex";
import { basename } from "@honk/shared/paths";
import { Spinner, Text } from "@honk/ui";
import { borderVars, colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { BrowserSurface } from "./browser";
import type { SubmittedPlanRecord } from "./thread/follow-up";
import type { PlanExecutionProjection } from "./thread/plan-execution";
import { WorkbenchChanges } from "./workbench-changes";
import { WorkbenchPlan } from "./workbench-plan";
import { WorkbenchSideChatSurface } from "./workbench-side-chat-surface";
import type { WorkbenchTab } from "./workbench-tab-store";
import { WorkbenchTasks } from "./workbench-tasks";
import { WorkbenchTerminal } from "./workbench-terminal";
import type { ToolTodo } from "./tool-part-projection";

const DeferredWorkbenchFiles = React.lazy(() =>
  import("./workbench-files").then((module) => ({ default: module.WorkbenchFiles })),
);

// Permanent Files split geometry. These match workbench-files.tsx while keeping its data/UI module
// outside the startup graph.
const EXPLORER_MIN_WIDTH = "160px";
const EXPLORER_MAX_WIDTH = "240px";

const styles = stylex.create({
  filesRoot: {
    display: "flex",
    flexDirection: "row",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
  },
  filesExplorer: {
    flexShrink: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    width: "38%",
    minWidth: EXPLORER_MIN_WIDTH,
    maxWidth: EXPLORER_MAX_WIDTH,
    borderInlineEndWidth: borderVars["--honk-border-hairline"],
    borderInlineEndStyle: "solid",
    borderInlineEndColor: colorVars["--honk-color-border-muted"],
  },
  filesToolbar: {
    flexShrink: 0,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    height: controlVars["--honk-control-h-lg"],
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  filesToolbarName: {
    minWidth: 0,
    flexGrow: 1,
  },
  filesToolbarAction: {
    width: controlVars["--honk-control-h-sm"],
    height: controlVars["--honk-control-h-sm"],
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  filesEditor: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  filesCenter: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

function WorkbenchFilesLoading(props: {
  readonly directory: string;
  readonly selectedPath: string | null;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.filesRoot)}>
      <section aria-label="Files explorer" {...stylex.props(styles.filesExplorer)}>
        <div {...stylex.props(styles.filesToolbar)}>
          <Text
            size="xs"
            tone="faint"
            family="mono"
            truncate
            title={props.directory}
            style={styles.filesToolbarName}
          >
            {basename(props.directory)}
          </Text>
          <span aria-hidden="true" {...stylex.props(styles.filesToolbarAction)} />
        </div>
        <div {...stylex.props(styles.filesCenter)}>
          <Spinner label="Loading files" tone="muted" />
        </div>
      </section>
      <section aria-label="File preview" {...stylex.props(styles.filesEditor)}>
        <div {...stylex.props(styles.filesToolbar)}>
          <Text size="xs" tone="faint">
            Editor
          </Text>
        </div>
        <div role="status" {...stylex.props(styles.filesCenter)}>
          <Text as="p" size="sm" tone="muted" weight="regular">
            {props.selectedPath === null ? "Loading files" : "Loading file"}
          </Text>
        </div>
      </section>
    </div>
  );
}

function WorkbenchFilesSurface(props: {
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly isVisible: boolean;
  readonly selectedPath: string | null;
  readonly onOpenFile: (path: string) => void;
}): React.ReactElement {
  return (
    <React.Suspense
      fallback={
        <WorkbenchFilesLoading directory={props.directory} selectedPath={props.selectedPath} />
      }
    >
      <DeferredWorkbenchFiles {...props} />
    </React.Suspense>
  );
}

function WorkbenchPanelSurface({
  tab,
  directory,
  isThreadRunning,
  buildAgent,
  isVisible,
  plan,
  planExecution,
  tasks,
  onOpenFile,
  onReviewChanges,
  onViewPlan,
}: {
  readonly tab: WorkbenchTab;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly buildAgent: string;
  readonly isVisible: boolean;
  readonly plan: SubmittedPlanRecord | null;
  readonly planExecution: PlanExecutionProjection | null;
  readonly tasks: readonly ToolTodo[];
  readonly onOpenFile: (path: string) => void;
  readonly onReviewChanges: () => void;
  readonly onViewPlan: () => void;
}): React.ReactElement {
  if (tab.kind === "tasks") {
    return plan === null || planExecution === null ? (
      <WorkbenchTasks tasks={tasks} />
    ) : (
      <WorkbenchPlan
        agent={buildAgent}
        execution={planExecution}
        plan={plan}
        sessionRef={tab.owner}
      />
    );
  }
  if (tab.kind === "changes") {
    return (
      <WorkbenchChanges
        sessionRef={tab.owner}
        directory={directory}
        isThreadRunning={isThreadRunning}
      />
    );
  }
  if (tab.kind === "files") {
    return (
      <WorkbenchFilesSurface
        directory={directory}
        isThreadRunning={isThreadRunning}
        isVisible={isVisible}
        selectedPath={null}
        onOpenFile={onOpenFile}
      />
    );
  }
  if (tab.kind === "file") {
    return (
      <WorkbenchFilesSurface
        directory={directory}
        isThreadRunning={isThreadRunning}
        isVisible={isVisible}
        selectedPath={tab.filePath}
        onOpenFile={onOpenFile}
      />
    );
  }
  if (tab.kind === "terminal") {
    return <WorkbenchTerminal cwd={directory} isVisible={isVisible} terminalID={tab.terminalID} />;
  }
  if (tab.kind === "browser") {
    return (
      <BrowserSurface
        sessionRef={tab.owner}
        directory={directory}
        resourceID={tab.browserID}
        isVisible={isVisible}
      />
    );
  }
  return (
    <WorkbenchSideChatSurface
      parentRef={tab.parent}
      sessionID={tab.child.sessionID}
      onOpenFile={onOpenFile}
      onReviewChanges={onReviewChanges}
      onViewPlan={onViewPlan}
      isVisible={isVisible}
    />
  );
}

export { WorkbenchPanelSurface };
