import {
  type EnvironmentId,
  type RuntimeDisplayTimelineCustomMessageItem,
  type ThreadId,
} from "@multi/contracts";
import { Button } from "@multi/multikit/button";
import { IconChevronRightMedium } from "central-icons";
import { useRef, type ReactNode } from "react";

import { type ChatMessage, type ProposedPlan } from "../../../types";
import { cn } from "~/lib/utils";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { WorkingStatusRow } from "../message/status-row";
import {
  RuntimeExtensionUiRequestMessage,
  RuntimeToolCallMessage,
  ToolCallMessage,
} from "../message/tool-message";
import { ProposedPlanMessage } from "../message/proposed-plan-message";
import { AssistantTranscriptRow, HumanTranscriptRow } from "../message/transcript-rows";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import ChatMarkdown from "../markdown/chat-markdown";
import {
  type TimelineCustomMessageStep,
  type TimelineMessageStep,
  type TimelineProposedPlanStep,
  type TimelineRuntimeExtensionUiRequestStep,
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

    case "custom-message":
      return <CustomMessageStepRenderer step={step} ctx={ctx} />;

    case "runtime-tool":
      return <RuntimeToolStepRenderer step={step} ctx={ctx} />;

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
      data-group-loading={isRunning ? "true" : undefined}
      aria-busy={isRunning ? "true" : undefined}
    >
      <Button
        type="button"
        variant="ghost"
        className={cn(
          "group/work-header inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-(--chat-timeline-collapsible-header-gap) overflow-hidden",
          "h-auto border-0 bg-transparent p-0 text-left shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent",
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
      </Button>
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

function CustomMessageStepRenderer({
  step,
  ctx,
}: {
  step: TimelineCustomMessageStep;
  ctx: StepRendererContext;
}) {
  return (
    <RuntimeCustomMessageRow customMessage={step.customMessage} markdownCwd={ctx.markdownCwd} />
  );
}

function RuntimeCustomMessageRow({
  customMessage,
  markdownCwd,
}: {
  customMessage: RuntimeDisplayTimelineCustomMessageItem;
  markdownCwd: string | undefined;
}) {
  const rendered = renderRuntimeCustomMessage(customMessage, { markdownCwd });
  return rendered ?? (
    <UnknownRuntimeCustomMessageRow customMessage={customMessage} markdownCwd={markdownCwd} />
  );
}

type RuntimeCustomMessageRenderer = (
  customMessage: RuntimeDisplayTimelineCustomMessageItem,
  options: { markdownCwd: string | undefined },
) => ReactNode;

const runtimeCustomMessageRenderers: Readonly<Record<string, RuntimeCustomMessageRenderer>> = {
  "git-agent-action": RuntimeMarkdownCustomMessageRow,
  "plan-complete": RuntimeMarkdownCustomMessageRow,
  "plan-mode-execute": RuntimeMarkdownCustomMessageRow,
  "plan-todo-list": RuntimeMarkdownCustomMessageRow,
  "status-update": RuntimeMarkdownCustomMessageRow,
};

function renderRuntimeCustomMessage(
  customMessage: RuntimeDisplayTimelineCustomMessageItem,
  options: { markdownCwd: string | undefined },
): ReactNode {
  return runtimeCustomMessageRenderers[customMessage.customType]?.(customMessage, options) ?? null;
}

function RuntimeMarkdownCustomMessageRow(
  customMessage: RuntimeDisplayTimelineCustomMessageItem,
  options: { markdownCwd: string | undefined },
) {
  const text = runtimeCustomMessageText(customMessage);
  if (!text) {
    return null;
  }
  return (
    <div
      className="box-border flex w-full min-w-0 px-0"
      data-runtime-custom-message=""
      data-runtime-custom-message-type={customMessage.customType}
      data-runtime-custom-message-renderer="markdown"
    >
      <div className="box-border flex w-full max-w-agent-chat flex-col gap-1 text-conversation text-multi-fg-primary">
        <ChatMarkdown text={text} cwd={options.markdownCwd} />
      </div>
    </div>
  );
}

function UnknownRuntimeCustomMessageRow({
  customMessage,
  markdownCwd,
}: {
  customMessage: RuntimeDisplayTimelineCustomMessageItem;
  markdownCwd: string | undefined;
}) {
  const text = runtimeCustomMessageText(customMessage);
  return (
    <div
      className="box-border flex w-full min-w-0 px-0"
      data-runtime-custom-message=""
      data-runtime-custom-message-type={customMessage.customType}
      data-runtime-custom-message-renderer="unknown"
    >
      <div className="box-border flex w-full max-w-agent-chat flex-col gap-1 text-conversation text-multi-fg-primary">
        <div className="select-none text-caption text-multi-fg-tertiary">
          [{customMessage.customType}]
        </div>
        {text ? <ChatMarkdown text={text} cwd={markdownCwd} /> : null}
      </div>
    </div>
  );
}

function runtimeCustomMessageText(
  customMessage: RuntimeDisplayTimelineCustomMessageItem,
): string {
  if (typeof customMessage.content === "string") {
    return customMessage.content;
  }
  if (Array.isArray(customMessage.content)) {
    return customMessage.content
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const record = entry as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
      })
      .join("\n");
  }
  return customMessage.text ?? "";
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
      className="min-w-0 py-0.5 text-conversation text-multi-fg-secondary"
      data-runtime-thinking=""
      data-runtime-thinking-streaming={step.message.streaming ? "true" : undefined}
    >
      <ChatMarkdown
        text={thinking}
        cwd={ctx.markdownCwd}
        isStreaming={step.message.streaming === true}
        className="text-multi-fg-secondary"
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
