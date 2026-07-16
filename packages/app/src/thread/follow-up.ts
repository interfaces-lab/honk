import { modeAgentName } from "../modes";
import type { ThreadViewState } from "../open-code-view";
import {
  groupMessagesIntoTurns,
  type AssistantThreadMessage,
  type TextPart,
  type ThreadPart,
} from "./transcript-model";

export type SubmittedPlan = {
  readonly title: string;
  readonly summary?: string;
  readonly steps: readonly { readonly title: string; readonly detail?: string }[];
  readonly files?: readonly string[];
};

export type SubmittedPlanRecord = {
  readonly key: string;
  readonly messageID: string;
  readonly plan: SubmittedPlan;
};

export type DebugFollowUp = {
  readonly key: string;
  readonly hint: string;
};

export function latestSubmittedPlan(parts: readonly ThreadPart[]): SubmittedPlanRecord | null {
  const part = parts.findLast((candidate) => submittedPlanFrom(candidate) !== null);
  if (part === undefined) return null;
  const plan = submittedPlanFrom(part);
  return plan === null ? null : { key: part.id, messageID: part.messageID, plan };
}

export function submittedPlanMarkdown(plan: SubmittedPlan): string {
  return [
    ...plan.steps.map(
      (step, index) =>
        `${String(index + 1)}. ${step.title}${step.detail !== undefined ? `. ${step.detail}` : ""}`,
    ),
    ...(plan.files !== undefined && plan.files.length > 0
      ? ["", `Files: ${plan.files.join(", ")}`]
      : []),
  ].join("\n");
}

export function pendingPlanFollowUp(state: ThreadViewState): SubmittedPlanRecord | null {
  if (
    state.summary.status === "running" ||
    state.permissions.length > 0 ||
    state.questions.length > 0
  ) {
    return null;
  }
  const turn = groupMessagesIntoTurns(state.messages).at(-1);
  if (turn === undefined) return null;
  const latestAssistant = turn.assistants.findLast(
    (message) => message.time.completed !== undefined,
  );
  if (latestAssistant?.agent !== modeAgentName("plan")) return null;
  const planAssistantIDs = new Set(
    turn.assistants
      .filter(
        (message) =>
          message.time.completed !== undefined && message.agent === modeAgentName("plan"),
      )
      .map((message) => message.id),
  );
  return latestSubmittedPlan(state.parts.filter((part) => planAssistantIDs.has(part.messageID)));
}

export function pendingDebugFollowUp(state: ThreadViewState): DebugFollowUp | null {
  if (
    state.summary.status === "running" ||
    state.permissions.length > 0 ||
    state.questions.length > 0
  ) {
    return null;
  }
  const assistant = groupMessagesIntoTurns(state.messages)
    .at(-1)
    ?.assistants.findLast(
      (message): message is AssistantThreadMessage => message.time.completed !== undefined,
    );
  if (assistant?.agent !== modeAgentName("debug")) return null;
  const hint = state.parts
    .filter(
      (part): part is TextPart =>
        part.type === "text" &&
        part.messageID === assistant.id &&
        part.synthetic !== true &&
        part.ignored !== true,
    )
    .map((part) => part.text)
    .join(" ")
    .trim();
  return hint.length === 0 ? null : { key: assistant.id, hint };
}

function submittedPlanFrom(part: ThreadPart): SubmittedPlan | null {
  if (part.type !== "tool" || part.tool !== "plan_submit" || part.state.status !== "completed") {
    return null;
  }
  const metadata = part.state.metadata;
  if (typeof metadata !== "object" || metadata === null) return null;
  const plan = Reflect.get(metadata, "plan");
  if (typeof plan !== "object" || plan === null) return null;
  const title = Reflect.get(plan, "title");
  const summary = Reflect.get(plan, "summary");
  const rawSteps = Reflect.get(plan, "steps");
  const rawFiles = Reflect.get(plan, "files");
  if (typeof title !== "string" || !Array.isArray(rawSteps)) return null;
  const steps = rawSteps
    .map((step): SubmittedPlan["steps"][number] | null => {
      if (typeof step !== "object" || step === null) return null;
      const stepTitle = Reflect.get(step, "title");
      const detail = Reflect.get(step, "detail");
      if (typeof stepTitle !== "string") return null;
      return {
        title: stepTitle,
        ...(typeof detail === "string" ? { detail } : {}),
      };
    })
    .filter((step): step is SubmittedPlan["steps"][number] => step !== null);
  if (steps.length === 0) return null;
  return {
    title: title.trim().length > 0 ? title : "Plan",
    ...(typeof summary === "string" ? { summary } : {}),
    steps,
    ...(Array.isArray(rawFiles)
      ? { files: rawFiles.filter((file): file is string => typeof file === "string") }
      : {}),
  };
}
