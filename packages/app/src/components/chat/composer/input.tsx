import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type MutableRefObject,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Button } from "@multi/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "@multi/ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@multi/ui/select";
import { Separator } from "@multi/ui/separator";
import {
  IconArrowUp,
  IconChevronLeftMedium,
  IconDotGrid1x3Horizontal,
  IconLock,
  IconPencilLine,
  IconPlusSmall,
  IconRobot,
  IconStop,
  IconUnlocked,
  type CentralIconBaseProps,
} from "central-icons";
import {
  defaultInstanceIdForDriver,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInteractionMode,
  type ProviderOptionSelection,
  type RuntimeMode,
  type ScopedThreadRef,
  type ServerProvider,
  type ServerProviderModel,
} from "@multi/contracts";
import type { UnifiedSettings } from "@multi/contracts/settings";
import {
  clampCollapsedComposerCursor,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
} from "./prompt-triggers";
import { deriveComposerSendState } from "./send";
import {
  type ComposerThreadDraftState,
  type DraftId,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../../stores/chat-drafts";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
} from "../../../lib/terminal-context";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "./prompt-editor";
import { ProviderModelPicker } from "../picker/model-picker";
import {
  type ComposerCommandItem,
  ComposerCommandMenu,
  useComposerCommandMenu,
} from "./slash-menu";
import { ComposerPendingApprovalActions } from "./pending-approval-actions";
import { ComposerPendingApprovalPanel } from "./pending-approval-panel";
import { ComposerPendingUserInputPanel } from "./pending-user-input-panel";
import { cn, randomUUID } from "~/lib/utils";
import type { QueuedComposerItem, QueuedComposerItemId } from "../../../stores/chat-send-queue";
import { useComposerModeHotkey } from "./use-mode-hotkey";
import { useComposerImageAttachments } from "./use-image-attachments";
import { ComposerImageAttachmentStrip } from "./image-attachment-strip";
import {
  type ComposerFooterPendingAction,
  type ComposerInputHandle,
  type ComposerInputProps,
} from "./input-contract";
import { QueuedComposerItemsPanel } from "./queued-items-panel";
import { ContextWindowMeter } from "./context-window-meter";
import {
  deriveLatestContextWindowSnapshot,
  type ContextWindowSnapshot,
} from "../../../lib/context-window";
import { formatProviderSkillDisplayName } from "./provider-skills";
import { useMountEffect } from "~/hooks/use-mount-effect";
import {
  getComposerProviderState,
  resolveProviderTraitsState,
  type ProviderTraitsScope,
} from "../../../model/provider-state";
import { TraitsMenuContent, TraitsPicker } from "../picker/traits-picker";
import { resolveAppProviderModelState } from "../../../model/selection";

export type { ComposerInputHandle, ComposerInputProps } from "./input-contract";

const EMPTY_QUEUED_COMPOSER_ITEMS: QueuedComposerItem[] = [];
Object.freeze(EMPTY_QUEUED_COMPOSER_ITEMS);

const EMPTY_PENDING_APPROVALS: NonNullable<ComposerInputProps["pendingApprovals"]> = [];
Object.freeze(EMPTY_PENDING_APPROVALS);

type TraitsRenderInput = {
  provider: ProviderDriverKind;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  traitsScope?: ProviderTraitsScope;
};

function renderTraitsControl(
  Component: typeof TraitsMenuContent | typeof TraitsPicker,
  input: TraitsRenderInput,
): ReactNode {
  const {
    provider,
    threadRef,
    draftId,
    model,
    models,
    modelOptions,
    prompt,
    onPromptChange,
    traitsScope: traitsScopeRequested = "all",
  } = input;
  const traitsScopeForComponent = Component === TraitsPicker ? "all" : traitsScopeRequested;

  const hasTarget = threadRef !== undefined || draftId !== undefined;
  if (!hasTarget) {
    return null;
  }

  const traitsState = resolveProviderTraitsState({
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort: true,
  });
  if (
    (traitsScopeForComponent === "fast-only" && !traitsState.showFastMode) ||
    (traitsScopeForComponent === "except-fast" && !traitsState.hasRestControls) ||
    (traitsScopeForComponent === "all" && !traitsState.hasAnyControls)
  ) {
    return null;
  }

  return (
    <Component
      provider={provider}
      models={models}
      {...(threadRef ? { threadRef } : {})}
      {...(draftId ? { draftId } : {})}
      model={model}
      modelOptions={modelOptions}
      prompt={prompt}
      onPromptChange={onPromptChange}
      {...(Component === TraitsMenuContent ? { traitsScope: traitsScopeForComponent } : {})}
    />
  );
}

function renderProviderTraitsMenuContent(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsMenuContent, input);
}

function renderProviderTraitsPicker(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsPicker, input);
}

function getProviderInteractionModeToggle(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
): boolean {
  const defaultInstanceId = defaultInstanceIdForDriver(provider);
  return (
    providers.find((candidate) => candidate.instanceId === defaultInstanceId)
      ?.showInteractionModeToggle ?? true
  );
}

function useComposerModelState(input: {
  composerDraft: Pick<ComposerThreadDraftState, "activeProvider" | "modelSelectionByProvider">;
  prompt: string;
  providerStatuses: ReadonlyArray<ServerProvider>;
  settings: UnifiedSettings;
  activeThread: ComposerInputProps["activeThread"];
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;
  activeThreadActivities: ComposerInputProps["activeThreadActivities"];
}) {
  const chatModelSelection = useMemo(
    () =>
      resolveAppProviderModelState({
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
  const modelOptionSelectionsByInstance = chatModelSelection.modelOptionSelectionsByInstance;
  const modelOptionsByInstance = chatModelSelection.modelOptionsByInstance;
  const modelCatalogItems = chatModelSelection.modelCatalogItems;
  const selectedCatalogItem = chatModelSelection.selectedCatalogItem;
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
        modelOptions: modelOptionSelectionsByInstance?.[selectedInstanceId],
      }),
    [
      modelOptionSelectionsByInstance,
      instanceCoherentSelectedModel,
      input.prompt,
      selectedProvider,
      selectedInstanceId,
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
    modelOptionSelectionsByInstance,
    modelOptionsByInstance,
    modelCatalogItems,
    selectedCatalogItem,
    instanceCoherentSelectedModel,
    selectedProviderStatus,
    selectedProviderModels,
    composerProviderState,
    selectedPromptEffort: composerProviderState.promptEffort,
    selectedModelOptionsForDispatch: composerProviderState.modelOptionsForDispatch,
    composerProviderControls,
    modelResolverStatus: chatModelSelection.status,
    selectedModelSelection: chatModelSelection.modelSelection,
    visibleContextWindow,
  };
}

const EMPTY_PENDING_USER_INPUTS: NonNullable<ComposerInputProps["pendingUserInputs"]> = [];
Object.freeze(EMPTY_PENDING_USER_INPUTS);

const EMPTY_PENDING_USER_INPUT_ANSWERS: NonNullable<
  ComposerInputProps["activePendingDraftAnswers"]
> = {};

const EMPTY_RESPONDING_REQUEST_IDS: NonNullable<ComposerInputProps["respondingRequestIds"]> = [];
Object.freeze(EMPTY_RESPONDING_REQUEST_IDS);

const ignoreQueuedComposerItem = (_itemId: QueuedComposerItemId): void => undefined;
const ignoreQueuedComposerEditCancel = (): void => undefined;

function useValueIdentityVersion<TValue>(value: TValue): number {
  const valueRef = useRef(value);
  const versionRef = useRef(0);
  if (valueRef.current !== value) {
    valueRef.current = value;
    versionRef.current += 1;
  }
  return versionRef.current;
}

const missingPendingCapability = (name: string): never => {
  throw new Error(`Composer pending capability '${name}' is active without a handler.`);
};

const missingPendingHandlers = {
  respondToApproval: () => missingPendingCapability("onRespondToApproval"),
  selectActivePendingUserInputOption: () =>
    missingPendingCapability("onSelectActivePendingUserInputOption"),
  advanceActivePendingUserInput: () => missingPendingCapability("onAdvanceActivePendingUserInput"),
  previousActivePendingUserInputQuestion: () =>
    missingPendingCapability("onPreviousActivePendingUserInputQuestion"),
  changeActivePendingUserInputCustomAnswer: () =>
    missingPendingCapability("onChangeActivePendingUserInputCustomAnswer"),
} satisfies {
  readonly respondToApproval: NonNullable<ComposerInputProps["onRespondToApproval"]>;
  readonly selectActivePendingUserInputOption: NonNullable<
    ComposerInputProps["onSelectActivePendingUserInputOption"]
  >;
  readonly advanceActivePendingUserInput: NonNullable<
    ComposerInputProps["onAdvanceActivePendingUserInput"]
  >;
  readonly previousActivePendingUserInputQuestion: NonNullable<
    ComposerInputProps["onPreviousActivePendingUserInputQuestion"]
  >;
  readonly changeActivePendingUserInputCustomAnswer: NonNullable<
    ComposerInputProps["onChangeActivePendingUserInputCustomAnswer"]
  >;
};

const extendReplacementRangeForTrailingSpace = (
  text: string,
  rangeEnd: number,
  replacement: string,
): number => {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
};

const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);

type CentralIconComponent = ComponentType<CentralIconBaseProps>;

const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: CentralIconComponent }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: IconLock,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: IconPencilLine,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: IconUnlocked,
  },
};

const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

function ComposerPromptCursorClampSync({
  prompt,
  setComposerCursor,
}: {
  prompt: string;
  setComposerCursor: Dispatch<SetStateAction<number>>;
}) {
  useMountEffect(() => {
    setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
  });

  return null;
}

function ComposerMenuHighlightSync({
  activeComposerMenuItemId,
  composerMenuOpen,
  composerMenuSearchKey,
  setComposerHighlightedItemId,
  setComposerHighlightedSearchKey,
}: {
  activeComposerMenuItemId: string | null;
  composerMenuOpen: boolean;
  composerMenuSearchKey: string | null;
  setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  setComposerHighlightedSearchKey: Dispatch<SetStateAction<string | null>>;
}) {
  useMountEffect(() => {
    if (!composerMenuOpen) {
      setComposerHighlightedItemId(null);
      setComposerHighlightedSearchKey(null);
      return;
    }
    setComposerHighlightedItemId((existing) =>
      existing === activeComposerMenuItemId ? existing : activeComposerMenuItemId,
    );
    setComposerHighlightedSearchKey((existing) =>
      existing === composerMenuSearchKey ? existing : composerMenuSearchKey,
    );
  });

  return null;
}

function ComposerPendingInputPromptSync({
  activeQuestionId,
  customAnswer,
  lastSyncedPendingInputRef,
  promptRef,
  requestId,
  resolveComposerTrigger,
  setComposerCursor,
  setComposerHighlightedItemId,
  setComposerTrigger,
}: {
  activeQuestionId: string | null;
  customAnswer: string | undefined;
  lastSyncedPendingInputRef: MutableRefObject<{
    requestId: string | null;
    questionId: string | null;
  } | null>;
  promptRef: MutableRefObject<string>;
  requestId: string | null;
  resolveComposerTrigger: (text: string, expandedCursor: number) => ComposerTrigger | null;
  setComposerCursor: Dispatch<SetStateAction<number>>;
  setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  setComposerTrigger: Dispatch<SetStateAction<ComposerTrigger | null>>;
}) {
  useMountEffect(() => {
    if (typeof customAnswer !== "string") {
      lastSyncedPendingInputRef.current = null;
      return;
    }

    const questionChanged =
      lastSyncedPendingInputRef.current?.requestId !== requestId ||
      lastSyncedPendingInputRef.current?.questionId !== activeQuestionId;
    const textChangedExternally = promptRef.current !== customAnswer;

    lastSyncedPendingInputRef.current = {
      requestId,
      questionId: activeQuestionId,
    };

    if (!questionChanged && !textChangedExternally) {
      return;
    }

    promptRef.current = customAnswer;
    const nextCursor = collapseExpandedComposerCursor(customAnswer, customAnswer.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(
      resolveComposerTrigger(customAnswer, expandCollapsedComposerCursor(customAnswer, nextCursor)),
    );
    setComposerHighlightedItemId(null);
  });

  return null;
}

function ComposerDraftResetSync({
  dismissedComposerTriggerKeyRef,
  initialComposerTriggerSuppressionPromptRef,
  promptRef,
  setComposerCursor,
  setComposerHighlightedItemId,
  setComposerTrigger,
  suppressInitialComposerTriggerDetectionRef,
}: {
  dismissedComposerTriggerKeyRef: MutableRefObject<string | null>;
  initialComposerTriggerSuppressionPromptRef: MutableRefObject<string>;
  promptRef: MutableRefObject<string>;
  setComposerCursor: Dispatch<SetStateAction<number>>;
  setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  setComposerTrigger: Dispatch<SetStateAction<ComposerTrigger | null>>;
  suppressInitialComposerTriggerDetectionRef: MutableRefObject<boolean>;
}) {
  useMountEffect(() => {
    setComposerHighlightedItemId(null);
    setComposerCursor(collapseExpandedComposerCursor(promptRef.current, promptRef.current.length));
    suppressInitialComposerTriggerDetectionRef.current = true;
    initialComposerTriggerSuppressionPromptRef.current = promptRef.current;
    dismissedComposerTriggerKeyRef.current = null;
    setComposerTrigger(null);
  });

  return null;
}

function ComposerCommandMenuPointerDismissSync({
  composerFormRef,
  dismissComposerCommandMenu,
}: {
  composerFormRef: MutableRefObject<HTMLFormElement | null>;
  dismissComposerCommandMenu: () => void;
}) {
  useMountEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const form = composerFormRef.current;
      if (!form) return;
      if (event.target instanceof Node && form.contains(event.target)) return;
      dismissComposerCommandMenu();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  });

  return null;
}

function parseInteractionMode(value: string | null | undefined): ProviderInteractionMode | null {
  if (value === "default" || value === "plan") return value;
  return null;
}

function parseRuntimeMode(value: string | null | undefined): RuntimeMode | null {
  if (value === "approval-required" || value === "auto-accept-edits" || value === "full-access") {
    return value;
  }
  return null;
}

function formatPendingPrimaryActionLabel(input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
}

const OverflowControls = memo(function OverflowControls(props: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  traitsFastMenuContent?: ReactNode | null | undefined;
  traitsRestMenuContent?: ReactNode | null | undefined;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const [optimisticInteractionMode, setOptimisticInteractionMode] = useState(props.interactionMode);
  const [optimisticRuntimeMode, setOptimisticRuntimeMode] = useState(props.runtimeMode);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 rounded-full p-0 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="More composer controls"
          />
        }
      >
        <IconDotGrid1x3Horizontal aria-hidden="true" className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="start" variant="workbench">
        {props.traitsFastMenuContent ? (
          <>
            {props.traitsFastMenuContent}
            <MenuDivider variant="workbench" />
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <MenuGroup>
              <MenuGroupLabel variant="workbench">Mode</MenuGroupLabel>
              <MenuRadioGroup
                value={optimisticInteractionMode}
                onValueChange={(value) => {
                  const nextMode = parseInteractionMode(value);
                  if (!nextMode || nextMode === optimisticInteractionMode) return;
                  setOptimisticInteractionMode(nextMode);
                  props.onInteractionModeChange(nextMode);
                }}
              >
                <MenuRadioItem variant="workbench" value="default">
                  Chat
                </MenuRadioItem>
                <MenuRadioItem variant="workbench" value="plan">
                  Plan
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuDivider variant="workbench" />
          </>
        ) : null}
        <MenuGroup>
          <MenuGroupLabel variant="workbench">Access</MenuGroupLabel>
          <MenuRadioGroup
            value={optimisticRuntimeMode}
            onValueChange={(value) => {
              const nextMode = parseRuntimeMode(value);
              if (!nextMode || nextMode === optimisticRuntimeMode) return;
              setOptimisticRuntimeMode(nextMode);
              props.onRuntimeModeChange(nextMode);
            }}
          >
            <MenuRadioItem variant="workbench" value="approval-required">
              Supervised
            </MenuRadioItem>
            <MenuRadioItem variant="workbench" value="auto-accept-edits">
              Auto-accept edits
            </MenuRadioItem>
            <MenuRadioItem variant="workbench" value="full-access">
              Full access
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        {props.traitsRestMenuContent ? (
          <>
            <MenuDivider variant="workbench" />
            {props.traitsRestMenuContent}
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});

const ModeAccessControls = memo(function ModeAccessControls(props: {
  showInteractionModeToggle: boolean;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const runtimeModeOption = runtimeModeConfig[props.runtimeMode];
  const RuntimeModeIcon = runtimeModeOption.icon;

  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />

      {props.showInteractionModeToggle ? (
        <>
          <Button
            variant="ghost"
            className={cn(
              "h-7 shrink-0 rounded-full border px-2.5 text-muted-foreground/70 hover:text-foreground/80",
              props.interactionMode === "plan"
                ? "border-primary/25 bg-primary/10 text-primary"
                : "border-transparent bg-multi-bg-quaternary text-multi-fg-primary",
            )}
            data-mode={props.interactionMode === "plan" ? "plan" : "chat"}
            size="sm"
            type="button"
            onClick={props.onToggleInteractionMode}
            title={
              props.interactionMode === "plan"
                ? "Plan mode - click to return to normal build mode"
                : "Default mode - click to enter plan mode"
            }
          >
            <IconRobot />
            <span className="sr-only sm:not-sr-only">
              {props.interactionMode === "plan" ? "Plan" : "Build"}
            </span>
          </Button>

          <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
        </>
      ) : null}

      <Select
        value={props.runtimeMode}
        onValueChange={(value) => {
          const nextMode = parseRuntimeMode(value);
          if (nextMode) props.onRuntimeModeChange(nextMode);
        }}
      >
        <SelectTrigger
          variant="ghost"
          size="sm"
          className="h-7 rounded-full font-medium"
          aria-label="Runtime mode"
          title={runtimeModeOption.description}
        >
          <RuntimeModeIcon className="size-4" />
          <SelectValue>{runtimeModeOption.label}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {runtimeModeOptions.map((mode) => {
            const option = runtimeModeConfig[mode];
            const OptionIcon = option.icon;
            return (
              <SelectItem key={mode} value={mode} className="min-w-64 py-2">
                <div className="grid min-w-0 gap-0.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    {option.label}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {option.description}
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
    </>
  );
});

const PrimaryActionControls = memo(function PrimaryActionControls(props: {
  compact: boolean;
  dockSingleRow: boolean;
  pendingAction: ComposerFooterPendingAction;
  isRunning: boolean;
  showPlanFollowUpPrompt: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  sendWhileStreamingBehavior: UnifiedSettings["agentWindowSendWhileStreamingBehavior"];
  submitActionLabel?: string | undefined;
  onAdvancePendingQuestion: () => void;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
}) {
  if (props.pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", props.compact ? "gap-1" : "gap-2")}>
        {props.pendingAction.questionIndex > 0 ? (
          props.compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              onClick={props.onPreviousPendingQuestion}
              disabled={props.pendingAction.isResponding}
              aria-label="Previous question"
            >
              <IconChevronLeftMedium className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={props.onPreviousPendingQuestion}
              disabled={props.pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <Button
          type="button"
          size="sm"
          className={cn("rounded-full", props.compact ? "px-2.5" : "px-4")}
          onClick={props.onAdvancePendingQuestion}
          disabled={
            props.pendingAction.isResponding ||
            (props.pendingAction.isLastQuestion
              ? !props.pendingAction.isComplete
              : !props.pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact: props.compact,
            isLastQuestion: props.pendingAction.isLastQuestion,
            isResponding: props.pendingAction.isResponding,
            questionIndex: props.pendingAction.questionIndex,
          })}
        </Button>
      </div>
    );
  }

  if (props.isRunning) {
    const runningSendLabel =
      props.submitActionLabel ??
      (props.sendWhileStreamingBehavior === "queue"
        ? "Queue message"
        : props.sendWhileStreamingBehavior === "stop-and-send"
          ? "Stop and send message"
          : "Send message");
    const stopButton = (
      <button
        type="button"
        className={cn(
          "flex cursor-pointer items-center justify-center rounded-full bg-rose-500/90 text-white transition-[background-color,color,opacity,transform] duration-150 hover:bg-rose-500 motion-reduce:transition-colors motion-reduce:active:scale-100 active:scale-[0.96]",
          props.dockSingleRow ? "h-7 w-7" : "h-9 w-9 sm:h-8 sm:w-8",
        )}
        onClick={props.onInterrupt}
        aria-label="Stop generation"
      >
        <IconStop className={props.dockSingleRow ? "size-3" : "size-3.5"} />
      </button>
    );

    if (props.hasSendableContent) {
      return (
        <div className={cn("flex items-center justify-end", props.compact ? "gap-1.5" : "gap-2")}>
          {stopButton}
          <button
            type="submit"
            className={cn(
              "flex enabled:cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-[color,opacity,transform] duration-150 hover:opacity-90 motion-reduce:transition-opacity motion-reduce:active:scale-100 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30 disabled:hover:opacity-30",
              props.dockSingleRow ? "h-7 w-7" : "h-9 w-9 sm:h-8 sm:w-8",
            )}
            disabled={props.isSendBusy || props.isConnecting || !props.hasSendableContent}
            aria-label={runningSendLabel}
            title={runningSendLabel}
          >
            <IconArrowUp className={props.dockSingleRow ? "size-3" : "size-3.5"} />
          </button>
        </div>
      );
    }

    return stopButton;
  }

  if (props.showPlanFollowUpPrompt) {
    return (
      <Button
        type="submit"
        size="sm"
        className={cn("rounded-full", props.compact ? "h-9 px-3 sm:h-8" : "h-9 px-4 sm:h-8")}
        disabled={props.isSendBusy || props.isConnecting}
      >
        {props.isConnecting || props.isSendBusy ? "Sending..." : "Refine"}
      </Button>
    );
  }

  return (
    <button
      type="submit"
      className={cn(
        "flex enabled:cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-[color,opacity,transform] duration-150 hover:opacity-90 motion-reduce:transition-opacity motion-reduce:active:scale-100 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30 disabled:hover:opacity-30",
        props.dockSingleRow ? "h-7 w-7" : "h-9 w-9 sm:h-8 sm:w-8",
      )}
      disabled={props.isSendBusy || props.isConnecting || !props.hasSendableContent}
      aria-label={
        props.isConnecting
          ? "Connecting"
          : props.isPreparingWorktree
            ? "Preparing worktree"
            : props.isSendBusy
              ? "Sending"
              : (props.submitActionLabel ?? "Send message")
      }
      title={props.submitActionLabel ?? "Send message"}
    >
      {props.isConnecting || props.isSendBusy ? (
        <svg
          width={props.dockSingleRow ? "12" : "14"}
          height={props.dockSingleRow ? "12" : "14"}
          viewBox={props.dockSingleRow ? "0 0 12 12" : "0 0 14 14"}
          fill="none"
          className="animate-spin"
          aria-hidden="true"
        >
          <circle
            cx={props.dockSingleRow ? "6" : "7"}
            cy={props.dockSingleRow ? "6" : "7"}
            r={props.dockSingleRow ? "4.5" : "5.5"}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={props.dockSingleRow ? "17 10" : "20 12"}
          />
        </svg>
      ) : (
        <IconArrowUp className={props.dockSingleRow ? "size-3" : "size-3.5"} />
      )}
    </button>
  );
});

const ComposerFooter = memo(function ComposerFooter(props: {
  compactControlsMenu: ReactNode;
  composerVariant: "compact" | "expanded";
  inlineEdit: boolean;
  interactionMode: ProviderInteractionMode;
  isDockComposerExpanded: boolean;
  primaryActionState: {
    activeContextWindow: ContextWindowSnapshot | null;
    pendingAction: ComposerFooterPendingAction;
    isRunning: boolean;
    showPlanFollowUpPrompt: boolean;
    isSendBusy: boolean;
    isConnecting: boolean;
    isPreparingWorktree: boolean;
    submitDisabled: boolean;
    hasSendableContent: boolean;
    sendWhileStreamingBehavior: UnifiedSettings["agentWindowSendWhileStreamingBehavior"];
    submitActionLabel?: string | undefined;
  };
  providerModelPicker: ReactNode;
  providerTraitsPicker: ReactNode;
  secondaryAction?: ReactNode | undefined;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  onAdvancePendingQuestion: () => void;
  onInterrupt: () => void;
  onPreviousPendingQuestion: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onToggleInteractionMode: () => void;
}) {
  const dockSingleRow = props.composerVariant === "compact" && !props.isDockComposerExpanded;
  const primaryActionsCompact =
    dockSingleRow ||
    props.primaryActionState.showPlanFollowUpPrompt ||
    props.primaryActionState.pendingAction !== null;

  return (
    <div
      data-chat-input-footer="true"
      data-chat-input-footer-compact={dockSingleRow ? "true" : "false"}
      className={cn(
        "min-w-0",
        dockSingleRow
          ? "flex min-w-0 shrink items-center gap-1"
          : cn(
              "flex w-full items-center justify-between gap-2",
              props.inlineEdit ? "px-3 pb-2" : "px-2.5 pb-2.5 sm:px-3 sm:pb-3",
            ),
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-1",
          dockSingleRow ? "shrink" : "flex-1 overflow-hidden",
        )}
      >
        <span
          className={cn(
            "inline-flex min-w-0 overflow-hidden",
            dockSingleRow ? "max-w-36 sm:max-w-48" : "max-w-56",
          )}
        >
          {props.providerModelPicker}
        </span>

        <span className={cn("inline-flex shrink-0", dockSingleRow ? "" : "sm:hidden")}>
          {props.compactControlsMenu}
        </span>

        {!dockSingleRow ? (
          <span className="hidden min-w-0 shrink-0 items-center gap-1 sm:inline-flex">
            {props.providerTraitsPicker ? (
              <>
                <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
                {props.providerTraitsPicker}
              </>
            ) : null}
            <ModeAccessControls
              showInteractionModeToggle={props.showInteractionModeToggle}
              interactionMode={props.interactionMode}
              runtimeMode={props.runtimeMode}
              onToggleInteractionMode={props.onToggleInteractionMode}
              onRuntimeModeChange={props.onRuntimeModeChange}
            />
          </span>
        ) : null}
      </div>

      <div
        data-chat-input-actions="right"
        data-chat-input-primary-actions-compact={primaryActionsCompact ? "true" : "false"}
        className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
      >
        {!dockSingleRow && props.primaryActionState.activeContextWindow ? (
          <ContextWindowMeter usage={props.primaryActionState.activeContextWindow} />
        ) : null}
        {!dockSingleRow && props.primaryActionState.isPreparingWorktree ? (
          <span className="hidden select-none text-muted-foreground/70 text-xs sm:inline">
            Preparing worktree...
          </span>
        ) : null}
        {props.secondaryAction}
        <PrimaryActionControls
          compact={primaryActionsCompact}
          dockSingleRow={dockSingleRow}
          pendingAction={props.primaryActionState.pendingAction}
          isRunning={props.primaryActionState.isRunning}
          showPlanFollowUpPrompt={props.primaryActionState.showPlanFollowUpPrompt}
          isSendBusy={props.primaryActionState.isSendBusy}
          isConnecting={props.primaryActionState.isConnecting}
          isPreparingWorktree={props.primaryActionState.isPreparingWorktree}
          hasSendableContent={
            props.primaryActionState.hasSendableContent && !props.primaryActionState.submitDisabled
          }
          sendWhileStreamingBehavior={props.primaryActionState.sendWhileStreamingBehavior}
          submitActionLabel={props.primaryActionState.submitActionLabel}
          onAdvancePendingQuestion={props.onAdvancePendingQuestion}
          onPreviousPendingQuestion={props.onPreviousPendingQuestion}
          onInterrupt={props.onInterrupt}
        />
      </div>
    </div>
  );
});

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export const ComposerInput = memo(
  forwardRef<ComposerInputHandle, ComposerInputProps>(function ComposerInput(props, ref) {
    const {
      variant = "dock",
      modelPickerPlacement: modelPickerPlacementProp,
      composerDraftTarget,
      environmentId,
      routeKind,
      routeThreadRef,
      draftId,
      activeThreadId,
      activeThreadEnvironmentId: _activeThreadEnvironmentId,
      activeThread,
      isServerThread: _isServerThread,
      isLocalDraftThread: _isLocalDraftThread,
      phase,
      isConnecting,
      isSendBusy,
      isPreparingWorktree,
      submitDisabled = false,
      queuedComposerItems = EMPTY_QUEUED_COMPOSER_ITEMS,
      editingQueuedComposerItemId = null,
      activePendingApproval = null,
      pendingApprovals = EMPTY_PENDING_APPROVALS,
      pendingUserInputs = EMPTY_PENDING_USER_INPUTS,
      activePendingProgress = null,
      activePendingResolvedAnswers = null,
      activePendingIsResponding = false,
      activePendingDraftAnswers = EMPTY_PENDING_USER_INPUT_ANSWERS,
      activePendingQuestionIndex = 0,
      respondingRequestIds = EMPTY_RESPONDING_REQUEST_IDS,
      showPlanFollowUpPrompt = false,
      activeProposedPlan = null,
      runtimeMode,
      interactionMode,
      providerStatuses,
      activeProjectDefaultModelSelection,
      activeThreadModelSelection,
      activeThreadActivities,
      resolvedTheme,
      settings,
      keybindings,
      terminalOpen,
      gitCwd,
      promptRef,
      composerImagesRef,
      composerTerminalContextsRef,
      footerSecondaryAction,
      onSend,
      onInterrupt,
      onRespondToApproval,
      onSelectActivePendingUserInputOption,
      onAdvanceActivePendingUserInput,
      onPreviousActivePendingUserInputQuestion,
      onChangeActivePendingUserInputCustomAnswer,
      onProviderModelSelect,
      onBeginEditQueuedComposerItem,
      onCancelEditingQueuedComposerItem,
      onRemoveQueuedComposerItem,
      onSendQueuedComposerItemNow,
      toggleInteractionMode,
      handleRuntimeModeChange,
      handleInteractionModeChange,
      setThreadError,
      onExpandImage,
    } = props;
    const handleBeginEditQueuedComposerItem =
      onBeginEditQueuedComposerItem ?? ignoreQueuedComposerItem;
    const handleCancelEditingQueuedComposerItem =
      onCancelEditingQueuedComposerItem ?? ignoreQueuedComposerEditCancel;
    const handleRemoveQueuedComposerItem = onRemoveQueuedComposerItem ?? ignoreQueuedComposerItem;
    const handleSendQueuedComposerItemNow = onSendQueuedComposerItemNow ?? ignoreQueuedComposerItem;
    const handleRespondToApproval: NonNullable<ComposerInputProps["onRespondToApproval"]> =
      onRespondToApproval ?? missingPendingHandlers.respondToApproval;
    const handleSelectActivePendingUserInputOption: NonNullable<
      ComposerInputProps["onSelectActivePendingUserInputOption"]
    > =
      onSelectActivePendingUserInputOption ??
      missingPendingHandlers.selectActivePendingUserInputOption;
    const handleAdvanceActivePendingUserInput: NonNullable<
      ComposerInputProps["onAdvanceActivePendingUserInput"]
    > = onAdvanceActivePendingUserInput ?? missingPendingHandlers.advanceActivePendingUserInput;
    const handlePreviousActivePendingUserInputQuestion: NonNullable<
      ComposerInputProps["onPreviousActivePendingUserInputQuestion"]
    > =
      onPreviousActivePendingUserInputQuestion ??
      missingPendingHandlers.previousActivePendingUserInputQuestion;
    const handleChangeActivePendingUserInputCustomAnswer: NonNullable<
      ComposerInputProps["onChangeActivePendingUserInputCustomAnswer"]
    > =
      onChangeActivePendingUserInputCustomAnswer ??
      missingPendingHandlers.changeActivePendingUserInputCustomAnswer;
    const isInlineEditComposer = variant === "inline-edit";
    const composerVariant = variant === "hero" ? "expanded" : "compact";
    const modelPickerPlacement =
      modelPickerPlacementProp ?? (composerVariant === "compact" ? "top-start" : "bottom-start");

    // ------------------------------------------------------------------
    // Store subscriptions (prompt / images / terminal contexts)
    // ------------------------------------------------------------------
    const composerDraft = useComposerThreadDraft(composerDraftTarget);
    const prompt = composerDraft.prompt;
    const composerImages = composerDraft.images;
    const composerTerminalContexts = composerDraft.terminalContexts;
    const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;

    const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
    const insertComposerDraftTerminalContext = useComposerDraftStore(
      (store) => store.insertTerminalContext,
    );
    const removeComposerDraftTerminalContext = useComposerDraftStore(
      (store) => store.removeTerminalContext,
    );
    const setComposerDraftTerminalContexts = useComposerDraftStore(
      (store) => store.setTerminalContexts,
    );

    // ------------------------------------------------------------------
    // Model state
    // ------------------------------------------------------------------
    const {
      providerInstanceEntries,
      selectedProvider,
      selectedInstanceId,
      modelOptionSelectionsByInstance,
      modelCatalogItems,
      selectedCatalogItem,
      instanceCoherentSelectedModel,
      selectedProviderStatus,
      selectedProviderModels,
      composerProviderState,
      selectedPromptEffort,
      selectedModelOptionsForDispatch,
      composerProviderControls,
      modelResolverStatus,
      selectedModelSelection,
      visibleContextWindow,
    } = useComposerModelState({
      composerDraft,
      prompt,
      providerStatuses,
      settings,
      activeThread,
      activeProjectDefaultModelSelection,
      activeThreadModelSelection,
      activeThreadActivities,
    });

    // ------------------------------------------------------------------
    // Composer-local state
    // ------------------------------------------------------------------
    const [composerCursor, setComposerCursor] = useState(() =>
      collapseExpandedComposerCursor(prompt, prompt.length),
    );
    const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(null);
    const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
    const [composerHighlightedSearchKey, setComposerHighlightedSearchKey] = useState<string | null>(
      null,
    );
    const [isComposerModelPickerOpen, setIsComposerModelPickerOpen] = useState(false);
    const [isComposerEditorMultiline, setIsComposerEditorMultiline] = useState(false);
    const [modelPickerOpenSearchSeed, setModelPickerOpenSearchSeed] = useState<string | undefined>(
      undefined,
    );

    // ------------------------------------------------------------------
    // Refs
    // ------------------------------------------------------------------
    const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
    const composerEditorHotkeyRef = useRef<HTMLDivElement>(null);
    const composerFormRef = useRef<HTMLFormElement>(null);
    const composerSelectLockRef = useRef(false);
    const composerMenuOpenRef = useRef(false);
    const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
    const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
    const suppressInitialComposerTriggerDetectionRef = useRef(true);
    const initialComposerTriggerSuppressionPromptRef = useRef(prompt);
    const dismissedComposerTriggerKeyRef = useRef<string | null>(null);

    const focusComposer = useCallback(() => {
      composerEditorRef.current?.focusAtEnd();
    }, []);

    const scheduleComposerFocus = useCallback(() => {
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAtEnd();
      });
    }, []);

    useComposerModeHotkey({
      keybindings,
      terminalOpen,
      targetRef: composerEditorHotkeyRef,
      onToggleInteractionMode: toggleInteractionMode,
    });

    const composerTriggerDismissKey = useCallback(
      (trigger: ComposerTrigger) =>
        `${trigger.kind}:${trigger.rangeStart}:${trigger.rangeEnd}:${trigger.query}`,
      [],
    );

    const resolveComposerTrigger = useCallback(
      (text: string, expandedCursor: number): ComposerTrigger | null => {
        if (suppressInitialComposerTriggerDetectionRef.current) {
          if (text === initialComposerTriggerSuppressionPromptRef.current) {
            return null;
          }
          suppressInitialComposerTriggerDetectionRef.current = false;
        }
        const nextTrigger = detectComposerTrigger(text, expandedCursor);
        if (!nextTrigger) {
          dismissedComposerTriggerKeyRef.current = null;
          return null;
        }
        return composerTriggerDismissKey(nextTrigger) === dismissedComposerTriggerKeyRef.current
          ? null
          : nextTrigger;
      },
      [composerTriggerDismissKey],
    );

    // ------------------------------------------------------------------
    // Derived: composer send state
    // ------------------------------------------------------------------
    const composerSendState = useMemo(
      () =>
        deriveComposerSendState({
          prompt,
          imageCount: composerImages.length,
          terminalContexts: composerTerminalContexts,
        }),
      [composerImages.length, composerTerminalContexts, prompt],
    );

    // ------------------------------------------------------------------
    // Derived: composer trigger / menu
    // ------------------------------------------------------------------
    const {
      composerTriggerKind,
      composerMenuItems,
      composerMenuOpen,
      composerMenuSearchKey,
      activeComposerMenuItemId,
      activeComposerMenuItem,
      isComposerMenuLoading,
      composerMenuEmptyState,
      composerMenuAriaLabel,
      composerMenuKind,
    } = useComposerCommandMenu({
      composerTrigger,
      environmentId,
      gitCwd,
      selectedProvider,
      selectedProviderStatus,
      highlightedItemId: composerHighlightedItemId,
      highlightedSearchKey: composerHighlightedSearchKey,
    });

    composerMenuOpenRef.current = composerMenuOpen;
    composerMenuItemsRef.current = composerMenuItems;
    activeComposerMenuItemRef.current = activeComposerMenuItem;

    const handleComposerContainerClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
      if (composerMenuOpenRef.current) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest(
          '.ProseMirror, button, input, select, textarea, a, [role="button"], [role="menuitem"]',
        )
      ) {
        return;
      }
      composerEditorRef.current?.focusAtEnd();
    }, []);

    const {
      composerImageInputRef,
      composerImageAttachmentPersistenceSync,
      isDragOverComposer,
      nonPersistedComposerImageIdSet,
      onComposerPaste,
      onComposerDragEnter,
      onComposerDragOver,
      onComposerDragLeave,
      onComposerDrop,
      onComposerImageInputChange,
      removeComposerImage,
    } = useComposerImageAttachments({
      composerDraftTarget,
      activeThreadId,
      pendingUserInputCount: pendingUserInputs.length,
      composerImages,
      nonPersistedComposerImageIds,
      composerImagesRef,
      focusComposer,
      setThreadError,
    });

    const isComposerApprovalState = activePendingApproval !== null;
    const activePendingUserInput = pendingUserInputs[0] ?? null;
    const hasQueuedComposerItems = queuedComposerItems.length > 0;
    const isEditingQueuedComposerItem = editingQueuedComposerItemId !== null;
    const canSubmitQueuedComposerItem = hasQueuedComposerItems && !isEditingQueuedComposerItem;
    const hasComposerHeader = isComposerApprovalState || pendingUserInputs.length > 0;

    const isDockComposerExpanded =
      composerVariant === "compact" &&
      (isInlineEditComposer ||
        hasComposerHeader ||
        hasQueuedComposerItems ||
        composerImages.length > 0 ||
        activePendingProgress !== null ||
        isComposerEditorMultiline);

    const isDockComposerSingleLine = composerVariant === "compact" && !isDockComposerExpanded;

    // ------------------------------------------------------------------
    // Provider traits UI
    // ------------------------------------------------------------------
    const setPromptFromTraits = useCallback(
      (nextPrompt: string) => {
        if (nextPrompt === promptRef.current) {
          scheduleComposerFocus();
          return;
        }
        promptRef.current = nextPrompt;
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
        const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
        setComposerCursor(nextCursor);
        setComposerTrigger(resolveComposerTrigger(nextPrompt, nextPrompt.length));
        scheduleComposerFocus();
      },
      [
        composerDraftTarget,
        promptRef,
        resolveComposerTrigger,
        scheduleComposerFocus,
        setComposerDraftPrompt,
      ],
    );

    const traitsDockMenuInputBase = {
      provider: selectedProvider,
      ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
      ...(routeKind === "draft" && draftId ? { draftId } : {}),
      model: instanceCoherentSelectedModel,
      models: selectedProviderModels,
      modelOptions: modelOptionSelectionsByInstance?.[selectedInstanceId],
      prompt,
      onPromptChange: setPromptFromTraits,
    };

    const dockTraitsMenuFastSlot = renderProviderTraitsMenuContent({
      ...traitsDockMenuInputBase,
      traitsScope: "fast-only",
    });
    const dockTraitsMenuRestSlot = renderProviderTraitsMenuContent({
      ...traitsDockMenuInputBase,
      traitsScope: "except-fast",
    });
    const providerTraitsPicker = renderProviderTraitsPicker({
      provider: selectedProvider,
      ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
      ...(routeKind === "draft" && draftId ? { draftId } : {}),
      model: instanceCoherentSelectedModel,
      models: selectedProviderModels,
      modelOptions: modelOptionSelectionsByInstance?.[selectedInstanceId],
      prompt,
      onPromptChange: setPromptFromTraits,
    });
    const pendingPrimaryAction = useMemo(
      () =>
        activePendingProgress
          ? {
              questionIndex: activePendingProgress.questionIndex,
              isLastQuestion: activePendingProgress.isLastQuestion,
              canAdvance: activePendingProgress.canAdvance,
              isResponding: activePendingIsResponding,
              isComplete: Boolean(activePendingResolvedAnswers),
            }
          : null,
      [activePendingIsResponding, activePendingProgress, activePendingResolvedAnswers],
    );

    // ------------------------------------------------------------------
    // Prompt helpers
    // ------------------------------------------------------------------
    const setPrompt = useCallback(
      (nextPrompt: string) => {
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
      },
      [composerDraftTarget, setComposerDraftPrompt],
    );

    const removeComposerTerminalContextFromDraft = useCallback(
      (contextId: string) => {
        const contextIndex = composerTerminalContexts.findIndex(
          (context) => context.id === contextId,
        );
        if (contextIndex < 0) return;
        const removal = removeInlineTerminalContextPlaceholder(promptRef.current, contextIndex);
        promptRef.current = removal.prompt;
        setPrompt(removal.prompt);
        removeComposerDraftTerminalContext(composerDraftTarget, contextId);
        const nextCursor = collapseExpandedComposerCursor(removal.prompt, removal.cursor);
        setComposerCursor(nextCursor);
        setComposerTrigger(resolveComposerTrigger(removal.prompt, removal.cursor));
      },
      [
        composerDraftTarget,
        composerTerminalContexts,
        promptRef,
        resolveComposerTrigger,
        removeComposerDraftTerminalContext,
        setPrompt,
      ],
    );

    // ------------------------------------------------------------------
    // Sync refs back to parent
    // ------------------------------------------------------------------
    promptRef.current = prompt;
    composerImagesRef.current = composerImages;
    composerTerminalContextsRef.current = composerTerminalContexts;

    const lastSyncedPendingInputRef = useRef<{
      requestId: string | null;
      questionId: string | null;
    } | null>(null);

    // ------------------------------------------------------------------
    // Callbacks: prompt change
    // ------------------------------------------------------------------
    const onPromptChange = useCallback(
      (
        nextPrompt: string,
        nextCursor: number,
        expandedCursor: number,
        cursorAdjacentToMention: boolean,
        terminalContextIds: string[],
      ) => {
        if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
          setComposerCursor(nextCursor);
          setComposerTrigger(
            cursorAdjacentToMention ? null : resolveComposerTrigger(nextPrompt, expandedCursor),
          );
          handleChangeActivePendingUserInputCustomAnswer(
            activePendingProgress.activeQuestion.id,
            nextPrompt,
            nextCursor,
            expandedCursor,
            cursorAdjacentToMention,
          );
          return;
        }
        promptRef.current = nextPrompt;
        setPrompt(nextPrompt);
        if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
          setComposerDraftTerminalContexts(
            composerDraftTarget,
            syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds),
          );
        }
        setComposerCursor(nextCursor);
        setComposerTrigger(
          cursorAdjacentToMention ? null : resolveComposerTrigger(nextPrompt, expandedCursor),
        );
      },
      [
        activePendingProgress?.activeQuestion,
        pendingUserInputs.length,
        handleChangeActivePendingUserInputCustomAnswer,
        promptRef,
        setPrompt,
        composerDraftTarget,
        composerTerminalContexts,
        resolveComposerTrigger,
        setComposerDraftTerminalContexts,
      ],
    );

    // ------------------------------------------------------------------
    // Callbacks: prompt replacement / menu
    // ------------------------------------------------------------------
    const applyPromptReplacement = useCallback(
      (
        rangeStart: number,
        rangeEnd: number,
        replacement: string,
        options?: { expectedText?: string; focusEditorAfterReplace?: boolean },
      ): boolean => {
        const currentText = promptRef.current;
        const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
        const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
        if (
          options?.expectedText !== undefined &&
          currentText.slice(safeStart, safeEnd) !== options.expectedText
        ) {
          return false;
        }
        const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
        const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
        const nextExpandedCursor = expandCollapsedComposerCursor(next.text, nextCursor);
        promptRef.current = next.text;
        const activePendingQuestion = activePendingProgress?.activeQuestion;
        if (activePendingQuestion && activePendingUserInput) {
          handleChangeActivePendingUserInputCustomAnswer(
            activePendingQuestion.id,
            next.text,
            nextCursor,
            nextExpandedCursor,
            false,
          );
        } else {
          setPrompt(next.text);
        }
        setComposerCursor(nextCursor);
        setComposerTrigger(resolveComposerTrigger(next.text, nextExpandedCursor));
        if (options?.focusEditorAfterReplace !== false) {
          window.requestAnimationFrame(() => {
            composerEditorRef.current?.focusAt(nextCursor);
          });
        }
        return true;
      },
      [
        activePendingProgress?.activeQuestion,
        activePendingUserInput,
        handleChangeActivePendingUserInputCustomAnswer,
        promptRef,
        resolveComposerTrigger,
        setPrompt,
      ],
    );

    const applyPromptReplacementRef = useRef(applyPromptReplacement);
    applyPromptReplacementRef.current = applyPromptReplacement;

    useLayoutEffect(() => {
      if (isComposerApprovalState) return;
      if (composerTrigger?.kind !== "slash-model") return;
      const t = composerTrigger;
      const currentText = promptRef.current;
      const expectedSlice = currentText.slice(t.rangeStart, t.rangeEnd);
      const applied = applyPromptReplacementRef.current(t.rangeStart, t.rangeEnd, "", {
        expectedText: expectedSlice,
        focusEditorAfterReplace: true,
      });
      if (!applied) return;
      setComposerHighlightedItemId(null);
      setModelPickerOpenSearchSeed(t.query.trim());
      setIsComposerModelPickerOpen(true);
    }, [composerTrigger, isComposerApprovalState, promptRef]);

    const readComposerSnapshot = useCallback((): {
      value: string;
      cursor: number;
      expandedCursor: number;
      terminalContextIds: string[];
    } => {
      const editorSnapshot = composerEditorRef.current?.readSnapshot();
      if (editorSnapshot) {
        return editorSnapshot;
      }
      return {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        terminalContextIds: composerTerminalContexts.map((context) => context.id),
      };
    }, [composerCursor, composerTerminalContexts, promptRef]);

    const resolveActiveComposerTrigger = useCallback((): {
      snapshot: { value: string; cursor: number; expandedCursor: number };
      trigger: ComposerTrigger | null;
    } => {
      const snapshot = readComposerSnapshot();
      return {
        snapshot,
        trigger: resolveComposerTrigger(snapshot.value, snapshot.expandedCursor),
      };
    }, [readComposerSnapshot, resolveComposerTrigger]);

    const dismissComposerCommandMenu = useCallback(() => {
      const snapshot = readComposerSnapshot();
      const trigger = detectComposerTrigger(snapshot.value, snapshot.expandedCursor);
      if (trigger) {
        dismissedComposerTriggerKeyRef.current = composerTriggerDismissKey(trigger);
      }
      setComposerTrigger(null);
      setComposerHighlightedItemId(null);
      setComposerHighlightedSearchKey(null);
    }, [composerTriggerDismissKey, readComposerSnapshot]);

    const promptRefVersion = useValueIdentityVersion(promptRef);
    const resolveComposerTriggerVersion = useValueIdentityVersion(resolveComposerTrigger);
    const dismissComposerCommandMenuVersion = useValueIdentityVersion(
      dismissComposerCommandMenu,
    );
    const pendingInputCustomAnswer = activePendingProgress?.customAnswer;
    const pendingInputQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const pendingInputRequestId = activePendingUserInput?.requestId ?? null;
    const lifecycleSync = (
      <>
        <ComposerPromptCursorClampSync
          key={`prompt:${prompt}`}
          prompt={prompt}
          setComposerCursor={setComposerCursor}
        />
        <ComposerMenuHighlightSync
          key={[
            composerMenuOpen,
            activeComposerMenuItemId ?? "",
            composerMenuSearchKey ?? "",
          ].join("\0")}
          activeComposerMenuItemId={activeComposerMenuItemId}
          composerMenuOpen={composerMenuOpen}
          composerMenuSearchKey={composerMenuSearchKey}
          setComposerHighlightedItemId={setComposerHighlightedItemId}
          setComposerHighlightedSearchKey={setComposerHighlightedSearchKey}
        />
        <ComposerPendingInputPromptSync
          key={[
            pendingInputCustomAnswer ?? "",
            pendingInputQuestionId ?? "",
            pendingInputRequestId ?? "",
            promptRefVersion,
            resolveComposerTriggerVersion,
          ].join("\0")}
          activeQuestionId={pendingInputQuestionId}
          customAnswer={pendingInputCustomAnswer}
          lastSyncedPendingInputRef={lastSyncedPendingInputRef}
          promptRef={promptRef}
          requestId={pendingInputRequestId}
          resolveComposerTrigger={resolveComposerTrigger}
          setComposerCursor={setComposerCursor}
          setComposerHighlightedItemId={setComposerHighlightedItemId}
          setComposerTrigger={setComposerTrigger}
        />
        <ComposerDraftResetSync
          key={[draftId ?? "", activeThreadId ?? "", promptRefVersion].join("\0")}
          dismissedComposerTriggerKeyRef={dismissedComposerTriggerKeyRef}
          initialComposerTriggerSuppressionPromptRef={
            initialComposerTriggerSuppressionPromptRef
          }
          promptRef={promptRef}
          setComposerCursor={setComposerCursor}
          setComposerHighlightedItemId={setComposerHighlightedItemId}
          setComposerTrigger={setComposerTrigger}
          suppressInitialComposerTriggerDetectionRef={
            suppressInitialComposerTriggerDetectionRef
          }
        />
        {composerMenuOpen ? (
          <ComposerCommandMenuPointerDismissSync
            key={dismissComposerCommandMenuVersion}
            composerFormRef={composerFormRef}
            dismissComposerCommandMenu={dismissComposerCommandMenu}
          />
        ) : null}
        {composerImageAttachmentPersistenceSync}
      </>
    );

    const onSelectComposerItem = useCallback(
      (item: ComposerCommandItem) => {
        if (composerSelectLockRef.current) return;
        composerSelectLockRef.current = true;
        window.requestAnimationFrame(() => {
          composerSelectLockRef.current = false;
        });
        const { snapshot, trigger } = resolveActiveComposerTrigger();
        if (!trigger) return;
        if (item.type === "path") {
          const replacement = `@${item.path} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "slash-command") {
          if (item.command === "model") {
            const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
              expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
              focusEditorAfterReplace: false,
            });
            if (applied) {
              setComposerHighlightedItemId(null);
              setModelPickerOpenSearchSeed(undefined);
              setIsComposerModelPickerOpen(true);
            }
            return;
          }
          void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          });
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "provider-slash-command") {
          const replacement = `/${item.command.name} `;
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied =
            composerEditorRef.current?.replaceRangeWithCommand(
              trigger.rangeStart,
              replacementRangeEnd,
              {
                id: `provider-slash-command:${item.provider}:${item.command.name}`,
                name: item.command.name,
                content: item.command.description ?? item.command.input?.hint ?? null,
                type: "provider-slash-command",
              },
            ) ?? false;
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.type === "skill") {
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            `/${item.skill.name} `,
          );
          const applied =
            composerEditorRef.current?.replaceRangeWithSkill(
              trigger.rangeStart,
              replacementRangeEnd,
              {
                name: item.skill.name,
                label: formatProviderSkillDisplayName(item.skill),
                description: item.skill.shortDescription ?? item.skill.description ?? null,
                path: item.skill.path,
              },
            ) ?? false;
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
      },
      [applyPromptReplacement, handleInteractionModeChange, resolveActiveComposerTrigger],
    );

    const onComposerMenuItemHighlighted = useCallback(
      (itemId: string | null) => {
        setComposerHighlightedItemId(itemId);
        setComposerHighlightedSearchKey(composerMenuSearchKey);
      },
      [composerMenuSearchKey],
    );

    const nudgeComposerMenuHighlight = useCallback(
      (key: "ArrowDown" | "ArrowUp") => {
        if (composerMenuItems.length === 0) return;
        const highlightedIndex = composerMenuItems.findIndex(
          (item) => item.id === composerHighlightedItemId,
        );
        const normalizedIndex =
          highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
        const offset = key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
        const nextItem = composerMenuItems[nextIndex];
        setComposerHighlightedItemId(nextItem?.id ?? null);
      },
      [composerHighlightedItemId, composerMenuItems],
    );

    // ------------------------------------------------------------------
    // Callbacks: command key
    // ------------------------------------------------------------------
    const onComposerCommandKey = (
      key: "ArrowDown" | "ArrowUp" | "Enter" | "Escape" | "Tab",
      event: KeyboardEvent,
    ) => {
      if (key === "Escape") {
        dismissComposerCommandMenu();
        return true;
      }

      const { trigger } = resolveActiveComposerTrigger();
      const menuIsActive = composerMenuOpenRef.current || trigger !== null;
      if (menuIsActive) {
        const currentItems = composerMenuItemsRef.current;
        const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
        if (key === "ArrowDown" && currentItems.length > 0) {
          nudgeComposerMenuHighlight("ArrowDown");
          return true;
        }
        if (key === "ArrowUp" && currentItems.length > 0) {
          nudgeComposerMenuHighlight("ArrowUp");
          return true;
        }
        if ((key === "Enter" || (key === "Tab" && !event.shiftKey)) && selectedItem) {
          onSelectComposerItem(selectedItem);
          return true;
        }
      }
      if (key === "Enter" && !event.shiftKey) {
        void onSend();
        return true;
      }
      return false;
    };

    const handleInterruptPrimaryAction = useCallback(() => {
      void onInterrupt();
    }, [onInterrupt]);
    // ------------------------------------------------------------------
    // Imperative handle
    // ------------------------------------------------------------------
    useImperativeHandle(
      ref,
      () => ({
        focusAtEnd: () => {
          composerEditorRef.current?.focusAtEnd();
        },
        focusAt: (cursor: number) => {
          composerEditorRef.current?.focusAt(cursor);
        },
        openModelPicker: () => {
          setModelPickerOpenSearchSeed(undefined);
          setIsComposerModelPickerOpen(true);
        },
        toggleModelPicker: () => {
          setModelPickerOpenSearchSeed(undefined);
          setIsComposerModelPickerOpen((open) => !open);
        },
        isModelPickerOpen: () => isComposerModelPickerOpen,
        readSnapshot: () => {
          return readComposerSnapshot();
        },
        resetCursorState: (options?: {
          cursor?: number;
          prompt?: string;
          detectTrigger?: boolean;
        }) => {
          const promptForState = options?.prompt ?? promptRef.current;
          const cursor = clampCollapsedComposerCursor(promptForState, options?.cursor ?? 0);
          setComposerHighlightedItemId(null);
          setComposerCursor(cursor);
          setComposerTrigger(
            options?.detectTrigger
              ? resolveComposerTrigger(
                  promptForState,
                  expandCollapsedComposerCursor(promptForState, cursor),
                )
              : null,
          );
        },
        addTerminalContext: (selection: TerminalContextSelection) => {
          if (!activeThread) return;
          const snapshot = composerEditorRef.current?.readSnapshot() ?? {
            value: promptRef.current,
            cursor: composerCursor,
            expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
            terminalContextIds: composerTerminalContexts.map((context) => context.id),
          };
          const insertion = insertInlineTerminalContextPlaceholder(
            snapshot.value,
            snapshot.expandedCursor,
          );
          const nextCollapsedCursor = collapseExpandedComposerCursor(
            insertion.prompt,
            insertion.cursor,
          );
          const inserted = insertComposerDraftTerminalContext(
            composerDraftTarget,
            insertion.prompt,
            {
              id: randomUUID(),
              threadId: activeThread.id,
              createdAt: new Date().toISOString(),
              ...selection,
            },
            insertion.contextIndex,
          );
          if (!inserted) return;
          promptRef.current = insertion.prompt;
          setComposerCursor(nextCollapsedCursor);
          setComposerTrigger(resolveComposerTrigger(insertion.prompt, insertion.cursor));
          window.requestAnimationFrame(() => {
            composerEditorRef.current?.focusAt(nextCollapsedCursor);
          });
        },
        getSendContext: () => {
          const submitData = composerEditorRef.current?.getSubmitData();
          return {
            prompt: submitData?.text ?? promptRef.current,
            images: composerImagesRef.current,
            terminalContexts: composerTerminalContextsRef.current,
            selectedPromptEffort,
            selectedModelOptionsForDispatch,
            selectedModelSelection,
            selectedProvider,
            selectedModel: instanceCoherentSelectedModel,
            selectedProviderModels,
          };
        },
      }),
      [
        activeThread,
        composerDraftTarget,
        composerCursor,
        composerTerminalContexts,
        insertComposerDraftTerminalContext,
        promptRef,
        composerImagesRef,
        composerTerminalContextsRef,
        isComposerModelPickerOpen,
        readComposerSnapshot,
        resolveComposerTrigger,
        instanceCoherentSelectedModel,
        selectedModelOptionsForDispatch,
        selectedModelSelection,
        selectedPromptEffort,
        selectedProvider,
        selectedProviderModels,
      ],
    );

    const promptInputHeaderContent = activePendingApproval ? (
      <ComposerPendingApprovalPanel
        approval={activePendingApproval}
        pendingCount={pendingApprovals.length}
      />
    ) : pendingUserInputs.length > 0 ? (
      <ComposerPendingUserInputPanel
        pendingUserInputs={pendingUserInputs}
        respondingRequestIds={respondingRequestIds}
        answers={activePendingDraftAnswers}
        questionIndex={activePendingQuestionIndex}
        onToggleOption={handleSelectActivePendingUserInputOption}
      />
    ) : null;
    const showQueuedComposerItems =
      hasQueuedComposerItems && !isComposerApprovalState && pendingUserInputs.length === 0;
    const providerModelPicker = (
      <ProviderModelPicker
        compact={isDockComposerSingleLine}
        {...(isDockComposerSingleLine ? { triggerClassName: "mr-1" } : {})}
        activeInstanceId={selectedInstanceId}
        model={instanceCoherentSelectedModel}
        instanceEntries={providerInstanceEntries}
        keybindings={keybindings}
        modelCatalogItems={modelCatalogItems}
        selectedCatalogItem={selectedCatalogItem}
        availabilityStatus={modelResolverStatus}
        terminalOpen={terminalOpen}
        open={isComposerModelPickerOpen}
        openSearchSeed={modelPickerOpenSearchSeed}
        popoverPlacement={modelPickerPlacement}
        {...(composerProviderState.ultrathinkActive
          ? {
              activeProviderIconClassName: "animate-[ultrathink-chroma-shift_10s_linear_infinite]",
            }
          : {})}
        onOpenChange={(open) => {
          setIsComposerModelPickerOpen(open);
          if (!open) {
            setModelPickerOpenSearchSeed(undefined);
          }
        }}
        onSelectionChange={onProviderModelSelect}
      />
    );
    const compactControlsMenu = (
      <OverflowControls
        key={`${interactionMode}:${runtimeMode}`}
        interactionMode={interactionMode}
        runtimeMode={runtimeMode}
        showInteractionModeToggle={composerProviderControls.showInteractionModeToggle}
        traitsFastMenuContent={dockTraitsMenuFastSlot}
        traitsRestMenuContent={dockTraitsMenuRestSlot}
        onInteractionModeChange={handleInteractionModeChange}
        onRuntimeModeChange={handleRuntimeModeChange}
      />
    );

    // Render
    // ------------------------------------------------------------------
    return (
      <form
        ref={composerFormRef}
        onSubmit={onSend}
        className={cn("w-full min-w-0", !isInlineEditComposer && "mx-auto max-w-agent-chat")}
        data-variant={composerVariant}
        data-chat-input-form="true"
      >
        {lifecycleSync}
        <div
          className={cn(
            "flex w-full min-w-0 shrink-0 flex-col",
            isInlineEditComposer ? "gap-0" : "mx-auto max-w-agent-chat gap-2",
          )}
          data-menu-open={composerMenuOpen ? "" : undefined}
          data-running={phase === "running" ? "" : undefined}
          data-slash-menu-anchor="cursor"
          data-slash-menu-variant="glass"
          data-variant={composerVariant}
        >
          {promptInputHeaderContent ? (
            <div
              className={cn(
                "select-none overflow-hidden border border-b-0 border-multi-stroke-tertiary bg-(--glass-chat-bubble-background) text-multi-fg-primary",
                composerVariant === "compact" ? "rounded-t-2xl" : "rounded-t-xl",
              )}
              data-visible={hasComposerHeader ? "true" : "false"}
            >
              {promptInputHeaderContent}
            </div>
          ) : null}
          <div
            className={cn(
              "group relative w-full max-w-full min-w-0 cursor-text overflow-hidden border shadow-sm transition-[border-color,background-color] duration-200 hover:border-multi-stroke-secondary focus-within:border-multi-stroke-secondary",
              isInlineEditComposer
                ? "rounded-xl border-multi-stroke-tertiary bg-multi-bubble"
                : "border-multi-stroke-tertiary bg-(--glass-chat-bubble-background)",
              !isInlineEditComposer &&
                (hasComposerHeader
                  ? "rounded-b-2xl rounded-t-none"
                  : isDockComposerSingleLine
                    ? "rounded-full"
                    : composerVariant === "compact"
                      ? "rounded-2xl"
                      : "rounded-xl"),
              composerMenuOpen && "overflow-visible!",
              isDragOverComposer ? "border-primary bg-accent/30 ring-2 ring-primary/60" : "",
              composerProviderState.ultrathinkActive &&
                "animate-[ultrathink-rainbow_10s_linear_infinite] bg-[linear-gradient(120deg,oklch(0.712_0.181_22.839)_0%,oklch(0.769_0.165_70.08)_18%,oklch(0.723_0.192_149.579)_36%,oklch(0.704_0.123_182.503)_54%,oklch(0.623_0.188_259.815)_72%,oklch(0.656_0.212_354.308)_90%,oklch(0.712_0.181_22.839)_100%)] bg-[length:220%_220%]",
            )}
            data-has-header={hasComposerHeader ? "" : undefined}
            data-has-images={composerImages.length > 0 ? "" : undefined}
            data-dragging={isDragOverComposer ? "" : undefined}
            data-expanded={isDockComposerExpanded ? "" : undefined}
            data-model-picker-placement={modelPickerPlacement}
            data-plus-menu-placement="bottom-start"
            data-slash-menu-placement="top-start"
            data-variant={composerVariant}
            onClick={handleComposerContainerClick}
            onDragEnter={onComposerDragEnter}
            onDragOver={onComposerDragOver}
            onDragLeave={onComposerDragLeave}
            onDrop={onComposerDrop}
          >
            <div
              className={cn(
                "relative min-w-0 rounded-[inherit] overflow-visible transition-[background-color,box-shadow] duration-200",
                isInlineEditComposer
                  ? "flex flex-col"
                  : isDockComposerSingleLine
                    ? "flex min-h-11 items-center gap-1 px-2.5 py-2"
                    : "flex flex-col",
                variant === "hero" ? "min-h-44" : "",
                composerProviderState.ultrathinkActive &&
                  "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]",
              )}
            >
              {isDockComposerSingleLine && !isComposerApprovalState ? (
                <>
                  <input
                    ref={composerImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    tabIndex={-1}
                    onChange={onComposerImageInputChange}
                  />
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-multi-icon-tertiary transition-colors duration-150 hover:bg-multi-bg-tertiary hover:text-multi-icon-secondary disabled:pointer-events-none disabled:opacity-35"
                    aria-label="Attach images"
                    disabled={pendingUserInputs.length > 0 || isConnecting}
                    onClick={() => composerImageInputRef.current?.click()}
                  >
                    <IconPlusSmall className="size-3.5" aria-hidden="true" />
                  </button>
                </>
              ) : null}
              {showQueuedComposerItems ? (
                <QueuedComposerItemsPanel
                  items={queuedComposerItems}
                  editingItemId={editingQueuedComposerItemId}
                  isBusy={isConnecting || isSendBusy}
                  onBeginEdit={handleBeginEditQueuedComposerItem}
                  onCancelEdit={handleCancelEditingQueuedComposerItem}
                  onRemove={handleRemoveQueuedComposerItem}
                  onSendNow={handleSendQueuedComposerItemNow}
                />
              ) : null}
              <div
                className={cn(
                  "relative min-w-0 select-text",
                  isInlineEditComposer
                    ? "min-h-5"
                    : isDockComposerSingleLine
                      ? "flex min-h-0 flex-1 items-center"
                      : "min-h-9",
                  variant === "hero" && !isDockComposerSingleLine ? "flex flex-1 flex-col" : "",
                )}
                data-expanded={isDockComposerExpanded ? "" : undefined}
                data-variant={composerVariant}
              >
                {!isComposerApprovalState &&
                  pendingUserInputs.length === 0 &&
                  composerImages.length > 0 && (
                    <ComposerImageAttachmentStrip
                      images={composerImages}
                      nonPersistedImageIds={nonPersistedComposerImageIdSet}
                      onExpandImage={onExpandImage}
                      onRemoveImage={removeComposerImage}
                    />
                  )}

                <ComposerPromptEditor
                  ref={composerEditorRef}
                  value={
                    isComposerApprovalState
                      ? ""
                      : activePendingProgress
                        ? activePendingProgress.customAnswer
                        : prompt
                  }
                  cursor={composerCursor}
                  terminalContexts={
                    !isComposerApprovalState && pendingUserInputs.length === 0
                      ? composerTerminalContexts
                      : []
                  }
                  skills={selectedProviderStatus?.skills ?? []}
                  onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                  onMeasuredMultilineChange={setIsComposerEditorMultiline}
                  onChange={onPromptChange}
                  onCommandKeyDown={onComposerCommandKey}
                  hotkeyTargetRef={composerEditorHotkeyRef}
                  onPaste={onComposerPaste}
                  className={cn(
                    isInlineEditComposer && "!min-h-5 !max-h-60 !px-3 !py-2",
                    isDockComposerSingleLine && "!min-h-5 !max-h-5 !overflow-hidden !p-0 !pl-1",
                  )}
                  placeholder={
                    isComposerApprovalState
                      ? (activePendingApproval?.detail ??
                        "Resolve this approval request to continue")
                      : activePendingProgress
                        ? "Type your own answer, or leave this blank to use the selected option"
                        : showPlanFollowUpPrompt && activeProposedPlan
                          ? "Add feedback to refine the plan, or leave this blank to implement it"
                          : isEditingQueuedComposerItem
                            ? "Editing queued message..."
                            : isInlineEditComposer
                              ? "Edit message"
                              : phase === "disconnected"
                                ? "Ask for follow-up changes or attach images"
                                : composerVariant === "compact"
                                  ? "Send follow-up"
                                  : "Ask anything, @tag files/folders, or use / to show available commands"
                  }
                  disabled={isConnecting || isComposerApprovalState}
                />
              </div>
              {composerMenuOpen && !isComposerApprovalState && (
                <div
                  className={cn(
                    "absolute bottom-[calc(100%+8px)] left-0 z-[60]",
                    composerMenuKind === "mentions" ? "w-64 max-w-full" : "w-80 max-w-full",
                  )}
                  data-menu-kind={composerMenuKind}
                >
                  <ComposerCommandMenu
                    items={composerMenuItems}
                    resolvedTheme={resolvedTheme}
                    isLoading={isComposerMenuLoading}
                    ariaLabel={composerMenuAriaLabel}
                    menuKind={composerMenuKind}
                    triggerKind={composerTriggerKind}
                    groupSlashCommandSections={composerTrigger?.kind === "slash-command"}
                    emptyStateText={composerMenuEmptyState}
                    activeItemId={activeComposerMenuItem?.id ?? null}
                    onHighlightedItemChange={onComposerMenuItemHighlighted}
                    onSelect={onSelectComposerItem}
                  />
                </div>
              )}
              {/* Bottom toolbar */}
              {activePendingApproval ? (
                <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
                  <ComposerPendingApprovalActions
                    requestId={activePendingApproval.requestId}
                    isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                    onRespondToApproval={handleRespondToApproval}
                  />
                </div>
              ) : (
                <ComposerFooter
                  composerVariant={composerVariant}
                  inlineEdit={isInlineEditComposer}
                  isDockComposerExpanded={isDockComposerExpanded}
                  providerModelPicker={providerModelPicker}
                  compactControlsMenu={compactControlsMenu}
                  providerTraitsPicker={providerTraitsPicker}
                  secondaryAction={footerSecondaryAction}
                  showInteractionModeToggle={composerProviderControls.showInteractionModeToggle}
                  interactionMode={interactionMode}
                  runtimeMode={runtimeMode}
                  primaryActionState={{
                    activeContextWindow: visibleContextWindow,
                    pendingAction: pendingPrimaryAction,
                    isRunning: phase === "running",
                    showPlanFollowUpPrompt:
                      pendingUserInputs.length === 0 &&
                      showPlanFollowUpPrompt &&
                      prompt.trim().length > 0,
                    isSendBusy,
                    isConnecting,
                    isPreparingWorktree,
                    submitDisabled,
                    hasSendableContent:
                      composerSendState.hasSendableContent || canSubmitQueuedComposerItem,
                    sendWhileStreamingBehavior: settings.agentWindowSendWhileStreamingBehavior,
                    submitActionLabel: isEditingQueuedComposerItem
                      ? "Save queued message"
                      : undefined,
                  }}
                  onToggleInteractionMode={toggleInteractionMode}
                  onRuntimeModeChange={handleRuntimeModeChange}
                  onAdvancePendingQuestion={handleAdvanceActivePendingUserInput}
                  onPreviousPendingQuestion={handlePreviousActivePendingUserInputQuestion}
                  onInterrupt={handleInterruptPrimaryAction}
                />
              )}
            </div>
          </div>
        </div>
      </form>
    );
  }),
);
