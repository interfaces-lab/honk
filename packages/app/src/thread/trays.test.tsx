import { createOpenCodeServer, openCodeSessionRef } from "@honk/opencode";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@stylexjs/stylex", () => ({
  create: <T,>(styles: T) => styles,
  props: () => ({}),
}));

import type { ThreadViewState } from "../open-code-view";
import { ThreadRuntimeContext } from "./runtime";
import { ThreadTray } from "./trays";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });

const state = {
  summary: { status: "idle", agent: "honk-debug" },
  activity: "idle",
  messages: [
    { id: "user-1", role: "user" },
    { id: "debug-1", role: "assistant", agent: "honk-debug", time: { completed: 1 } },
  ],
  parts: [
    {
      id: "diagnosis-1",
      messageID: "debug-1",
      type: "tool",
      tool: "debug_submit",
      state: {
        status: "completed",
        metadata: {
          diagnosis: {
            title: "Resize observer leak",
            summary: "The observer survives the editor transition.",
            rootCause: "The resize observer remains subscribed after unmount.",
            recommendedFix: "Dispose it in the editor cleanup.",
            reproduction: "Edit a pinned message, then cancel.",
            files: ["packages/app/src/thread/inline-message-edit-composer.tsx"],
            verification: ["Run the focused tray test."],
          },
        },
      },
    },
  ],
  permissions: [],
  questions: [],
} as unknown as ThreadViewState;

describe("thread trays", () => {
  it("renders the full diagnosis and disables all actions without a client", () => {
    const html = renderToStaticMarkup(
      <ThreadRuntimeContext.Provider
        value={{
          ref: openCodeSessionRef(server.key, "session-1"),
          client: null,
          tabKey: "session-1",
        }}
      >
        <ThreadTray threadId="session-1" state={state} />
      </ThreadRuntimeContext.Provider>,
    );

    expect(html).toContain("The observer survives the editor transition.");
    expect(html).toContain("Reproduction");
    expect(html).toContain("Edit a pinned message, then cancel.");
    expect(html).toContain("Relevant files");
    expect(html).toContain("packages/app/src/thread/inline-message-edit-composer.tsx");
    expect(html).toContain("Verification");
    expect(html).toContain("Run the focused tray test.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Apply fix<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Keep debugging<\/button>/);
  });

  it("renders the request tray selected by the thread projection", () => {
    const html = renderToStaticMarkup(
      <ThreadRuntimeContext.Provider
        value={{
          ref: openCodeSessionRef(server.key, "session-1"),
          client: null,
          tabKey: "session-1",
        }}
      >
        <ThreadTray
          threadId="session-1"
          state={{
            ...state,
            permissions: [
              {
                id: "permission-1",
                sessionID: "session-1",
                action: "bash",
                resources: ["pnpm test"],
              },
            ],
          }}
        />
      </ThreadRuntimeContext.Provider>,
    );

    expect(html).toContain('aria-label="Permission requested"');
  });
});
