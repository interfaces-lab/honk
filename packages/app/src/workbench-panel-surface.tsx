import * as React from "react";

import { BrowserSurface } from "./browser";
import type { SubmittedPlan } from "./thread/follow-up";
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
  isVisible,
  plan,
  tasks,
  onReviewChanges,
  onViewPlan,
}: {
  readonly tab: WorkbenchTab;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly isVisible: boolean;
  readonly plan: SubmittedPlan | null;
  readonly tasks: readonly ToolTodo[];
  readonly onReviewChanges: () => void;
  readonly onViewPlan: () => void;
}): React.ReactElement {
  if (tab.kind === "tasks") {
    return plan === null ? <WorkbenchTasks tasks={tasks} /> : <WorkbenchPlan plan={plan} />;
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
    return <WorkbenchFiles directory={directory} />;
  }
  if (tab.kind === "terminal") {
    return <WorkbenchTerminal cwd={directory} isVisible={isVisible} />;
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
      onReviewChanges={onReviewChanges}
      onViewPlan={onViewPlan}
      isVisible={isVisible}
    />
  );
}

export { WorkbenchPanelSurface };
