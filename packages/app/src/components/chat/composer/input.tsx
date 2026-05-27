import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type RefObject,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Button } from "@multi/ui/button";
import { Menu, MenuPopup, MenuSeparator as MenuDivider, MenuTrigger } from "@multi/ui/menu";
import { Separator } from "@multi/ui/separator";
import {
  IconArrowUp,
  IconBubbleQuestion,
  IconChevronLeftMedium,
  IconCrossSmall,
  IconDotGrid1x3Horizontal,
  IconEyeOpen,
  IconPlusSmall,
  IconStop,
  IconTodos,
  type CentralIconBaseProps,
} from "central-icons";
import {
  defaultInstanceIdForDriver,
  type MessageId,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInteractionMode,
  type ProviderOptionSelection,
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
  isUnresolvedStandaloneComposerSlashCommand,
  replaceTextRange,
} from "./prompt-triggers";
import { deriveComposerSendState } from "../composer-submit";
import {
  type ComposerThreadDraftState,
  type DraftId,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../../stores/chat-drafts";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "./prompt-editor";
import { ProviderModelPicker } from "../picker/model-picker";
import {
  type ComposerCommandItem,
  ComposerCommandMenuPositioned,
  useComposerCommandMenu,
} from "./slash-menu";
import {
  composerMenuPopoverAnchorFromElement,
  type ComposerMenuPopoverAnchor,
} from "./composer-menu-anchor";
import { ComposerPendingApprovalActions } from "./pending-approval-actions";
import { ComposerPendingApprovalPanel } from "./pending-approval-panel";
import { ComposerPendingUserInputPanel } from "./pending-user-input-panel";
import { cn } from "~/lib/utils";
import { cva } from "class-variance-authority";
import type { QueuedComposerItem } from "../../../stores/chat-send-queue";
import { useComposerKeyboard } from "./use-composer-keyboard";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { useComposerImageAttachments } from "./use-image-attachments";
import { ComposerImageAttachmentStrip } from "./image-attachment-strip";
import ChatMarkdown from "../markdown/chat-markdown";
import {
  type ComposerFooterPendingAction,
  type ComposerInputHandle,
  type ComposerInputProps,
} from "./input-contract";
import { QueuedComposerEditBanner, QueuedComposerItemsPanel } from "./queued-items-panel";
import { SubagentPreviewTrayStack } from "./subagent-preview-tray";
import { ComposerContextUsageBar } from "./composer-context-usage-bar";
import { deriveLatestContextWindowSnapshot } from "../../../lib/context-window";
import { formatProviderSkillDisplayName } from "./provider-skills";
import { useMountEffect } from "~/hooks/use-mount-effect";
import {
  getComposerProviderState,
  resolveProviderTraitsState,
  type ProviderTraitsScope,
} from "../../../model/provider-state";
import { TraitsMenuContent, TraitsPicker } from "../picker/traits-picker";
import { resolveAppProviderModelState } from "../../../model/selection";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "~/plan/proposed-plan";

export type { ComposerInputHandle, ComposerInputProps } from "./input-contract";

const composerEditorClass = cva(
  "block w-full min-w-0 overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-multi-fg-secondary outline-hidden",
  {
    variants: {
      mode: {
        "new-agent": "min-h-14 max-h-[min(75vh,420px)] px-3 py-2",
        "thread-multiline": "min-w-0 px-3 pt-2",
        "thread-pill": "flex-1 pl-1",
        "inline-edit": "min-h-5 max-h-60 px-3 py-2",
      },
    },
  },
);

const composerShellClass = cva("relative z-[1] min-w-0 rounded-[inherit]", {
  variants: {
    mode: {
      "new-agent": "flex flex-col gap-2 px-2.5 pt-2 pb-1.5",
      thread: "",
      "inline-edit": "flex flex-col",
    },
  },
});

type ComposerEditorMode = "new-agent" | "thread-multiline" | "thread-pill" | "inline-edit";
type ComposerShellMode = "new-agent" | "thread" | "inline-edit";

const EMPTY_QUEUED_COMPOSER_ITEMS: QueuedComposerItem[] = [];
Object.freeze(EMPTY_QUEUED_COMPOSER_ITEMS);

const EMPTY_PENDING_APPROVALS: NonNullable<ComposerInputProps["pendingApprovals"]> = [];
Object.freeze(EMPTY_PENDING_APPROVALS);

const PLAN_FOLLOW_UP_PRIMARY_BUTTON_CLASS =
  "bg-(--cursor-bg-yellow-primary) text-detail text-(--vscode-editor-background) hover:bg-[color-mix(in_srgb,var(--cursor-bg-yellow-primary)_80%,var(--cursor-bg-yellow-secondary))] data-pressed:bg-[color-mix(in_srgb,var(--cursor-bg-yellow-primary)_80%,var(--cursor-bg-yellow-secondary))] [&_svg]:size-3.5";
const PLAN_FOLLOW_UP_SECONDARY_BUTTON_CLASS = "px-2 text-detail [&_svg]:size-3.5";

type ActiveComposerInteractionMode = Exclude<ProviderInteractionMode, "default">;

const interactionModeChipClass = cva(
  "inline-flex h-6 w-fit max-w-full shrink-0 items-center gap-1 overflow-hidden rounded-full border-0 px-2 pr-1 text-(length:--multi-text-body) leading-none font-medium shadow-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      mode: {
        ask: "bg-(--composer-mode-chat-background) text-(--composer-mode-chat-text) hover:bg-[color-mix(in_srgb,var(--composer-mode-chat-background)_78%,var(--vscode-list-hoverBackground))]",
        plan: "bg-(--composer-mode-plan-background) text-(--composer-mode-plan-text) hover:bg-[color-mix(in_srgb,var(--composer-mode-plan-background)_82%,var(--vscode-list-hoverBackground))]",
      },
    },
  },
);

function getInteractionModeChipConfig(mode: ActiveComposerInteractionMode): {
  readonly label: string;
  readonly title: string;
  readonly Icon: ComponentType<CentralIconBaseProps>;
} {
  switch (mode) {
    case "ask":
      return {
        label: "Ask",
        title: "Ask mode - click to return to Build",
        Icon: IconBubbleQuestion,
      };
    case "plan":
      return {
        label: "Plan",
        title: "Plan mode - click to return to Build",
        Icon: IconTodos,
      };
  }
}

const ComposerInteractionModeChip = memo(function ComposerInteractionModeChip(props: {
  mode: ActiveComposerInteractionMode;
  shortcutLabel: string | null;
  onClear: () => void;
}) {
  const chip = getInteractionModeChipConfig(props.mode);
  const ChipIcon = chip.Icon;

  return (
    <Button
      variant="ghost"
      className={cn(
        interactionModeChipClass({ mode: props.mode }),
        "p-0 hover:text-inherit data-pressed:text-inherit",
      )}
      data-composer-interaction-mode-chip=""
      data-mode={props.mode}
      type="button"
      onClick={props.onClear}
      title={`${chip.title}${props.shortcutLabel ? ` (${props.shortcutLabel})` : ""}`}
    >
      <ChipIcon aria-hidden />
      <span className="min-w-0 truncate">{chip.label}</span>
      <span
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-current opacity-70 hover:opacity-100"
        aria-hidden="true"
      >
        <IconCrossSmall />
      </span>
    </Button>
  );
});

const PlanFollowUpTray = memo(function PlanFollowUpTray(props: {
  plan: NonNullable<ComposerInputProps["activeProposedPlan"]>;
  compact: boolean;
  gitCwd: string | undefined;
  isBuilding: boolean;
  planSurfaceOpen: boolean;
  onBuildPlan: (() => void) | undefined;
  onViewPlan: (() => void) | undefined;
}) {
  const planKey = String(props.plan.id);
  const [dismissedPlanId, setDismissedPlanId] = useState<string | null>(null);
  const title = useMemo(() => proposedPlanTitle(props.plan.planMarkdown) ?? "Plan", [props.plan]);
  const previewMarkdown = useMemo(
    () => stripDisplayedPlanMarkdown(props.plan.planMarkdown).trim(),
    [props.plan],
  );
  const showViewPlan = props.onViewPlan !== undefined && !props.planSurfaceOpen;

  if (dismissedPlanId === planKey) {
    return null;
  }

  return (
    <div
      className={cn(
        "plan-tray pointer-events-auto min-w-0 overflow-hidden rounded-(--multi-composer-plan-tray-radius) bg-multi-bg-elevated font-multi text-detail text-multi-fg-primary shadow-multi-card",
        props.compact ? "mx-auto w-full" : "",
      )}
      data-testid="plan-tray"
      data-visible="true"
      style={{ transformOrigin: "bottom left" }}
    >
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="text-caption font-medium text-multi-fg-tertiary">Review Plan</div>
          <div className="truncate text-detail font-medium text-multi-fg-primary" title={title}>
            {title}
          </div>
        </div>
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded-multi-control bg-multi-bg-quinary text-multi-icon-secondary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-icon-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
          aria-label="Dismiss plan"
          title="Dismiss plan"
          onClick={() => setDismissedPlanId(planKey)}
        >
          <IconCrossSmall className="size-3" aria-hidden />
        </button>
      </div>

      {previewMarkdown ? (
        <div className="plan-tray__description relative px-3 pb-2">
          <div className="plan-tray__markdown">
            <ChatMarkdown text={previewMarkdown} cwd={props.gitCwd} />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-9 min-w-0 items-center justify-between gap-2.5 px-2.5 py-1.5">
        {showViewPlan ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={PLAN_FOLLOW_UP_SECONDARY_BUTTON_CLASS}
            onClick={props.onViewPlan}
          >
            <IconEyeOpen aria-hidden />
            <span>View Plan</span>
          </Button>
        ) : (
          <span className="h-6 min-w-0" aria-hidden />
        )}
        <Button
          type="button"
          variant="default"
          size="sm"
          className={PLAN_FOLLOW_UP_PRIMARY_BUTTON_CLASS}
          disabled={props.isBuilding || !props.onBuildPlan}
          aria-label="Build plan"
          title="Build plan"
          onClick={props.onBuildPlan}
        >
          <IconArrowUp aria-hidden />
          <span>{props.isBuilding ? "Building..." : "Build"}</span>
        </Button>
      </div>
    </div>
  );
});

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

function renderProviderTraitsMenuContent(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsMenuContent, input);
}

function renderProviderTraitsPicker(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsPicker, input);
}

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

const ignoreQueuedComposerItem = (_itemId: MessageId): void => undefined;
const ignoreQueuedComposerItemReorder = (
  _itemId: MessageId,
  _targetItemId: MessageId | null,
  _insertAfter: boolean,
): void => undefined;
const ignoreQueuedComposerEditCancel = (): void => undefined;
const ignoreQueuedComposerExpandedChange = (_expanded: boolean): void => undefined;
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

type ComposerTriggerDismissal =
  | { kind: "path"; key: string }
  | { kind: "slash-command"; query: string; rangeStart: number };

function composerPathTriggerDismissKey(trigger: ComposerTrigger): string {
  return `${trigger.kind}:${trigger.rangeStart}:${trigger.rangeEnd}:${trigger.query}`;
}

function composerTriggerDismissalFor(trigger: ComposerTrigger): ComposerTriggerDismissal {
  if (trigger.kind === "slash-command") {
    return { kind: "slash-command", query: trigger.query, rangeStart: trigger.rangeStart };
  }
  return { kind: "path", key: composerPathTriggerDismissKey(trigger) };
}

function isComposerTriggerDismissed(
  trigger: ComposerTrigger,
  dismissal: ComposerTriggerDismissal | null,
): boolean {
  if (!dismissal) {
    return false;
  }
  if (trigger.kind === "slash-command") {
    return (
      dismissal.kind === "slash-command" &&
      dismissal.rangeStart === trigger.rangeStart &&
      trigger.query.startsWith(dismissal.query)
    );
  }
  return dismissal.kind === "path" && dismissal.key === composerPathTriggerDismissKey(trigger);
}

function mapComposerTriggerDismissalThroughPromptChange(
  dismissal: ComposerTriggerDismissal | null,
  previousPrompt: string,
  nextPrompt: string,
): ComposerTriggerDismissal | null {
  if (!dismissal || dismissal.kind !== "slash-command") {
    return dismissal;
  }

  if (previousPrompt[dismissal.rangeStart] !== "/" || nextPrompt[dismissal.rangeStart] !== "/") {
    return null;
  }
  return dismissal;
}

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
  lastSyncedPendingInputRef: RefObject<{
    requestId: string | null;
    questionId: string | null;
  } | null>;
  promptRef: RefObject<string>;
  requestId: string | null;
  resolveComposerTrigger: (text: string, expandedCursor: number) => ComposerTrigger | null;
  setComposerCursor: Dispatch<SetStateAction<number>>;
  setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
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
  dismissedComposerTriggerRef,
  initialComposerTriggerSuppressionPromptRef,
  promptRef,
  setComposerCursor,
  setComposerHighlightedItemId,
  setComposerTrigger,
  suppressInitialComposerTriggerDetectionRef,
}: {
  dismissedComposerTriggerRef: RefObject<ComposerTriggerDismissal | null>;
  initialComposerTriggerSuppressionPromptRef: RefObject<string>;
  promptRef: RefObject<string>;
  setComposerCursor: Dispatch<SetStateAction<number>>;
  setComposerHighlightedItemId: Dispatch<SetStateAction<string | null>>;
  setComposerTrigger: Dispatch<SetStateAction<ComposerTrigger | null>>;
  suppressInitialComposerTriggerDetectionRef: RefObject<boolean>;
}) {
  useMountEffect(() => {
    setComposerHighlightedItemId(null);
    setComposerCursor(collapseExpandedComposerCursor(promptRef.current, promptRef.current.length));
    suppressInitialComposerTriggerDetectionRef.current = true;
    initialComposerTriggerSuppressionPromptRef.current = promptRef.current;
    dismissedComposerTriggerRef.current = null;
    setComposerTrigger(null);
  });

  return null;
}

function ComposerMenuAnchorObserverSync({
  composerMenuAnchorRef,
  setComposerMenuAnchorRevision,
}: {
  composerMenuAnchorRef: RefObject<HTMLSpanElement | null>;
  setComposerMenuAnchorRevision: Dispatch<SetStateAction<number>>;
}) {
  useMountEffect(() => {
    if (typeof MutationObserver === "undefined") {
      return;
    }
    const anchor = composerMenuAnchorRef.current;
    if (!anchor) {
      return;
    }

    // Cursor observes the fake caret's style attribute and refreshes Floating
    // UI when it moves. The anchor reads live DOM rects; this revision bump
    // repositions the popover without caching stale coordinates in React.
    const observer = new MutationObserver(() => {
      setComposerMenuAnchorRevision((value) => value + 1);
    });
    observer.observe(anchor, { attributeFilter: ["style"] });
    return () => {
      observer.disconnect();
    };
  });

  return null;
}

function ComposerMenuAnchorRevisionSync({
  setComposerMenuAnchorRevision,
}: {
  setComposerMenuAnchorRevision: Dispatch<SetStateAction<number>>;
}) {
  useMountEffect(() => {
    setComposerMenuAnchorRevision((value) => value + 1);
  });

  return null;
}

function closestPointerTargetElement(target: Node): Element | null {
  return target instanceof Element ? target : target.parentElement;
}

function isComposerCommandMenuPointerTarget(target: Node): boolean {
  return closestPointerTargetElement(target)?.closest("[data-composer-command-menu-root]") != null;
}

function isPromptEditorPointerTarget(target: Node): boolean {
  return closestPointerTargetElement(target)?.closest("[data-prompt-editor-input]") != null;
}

function ComposerCommandMenuPointerDismissSync({
  dismissComposerCommandMenu,
}: {
  dismissComposerCommandMenu: () => void;
}) {
  useMountEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node) {
        if (isComposerCommandMenuPointerTarget(target)) return;
        if (isPromptEditorPointerTarget(target)) return;
      }
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
  if (value === "default" || value === "ask" || value === "plan") return value;
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
  traitsFastMenuContent?: ReactNode | null | undefined;
  traitsRestMenuContent?: ReactNode | null | undefined;
}) {
  const hasBothTraitGroups = Boolean(props.traitsFastMenuContent && props.traitsRestMenuContent);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              COMPOSER_TOOLBAR_CONTROL_SIZE,
              "shrink-0 rounded-full p-0 text-muted-foreground/70 hover:text-foreground/80",
            )}
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
            {hasBothTraitGroups ? <MenuDivider variant="workbench" /> : null}
          </>
        ) : null}
        {props.traitsRestMenuContent ? <>{props.traitsRestMenuContent}</> : null}
      </MenuPopup>
    </Menu>
  );
});

const COMPOSER_ACTION_SIZE_COMPACT = "h-6 w-6";
const COMPOSER_ACTION_SIZE_EXPANDED = "h-6 w-6";
const COMPOSER_TOOLBAR_CONTROL_SIZE = "h-6 w-6";
const COMPOSER_ACTION_ICON_COMPACT = "size-3.5";
const COMPOSER_ACTION_ICON_EXPANDED = "size-3.5";
const COMPOSER_SUBMIT_BASE_CLASS =
  "flex enabled:cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-[color,opacity,transform] duration-100 hover:opacity-90 motion-reduce:transition-opacity motion-reduce:active:scale-100 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30 disabled:hover:opacity-30";
const COMPOSER_STOP_BASE_CLASS =
  "flex cursor-pointer items-center justify-center rounded-full bg-rose-500/90 text-white transition-[background-color,color,opacity,transform] duration-100 hover:bg-rose-500 motion-reduce:transition-colors motion-reduce:active:scale-100 active:scale-[0.96]";

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
  const sizeClass = props.dockSingleRow
    ? COMPOSER_ACTION_SIZE_COMPACT
    : COMPOSER_ACTION_SIZE_EXPANDED;
  const iconSizeClass = props.dockSingleRow
    ? COMPOSER_ACTION_ICON_COMPACT
    : COMPOSER_ACTION_ICON_EXPANDED;
  const dataState: "running" | "busy" | "idle" = props.isRunning
    ? "running"
    : props.isConnecting || props.isSendBusy || props.isPreparingWorktree
      ? "busy"
      : "idle";
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
          ? "Stop and send"
          : "Send immediately");
    const stopButton = (
      <button
        type="button"
        data-multi-composer-action="stop"
        data-multi-composer-state={dataState}
        className={cn(COMPOSER_STOP_BASE_CLASS, sizeClass)}
        onClick={props.onInterrupt}
        aria-label="Stop generation"
      >
        <IconStop className={iconSizeClass} />
      </button>
    );

    if (props.hasSendableContent) {
      return (
        <div className={cn("flex items-center justify-end", props.compact ? "gap-1.5" : "gap-2")}>
          {stopButton}
          <button
            type="submit"
            data-multi-composer-action="submit"
            data-multi-composer-state={dataState}
            className={cn(COMPOSER_SUBMIT_BASE_CLASS, sizeClass)}
            disabled={props.isSendBusy || props.isConnecting || !props.hasSendableContent}
            aria-label={runningSendLabel}
            title={runningSendLabel}
          >
            <IconArrowUp className={iconSizeClass} />
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
        className={PLAN_FOLLOW_UP_PRIMARY_BUTTON_CLASS}
        disabled={props.isSendBusy || props.isConnecting}
        aria-label="Refine plan"
        title="Refine plan"
      >
        <IconArrowUp aria-hidden />
        {props.isConnecting || props.isSendBusy ? "Sending..." : "Refine"}
      </Button>
    );
  }

  const spinnerSize = props.dockSingleRow ? 12 : 14;
  const spinnerCenter = spinnerSize / 2;
  const spinnerRadius = props.dockSingleRow ? 4.5 : 5.5;
  const spinnerDash = props.dockSingleRow ? "17 10" : "20 12";

  return (
    <button
      type="submit"
      data-multi-composer-action="submit"
      data-multi-composer-state={dataState}
      className={cn(COMPOSER_SUBMIT_BASE_CLASS, sizeClass)}
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
          width={spinnerSize}
          height={spinnerSize}
          viewBox={`0 0 ${spinnerSize} ${spinnerSize}`}
          fill="none"
          className="animate-spin"
          aria-hidden="true"
        >
          <circle
            cx={spinnerCenter}
            cy={spinnerCenter}
            r={spinnerRadius}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={spinnerDash}
          />
        </svg>
      ) : (
        <IconArrowUp className={iconSizeClass} />
      )}
    </button>
  );
});

const ComposerFooter = memo(function ComposerFooter(props: {
  compactControlsMenu: ReactNode;
  composerVariant: "compact" | "expanded";
  inlineEdit: boolean;
  isDockComposerExpanded: boolean;
  primaryActionState: {
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
  onAdvancePendingQuestion: () => void;
  onInterrupt: () => void;
  onPreviousPendingQuestion: () => void;
}) {
  const dockSingleRow = props.composerVariant === "compact" && !props.isDockComposerExpanded;
  const dockExpanded = props.composerVariant === "compact" && props.isDockComposerExpanded;
  const primaryActionsCompact =
    dockSingleRow ||
    props.primaryActionState.showPlanFollowUpPrompt ||
    props.primaryActionState.pendingAction !== null;

  const isThreadShell = !props.inlineEdit && props.composerVariant === "compact";
  const hasSecondaryToolbarControls = Boolean(props.providerTraitsPicker);

  return (
    <div
      data-chat-input-footer="true"
      data-chat-input-footer-compact={dockSingleRow ? "true" : "false"}
      data-multi-composer-toolbar={isThreadShell ? "bottom" : undefined}
      className={cn(
        "min-w-0",
        dockSingleRow
          ? "flex min-w-0 shrink items-center gap-1"
          : cn(
              "flex w-full items-center justify-between",
              dockExpanded ? "gap-[0.55rem]" : "gap-2",
              props.inlineEdit ? "px-3 pb-2" : isThreadShell ? "" : "px-2.5 pb-2.5 sm:px-3 sm:pb-3",
            ),
      )}
    >
      <div
        data-multi-composer-toolbar="left"
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

        {!dockSingleRow && hasSecondaryToolbarControls ? (
          <span className="hidden min-w-0 shrink-0 items-center gap-1 sm:inline-flex">
            {props.providerTraitsPicker ? (
              <>
                <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
                {props.providerTraitsPicker}
              </>
            ) : null}
          </span>
        ) : null}
      </div>

      <div
        data-chat-input-actions="right"
        data-chat-input-primary-actions-compact={primaryActionsCompact ? "true" : "false"}
        className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
      >
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
      variant = "compact",
      layout = "thread",
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
      queuedComposerItemsExpanded = true,
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
      planSurfaceOpen = false,
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
      footerSecondaryAction,
      onSend,
      onInterrupt,
      onBuildPlan,
      onViewPlan,
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
      onReorderQueuedComposerItem,
      onQueuedComposerItemsExpandedChange,
      toggleInteractionMode,
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
    const handleReorderQueuedComposerItem =
      onReorderQueuedComposerItem ?? ignoreQueuedComposerItemReorder;
    const handleQueuedComposerItemsExpandedChange =
      onQueuedComposerItemsExpandedChange ?? ignoreQueuedComposerExpandedChange;
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
    const isEditingQueuedComposerItem = editingQueuedComposerItemId !== null;
    const isInlineEditComposer = layout === "inline-edit";
    const isNewAgentComposer = layout === "new-agent";
    const composerVariant = variant;
    const showModeControls = !isInlineEditComposer && !isEditingQueuedComposerItem;
    const modelPickerPlacement =
      modelPickerPlacementProp ?? (composerVariant === "compact" ? "top-start" : "bottom-start");

    // ------------------------------------------------------------------
    // Store subscriptions (prompt / images)
    // ------------------------------------------------------------------
    const composerDraft = useComposerThreadDraft(composerDraftTarget);
    const prompt = composerDraft.prompt;
    const composerImages = composerDraft.images;
    const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;

    const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);

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
    const composerMenuAnchorRef = useRef<HTMLSpanElement | null>(null);
    const composerMenuPopoverAnchorRef = useRef<ComposerMenuPopoverAnchor>(
      composerMenuPopoverAnchorFromElement(() => composerMenuAnchorRef.current),
    );
    const composerSelectLockRef = useRef(false);
    const composerMenuOpenRef = useRef(false);
    const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
    const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
    const suppressInitialComposerTriggerDetectionRef = useRef(true);
    const initialComposerTriggerSuppressionPromptRef = useRef(prompt);
    const dismissedComposerTriggerRef = useRef<ComposerTriggerDismissal | null>(null);

    const focusComposer = useCallback(() => {
      composerEditorRef.current?.focusAtEnd();
    }, []);

    const scheduleComposerFocus = useCallback(() => {
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAtEnd();
      });
    }, []);

    useComposerKeyboard({
      enabled: showModeControls,
      keybindings,
      terminalOpen,
      targetRef: composerEditorHotkeyRef,
      onToggleInteractionMode: toggleInteractionMode,
    });
    const interactionModeShortcutLabel = useMemo(
      () =>
        shortcutLabelForCommand(keybindings, "composer.cycleInteractionMode", {
          context: { terminalFocus: false, terminalOpen },
        }),
      [keybindings, terminalOpen],
    );

    const resolveComposerTrigger = useCallback(
      (text: string, expandedCursor: number): ComposerTrigger | null => {
        if (suppressInitialComposerTriggerDetectionRef.current) {
          if (text === initialComposerTriggerSuppressionPromptRef.current) {
            const shouldAllowBareSlashTrigger = /(?:^|\s|\()\/$/.test(text);
            if (!shouldAllowBareSlashTrigger) {
              return null;
            }
          }
          suppressInitialComposerTriggerDetectionRef.current = false;
        }
        const nextTrigger = detectComposerTrigger(text, expandedCursor);
        if (!nextTrigger) {
          dismissedComposerTriggerRef.current = null;
          return null;
        }
        if (isComposerTriggerDismissed(nextTrigger, dismissedComposerTriggerRef.current)) {
          return null;
        }
        dismissedComposerTriggerRef.current = null;
        return nextTrigger;
      },
      [],
    );

    // ------------------------------------------------------------------
    // Derived: composer send state
    // ------------------------------------------------------------------
    const composerSendState = useMemo(
      () =>
        deriveComposerSendState({
          prompt,
          imageCount: composerImages.length,
        }),
      [composerImages.length, prompt],
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
      composerMenuIsSearching,
    } = useComposerCommandMenu({
      allowModeSlashCommands: showModeControls,
      composerTrigger,
      environmentId,
      gitCwd,
      selectedProvider,
      selectedProviderStatus,
      providerStatuses,
      highlightedItemId: composerHighlightedItemId,
      highlightedSearchKey: composerHighlightedSearchKey,
    });

    composerMenuOpenRef.current = composerMenuOpen;
    composerMenuItemsRef.current = composerMenuItems;
    activeComposerMenuItemRef.current = activeComposerMenuItem;

    const [composerMenuAnchorRevision, setComposerMenuAnchorRevision] = useState(0);

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
    const queuedComposerActionsBusy = isConnecting || isSendBusy || phase === "running";
    const canSubmitQueuedComposerItem =
      hasQueuedComposerItems && !isEditingQueuedComposerItem && !queuedComposerActionsBusy;
    const hasComposerHeader = isComposerApprovalState || pendingUserInputs.length > 0;

    const promptHasExplicitLineBreak = prompt.includes("\n");
    const isDockComposerExpanded =
      composerVariant === "compact" &&
      (isInlineEditComposer ||
        hasComposerHeader ||
        isEditingQueuedComposerItem ||
        composerImages.length > 0 ||
        activePendingProgress !== null ||
        promptHasExplicitLineBreak ||
        isComposerEditorMultiline);

    const isDockComposerSingleLine = composerVariant === "compact" && !isDockComposerExpanded;
    const composerEditorMode: ComposerEditorMode = isInlineEditComposer
      ? "inline-edit"
      : isNewAgentComposer
        ? "new-agent"
        : isDockComposerSingleLine
          ? "thread-pill"
          : "thread-multiline";
    const composerShellMode: ComposerShellMode = isInlineEditComposer
      ? "inline-edit"
      : isNewAgentComposer
        ? "new-agent"
        : "thread";

    const showPlanTray =
      !isInlineEditComposer &&
      !isComposerApprovalState &&
      pendingUserInputs.length === 0 &&
      showPlanFollowUpPrompt &&
      activeProposedPlan !== null;

    // ------------------------------------------------------------------
    // Prompt helpers
    // ------------------------------------------------------------------
    const setPrompt = useCallback(
      (nextPrompt: string) => {
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
      },
      [composerDraftTarget, setComposerDraftPrompt],
    );

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
        dismissedComposerTriggerRef.current = mapComposerTriggerDismissalThroughPromptChange(
          dismissedComposerTriggerRef.current,
          promptRef.current,
          next.text,
        );
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

    // ------------------------------------------------------------------
    // Provider traits UI
    // ------------------------------------------------------------------
    const setPromptFromTraits = useCallback(
      (nextPrompt: string) => {
        if (nextPrompt === promptRef.current) {
          scheduleComposerFocus();
          return;
        }
        dismissedComposerTriggerRef.current = mapComposerTriggerDismissalThroughPromptChange(
          dismissedComposerTriggerRef.current,
          promptRef.current,
          nextPrompt,
        );
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
    // Sync refs back to parent
    // ------------------------------------------------------------------
    promptRef.current = prompt;
    composerImagesRef.current = composerImages;

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
      ) => {
        dismissedComposerTriggerRef.current = mapComposerTriggerDismissalThroughPromptChange(
          dismissedComposerTriggerRef.current,
          promptRef.current,
          nextPrompt,
        );
        if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
          promptRef.current = nextPrompt;
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
          if (nextPrompt.includes("\n")) {
            setIsComposerEditorMultiline(true);
          } else if (nextPrompt.trim().length === 0) {
            setIsComposerEditorMultiline(false);
          }
          return;
        }
        promptRef.current = nextPrompt;
        setPrompt(nextPrompt);
        setComposerCursor(nextCursor);
        setComposerTrigger(
          cursorAdjacentToMention ? null : resolveComposerTrigger(nextPrompt, expandedCursor),
        );
        if (nextPrompt.includes("\n")) {
          setIsComposerEditorMultiline(true);
        } else if (nextPrompt.trim().length === 0) {
          setIsComposerEditorMultiline(false);
        }
      },
      [
        activePendingProgress?.activeQuestion,
        pendingUserInputs.length,
        handleChangeActivePendingUserInputCustomAnswer,
        promptRef,
        setPrompt,
        resolveComposerTrigger,
      ],
    );

    const readComposerSnapshot = useCallback((): {
      value: string;
      cursor: number;
      expandedCursor: number;
    } => {
      const editorSnapshot = composerEditorRef.current?.readSnapshot();
      if (editorSnapshot) {
        return editorSnapshot;
      }
      return {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      };
    }, [composerCursor, promptRef]);

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

    const clearComposerCommandMenuState = useCallback(() => {
      setComposerTrigger(null);
      setComposerHighlightedItemId(null);
      setComposerHighlightedSearchKey(null);
    }, []);

    const dismissComposerCommandMenu = useCallback(() => {
      const snapshot = readComposerSnapshot();
      const trigger = detectComposerTrigger(snapshot.value, snapshot.expandedCursor);
      if (trigger) {
        dismissedComposerTriggerRef.current = composerTriggerDismissalFor(trigger);
      }
      clearComposerCommandMenuState();
    }, [clearComposerCommandMenuState, readComposerSnapshot]);

    const promptRefVersion = useValueIdentityVersion(promptRef);
    const resolveComposerTriggerVersion = useValueIdentityVersion(resolveComposerTrigger);
    const dismissComposerCommandMenuVersion = useValueIdentityVersion(dismissComposerCommandMenu);
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
          key={[composerMenuOpen, activeComposerMenuItemId ?? "", composerMenuSearchKey ?? ""].join(
            "\0",
          )}
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
          dismissedComposerTriggerRef={dismissedComposerTriggerRef}
          initialComposerTriggerSuppressionPromptRef={initialComposerTriggerSuppressionPromptRef}
          promptRef={promptRef}
          setComposerCursor={setComposerCursor}
          setComposerHighlightedItemId={setComposerHighlightedItemId}
          setComposerTrigger={setComposerTrigger}
          suppressInitialComposerTriggerDetectionRef={suppressInitialComposerTriggerDetectionRef}
        />
        {composerMenuOpen ? (
          <ComposerCommandMenuPointerDismissSync
            key={dismissComposerCommandMenuVersion}
            dismissComposerCommandMenu={dismissComposerCommandMenu}
          />
        ) : null}
        {composerMenuOpen ? (
          <ComposerMenuAnchorObserverSync
            key="anchor-observer"
            composerMenuAnchorRef={composerMenuAnchorRef}
            setComposerMenuAnchorRevision={setComposerMenuAnchorRevision}
          />
        ) : null}
        {composerMenuOpen ? (
          <ComposerMenuAnchorRevisionSync
            key={String(composerMenuItems.length)}
            setComposerMenuAnchorRevision={setComposerMenuAnchorRevision}
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
            clearComposerCommandMenuState();
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
              clearComposerCommandMenuState();
              setModelPickerOpenSearchSeed(undefined);
              setIsComposerModelPickerOpen(true);
            }
            return;
          }
          const nextMode = parseInteractionMode(item.command);
          if (!nextMode) return;
          void handleInteractionModeChange(nextMode);
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          });
          if (applied) {
            clearComposerCommandMenuState();
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
            clearComposerCommandMenuState();
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
            clearComposerCommandMenuState();
          }
          return;
        }
      },
      [
        applyPromptReplacement,
        clearComposerCommandMenuState,
        handleInteractionModeChange,
        resolveActiveComposerTrigger,
      ],
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
        if (!composerMenuOpenRef.current) {
          return false;
        }
        dismissComposerCommandMenu();
        return true;
      }

      const menuIsActive = composerMenuOpenRef.current;
      if (menuIsActive) {
        const currentItems = composerMenuItemsRef.current;
        if (currentItems.length === 0) {
          return false;
        }
        const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
        if (key === "ArrowDown") {
          nudgeComposerMenuHighlight("ArrowDown");
          return true;
        }
        if (key === "ArrowUp") {
          nudgeComposerMenuHighlight("ArrowUp");
          return true;
        }
        if ((key === "Enter" || (key === "Tab" && !event.shiftKey)) && selectedItem) {
          onSelectComposerItem(selectedItem);
          return true;
        }
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalOpen, composerFocus: true },
      });
      if (command === "composer.send") {
        void onSend();
        return true;
      }
      if (command === "composer.interrupt") {
        void onInterrupt();
        return true;
      }
      if (command === "composer.cycleInteractionMode") {
        toggleInteractionMode();
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
        getSendContext: () => {
          const submitData = composerEditorRef.current?.getSubmitData();
          const promptForSend = submitData?.text ?? promptRef.current;
          return {
            prompt: promptForSend,
            images: composerImagesRef.current,
            selectedPromptEffort,
            selectedModelSelection,
            selectedProvider,
            selectedModel: instanceCoherentSelectedModel,
            selectedProviderModels,
            hasUnresolvedSlashCommand: isUnresolvedStandaloneComposerSlashCommand(promptForSend, {
              hasComposerCommand: (submitData?.commands.length ?? 0) > 0,
            }),
          };
        },
      }),
      [
        promptRef,
        composerImagesRef,
        isComposerModelPickerOpen,
        readComposerSnapshot,
        resolveComposerTrigger,
        instanceCoherentSelectedModel,
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
    const showQueuedComposerPanel = showQueuedComposerItems && !isInlineEditComposer;
    const activeComposerInteractionMode: ActiveComposerInteractionMode | null =
      showModeControls &&
      composerProviderControls.showInteractionModeToggle &&
      interactionMode !== "default"
        ? interactionMode
        : null;
    const composerInteractionModeChip =
      activeComposerInteractionMode === null ? null : (
        <ComposerInteractionModeChip
          mode={activeComposerInteractionMode}
          shortcutLabel={interactionModeShortcutLabel}
          onClear={() => handleInteractionModeChange("default")}
        />
      );
    const providerModelPicker = (
      <ProviderModelPicker
        compact={isDockComposerSingleLine}
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
    const compactControlsMenu =
      dockTraitsMenuFastSlot || dockTraitsMenuRestSlot ? (
        <OverflowControls
          traitsFastMenuContent={dockTraitsMenuFastSlot}
          traitsRestMenuContent={dockTraitsMenuRestSlot}
        />
      ) : null;

    // Render
    // ------------------------------------------------------------------
    return (
      <form
        ref={composerFormRef}
        onSubmit={onSend}
        className={cn("w-full min-w-0", !isInlineEditComposer && "mx-auto max-w-agent-chat")}
        data-variant={composerVariant}
        data-layout={layout}
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
          data-slash-menu-variant="surface"
          data-variant={composerVariant}
        >
          {showPlanTray ? (
            <PlanFollowUpTray
              plan={activeProposedPlan}
              compact={composerVariant === "compact"}
              gitCwd={gitCwd ?? undefined}
              isBuilding={isConnecting || isSendBusy}
              planSurfaceOpen={planSurfaceOpen}
              onBuildPlan={onBuildPlan}
              onViewPlan={onViewPlan}
            />
          ) : null}
          <SubagentPreviewTrayStack
            activeThreadId={activeThreadId}
            compact={composerVariant === "compact"}
            visible={!isInlineEditComposer}
          />
          {showQueuedComposerPanel ? (
            <QueuedComposerItemsPanel
              items={queuedComposerItems}
              editingItemId={editingQueuedComposerItemId}
              isBusy={queuedComposerActionsBusy}
              compact={composerVariant === "compact"}
              expanded={queuedComposerItemsExpanded}
              onExpandedChange={handleQueuedComposerItemsExpandedChange}
              onBeginEdit={handleBeginEditQueuedComposerItem}
              onRemove={handleRemoveQueuedComposerItem}
              onSendNow={handleSendQueuedComposerItemNow}
              onReorder={handleReorderQueuedComposerItem}
            />
          ) : null}
          {promptInputHeaderContent ? (
            <div
              className={cn(
                "select-none overflow-hidden border border-b-0 border-multi-stroke-tertiary text-multi-fg-primary",
              )}
              data-multi-composer-header=""
              data-multi-composer-surface=""
              data-variant={composerVariant}
              data-expanded={isDockComposerExpanded ? "" : undefined}
              data-visible={hasComposerHeader ? "true" : "false"}
            >
              {promptInputHeaderContent}
            </div>
          ) : null}
          <div
            className={cn(
              "group relative w-full max-w-full min-w-0 overflow-hidden",
              isInlineEditComposer && "rounded-xl",
              isDragOverComposer && "bg-accent/30 ring-2 ring-primary/60",
              composerProviderState.ultrathinkActive &&
                "animate-[ultrathink-rainbow_10s_linear_infinite] bg-[linear-gradient(120deg,oklch(0.712_0.181_22.839)_0%,oklch(0.769_0.165_70.08)_18%,oklch(0.723_0.192_149.579)_36%,oklch(0.704_0.123_182.503)_54%,oklch(0.623_0.188_259.815)_72%,oklch(0.656_0.212_354.308)_90%,oklch(0.712_0.181_22.839)_100%)] bg-[length:220%_220%]",
            )}
            data-has-header={hasComposerHeader ? "" : undefined}
            data-layout={isInlineEditComposer ? "inline-edit" : undefined}
            data-multi-composer-surface=""
            data-has-images={composerImages.length > 0 ? "" : undefined}
            data-dragging={isDragOverComposer ? "" : undefined}
            data-expanded={isDockComposerExpanded ? "" : undefined}
            data-model-picker-placement={modelPickerPlacement}
            data-plus-menu-placement="bottom-start"
            data-slash-menu-placement="top-start"
            data-variant={composerVariant}
            onDragEnter={onComposerDragEnter}
            onDragOver={onComposerDragOver}
            onDragLeave={onComposerDragLeave}
            onDrop={onComposerDrop}
          >
            <div
              className={cn(
                composerShellClass({ mode: composerShellMode }),
                composerProviderState.ultrathinkActive &&
                  "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]",
              )}
              data-multi-composer-shell={composerShellMode}
              {...(isDockComposerExpanded ? { "data-expanded": "" } : {})}
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
                    className={cn(
                      COMPOSER_TOOLBAR_CONTROL_SIZE,
                      "flex shrink-0 items-center justify-center rounded-full bg-multi-bg-tertiary p-0 text-multi-icon-tertiary transition-[background-color,color] duration-150 hover:bg-multi-bg-secondary hover:text-multi-icon-secondary disabled:pointer-events-none disabled:opacity-35",
                    )}
                    aria-label="Attach images"
                    disabled={pendingUserInputs.length > 0 || isConnecting}
                    onClick={() => composerImageInputRef.current?.click()}
                  >
                    <IconPlusSmall className="size-3.5 shrink-0" aria-hidden="true" />
                  </button>
                </>
              ) : null}
              {isEditingQueuedComposerItem ? (
                <QueuedComposerEditBanner onCancelEdit={handleCancelEditingQueuedComposerItem} />
              ) : null}
              {composerInteractionModeChip ? (
                <div
                  className={cn(
                    "min-w-0 shrink-0",
                    isDockComposerSingleLine ? "contents" : "flex px-3 pt-2",
                    composerShellMode === "new-agent" && "px-0 pt-0",
                  )}
                >
                  {composerInteractionModeChip}
                </div>
              ) : null}
              <div
                className={cn(
                  "relative min-w-0 cursor-text select-text",
                  composerEditorMode === "inline-edit" && "min-h-5",
                  composerEditorMode === "thread-pill" && "min-w-0 flex-1",
                  composerEditorMode === "thread-multiline" && "min-h-5 min-w-0 px-3 pt-2",
                  composerEditorMode === "new-agent" && "flex min-h-0 min-w-0 flex-1 flex-col",
                )}
                onClick={handleComposerContainerClick}
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
                  skills={selectedProviderStatus?.skills ?? []}
                  caretAnchorRef={composerMenuAnchorRef}
                  commandMenuOpen={composerMenuOpen && !isComposerApprovalState}
                  onMeasuredMultilineChange={setIsComposerEditorMultiline}
                  onChange={onPromptChange}
                  onCommandKeyDown={onComposerCommandKey}
                  hotkeyTargetRef={composerEditorHotkeyRef}
                  onPaste={onComposerPaste}
                  className={composerEditorClass({ mode: composerEditorMode })}
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
                              : interactionMode === "ask"
                                ? "Ask questions without making changes..."
                                : phase === "disconnected"
                                  ? "Ask for follow-up changes or attach images"
                                  : composerVariant === "compact"
                                    ? "Send follow-up"
                                    : "Ask anything, @tag files/folders, or use / to show available commands"
                  }
                  disabled={isConnecting || isComposerApprovalState}
                />
              </div>
              {/* Bottom toolbar */}
              {activePendingApproval ? (
                <div
                  data-multi-composer-toolbar={
                    composerShellMode === "thread" ? "bottom" : undefined
                  }
                  className={cn(
                    "flex items-center justify-end",
                    isDockComposerExpanded ? "gap-[0.55rem]" : "gap-2 px-3 pb-2.5 sm:pb-3",
                  )}
                >
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
                  primaryActionState={{
                    pendingAction: pendingPrimaryAction,
                    isRunning: phase === "running",
                    showPlanFollowUpPrompt:
                      pendingUserInputs.length === 0 &&
                      showPlanFollowUpPrompt &&
                      prompt.trim().length > 0 &&
                      !isEditingQueuedComposerItem,
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
                  onAdvancePendingQuestion={handleAdvanceActivePendingUserInput}
                  onPreviousPendingQuestion={handlePreviousActivePendingUserInputQuestion}
                  onInterrupt={handleInterruptPrimaryAction}
                />
              )}
            </div>
          </div>
          {!isInlineEditComposer && visibleContextWindow ? (
            <ComposerContextUsageBar usage={visibleContextWindow} />
          ) : null}
        </div>
        <ComposerCommandMenuPositioned
          open={composerMenuOpen && !isComposerApprovalState}
          anchor={composerMenuPopoverAnchorRef.current}
          anchorRevision={composerMenuAnchorRevision}
          items={composerMenuItems}
          resolvedTheme={resolvedTheme}
          isLoading={isComposerMenuLoading}
          ariaLabel={composerMenuAriaLabel}
          menuKind={composerMenuKind}
          triggerKind={composerTriggerKind}
          groupSlashCommandSections={composerTrigger?.kind === "slash-command"}
          isSearching={composerMenuIsSearching}
          emptyStateText={composerMenuEmptyState}
          activeItemId={activeComposerMenuItem?.id ?? null}
          onHighlightedItemChange={onComposerMenuItemHighlighted}
          onSelect={onSelectComposerItem}
        />
      </form>
    );
  }),
);
