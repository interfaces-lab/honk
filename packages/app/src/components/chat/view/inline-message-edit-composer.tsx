import type { MessageId, ModelSelection, ProviderInstanceId } from "@multi/contracts";
import { memo, useCallback, useRef } from "react";

import {
  type ComposerImageAttachment,
  type DraftId as ComposerDraftId,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../../stores/chat-drafts";
import type { TerminalContextDraft } from "../../../lib/terminal-context";
import { resolveAppModelSelectionForInstance } from "../../../model/selection";
import type { ChatMessage } from "../../../types";
import { deriveComposerSendState } from "../composer/send";
import {
  ComposerInput,
  type ComposerInputHandle,
  type ComposerInputProps,
} from "../composer/input";

type ComposerInputSendContext = ReturnType<ComposerInputHandle["getSendContext"]>;

export type InlineEditSubmitInput = {
  sendContext: ComposerInputSendContext;
  runtimeMode: ComposerInputProps["runtimeMode"];
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
  | "runtimeMode"
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
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>(editDraft.terminalContexts);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const inlineRuntimeMode = editDraft.runtimeMode ?? runtimeMode;
  const inlineInteractionMode = editDraft.interactionMode ?? interactionMode;
  const submitState = deriveComposerSendState({
    prompt: editDraft.prompt,
    imageCount: editDraft.images.length,
    terminalContexts: editDraft.terminalContexts,
  });
  const submitDisabled =
    (editDraft.prompt === message.text &&
      editDraft.images.length === 0 &&
      submitState.sendableTerminalContexts.length === 0) ||
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
    (instanceId: ProviderInstanceId, model: string) => {
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (resolvedModel === null) {
        scheduleComposerFocus();
        return;
      }
      const nextModelSelection: ModelSelection = {
        instanceId,
        model: resolvedModel,
      };
      setComposerDraftModelSelection(composerDraftTarget, nextModelSelection);
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      composerDraftTarget,
      providerStatuses,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      settings,
    ],
  );

  const handleRuntimeModeChange = useCallback(
    (mode: ComposerInputProps["runtimeMode"]) => {
      if (mode === inlineRuntimeMode) return;
      setComposerDraftRuntimeMode(composerDraftTarget, mode);
      scheduleComposerFocus();
    },
    [composerDraftTarget, inlineRuntimeMode, scheduleComposerFocus, setComposerDraftRuntimeMode],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ComposerInputProps["interactionMode"]) => {
      if (mode === inlineInteractionMode) return;
      setComposerDraftInteractionMode(composerDraftTarget, mode);
      scheduleComposerFocus();
    },
    [
      composerDraftTarget,
      inlineInteractionMode,
      scheduleComposerFocus,
      setComposerDraftInteractionMode,
    ],
  );

  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(inlineInteractionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, inlineInteractionMode]);

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
        runtimeMode: inlineRuntimeMode,
        interactionMode: inlineInteractionMode,
      });
    },
    [inlineInteractionMode, inlineRuntimeMode, message.id, onSubmitEditUserMessage, submitDisabled],
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
        variant="inline-edit"
        modelPickerPlacement="bottom-start"
        composerDraftTarget={composerDraftTarget}
        runtimeMode={inlineRuntimeMode}
        interactionMode={inlineInteractionMode}
        providerStatuses={providerStatuses}
        settings={settings}
        promptRef={promptRef}
        composerImagesRef={composerImagesRef}
        composerTerminalContextsRef={composerTerminalContextsRef}
        footerSecondaryAction={cancelButton}
        onSend={handleSend}
        onProviderModelSelect={handleProviderModelSelect}
        toggleInteractionMode={toggleInteractionMode}
        handleRuntimeModeChange={handleRuntimeModeChange}
        handleInteractionModeChange={handleInteractionModeChange}
        submitDisabled={submitDisabled}
      />
    </div>
  );
});
