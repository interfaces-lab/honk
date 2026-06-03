import type { MessageId } from "@multi/contracts";
import { type ReactNode } from "react";

import type { ChatMessage } from "../../../types";
import type { ExpandedImagePreview } from "./expanded-image-preview";
import { AssistantMessage } from "./assistant-message";
import { HumanMessage } from "./human-message";

/**
 * Row wrappers shared by the canonical timeline step renderer.
 * Grouping, virtualization, and scroll behavior stay with their callers.
 */

export function AssistantTranscriptRow({
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
}

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

export function HumanTranscriptRow(props: HumanTranscriptRowProps) {
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
}
