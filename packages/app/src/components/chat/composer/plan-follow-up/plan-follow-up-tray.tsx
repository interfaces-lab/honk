import { Button } from "@multi/multikit/button";
import { IconArrowUp, IconCrossSmall, IconEyeOpen } from "central-icons";
import { useState } from "react";

import ChatMarkdown from "../../markdown/chat-markdown";
import type { ComposerInputProps } from "../input-contract";
import { cn } from "~/lib/utils";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "~/plan/proposed-plan";

export function PlanFollowUpTray(props: {
  plan: NonNullable<ComposerInputProps["activeProposedPlan"]>;
  compact: boolean;
  gitCwd: string | undefined;
  isBuilding: boolean;
  planSurfaceOpen: boolean;
  onBuildPlan: (() => void) | undefined;
  onViewPlan: (() => void) | undefined;
}) {
  const planKey = String(props.plan.id);
  const [dismissedPlanId, setDismissedPlanId] = useState<string | null>(null);
  const title = proposedPlanTitle(props.plan.planMarkdown) ?? "Plan";
  const previewMarkdown = stripDisplayedPlanMarkdown(props.plan.planMarkdown).trim();
  const showViewPlan = props.onViewPlan !== undefined && !props.planSurfaceOpen;

  if (dismissedPlanId === planKey) {
    return null;
  }

  return (
    <div
      className={cn(
        "plan-tray pointer-events-auto min-w-0 overflow-hidden rounded-(--multi-composer-plan-tray-radius) bg-multi-bg-elevated font-multi text-detail text-multi-fg-primary shadow-multi-card",
        props.compact ? "mx-auto w-full" : "",
      )}
      data-testid="plan-tray"
      data-visible="true"
      style={{ transformOrigin: "bottom left" }}
    >
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="text-caption font-medium text-multi-fg-tertiary">Review Plan</div>
          <div className="truncate text-detail font-medium text-multi-fg-primary" title={title}>
            {title}
          </div>
        </div>
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded-multi-control bg-multi-bg-quinary text-multi-icon-secondary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-icon-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
          aria-label="Dismiss plan"
          title="Dismiss plan"
          onClick={() => setDismissedPlanId(planKey)}
        >
          <IconCrossSmall className="size-3" aria-hidden />
        </button>
      </div>

      {previewMarkdown ? (
        <div className="plan-tray__description relative px-3 pb-2">
          <div className="plan-tray__markdown">
            <ChatMarkdown text={previewMarkdown} cwd={props.gitCwd} />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-9 min-w-0 items-center justify-between gap-2.5 px-2.5 py-1.5">
        {showViewPlan ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-2 text-detail [&_svg]:size-3.5"
            onClick={props.onViewPlan}
          >
            <IconEyeOpen aria-hidden />
            <span>View Plan</span>
          </Button>
        ) : (
          <span className="h-6 min-w-0" aria-hidden />
        )}
        <Button
          type="button"
          variant="default"
          size="sm"
          className="bg-(--cursor-bg-yellow-primary) text-detail text-(--vscode-editor-background) hover:bg-[color-mix(in_srgb,var(--cursor-bg-yellow-primary)_80%,var(--cursor-bg-yellow-secondary))] data-pressed:bg-[color-mix(in_srgb,var(--cursor-bg-yellow-primary)_80%,var(--cursor-bg-yellow-secondary))] [&_svg]:size-3.5"
          disabled={props.isBuilding || !props.onBuildPlan}
          aria-label="Build plan"
          title="Build plan"
          onClick={props.onBuildPlan}
        >
          <IconArrowUp aria-hidden />
          <span>{props.isBuilding ? "Building..." : "Build"}</span>
        </Button>
      </div>
    </div>
  );
}
