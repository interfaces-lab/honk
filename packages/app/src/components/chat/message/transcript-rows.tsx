import type { EnvironmentId, MessageId, ThreadId } from "@multi/contracts";
import { memo, type ReactNode } from "react";

import type { WorkLogEntry } from "../../../session-logic";
import type { ChatMessage } from "../../../types";
import type { ExpandedImagePreview } from "./expanded-image-preview";
import { AssistantMessage } from "./assistant-message";
import { HumanMessage } from "./human-message";
import { ThinkingStatus } from "./tool-renderer";
import { ToolCallMessage } from "./tool-message";

/**
 * Row wrappers shared by `MessagesTimeline` and `SubagentPreviewTray`.
 * Grouping, virtualization, and scroll behavior stay with their callers.
 */

export const AssistantTranscriptRow = memo(function AssistantTranscriptRow({
  message,
  markdownCwd,
}: {
  message: ChatMessage;
  markdownCwd: string | undefined;
}) {
  return (
    <div className="box-border flex w-full min-w-0 px-0">
      <AssistantMessage message={message} markdownCwd={markdownCwd} />
    </div>
  );
});

export interface HumanTranscriptRowProps {
  message: ChatMessage;
  editAvailable: boolean;
  isEditing: boolean;
  editDisabled: boolean;
  isServerThread: boolean;
  editComposer: ReactNode;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onBeginEditUserMessage?: ((messageId: MessageId) => void) | undefined;
}

export const HumanTranscriptRow = memo(function HumanTranscriptRow(
  props: HumanTranscriptRowProps,
) {
  return (
    <div className="box-border flex w-full min-w-0 px-0">
      <HumanMessage
        message={props.message}
        editAvailable={props.editAvailable}
        isEditing={props.isEditing}
        editDisabled={props.editDisabled}
        isServerThread={props.isServerThread}
        editComposer={props.editComposer}
        onImageExpand={props.onImageExpand}
        onBeginEditUserMessage={props.onBeginEditUserMessage}
      />
    </div>
  );
});

/**
 * Read-only user row for the subagent preview tray.
 */
export const ReadOnlyHumanTranscriptRow = memo(function ReadOnlyHumanTranscriptRow({
  message,
}: {
  message: ChatMessage;
}) {
  return (
    <div className="box-border flex w-full min-w-0 px-0">
      <HumanMessage
        message={message}
        editAvailable={false}
        isEditing={false}
        editDisabled
        isServerThread={false}
        editComposer={null}
        onImageExpand={noopImageExpand}
        onBeginEditUserMessage={undefined}
      />
    </div>
  );
});

function noopImageExpand(_preview: ExpandedImagePreview): void {
  return;
}

export const ToolTranscriptRow = memo(function ToolTranscriptRow({
  activeThreadId,
  environmentId,
  projectRoot,
  subagentDetailsEnabled,
  workEntry,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  projectRoot: string | undefined;
  subagentDetailsEnabled: boolean;
  workEntry: WorkLogEntry;
}) {
  return (
    <ToolCallMessage
      activeThreadId={activeThreadId}
      environmentId={environmentId}
      projectRoot={projectRoot}
      subagentDetailsEnabled={subagentDetailsEnabled}
      workEntry={workEntry}
    />
  );
});

export const ThinkingTranscriptRow = memo(function ThinkingTranscriptRow({
  task,
  active,
}: {
  task: string;
  active: boolean;
}) {
  return <ThinkingStatus active={active} task={task} wrap />;
});
