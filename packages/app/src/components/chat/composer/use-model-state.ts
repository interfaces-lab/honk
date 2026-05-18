import type { ModelSelection, ServerProvider } from "@multi/contracts";
import type { UnifiedSettings } from "@multi/contracts/settings";
import { useMemo } from "react";

import type { ComposerThreadDraftState } from "../../../stores/chat-drafts";
import { resolveChatModelSelection } from "../../../model/chat-selection";
import { deriveLatestContextWindowSnapshot } from "../../../lib/context-window";
import { getProviderInteractionModeToggle } from "../../../model/provider-models";
import { getComposerProviderState } from "../../../model/provider-state";
import type { Thread } from "../../../types";

export function useComposerModelState(input: {
  composerDraft: Pick<ComposerThreadDraftState, "activeProvider" | "modelSelectionByProvider">;
  prompt: string;
  providerStatuses: ReadonlyArray<ServerProvider>;
  settings: UnifiedSettings;
  activeThread: Thread | undefined;
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;
  activeThreadActivities: Thread["activities"] | undefined;
}) {
  const chatModelSelection = useMemo(
    () =>
      resolveChatModelSelection({
        draft: {
          activeProvider: input.composerDraft.activeProvider,
          modelSelectionByProvider: input.composerDraft.modelSelectionByProvider,
        },
        providers: input.providerStatuses,
        settings: input.settings,
        sessionProviderInstanceId: input.activeThread?.session?.providerInstanceId,
        threadModelSelection: input.activeThreadModelSelection,
        projectModelSelection: input.activeProjectDefaultModelSelection,
      }),
    [
      input.activeProjectDefaultModelSelection,
      input.activeThread?.session?.providerInstanceId,
      input.activeThreadModelSelection,
      input.composerDraft.activeProvider,
      input.composerDraft.modelSelectionByProvider,
      input.providerStatuses,
      input.settings,
    ],
  );

  const providerInstanceEntries = chatModelSelection.providerInstanceEntries;
  const selectedProvider = chatModelSelection.selectedProvider;
  const selectedInstanceId = chatModelSelection.selectedInstanceId;
  const modelOptionsByProvider = chatModelSelection.modelOptionsByProvider;
  const modelOptionsByInstance = chatModelSelection.modelOptionsByInstance;
  const instanceCoherentSelectedModel = chatModelSelection.selectedModel;
  const selectedProviderStatus = chatModelSelection.selectedProviderEntry?.snapshot ?? null;
  const selectedProviderModels = chatModelSelection.selectedProviderModels;

  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: instanceCoherentSelectedModel,
        models: selectedProviderModels,
        prompt: input.prompt,
        modelOptions: modelOptionsByProvider?.[selectedProvider],
      }),
    [
      modelOptionsByProvider,
      instanceCoherentSelectedModel,
      input.prompt,
      selectedProvider,
      selectedProviderModels,
    ],
  );

  const composerProviderControls = useMemo(
    () => ({
      showInteractionModeToggle: getProviderInteractionModeToggle(
        input.providerStatuses,
        selectedProvider,
      ),
    }),
    [input.providerStatuses, selectedProvider],
  );

  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(input.activeThreadActivities ?? []),
    [input.activeThreadActivities],
  );
  const visibleContextWindow = useMemo(() => {
    if (!activeContextWindow || input.settings.agentWindowUsageSummaryDisplay === "never") {
      return null;
    }
    if (input.settings.agentWindowUsageSummaryDisplay === "always") {
      return activeContextWindow;
    }
    return activeContextWindow.usedPercentage !== null && activeContextWindow.usedPercentage >= 50
      ? activeContextWindow
      : null;
  }, [activeContextWindow, input.settings.agentWindowUsageSummaryDisplay]);

  return {
    providerInstanceEntries,
    selectedProvider,
    selectedInstanceId,
    modelOptionsByProvider,
    modelOptionsByInstance,
    instanceCoherentSelectedModel,
    selectedProviderStatus,
    selectedProviderModels,
    composerProviderState,
    selectedPromptEffort: composerProviderState.promptEffort,
    selectedModelOptionsForDispatch: composerProviderState.modelOptionsForDispatch,
    composerProviderControls,
    selectedModelSelection: chatModelSelection.modelSelection,
    visibleContextWindow,
  };
}
