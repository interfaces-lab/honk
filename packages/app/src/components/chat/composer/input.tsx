import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type FocusEvent,
  type RefObject,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Button } from "@multi/ui/button";
import {
  Menu,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
  workbenchMenuMetaTextClassName,
} from "@multi/ui/menu";
import {
  IconArrowUp,
  IconBug,
  IconBubbleQuestion,
  IconChevronDownSmall,
  IconChevronLeftMedium,
  IconCrossSmall,
  IconPlusSmall,
  IconStop,
  IconTodos,
  type CentralIconBaseProps,
} from "central-icons";
import { scopedThreadKey } from "~/lib/environment-scope";
import {
  type AgentMode,
  type AgentThinkingLevel,
  type MessageId,
  type AgentInteractionMode,
  type ScopedThreadRef,
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
  slashCommandRemovalRange,
} from "./prompt-triggers";
import { deriveComposerSendState } from "../composer-submit";
import {
  type DraftId,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../../stores/chat-drafts";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "./prompt-editor";
import {
  type ComposerCommandItem,
  ComposerCommandMenuPositioned,
  useComposerCommandMenu,
} from "./command-menu/menu";
import {
  composerMenuPopoverAnchorFromElement,
  type ComposerMenuPopoverAnchor,
} from "./command-menu/anchor";
import { ComposerPendingApprovalActions } from "./pending/approval-actions";
import { ComposerPendingApprovalPanel } from "./pending/approval-panel";
import { ComposerPendingUserInputPanel } from "./pending/user-input-panel";
import { cn } from "~/lib/utils";
import { cva } from "class-variance-authority";
import type { QueuedComposerItem } from "../../../stores/chat-send-queue";
import { useComposerKeyboard } from "./use-composer-keyboard";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { useComposerImageAttachments } from "./attachments/use-image-attachments";
import { ComposerImageAttachmentStrip } from "./attachments/image-attachment-strip";
import {
  type ComposerFooterPendingAction,
  type ComposerInputHandle,
  type ComposerInputProps,
} from "./input-contract";
import { QueuedComposerEditBanner, QueuedComposerItemsPanel } from "./queue/queued-items-panel";
import { SubagentTrayStack } from "./subagents/subagent-tray";
import { ComposerContextUsageBar } from "./context/context-usage-bar";
import { PlanFollowUpTray } from "./plan-follow-up/plan-follow-up-tray";
import { deriveLatestContextWindowSnapshot } from "../../../lib/context-window";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { readMultiRuntimeApi } from "~/lib/multi-runtime-api";
import { useAgentRuntimeStore } from "~/stores/agent-runtime-store";
import {
  AGENT_MODE_LABELS,
  AGENT_MODE_OPTIONS,
  AGENT_MODE_THINKING_LEVELS,
  AGENT_THINKING_LEVEL_LABELS,
  AGENT_THINKING_LEVEL_OPTIONS,
  normalizedConfigurableThinkingLevel,
  agentModeSupportsThinkingLevelSelection,
} from "~/lib/agent-mode-options";

export type { ComposerInputHandle, ComposerInputProps } from "./input-contract";

const composerEditorClass = cva(
  "block w-full min-w-0 overflow-y-auto whitespace-pre-wrap wrap-break-word bg-transparent text-multi-fg-secondary outline-hidden",
  {
    variants: {
      mode: {
        "new-agent": "min-h-9 max-h-[200px] px-3 py-2 text-body/[1.5] text-(--vscode-input-foreground)",
        "thread-multiline": "min-w-0 px-3 pt-2",
        "thread-pill": "flex-1 pl-1",
        "inline-edit": "min-h-5 max-h-60 px-3 py-2",
      },
    },
  },
);

const composerShellClass = cva("relative z-1 min-w-0 rounded-[inherit]", {
  variants: {
    mode: {
      "new-agent": "flex flex-col",
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

const COMPOSER_PROMPT_DRAFT_COMMIT_DEBOUNCE_MS = 300;

type ComposerDraftTarget = ScopedThreadRef | DraftId;

function composerDraftTargetKey(target: ComposerDraftTarget): string {
  return typeof target === "string" ? target : scopedThreadKey(target);
}

function nextPromptSyncState(
  value: string,
  cursor: number = value.length,
  previousRevision: number = 0,
): { value: string; cursor: number; syncRevision: number } {
  return {
    value,
    cursor: clampCollapsedComposerCursor(value, cursor),
    syncRevision: previousRevision + 1,
  };
}

type ActiveComposerInteractionMode = Exclude<AgentInteractionMode, "agent">;

const interactionModeChipClass = cva(
  "inline-flex h-6 w-fit max-w-full shrink-0 items-center gap-1 overflow-hidden rounded-full border-0 px-2 pr-1 text-(length:--multi-text-body) leading-none font-medium shadow-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      mode: {
        ask: "bg-(--composer-mode-chat-background) text-(--composer-mode-chat-text) hover:bg-[color-mix(in_srgb,var(--composer-mode-chat-background)_78%,var(--vscode-list-hoverBackground))]",
        plan: "bg-(--composer-mode-plan-background) text-(--composer-mode-plan-text) hover:bg-[color-mix(in_srgb,var(--composer-mode-plan-background)_82%,var(--vscode-list-hoverBackground))]",
        debug:
          "bg-(--composer-mode-debug-background) text-(--composer-mode-debug-text) hover:bg-[color-mix(in_srgb,var(--composer-mode-debug-background)_78%,var(--vscode-list-hoverBackground))]",
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
    case "debug":
      return {
        label: "Debug",
        title: "Debug mode - click to return to Build",
        Icon: IconBug,
      };
  }
}

function ComposerInteractionModeChip(props: {
  mode: ActiveComposerInteractionMode;
  shortcutLabel: string | null;
  onClear: () => void;
}) {
  const chip = getInteractionModeChipConfig(props.mode);
  const ChipIcon = chip.Icon;

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        interactionModeChipClass({ mode: props.mode }),
        "hover:text-inherit data-pressed:text-inherit [&_svg]:mx-0",
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
}

function ComposerAgentModeMenu(props: {
  agentMode: AgentMode;
  thinkingLevel: AgentThinkingLevel;
  disabled: boolean;
  onAgentModeChange: (agentMode: AgentMode) => void;
  onThinkingLevelChange: (thinkingLevel: AgentThinkingLevel) => void;
}) {
  const thinkingLevel = normalizedConfigurableThinkingLevel(props.thinkingLevel);
  const supportsThinkingLevel = agentModeSupportsThinkingLevelSelection(props.agentMode);

  const handleAgentModeValueChange = (value: string) => {
    const option = AGENT_MODE_OPTIONS.find((item) => item.value === value);
    if (option && option.value !== props.agentMode) {
      props.onAgentModeChange(option.value);
    }
  };

  const handleThinkingLevelValueChange = (value: string) => {
    const option = AGENT_THINKING_LEVEL_OPTIONS.find((item) => item.value === value);
    if (option && option.value !== thinkingLevel) {
      props.onThinkingLevelChange(option.value);
    }
  };

  return (
    <Menu>
      <MenuTrigger
        type="button"
        className="inline-flex h-6 min-w-0 max-w-40 select-none items-center gap-1 overflow-hidden rounded-full bg-transparent py-0 pr-1.5 pl-2 text-[12px]/[16px] font-medium text-multi-fg-secondary outline-hidden transition-colors hover:bg-multi-bg-tertiary hover:text-multi-fg-primary data-popup-open:bg-multi-bg-tertiary data-popup-open:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50"
        aria-label="Agent mode and thinking level"
        disabled={props.disabled}
      >
        <span className="min-w-0 truncate">{AGENT_MODE_LABELS[props.agentMode]}</span>
        {supportsThinkingLevel ? (
          <span className="shrink-0 text-multi-fg-tertiary">
            {AGENT_THINKING_LEVEL_LABELS[thinkingLevel]}
          </span>
        ) : null}
        <IconChevronDownSmall className="size-3 shrink-0 text-multi-icon-tertiary" aria-hidden />
      </MenuTrigger>
      <MenuPopup align="start" side="top" sideOffset={6} variant="workbench">
        <MenuRadioGroup value={props.agentMode} onValueChange={handleAgentModeValueChange}>
          <MenuGroupLabel variant="workbench">Mode</MenuGroupLabel>
          {AGENT_MODE_OPTIONS.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} variant="workbench">
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator variant="workbench" />
        <MenuSub>
          <MenuSubTrigger
            className="pe-1"
            disabled={!supportsThinkingLevel || props.disabled}
            variant="workbench"
          >
            <span className="min-w-0 flex-1 truncate">Thinking</span>
            <span className={cn(workbenchMenuMetaTextClassName, "shrink-0")}>
              {supportsThinkingLevel ? AGENT_THINKING_LEVEL_LABELS[thinkingLevel] : "Off"}
            </span>
          </MenuSubTrigger>
          <MenuSubPopup variant="workbench">
            <MenuRadioGroup value={thinkingLevel} onValueChange={handleThinkingLevelValueChange}>
              {AGENT_THINKING_LEVEL_OPTIONS.map((option) => (
                <MenuRadioItem key={option.value} value={option.value} variant="workbench">
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
      </MenuPopup>
    </Menu>
  );
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

function useValueIdentityVersion(value: unknown): number {
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

function parseInteractionMode(value: string | null | undefined): AgentInteractionMode | null {
  if (value === "agent" || value === "ask" || value === "plan" || value === "debug") {
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

const COMPOSER_ACTION_SIZE_COMPACT = "h-6 w-6";
const COMPOSER_ACTION_SIZE_EXPANDED = "h-6 w-6";
const COMPOSER_TOOLBAR_CONTROL_SIZE = "h-6 w-6";
const COMPOSER_ACTION_ICON_COMPACT = "size-3.5";
const COMPOSER_ACTION_ICON_EXPANDED = "size-3.5";
const COMPOSER_SUBMIT_BASE_CLASS =
  "flex enabled:cursor-pointer items-center justify-center rounded-full bg-transparent text-multi-icon-secondary transition-[background-color,color,opacity] duration-100 hover:bg-multi-bg-quaternary hover:text-multi-icon-primary disabled:pointer-events-none disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-multi-icon-secondary";
const COMPOSER_STOP_BASE_CLASS =
  "flex cursor-pointer items-center justify-center rounded-full bg-transparent text-multi-fg-red-primary transition-[background-color,color,opacity] duration-100 hover:bg-multi-bg-quaternary hover:opacity-85";

function PrimaryActionControls(props: {
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
      <button
        type="submit"
        className="flex h-6 enabled:cursor-pointer items-center justify-center gap-1 rounded-full bg-transparent px-2.5 text-detail font-medium text-(--cursor-bg-yellow-primary) transition-[background-color,color,opacity] duration-100 hover:bg-multi-bg-quaternary hover:opacity-85 disabled:pointer-events-none disabled:opacity-30 disabled:hover:bg-transparent [&_svg]:size-3.5 [&_svg]:shrink-0"
        disabled={props.isSendBusy || props.isConnecting}
        aria-label="Refine plan"
        title="Refine plan"
      >
        <IconArrowUp aria-hidden />
        {props.isConnecting || props.isSendBusy ? "Sending..." : "Refine"}
      </button>
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
}

function ComposerFooter(props: {
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
  agentModeControl: ReactNode;
  interactionModeChip: ReactNode;
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
              props.inlineEdit ? "px-3 pb-2" : isThreadShell ? "" : "px-2.5 py-2 sm:px-2.5 sm:py-2",
            ),
      )}
    >
      <div
        data-multi-composer-toolbar="left"
        className={cn(
          "flex min-w-0 items-center gap-1",
          dockSingleRow ? "max-w-[46%] shrink overflow-hidden" : "flex-1 overflow-hidden",
        )}
      >
        {props.agentModeControl ? (
          <span className="inline-flex shrink-0">{props.agentModeControl}</span>
        ) : null}
        {props.interactionModeChip ? (
          <span className="inline-flex shrink-0">{props.interactionModeChip}</span>
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
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export const ComposerInput = forwardRef<ComposerInputHandle, ComposerInputProps>(
  function ComposerInput(props, ref) {
    const {
      variant = "compact",
      layout = "thread",
      composerDraftTarget,
      environmentId,
      draftId,
      activeThreadId,
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

    // ------------------------------------------------------------------
    // Store subscriptions (prompt / images)
    // ------------------------------------------------------------------
    const composerDraft = useComposerThreadDraft(composerDraftTarget);
    const draftPrompt = composerDraft.prompt;
    const composerDraftTargetKeyValue = composerDraftTargetKey(composerDraftTarget);
    const [livePrompt, setLivePrompt] = useState(draftPrompt);
    const [editorSyncState, setEditorSyncState] = useState(() => ({
      value: draftPrompt,
      cursor: collapseExpandedComposerCursor(draftPrompt, draftPrompt.length),
      syncRevision: 0,
    }));
    const composerImages = composerDraft.images;
    const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;

    const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
    const runtimePreferences = useAgentRuntimeStore((state) => state.snapshot.preferences);
    const setRuntimeSnapshot = useAgentRuntimeStore((state) => state.setSnapshot);
    const [isAgentModeSaving, setIsAgentModeSaving] = useState(false);

    const activeContextWindow = deriveLatestContextWindowSnapshot(activeThreadActivities ?? []);
    const visibleContextWindow = (() => {
      if (!activeContextWindow || settings.agentWindowUsageSummaryDisplay === "never") {
        return null;
      }
      if (settings.agentWindowUsageSummaryDisplay === "always") {
        return activeContextWindow;
      }
      return activeContextWindow.usedPercentage !== null && activeContextWindow.usedPercentage >= 50
        ? activeContextWindow
        : null;
    })();

    // ------------------------------------------------------------------
    // Composer-local state
    // ------------------------------------------------------------------
    const [composerCursor, setComposerCursor] = useState(() =>
      collapseExpandedComposerCursor(draftPrompt, draftPrompt.length),
    );
    const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(null);
    const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
    const [composerHighlightedSearchKey, setComposerHighlightedSearchKey] = useState<string | null>(
      null,
    );
    const [isComposerEditorMultiline, setIsComposerEditorMultiline] = useState(false);

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
    const initialComposerTriggerSuppressionPromptRef = useRef(draftPrompt);
    const dismissedComposerTriggerRef = useRef<ComposerTriggerDismissal | null>(null);
    const composerDraftTargetRef = useRef(composerDraftTarget);
    const composerDraftTargetKeyRef = useRef(composerDraftTargetKeyValue);
    const committedPromptRef = useRef(draftPrompt);
    const committedPromptTargetKeyRef = useRef(composerDraftTargetKeyValue);
    const pendingPromptCommitRef = useRef<{
      target: ComposerDraftTarget;
      targetKey: string;
      prompt: string;
    } | null>(null);
    const promptCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    composerDraftTargetRef.current = composerDraftTarget;
    composerDraftTargetKeyRef.current = composerDraftTargetKeyValue;

    const clearPromptCommitTimer = () => {
      const timer = promptCommitTimerRef.current;
      if (timer === null) {
        return;
      }
      clearTimeout(timer);
      promptCommitTimerRef.current = null;
    };

    const flushPromptCommit = () => {
      clearPromptCommitTimer();
      const pending = pendingPromptCommitRef.current;
      if (!pending) {
        return;
      }
      pendingPromptCommitRef.current = null;
      if (
        pending.targetKey === committedPromptTargetKeyRef.current &&
        pending.prompt === committedPromptRef.current
      ) {
        return;
      }
      committedPromptRef.current = pending.prompt;
      committedPromptTargetKeyRef.current = pending.targetKey;
      setComposerDraftPrompt(pending.target, pending.prompt);
    };

    const flushPromptCommitRef = useRef(flushPromptCommit);
    flushPromptCommitRef.current = flushPromptCommit;

    const schedulePromptCommit = (nextPrompt: string) => {
      pendingPromptCommitRef.current = {
        target: composerDraftTargetRef.current,
        targetKey: composerDraftTargetKeyRef.current,
        prompt: nextPrompt,
      };
      clearPromptCommitTimer();
      promptCommitTimerRef.current = setTimeout(
        flushPromptCommit,
        COMPOSER_PROMPT_DRAFT_COMMIT_DEBOUNCE_MS,
      );
    };

    const syncEditorToPrompt = (nextPrompt: string, nextCursor?: number) => {
      setEditorSyncState((previous) => {
        const cursor = clampCollapsedComposerCursor(nextPrompt, nextCursor ?? nextPrompt.length);
        if (previous.value === nextPrompt && previous.cursor === cursor) {
          return previous;
        }
        return nextPromptSyncState(nextPrompt, cursor, previous.syncRevision);
      });
    };

    const focusComposer = () => {
      composerEditorRef.current?.focusAtEnd();
    };

    const scheduleComposerFocus = () => {
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAtEnd();
      });
    };

    const updateAgentRuntimePreferences = (
      patch: { agentMode: AgentMode; thinkingLevel: AgentThinkingLevel } | { thinkingLevel: AgentThinkingLevel },
      errorMessage: string,
    ) => {
      setIsAgentModeSaving(true);
      const runtimeApi = readMultiRuntimeApi();
      void runtimeApi
        .updatePreferences(patch)
        .then(async () => {
          const snapshot = await runtimeApi.getHostSnapshot();
          setRuntimeSnapshot(snapshot);
          scheduleComposerFocus();
        })
        .catch((error: unknown) => {
          setThreadError(
            activeThreadId,
            error instanceof Error ? error.message : errorMessage,
          );
        })
        .finally(() => setIsAgentModeSaving(false));
    };

    const handleAgentModeChange = (agentMode: AgentMode) => {
      const thinkingLevel = AGENT_MODE_THINKING_LEVELS[agentMode];
      if (
        agentMode === runtimePreferences.agentMode &&
        thinkingLevel === runtimePreferences.thinkingLevel
      ) {
        scheduleComposerFocus();
        return;
      }

      updateAgentRuntimePreferences(
        { agentMode, thinkingLevel },
        "Failed to update agent mode.",
      );
    };

    const handleThinkingLevelChange = (thinkingLevel: AgentThinkingLevel) => {
      if (thinkingLevel === runtimePreferences.thinkingLevel) {
        scheduleComposerFocus();
        return;
      }

      updateAgentRuntimePreferences({ thinkingLevel }, "Failed to update thinking level.");
    };

    useComposerKeyboard({
      enabled: showModeControls,
      keybindings,
      terminalOpen,
      targetRef: composerEditorHotkeyRef,
      onToggleInteractionMode: toggleInteractionMode,
    });
    const interactionModeShortcutLabel = shortcutLabelForCommand(
      keybindings,
      "composer.cycleInteractionMode",
      {
        context: { terminalFocus: false, terminalOpen },
      },
    );

    const resolveComposerTrigger = (
      text: string,
      expandedCursor: number,
    ): ComposerTrigger | null => {
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
    };

    // ------------------------------------------------------------------
    // Derived: composer send state
    // ------------------------------------------------------------------
    const composerSendState = deriveComposerSendState({
      prompt: livePrompt,
      imageCount: composerImages.length,
    });

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
      highlightedItemId: composerHighlightedItemId,
      highlightedSearchKey: composerHighlightedSearchKey,
    });

    composerMenuOpenRef.current = composerMenuOpen;
    composerMenuItemsRef.current = composerMenuItems;
    activeComposerMenuItemRef.current = activeComposerMenuItem;

    const [composerMenuAnchorRevision, setComposerMenuAnchorRevision] = useState(0);

    const handleComposerContainerClick = (event: MouseEvent<HTMLDivElement>) => {
      if (composerMenuOpenRef.current) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest(
          '[data-prompt-editor-input="true"], button, input, select, textarea, a, [role="button"], [role="menuitem"]',
        )
      ) {
        return;
      }
      composerEditorRef.current?.focusAtEnd();
    };

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

    useLayoutSyncEffect(() => {
      if (!isComposerApprovalState && !activePendingProgress) {
        committedPromptRef.current = draftPrompt;
        committedPromptTargetKeyRef.current = composerDraftTargetKeyValue;
      }
      const nextPrompt = isComposerApprovalState
        ? ""
        : activePendingProgress
          ? activePendingProgress.customAnswer
          : draftPrompt;
      if (nextPrompt === promptRef.current) {
        return;
      }
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      promptRef.current = nextPrompt;
      setLivePrompt((current) => (current === nextPrompt ? current : nextPrompt));
      syncEditorToPrompt(nextPrompt, nextCursor);
      setComposerCursor(nextCursor);
      setComposerTrigger(resolveComposerTrigger(nextPrompt, nextPrompt.length));
      setComposerHighlightedItemId(null);
    }, [
      activePendingProgress?.customAnswer,
      composerDraftTargetKeyValue,
      draftPrompt,
      isComposerApprovalState,
      promptRef,
      resolveComposerTrigger,
      syncEditorToPrompt,
    ]);

    const promptHasExplicitLineBreak = livePrompt.includes("\n");
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
    const subagentTrayVisible =
      !isInlineEditComposer && (composerVariant !== "compact" || isDockComposerExpanded);

    // ------------------------------------------------------------------
    // Prompt helpers
    // ------------------------------------------------------------------
    const schedulePromptCommitRef = useRef(schedulePromptCommit);
    schedulePromptCommitRef.current = schedulePromptCommit;

    const setPrompt = (nextPrompt: string) => {
      setLivePrompt((current) => (current === nextPrompt ? current : nextPrompt));
      schedulePromptCommitRef.current(nextPrompt);
    };

    const applyPromptReplacement = (
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
      setLivePrompt((current) => (current === next.text ? current : next.text));
      syncEditorToPrompt(next.text, nextCursor);
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
      if (next.text.includes("\n")) {
        setIsComposerEditorMultiline(true);
      } else if (next.text.trim().length === 0) {
        setIsComposerEditorMultiline(false);
      }
      if (options?.focusEditorAfterReplace !== false) {
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAt(nextCursor);
        });
      }
      return true;
    };

    const pendingPrimaryAction = activePendingProgress
      ? {
          questionIndex: activePendingProgress.questionIndex,
          isLastQuestion: activePendingProgress.isLastQuestion,
          canAdvance: activePendingProgress.canAdvance,
          isResponding: activePendingIsResponding,
          isComplete: Boolean(activePendingResolvedAnswers),
        }
      : null;

    // ------------------------------------------------------------------
    // Sync refs back to parent
    // ------------------------------------------------------------------
    composerImagesRef.current = composerImages;

    const lastSyncedPendingInputRef = useRef<{
      requestId: string | null;
      questionId: string | null;
    } | null>(null);

    const onPromptChange = (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
    ) => {
      const previousPrompt = promptRef.current;
      dismissedComposerTriggerRef.current = mapComposerTriggerDismissalThroughPromptChange(
        dismissedComposerTriggerRef.current,
        previousPrompt,
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
      if (nextPrompt !== previousPrompt) {
        setPrompt(nextPrompt);
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : resolveComposerTrigger(nextPrompt, expandedCursor),
      );
      if (nextPrompt.includes("\n")) {
        setIsComposerEditorMultiline(true);
      } else if (nextPrompt.trim().length === 0) {
        setIsComposerEditorMultiline(false);
      }
    };

    const readComposerSnapshot = (): {
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
    };

    const readComposerSnapshotRef = useRef(readComposerSnapshot);
    const resolveComposerTriggerRef = useRef(resolveComposerTrigger);
    const syncEditorToPromptRef = useRef(syncEditorToPrompt);
    readComposerSnapshotRef.current = readComposerSnapshot;
    resolveComposerTriggerRef.current = resolveComposerTrigger;
    syncEditorToPromptRef.current = syncEditorToPrompt;

    useEffect(() => {
      return () => {
        flushPromptCommitRef.current();
      };
    }, [composerDraftTargetKeyValue]);

    useEffect(() => {
      if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
        return;
      }
      const onBeforeUnload = () => {
        flushPromptCommitRef.current();
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => {
        window.removeEventListener("beforeunload", onBeforeUnload);
      };
    }, []);

    const resolveActiveComposerTrigger = (): {
      snapshot: { value: string; cursor: number; expandedCursor: number };
      trigger: ComposerTrigger | null;
    } => {
      const snapshot = readComposerSnapshot();
      return {
        snapshot,
        trigger: resolveComposerTrigger(snapshot.value, snapshot.expandedCursor),
      };
    };

    const clearComposerCommandMenuState = () => {
      setComposerTrigger(null);
      setComposerHighlightedItemId(null);
      setComposerHighlightedSearchKey(null);
    };

    const dismissComposerCommandMenu = () => {
      const snapshot = readComposerSnapshot();
      const trigger = detectComposerTrigger(snapshot.value, snapshot.expandedCursor);
      if (trigger) {
        dismissedComposerTriggerRef.current = composerTriggerDismissalFor(trigger);
      }
      clearComposerCommandMenuState();
    };

    const promptRefVersion = useValueIdentityVersion(promptRef);
    const resolveComposerTriggerVersion = useValueIdentityVersion(resolveComposerTrigger);
    const dismissComposerCommandMenuVersion = useValueIdentityVersion(dismissComposerCommandMenu);
    const pendingInputCustomAnswer = activePendingProgress?.customAnswer;
    const pendingInputQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const pendingInputRequestId = activePendingUserInput?.requestId ?? null;
    const lifecycleSync = (
      <>
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

    const onSelectComposerItem = (item: ComposerCommandItem) => {
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
        const nextMode = parseInteractionMode(item.command);
        if (!nextMode) return;
        handleInteractionModeChange(nextMode);
        const removalRange = slashCommandRemovalRange(snapshot.value, trigger);
        const applied = applyPromptReplacement(removalRange.rangeStart, removalRange.rangeEnd, "", {
          expectedText: snapshot.value.slice(removalRange.rangeStart, removalRange.rangeEnd),
        });
        if (applied) {
          clearComposerCommandMenuState();
        }
        return;
      }
    };

    const onComposerMenuItemHighlighted = (itemId: string | null) => {
      setComposerHighlightedItemId(itemId);
      setComposerHighlightedSearchKey(composerMenuSearchKey);
    };

    const nudgeComposerMenuHighlight = (key: "ArrowDown" | "ArrowUp") => {
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
    };

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

      if (key === "Tab" && event.shiftKey) {
        toggleInteractionMode();
        return true;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalOpen, composerFocus: true },
      });
      if (command === "composer.cycleInteractionMode") {
        toggleInteractionMode();
        return true;
      }

      const menuIsActive = composerMenuOpenRef.current;
      if (menuIsActive) {
        const currentItems = composerMenuItemsRef.current;
        if (currentItems.length === 0) {
          return key !== "Enter";
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
        if ((key === "Enter" || key === "Tab") && selectedItem) {
          onSelectComposerItem(selectedItem);
          return true;
        }
      }
      if (
        command === "composer.send" ||
        (command === null && key === "Enter" && !event.shiftKey)
      ) {
        flushPromptCommit();
        onSend();
        return true;
      }
      if (command === "composer.interrupt") {
        onInterrupt();
        return true;
      }
      return false;
    };

    const handleInterruptPrimaryAction = () => {
      onInterrupt();
    };

    const handleComposerSubmit = (event?: { preventDefault: () => void }) => {
      flushPromptCommit();
      onSend(event);
    };

    const handleComposerBlurCapture = (event: FocusEvent<HTMLFormElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }
      flushPromptCommit();
    };
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
        readSnapshot: () => {
          return readComposerSnapshotRef.current();
        },
        resetCursorState: (options?: {
          cursor?: number;
          prompt?: string;
          detectTrigger?: boolean;
        }) => {
          const promptForState = options?.prompt ?? promptRef.current;
          const cursor = clampCollapsedComposerCursor(promptForState, options?.cursor ?? 0);
          if (options?.prompt !== undefined) {
            promptRef.current = promptForState;
            setLivePrompt((current) => (current === promptForState ? current : promptForState));
          }
          syncEditorToPromptRef.current(promptForState, cursor);
          setComposerHighlightedItemId(null);
          setComposerCursor(cursor);
          setComposerTrigger(
            options?.detectTrigger
              ? resolveComposerTriggerRef.current(
                  promptForState,
                  expandCollapsedComposerCursor(promptForState, cursor),
                )
              : null,
          );
        },
        getSendContext: () => {
          flushPromptCommitRef.current();
          const submitData = composerEditorRef.current?.getSubmitData();
          const promptForSend = submitData?.text ?? promptRef.current;
          return {
            prompt: promptForSend,
            ...(submitData?.richText !== undefined ? { richText: submitData.richText } : {}),
            images: composerImagesRef.current,
            hasUnresolvedSlashCommand: isUnresolvedStandaloneComposerSlashCommand(promptForSend, {
              hasComposerCommand: (submitData?.commands.length ?? 0) > 0,
            }),
          };
        },
      }),
      [promptRef, composerImagesRef],
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
      showModeControls && interactionMode !== "agent" ? interactionMode : null;
    const composerInteractionModeChip =
      activeComposerInteractionMode === null ? null : (
        <ComposerInteractionModeChip
          mode={activeComposerInteractionMode}
          shortcutLabel={interactionModeShortcutLabel}
          onClear={() => handleInteractionModeChange("agent")}
        />
      );
    const composerAgentModeControl = showModeControls ? (
      <span className="inline-flex min-w-0 max-w-full shrink items-center gap-1 overflow-hidden">
        <ComposerAgentModeMenu
          agentMode={runtimePreferences.agentMode}
          thinkingLevel={runtimePreferences.thinkingLevel}
          disabled={isAgentModeSaving || isConnecting}
          onAgentModeChange={handleAgentModeChange}
          onThinkingLevelChange={handleThinkingLevelChange}
        />
      </span>
    ) : null;
    // Render
    // ------------------------------------------------------------------
    return (
      <form
        ref={composerFormRef}
        onSubmit={handleComposerSubmit}
        onBlurCapture={handleComposerBlurCapture}
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
          <SubagentTrayStack
            activeThreadId={activeThreadId}
            compact={composerVariant === "compact"}
            visible={subagentTrayVisible}
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
            )}
            data-has-header={hasComposerHeader ? "" : undefined}
            data-layout={isInlineEditComposer ? "inline-edit" : undefined}
            data-multi-composer-surface=""
            data-has-images={composerImages.length > 0 ? "" : undefined}
            data-dragging={isDragOverComposer ? "" : undefined}
            data-expanded={isDockComposerExpanded ? "" : undefined}
            data-plus-menu-placement="bottom-start"
            data-slash-menu-placement="top-start"
            data-variant={composerVariant}
            onDragEnter={onComposerDragEnter}
            onDragOver={onComposerDragOver}
            onDragLeave={onComposerDragLeave}
            onDrop={onComposerDrop}
          >
            <div
              className={composerShellClass({ mode: composerShellMode })}
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
                    aria-label="Attach images"
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
                  value={editorSyncState.value}
                  cursor={editorSyncState.cursor}
                  syncRevision={editorSyncState.syncRevision}
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
                                : interactionMode === "plan"
                                  ? "Create a plan..."
                                : interactionMode === "debug"
                                  ? "Inspect failures and gather diagnostics..."
                                  : phase === "disconnected"
                                    ? "Ask for follow-up changes or attach images"
                                    : composerVariant === "compact"
                                      ? "Send follow-up"
                                      : "Plan, Build, / for skills, @ for context"
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
                  agentModeControl={composerAgentModeControl}
                  interactionModeChip={composerInteractionModeChip}
                  secondaryAction={footerSecondaryAction}
                  primaryActionState={{
                    pendingAction: pendingPrimaryAction,
                    isRunning: phase === "running",
                    showPlanFollowUpPrompt:
                      pendingUserInputs.length === 0 &&
                      showPlanFollowUpPrompt &&
                      livePrompt.trim().length > 0 &&
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
  },
);
