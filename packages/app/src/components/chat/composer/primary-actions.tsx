import { memo } from "react";
import { IconArrowUp, IconChevronDownSmall, IconChevronLeft, IconStop } from "central-icons";
import type { AgentWindowSendWhileStreamingBehavior } from "@multi/contracts/settings";
import { cn } from "~/lib/utils";
import { Button } from "@multi/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@multi/ui/menu";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

interface ComposerPrimaryActionsProps {
  compact: boolean;
  dockSingleRow: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  sendWhileStreamingBehavior: AgentWindowSendWhileStreamingBehavior;
  submitActionLabel?: string | undefined;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}

export const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
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
};

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  dockSingleRow,
  pendingAction,
  isRunning,
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  isConnecting,
  isPreparingWorktree,
  hasSendableContent,
  sendWhileStreamingBehavior,
  submitActionLabel,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
}: ComposerPrimaryActionsProps) {
  const circularControlClass = dockSingleRow
    ? "h-(--multi-composer-compact-control-size) w-(--multi-composer-compact-control-size)"
    : "h-9 w-9 sm:h-8 sm:w-8";

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label="Previous question"
            >
              <IconChevronLeft className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <Button
          type="submit"
          size="sm"
          className={cn("rounded-full", compact ? "px-3" : "px-4")}
          disabled={
            pendingAction.isResponding ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
          })}
        </Button>
      </div>
    );
  }

  if (isRunning) {
    const runningSendLabel =
      submitActionLabel ??
      (sendWhileStreamingBehavior === "queue"
        ? "Queue message"
        : sendWhileStreamingBehavior === "stop-and-send"
          ? "Stop and send message"
          : "Send message");
    const showRunningSendAction = hasSendableContent;
    const stopButton = (
      <button
        type="button"
        className={cn(
          "multi-composer-bar-control-button ui-prompt-input-submit-button flex cursor-pointer items-center justify-center rounded-full bg-rose-500/90 text-white transition-[background-color,color,opacity,transform] duration-150 hover:bg-rose-500 motion-reduce:transition-colors motion-reduce:active:scale-100 active:scale-[0.96]",
          circularControlClass,
        )}
        onClick={onInterrupt}
        aria-label="Stop generation"
      >
        <IconStop className={dockSingleRow ? "size-3" : "size-3.5"} />
      </button>
    );

    if (showRunningSendAction) {
      return (
        <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
          {stopButton}
          <button
            type="submit"
            className={cn(
              "multi-composer-bar-control-button ui-prompt-input-submit-button flex enabled:cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-[color,opacity,transform] duration-150 hover:opacity-90 motion-reduce:transition-opacity motion-reduce:active:scale-100 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30 disabled:hover:opacity-30",
              circularControlClass,
            )}
            disabled={isSendBusy || isConnecting || !hasSendableContent}
            aria-label={runningSendLabel}
            title={runningSendLabel}
          >
            <IconArrowUp className={dockSingleRow ? "size-3" : "size-3.5"} />
          </button>
        </div>
      );
    }

    return stopButton;
  }

  if (showPlanFollowUpPrompt) {
    if (promptHasText) {
      return (
        <Button
          type="submit"
          size="sm"
          className={cn("rounded-full", compact ? "h-9 px-3 sm:h-8" : "h-9 px-4 sm:h-8")}
          disabled={isSendBusy || isConnecting}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Refine"}
        </Button>
      );
    }

    return (
      <div data-chat-composer-implement-actions="true" className="flex items-center justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-9 rounded-l-full rounded-r-none px-4 sm:h-8"
          disabled={isSendBusy || isConnecting}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Implement"}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="default"
                className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2.5 sm:h-8"
                aria-label="Implementation actions"
                disabled={isSendBusy || isConnecting}
              />
            }
          >
            <IconChevronDownSmall className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="top" variant="workbench">
            <MenuItem
              variant="workbench"
              disabled={isSendBusy || isConnecting}
              onClick={() => void onImplementPlanInNewThread()}
            >
              Implement in a new thread
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  return (
    <button
      type="submit"
      className={cn(
        "multi-composer-bar-control-button ui-prompt-input-submit-button flex enabled:cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-[color,opacity,transform] duration-150 hover:opacity-90 motion-reduce:transition-opacity motion-reduce:active:scale-100 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30 disabled:hover:opacity-30",
        circularControlClass,
      )}
      disabled={isSendBusy || isConnecting || !hasSendableContent}
      aria-label={
        isConnecting
          ? "Connecting"
          : isPreparingWorktree
            ? "Preparing worktree"
            : isSendBusy
              ? "Sending"
              : (submitActionLabel ?? "Send message")
      }
      title={submitActionLabel ?? "Send message"}
    >
      {isConnecting || isSendBusy ? (
        dockSingleRow ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="animate-spin"
            aria-hidden="true"
          >
            <circle
              cx="6"
              cy="6"
              r="4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="17 10"
            />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            className="animate-spin"
            aria-hidden="true"
          >
            <circle
              cx="7"
              cy="7"
              r="5.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="20 12"
            />
          </svg>
        )
      ) : (
        <IconArrowUp className={dockSingleRow ? "size-3" : "size-3.5"} />
      )}
    </button>
  );
});
