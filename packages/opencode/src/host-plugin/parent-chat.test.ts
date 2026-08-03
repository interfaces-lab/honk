import { describe, expect, it } from "vitest";

import { createParentChatTool } from "./parent-chat";
import type { PluginInput, PluginMessageGroup, PluginSession } from "./types";

function plugin(session: PluginSession, messages: readonly PluginMessageGroup[]): PluginInput {
  return {
    directory: "/repo",
    client: {
      session: {
        get: async () => ({ data: session }),
        // Serve the transcript only for the parent id so a regression that queries the
        // side chat's own session id fails these tests instead of passing on a shared fixture.
        messages: async (options) => ({
          data: options.path.id === session.parentID ? messages : [],
        }),
        abort: async () => ({ data: true }),
      },
    },
  };
}

const context = { sessionID: "ses_side", agent: "honk-build" };

describe("parent_chat tool", () => {
  it("throws when the current session has no parent", async () => {
    const tool = createParentChatTool(plugin({ id: "ses_side" }, []));
    await expect(tool.execute({ query: "" }, context)).rejects.toThrow(
      /only available inside a side chat/,
    );
  });

  it("returns the parent transcript when no query is supplied", async () => {
    const tool = createParentChatTool(
      plugin({ id: "ses_side", parentID: "ses_parent" }, [
        { info: { role: "user" }, parts: [{ type: "text", text: "How do I add a route?" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Edit the router file." }] },
      ]),
    );
    const result = await tool.execute({ query: "" }, context);
    const output = typeof result === "string" ? result : result.output;
    expect(output).toContain("user: How do I add a route?");
    expect(output).toContain("assistant: Edit the router file.");
  });

  it("filters the transcript by a case-insensitive query", async () => {
    const tool = createParentChatTool(
      plugin({ id: "ses_side", parentID: "ses_parent" }, [
        { info: { role: "user" }, parts: [{ type: "text", text: "Talk about routing" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Unrelated answer" }] },
      ]),
    );
    const result = await tool.execute({ query: "ROUTING" }, context);
    const output = typeof result === "string" ? result : result.output;
    expect(output).toContain("Talk about routing");
    expect(output).not.toContain("Unrelated answer");
  });

  it("reports when a query matches nothing", async () => {
    const tool = createParentChatTool(
      plugin({ id: "ses_side", parentID: "ses_parent" }, [
        { info: { role: "user" }, parts: [{ type: "text", text: "Hello" }] },
      ]),
    );
    const result = await tool.execute({ query: "nonexistent" }, context);
    const output = typeof result === "string" ? result : result.output;
    expect(output).toContain('No parent chat messages matched "nonexistent"');
  });
});
