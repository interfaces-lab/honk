import * as React from "react";

import { BrowserSurface } from "./browser";
import type { SubmittedPlanRecord } from "./thread/follow-up";
import type { PlanExecutionProjection } from "./thread/plan-execution";
import { WorkbenchChanges } from "./workbench-changes";
import { WorkbenchFiles } from "./workbench-files";
import { WorkbenchPlan } from "./workbench-plan";
import { WorkbenchSideChatSurface } from "./workbench-side-chat-surface";
import type { WorkbenchTab } from "./workbench-tab-store";
import { WorkbenchTasks } from "./workbench-tasks";
import { WorkbenchTerminal } from "./workbench-terminal";
import type { ToolTodo } from "./tool-part-projection";

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
      <WorkbenchFiles
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
      <WorkbenchFiles
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
