import type {
  ExtensionAPI,
  ExtensionFactory,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { createSubagentExtension } from "./subagent-extension";
import { createPlanExtension } from "./plan-extension";
import { createDebugLogsExtension } from "./debug-logs-extension";
import type { DesktopExtensionUiQuestion, DesktopExtensionUiQuestionResult } from "./extension-ui";

interface AskQuestionDetails {
  readonly title: string;
  readonly questions: readonly AskQuestion[];
  readonly answers: readonly AskQuestionAnswer[];
  readonly cancelled: boolean;
}

interface AskQuestionOption {
  readonly id: string;
  readonly label: string;
}

interface AskQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly AskQuestionOption[];
  readonly allow_multiple?: boolean;
}

interface AskQuestionAnswer {
  readonly questionId: string;
  readonly selectedOptionIds: readonly string[];
  readonly freeformText?: string;
}

type AskQuestionUi = ExtensionUIContext & {
  readonly askQuestion?: (
    title: string,
    questions: readonly DesktopExtensionUiQuestion[],
  ) => Promise<DesktopExtensionUiQuestionResult>;
};

const AskQuestionOptionParams = Type.Object({
  id: Type.String({ description: "Stable option identifier returned when selected." }),
  label: Type.String({ description: "Choice label shown to the user." }),
});

const AskQuestionQuestionParams = Type.Object({
  id: Type.String({ description: "Stable identifier for this question." }),
  prompt: Type.String({ description: "The question to show the user." }),
  options: Type.Array(AskQuestionOptionParams, {
    description: "At least two choices. The UI adds Other automatically; do not include it.",
  }),
  allow_multiple: Type.Optional(
    Type.Boolean({ description: "Allow selecting more than one option. Defaults to false." }),
  ),
});

const AskQuestionParams = Type.Object({
  title: Type.Optional(Type.String({ description: "Short title for the question group." })),
  questions: Type.Array(AskQuestionQuestionParams, {
    description: "One or more multiple-choice questions to ask the user.",
  }),
});

function textResult(text: string, details: AskQuestionDetails) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function normalizedTitle(title: string | undefined): string {
  const trimmed = title?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Questions";
}

function cancelledDetails(
  title: string | undefined,
  questions: readonly AskQuestion[],
): AskQuestionDetails {
  return {
    title: normalizedTitle(title),
    questions,
    answers: [],
    cancelled: true,
  };
}

function normalizeQuestions(
  questions: readonly AskQuestion[],
): readonly DesktopExtensionUiQuestion[] {
  return questions.map((question) => ({
    id: question.id.trim(),
    text: question.prompt.trim(),
    options: question.options.map((option) => ({
      id: option.id.trim(),
      label: option.label.trim(),
    })),
    allowMultiple: question.allow_multiple === true,
  }));
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function validateQuestions(questions: readonly AskQuestion[]): string | null {
  if (questions.length === 0) {
    return "Error: ask_question requires at least one question.";
  }

  const questionIds = questions.map((question) => question.id.trim()).filter(Boolean);
  if (questionIds.length !== questions.length) {
    return "Error: ask_question question ids must be non-empty.";
  }
  if (hasDuplicates(questionIds)) {
    return "Error: ask_question question ids must be unique.";
  }

  for (const [index, question] of questions.entries()) {
    if (question.prompt.trim().length === 0) {
      return `Error: question ${index + 1} is missing prompt.`;
    }
    const optionIds = question.options.map((option) => option.id.trim()).filter(Boolean);
    if (optionIds.length !== question.options.length) {
      return `Error: question ${index + 1} option ids must be non-empty.`;
    }
    if (hasDuplicates(optionIds)) {
      return `Error: question ${index + 1} option ids must be unique.`;
    }
    const optionLabels = question.options.map((option) => option.label.trim());
    if (optionLabels.some((label) => label.length === 0)) {
      return `Error: question ${index + 1} option labels must be non-empty.`;
    }
    if (optionLabels.length < 2) {
      return `Error: question ${index + 1} requires at least two options.`;
    }
  }

  return null;
}

function formatQuestionResult(
  questions: readonly DesktopExtensionUiQuestion[],
  result: DesktopExtensionUiQuestionResult,
): string {
  if (result.cancelled || result.answers.length === 0) {
    return "User did not provide an answer.";
  }

  const questionById = new Map(questions.map((question) => [question.id, question]));
  return result.answers
    .map((answer) => {
      const question = questionById.get(answer.questionId);
      const selectedLabels = answer.selectedOptionIds
        .map((optionId) => question?.options.find((option) => option.id === optionId)?.label)
        .filter((label): label is string => typeof label === "string");
      const values = [...selectedLabels, ...(answer.freeformText ? [answer.freeformText] : [])];
      return `${question?.text ?? answer.questionId}\n${values.join(", ")}`;
    })
    .join("\n\n");
}

export const askQuestionExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "ask_question",
    label: "Ask Question",
    description:
      "Ask the user one or more multiple-choice questions. Each question must provide at least two options. The UI adds an Other option automatically for custom answers.",
    promptSnippet: "Ask the user one or more multiple-choice questions and wait for answers.",
    promptGuidelines: [
      "Use ask_question only when the user's answer is required to proceed.",
      "ask_question is always multiple choice: each question needs at least two options.",
      "Each ask_question option needs a stable id and label.",
      "Do not add an Other option yourself; the UI always provides Other for custom answers.",
      "Use allow_multiple: true only when the user may pick more than one option.",
    ],
    parameters: AskQuestionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const validationError = validateQuestions(params.questions);
      if (validationError) {
        return textResult(validationError, cancelledDetails(params.title, params.questions));
      }

      if (!ctx.hasUI) {
        return textResult(
          "Error: UI not available for ask_question.",
          cancelledDetails(params.title, params.questions),
        );
      }

      const questions = normalizeQuestions(params.questions);
      const ui = ctx.ui as AskQuestionUi;
      if (!ui.askQuestion) {
        return textResult(
          "Error: ask_question UI is not available.",
          cancelledDetails(params.title, params.questions),
        );
      }

      const title = normalizedTitle(params.title);
      const result = await ui.askQuestion(title, questions);
      const answers: AskQuestionAnswer[] = result.answers.map((answer) => ({
        questionId: answer.questionId,
        selectedOptionIds: answer.selectedOptionIds,
        ...(answer.freeformText ? { freeformText: answer.freeformText } : {}),
      }));
      const details: AskQuestionDetails = {
        title,
        questions: params.questions,
        answers,
        cancelled: result.cancelled,
      };

      return textResult(formatQuestionResult(questions, result), details);
    },
  });
};

export interface DesktopAgentExtensionFactoryOptions {
  readonly agentDir: string;
  readonly extensionPaths?: readonly string[];
}

export function createDesktopAgentExtensionFactories(
  options: DesktopAgentExtensionFactoryOptions,
): ExtensionFactory[] {
  return [
    askQuestionExtension,
    createPlanExtension,
    createDebugLogsExtension(options),
    createSubagentExtension(options),
  ];
}
