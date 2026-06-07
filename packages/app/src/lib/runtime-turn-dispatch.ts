import type {
  AgentInteractionMode,
  AgentModelPolicy,
  MessageId,
  MultiRuntimeApi,
  SourceProposedPlanReference,
  ThreadAgentRuntimeImageAttachment,
  ThreadId,
} from "@multi/contracts";
import { createAgentModelPolicy } from "@multi/shared/agent-model-policy";

import {
  assertRuntimeApiAvailable,
  assertRuntimeHostAvailable,
  readMultiRuntimeApi,
} from "./multi-runtime-api";

interface RuntimeTurnInput {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly text: string;
  readonly interactionMode: AgentInteractionMode;
  readonly sourceProposedPlan: SourceProposedPlanReference | null;
  readonly clientMessageId: MessageId;
  readonly images: readonly ThreadAgentRuntimeImageAttachment[];
}

export interface PreparedRuntimeTurnPolicy {
  readonly runtimeApi: MultiRuntimeApi;
  readonly policy: Promise<AgentModelPolicy>;
}

export function prepareRuntimeTurnPolicy(input: {
  readonly interactionMode: AgentInteractionMode;
}): PreparedRuntimeTurnPolicy {
  assertRuntimeApiAvailable();
  const runtimeApi = readMultiRuntimeApi();
  const policy = runtimeApi.getPreferences().then((preferences) =>
    createAgentModelPolicy({
      preferences,
      interactionMode: input.interactionMode,
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
  await input.preparedPolicy.runtimeApi.sendTurn({
    threadId: input.threadId,
    cwd: input.cwd,
    input: input.text,
    interactionMode: input.interactionMode,
    sourceProposedPlan: input.sourceProposedPlan,
    clientMessageId: input.clientMessageId,
    images: [...input.images],
    policy: await input.preparedPolicy.policy,
  });
}

export async function sendRuntimeTurn(input: RuntimeTurnInput): Promise<void> {
  const preparedPolicy = prepareRuntimeTurnPolicy({
    interactionMode: input.interactionMode,
  });
  await sendRuntimeTurnWithPreparedPolicy({
    ...input,
    preparedPolicy,
  });
}

export async function hydrateRuntimeThread(input: {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly interactionMode: AgentInteractionMode;
}): Promise<void> {
  await assertRuntimeHostAvailable();
  const runtimeApi = readMultiRuntimeApi();
  const preferences = await runtimeApi.getPreferences();
  const policy = createAgentModelPolicy({
    preferences,
    interactionMode: input.interactionMode,
  });

  await runtimeApi.hydrateThread({
    threadId: input.threadId,
    cwd: input.cwd,
    policy,
  });
}
