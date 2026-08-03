import { createOpenCodeServer, openCodeSessionRef } from "@honk/opencode";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ThreadViewState } from "../open-code-view";
import { ThreadRuntimeContext } from "./runtime";
import { ThreadTranscriptPreview } from "./transcript";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });

describe("thread transcript preview", () => {
  it("renders child-session questions even when the child has no transcript activity", () => {
    const threadId = "session-child";
    const html = renderToStaticMarkup(
      <ThreadRuntimeContext.Provider
        value={{
          ref: openCodeSessionRef(server.key, "session-parent"),
          client: null,
          tabKey: "session-parent",
        }}
      >
        <ThreadTranscriptPreview
          threadId={threadId}
          state={
            {
              summary: { status: "idle" },
              messages: [],
              parts: [],
              permissions: [],
              questions: [
                {
                  id: "question-1",
                  sessionID: threadId,
                  questions: [
                    {
                      header: "Scope",
                      question: "Which catalog should be updated?",
                      options: [
                        {
                          label: "Claude Code",
                          description: "Update the Claude Code catalog.",
                        },
                      ],
                      multiple: false,
                      custom: true,
                    },
                  ],
                },
              ],
            } as unknown as ThreadViewState
          }
          scrollElement={null}
        />
      </ThreadRuntimeContext.Provider>,
    );

    expect(html).toContain("Which catalog should be updated?");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Send answer");
    expect(html).not.toContain("No activity yet");
  });
});
