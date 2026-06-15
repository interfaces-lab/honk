import { type DesktopExtensionUiRequest } from "@honk/contracts";
import { Button } from "@honk/honkkit/button";
import { IconBubbleQuestion } from "central-icons";
import { useEffect, useState, type KeyboardEvent } from "react";
import {
  QuestionnaireActions,
  QuestionnaireFreeformRow,
  QuestionnaireHeader,
  QuestionnaireOptionButton,
  QuestionnaireOptions,
  QuestionnaireQuestionLabel,
  QuestionnaireSurface,
  questionnaireOptionLetter,
} from "./questionnaire";

interface ComposerPendingExtensionUiRequestPanelProps {
  readonly request: DesktopExtensionUiRequest | null;
  readonly pendingCount: number;
  readonly isResponding: boolean;
  readonly onRespond: (request: DesktopExtensionUiRequest, value: unknown) => void;
}

export interface PendingExtensionUiRequestResponseAction {
  readonly label: string;
  readonly value: unknown;
}

export function pendingExtensionUiRequestResponseActions(
  request: DesktopExtensionUiRequest,
  draftValue: string,
): readonly PendingExtensionUiRequestResponseAction[] {
  switch (request.kind) {
    case "select":
      return (request.options ?? []).map((option) => ({
        label: option,
        value: option,
      }));
    case "confirm":
      return [
        { label: "Confirm", value: true },
        { label: "Cancel", value: false },
      ];
    case "input":
    case "editor":
    case "custom":
      return [{ label: "Send", value: draftValue }];
    case "question":
      return [];
    default:
      return [];
  }
}

function requestKindLabel(kind: DesktopExtensionUiRequest["kind"]): string {
  switch (kind) {
    case "select":
      return "Select an option";
    case "confirm":
      return "Confirm";
    case "input":
      return "Your answer";
    case "editor":
      return "Editor";
    case "question":
      return "Questions";
    case "custom":
      return "Request";
  }
}

export function ComposerPendingExtensionUiRequestPanel({
  request,
  pendingCount,
  isResponding,
  onRespond,
}: ComposerPendingExtensionUiRequestPanelProps) {
  const [draftValue, setDraftValue] = useState("");
  const [selectedActionIndex, setSelectedActionIndex] = useState<number | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedQuestionOptions, setSelectedQuestionOptions] = useState<Record<string, string[]>>(
    {},
  );
  const [customQuestionAnswers, setCustomQuestionAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraftValue("");
    setSelectedActionIndex(null);
    setQuestionIndex(0);
    setSelectedQuestionOptions({});
    setCustomQuestionAnswers({});
  }, [request?.id]);

  if (!request) {
    return null;
  }
  const responseActions = pendingExtensionUiRequestResponseActions(request, draftValue);
  const isOptionsRequest = request.kind === "select" || request.kind === "confirm";
  const isQuestionRequest = request.kind === "question";
  const selectedAction =
    selectedActionIndex === null ? null : (responseActions[selectedActionIndex] ?? null);
  const questions = request.questions ?? [];
  const activeQuestion = isQuestionRequest ? (questions[questionIndex] ?? null) : null;
  const activeQuestionCustomAnswer = activeQuestion
    ? (customQuestionAnswers[activeQuestion.id] ?? "")
    : "";
  const activeQuestionSelectedOptions = activeQuestion
    ? (selectedQuestionOptions[activeQuestion.id] ?? [])
    : [];
  const activeQuestionAnswered = activeQuestion
    ? activeQuestionCustomAnswer.trim().length > 0 || activeQuestionSelectedOptions.length > 0
    : false;
  const questionIsLast = questionIndex >= questions.length - 1;

  if (isQuestionRequest && !activeQuestion) {
    return null;
  }

  const submitSelectedAction = () => {
    if (!selectedAction || isResponding) {
      return;
    }
    onRespond(request, selectedAction.value);
  };

  const submitQuestionAnswers = () => {
    if (isResponding) return;
    const answers = questions
      .map<{
        questionId: string;
        selectedOptionIds: string[];
        freeformText?: string;
      } | null>((question) => {
        const customAnswer = customQuestionAnswers[question.id]?.trim();
        if (customAnswer) {
          return { questionId: question.id, selectedOptionIds: [], freeformText: customAnswer };
        }
        const selected = selectedQuestionOptions[question.id] ?? [];
        if (selected.length === 0) return null;
        return {
          questionId: question.id,
          selectedOptionIds: question.allowMultiple ? selected : selected.slice(0, 1),
        };
      })
      .filter(
        (
          answer,
        ): answer is { questionId: string; selectedOptionIds: string[]; freeformText?: string } =>
          answer !== null,
      );
    if (answers.length !== questions.length) return;
    onRespond(request, { answers, cancelled: false });
  };

  const advanceQuestion = () => {
    if (!activeQuestionAnswered || isResponding) return;
    if (questionIsLast) {
      submitQuestionAnswers();
      return;
    }
    setQuestionIndex((current) => Math.min(current + 1, questions.length - 1));
  };

  const toggleQuestionOption = (questionId: string, optionId: string) => {
    const question = questions.find((entry) => entry.id === questionId);
    if (!question || isResponding) return;
    setCustomQuestionAnswers((existing) => ({ ...existing, [questionId]: "" }));
    setSelectedQuestionOptions((existing) => {
      const selected = existing[questionId] ?? [];
      const nextSelected = question.allowMultiple
        ? selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId]
        : [optionId];
      return { ...existing, [questionId]: nextSelected };
    });
  };

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((!isOptionsRequest && !isQuestionRequest) || isResponding) return;
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
    if (event.key === "Enter") {
      event.preventDefault();
      if (isQuestionRequest) {
        advanceQuestion();
      } else {
        submitSelectedAction();
      }
      return;
    }
    const key = event.key.toUpperCase();
    if (key.length !== 1 || key < "A" || key > "Z") return;
    const actionIndex = key.charCodeAt(0) - 65;
    if (isQuestionRequest) {
      const option = activeQuestion?.options[actionIndex];
      if (!activeQuestion || !option) return;
      event.preventDefault();
      toggleQuestionOption(activeQuestion.id, option.id);
      return;
    }
    if (!responseActions[actionIndex]) return;
    event.preventDefault();
    setSelectedActionIndex(actionIndex);
  };

  return (
    <div
      className="mx-auto mb-2 w-full max-w-agent-chat rounded-[22px]"
      onKeyDownCapture={handleKeyDownCapture}
    >
      <QuestionnaireSurface>
        <QuestionnaireHeader
          icon={<IconBubbleQuestion className="size-3.5" aria-hidden="true" />}
          title={requestKindLabel(request.kind)}
          trailing={pendingCount > 1 ? <span>1/{pendingCount}</span> : undefined}
        />
        <div className="ml-1 flex flex-col gap-0.5">
          <QuestionnaireQuestionLabel>{request.title}</QuestionnaireQuestionLabel>
          {request.message ? (
            <p className="ml-1.5 mt-0.5 select-text text-caption text-honk-fg-tertiary">
              {request.message}
            </p>
          ) : null}
          {isQuestionRequest && activeQuestion ? (
            <>
              <QuestionnaireQuestionLabel
                number={questions.length > 1 ? `${questionIndex + 1}.` : undefined}
              >
                {activeQuestion.text}
              </QuestionnaireQuestionLabel>
              {activeQuestion.allowMultiple ? (
                <p className="ml-1.5 mt-0.5 select-text text-caption text-honk-fg-tertiary">
                  Select one or more options.
                </p>
              ) : null}
              <QuestionnaireOptions
                label={activeQuestion.text}
                multiSelect={activeQuestion.allowMultiple}
              >
                {activeQuestion.options.map((option, index) => (
                  <QuestionnaireOptionButton
                    key={`${activeQuestion.id}:${option.label}`}
                    letter={questionnaireOptionLetter(index)}
                    label={option.label}
                    selected={activeQuestionSelectedOptions.includes(option.id)}
                    disabled={isResponding}
                    multiSelect={activeQuestion.allowMultiple}
                    onSelect={() => toggleQuestionOption(activeQuestion.id, option.id)}
                  />
                ))}
              </QuestionnaireOptions>
              <QuestionnaireFreeformRow
                letter={questionnaireOptionLetter(activeQuestion.options.length)}
                value={activeQuestionCustomAnswer}
                placeholder="Other..."
                disabled={isResponding}
                autoFocus={false}
                onChange={(value) => {
                  setSelectedQuestionOptions((existing) => ({
                    ...existing,
                    [activeQuestion.id]: [],
                  }));
                  setCustomQuestionAnswers((existing) => ({
                    ...existing,
                    [activeQuestion.id]: value,
                  }));
                }}
                onSubmit={advanceQuestion}
              />
              <QuestionnaireActions>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isResponding}
                  onClick={() => onRespond(request, { answers: [], cancelled: true })}
                >
                  Skip
                </Button>
                {questionIndex > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isResponding}
                    onClick={() => setQuestionIndex((current) => Math.max(0, current - 1))}
                  >
                    Back
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  disabled={isResponding || !activeQuestionAnswered}
                  onClick={advanceQuestion}
                >
                  {isResponding ? "Submitting..." : questionIsLast ? "Continue" : "Next"}
                </Button>
              </QuestionnaireActions>
            </>
          ) : isOptionsRequest ? (
            <>
              <QuestionnaireOptions label={request.title}>
                {responseActions.map((action, index) => (
                  <QuestionnaireOptionButton
                    key={action.label}
                    letter={questionnaireOptionLetter(index)}
                    label={action.label}
                    selected={selectedActionIndex === index}
                    disabled={isResponding}
                    onSelect={() => setSelectedActionIndex(index)}
                  />
                ))}
              </QuestionnaireOptions>
              <QuestionnaireActions>
                <Button
                  size="sm"
                  disabled={isResponding || selectedAction === null}
                  onClick={submitSelectedAction}
                >
                  {isResponding ? "Submitting..." : "Continue"}
                </Button>
              </QuestionnaireActions>
            </>
          ) : (
            <>
              <QuestionnaireFreeformRow
                letter="A"
                value={draftValue}
                placeholder={request.placeholder ?? "Type your answer"}
                disabled={isResponding}
                onChange={setDraftValue}
                onSubmit={() => onRespond(request, draftValue)}
              />
              <QuestionnaireActions>
                <Button
                  size="sm"
                  disabled={isResponding}
                  onClick={() => onRespond(request, responseActions[0]?.value ?? "")}
                >
                  {responseActions[0]?.label ?? "Send"}
                </Button>
              </QuestionnaireActions>
            </>
          )}
        </div>
      </QuestionnaireSurface>
    </div>
  );
}
