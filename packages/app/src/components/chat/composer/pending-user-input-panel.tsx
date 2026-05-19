import { type ApprovalRequestId } from "@multi/contracts";
import { memo, type KeyboardEvent } from "react";
import { type PendingUserInput } from "../../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "./pending-user-input";
import { IconCheckmark1 } from "central-icons";
import { cn } from "~/lib/utils";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string, advanceAfterSelect?: boolean) => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string, advanceAfterSelect?: boolean) => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;

  const handleOptionSelection = (questionId: string, optionLabel: string) => {
    if (!activeQuestion || isResponding) return;
    const advanceAfterSelect = !activeQuestion.multiSelect;
    onToggleOption(questionId, optionLabel, advanceAfterSelect);
  };

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!activeQuestion || isResponding) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }
    if (
      target instanceof HTMLElement &&
      target.closest('[contenteditable]:not([contenteditable="false"])')
    ) {
      return;
    }
    const digit = Number.parseInt(event.key, 10);
    if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
    const option = activeQuestion.options[digit - 1];
    if (!option) return;
    event.preventDefault();
    handleOptionSelection(activeQuestion.id, option.label);
  };

  if (!activeQuestion) {
    return null;
  }

  return (
    <div className="px-4 py-3 sm:px-5" onKeyDownCapture={handleKeyDownCapture}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {prompt.questions.length > 1 ? (
            <span className="flex h-5 shrink-0 items-center rounded-multi-control bg-multi-bg-tertiary px-1.5 text-caption font-medium tabular-nums text-multi-fg-tertiary">
              {questionIndex + 1}/{prompt.questions.length}
            </span>
          ) : null}
          <span className="min-w-0 truncate text-detail font-semibold text-multi-fg-tertiary uppercase">
            {activeQuestion.header}
          </span>
        </div>
        {activeQuestion.multiSelect ? (
          <span className="shrink-0 text-caption text-multi-fg-quaternary">Multi-select</span>
        ) : null}
      </div>
      <p className="mt-1.5 select-text text-body text-multi-fg-primary">
        {activeQuestion.question}
      </p>
      {activeQuestion.multiSelect ? (
        <p className="mt-1 select-text text-caption text-multi-fg-tertiary">
          Select one or more options.
        </p>
      ) : null}
      <div
        className="mt-3 grid gap-1"
        role={activeQuestion.multiSelect ? "group" : "radiogroup"}
        aria-label={activeQuestion.header}
      >
        {activeQuestion.options.map((option, index) => {
          const isSelected = progress.selectedOptionLabels.includes(option.label);
          const shortcutKey = index < 9 ? index + 1 : null;
          return (
            <button
              key={`${activeQuestion.id}:${option.label}`}
              type="button"
              disabled={isResponding}
              role={activeQuestion.multiSelect ? undefined : "radio"}
              aria-checked={activeQuestion.multiSelect ? undefined : isSelected}
              aria-pressed={activeQuestion.multiSelect ? isSelected : undefined}
              onClick={() => handleOptionSelection(activeQuestion.id, option.label)}
              className={cn(
                "group flex min-h-9 w-full select-none items-center gap-2.5 rounded-multi-control border px-2.5 py-2 text-left transition-colors duration-100",
                isSelected
                  ? "border-multi-stroke-focused bg-multi-bg-tertiary text-multi-fg-primary"
                  : "border-transparent bg-multi-bg-quaternary/60 text-multi-fg-secondary hover:border-multi-stroke-tertiary hover:bg-multi-bg-tertiary hover:text-multi-fg-primary",
                isResponding && "opacity-50 cursor-not-allowed",
              )}
            >
              {shortcutKey !== null ? (
                <kbd
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-multi-control text-detail font-medium tabular-nums transition-colors duration-100",
                    isSelected
                      ? "bg-blue-500/15 text-blue-400"
                      : "bg-multi-bg-tertiary text-multi-fg-quaternary group-hover:text-multi-fg-tertiary",
                  )}
                >
                  {shortcutKey}
                </kbd>
              ) : null}
              <div className="min-w-0 flex-1">
                <span className="text-body font-medium">{option.label}</span>
                {option.description && option.description !== option.label ? (
                  <span className="ml-2 text-caption text-multi-fg-tertiary">
                    {option.description}
                  </span>
                ) : null}
              </div>
              {isSelected ? <IconCheckmark1 className="size-3.5 shrink-0 text-blue-400" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});
