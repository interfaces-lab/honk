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
  },
): Promise<void> {
  const ref = openCodeSessionRef(client.server.key, sessionID);
  if (input.agent !== undefined) {
    await client.sessions.switchAgent(ref, input.agent);
  }
  await client.sessions.prompt(ref, {
    id: openCodeMessageID(input.messageID ?? crypto.randomUUID()),
    prompt: {
      text: input.text,
      ...(input.files !== undefined && input.files.length > 0 ? { files: [...input.files] } : {}),
    },
  });
  noteOpenCodeSessionPromptAccepted(ref);
}
