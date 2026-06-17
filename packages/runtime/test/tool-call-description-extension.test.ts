import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import {
  patchToolCallDescriptionAgentTools,
  patchToolCallDescriptionProviderPayload,
} from "../src/tool-call-description-extension";

const descriptionSchema = {
  type: "string",
  description:
    "Short user-facing explanation of why this tool call is being made. Keep it concise and action-oriented.",
};

const bashParametersWithDescription = {
  type: "object",
  properties: {
    command: { type: "string" },
    description: descriptionSchema,
  },
  required: ["command"],
};

describe("tool call description extension", () => {
  it("does not patch file tool input schemas", () => {
    const payload = {
      tools: [
        {
          name: "edit",
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

    expect(patchToolCallDescriptionProviderPayload(payload)).toBeUndefined();
  });

  it("patches Anthropic command-like tool input schemas when description is supported", () => {
    const payload = {
      tools: [
        {
          name: "bash",
          input_schema: bashParametersWithDescription,
        },
      ],
    };

    expect(patchToolCallDescriptionProviderPayload(payload)).toEqual({
      tools: [
        {
          name: "bash",
          input_schema: {
            ...bashParametersWithDescription,
            required: ["command", "description"],
          },
        },
      ],
    });
  });

  it("patches OpenAI chat-completions command-like tool parameters", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: {
            name: "bash",
            parameters: bashParametersWithDescription,
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
              ...bashParametersWithDescription,
              required: ["command", "description"],
            },
          },
        },
      ],
    });
  });

  it("patches OpenAI responses command-like tool parameters without overwriting descriptions", () => {
    const existingDescription = {
      type: "string",
      description: "Existing domain-specific description.",
    };
    const payload = {
      tools: [
        {
          type: "function",
          name: "lint",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string" },
              description: existingDescription,
            },
            required: ["target"],
          },
        },
      ],
    };

    expect(patchToolCallDescriptionProviderPayload(payload)).toEqual({
      tools: [
        {
          type: "function",
          name: "lint",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string" },
              description: existingDescription,
            },
            required: ["target", "description"],
          },
        },
      ],
    });
  });

  it("does not add provider descriptions when command-like tools do not support them", () => {
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

    expect(patchToolCallDescriptionProviderPayload(payload)).toBeUndefined();
  });

  it("adds description schema support to active command tools only", async () => {
    const execute: AgentTool["execute"] = async () => ({ content: [], details: undefined });
    const tools: AgentTool[] = [
      {
        name: "bash",
        label: "bash",
        description: "Run a command.",
        parameters: Type.Object({ command: Type.String() }),
        execute,
      },
      {
        name: "edit",
        label: "edit",
        description: "Edit a file.",
        parameters: Type.Object({ path: Type.String() }),
        execute,
      },
    ];

    const patchedTools = patchToolCallDescriptionAgentTools(tools);

    expect(patchedTools[0]?.parameters).toMatchObject({
      properties: {
        command: { type: "string" },
        description: descriptionSchema,
      },
      required: ["command", "description"],
    });
    expect(patchedTools[1]).toBe(tools[1]);
  });
});
