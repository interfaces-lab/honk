import type { AgentInteractionMode } from "@honk/shared/interaction-mode";
import type { AgentModelPolicy } from "@honk/shared/agent-model-policy";
import type { MessageId, ThreadEntryId } from "@honk/shared/base-schemas";
import type { ThreadAgentRuntimeImageAttachment } from "@honk/shared/runtime";
import type { SourceProposedPlanReference } from "@honk/shared/orchestration";
import type { ModelSelection } from "@honk/shared/model";
import type { ThreadId } from "@honk/shared/base-schemas";
import { createAgentModelPolicy } from "@honk/shared/agent-model-policy";

import { readHonkRuntimeApi, type HonkRuntimeApi } from "./honk-runtime-api";

interface RuntimeTurnInput {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly text: string;
  readonly interactionMode: AgentInteractionMode;
  readonly sourceProposedPlan: SourceProposedPlanReference | null;
  readonly clientMessageId: MessageId;
  readonly replacesClientMessageId: MessageId | null;
  readonly parentEntryId?: ThreadEntryId | null;
  readonly images: readonly ThreadAgentRuntimeImageAttachment[];
  readonly modelSelection: ModelSelection;
  readonly streamingBehavior?: "steer" | "followUp";
}

export interface PreparedRuntimeTurnPolicy {
  readonly runtimeApi: HonkRuntimeApi;
  readonly policy: Promise<AgentModelPolicy>;
}

export function prepareRuntimeTurnPolicy(input: {
  readonly interactionMode: AgentInteractionMode;
  readonly modelSelection: ModelSelection;
}): PreparedRuntimeTurnPolicy {
  const runtimeApi = readHonkRuntimeApi();
  const preferences = runtimeApi.getPreferences();
  const policy = preferences.then((preferences) =>
    createAgentModelPolicy({
      preferences,
      interactionMode: input.interactionMode,
      modelSelection: input.modelSelection,
    }),
  );
  void policy.catch(() => undefined);
  return { runtimeApi, policy };
}

export async function sendRuntimeTurnWithPreparedPolicy(
  input: RuntimeTurnInput & {
    readonly preparedPolicy: PreparedRuntimeTurnPolicy;
  },
): Promise<void> {
  void input;
  throw new Error("Runtime turn dispatch is unavailable after core cutover.");
}

export async function sendRuntimeTurn(input: RuntimeTurnInput): Promise<void> {
  const preparedPolicy = prepareRuntimeTurnPolicy({
    interactionMode: input.interactionMode,
    modelSelection: input.modelSelection,
  });
  await sendRuntimeTurnWithPreparedPolicy({
    ...input,
    preparedPolicy,
  });
}

export async function compactRuntimeThread(input: {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly interactionMode: AgentInteractionMode;
  readonly modelSelection: ModelSelection;
  readonly customInstructions?: string | undefined;
}): Promise<void> {
  void input;
  throw new Error("Runtime compact is unavailable after core cutover.");
}

const hydratedRuntimeThreadIds = new Set<string>();

export function resetRuntimeThreadHydrationCache(): void {
  hydratedRuntimeThreadIds.clear();
}

export async function hydrateRuntimeThread(input: {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly interactionMode: AgentInteractionMode;
  readonly modelSelection: ModelSelection;
}): Promise<void> {
  hydratedRuntimeThreadIds.add(String(input.threadId));
  void input.cwd;
  void input.interactionMode;
  void input.modelSelection;
}
