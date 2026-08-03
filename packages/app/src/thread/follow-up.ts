import type { OpenCodePromptFileAttachment } from "@honk/opencode";

import { modeAgentName } from "../modes";
import type { ThreadViewState } from "../open-code-view";
import {
  groupMessagesIntoTurns,
  type AssistantThreadMessage,
  type FilePart,
  type TextPart,
  type ThreadPart,
  type ToolPart,
} from "./transcript-model";

export type SubmittedPlan = {
  readonly title: string;
  readonly summary?: string;
  readonly steps: readonly {
    readonly id: string;
    readonly title: string;
    readonly detail?: string;
  }[];
  readonly files?: readonly string[];
};

export type SubmittedPlanRecord = {
  readonly key: string;
  readonly messageID: string;
  readonly plan: SubmittedPlan;
};

export type DebugFollowUp = {
  readonly key: string;
  readonly messageID: string;
  readonly diagnosis: SubmittedDiagnosis;
};

export type SubmittedDiagnosis = {
  readonly title: string;
  readonly summary: string;
  readonly rootCause: string;
  readonly recommendedFix: string;
  readonly reproduction?: string;
  readonly files: readonly string[];
  readonly verification: readonly string[];
};

export function debugBuildPrompt(diagnosis: SubmittedDiagnosis): string {
  return [
    "Implement the accepted diagnosis below. Preserve unrelated work, make the smallest safe change, and verify it before replying.",
    `Root cause: ${diagnosis.rootCause}`,
    `Recommended fix: ${diagnosis.recommendedFix}`,
    ...(diagnosis.reproduction === undefined
      ? []
      : [`Observed reproduction: ${diagnosis.reproduction}`]),
    ...(diagnosis.files.length === 0 ? [] : [`Relevant files: ${diagnosis.files.join(", ")}`]),
    ...(diagnosis.verification.length === 0
      ? []
      : [`Required verification: ${diagnosis.verification.join("; ")}`]),
  ].join("\n\n");
}

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
  if (state.activity !== "idle" || state.permissions.length > 0 || state.questions.length > 0) {
    return null;
  }
  const turn = groupMessagesIntoTurns(state.messages).at(-1);
  if (turn === undefined) return null;
  const latestAssistant = turn.assistants.at(-1);
  if (
    latestAssistant?.time.completed === undefined ||
    latestAssistant.agent !== modeAgentName("plan")
  ) {
    return null;
  }
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
  if (state.activity !== "idle" || state.permissions.length > 0 || state.questions.length > 0) {
    return null;
  }
  const assistant = groupMessagesIntoTurns(state.messages)
    .at(-1)
    ?.assistants.findLast(
      (message): message is AssistantThreadMessage => message.time.completed !== undefined,
    );
  if (assistant?.agent !== modeAgentName("debug")) return null;
  const part = state.parts
    .filter((candidate) => candidate.messageID === assistant.id)
    .findLast((candidate) => submittedDiagnosisFrom(candidate) !== null);
  if (part === undefined) return null;
  const diagnosis = submittedDiagnosisFrom(part);
  return diagnosis === null ? null : { key: part.id, messageID: assistant.id, diagnosis };
}

export type StrandedFollowUp = {
  readonly messageID: string;
  readonly text: string;
  readonly files: readonly OpenCodePromptFileAttachment[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly synthetic?: boolean;
};

export function threadQueueCanDrain(input: {
  readonly activity: ThreadViewState["activity"];
  readonly needsAttention: boolean;
}): boolean {
  return input.activity === "idle" && !input.needsAttention;
}

/**
 * The trailing user message of an idle session that no assistant turn ever
 * answered. The sidecar admits a mid-run follow-up immediately but only picks
 * it up at a loop boundary, so a run stopped before that boundary strands the
 * message with no error and no reply. Redelivering it under its own message ID
 * is an exact retry, not a new message. Evaluate on run-end transitions only:
 * a freshly sent prompt is also briefly the trailing message before its run
 * starts.
 */
export function strandedFollowUp(
  state: Pick<ThreadViewState, "activity" | "messages" | "parts" | "permissions" | "questions">,
): StrandedFollowUp | null {
  if (
    !threadQueueCanDrain({
      activity: state.activity,
      needsAttention: state.permissions.length > 0 || state.questions.length > 0,
    })
  )
    return null;
  const last = state.messages.at(-1);
  if (last === undefined || last.role !== "user") return null;
  const text = state.parts.find(
    (candidate): candidate is TextPart =>
      candidate.messageID === last.id && candidate.type === "text",
  );
  const files = state.parts.filter(
    (candidate): candidate is FilePart =>
      candidate.messageID === last.id && candidate.type === "file",
  );
  if (text === undefined && files.length === 0) return null;
  return {
    messageID: last.id,
    text: text?.text ?? "",
    files: files.map((file) => ({
      uri: file.url,
      description: file.mime,
      ...(file.filename !== undefined ? { name: file.filename } : {}),
    })),
    ...(text?.metadata !== undefined ? { metadata: text.metadata } : {}),
    ...(text?.synthetic === true ? { synthetic: true } : {}),
  };
}

/**
 * Claims a stranded message for its single automatic redelivery attempt.
 * Keep the claimed IDs outside React so remounting the composer cannot reset
 * the cap and make a repeatedly stopped message look unkillable.
 */
export function claimStrandedFollowUp(
  state: Pick<ThreadViewState, "activity" | "messages" | "parts" | "permissions" | "questions">,
  claimedMessageIDs: Set<string>,
): StrandedFollowUp | null {
  const stranded = strandedFollowUp(state);
  if (stranded === null || claimedMessageIDs.has(stranded.messageID)) return null;
  claimedMessageIDs.add(stranded.messageID);
  return stranded;
}

function submittedPlanFrom(part: ThreadPart): SubmittedPlan | null {
  if (part.type !== "tool" || part.state.status !== "completed") return null;
  if (part.tool !== "plan_submit" && part.tool !== "honk_plan_submit") return null;
  const plan = submittedPayload(part.state, "plan");
  if (plan === null) return null;
  const title = Reflect.get(plan, "title");
  const summary = Reflect.get(plan, "summary");
  const rawSteps = Reflect.get(plan, "steps");
  const rawFiles = Reflect.get(plan, "files");
  if (typeof title !== "string" || !Array.isArray(rawSteps)) return null;
  const steps = rawSteps
    .map((step, index): SubmittedPlan["steps"][number] | null => {
      if (typeof step !== "object" || step === null) return null;
      const rawID = Reflect.get(step, "id");
      const stepTitle = Reflect.get(step, "title");
      const detail = Reflect.get(step, "detail");
      if (typeof stepTitle !== "string") return null;
      return {
        id:
          typeof rawID === "string" && rawID.trim().length > 0
            ? rawID
            : `step-${String(index + 1)}`,
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

function submittedDiagnosisFrom(part: ThreadPart): SubmittedDiagnosis | null {
  if (part.type !== "tool" || part.state.status !== "completed") return null;
  if (part.tool !== "debug_submit" && part.tool !== "honk_debug_submit") return null;
  const diagnosis = submittedPayload(part.state, "diagnosis");
  if (diagnosis === null) return null;
  const title = Reflect.get(diagnosis, "title");
  const summary = Reflect.get(diagnosis, "summary");
  const rootCause = Reflect.get(diagnosis, "rootCause");
  const recommendedFix = Reflect.get(diagnosis, "recommendedFix");
  const reproduction = Reflect.get(diagnosis, "reproduction");
  const files = Reflect.get(diagnosis, "files");
  const verification = Reflect.get(diagnosis, "verification");
  if (typeof rootCause !== "string" || rootCause.trim().length === 0) return null;
  if (typeof recommendedFix !== "string" || recommendedFix.trim().length === 0) return null;
  return {
    title: typeof title === "string" && title.trim().length > 0 ? title : "Diagnosis",
    summary: typeof summary === "string" ? summary : "",
    rootCause,
    recommendedFix,
    ...(typeof reproduction === "string" && reproduction.trim().length > 0 ? { reproduction } : {}),
    files: Array.isArray(files)
      ? files.filter((file): file is string => typeof file === "string")
      : [],
    verification: Array.isArray(verification)
      ? verification.filter((check): check is string => typeof check === "string")
      : [],
  };
}

/**
 * The legacy plugin tools attached the submission under `state.metadata`; the
 * MCP tools that replaced them are provider-executed and carry the same payload
 * as the raw tool-call input with no metadata at all. Transcripts hold both.
 */
function submittedPayload(
  state: Extract<ToolPart["state"], { status: "completed" }>,
  key: string,
): object | null {
  const metadata = state.metadata;
  const attached =
    typeof metadata === "object" && metadata !== null ? Reflect.get(metadata, key) : undefined;
  if (typeof attached === "object" && attached !== null) return attached;
  return typeof state.input === "object" && state.input !== null ? state.input : null;
}
