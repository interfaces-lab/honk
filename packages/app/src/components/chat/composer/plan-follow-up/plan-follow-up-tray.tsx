import { Button } from "@honk/honkkit/button";
import { IconArrowUp, IconCrossSmall, IconEyeOpen } from "central-icons";

import ChatMarkdown from "../../markdown/chat-markdown";
import { ComposerFollowUpTraySurface } from "../follow-up-tray-surface";
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
  onDismissPlan: (() => void) | undefined;
  onViewPlan: (() => void) | undefined;
}) {
  const title = proposedPlanTitle(props.plan.planMarkdown) ?? "Plan";
  const previewMarkdown = stripDisplayedPlanMarkdown(props.plan.planMarkdown).trim();
  const showViewPlan = props.onViewPlan !== undefined && !props.planSurfaceOpen;
  return (
    <ComposerFollowUpTraySurface
      className={cn("plan-tray", props.compact ? "mx-auto w-full" : "")}
      data-testid="plan-tray"
      data-visible="true"
    >
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="text-caption font-medium text-honk-fg-tertiary">Review Plan</div>
          <div className="truncate text-detail font-medium text-honk-fg-primary" title={title}>
            {title}
          </div>
        </div>
        <Button
          className="size-5 shrink-0 rounded-full bg-honk-bg-quinary text-honk-icon-secondary hover:text-honk-icon-primary"
          size="icon-sm"
          variant="ghost"
          aria-label="Dismiss plan"
          title="Dismiss plan"
          icon={<IconCrossSmall className="size-3" aria-hidden />}
          isIconOnly
          onClick={props.onDismissPlan}
        />
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
            typography="detail"
            className="h-6 gap-1 rounded-full px-2.5"
            icon={<IconEyeOpen className="size-3.5" aria-hidden />}
            label="View Plan"
            onClick={props.onViewPlan}
          />
        ) : (
          <span className="h-6 min-w-0" aria-hidden />
        )}
        <Button
          type="button"
          variant="default"
          size="sm"
          typography="detail"
          className="h-6 gap-1 rounded-full bg-(--honk-bg-yellow-primary) px-2.5 text-(--honk-color-editor) hover:bg-[color-mix(in_srgb,var(--honk-bg-yellow-primary)_80%,var(--honk-bg-yellow-secondary))] data-pressed:bg-[color-mix(in_srgb,var(--honk-bg-yellow-primary)_80%,var(--honk-bg-yellow-secondary))] [&_svg]:text-current"
          disabled={props.isBuilding || !props.onBuildPlan}
          aria-label="Build plan"
          title="Build plan"
          icon={<IconArrowUp className="size-3.5" aria-hidden />}
          label={props.isBuilding ? "Building..." : "Build"}
          onClick={props.onBuildPlan}
        />
      </div>
    </ComposerFollowUpTraySurface>
  );
}
