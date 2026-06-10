import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { createSubagentExtension } from "./subagent-extension";
import { createPlanExtension } from "./plan-extension";

type AskUserKind = "input" | "select" | "confirm";

interface AskUserDetails {
  readonly prompt: string;
  readonly kind: AskUserKind;
  readonly options: readonly string[];
  readonly answer: string | null;
  readonly confirmed: boolean | null;
  readonly cancelled: boolean;
}

const AskUserParams = Type.Object({
  prompt: Type.String({
    description: "The question or confirmation prompt to show the user.",
  }),
  kind: Type.Union([Type.Literal("input"), Type.Literal("select"), Type.Literal("confirm")], {
    description: "Use input for free-form answers, select for choices, and confirm for yes/no.",
  }),
  options: Type.Array(Type.String(), {
    description: "Choices for select mode. Use an empty array for input or confirm mode.",
  }),
});

function textResult(text: string, details: AskUserDetails) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function cancelledDetails(
  prompt: string,
  kind: AskUserKind,
  options: readonly string[],
): AskUserDetails {
  return {
    prompt,
    kind,
    options,
    answer: null,
    confirmed: null,
    cancelled: true,
  };
}

export const askUserExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user for input when their answer is required to continue. Supports free-form input, choice selection, and yes/no confirmation.",
    promptSnippet: "Ask the user a focused question and wait for their answer.",
    promptGuidelines: [
      "Use ask_user only when the user's answer is required to proceed.",
      "Keep prompts short and specific.",
      "For select mode, provide concise options in the options array.",
    ],
    parameters: AskUserParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return textResult(
          "Error: UI not available for ask_user.",
          cancelledDetails(params.prompt, params.kind, params.options),
        );
      }

      if (params.kind === "select" && params.options.length === 0) {
        return textResult(
          "Error: ask_user select mode requires at least one option.",
          cancelledDetails(params.prompt, params.kind, params.options),
        );
      }

      if (params.kind === "confirm") {
        const confirmed = await ctx.ui.confirm(params.prompt, "");
        return textResult(confirmed ? "User confirmed." : "User declined.", {
          prompt: params.prompt,
          kind: params.kind,
          options: params.options,
          answer: confirmed ? "yes" : "no",
          confirmed,
          cancelled: false,
        });
      }

      const answer =
        params.kind === "select"
          ? await ctx.ui.select(params.prompt, params.options)
          : await ctx.ui.input(params.prompt, "Type your answer");
      if (answer === undefined || answer.trim().length === 0) {
        return textResult(
          "User did not provide an answer.",
          cancelledDetails(params.prompt, params.kind, params.options),
        );
      }

      return textResult(`User answered: ${answer}`, {
        prompt: params.prompt,
        kind: params.kind,
        options: params.options,
        answer,
        confirmed: null,
        cancelled: false,
      });
    },
  });
};

export interface DesktopAgentExtensionFactoryOptions {
  readonly agentDir: string;
}

export function createDesktopAgentExtensionFactories(
  options: DesktopAgentExtensionFactoryOptions,
): ExtensionFactory[] {
  return [askUserExtension, createPlanExtension, createSubagentExtension(options)];
}
