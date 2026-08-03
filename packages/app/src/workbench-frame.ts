import {
  openCodeLocationKey,
  type OpenCodeLocationRef,
  type OpenCodeSessionRef,
} from "@honk/opencode";

import type { SubmittedPlanRecord } from "./thread/follow-up";
import type { PlanExecutionProjection } from "./thread/plan-execution";
import type { ToolTodo } from "./tool-part-projection";

type ResolvedWorkbenchFrame = {
  readonly workspaceKey: string;
  readonly sessionRef: OpenCodeSessionRef;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly buildAgent: string;
  readonly plan: SubmittedPlanRecord | null;
  readonly planExecution: PlanExecutionProjection | null;
  readonly tasks: readonly ToolTodo[];
};

function workbenchWorkspaceKey(ref: OpenCodeSessionRef, location: OpenCodeLocationRef): string {
  return openCodeLocationKey(ref.server, location);
}

export { workbenchWorkspaceKey };
export type { ResolvedWorkbenchFrame };
