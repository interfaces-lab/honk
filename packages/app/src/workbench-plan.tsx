import { PlanCard } from "@honk/ui/plan-card";
import type { ReactElement } from "react";

import { Markdown } from "./markdown";
import { submittedPlanMarkdown, type SubmittedPlan } from "./thread/follow-up";

function WorkbenchPlan({ plan }: { readonly plan: SubmittedPlan }): ReactElement {
  return (
    <section
      aria-label="Plan"
      data-honk-scrollport=""
      className="flex min-h-0 grow flex-col overflow-y-auto py-panel-pad"
    >
      <PlanCard title={plan.title} summary={plan.summary}>
        <Markdown text={submittedPlanMarkdown(plan)} />
      </PlanCard>
    </section>
  );
}

export { WorkbenchPlan };
