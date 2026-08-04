import * as stylex from "@stylexjs/stylex";
import { basename } from "@honk/shared/paths";
import { Icon, Spinner, Text } from "@honk/ui";
import { IconChanges, IconChevronDownMedium } from "@honk/ui/icons";
import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { BrowserSurface } from "./browser";
import type { SubmittedPlanRecord } from "./thread/follow-up";
import type { PlanExecutionProjection } from "./thread/plan-execution";
import { workbenchChangesLayout } from "./workbench-changes-layout.stylex";
import { WorkbenchPlan } from "./workbench-plan";
import { WorkbenchSideChatSurface } from "./workbench-side-chat-surface";
import type { WorkbenchTab } from "./workbench-tab-store";
import { WorkbenchTasks } from "./workbench-tasks";
import { WorkbenchTerminal } from "./workbench-terminal";
import type { ToolTodo } from "./tool-part-projection";

const DeferredWorkbenchFiles = React.lazy(() =>
  import("./workbench-files").then((module) => ({ default: module.WorkbenchFiles })),
);
const DeferredWorkbenchChanges = React.lazy(() =>
  import("./workbench-changes").then((module) => ({ default: module.WorkbenchChanges })),
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
  changesScopeLoading: {
    minWidth: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
});

function WorkbenchChangesLoading(): React.ReactElement {
  return (
    <div {...stylex.props(workbenchChangesLayout.root)}>
      <div {...stylex.props(workbenchChangesLayout.toolbar)}>
        <span aria-hidden="true" {...stylex.props(styles.changesScopeLoading)}>
          <Icon icon={IconChanges} size="sm" />
          <span>Uncommitted</span>
          <Icon icon={IconChevronDownMedium} size="xs" />
        </span>
        <span {...stylex.props(workbenchChangesLayout.spacer)} />
      </div>
      <div {...stylex.props(workbenchChangesLayout.center)}>
        <Spinner label="Loading changes" tone="muted" />
      </div>
    </div>
  );
}

function WorkbenchChangesSurface(props: {
  readonly sessionRef: Extract<WorkbenchTab, { readonly kind: "changes" }>["owner"];
  readonly directory: string;
  readonly isThreadRunning: boolean;
}): React.ReactElement {
  return (
    <React.Suspense fallback={<WorkbenchChangesLoading />}>
      <DeferredWorkbenchChanges {...props} />
    </React.Suspense>
  );
}

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
      <WorkbenchChangesSurface
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
