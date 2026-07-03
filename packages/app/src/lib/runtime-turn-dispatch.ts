import type { AgentInteractionMode } from "@honk/shared/interaction-mode";
import type { AgentModelPolicy } from "@honk/shared/agent-model-policy";
import type { HonkRuntimeApi } from "@honk/contracts";
import type {
  MessageId,
  ThreadEntryId,
} from "@honk/shared/base-schemas";
import type { ThreadAgentRuntimeImageAttachment } from "@honk/shared/runtime";
import type { SourceProposedPlanReference } from "@honk/shared/orchestration";
import type { ModelSelection } from "@honk/shared/model";
import type { ThreadId } from "@honk/shared/base-schemas";
import { createAgentModelPolicy } from "@honk/shared/agent-model-policy";

import {
  assertRuntimeApiAvailable,
  assertRuntimeHostAvailable,
  readHonkRuntimeApi,
} from "./honk-runtime-api";

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
  assertRuntimeApiAvailable();
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
  await input.preparedPolicy.runtimeApi.sendTurn({
    threadId: input.threadId,
    cwd: input.cwd,
    input: input.text,
    interactionMode: input.interactionMode,
    sourceProposedPlan: input.sourceProposedPlan,
    clientMessageId: input.clientMessageId,
    replacesClientMessageId: input.replacesClientMessageId,
    ...(input.parentEntryId !== undefined ? { parentEntryId: input.parentEntryId } : {}),
    images: [...input.images],
    policy: await input.preparedPolicy.policy,
    modelSelection: input.modelSelection,
    ...(input.streamingBehavior ? { streamingBehavior: input.streamingBehavior } : {}),
  });
  hydratedRuntimeThreadIds.add(String(input.threadId));
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
  const preparedPolicy = prepareRuntimeTurnPolicy({
    interactionMode: input.interactionMode,
    modelSelection: input.modelSelection,
  });
  await preparedPolicy.runtimeApi.compactThread({
    threadId: input.threadId,
    cwd: input.cwd,
    ...(input.customInstructions !== undefined
      ? { customInstructions: input.customInstructions }
      : {}),
    policy: await preparedPolicy.policy,
  });
}

const hydratedRuntimeThreadIds = new Set<string>();
const hydrateRuntimeThreadInFlight = new Map<string, Promise<void>>();

export function resetRuntimeThreadHydrationCache(): void {
  hydratedRuntimeThreadIds.clear();
  hydrateRuntimeThreadInFlight.clear();
}

export async function hydrateRuntimeThread(input: {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly interactionMode: AgentInteractionMode;
  readonly modelSelection: ModelSelection;
}): Promise<void> {
  const threadKey = String(input.threadId);
  if (hydratedRuntimeThreadIds.has(threadKey)) {
    return;
  }

  const inFlight = hydrateRuntimeThreadInFlight.get(threadKey);
  if (inFlight) {
    await inFlight;
    return;
  }

  const hydratePromise = (async () => {
    await assertRuntimeHostAvailable();
    const runtimeApi = readHonkRuntimeApi();
    const preferences = await runtimeApi.getPreferences();
    const policy = createAgentModelPolicy({
      preferences,
      interactionMode: input.interactionMode,
      modelSelection: input.modelSelection,
    });

    await runtimeApi.hydrateThread({
      threadId: input.threadId,
      cwd: input.cwd,
      policy,
    });
    hydratedRuntimeThreadIds.add(threadKey);
  })();

  hydrateRuntimeThreadInFlight.set(threadKey, hydratePromise);
  try {
    await hydratePromise;
  } finally {
    if (hydrateRuntimeThreadInFlight.get(threadKey) === hydratePromise) {
      hydrateRuntimeThreadInFlight.delete(threadKey);
    }
  }
}
