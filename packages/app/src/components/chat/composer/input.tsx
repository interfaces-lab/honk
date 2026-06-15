import {
  forwardRef,
  memo,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ComponentProps,
  type Dispatch,
  type FocusEvent,
  type RefObject,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Button } from "@honk/honkkit/button";
import { Spinner } from "@honk/honkkit/spinner";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@honk/honkkit/menu";
import { Switch } from "@honk/honkkit/switch";
import { workbenchChromeTextControlVariants } from "@honk/honkkit/workbench-chrome-row";
import {
  IconArrowUp,
  IconBug,
  IconBubbleQuestion,
  IconCheckmark1,
  IconChevronDownSmall,
  IconChevronLeftMedium,
  IconClawd,
  IconCursor,
  IconCrossSmall,
  IconOpenaiCodex,
  IconPlusSmall,
  IconStop,
  IconTodos,
  type CentralIconBaseProps,
} from "central-icons";
import { scopedThreadKey } from "~/lib/environment-scope";
import {
  type AgentMode,
  type AgentPreferencesPatch,
  type AgentThinkingLevel,
  type MessageId,
  type AgentInteractionMode,
  type ScopedThreadRef,
  type ThreadId,
} from "@honk/contracts";
import type { UnifiedSettings } from "@honk/contracts/settings";
import {
  clampCollapsedComposerCursor,
  isComposerModeSlashCommand,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  isUnresolvedStandaloneComposerSlashCommand,
  replaceTextRange,
  slashCommandRemovalRange,
} from "./prompt-triggers";
import { deriveComposerSendState, type ComposerSubmitContext } from "../composer-submit";
import {
  type DraftId,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../../stores/chat-drafts";
import { forceComposerSync, useComposerInputModel } from "./use-composer-input-model";
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
import { buildThreadMentionToken } from "./command-menu/thread-items";
import { ComposerPendingApprovalActions } from "./pending/approval-actions";
import { ComposerPendingApprovalPanel } from "./pending/approval-panel";
import { ComposerPendingUserInputPanel } from "./pending/user-input-panel";
import { cn } from "~/lib/utils";
import { cva } from "class-variance-authority";
import type { QueuedComposerItem } from "../../../stores/chat-send-queue";
import { useComposerKeyboard } from "./use-composer-keyboard";
import { useComposerFocusOnType } from "./focus-on-type";
import {
  interactionModeFromKeybindingCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "~/keybindings";
import { useComposerImageAttachments } from "./attachments/use-image-attachments";
import { ComposerImageAttachmentStrip } from "./attachments/image-attachment-strip";
import {
  type ComposerFooterPendingAction,
  type ComposerInputHandle,
  type ComposerInputProps,
  type ComposerInteractionModeFocusMode,
} from "./input-contract";
import {
  createComposerModeSuggestionUsage,
  markComposerModeSuggestionUsed,
  nextComposerInteractionMode,
  normalizeComposerModeSuggestionUsage,
  suggestedComposerInteractionMode,
  type ComposerModeSuggestionUsage,
} from "./interaction-modes";
import { registerComposerInteractionModeTarget } from "./interaction-mode-target";
import { QueuedComposerEditBanner, QueuedComposerItemsPanel } from "./queue/queued-items-panel";
import { SubagentTrayStack } from "./subagents/subagent-tray";
import { shouldShowSubagentTrayForComposer } from "./subagents/subagent-tray-visibility";
import { ComposerContextUsageBar } from "./context/context-usage-bar";
import { PlanFollowUpTray } from "./plan-follow-up/plan-follow-up-tray";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { isDesktopRuntimeApiAvailable, readHonkRuntimeApi } from "~/lib/honk-runtime-api";
import { useQueryClient } from "@tanstack/react-query";
import { runtimeSkillsQueryOptions } from "~/lib/runtime-skills";
import { projectSearchEntriesQueryOptions } from "~/lib/project-react-query";
import { selectRuntimeIdentityForThread, useAgentRuntimeStore } from "~/stores/agent-runtime-store";
import {
  AGENT_MODE_LABELS,
  AGENT_MODE_THINKING_LEVELS,
  AGENT_THINKING_LEVEL_OPTIONS,
  deriveAgentModeAvailability,
  unavailableAgentModeReason,
  type AgentModeAvailability,
} from "~/lib/agent-mode-options";
import {
  cursorComposerFastEnabled,
  cursorComposerPolicyModelSelection,
  CURSOR_COMPOSER_MODEL_NAME,
} from "@honk/shared/cursor-composer";

export type {
  ComposerInputHandle,
  ComposerInputProps,
  ComposerInteractionModeFocusMode,
} from "./input-contract";

const composerEditorClass = cva(
  "block w-full min-w-0 overflow-y-auto whitespace-pre-wrap wrap-break-word bg-transparent text-honk-fg-secondary outline-hidden",
  {
    variants: {
      mode: {
        "new-agent": "min-h-0 px-0 py-0",
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
  "inline-flex h-6 w-fit max-w-full shrink-0 items-center gap-1 overflow-hidden rounded-full border-0 px-2 pr-1 text-body font-medium shadow-none [&_svg]:size-3 [&_svg]:shrink-0",
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

function ComposerInteractionModeSuggestionButton(props: {
  mode: ActiveComposerInteractionMode;
  shortcutLabel: string | null;
  onSelect: () => void;
}) {
  const suggestion = getInteractionModeChipConfig(props.mode);
  const SuggestionIcon = suggestion.Icon;
  const shortcutTitle = props.shortcutLabel ? ` (${props.shortcutLabel})` : "";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 max-w-full shrink rounded-full px-2 text-detail font-medium text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary [&_svg]:size-3 [&_svg]:shrink-0"
      title={`Try ${suggestion.label} Mode${shortcutTitle}`}
      onClick={props.onSelect}
    >
      <SuggestionIcon aria-hidden />
      <span className="min-w-0 truncate">Try {suggestion.label} Mode</span>
      {props.shortcutLabel ? (
        <span className="shrink-0 text-caption text-honk-fg-tertiary">{props.shortcutLabel}</span>
      ) : null}
    </Button>
  );
}

const MODEL_THINKING_LEVEL_LABELS: Record<AgentThinkingLevel, string> = {
  off: "Fast",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

const COMPOSER_AGENT_MODE_OPTIONS = [
  "deep",
  "smart",
  "rush",
  "composer",
] as const satisfies readonly AgentMode[];

const AGENT_MODE_MODEL_DETAILS: Record<
  AgentMode,
  {
    readonly modelName: string;
    readonly description: string;
  }
> = {
  deep: {
    modelName: "GPT-5.5",
    description: "The most capable coding mode, with deep reasoning.",
  },
  smart: {
    modelName: "Claude Opus 4.8",
    description: "Strong intelligence for any task.",
  },
  rush: {
    modelName: "GPT-5.5",
    description: "Fast, low-token work for small, well-defined tasks.",
  },
  composer: {
    modelName: CURSOR_COMPOSER_MODEL_NAME,
    description: "Cursor Composer through the Cursor SDK with your Cursor API key.",
  },
};

type AgentModeSubmenuState = {
  mode: AgentMode;
  kind: "details" | "effort";
} | null;

function AgentModeProviderIcon(props: { agentMode: AgentMode; className?: string }) {
  const Icon =
    props.agentMode === "smart"
      ? IconClawd
      : props.agentMode === "composer"
        ? IconCursor
        : IconOpenaiCodex;

  return <Icon className={props.className} aria-hidden />;
}

function ComposerReadOnlyAgentModeChip(props: { agentMode: AgentMode }) {
  const label = AGENT_MODE_LABELS[props.agentMode];

  return (
    <span
      className={cn(
        workbenchChromeTextControlVariants(),
        "max-w-44 cursor-default rounded-full px-2 transition-none hover:bg-transparent hover:text-honk-fg-secondary",
      )}
      aria-label={`Mode: ${label}`}
      title={label}
    >
      <AgentModeProviderIcon
        agentMode={props.agentMode}
        className="size-3 shrink-0 text-honk-icon-secondary"
      />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function AgentModeDetailsPopup(props: { mode: AgentMode; unavailableReason?: string | null }) {
  const details = AGENT_MODE_MODEL_DETAILS[props.mode];

  return (
    <div className="space-y-2 px-2 py-1 text-body text-honk-fg-primary">
      <div className="flex items-center gap-1.5 font-medium">
        <AgentModeProviderIcon
          agentMode={props.mode}
          className="size-4 shrink-0 text-honk-icon-secondary"
        />
        <span>{details.modelName}</span>
      </div>
      <p className="text-honk-fg-secondary">{details.description}</p>
      {props.unavailableReason ? (
        <p className="text-honk-fg-tertiary">Unavailable. {props.unavailableReason}</p>
      ) : null}
    </div>
  );
}

function effectiveAgentModeThinkingLevel(
  mode: AgentMode,
  activeMode: AgentMode,
  activeThinkingLevel: AgentThinkingLevel,
): AgentThinkingLevel {
  if (mode === "rush") {
    return "off";
  }
  if (mode === "composer") {
    return "off";
  }
  if (mode === activeMode && activeThinkingLevel !== "off") {
    return activeThinkingLevel;
  }
  return AGENT_MODE_THINKING_LEVELS[mode];
}

function isAgentModeEditTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-agent-mode-edit]") !== null;
}

const ComposerAgentModePickerTrigger = memo(function ComposerAgentModePickerTrigger(props: {
  agentMode: AgentMode;
  disabled: boolean;
}) {
  return (
    <MenuTrigger
      type="button"
      className={cn(
        workbenchChromeTextControlVariants(),
        "max-w-40 rounded-full pr-1.5 pl-2 transition-none disabled:pointer-events-none disabled:opacity-50",
      )}
      aria-label="Agent mode"
      disabled={props.disabled}
    >
      <AgentModeProviderIcon
        agentMode={props.agentMode}
        className="size-3 shrink-0 text-honk-icon-secondary"
      />
      <span className="min-w-0 truncate">{AGENT_MODE_LABELS[props.agentMode]}</span>
      <IconChevronDownSmall className="size-3 shrink-0 text-honk-icon-tertiary" aria-hidden />
    </MenuTrigger>
  );
});

function ComposerAgentModePicker(props: {
  agentMode: AgentMode;
  thinkingLevel: AgentThinkingLevel;
  composerFastModeEnabled: boolean;
  availability: AgentModeAvailability;
  disabled: boolean;
  fastMode: boolean;
  onAgentModeChange: (agentMode: AgentMode) => void;
  onFastModeChange: (fastMode: boolean) => void;
  onAgentModeThinkingLevelChange: (agentMode: AgentMode, thinkingLevel: AgentThinkingLevel) => void;
  onComposerFastModeChange: (fastEnabled: boolean) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<AgentModeSubmenuState>(null);

  const setPickerOpenState = (open: boolean) => {
    setPickerOpen(open);
    if (!open) {
      setOpenSubmenu(null);
    }
  };

  const selectAgentMode = (mode: AgentMode) => {
    setOpenSubmenu(null);
    setPickerOpen(false);
    props.onAgentModeChange(mode);
  };

  return (
    <Menu open={pickerOpen} onOpenChange={setPickerOpenState}>
      <ComposerAgentModePickerTrigger agentMode={props.agentMode} disabled={props.disabled} />
      <MenuPopup
        align="end"
        side="top"
        sideOffset={6}
        variant="workbench"
        className="w-[184px] border-transparent shadow-honk-base"
      >
        {COMPOSER_AGENT_MODE_OPTIONS.map((mode) => {
          const selected = mode === props.agentMode;
          const thinkingLevel = effectiveAgentModeThinkingLevel(
            mode,
            props.agentMode,
            props.thinkingLevel,
          );
          const label = AGENT_MODE_LABELS[mode];
          const unavailableReason = unavailableAgentModeReason(mode, props.availability);
          const modeUnavailable = unavailableReason !== null;
          const hasEffortSettings = mode !== "rush" && mode !== "composer";
          const hasOpenAIFastSettings = mode === "deep" || mode === "rush";
          const hasComposerFastSettings = mode === "composer";
          const hasEditSettings =
            hasEffortSettings || hasOpenAIFastSettings || hasComposerFastSettings;
          const showEditSettings =
            !modeUnavailable && openSubmenu?.mode === mode && openSubmenu.kind === "effort";
          const showEffortSettings = showEditSettings && hasEffortSettings;
          const showOpenAIFastSettings = showEditSettings && hasOpenAIFastSettings;
          const showComposerFastSettings = showEditSettings && hasComposerFastSettings;

          return (
            <MenuSub
              key={mode}
              open={openSubmenu?.mode === mode}
              onOpenChange={(open, eventDetails) => {
                if (open) {
                  setOpenSubmenu({
                    mode,
                    kind:
                      hasEditSettings &&
                      isAgentModeEditTarget(eventDetails.event?.target ?? null)
                        ? "effort"
                        : "details",
                  });
                  return;
                }
                setOpenSubmenu((current) => (current?.mode === mode ? null : current));
              }}
            >
              <MenuSubTrigger
                variant="workbench"
                className={cn(
                  "group/model gap-2 pe-1 transition-none [&>svg:last-child]:hidden",
                  modeUnavailable && "opacity-50",
                )}
                onPointerDownCapture={(event) => {
                  if (isAgentModeEditTarget(event.target) || selected || modeUnavailable) {
                    return;
                  }
                  selectAgentMode(mode);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  if (isAgentModeEditTarget(event.target) || selected || modeUnavailable) {
                    return;
                  }
                  selectAgentMode(mode);
                }}
                onClick={(event) => {
                  if (!modeUnavailable && isAgentModeEditTarget(event.target)) {
                    setOpenSubmenu((current) =>
                      current?.mode === mode && current.kind === "effort"
                        ? { mode, kind: "details" }
                        : { mode, kind: "effort" },
                    );
                  }
                }}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <AgentModeProviderIcon
                    agentMode={mode}
                    className="size-3.5 shrink-0 text-honk-icon-secondary"
                  />
                  <span className="min-w-0 truncate text-honk-fg-primary">{label}</span>
                  {hasEffortSettings ? (
                    <span className="shrink-0 text-honk-fg-tertiary">
                      {MODEL_THINKING_LEVEL_LABELS[thinkingLevel]}
                    </span>
                  ) : mode === "composer" ? (
                    <span className="shrink-0 text-honk-fg-tertiary">
                      {props.composerFastModeEnabled ? "Fast" : "Normal"}
                    </span>
                  ) : null}
                </span>
                {hasEditSettings && !modeUnavailable ? (
                  <span
                    className={cn(
                      "-my-px hidden shrink-0 items-center rounded-[4px] px-1 py-px text-detail text-honk-fg-secondary",
                      "hover:bg-honk-bg-quaternary hover:text-honk-fg-primary active:bg-honk-bg-tertiary",
                      "group-hover/model:inline-flex group-data-[highlighted]/model:inline-flex",
                      "data-[selected=true]:inline-flex",
                      showEditSettings && "bg-honk-bg-tertiary text-honk-fg-primary",
                    )}
                    data-agent-mode-edit=""
                    data-selected={selected ? "true" : undefined}
                  >
                    Edit
                  </span>
                ) : null}
                {selected ? <IconCheckmark1 className="size-3 shrink-0" aria-hidden /> : null}
              </MenuSubTrigger>
              <MenuSubPopup
                variant="workbench"
                side="inline-end"
                className={cn(
                  "border-transparent shadow-honk-base",
                  showOpenAIFastSettings
                    ? "w-[220px]"
                    : showEditSettings
                      ? "w-[160px]"
                      : "w-[220px]",
                )}
              >
                {showEditSettings ? (
                  <>
                    {showEffortSettings ? (
                      <MenuRadioGroup
                        value={thinkingLevel}
                        onValueChange={(value) => {
                          const option = AGENT_THINKING_LEVEL_OPTIONS.find(
                            (entry) => entry.value === value,
                          );
                          if (option) {
                            props.onAgentModeThinkingLevelChange(mode, option.value);
                          }
                        }}
                      >
                        <MenuGroupLabel variant="workbench">Effort</MenuGroupLabel>
                        {AGENT_THINKING_LEVEL_OPTIONS.map((option) => (
                          <MenuRadioItem
                            key={option.value}
                            value={option.value}
                            variant="workbench"
                            className="transition-none"
                          >
                            {MODEL_THINKING_LEVEL_LABELS[option.value]}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    ) : null}
                    {showOpenAIFastSettings ? (
                      <>
                        <MenuGroupLabel
                          variant="workbench"
                          className={showEffortSettings ? "mt-1" : undefined}
                        >
                          OpenAI
                        </MenuGroupLabel>
                        <MenuCheckboxItem
                          checked={props.fastMode}
                          onCheckedChange={props.onFastModeChange}
                          variant="workbench-switch"
                        >
                          Fast Mode
                        </MenuCheckboxItem>
                      </>
                    ) : null}
                    {showComposerFastSettings ? (
                      <div className="px-2 py-1.5">
                        <MenuGroupLabel variant="workbench">Mode</MenuGroupLabel>
                        <label className="mt-1 flex items-center justify-between gap-3 rounded-[4px] px-2 py-1.5 text-body text-honk-fg-primary">
                          <span className="min-w-0 truncate">Fast mode</span>
                          <Switch
                            checked={props.composerFastModeEnabled}
                            aria-label="Fast mode"
                            onCheckedChange={props.onComposerFastModeChange}
                          />
                        </label>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <AgentModeDetailsPopup mode={mode} unavailableReason={unavailableReason} />
                )}
              </MenuSubPopup>
            </MenuSub>
          );
        })}
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

const EMPTY_COMPOSER_MENU_EXPANDED_SECTIONS: ReadonlySet<string> = new Set();

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
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
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

    // Cursor observes the fake menu-anchor span's style attribute and refreshes
    // Floating UI when it moves. The anchor reads live DOM rects; this revision
    // bump repositions the popover without caching stale coordinates in React.
    const observer = new MutationObserver(() => {
      setComposerMenuAnchorRevision((value) => value + 1);
    });
    // The anchor span lives in the prompt editor's subtree and can attach after
    // this sync mounts (editor remount with the menu opening in the same
    // commit). Retry on animation frames until it exists, then bump once so
    // the popover snaps from the 0,0 fallback rect to the real trigger origin.
    let frameId: number | null = null;
    const attach = () => {
      frameId = null;
      const anchor = composerMenuAnchorRef.current;
      if (!anchor) {
        if (typeof requestAnimationFrame !== "undefined") {
          frameId = requestAnimationFrame(attach);
        }
        return;
      }
      observer.observe(anchor, { attributeFilter: ["style"] });
      setComposerMenuAnchorRevision((value) => value + 1);
    };
    attach();
    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
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

const composerActionButtonClass = cva(
  "rounded-full bg-transparent transition-[background-color,color,opacity] duration-100",
  {
    variants: {
      action: {
        submit:
          "enabled:cursor-pointer text-honk-icon-secondary hover:bg-honk-bg-quaternary hover:text-honk-icon-primary disabled:pointer-events-none disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-honk-icon-secondary",
        stop: "cursor-pointer text-honk-fg-red-primary hover:bg-honk-bg-quaternary hover:opacity-85",
      },
    },
  },
);

function ComposerActionButton({
  action,
  state,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "variant"> & {
  action: "submit" | "stop";
  state: "running" | "busy" | "idle";
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className={cn(composerActionButtonClass({ action }), className)}
      data-honk-composer-action={action}
      data-honk-composer-state={state}
      {...props}
    />
  );
}

function ComposerAttachmentButton(props: { disabled: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="rounded-full bg-honk-bg-tertiary text-honk-icon-tertiary hover:bg-honk-bg-secondary hover:text-honk-icon-secondary disabled:opacity-35"
      aria-label="Attach images"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <IconPlusSmall className="size-3.5 shrink-0" aria-hidden="true" />
    </Button>
  );
}

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
      <ComposerActionButton
        type="button"
        action="stop"
        state={dataState}
        onClick={props.onInterrupt}
        aria-label="Stop generation"
      >
        <IconStop className="size-3.5" />
      </ComposerActionButton>
    );

    if (!props.hasSendableContent) {
      return stopButton;
    }

    return (
      <ComposerActionButton
        type="submit"
        action="submit"
        state={dataState}
        disabled={props.isSendBusy || props.isConnecting || !props.hasSendableContent}
        aria-label={runningSendLabel}
        title={runningSendLabel}
      >
        <IconArrowUp className="size-3.5" />
      </ComposerActionButton>
    );
  }

  if (props.showPlanFollowUpPrompt) {
    return (
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        className="h-6 gap-1 rounded-full bg-transparent px-2.5 text-detail font-medium text-(--honk-bg-yellow-primary) hover:opacity-85 disabled:opacity-30 [&_svg]:size-3.5 [&_svg]:shrink-0"
        disabled={props.isSendBusy || props.isConnecting}
        aria-label="Refine plan"
        title="Refine plan"
      >
        <IconArrowUp aria-hidden />
        {props.isConnecting || props.isSendBusy ? "Sending..." : "Refine"}
      </Button>
    );
  }

  return (
    <ComposerActionButton
      type="submit"
      action="submit"
      state={dataState}
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
        <Spinner
          aria-hidden="true"
          className={cn("text-current", props.dockSingleRow ? "size-3" : "size-3.5")}
        />
      ) : (
        <IconArrowUp className="size-3.5" />
      )}
    </ComposerActionButton>
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
  interactionModeSuggestion: ReactNode;
  attachmentAction?: ReactNode | undefined;
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
      data-honk-composer-toolbar={isThreadShell ? "bottom" : undefined}
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
        data-honk-composer-toolbar="left"
        className={cn(
          "flex min-w-0 items-center gap-1",
          dockSingleRow ? "max-w-[46%] shrink overflow-hidden" : "flex-1 overflow-hidden",
        )}
      >
        {props.attachmentAction ? (
          <span className="inline-flex shrink-0">{props.attachmentAction}</span>
        ) : null}
        {props.agentModeControl ? (
          <span className="inline-flex shrink-0">{props.agentModeControl}</span>
        ) : null}
        {props.interactionModeChip ? (
          <span className="inline-flex shrink-0">{props.interactionModeChip}</span>
        ) : null}
        {props.interactionModeSuggestion ? (
          <span className="inline-flex min-w-0 shrink">{props.interactionModeSuggestion}</span>
        ) : null}
      </div>

      <div
        data-chat-input-actions="right"
        data-chat-input-primary-actions-compact={primaryActionsCompact ? "true" : "false"}
        className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
      >
        {!dockSingleRow && props.primaryActionState.isPreparingWorktree ? (
          <span className="hidden select-none text-caption text-muted-foreground/70 sm:inline">
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

export const ComposerInput = memo(
  forwardRef<ComposerInputHandle, ComposerInputProps>(function ComposerInput(props, ref) {
    const {
      variant = "compact",
      layout = "thread",
      composerDraftTarget,
      environmentId,
      draftId,
      activeThreadId,
      phase,
      isTurnRunning,
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
      activeContextWindow,
      resolvedTheme,
      settings,
      keybindings,
      terminalOpen,
      gitCwd,
      branchName,
      executionModeLabel,
      promptRef: externalPromptRef,
      composerImagesRef,
      footerSecondaryAction,
      onSend,
      onCompactContext,
      onInterrupt,
      onBuildPlan,
      onDismissPlan,
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
    const handleCompactContext = onCompactContext ?? (() => undefined);
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

    const fallbackPromptRef = useRef("");
    const promptRef = externalPromptRef ?? fallbackPromptRef;

    // ------------------------------------------------------------------
    // Store subscriptions (prompt / images)
    // ------------------------------------------------------------------
    const composerInputModel = useComposerInputModel(composerDraftTarget);
    const composerDraft = useComposerThreadDraft(composerDraftTarget);
    const draftPrompt = composerInputModel.prompt;
    const composerDraftTargetKeyValue = composerInputModel.targetKey;
    const updateComposerDraft = composerInputModel.updateDraft;
    const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
    const [livePrompt, setLivePrompt] = useState(draftPrompt);
    const [editorSyncState, setEditorSyncState] = useState(() => ({
      value: draftPrompt,
      cursor: collapseExpandedComposerCursor(draftPrompt, draftPrompt.length),
      syncRevision: 0,
    }));
    const composerImages = composerDraft.images;
    const runtimePreferences = useAgentRuntimeStore((state) => state.snapshot.preferences);
    const runtimeAuthStatuses = useAgentRuntimeStore((state) => state.snapshot.authStatuses);
    const setRuntimeSnapshot = useAgentRuntimeStore((state) => state.setSnapshot);
    const agentModeAvailability = deriveAgentModeAvailability(runtimeAuthStatuses);
    const [isAgentModeSaving, setIsAgentModeSaving] = useState(false);

    const statusContextWindow = useMemo(() => {
      if (settings.agentWindowUsageSummaryDisplay === "never") {
        return null;
      }
      if (!activeContextWindow) {
        return null;
      }
      return activeContextWindow;
    }, [activeContextWindow, settings.agentWindowUsageSummaryDisplay]);
    const showContextUsageTrigger = settings.agentWindowUsageSummaryDisplay !== "never";
    const composerStatusBranchName = branchName?.trim() || null;
    const composerStatusExecutionModeLabel = executionModeLabel?.trim() || null;

    // ------------------------------------------------------------------
    // Composer-local state
    // ------------------------------------------------------------------
    const [composerCursor, setComposerCursor] = useState(() =>
      collapseExpandedComposerCursor(draftPrompt, draftPrompt.length),
    );
    const [composerTrigger, setComposerTriggerState] = useState<ComposerTrigger | null>(null);
    const [expandedComposerMenuSections, setExpandedComposerMenuSections] = useState<
      ReadonlySet<string>
    >(EMPTY_COMPOSER_MENU_EXPANDED_SECTIONS);
    const previousComposerTriggerRef = useRef<ComposerTrigger | null>(null);
    // Expanded "Show N more" sections survive only while a same-kind trigger
    // stays on an empty query: closing the menu, switching trigger kind, or
    // typing a query resets the collapse state.
    const setComposerTrigger = (next: ComposerTrigger | null) => {
      const previous = previousComposerTriggerRef.current;
      previousComposerTriggerRef.current = next;
      if (
        next === null ||
        previous === null ||
        next.kind !== previous.kind ||
        next.query.trim().length > 0
      ) {
        setExpandedComposerMenuSections((current) =>
          current.size === 0 ? current : EMPTY_COMPOSER_MENU_EXPANDED_SECTIONS,
        );
      }
      setComposerTriggerState(next);
    };
    const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
    const [composerHighlightedSearchKey, setComposerHighlightedSearchKey] = useState<string | null>(
      null,
    );
    const [isComposerEditorMultiline, setIsComposerEditorMultiline] = useState(false);
    const composerMenuPrefetchClient = useQueryClient();

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
    const composerMenuPrefetchedCwdRef = useRef<string | null>(null);
    const composerMenuOpenRef = useRef(false);
    const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
    const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
    const suppressInitialComposerTriggerDetectionRef = useRef(true);
    const initialComposerTriggerSuppressionPromptRef = useRef(draftPrompt);
    const dismissedComposerTriggerRef = useRef<ComposerTriggerDismissal | null>(null);
    const composerDraftTargetRef = useRef(composerDraftTarget);
    const composerDraftTargetKeyRef = useRef(composerDraftTargetKeyValue);
    const lastSyncedDraftTargetKeyRef = useRef(composerDraftTargetKeyValue);
    const lastForceSyncGenerationRef = useRef(composerInputModel.forceSyncGeneration);
    const modeSuggestionUsageRef = useRef<ComposerModeSuggestionUsage>(
      createComposerModeSuggestionUsage(draftPrompt),
    );
    composerDraftTargetRef.current = composerDraftTarget;
    composerDraftTargetKeyRef.current = composerDraftTargetKeyValue;

    const syncEditorToPrompt = (nextPrompt: string, nextCursor?: number, forceRewrite = false) => {
      setEditorSyncState((previous) => {
        const cursor = clampCollapsedComposerCursor(nextPrompt, nextCursor ?? nextPrompt.length);
        if (!forceRewrite && previous.value === nextPrompt && previous.cursor === cursor) {
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

    // Warm the slash (skills) and `@` (default files) menus before the first
    // trigger so opening them does not block on a cold runtime/index scan.
    // Fires on the composer's first focus per project; the 15s query staleTime
    // dedupes repeats and the live menus reuse these exact cache keys.
    const prefetchComposerMenuData = () => {
      if (!isDesktopRuntimeApiAvailable() || !gitCwd) {
        return;
      }
      if (composerMenuPrefetchedCwdRef.current === gitCwd) {
        return;
      }
      composerMenuPrefetchedCwdRef.current = gitCwd;
      void composerMenuPrefetchClient.prefetchQuery(
        runtimeSkillsQueryOptions({ cwd: gitCwd, enabled: true }),
      );
      void composerMenuPrefetchClient.prefetchQuery(
        projectSearchEntriesQueryOptions({
          environmentId,
          cwd: gitCwd,
          query: "",
          allowEmptyQuery: true,
          limit: 80,
        }),
      );
    };

    const updateAgentRuntimePreferences = (
      patch: AgentPreferencesPatch,
      errorMessage: string,
      setSaving?: Dispatch<SetStateAction<boolean>>,
    ) => {
      setSaving?.(true);
      const runtimeApi = readHonkRuntimeApi();
      void runtimeApi
        .updatePreferences(patch)
        .then(async () => {
          const snapshot = await runtimeApi.getHostSnapshot();
          setRuntimeSnapshot(snapshot);
          scheduleComposerFocus();
        })
        .catch((error: unknown) => {
          setThreadError(activeThreadId, error instanceof Error ? error.message : errorMessage);
        })
        .finally(() => setSaving?.(false));
    };

    const handleAgentModeChange = (agentMode: AgentMode) => {
      const thinkingLevel = AGENT_MODE_THINKING_LEVELS[agentMode];
      const modelSelection =
        agentMode === "composer"
          ? cursorComposerPolicyModelSelection(
              cursorComposerFastEnabled(runtimePreferences.modelSelection),
            )
          : undefined;
      if (
        agentMode === runtimePreferences.agentMode &&
        thinkingLevel === runtimePreferences.thinkingLevel &&
        modelSelection === undefined
      ) {
        scheduleComposerFocus();
        return;
      }

      updateAgentRuntimePreferences(
        {
          agentMode,
          thinkingLevel,
          ...(modelSelection ? { modelSelection } : {}),
        },
        "Failed to update agent mode.",
        setIsAgentModeSaving,
      );
    };

    const handleAgentModeThinkingLevelChange = (
      agentMode: AgentMode,
      thinkingLevel: AgentThinkingLevel,
    ) => {
      updateAgentRuntimePreferences(
        { agentMode, thinkingLevel },
        "Failed to update agent mode settings.",
        setIsAgentModeSaving,
      );
    };

    const handleComposerFastModeChange = (fastEnabled: boolean) => {
      const modelSelection = cursorComposerPolicyModelSelection(fastEnabled);
      if (
        runtimePreferences.agentMode === "composer" &&
        cursorComposerFastEnabled(runtimePreferences.modelSelection) === fastEnabled
      ) {
        scheduleComposerFocus();
        return;
      }
      updateAgentRuntimePreferences(
        {
          agentMode: "composer",
          thinkingLevel: AGENT_MODE_THINKING_LEVELS.composer,
          modelSelection,
        },
        "Failed to update Composer settings.",
        setIsAgentModeSaving,
      );
    };

    const handleFastModeChange = (fastMode: boolean) => {
      updateAgentRuntimePreferences({ fast: fastMode }, "Failed to update fast mode.");
    };

    const syncModeSuggestionUsageForPrompt = (prompt: string) => {
      modeSuggestionUsageRef.current = normalizeComposerModeSuggestionUsage(
        modeSuggestionUsageRef.current,
        prompt,
      );
      return modeSuggestionUsageRef.current;
    };

    const readInteractionModeSuggestion = (
      prompt: string,
    ): ActiveComposerInteractionMode | null => {
      const usage = syncModeSuggestionUsageForPrompt(prompt);
      return suggestedComposerInteractionMode({ interactionMode, prompt, usage });
    };

    const consumeInteractionModeSuggestion = (): ActiveComposerInteractionMode | null => {
      const suggestion = readInteractionModeSuggestion(promptRef.current);
      if (!suggestion) {
        return null;
      }
      modeSuggestionUsageRef.current = markComposerModeSuggestionUsed(
        modeSuggestionUsageRef.current,
        suggestion,
      );
      return suggestion;
    };

    const cycleInteractionMode = (focusMode: ComposerInteractionModeFocusMode = "preserve") => {
      const suggestedMode = consumeInteractionModeSuggestion();
      handleInteractionModeChange(
        suggestedMode ?? nextComposerInteractionMode(interactionMode),
        focusMode,
      );
    };

    useComposerKeyboard({
      enabled: showModeControls,
      keybindings,
      terminalOpen,
      targetRef: composerEditorHotkeyRef,
      onToggleInteractionMode: cycleInteractionMode,
    });
    const interactionModeShortcutLabel = shortcutLabelForCommand(
      keybindings,
      "composer.cycleInteractionMode",
      {
        context: { terminalFocus: false, terminalOpen, composerFocus: true },
      },
    );

    useLayoutSyncEffect(() => {
      if (!showModeControls) {
        return;
      }

      return registerComposerInteractionModeTarget({
        id: composerDraftTargetKeyValue,
        isFocused: () => {
          const activeElement = document.activeElement;
          return activeElement instanceof Node && composerFormRef.current?.contains(activeElement)
            ? true
            : false;
        },
        focus: (focusMode = "preserve") => {
          if (focusMode === "preserve") {
            composerEditorRef.current?.focus();
            return;
          }
          composerEditorRef.current?.focusAtEnd();
        },
        setInteractionMode: (mode, focusMode = "preserve") => {
          if (mode === interactionMode) {
            if (focusMode === "preserve") {
              composerEditorRef.current?.focus();
            } else {
              composerEditorRef.current?.focusAtEnd();
            }
            return;
          }
          handleInteractionModeChange(mode, focusMode);
        },
        cycleInteractionMode,
      });
    }, [
      composerDraftTargetKeyValue,
      cycleInteractionMode,
      handleInteractionModeChange,
      interactionMode,
      showModeControls,
    ]);

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
      activeThreadId,
      agentMode: runtimePreferences.agentMode,
      allowModeSlashCommands: showModeControls,
      composerTrigger,
      environmentId,
      expandedSections: expandedComposerMenuSections,
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
      isDragOverComposer,
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
      composerImagesRef,
      focusComposer,
      setThreadError,
    });

    const isComposerApprovalState = activePendingApproval !== null;
    useComposerFocusOnType({
      enabled: !isInlineEditComposer && !isConnecting && !isComposerApprovalState,
      promptInputRef: composerEditorRef,
    });
    const activePendingUserInput = pendingUserInputs[0] ?? null;
    const hasQueuedComposerItems = queuedComposerItems.length > 0;
    const queuedComposerActionsBusy = isConnecting || isSendBusy || isTurnRunning;
    const canSubmitQueuedComposerItem =
      hasQueuedComposerItems && !isEditingQueuedComposerItem && !queuedComposerActionsBusy;
    const hasComposerHeader = isComposerApprovalState || pendingUserInputs.length > 0;

    useLayoutSyncEffect(() => {
      const nextPrompt = isComposerApprovalState
        ? ""
        : activePendingProgress
          ? activePendingProgress.customAnswer
          : null;
      if (nextPrompt !== null) {
        if (nextPrompt === promptRef.current) {
          return;
        }
        syncModeSuggestionUsageForPrompt(nextPrompt);
        const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
        promptRef.current = nextPrompt;
        setLivePrompt((current) => (current === nextPrompt ? current : nextPrompt));
        syncEditorToPrompt(nextPrompt, nextCursor, true);
        setComposerCursor(nextCursor);
        setComposerTrigger(resolveComposerTrigger(nextPrompt, nextPrompt.length));
        setComposerHighlightedItemId(null);
        return;
      }

      const targetChanged = lastSyncedDraftTargetKeyRef.current !== composerDraftTargetKeyValue;
      const forceSyncChanged =
        lastForceSyncGenerationRef.current !== composerInputModel.forceSyncGeneration;
      lastSyncedDraftTargetKeyRef.current = composerDraftTargetKeyValue;
      lastForceSyncGenerationRef.current = composerInputModel.forceSyncGeneration;

      if (!targetChanged && !forceSyncChanged) {
        return;
      }

      const storePrompt = draftPrompt;
      if (storePrompt === promptRef.current && !forceSyncChanged) {
        return;
      }
      syncModeSuggestionUsageForPrompt(storePrompt);
      const nextCursor = collapseExpandedComposerCursor(storePrompt, storePrompt.length);
      promptRef.current = storePrompt;
      setLivePrompt((current) => (current === storePrompt ? current : storePrompt));
      syncEditorToPrompt(storePrompt, nextCursor, true);
      setComposerCursor(nextCursor);
      setComposerTrigger(resolveComposerTrigger(storePrompt, storePrompt.length));
      setComposerHighlightedItemId(null);
    }, [
      activePendingProgress?.customAnswer,
      composerDraftTargetKeyValue,
      composerInputModel.forceSyncGeneration,
      draftPrompt,
      isComposerApprovalState,
      promptRef,
      resolveComposerTrigger,
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
    const showThreadStatusBar =
      composerShellMode === "thread" &&
      (composerStatusBranchName !== null ||
        composerStatusExecutionModeLabel !== null ||
        showContextUsageTrigger);

    const showPlanTray =
      !isInlineEditComposer &&
      !isComposerApprovalState &&
      pendingUserInputs.length === 0 &&
      showPlanFollowUpPrompt &&
      activeProposedPlan !== null;
    const subagentTrayVisible = shouldShowSubagentTrayForComposer({
      isInlineEditComposer,
    });

    // ------------------------------------------------------------------
    // Prompt helpers
    // ------------------------------------------------------------------
    const persistPromptDraft = (nextPrompt: string) => {
      const submitData = composerEditorRef.current?.getSubmitData();
      const richTextJson =
        submitData?.richText !== undefined ? JSON.stringify(submitData.richText) : null;
      updateComposerDraft({ prompt: nextPrompt, richTextJson });
    };

    const setPrompt = (nextPrompt: string) => {
      setLivePrompt((current) => (current === nextPrompt ? current : nextPrompt));
      persistPromptDraft(nextPrompt);
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
      // forceRewrite: the dedupe in syncEditorToPrompt compares against the last
      // value PUSHED to the editor (user typing never updates it), so a removal
      // that collapses the prompt back to that stale value (e.g. "/deb" -> ""
      // after selecting a mode in an initially-empty composer) would skip the
      // revision bump, leave the Lexical document untouched, and let focusAt
      // resurrect the leftover text into the draft.
      syncEditorToPrompt(next.text, nextCursor, true);
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
      syncModeSuggestionUsageForPrompt(nextPrompt);
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

    const runClearComposer = (options?: { focus?: boolean }) => {
      composerEditorRef.current?.clear();
      promptRef.current = "";
      setLivePrompt("");
      clearComposerDraftContent(composerDraftTargetRef.current);
      forceComposerSync(composerDraftTargetKeyRef.current);
      setEditorSyncState((previous) => nextPromptSyncState("", 0, previous.syncRevision));
      setIsComposerEditorMultiline(false);
      setComposerHighlightedItemId(null);
      setComposerCursor(0);
      setComposerTrigger(null);
      if (options?.focus) {
        scheduleComposerFocus();
      }
    };

    const runRestoreComposer = (snapshot: ComposerSubmitContext) => {
      const promptForState = snapshot.prompt;
      const cursor = collapseExpandedComposerCursor(promptForState, promptForState.length);
      promptRef.current = promptForState;
      setLivePrompt(promptForState);
      updateComposerDraft({
        prompt: promptForState,
        richTextJson: snapshot.richText !== undefined ? JSON.stringify(snapshot.richText) : null,
      });
      forceComposerSync(composerDraftTargetKeyRef.current);
      setEditorSyncState((previous) =>
        nextPromptSyncState(promptForState, cursor, previous.syncRevision),
      );
      setComposerHighlightedItemId(null);
      setComposerCursor(cursor);
      setComposerTrigger(
        resolveComposerTriggerRef.current(
          promptForState,
          expandCollapsedComposerCursor(promptForState, cursor),
        ),
      );
      if (promptForState.includes("\n")) {
        setIsComposerEditorMultiline(true);
      } else if (promptForState.trim().length === 0) {
        setIsComposerEditorMultiline(false);
      }
    };

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
      </>
    );

    const applyComposerTokenReplacement = (
      snapshot: { value: string },
      trigger: ComposerTrigger,
      replacement: string,
    ): boolean => {
      const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
        snapshot.value,
        trigger.rangeEnd,
        replacement,
      );
      const applied = applyPromptReplacement(trigger.rangeStart, replacementRangeEnd, replacement, {
        expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
      });
      if (applied) {
        clearComposerCommandMenuState();
      }
      return applied;
    };

    const selectComposerThreadMention = async (
      item: Extract<ComposerCommandItem, { type: "thread" }>,
      captured: { trigger: ComposerTrigger },
    ) => {
      if (!isDesktopRuntimeApiAvailable()) return;
      let sessionFilePath: string | null = null;
      try {
        sessionFilePath = (
          await readHonkRuntimeApi().getThreadSessionFile({ threadId: item.threadId })
        ).path;
      } catch {
        sessionFilePath = null;
      }
      // Re-resolve after the await: Escape, outside-click, or edits during the
      // IPC round-trip must abort silently instead of inserting over new text.
      const { snapshot: liveSnapshot, trigger: liveTrigger } = resolveActiveComposerTrigger();
      if (
        !liveTrigger ||
        liveTrigger.kind !== captured.trigger.kind ||
        liveTrigger.rangeStart !== captured.trigger.rangeStart
      ) {
        return;
      }
      if (sessionFilePath === null) {
        dismissComposerCommandMenu();
        return;
      }
      applyComposerTokenReplacement(
        liveSnapshot,
        liveTrigger,
        buildThreadMentionToken(item.title, sessionFilePath),
      );
    };

    const onSelectComposerItem = (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) return;
      composerSelectLockRef.current = true;
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false;
      });
      if (item.type === "expander") {
        // Toggles the collapsed section and hands the highlight to the first
        // revealed item; the editor text and the open menu stay untouched.
        setExpandedComposerMenuSections((current) => {
          const next = new Set(current);
          if (next.has(item.sectionId)) {
            next.delete(item.sectionId);
          } else {
            next.add(item.sectionId);
          }
          return next;
        });
        setComposerHighlightedItemId(item.firstRevealedItemId);
        setComposerHighlightedSearchKey(composerMenuSearchKey);
        return;
      }
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      if (item.type === "path") {
        applyComposerTokenReplacement(snapshot, trigger, `@${item.path} `);
        return;
      }
      if (item.type === "skill") {
        applyComposerTokenReplacement(snapshot, trigger, `[$${item.name}](${item.path}) `);
        return;
      }
      if (item.type === "thread") {
        void selectComposerThreadMention(item, { trigger });
        return;
      }
      if (item.type === "slash-command") {
        if (item.command === "compact") {
          const removalRange = slashCommandRemovalRange(snapshot.value, trigger);
          const applied = applyPromptReplacement(
            removalRange.rangeStart,
            removalRange.rangeEnd,
            "",
            {
              expectedText: snapshot.value.slice(removalRange.rangeStart, removalRange.rangeEnd),
            },
          );
          if (applied) {
            clearComposerCommandMenuState();
            handleCompactContext();
          }
          return;
        }
        if (item.command === "goal") {
          applyComposerTokenReplacement(snapshot, trigger, "/goal ");
          return;
        }
        if (!isComposerModeSlashCommand(item.command)) return;
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

      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalOpen, composerFocus: true },
      });
      if (command === "composer.cycleInteractionMode") {
        cycleInteractionMode("preserve");
        return true;
      }
      const interactionModeCommand = interactionModeFromKeybindingCommand(command);
      if (interactionModeCommand) {
        handleInteractionModeChange(interactionModeCommand, "preserve");
        return true;
      }

      const menuIsActive = composerMenuOpenRef.current;
      if (menuIsActive) {
        const currentItems = composerMenuItemsRef.current;
        if (currentItems.length === 0) {
          return true;
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
      if (command === "composer.send" || (command === null && key === "Enter" && !event.shiftKey)) {
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
      onSend(event);
    };

    const handleComposerBlurCapture = (_event: FocusEvent<HTMLFormElement>) => {
      // SSOT writes happen immediately on editor change; no debounced flush.
    };
    // ------------------------------------------------------------------
    // Imperative handle
    // ------------------------------------------------------------------
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          composerEditorRef.current?.focus();
        },
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
          promptRef.current = promptForState;
          setLivePrompt((current) => (current === promptForState ? current : promptForState));
          syncEditorToPromptRef.current(promptForState, cursor, true);
          if (promptForState.trim().length === 0) {
            setIsComposerEditorMultiline(false);
          }
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
        clearComposer: (options?: { focus?: boolean }) => {
          runClearComposer(options);
        },
        restoreComposer: (snapshot: ComposerSubmitContext) => {
          runRestoreComposer(snapshot);
        },
        getSendContext: () => {
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
        insertMention: (payload) => {
          composerEditorRef.current?.insertMention(payload);
          composerEditorRef.current?.focusAtEnd();
        },
      }),
      [composerImagesRef, promptRef, updateComposerDraft],
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
    const activeModeSuggestionUsage =
      modeSuggestionUsageRef.current.prompt === livePrompt
        ? modeSuggestionUsageRef.current
        : createComposerModeSuggestionUsage(livePrompt);
    const activeInteractionModeSuggestion = showModeControls
      ? suggestedComposerInteractionMode({
          interactionMode,
          prompt: livePrompt,
          usage: activeModeSuggestionUsage,
        })
      : null;
    const composerInteractionModeChip =
      activeComposerInteractionMode === null ? null : (
        <ComposerInteractionModeChip
          mode={activeComposerInteractionMode}
          shortcutLabel={interactionModeShortcutLabel}
          onClear={() => handleInteractionModeChange("agent")}
        />
      );
    const composerInteractionModeSuggestion =
      activeInteractionModeSuggestion === null ? null : (
        <ComposerInteractionModeSuggestionButton
          mode={activeInteractionModeSuggestion}
          shortcutLabel={interactionModeShortcutLabel}
          onSelect={() => {
            const suggestedMode = consumeInteractionModeSuggestion();
            if (!suggestedMode) {
              return;
            }
            handleInteractionModeChange(suggestedMode, "preserve");
          }}
        />
      );
    const composerFastModeEnabled = cursorComposerFastEnabled(runtimePreferences.modelSelection);
    const composerAgentModeControl = showModeControls ? (
      <span className="inline-flex min-w-0 max-w-full shrink items-center gap-1 overflow-hidden">
        {isNewAgentComposer ? (
          <ComposerAgentModePicker
            agentMode={runtimePreferences.agentMode}
            thinkingLevel={runtimePreferences.thinkingLevel}
            composerFastModeEnabled={composerFastModeEnabled}
            availability={agentModeAvailability}
            disabled={isAgentModeSaving || isConnecting}
            fastMode={runtimePreferences.fast}
            onAgentModeChange={handleAgentModeChange}
            onFastModeChange={handleFastModeChange}
            onAgentModeThinkingLevelChange={handleAgentModeThinkingLevelChange}
            onComposerFastModeChange={handleComposerFastModeChange}
          />
        ) : (
          <ComposerReadOnlyAgentModeChip agentMode={runtimePreferences.agentMode} />
        )}
      </span>
    ) : null;
    const composerAttachmentButtonDisabled = pendingUserInputs.length > 0 || isConnecting;
    const composerAttachmentButton = !isComposerApprovalState ? (
      <ComposerAttachmentButton
        disabled={composerAttachmentButtonDisabled}
        onClick={() => composerImageInputRef.current?.click()}
      />
    ) : null;
    const handleMeasuredComposerMultilineChange = (multiline: boolean) => {
      if (multiline) {
        setIsComposerEditorMultiline(true);
        return;
      }
      if (promptRef.current.trim().length === 0) {
        setIsComposerEditorMultiline(false);
      }
    };
    // Render
    // ------------------------------------------------------------------
    return (
      <form
        ref={composerFormRef}
        onSubmit={handleComposerSubmit}
        onBlurCapture={handleComposerBlurCapture}
        onFocusCapture={prefetchComposerMenuData}
        className={cn(
          "w-full min-w-0",
          !isInlineEditComposer && !isNewAgentComposer && "mx-auto max-w-agent-chat",
        )}
        data-variant={composerVariant}
        data-layout={layout}
        data-chat-input-form="true"
      >
        {lifecycleSync}
        <div
          className={cn(
            "flex w-full min-w-0 shrink-0 flex-col",
            isInlineEditComposer
              ? "gap-0"
              : isNewAgentComposer
                ? "gap-2"
                : "mx-auto max-w-agent-chat gap-2",
          )}
          data-menu-open={composerMenuOpen ? "" : undefined}
          data-running={isTurnRunning ? "" : undefined}
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
              onDismissPlan={onDismissPlan}
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
                "select-none overflow-hidden border border-b-0 border-honk-stroke-tertiary text-honk-fg-primary",
              )}
              data-honk-composer-header=""
              data-honk-composer-surface=""
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
            data-layout={
              isInlineEditComposer ? "inline-edit" : isNewAgentComposer ? "new-agent" : undefined
            }
            data-honk-composer-surface=""
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
              data-honk-composer-shell={composerShellMode}
              {...(isDockComposerExpanded ? { "data-expanded": "" } : {})}
            >
              {!isComposerApprovalState ? (
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
              ) : null}
              {isDockComposerSingleLine ? composerAttachmentButton : null}
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
                      onExpandImage={onExpandImage}
                      onRemoveImage={removeComposerImage}
                    />
                  )}

                <ComposerPromptEditor
                  ref={composerEditorRef}
                  value={editorSyncState.value}
                  cursor={editorSyncState.cursor}
                  syncRevision={editorSyncState.syncRevision}
                  forceSyncGeneration={composerInputModel.forceSyncGeneration}
                  caretAnchorRef={composerMenuAnchorRef}
                  commandMenuAnchorExpandedOffset={composerTrigger?.rangeStart ?? null}
                  commandMenuOpen={composerMenuOpen && !isComposerApprovalState}
                  onMeasuredMultilineChange={handleMeasuredComposerMultilineChange}
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
                  data-honk-composer-toolbar={composerShellMode === "thread" ? "bottom" : undefined}
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
                  interactionModeSuggestion={composerInteractionModeSuggestion}
                  attachmentAction={isDockComposerSingleLine ? null : composerAttachmentButton}
                  secondaryAction={footerSecondaryAction}
                  primaryActionState={{
                    pendingAction: pendingPrimaryAction,
                    isRunning: isTurnRunning,
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
          {showThreadStatusBar ? (
            <ComposerContextUsageBar
              branchName={composerStatusBranchName}
              executionModeLabel={composerStatusExecutionModeLabel}
              showContextUsageTrigger={showContextUsageTrigger}
              usage={statusContextWindow}
            />
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
          activePathPreview={
            activeComposerMenuItem?.type === "path"
              ? { path: activeComposerMenuItem.path, pathKind: activeComposerMenuItem.pathKind }
              : null
          }
          onHighlightedItemChange={onComposerMenuItemHighlighted}
          onSelect={onSelectComposerItem}
        />
      </form>
    );
  }),
);
