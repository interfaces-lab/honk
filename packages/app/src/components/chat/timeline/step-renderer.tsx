import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import { IconChevronRightMedium } from "central-icons";
import { useRef, type ReactNode } from "react";

import { type ChatMessage, type ProposedPlan } from "../../../types";
import { cn } from "~/lib/utils";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { WorkingStatusRow } from "../message/status-row";
import { ToolCallMessage } from "../message/tool-message";
import { ProposedPlanMessage } from "../message/proposed-plan-message";
import { AssistantTranscriptRow, HumanTranscriptRow } from "../message/transcript-rows";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import {
  type TimelineMessageStep,
  type TimelineProposedPlanStep,
  type TimelineStep,
  type TimelineWaitingStep,
  type TimelineWorkStep,
  type WorkGroupSummary,
} from "./timeline-render-items";
import { type WorkTimelineRow } from "./timeline-rows";

export const WORK_GROUP_PREVIEW_PX = 144;
export const WORK_GROUP_PREVIEW_ENTRY_PX = 28;
export const WORK_GROUP_HEADER_PX = 28;
export const WORK_GROUP_HEADER_GAP_PX = 4;
export const WORK_GROUP_STEP_GAP_PX = 6;
export const WORK_GROUP_PREVIEW_MAX_ENTRIES = 6;

export interface StepRendererContext {
  markdownCwd: string | undefined;
  projectRoot: string | undefined;
  activeThreadId: ThreadId;
  activeThreadEnvironmentId: EnvironmentId;
  isServerThread: boolean;
  onBeginEditUserMessage: ((messageId: ChatMessage["id"]) => void) | undefined;
  renderEditComposer: ((message: ChatMessage) => ReactNode) | undefined;
  onUpdateProposedPlan:
    | ((proposedPlan: ProposedPlan, nextMarkdown: string) => Promise<boolean>)
    | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}

export function StepRenderer({
  step,
  editUserMessagesDisabled,
  isEditingUserMessage = false,
  ctx,
}: {
  step: TimelineStep;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage?: boolean;
  ctx: StepRendererContext;
}) {
  switch (step.kind) {
    case "message":
      return (
        <MessageStepRenderer
          step={step}
          editUserMessagesDisabled={editUserMessagesDisabled}
          isEditingUserMessage={isEditingUserMessage}
          ctx={ctx}
        />
      );

    case "proposed-plan":
      return <ProposedPlanStepRenderer step={step} ctx={ctx} />;

    case "work":
      return <WorkStepRenderer step={step} ctx={ctx} />;

    case "waiting":
      return <WaitingStepRenderer step={step} />;
  }
}

export function GroupedStepsRenderer({
  row,
  expanded,
  onToggleExpanded,
  editUserMessagesDisabled,
  ctx,
}: {
  row: WorkTimelineRow;
  expanded: boolean;
  onToggleExpanded: (rowId: string) => void;
  editUserMessagesDisabled: boolean;
  ctx: StepRendererContext;
}) {
  const summary = row.summary;
  const isRunning = row.isRunning;
  const isThinkingGroup = row.isThinkingGroup;
  const isCommandGroup = row.isCommandGroup;
  const headerLabel = isThinkingGroup
    ? [summary.action, summary.details].filter(Boolean).join(" ")
    : isRunning
      ? summary.action
      : `Worked for ${row.completedDurationLabel ?? "briefly"}`;
  const contentId = `timeline-work-group:${row.id}`;
  const handleToggle = () => {
    onToggleExpanded(row.id);
  };

  return (
    <div
      className="flex min-h-0 min-w-0 max-w-agent-chat flex-1 flex-col gap-(--chat-timeline-collapsible-header-gap) py-0.5 text-conversation"
      data-assistant-work-group=""
      data-work-group-expanded={expanded ? "true" : "false"}
      data-work-group-running={isRunning ? "true" : "false"}
      aria-busy={isRunning ? "true" : undefined}
    >
      <button
        type="button"
        className={cn(
          "group/work-header inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-(--chat-timeline-collapsible-header-gap) overflow-hidden",
          "border-0 bg-transparent p-0 text-left select-none",
          "text-conversation text-multi-fg-tertiary",
          "hover:text-multi-fg-secondary focus-visible:text-multi-fg-secondary",
        )}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={handleToggle}
        data-work-group-header=""
      >
        <span className="shrink-0 whitespace-nowrap tabular-nums">{headerLabel}</span>
        {!expanded && !isThinkingGroup ? (
          <>
            <span aria-hidden="true" className="shrink-0 text-multi-fg-tertiary">
              ·
            </span>
            <WorkGroupSummaryLine summary={summary} />
          </>
        ) : null}
        <IconChevronRightMedium
          className={cn(
            "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-(--motion-duration-collapsible) ease-out motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      <div id={contentId} className="contents">
        {expanded ? (
          <div className="flex min-w-0 max-w-full flex-col gap-(--chat-timeline-step-gap)">
            {!isCommandGroup && !isThinkingGroup ? (
              <WorkGroupSummaryLine summary={summary} />
            ) : null}
            {row.steps.map((step) => (
              <StepRenderer
                key={`work-row:${step.id}`}
                step={step}
                editUserMessagesDisabled={editUserMessagesDisabled}
                ctx={ctx}
              />
            ))}
          </div>
        ) : isRunning ? (
          <WorkGroupPreview key={`work-preview:${row.id}`} row={row} onExpand={handleToggle} ctx={ctx} />
        ) : null}
      </div>
    </div>
  );
}

function MessageStepRenderer({
  step,
  editUserMessagesDisabled,
  isEditingUserMessage,
  ctx,
}: {
  step: TimelineMessageStep;
  editUserMessagesDisabled: boolean;
  isEditingUserMessage: boolean;
  ctx: StepRendererContext;
}) {
  if (step.message.role === "user") {
    return (
      <HumanTranscriptRow
        message={step.message}
        editAvailable={step.editAvailable}
        isEditing={isEditingUserMessage}
        editDisabled={editUserMessagesDisabled}
        isServerThread={ctx.isServerThread}
        editComposer={isEditingUserMessage ? (ctx.renderEditComposer?.(step.message) ?? null) : null}
        onImageExpand={ctx.onImageExpand}
        onBeginEditUserMessage={ctx.onBeginEditUserMessage}
      />
    );
  }

  return <AssistantTranscriptRow message={step.message} markdownCwd={ctx.markdownCwd} />;
}

function ProposedPlanStepRenderer({
  step,
  ctx,
}: {
  step: TimelineProposedPlanStep;
  ctx: StepRendererContext;
}) {
  return (
    <ProposedPlanMessage
      canEdit={ctx.isServerThread}
      markdownCwd={ctx.markdownCwd}
      onSave={ctx.onUpdateProposedPlan}
      proposedPlan={step.proposedPlan}
    />
  );
}

function WorkStepRenderer({ step, ctx }: { step: TimelineWorkStep; ctx: StepRendererContext }) {
  return (
    <ToolCallMessage
      workEntry={step.entry}
      projectRoot={ctx.projectRoot}
      activeThreadId={ctx.activeThreadId}
      environmentId={ctx.activeThreadEnvironmentId}
      subagentDetailsEnabled
    />
  );
}

function WaitingStepRenderer({ step }: { step: TimelineWaitingStep }) {
  return (
    <div
      className="flex w-full min-w-0 opacity-75"
      aria-busy="true"
      data-waiting-group=""
      data-waiting-step-id={step.id}
    >
      <WorkingStatusRow />
    </div>
  );
}

function WorkGroupSummaryLine({ summary }: { summary: WorkGroupSummary }) {
  return (
    <span
      className="inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-conversation"
      data-work-group-summary=""
    >
      <span className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-secondary">
        {summary.action}
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis text-multi-fg-tertiary tabular-nums">
        {summary.details}
      </span>
      <WorkGroupStats summary={summary} />
    </span>
  );
}

function WorkGroupPreview({
  row,
  onExpand,
  ctx,
}: {
  row: WorkTimelineRow;
  onExpand: () => void;
  ctx: StepRendererContext;
}) {
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const steps = row.steps;
  const previewSteps = steps.slice(-WORK_GROUP_PREVIEW_MAX_ENTRIES);
  const lastStepId = steps.at(-1)?.id;
  const previewStepCount = previewSteps.length;

  useLayoutSyncEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    host.scrollTop = host.scrollHeight;
    updatePreviewScrollable(host);
  }, [lastStepId, previewStepCount, row.isRunning]);

  useLayoutSyncEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    if (typeof ResizeObserver === "undefined") {
      updatePreviewScrollable(host);
      return;
    }
    const observer = new ResizeObserver(() => {
      updatePreviewScrollable(host);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const onPreviewClick = () => {
    onExpand();
  };

  return (
    <div
      ref={scrollHostRef}
      role="button"
      tabIndex={0}
      aria-label="Expand work group"
      onClick={onPreviewClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onExpand();
      }}
      data-work-group-preview=""
      data-work-preview-scrollable="false"
      className="flex w-full min-h-0 max-w-full cursor-pointer flex-col gap-(--chat-timeline-step-gap) overflow-x-hidden overflow-y-auto [overflow-anchor:none] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        maxHeight: WORK_GROUP_PREVIEW_PX,
      }}
    >
      {previewSteps.map((step) => (
        <StepRenderer
          key={`work-preview-row:${step.id}`}
          step={step}
          editUserMessagesDisabled={false}
          ctx={ctx}
        />
      ))}
    </div>
  );
}

function updatePreviewScrollable(host: HTMLDivElement): void {
  const scrollable = host.scrollHeight > host.clientHeight + 1;
  host.dataset.workPreviewScrollable = scrollable ? "true" : "false";
}

function WorkGroupStats({ summary }: { summary: WorkGroupSummary }) {
  const additions = summary.additions ?? 0;
  const deletions = summary.deletions ?? 0;
  if (additions === 0 && deletions === 0) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 gap-1 tabular-nums" data-work-group-stats="">
      {additions > 0 ? <span className="text-multi-diff-addition">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-multi-diff-deletion">-{deletions}</span> : null}
    </span>
  );
}
