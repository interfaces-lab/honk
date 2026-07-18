import { createOpenCodeServer, openCodeSessionRef, type OpenCodeClient } from "@honk/opencode";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendSessionPrompt } from "./session-prompt";
import { noteOpenCodeSessionPromptAccepted } from "./watch-registry";

vi.mock("./watch-registry", () => ({
  noteOpenCodeSessionPromptAccepted: vi.fn(),
}));

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });
const notePromptAccepted = vi.mocked(noteOpenCodeSessionPromptAccepted);

function client(prompt: () => Promise<void>): OpenCodeClient {
  return {
    server,
    sessions: {
      switchAgent: vi.fn(() => Promise.resolve()),
      prompt: vi.fn(prompt),
    },
  } as unknown as OpenCodeClient;
}

beforeEach(() => {
  notePromptAccepted.mockClear();
});

describe("session prompt", () => {
  it("switches the agent, sends the prompt, and advances the watch after acceptance", async () => {
    const value = client(() => Promise.resolve());

    await sendSessionPrompt(value, "session-1", {
      text: "Audit the chat view",
      agent: "honk-build",
      messageID: "message-1",
      files: [{ uri: "file:///repo/src/chat.tsx", name: "chat.tsx" }],
    });

    const ref = openCodeSessionRef(server.key, "session-1");
    expect(value.sessions.switchAgent).toHaveBeenCalledWith(ref, "honk-build");
    expect(value.sessions.prompt).toHaveBeenCalledWith(ref, {
      id: "msg_message-1",
      prompt: {
        text: "Audit the chat view",
        files: [{ uri: "file:///repo/src/chat.tsx", name: "chat.tsx" }],
      },
    });
    expect(notePromptAccepted).toHaveBeenCalledWith(ref);
  });

  it("does not advance the watch when the host rejects the prompt", async () => {
    const value = client(() => Promise.reject(new Error("offline")));

    await expect(
      sendSessionPrompt(value, "session-1", {
        text: "Retry",
        messageID: "message-2",
      }),
    ).rejects.toThrow("offline");
    expect(notePromptAccepted).not.toHaveBeenCalled();
  });
});
