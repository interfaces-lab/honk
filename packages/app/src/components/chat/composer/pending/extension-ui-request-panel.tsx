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

  useEffect(() => {
    setDraftValue("");
    setSelectedActionIndex(null);
  }, [request?.id]);

  if (!request) {
    return null;
  }
  const responseActions = pendingExtensionUiRequestResponseActions(request, draftValue);
  const isOptionsRequest = request.kind === "select" || request.kind === "confirm";
  const selectedAction =
    selectedActionIndex === null ? null : (responseActions[selectedActionIndex] ?? null);

  const submitSelectedAction = () => {
    if (!selectedAction || isResponding) {
      return;
    }
    onRespond(request, selectedAction.value);
  };

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isOptionsRequest || isResponding) return;
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
      submitSelectedAction();
      return;
    }
    const key = event.key.toUpperCase();
    if (key.length !== 1 || key < "A" || key > "Z") return;
    const actionIndex = key.charCodeAt(0) - 65;
    if (!responseActions[actionIndex]) return;
    event.preventDefault();
    setSelectedActionIndex(actionIndex);
  };

  return (
    <div onKeyDownCapture={handleKeyDownCapture}>
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
          {isOptionsRequest ? (
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
