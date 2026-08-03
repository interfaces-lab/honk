import { create, props } from "@stylexjs/stylex";
import type { OpenCodeSessionRef } from "@honk/opencode";
import { Text, Tray } from "@honk/ui";
import { PlanCard } from "@honk/ui/plan-card";
import { conversationVars, spaceVars } from "@honk/ui/tokens.stylex";
import type { ReactElement } from "react";

import { Markdown } from "./markdown";
import { TaskList } from "./task-list";
import { submittedPlanMarkdown, type SubmittedPlanRecord } from "./thread/follow-up";
import type { PlanExecutionProjection } from "./thread/plan-execution";
import { PlanBuildControls } from "./thread/plan-build-controls";
import { usePlanBuild } from "./thread/use-plan-build";

const styles = create({
  content: {
    display: "flex",
    flexDirection: "column",
    gap: `calc(${spaceVars["--honk-space-panel-pad"]} * 2)`,
    paddingBlockEnd: spaceVars["--honk-space-panel-pad"],
  },
  tracker: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: conversationVars["--honk-conversation-inset"],
  },
  trackerHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
  },
});

function WorkbenchPlan({
  agent,
  execution,
  plan,
  sessionRef,
}: {
  readonly agent: string;
  readonly execution: PlanExecutionProjection;
  readonly plan: SubmittedPlanRecord;
  readonly sessionRef: OpenCodeSessionRef;
}): ReactElement {
  const build = usePlanBuild({ agent, execution, plan, sessionRef });
  const visibleTasks = execution.tasks.filter((task) => task.status !== "cancelled");
  const completed = visibleTasks.filter((task) => task.status === "completed").length;
  const active = visibleTasks.filter((task) => task.status === "in_progress").length;
  const status = active > 0 ? `${String(active)} active` : null;
  const action =
    execution.status === "active" ? (
      <Text size="sm" tone="muted">
        Building
      </Text>
    ) : execution.status === "complete" ? (
      <Text size="sm" tone="muted">
        Built
      </Text>
    ) : (
      <PlanBuildControls controller={build} size="sm" />
    );

  return (
    <section aria-label="Plan" className="flex min-h-0 grow flex-col">
      <Tray.ScrollArea aria-label="Plan details" data-honk-scrollport="" inset="block">
        <div {...props(styles.content)}>
          <PlanCard title={plan.plan.title} summary={plan.plan.summary} action={action}>
            <Markdown text={submittedPlanMarkdown(plan.plan)} />
          </PlanCard>
          {execution.status === "ready" || visibleTasks.length === 0 ? null : (
            <div aria-label="Implementation progress" {...props(styles.tracker)}>
              <div aria-live="polite" {...props(styles.trackerHeader)}>
                <Text as="p" size="sm" tone="muted" tabularNums>
                  {completed} of {visibleTasks.length} complete
                </Text>
                {status === null ? null : (
                  <Text
                    size="xs"
                    tone={execution.status === "active" ? "accent" : "muted"}
                    tabularNums
                  >
                    {status}
                  </Text>
                )}
              </div>
              <TaskList tasks={visibleTasks} />
            </div>
          )}
        </div>
      </Tray.ScrollArea>
    </section>
  );
}

export { WorkbenchPlan };
