import type {
  AgentInteractionMode,
  MessageId,
  SourceProposedPlanReference,
  ThreadAgentRuntimeImageAttachment,
  ThreadId,
} from "@multi/contracts";

import { readMultiRuntimeApi } from "./multi-runtime-api";

export async function sendRuntimeTurn(input: {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly text: string;
  readonly interactionMode: AgentInteractionMode;
  readonly sourceProposedPlan: SourceProposedPlanReference | null;
  readonly clientMessageId: MessageId;
  readonly images: readonly ThreadAgentRuntimeImageAttachment[];
}): Promise<void> {
  await readMultiRuntimeApi().sendTurn({
    threadId: input.threadId,
    cwd: input.cwd,
    input: input.text,
    interactionMode: input.interactionMode,
    sourceProposedPlan: input.sourceProposedPlan,
    clientMessageId: input.clientMessageId,
    images: [...input.images],
  });
}
