import { type ApprovalRequestId } from "@honk/contracts";
import { IconBubbleQuestion } from "central-icons";
import { type KeyboardEvent } from "react";
import { type PendingUserInput } from "../../../../session-logic";
import { derivePendingUserInputProgress, type PendingUserInputDraftAnswer } from "./user-input";
import {
  QuestionnaireHeader,
  QuestionnaireOptionButton,
  QuestionnaireOptions,
  QuestionnaireQuestionLabel,
  QuestionnaireSurface,
  questionnaireOptionIndexForKey,
  questionnaireOptionLetter,
} from "./questionnaire";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string, advanceAfterSelect?: boolean) => void;
}

export function ComposerPendingUserInputPanel({
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
}

function ComposerPendingUserInputCard({
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
    onToggleOption(questionId, optionLabel);
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
    const optionIndex = questionnaireOptionIndexForKey(event.key);
    if (optionIndex === null) return;
    const option = activeQuestion.options[optionIndex];
    if (!option) return;
    event.preventDefault();
    handleOptionSelection(activeQuestion.id, option.label);
  };

  if (!activeQuestion) {
    return null;
  }

  return (
    <div onKeyDownCapture={handleKeyDownCapture}>
      <QuestionnaireSurface embedded>
        <QuestionnaireHeader
          icon={<IconBubbleQuestion className="size-3.5" aria-hidden="true" />}
          title={activeQuestion.header}
          trailing={
            prompt.questions.length > 1 ? (
              <span>
                {questionIndex + 1}/{prompt.questions.length}
              </span>
            ) : activeQuestion.multiSelect ? (
              <span>Multiple choice</span>
            ) : undefined
          }
        />
        <div className="pt-1 pr-2 pb-2 pl-2">
          <QuestionnaireQuestionLabel
            number={prompt.questions.length > 1 ? `${questionIndex + 1}.` : undefined}
          >
            {activeQuestion.question}
          </QuestionnaireQuestionLabel>
          {activeQuestion.multiSelect ? (
            <p className="mb-2 select-text text-caption text-honk-fg-tertiary">
              Select one or more options.
            </p>
          ) : null}
          <QuestionnaireOptions
            label={activeQuestion.header}
            multiSelect={activeQuestion.multiSelect ?? false}
          >
            {activeQuestion.options.map((option, index) => {
              const isSelected = progress.selectedOptionLabels.includes(option.label);
              return (
                <QuestionnaireOptionButton
                  key={`${activeQuestion.id}:${option.label}`}
                  letter={questionnaireOptionLetter(index)}
                  label={option.label}
                  description={
                    option.description && option.description !== option.label
                      ? option.description
                      : undefined
                  }
                  selected={isSelected}
                  disabled={isResponding}
                  multiSelect={activeQuestion.multiSelect ?? false}
                  onSelect={() => handleOptionSelection(activeQuestion.id, option.label)}
                />
              );
            })}
          </QuestionnaireOptions>
        </div>
      </QuestionnaireSurface>
    </div>
  );
}
