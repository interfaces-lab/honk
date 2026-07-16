import { openCodeSessionKey, type OpenCodeSessionRef } from "@honk/opencode";

import type { AppSessionState } from "./open-code-view";
import { actions as toastActions } from "./toast-store";
import type { AdapterWatchStatus } from "./watch-registry";

type CopySessionDebugInfoInput = {
  readonly ref: OpenCodeSessionRef;
  readonly state: AppSessionState | null;
  readonly watchStatus: AdapterWatchStatus;
};

function sessionDebugInfoText(input: CopySessionDebugInfoInput): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      session: {
        id: input.ref.sessionID,
        key: openCodeSessionKey(input.ref),
        server: input.ref.server,
      },
      watch: {
        status: input.watchStatus,
        sessionStatus: input.state?.summary.status ?? null,
        updatedAt: input.state?.summary.updatedAt ?? null,
      },
      location: {
        directory: input.state?.cwd ?? null,
      },
      transcript: {
        renderedMessages: input.state?.messages.length ?? null,
        renderedParts: input.state?.parts.length ?? null,
        persistedMessages: input.state?.transcriptSources.persistedMessages ?? null,
        projectedMessages: input.state?.transcriptSources.projectedMessages ?? null,
      },
    },
    null,
    2,
  );
}

async function copySessionDebugInfo(input: CopySessionDebugInfoInput): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    toastActions.add({
      type: "error",
      title: "Clipboard unavailable",
      description: "Session debug info could not be copied.",
    });
    return;
  }

  try {
    await navigator.clipboard.writeText(sessionDebugInfoText(input));
    toastActions.add({
      type: "success",
      title: "Session debug info copied",
      description: input.ref.sessionID,
    });
  } catch (cause) {
    toastActions.add({
      type: "error",
      title: "Session debug info could not be copied",
      description: cause instanceof Error ? cause.message : "Clipboard access failed.",
    });
  }
}

export { copySessionDebugInfo, sessionDebugInfoText };
export type { CopySessionDebugInfoInput };
