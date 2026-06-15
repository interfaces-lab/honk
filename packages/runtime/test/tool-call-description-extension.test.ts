import { describe, expect, it } from "vitest";
import { patchToolCallDescriptionProviderPayload } from "../src/tool-call-description-extension";

const descriptionSchema = {
  type: "string",
  description:
    "Short user-facing explanation of why this tool call is being made. Keep it concise and action-oriented.",
};

describe("tool call description extension", () => {
  it("patches Anthropic tool input schemas", () => {
    const payload = {
      tools: [
        {
          name: "read",
          input_schema: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
      ],
    };

    expect(patchToolCallDescriptionProviderPayload(payload)).toEqual({
      tools: [
        {
          name: "read",
          input_schema: {
            type: "object",
            properties: {
              path: { type: "string" },
              description: descriptionSchema,
            },
            required: ["path", "description"],
          },
        },
      ],
    });
  });

  it("patches OpenAI chat-completions tool parameters", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: {
            name: "bash",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
              },
              required: ["command"],
            },
          },
        },
      ],
    };

    expect(patchToolCallDescriptionProviderPayload(payload)).toEqual({
      tools: [
        {
          type: "function",
          function: {
            name: "bash",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
                description: descriptionSchema,
              },
              required: ["command", "description"],
            },
          },
        },
      ],
    });
  });

  it("patches OpenAI responses tool parameters without overwriting existing descriptions", () => {
    const existingDescription = {
      type: "string",
      description: "Existing domain-specific description.",
    };
    const payload = {
      tools: [
        {
          type: "function",
          name: "generate_image",
          parameters: {
            type: "object",
            properties: {
              description: existingDescription,
            },
            required: [],
          },
        },
      ],
    };

    expect(patchToolCallDescriptionProviderPayload(payload)).toEqual({
      tools: [
        {
          type: "function",
          name: "generate_image",
          parameters: {
            type: "object",
            properties: {
              description: existingDescription,
            },
            required: ["description"],
          },
        },
      ],
    });
  });

  it("returns undefined for payloads without supported tool schemas", () => {
    expect(patchToolCallDescriptionProviderPayload({ tools: [{ name: "noop" }] })).toBeUndefined();
  });
});
