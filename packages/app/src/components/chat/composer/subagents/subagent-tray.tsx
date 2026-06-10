import {
  isToolLifecycleItemType,
  type EnvironmentId,
  MessageId,
  type ThreadId,
  type ToolLifecycleItemType,
} from "@multi/contracts";
import { IconCrossSmall } from "central-icons";
import { memo, useEffect } from "react";
import { Button } from "@multi/multikit/button";
import { ToolCallLine } from "@multi/multikit/tool-call";
import { ExpandableToolMetadataLine } from "../../message/tool-renderer";
import { cn } from "~/lib/utils";
import {
  type SubagentTranscriptItem,
  type WorkLogEntry,
  type WorkLogSubagent,
  type WorkLogSubagentLog,
} from "../../../../session-logic";
import {
  isSubagentTrayLogVisible,
  useSubagentTrayStore,
  type SubagentTraySelection,
} from "../../../../stores/subagent-tray-store";
import {
  refreshSubagentActivityProjection,
  selectSubagentProjection,
  useSubagentActivityStore,
} from "../../../../stores/subagent-activity-store";
import { StepRenderer, type StepRendererContext } from "../../timeline/step-renderer";
import { type TimelineStep } from "../../timeline/timeline-render-items";

const EMPTY_SUBAGENT_LOGS: ReadonlyArray<WorkLogSubagentLog> = [];
const EMPTY_SUBAGENT_TRANSCRIPT_ITEMS: ReadonlyArray<SubagentTranscriptItem> = [];
type WorkLogStatus = NonNullable<WorkLogEntry["status"]>;

export function SubagentTrayStack(props: {
  activeThreadId: ThreadId | null;
  compact: boolean;
  visible: boolean;
}) {
  const focus = useSubagentTrayStore((state) => state.focus);
  const closeTray = useSubagentTrayStore((state) => state.closeTray);
  const setTrayPresented = useSubagentTrayStore((state) => state.setTrayPresented);
  const trayKey = focus?.key ?? null;
  const trayActiveThreadId = focus?.activeThreadId ?? null;
  const belongsToActiveThread =
    props.activeThreadId !== null && trayActiveThreadId === props.activeThreadId;
  const presented = shouldPresentSubagentTray({
    activeThreadId: props.activeThreadId,
    hasFocus: focus !== null,
    trayActiveThreadId,
    visible: props.visible,
  });
  const activeThreadSync = (
    <SubagentTrayActiveThreadSync
      key={`${props.activeThreadId ?? ""}:${trayKey ?? ""}:${belongsToActiveThread ? "1" : "0"}:${presented ? "1" : "0"}`}
      belongsToActiveThread={belongsToActiveThread}
      closeTray={closeTray}
      setTrayPresented={setTrayPresented}
      presented={presented}
      trayKey={trayKey}
    />
  );

  if (!focus || !belongsToActiveThread || !props.visible) {
    return activeThreadSync;
  }

  return (
    <>
      {activeThreadSync}
      <div
        className={cn("relative w-full min-w-0", props.compact ? "mx-auto w-full" : "")}
        data-subagent-followup-tray-stack=""
      >
        <div
          className={cn("font-multi text-conversation", props.compact ? "w-full" : "")}
          data-subagent-followup-tray=""
          data-subagent-tray-open=""
        >
          <SubagentTray selection={focus} onClose={closeTray} />
        </div>
      </div>
    </>
  );
}

export function shouldPresentSubagentTray(input: {
  activeThreadId: ThreadId | null;
  trayActiveThreadId: ThreadId | null;
  hasFocus: boolean;
  visible: boolean;
}): boolean {
  return (
    input.hasFocus &&
    input.visible &&
    input.activeThreadId !== null &&
    input.trayActiveThreadId === input.activeThreadId
  );
}

function SubagentTrayActiveThreadSync({
  belongsToActiveThread,
  closeTray,
  setTrayPresented,
  presented,
  trayKey,
}: {
  belongsToActiveThread: boolean;
  closeTray: () => void;
  setTrayPresented: (presented: boolean) => void;
  presented: boolean;
  trayKey: string | null;
}) {
  useEffect(() => {
    setTrayPresented(trayKey !== null && presented);
    if (trayKey !== null && !belongsToActiveThread) {
      closeTray();
    }
  }, [belongsToActiveThread, closeTray, presented, trayKey, setTrayPresented]);

  return null;
}

function SubagentTray(props: { selection: SubagentTraySelection; onClose: () => void }) {
  const { selection, onClose } = props;
  useEffect(() => {
    refreshSubagentActivityProjection({
      environmentId: selection.environmentId,
      threadId: selection.activeThreadId,
    });
  }, [selection.activeThreadId, selection.environmentId, selection.key]);
  const subagent = useFocusedSubagent(selection);
  const title = subagent?.title ?? subagent?.nickname ?? subagent?.role ?? "Subagent";
  const subagentThreadId = subagent?.subagentThreadId ?? selection.subagentThreadId;

  return (
    <div
      className="flex w-full min-w-0 flex-col overflow-hidden text-multi-fg-primary"
      data-subagent-tray-container=""
      data-subagent-thread-id={subagentThreadId}
    >
      <div
        className="flex min-w-0 shrink-0 items-center gap-2 px-3 py-2"
        data-subagent-tray-header=""
      >
        <div
          className="min-w-0 flex-1 truncate text-title font-medium text-multi-fg-primary"
          title={title}
        >
          {title}
        </div>
        <Button
          className="ml-auto shrink-0 text-multi-icon-secondary hover:text-multi-icon-primary"
          size="icon-sm"
          variant="ghost"
          aria-label="Close subagent tray"
          title="Close subagent tray"
          onClick={onClose}
        >
          <IconCrossSmall className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <SubagentTrayBody
        key={subagentTrayBodyKey(selection)}
        selection={selection}
        subagent={subagent}
      />
    </div>
  );
}

function subagentTrayBodyKey(selection: SubagentTraySelection): string {
  return [
    selection.activeThreadId,
    selection.environmentId,
    selection.key,
    selection.subagentThreadId?.trim() ?? "",
    selection.threadId ?? "",
    selection.agentId ?? "",
  ].join("\u001f");
}

function SubagentTrayBody(props: {
  selection: SubagentTraySelection;
  subagent: WorkLogSubagent | null;
}) {
  const { activeThreadId, environmentId, projectRoot } = props.selection;
  const { subagent } = props;
  const transcriptItems = subagent?.transcriptItems ?? EMPTY_SUBAGENT_TRANSCRIPT_ITEMS;
  const logs = subagent?.logs ?? EMPTY_SUBAGENT_LOGS;
  const renderableTranscriptItems = transcriptItems.filter(hasRenderableSubagentTranscriptItem);
  const hasActivityTranscript = renderableTranscriptItems.length > 0;
  const runningLogs = deriveVisibleSubagentLogs(logs, hasActivityTranscript);
  const streamingLogId = runningLogs.at(-1)?.id;

  return (
    <div
      data-subagent-tray-body=""
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-(--chat-timeline-step-gap) px-3 py-2 text-conversation text-multi-fg-primary"
    >
      {hasActivityTranscript ? (
        <SubagentActivityTranscriptSection
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          isStreaming={subagent?.isActive === true}
          items={renderableTranscriptItems}
          projectRoot={projectRoot}
        />
      ) : null}
      {runningLogs.length > 0 ? (
        <div
          data-subagent-running-log=""
          className="flex min-w-0 flex-col gap-(--chat-timeline-step-gap)"
        >
          {runningLogs.map((log) => (
            <SubagentActivityLine
              key={log.id}
              action={log.label}
              detail={log.detail}
              loading={log.id === streamingLogId}
            />
          ))}
        </div>
      ) : null}
      {!hasActivityTranscript && runningLogs.length === 0 ? (
        <div className="py-1 text-detail text-multi-fg-tertiary">No thread content yet.</div>
      ) : null}
    </div>
  );
}

function useFocusedSubagent(selection: SubagentTraySelection): WorkLogSubagent | null {
  return useSubagentActivityStore((state) => {
    const subagentThreadId = selectedSubagentThreadId(selection);
    if (!subagentThreadId) {
      return null;
    }
    return (
      selectSubagentProjection(state, {
        environmentId: selection.environmentId,
        threadId: selection.activeThreadId,
      }).subagentById[subagentThreadId] ?? null
    );
  });
}

function selectedSubagentThreadId(selection: SubagentTraySelection): string | null {
  return (
    selection.subagentThreadId?.trim() || selection.threadId?.trim() || selection.key.trim() || null
  );
}

function SubagentActivityTranscriptSection({
  activeThreadId,
  environmentId,
  isStreaming,
  items,
  projectRoot,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  items: ReadonlyArray<SubagentTranscriptItem>;
  projectRoot: string | undefined;
}) {
  return (
    <div
      data-subagent-activity-transcript=""
      className="flex min-w-0 flex-col gap-(--chat-timeline-step-gap)"
    >
      {items.map((item, index) => (
        <SubagentTranscriptItemRow
          key={item.id}
          activeThreadId={activeThreadId}
          environmentId={environmentId}
          isStreaming={isStreaming && index === items.length - 1 && item.loading}
          item={item}
          projectRoot={projectRoot}
        />
      ))}
    </div>
  );
}

interface SubagentTranscriptItemRowProps {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  isStreaming: boolean;
  item: SubagentTranscriptItem;
  projectRoot: string | undefined;
}

export const SubagentTranscriptItemRow = memo(function SubagentTranscriptItemRow({
  activeThreadId,
  environmentId,
  isStreaming,
  item,
  projectRoot,
}: SubagentTranscriptItemRowProps) {
  const detail = item.text;
  const messageRole = subagentTranscriptMessageRole(item);

  if (messageRole === "assistant") {
    if (!detail) {
      return null;
    }
    return (
      <SubagentTimelineStep
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        projectRoot={projectRoot}
        step={subagentMessageStep({
          id: item.itemId,
          role: "assistant",
          text: detail,
          createdAt: item.createdAt,
          streaming: isStreaming,
        })}
      />
    );
  }

  if (messageRole === "user") {
    if (!detail) {
      return null;
    }
    return (
      <SubagentTimelineStep
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        projectRoot={projectRoot}
        step={subagentMessageStep({
          id: item.itemId,
          role: "user",
          text: detail,
          createdAt: item.createdAt,
          streaming: false,
        })}
      />
    );
  }

  if (isSubagentReasoningTranscriptItem(item)) {
    return detail ? (
      <SubagentTimelineStep
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        projectRoot={projectRoot}
        step={subagentThinkingStep(item.id, item.createdAt, detail, isStreaming)}
      />
    ) : null;
  }

  if (item.kind === "command" || item.kind === "tool") {
    return (
      <SubagentTimelineStep
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        projectRoot={projectRoot}
        step={subagentTranscriptItemStep(item, isStreaming)}
      />
    );
  }

  return (
    <SubagentActivityLine
      action={item.title ?? formatSnapshotTypeLabel(item.itemType ?? item.kind)}
      detail={detail}
      loading={isStreaming}
    />
  );
}, areSameSubagentTranscriptItemRowProps);

function areSameSubagentTranscriptItemRowProps(
  previous: SubagentTranscriptItemRowProps,
  next: SubagentTranscriptItemRowProps,
): boolean {
  return (
    previous.activeThreadId === next.activeThreadId &&
    previous.environmentId === next.environmentId &&
    previous.isStreaming === next.isStreaming &&
    previous.projectRoot === next.projectRoot &&
    areSameSubagentTranscriptItem(previous.item, next.item)
  );
}

function areSameSubagentTranscriptItem(
  previous: SubagentTranscriptItem,
  next: SubagentTranscriptItem,
): boolean {
  return (
    previous.id === next.id &&
    previous.itemId === next.itemId &&
    previous.kind === next.kind &&
    previous.role === next.role &&
    previous.title === next.title &&
    previous.text === next.text &&
    previous.command === next.command &&
    previous.rawCommand === next.rawCommand &&
    previous.output === next.output &&
    previous.changedFiles?.join("\u0000") === next.changedFiles?.join("\u0000") &&
    previous.itemType === next.itemType &&
    previous.status === next.status &&
    previous.streamKind === next.streamKind &&
    previous.loading === next.loading &&
    previous.createdAt === next.createdAt &&
    previous.sequence === next.sequence
  );
}

function SubagentTimelineStep({
  activeThreadId,
  environmentId,
  projectRoot,
  step,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  projectRoot: string | undefined;
  step: TimelineStep;
}) {
  const ctx: StepRendererContext = {
    markdownCwd: projectRoot,
    projectRoot,
    activeThreadId,
    activeThreadEnvironmentId: environmentId,
    isServerThread: false,
    onBeginEditUserMessage: undefined,
    renderEditComposer: undefined,
    onUpdateProposedPlan: undefined,
    onImageExpand: noopImageExpand,
  };

  return <StepRenderer step={step} editUserMessagesDisabled ctx={ctx} />;
}

function noopImageExpand(): void {
  return;
}

function subagentTranscriptItemStep(
  item: SubagentTranscriptItem,
  isStreaming: boolean,
): TimelineStep {
  const workEntry = subagentTranscriptItemToWorkEntry(item, isStreaming);
  return subagentWorkStep(`subagent-tool-step:${item.id}`, item.createdAt, workEntry);
}

function subagentMessageStep(input: {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  streaming: boolean;
}): TimelineStep {
  const messageId = MessageId.make(input.id);
  return {
    kind: "message",
    id: `subagent-message-step:${input.id}`,
    createdAt: input.createdAt,
    message: {
      id: messageId,
      role: input.role,
      text: input.text,
      turnId: null,
      streaming: input.streaming,
      createdAt: input.createdAt,
    },
    durationStart: input.createdAt,
    editAvailable: false,
    pairId: input.role === "user" ? messageId : null,
    messageIndex: 0,
  };
}

function subagentThinkingStep(
  id: string,
  createdAt: string,
  label: string,
  isStreaming: boolean,
): TimelineStep {
  return subagentWorkStep(`subagent-thinking-step:${id}`, createdAt, {
    id: `subagent-thinking:${id}`,
    createdAt,
    label,
    tone: "thinking",
    status: isStreaming ? "running" : "completed",
  });
}

function subagentWorkStep(id: string, createdAt: string, entry: WorkLogEntry): TimelineStep {
  return {
    kind: "work",
    id,
    createdAt,
    entry,
  };
}

export function hasRenderableSubagentTranscriptItem(item: SubagentTranscriptItem): boolean {
  if (subagentTranscriptMessageRole(item)) {
    return Boolean(item.text?.trim());
  }
  if (isSubagentReasoningTranscriptItem(item) || item.kind === "plan") {
    return Boolean(item.text?.trim());
  }
  if (item.kind === "command") {
    return Boolean(item.command?.trim() || item.output?.trim() || item.text?.trim());
  }
  if (item.itemType === "collab_agent_tool_call") {
    return false;
  }
  if (item.kind === "tool") {
    return true;
  }
  return Boolean(item.text?.trim());
}

function subagentTranscriptMessageRole(
  item: SubagentTranscriptItem,
): "user" | "assistant" | undefined {
  if (item.role === "user" || item.role === "assistant") {
    return item.role;
  }
  switch (item.itemType) {
    case "user_message":
      return "user";
    case "assistant_message":
      return "assistant";
    default:
      break;
  }
  switch (item.title) {
    case "User message":
      return "user";
    case "Assistant message":
      return "assistant";
    default:
      return undefined;
  }
}

function isSubagentReasoningTranscriptItem(item: SubagentTranscriptItem): boolean {
  if (item.kind === "reasoning") {
    return true;
  }
  switch (item.itemType) {
    case "reasoning":
      return true;
    default:
      return item.title === "Reasoning";
  }
}

function subagentTranscriptItemToWorkEntry(
  item: SubagentTranscriptItem,
  isStreaming: boolean,
): WorkLogEntry {
  const itemType =
    item.kind === "command" ? "command_execution" : toToolLifecycleItemType(item.itemType);
  const label = item.title ?? formatSnapshotTypeLabel(itemType ?? item.itemType ?? item.kind);
  const status = resolveSubagentToolStatus(item.status, isStreaming || item.loading);
  return {
    id: `subagent-tool:${item.id}`,
    createdAt: item.createdAt,
    label,
    tone: status === "error" ? "error" : "tool",
    status,
    toolCallId: item.itemId,
    ...(itemType ? { itemType } : {}),
    ...(item.text ? { detail: item.text } : {}),
    ...(item.command ? { command: item.command } : {}),
    ...(item.rawCommand ? { rawCommand: item.rawCommand } : {}),
    ...(item.output ? { output: item.output } : {}),
    ...(item.changedFiles?.length ? { changedFiles: item.changedFiles } : {}),
    ...(item.title ? { toolTitle: item.title } : {}),
  };
}

function toToolLifecycleItemType(value: string | undefined): ToolLifecycleItemType | null {
  return value && isToolLifecycleItemType(value) ? value : null;
}

function resolveSubagentToolStatus(
  status: string | undefined,
  isStreaming: boolean,
): WorkLogStatus {
  if (status === "failed" || status === "error") {
    return "error";
  }
  if (isStreaming || status === "running" || status === "inProgress") {
    return "running";
  }
  return "completed";
}

function SubagentActivityLine({
  action,
  detail,
  loading = false,
}: {
  action: string;
  detail?: string | undefined;
  loading?: boolean | undefined;
}) {
  const body = detail?.trim();
  if (body && shouldExpandSubagentActivityDetail(body)) {
    return (
      <ExpandableToolMetadataLine
        icon={undefined}
        action={action}
        details=""
        output={body}
        loading={loading}
        defaultExpanded={loading}
      />
    );
  }

  return <ToolCallLine action={action} details={body ?? ""} loading={loading} />;
}

function shouldExpandSubagentActivityDetail(detail: string): boolean {
  return detail.includes("\n") || detail.length > 160;
}

function formatSnapshotTypeLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function deriveVisibleSubagentLogs(
  logs: ReadonlyArray<WorkLogSubagentLog>,
  hasCanonicalTranscript: boolean,
): ReadonlyArray<WorkLogSubagentLog> {
  const visibleLogs: WorkLogSubagentLog[] = [];
  for (const log of logs) {
    if (!isSubagentTrayLogVisible(log, hasCanonicalTranscript)) {
      continue;
    }
    visibleLogs.push(log);
  }
  return visibleLogs.slice(-80);
}
