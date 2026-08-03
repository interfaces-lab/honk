import {
  openCodeMessageID,
  openCodeSessionRef,
  type OpenCodeClient,
  type OpenCodePromptFileAttachment,
} from "@honk/opencode";

import { noteOpenCodeSessionPromptAccepted } from "./watch-registry";

export async function sendSessionPrompt(
  client: OpenCodeClient,
  sessionID: string,
  input: {
    readonly text: string;
    readonly files?: readonly OpenCodePromptFileAttachment[];
    readonly agent?: string;
    readonly messageID?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly synthetic?: boolean;
  },
): Promise<void> {
  const ref = openCodeSessionRef(client.server.key, sessionID);
  if (input.agent !== undefined) {
    await client.sessions.switchAgent(ref, input.agent);
  }
  // Only an edit resend carries an ID, and it reuses the sidecar's own ID for the
  // message being replaced. New prompts must let the sidecar mint it: message IDs
  // are ascending and the session runner ends a turn only once the newest user ID
  // sorts below the newest assistant ID. A client-minted ID that sorts above them
  // pins the session's latest user message forever, so the runner re-answers until
  // the sidecar restarts.
  await client.sessions.prompt(ref, {
    ...(input.messageID === undefined ? {} : { id: openCodeMessageID(input.messageID) }),
    prompt: {
      text: input.text,
      ...(input.files !== undefined && input.files.length > 0 ? { files: [...input.files] } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.synthetic === true ? { synthetic: true } : {}),
    },
  });
  noteOpenCodeSessionPromptAccepted(ref);
}
