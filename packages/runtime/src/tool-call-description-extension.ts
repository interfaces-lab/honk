import type { Model } from "@earendil-works/pi-ai/base";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const TOOL_CALL_DESCRIPTION_PROMPT =
  "For command-like tools that expose a description argument, include a concise user-facing explanation of why the tool call is being made. Do not add description to file inspection or file mutation tools such as read, edit, write, grep, find, or ls.";

const TOOL_CALL_DESCRIPTION_SCHEMA: JsonObject = {
  type: "string",
  description:
    "Short user-facing explanation of why this tool call is being made. Keep it concise and action-oriented.",
};

type JsonObject = Record<string, unknown>;

export function createToolCallDescriptionExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event, ctx) => {
      if (!isToolCallDescriptionModel(ctx.model)) {
        return undefined;
      }
      return {
        systemPrompt: `${event.systemPrompt}\n\n${TOOL_CALL_DESCRIPTION_PROMPT}`,
      };
    });

    pi.on("before_provider_request", (event, ctx) => {
      if (!isToolCallDescriptionModel(ctx.model)) {
        return undefined;
      }
      return patchToolCallDescriptionProviderPayload(event.payload);
    });

    pi.on("tool_call", (event, ctx) => {
      if (!isToolCallDescriptionModel(ctx.model)) {
        return undefined;
      }
      if (!isToolCallDescriptionTargetToolName(event.toolName)) {
        return undefined;
      }
      const input = asRecord(event.input);
      const description = trimmedString(input?.description);
      if (description) {
        return undefined;
      }
      return {
        block: true,
        reason: `Tool call ${event.toolName} must include a non-empty description argument.`,
      };
    });
  };
}

function isToolCallDescriptionModel(model: Model<string> | undefined): boolean {
  if (!model) {
    return false;
  }
  return model.api.includes("anthropic") || model.api.includes("openai");
}

export function patchToolCallDescriptionProviderPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  const tools = Array.isArray(record?.tools) ? record.tools : null;
  if (!record || !tools) {
    return undefined;
  }

  let changed = false;
  const nextTools = tools.map((tool) => {
    const toolRecord = asRecord(tool);
    if (!toolRecord) {
      return tool;
    }
    const patchedTool = patchProviderTool(toolRecord);
    if (!patchedTool) {
      return tool;
    }
    changed = true;
    return patchedTool;
  });

  return changed ? { ...record, tools: nextTools } : undefined;
}

function patchProviderTool(tool: JsonObject): JsonObject | undefined {
  return patchAnthropicTool(tool) ?? patchOpenAiChatTool(tool) ?? patchOpenAiResponsesTool(tool);
}

function patchAnthropicTool(tool: JsonObject): JsonObject | undefined {
  const toolName = trimmedString(tool.name);
  const inputSchema = asRecord(tool.input_schema);
  if (!toolName || !isToolCallDescriptionTargetToolName(toolName) || !inputSchema) {
    return undefined;
  }
  const patchedSchema = patchToolInputSchema(inputSchema, { addIfMissing: false });
  return patchedSchema ? { ...tool, input_schema: patchedSchema } : undefined;
}

function patchOpenAiChatTool(tool: JsonObject): JsonObject | undefined {
  const functionRecord = asRecord(tool.function);
  const toolName = trimmedString(functionRecord?.name);
  const parameters = asRecord(functionRecord?.parameters);
  if (
    !functionRecord ||
    !toolName ||
    !isToolCallDescriptionTargetToolName(toolName) ||
    !parameters
  ) {
    return undefined;
  }
  const patchedParameters = patchToolInputSchema(parameters, { addIfMissing: false });
  return patchedParameters
    ? { ...tool, function: { ...functionRecord, parameters: patchedParameters } }
    : undefined;
}

function patchOpenAiResponsesTool(tool: JsonObject): JsonObject | undefined {
  const toolName = trimmedString(tool.name);
  const parameters = asRecord(tool.parameters);
  if (!toolName || !isToolCallDescriptionTargetToolName(toolName) || !parameters) {
    return undefined;
  }
  const patchedParameters = patchToolInputSchema(parameters, { addIfMissing: false });
  return patchedParameters ? { ...tool, parameters: patchedParameters } : undefined;
}

function patchToolInputSchema(
  schema: JsonObject,
  options: { readonly addIfMissing: boolean },
): JsonObject | undefined {
  if (schema.type !== undefined && schema.type !== "object") {
    return undefined;
  }

  let changed = false;
  const properties = asRecord(schema.properties) ?? {};
  let nextProperties = properties;
  if (!Object.prototype.hasOwnProperty.call(properties, "description")) {
    if (!options.addIfMissing) {
      return undefined;
    }
    nextProperties = { ...properties, description: TOOL_CALL_DESCRIPTION_SCHEMA };
    changed = true;
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  const nextRequired = required.includes("description") ? required : [...required, "description"];
  if (nextRequired !== required || !Array.isArray(schema.required)) {
    changed = true;
  }

  if (schema.type !== "object") {
    changed = true;
  }

  return changed
    ? {
        ...schema,
        type: "object",
        properties: nextProperties,
        required: nextRequired,
      }
    : undefined;
}

export function patchToolCallDescriptionAgentTools(tools: readonly AgentTool[]): AgentTool[] {
  return tools.map((tool) => {
    if (!isToolCallDescriptionTargetToolName(tool.name)) {
      return tool;
    }
    const parameters = asRecord(tool.parameters);
    if (!parameters) {
      return tool;
    }
    const patchedParameters = patchToolInputSchema(parameters, { addIfMissing: true });
    if (!patchedParameters) {
      return tool;
    }
    return {
      ...tool,
      parameters: patchedParameters as AgentTool["parameters"],
    };
  });
}

function isToolCallDescriptionTargetToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase().replaceAll("-", "_");
  if (
    normalized === "read" ||
    normalized === "edit" ||
    normalized === "write" ||
    normalized === "grep" ||
    normalized === "find" ||
    normalized === "ls"
  ) {
    return false;
  }
  return (
    normalized === "bash" ||
    normalized === "shell" ||
    normalized === "exec" ||
    normalized === "command" ||
    normalized === "lint" ||
    normalized.includes("terminal") ||
    normalized.includes("command") ||
    normalized.includes("lint")
  );
}

function asRecord(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
