import type { ThreadViewState } from "../open-code-view";
import {
  pendingDebugFollowUp,
  pendingPlanFollowUp,
  type DebugFollowUp,
  type SubmittedPlanRecord,
} from "./follow-up";
import { planExecutionProjection, type PlanExecutionProjection } from "./plan-execution";

type ThreadTrayState =
  | {
      readonly kind: "request";
      readonly permissions: ThreadViewState["permissions"];
      readonly questions: ThreadViewState["questions"];
    }
  | {
      readonly kind: "plan";
      readonly followUp: SubmittedPlanRecord;
      readonly execution: PlanExecutionProjection;
    }
  | { readonly kind: "debug"; readonly followUp: DebugFollowUp };

type ThreadTrayDismissals = {
  readonly planKey: string | null;
  readonly debugKey: string | null;
};

function threadTrayState(
  state: ThreadViewState,
  dismissals: ThreadTrayDismissals,
): ThreadTrayState | null {
  if (state.permissions.length > 0 || state.questions.length > 0) {
    return {
      kind: "request",
      permissions: state.permissions,
      questions: state.questions,
    };
  }

  // The completed assistant turn owns the follow-up. A later composer-mode selection must not
  // hide a plan that finished while the user was preparing another kind of prompt.
  const pendingPlan = pendingPlanFollowUp(state);
  if (pendingPlan !== null) {
    return pendingPlan.key === dismissals.planKey
      ? null
      : {
          kind: "plan",
          followUp: pendingPlan,
          execution: planExecutionProjection(state, pendingPlan),
        };
  }

  const debug = pendingDebugFollowUp(state);
  if (debug !== null) {
    return debug.key === dismissals.debugKey ? null : { kind: "debug", followUp: debug };
  }

  return null;
}

export { threadTrayState };
