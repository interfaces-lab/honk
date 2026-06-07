import type { MessageId } from "@multi/contracts";
import { useRef } from "react";
import { Button } from "@multi/multikit/button";

import {
  type ComposerImageAttachment,
  type DraftId as ComposerDraftId,
  useComposerThreadDraft,
} from "../../../stores/chat-drafts";
import type { ChatMessage } from "../../../types";
import { deriveComposerSendState, type ComposerSubmitContext } from "../composer-submit";
import {
  ComposerInput,
  type ComposerInputHandle,
  type ComposerInputProps,
} from "../composer/input";

const ignoreToggleInteractionMode = () => {};
const ignoreInteractionModeChange = (_mode: ComposerInputProps["interactionMode"]) => {};

export type InlineEditSubmitInput = {
  sendContext: ComposerSubmitContext;
  interactionMode: ComposerInputProps["interactionMode"];
};

type InlineMessageEditComposerProps = Pick<
  ComposerInputProps,
  | "environmentId"
  | "draftId"
  | "activeThreadId"
  | "phase"
  | "isConnecting"
  | "isSendBusy"
  | "isPreparingWorktree"
  | "interactionMode"
  | "activeContextWindow"
  | "resolvedTheme"
  | "settings"
  | "keybindings"
  | "terminalOpen"
  | "gitCwd"
  | "onInterrupt"
  | "setThreadError"
  | "onExpandImage"
> & {
  composerDraftTarget: ComposerDraftId;
  message: ChatMessage;
  onCancelEditUserMessage: (messageId: MessageId) => void;
  onSubmitEditUserMessage: (messageId: MessageId, input: InlineEditSubmitInput) => Promise<boolean>;
};

export function InlineMessageEditComposer({
  composerDraftTarget,
  message,
  onCancelEditUserMessage,
  onSubmitEditUserMessage,
  interactionMode,
  settings,
  ...composerProps
}: InlineMessageEditComposerProps) {
  const composerRef = useRef<ComposerInputHandle | null>(null);
  const editDraft = useComposerThreadDraft(composerDraftTarget);
  const promptRef = useRef(editDraft.prompt || message.text);
  const composerImagesRef = useRef<ComposerImageAttachment[]>(editDraft.images);
  const inlineInteractionMode = editDraft.interactionMode ?? interactionMode;
  const submitState = deriveComposerSendState({
    prompt: editDraft.prompt,
    imageCount: editDraft.images.length,
  });
  const submitDisabled =
    (editDraft.prompt === message.text && editDraft.images.length === 0) ||
    !submitState.hasSendableContent;

  const setInlineComposerRef = (composer: ComposerInputHandle | null) => {
    composerRef.current = composer;
    if (!composer) return;
    composer.focusAtEnd();
  };

  const handleCancel = () => {
    onCancelEditUserMessage(message.id);
  };

  const handleSend: ComposerInputProps["onSend"] = (event) => {
    event?.preventDefault();
    if (submitDisabled) {
      return;
    }
    const sendContext = composerRef.current?.getSendContext();
    if (!sendContext) {
      return;
    }
    void onSubmitEditUserMessage(message.id, {
      sendContext,
      interactionMode: inlineInteractionMode,
    });
  };

  const cancelButton = (
    <Button className="rounded-full px-2.5" size="sm" variant="ghost" onClick={handleCancel}>
      Cancel
    </Button>
  );

  return (
    <div className="box-border w-full min-w-0">
      <ComposerInput
        {...composerProps}
        ref={setInlineComposerRef}
        variant="compact"
        layout="inline-edit"
        composerDraftTarget={composerDraftTarget}
        interactionMode={inlineInteractionMode}
        settings={settings}
        promptRef={promptRef}
        composerImagesRef={composerImagesRef}
        footerSecondaryAction={cancelButton}
        onSend={handleSend}
        toggleInteractionMode={ignoreToggleInteractionMode}
        handleInteractionModeChange={ignoreInteractionModeChange}
        submitDisabled={submitDisabled}
      />
    </div>
  );
}
