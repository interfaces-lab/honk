// Imperative session commands that live outside a thread's watch. The
// attach/fold lifecycle is chat-store.ts; the pure rules are chat-model.ts.

import type { Session } from "@honk/core/session";
import type { Workspace } from "@honk/core/workspace";

import { requireHonkClient } from "./client";

export interface ModelChoice {
  readonly providerId: string;
  readonly modelId: string;
}

/**
 * Creates a session; the caller navigates to it. Model choice is per session
 * (spec/core.md section 11) and recorded in the transcript, so the thread page
 * needs no model state of its own.
 */
export async function createCoreSession(input: {
  readonly workspaceId: Workspace.WorkspaceId;
  readonly model: ModelChoice | null;
}): Promise<Session.SessionId> {
  const sdk = requireHonkClient();
  const { id } = await sdk.session.create({
    workspaceId: input.workspaceId,
    ...(input.model === null ? {} : { model: input.model }),
  });
  return id;
}
