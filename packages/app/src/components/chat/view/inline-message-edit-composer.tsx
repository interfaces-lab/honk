import type { MessageId } from "@honk/shared/base-schemas";
import { useRef } from "react";
import { Button } from "@honk/honkkit/button";

import {
  type ComposerImageAttachment,
  type DraftId as ComposerDraftId,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../../stores/chat-drafts";
import type { ChatMessage } from "../../../types";
import { deriveComposerSendState, type ComposerSubmitContext } from "../composer-submit";
import {
  ComposerInput,
  type ComposerInputHandle,
  type ComposerInputProps,
} from "../composer/input";

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
  | "isTurnRunning"
  | "isConnecting"
  | "isSendBusy"
  | "isPreparingWorktree"
  | "interactionMode"
  | "modelSelection"
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

export function isInlineEditSubmitDisabled(input: {
  readonly hasSendableContent: boolean;
}): boolean {
  return !input.hasSendableContent;
}

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
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const promptRef = useRef(editDraft.prompt || message.text);
  const composerImagesRef = useRef<ComposerImageAttachment[]>(editDraft.images);
  const inlineInteractionMode = editDraft.interactionMode ?? interactionMode;
  const submitState = deriveComposerSendState({
    prompt: editDraft.prompt,
    imageCount: editDraft.images.length,
  });
  const submitDisabled = isInlineEditSubmitDisabled(submitState);

  const setInlineComposerRef = (composer: ComposerInputHandle | null) => {
    composerRef.current = composer;
    if (!composer) return;
    composer.focusAtEnd();
  };

  const handleCancel = () => {
    onCancelEditUserMessage(message.id);
  };

  const handleInteractionModeChange: ComposerInputProps["handleInteractionModeChange"] = (
    mode,
    focusMode = "end",
  ) => {
    setComposerDraftInteractionMode(composerDraftTarget, mode);
    if (focusMode === "preserve") {
      composerRef.current?.focus();
      return;
    }
    composerRef.current?.focusAtEnd();
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
        handleInteractionModeChange={handleInteractionModeChange}
        submitDisabled={submitDisabled}
      />
    </div>
  );
}
