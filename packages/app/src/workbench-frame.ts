import {
  openCodeLocationKey,
  type OpenCodeLocationRef,
  type OpenCodeSessionRef,
} from "@honk/opencode";

import type { SubmittedPlan } from "./thread/follow-up";
import type { ToolTodo } from "./tool-part-projection";

type ResolvedWorkbenchFrame = {
  readonly workspaceKey: string;
  readonly sessionRef: OpenCodeSessionRef;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly plan: SubmittedPlan | null;
  readonly tasks: readonly ToolTodo[];
};

function workbenchWorkspaceKey(ref: OpenCodeSessionRef, location: OpenCodeLocationRef): string {
  return openCodeLocationKey(ref.server, location);
}

function retainResolvedWorkbenchFrame(
  current: ResolvedWorkbenchFrame | null,
  retained: ResolvedWorkbenchFrame | null,
): ResolvedWorkbenchFrame | null {
  return current ?? retained;
}

export { retainResolvedWorkbenchFrame, workbenchWorkspaceKey };
export type { ResolvedWorkbenchFrame };
