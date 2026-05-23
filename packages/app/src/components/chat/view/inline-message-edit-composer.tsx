import type { MessageId, ModelSelection, RuntimeMode } from "@multi/contracts";
import { memo, useCallback, useRef } from "react";

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

const ignoreToggleInteractionMode = () => {};
const ignoreInteractionModeChange = (_mode: ComposerInputProps["interactionMode"]) => {};

export type InlineEditSubmitInput = {
  sendContext: ComposerSubmitContext;
  runtimeMode: RuntimeMode;
  interactionMode: ComposerInputProps["interactionMode"];
};

type InlineMessageEditComposerProps = Pick<
  ComposerInputProps,
  | "environmentId"
  | "routeKind"
  | "routeThreadRef"
  | "draftId"
  | "activeThreadId"
  | "activeThreadEnvironmentId"
  | "activeThread"
  | "isServerThread"
  | "isLocalDraftThread"
  | "phase"
  | "isConnecting"
  | "isSendBusy"
  | "isPreparingWorktree"
  | "interactionMode"
  | "providerStatuses"
  | "activeProjectDefaultModelSelection"
  | "activeThreadModelSelection"
  | "activeThreadActivities"
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
  runtimeMode: RuntimeMode;
  message: ChatMessage;
  onCancelEditUserMessage: (messageId: MessageId) => void;
  onSubmitEditUserMessage: (messageId: MessageId, input: InlineEditSubmitInput) => Promise<boolean>;
};

export const InlineMessageEditComposer = memo(function InlineMessageEditComposer({
  composerDraftTarget,
  message,
  onCancelEditUserMessage,
  onSubmitEditUserMessage,
  runtimeMode,
  interactionMode,
  providerStatuses,
  settings,
  ...composerProps
}: InlineMessageEditComposerProps) {
  const composerRef = useRef<ComposerInputHandle | null>(null);
  const editDraft = useComposerThreadDraft(composerDraftTarget);
  const promptRef = useRef(editDraft.prompt || message.text);
  const composerImagesRef = useRef<ComposerImageAttachment[]>(editDraft.images);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const inlineInteractionMode = editDraft.interactionMode ?? interactionMode;
  const submitState = deriveComposerSendState({
    prompt: editDraft.prompt,
    imageCount: editDraft.images.length,
  });
  const submitDisabled =
    (editDraft.prompt === message.text && editDraft.images.length === 0) ||
    !submitState.hasSendableContent;

  const scheduleComposerFocus = useCallback(() => {
    composerRef.current?.focusAtEnd();
  }, []);

  const setInlineComposerRef = useCallback((composer: ComposerInputHandle | null) => {
    composerRef.current = composer;
    if (!composer) return;
    composer.focusAtEnd();
  }, []);

  const handleProviderModelSelect = useCallback(
    (selection: ModelSelection) => {
      setComposerDraftModelSelection(composerDraftTarget, selection);
      setStickyComposerModelSelection(selection);
      scheduleComposerFocus();
    },
    [
      composerDraftTarget,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
    ],
  );

  const handleCancel = useCallback(() => {
    onCancelEditUserMessage(message.id);
  }, [message.id, onCancelEditUserMessage]);

  const handleSend = useCallback<ComposerInputProps["onSend"]>(
    (event) => {
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
        runtimeMode,
        interactionMode: inlineInteractionMode,
      });
    },
    [inlineInteractionMode, message.id, onSubmitEditUserMessage, runtimeMode, submitDisabled],
  );

  const cancelButton = (
    <button
      type="button"
      className="rounded-full px-2.5 py-1 text-body text-multi-fg-secondary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
      onClick={handleCancel}
    >
      Cancel
    </button>
  );

  return (
    <div className="box-border w-full min-w-0">
      <ComposerInput
        {...composerProps}
        ref={setInlineComposerRef}
        variant="compact"
        layout="inline-edit"
        modelPickerPlacement="bottom-start"
        composerDraftTarget={composerDraftTarget}
        interactionMode={inlineInteractionMode}
        providerStatuses={providerStatuses}
        settings={settings}
        promptRef={promptRef}
        composerImagesRef={composerImagesRef}
        footerSecondaryAction={cancelButton}
        onSend={handleSend}
        onProviderModelSelect={handleProviderModelSelect}
        toggleInteractionMode={ignoreToggleInteractionMode}
        handleInteractionModeChange={ignoreInteractionModeChange}
        submitDisabled={submitDisabled}
      />
    </div>
  );
});
