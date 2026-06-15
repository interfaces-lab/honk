import type { AgentInteractionMode } from "@honk/contracts";

import { DEFAULT_INTERACTION_MODE } from "../../../types";

export const COMPOSER_INTERACTION_MODE_CYCLE = [
  "agent",
  "plan",
  "ask",
  "debug",
] as const satisfies readonly AgentInteractionMode[];

export interface ComposerModeSuggestionUsage {
  readonly prompt: string;
  readonly planModeSuggestionUsed: boolean;
  readonly debugModeSuggestionUsed: boolean;
}

const DEBUG_MODE_KEYWORDS =
  /\b(debug|debugging|bug|buggy|broken|crash|crashes|crashed|error|exception|failing|failure|fails|failed|fault|hang|investigate|regression|repro|reproduce|stack trace|traceback)\b/i;

const PLAN_MODE_KEYWORDS =
  /\b(plan|planning|approach|architecture|architect|break down|design|proposal|roadmap|spec|strategy|steps?|todos?|migrate|migration|refactor|redesign|implement|build|create|add|integrate)\b/i;

export function nextComposerInteractionMode(mode: AgentInteractionMode): AgentInteractionMode {
  const index = COMPOSER_INTERACTION_MODE_CYCLE.indexOf(mode);
  const nextIndex = index < 0 ? 0 : (index + 1) % COMPOSER_INTERACTION_MODE_CYCLE.length;
  return COMPOSER_INTERACTION_MODE_CYCLE[nextIndex] ?? DEFAULT_INTERACTION_MODE;
}

export function createComposerModeSuggestionUsage(prompt: string): ComposerModeSuggestionUsage {
  return {
    prompt,
    planModeSuggestionUsed: false,
    debugModeSuggestionUsed: false,
  };
}

export function normalizeComposerModeSuggestionUsage(
  usage: ComposerModeSuggestionUsage,
  prompt: string,
): ComposerModeSuggestionUsage {
  return usage.prompt === prompt ? usage : createComposerModeSuggestionUsage(prompt);
}

export function suggestedComposerInteractionMode(input: {
  readonly interactionMode: AgentInteractionMode;
  readonly prompt: string;
  readonly usage: ComposerModeSuggestionUsage;
}): Exclude<AgentInteractionMode, "agent"> | null {
  const prompt = input.prompt.trim();
  if (prompt.length === 0) {
    return null;
  }

  if (
    input.interactionMode !== "plan" &&
    !input.usage.planModeSuggestionUsed &&
    shouldSuggestPlanMode(prompt)
  ) {
    return "plan";
  }

  if (
    input.interactionMode !== "debug" &&
    !input.usage.debugModeSuggestionUsed &&
    shouldSuggestDebugMode(prompt)
  ) {
    return "debug";
  }

  return null;
}

export function markComposerModeSuggestionUsed(
  usage: ComposerModeSuggestionUsage,
  mode: AgentInteractionMode,
): ComposerModeSuggestionUsage {
  switch (mode) {
    case "plan":
      return { ...usage, planModeSuggestionUsed: true };
    case "debug":
      return { ...usage, debugModeSuggestionUsed: true };
    case "agent":
    case "ask":
      return usage;
  }
}

function shouldSuggestPlanMode(prompt: string): boolean {
  if (PLAN_MODE_KEYWORDS.test(prompt)) {
    return true;
  }
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  return wordCount >= 18 && /[?.]/.test(prompt);
}

function shouldSuggestDebugMode(prompt: string): boolean {
  return DEBUG_MODE_KEYWORDS.test(prompt);
}
