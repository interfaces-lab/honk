import { type EnvironmentId, type ThreadId } from "@multi/contracts";
import { Button } from "@multi/multikit/button";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { IconChevronRightMedium } from "central-icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { type ChatMessage, type ProposedPlan } from "../../../types";
import { hasRenderableText, resolveStreamingShellOutput } from "../message/tool-renderer";
import { cn } from "~/lib/utils";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { WorkingStatusRow } from "../message/status-row";
import {
  RuntimeExtensionUiRequestMessage,
  RuntimeSubagentTaskMessage,
  RuntimeToolCallMessage,
  ToolCallMessage,
} from "../message/tool-message";
import { ProposedPlanMessage } from "../message/proposed-plan-message";
import { AssistantTranscriptRow, HumanTranscriptRow } from "../message/transcript-rows";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import ChatMarkdown from "../markdown/chat-markdown";
import {
  isPreviewableWorkGroupStep,
  isShortPlainText,
  type TimelineMessageStep,
  type TimelineProposedPlanStep,
  type TimelineGroupedStep,
  type TimelineRuntimeExtensionUiRequestStep,
  type TimelineRuntimeTaskStep,
  type TimelineRuntimeThinkingStep,
  type TimelineRuntimeToolStep,
  type TimelineStep,
  type TimelineWaitingStep,
  type TimelineWorkStep,
  type WorkGroupSummary,
} from "./timeline-render-items";
import { type WorkTimelineRow } from "./timeline-rows";

export const WORK_GROUP_PREVIEW_PX = 144;
export const WORK_GROUP_PREVIEW_ENTRY_PX = 28;
/** Glanceable output strip on the last running shell/edit step in preview (5 × 18px mono lines). */
export const WORK_GROUP_PREVIEW_OUTPUT_STRIP_PX = 90;
export const WORK_GROUP_HEADER_PX = 28;
export const WORK_GROUP_HEADER_GAP_PX = 4;
export const WORK_GROUP_STEP_GAP_PX = 6;

// messages-timeline estimateTimelineRowSize (running preview): when the last preview step is a
// running shell/edit with output, add WORK_GROUP_PREVIEW_OUTPUT_STRIP_PX + WORK_GROUP_STEP_GAP_PX
// on top of the one-liner WORK_GROUP_PREVIEW_ENTRY_PX for that step instead of entry height only.

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

    case "runtime-tool":
      return <RuntimeToolStepRenderer step={step} ctx={ctx} />;

    case "runtime-task":
      return <RuntimeTaskStepRenderer step={step} ctx={ctx} />;

    case "runtime-thinking":
      return <RuntimeThinkingStepRenderer step={step} ctx={ctx} />;

    case "runtime-extension-ui-request":
      return <RuntimeExtensionUiRequestStepRenderer step={step} />;

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
  const isRunning = row.isRunning;
  const isCommandGroup = row.isCommandGroup;
  const isThinkingGroup = row.isThinkingGroup;
  const isWaitingGroup = row.isWaitingGroup;
  const isBrowserGroup = row.isBrowserGroup;
  const previewStepCount = countRenderableWorkGroupPreviewSteps(row.steps);
  const showPreview = isRunning && !expanded && previewStepCount > 0;
  const [previewScrollable, setPreviewScrollable] = useState(false);
  const onPreviewScrollableChange = useCallback((scrollable: boolean) => {
    setPreviewScrollable((current) => current || scrollable);
  }, []);
  const contentId = `timeline-work-group:${row.id}`;
  const handleToggle = () => {
    onToggleExpanded(row.id);
  };

  useEffect(() => {
    if (!showPreview) {
      setPreviewScrollable(false);
    }
  }, [showPreview]);

  return (
    <div
      className="flex min-h-0 min-w-0 max-w-agent-chat flex-1 flex-col gap-(--chat-timeline-collapsible-header-gap) py-0.5 text-conversation"
      data-assistant-work-group=""
      data-waiting-group={isWaitingGroup ? "" : undefined}
      data-browser-group={isBrowserGroup ? "" : undefined}
      data-work-group-expanded={expanded ? "true" : "false"}
      data-work-group-running={isRunning ? "true" : "false"}
      data-group-loading={isRunning ? "true" : undefined}
      data-preview-scrollable={showPreview ? (previewScrollable ? "true" : "false") : undefined}
      aria-busy={isRunning ? "true" : undefined}
    >
      <WorkGroupHeaderButton
        row={row}
        expanded={expanded}
        contentId={contentId}
        onToggle={handleToggle}
      />
      <div id={contentId} className="contents">
        {expanded ? (
          <div className="flex min-w-0 max-w-full flex-col gap-(--chat-timeline-step-gap)">
            {!isCommandGroup && !isThinkingGroup && !isWaitingGroup ? (
              <WorkGroupSummaryLine summary={row.summary} />
            ) : null}
            {row.steps.map((step) =>
              step.kind === "message" ? (
                <GroupedWorkMessageStep key={`work-row:${step.id}`} step={step} ctx={ctx} />
              ) : (
                <StepRenderer
                  key={`work-row:${step.id}`}
                  step={step}
                  editUserMessagesDisabled={editUserMessagesDisabled}
                  ctx={ctx}
                />
              ),
            )}
          </div>
        ) : showPreview ? (
          <WorkGroupPreview
            key={`work-preview:${row.id}`}
            row={row}
            onExpand={handleToggle}
            onPreviewScrollableChange={onPreviewScrollableChange}
            ctx={ctx}
          />
        ) : null}
      </div>
    </div>
  );
}

function WorkGroupHeaderButton({
  row,
  expanded,
  contentId,
  onToggle,
}: {
  row: WorkTimelineRow;
  expanded: boolean;
  contentId: string;
  onToggle: () => void;
}) {
  const summary = row.summary;
  const isRunning = row.isRunning;
  const isThinkingGroup = row.isThinkingGroup;
  const isWaitingGroup = row.isWaitingGroup;
  const [debouncedLoadingAction] = useDebouncedValue(summary.action, { wait: 200 });
  const actionText = isRunning ? debouncedLoadingAction : summary.action;
  const showCompletedSummary = !expanded && !isThinkingGroup && !isWaitingGroup && !isRunning;

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "group/work-header inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-(--chat-timeline-collapsible-header-gap) overflow-hidden",
        "h-auto border-0 bg-transparent px-(--conversation-text-inset) py-0 text-left shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
        "text-conversation text-multi-fg-tertiary",
        "hover:text-multi-fg-secondary focus-visible:text-multi-fg-secondary",
      )}
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={onToggle}
      data-work-group-header=""
    >
      {isWaitingGroup ? (
        <>
          <span className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-secondary">
            {actionText}
          </span>
          {!isRunning && summary.details ? (
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary tabular-nums">
              {summary.details}
            </span>
          ) : null}
        </>
      ) : isThinkingGroup ? (
        isRunning ? (
          <span className="shrink-0 whitespace-nowrap tabular-nums">{actionText}</span>
        ) : (
          <span className="shrink-0 whitespace-nowrap tabular-nums">
            {`Thought for ${row.completedDurationLabel ?? "briefly"}`}
          </span>
        )
      ) : isRunning ? (
        <span className="shrink-0 whitespace-nowrap tabular-nums">{actionText}</span>
      ) : (
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          {`Worked for ${row.completedDurationLabel ?? "briefly"}`}
        </span>
      )}
      {showCompletedSummary ? (
        <>
          <span aria-hidden="true" className="shrink-0 text-multi-fg-tertiary">
            ·
          </span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary tabular-nums">
            {summary.details}
          </span>
          <WorkGroupStats summary={summary} />
        </>
      ) : null}
      <IconChevronRightMedium
        className={cn(
          "size-3 shrink-0 text-multi-icon-tertiary transition-transform duration-(--motion-duration-collapsible) ease-out motion-reduce:transition-none",
          expanded && "rotate-90",
        )}
        aria-hidden="true"
      />
    </Button>
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
        editComposer={
          isEditingUserMessage ? (ctx.renderEditComposer?.(step.message) ?? null) : null
        }
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

function RuntimeToolStepRenderer({
  step,
  ctx,
}: {
  step: TimelineRuntimeToolStep;
  ctx: StepRendererContext;
}) {
  return (
    <RuntimeToolCallMessage
      tool={step.tool}
      projectRoot={ctx.projectRoot}
      activeThreadId={ctx.activeThreadId}
      environmentId={ctx.activeThreadEnvironmentId}
      subagentDetailsEnabled
    />
  );
}

function RuntimeTaskStepRenderer({
  step,
  ctx,
}: {
  step: TimelineRuntimeTaskStep;
  ctx: StepRendererContext;
}) {
  return (
    <RuntimeSubagentTaskMessage
      tool={step.tool}
      projectRoot={ctx.projectRoot}
      activeThreadId={ctx.activeThreadId}
      environmentId={ctx.activeThreadEnvironmentId}
      subagentDetailsEnabled
    />
  );
}

function GroupedWorkMessageStep({
  step,
  ctx,
}: {
  step: TimelineMessageStep;
  ctx: StepRendererContext;
}) {
  const isGroupedNarration =
    step.message.role === "assistant" && isShortPlainText(step.message.text.trim());
  if (isGroupedNarration) {
    return <GroupedMessageText step={step} ctx={ctx} />;
  }
  return <AssistantTranscriptRow message={step.message} markdownCwd={ctx.markdownCwd} />;
}

// Short assistant narration inside a work group renders as a plain markdown line (like
// thinking), not as a full transcript row. The preview CSS dims these via the group container.
function GroupedMessageText({
  step,
  ctx,
}: {
  step: TimelineMessageStep;
  ctx: StepRendererContext;
}) {
  const text = step.message.text.trim();
  if (!text) {
    return null;
  }
  return (
    <div
      className="min-w-0 py-0.5 text-conversation text-multi-fg-secondary"
      data-work-group-text=""
    >
      <ChatMarkdown
        text={text}
        cwd={ctx.markdownCwd}
        isStreaming={step.message.streaming === true}
        className="text-multi-fg-secondary"
      />
    </div>
  );
}

function RuntimeThinkingStepRenderer({
  step,
  ctx,
}: {
  step: TimelineRuntimeThinkingStep;
  ctx: StepRendererContext;
}) {
  const thinking = step.message.thinking?.trim();
  if (!thinking) {
    return null;
  }
  return (
    <div
      className="min-w-0 py-0.5 text-conversation text-multi-fg-tertiary"
      data-runtime-thinking=""
      data-runtime-thinking-streaming={step.message.streaming ? "true" : undefined}
    >
      <ChatMarkdown
        text={thinking}
        cwd={ctx.markdownCwd}
        isStreaming={step.message.streaming === true}
        className="text-multi-fg-tertiary"
      />
    </div>
  );
}

function RuntimeExtensionUiRequestStepRenderer({
  step,
}: {
  step: TimelineRuntimeExtensionUiRequestStep;
}) {
  return <RuntimeExtensionUiRequestMessage request={step.request} />;
}

function WaitingStepRenderer({ step }: { step: TimelineWaitingStep }) {
  return (
    <div
      className="flex w-full min-w-0 opacity-75"
      aria-busy="true"
      data-waiting-group=""
      data-waiting-step-id={step.id}
    >
      <WorkingStatusRow phase={step.phase} elapsedStartedAt={step.elapsedStartedAt} />
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
  onPreviewScrollableChange,
  ctx,
}: {
  row: WorkTimelineRow;
  onExpand: () => void;
  onPreviewScrollableChange: (scrollable: boolean) => void;
  ctx: StepRendererContext;
}) {
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const [previewScrollable, setPreviewScrollable] = useState(false);
  const steps = row.steps;
  const previewSteps = steps.filter(isRenderableWorkGroupPreviewStep);
  const lastStep = previewSteps.at(-1);
  const lastStepId = lastStep?.id;
  const previewStepCount = previewSteps.length;
  const lastRunningOutputStepId = resolveLastRunningPreviewOutputStepId(lastStep);
  const lastStepOutputScrollKey =
    lastStep && lastRunningOutputStepId === lastStep.id
      ? getPreviewStepOutputScrollKey(lastStep)
      : null;

  useLayoutSyncEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    host.scrollTop = host.scrollHeight;
    const scrollable = isPreviewScrollable(host);
    setPreviewScrollable(scrollable);
    onPreviewScrollableChange(scrollable);
  }, [lastStepId, lastStepOutputScrollKey, onPreviewScrollableChange, previewStepCount, row.id]);

  useLayoutSyncEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    if (typeof ResizeObserver === "undefined") {
      const scrollable = isPreviewScrollable(host);
      setPreviewScrollable(scrollable);
      onPreviewScrollableChange(scrollable);
      return;
    }
    const observer = new ResizeObserver(() => {
      host.scrollTop = host.scrollHeight;
      const scrollable = isPreviewScrollable(host);
      setPreviewScrollable(scrollable);
      onPreviewScrollableChange(scrollable);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [onPreviewScrollableChange]);

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
      {...(previewScrollable ? { "data-work-group-preview-dimmed": "" } : {})}
      className="flex w-full min-h-0 max-w-full cursor-pointer flex-col gap-(--chat-timeline-step-gap) overflow-x-hidden overflow-y-auto [overflow-anchor:none] scrollbar-thin"
    >
      {previewSteps.map((step) => (
        <WorkGroupPreviewStep
          key={`work-preview-row:${step.id}`}
          step={step}
          ctx={ctx}
          showOutputStrip={step.id === lastRunningOutputStepId}
        />
      ))}
    </div>
  );
}

function WorkGroupPreviewStep({
  step,
  ctx,
  showOutputStrip,
}: {
  step: TimelineGroupedStep;
  ctx: StepRendererContext;
  showOutputStrip: boolean;
}) {
  const output = showOutputStrip ? resolvePreviewStepOutput(step) : null;

  return (
    <div
      className="flex min-w-0 max-w-full flex-col gap-1"
      data-work-preview-step=""
      data-work-preview-output={output ? "true" : undefined}
    >
      {step.kind === "message" ? (
        <GroupedWorkMessageStep step={step} ctx={ctx} />
      ) : (
        <StepRenderer step={step} editUserMessagesDisabled={false} ctx={ctx} />
      )}
      {output ? <CompactToolOutputStrip output={output.text} loading={output.loading} /> : null}
    </div>
  );
}

function CompactToolOutputStrip({ output, loading }: { output: string; loading: boolean }) {
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const displayOutput = useMemo(
    () => resolveStreamingShellOutput(output, loading),
    [loading, output],
  );

  useLayoutSyncEffect(() => {
    const host = scrollRef.current;
    if (!host) return;
    host.scrollTop = host.scrollHeight;
  }, [displayOutput.text]);

  if (!hasRenderableText(displayOutput.text)) {
    return null;
  }

  return (
    <pre
      ref={scrollRef}
      data-work-preview-output=""
      className={cn(
        "m-0 overflow-x-hidden overflow-y-auto",
        "font-mono text-detail leading-[18px] text-multi-fg-tertiary",
        "whitespace-pre-wrap wrap-anywhere select-none",
        "[overflow-anchor:none] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
      style={{
        maxHeight: WORK_GROUP_PREVIEW_OUTPUT_STRIP_PX,
      }}
    >
      {displayOutput.text}
    </pre>
  );
}

function resolveLastRunningPreviewOutputStepId(
  lastStep: TimelineGroupedStep | undefined,
): string | null {
  if (!lastStep || !isPreviewShellOrEditStep(lastStep) || !isPreviewOutputStepRunning(lastStep)) {
    return null;
  }
  return resolvePreviewStepOutput(lastStep) ? lastStep.id : null;
}

/** Extra preview height when the last running shell/edit step shows the output strip. */
export function runningWorkGroupPreviewOutputStripExtraPx(
  steps: readonly TimelineGroupedStep[],
): number {
  const lastStep = findLastRenderableWorkGroupPreviewStep(steps);
  if (!lastStep || resolveLastRunningPreviewOutputStepId(lastStep) !== lastStep.id) {
    return 0;
  }

  return WORK_GROUP_PREVIEW_OUTPUT_STRIP_PX + WORK_GROUP_STEP_GAP_PX - WORK_GROUP_PREVIEW_ENTRY_PX;
}

export function countRenderableWorkGroupPreviewSteps(
  steps: readonly TimelineGroupedStep[],
): number {
  let count = 0;
  for (const step of steps) {
    if (isRenderableWorkGroupPreviewStep(step)) {
      count += 1;
    }
  }
  return count;
}

export function isRenderableWorkGroupPreviewStep(step: TimelineGroupedStep): boolean {
  return isPreviewableWorkGroupStep(step);
}

function findLastRenderableWorkGroupPreviewStep(
  steps: readonly TimelineGroupedStep[],
): TimelineGroupedStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step && isRenderableWorkGroupPreviewStep(step)) {
      return step;
    }
  }
  return undefined;
}

function getPreviewStepOutputScrollKey(step: TimelineStep): string {
  const output = resolvePreviewStepOutput(step);
  if (!output) {
    return step.id;
  }
  return `${step.id}:${output.text.length}:${output.loading ? "1" : "0"}`;
}

interface PreviewStepOutput {
  text: string;
  loading: boolean;
}

function isPreviewOutputStepRunning(step: TimelineStep): boolean {
  if (step.kind === "runtime-tool") {
    return step.tool.status === "running";
  }
  if (step.kind === "work") {
    return step.entry.status === "running";
  }
  return false;
}

function isPreviewShellOrEditStep(step: TimelineStep): boolean {
  if (step.kind === "runtime-tool") {
    const displayKind = step.tool.display?.kind;
    return displayKind === "shell" || displayKind === "edit";
  }
  if (step.kind === "work") {
    const entry = step.entry;
    if (
      entry.requestKind === "command" ||
      entry.itemType === "command_execution" ||
      entry.command
    ) {
      return true;
    }
    return (
      entry.requestKind === "file-change" ||
      entry.itemType === "file_change" ||
      (entry.changedFiles?.length ?? 0) > 0
    );
  }
  return false;
}

function resolvePreviewStepOutput(step: TimelineStep): PreviewStepOutput | null {
  if (step.kind === "runtime-tool") {
    const display = step.tool.display;
    if (display?.kind !== "shell" && display?.kind !== "edit") {
      return null;
    }
    const output = display.output?.trim();
    if (!output || !hasRenderableText(output)) {
      return null;
    }
    return {
      text: output,
      loading: step.tool.status === "running",
    };
  }

  if (step.kind === "work") {
    const entry = step.entry;
    const loading = entry.status === "running";
    const commandArtifact = entry.artifacts?.find((artifact) => artifact.type === "command");
    const shellOutput = commandArtifact?.output ?? (entry.command ? entry.output : null);
    if (shellOutput && hasRenderableText(shellOutput)) {
      return { text: shellOutput, loading };
    }

    const editDetail = entry.detail?.trim();
    if (
      editDetail &&
      hasRenderableText(editDetail) &&
      (entry.requestKind === "file-change" ||
        entry.itemType === "file_change" ||
        (entry.changedFiles?.length ?? 0) > 0)
    ) {
      return { text: editDetail, loading };
    }
  }

  return null;
}

function isPreviewScrollable(host: HTMLDivElement): boolean {
  return host.scrollHeight > host.clientHeight + 1;
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
