import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const TOOL_CALL_DESCRIPTION_PROMPT =
  "Every tool call must include a concise description argument explaining why the call is being made. Keep descriptions user-facing, short, and action-oriented.";

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

export function patchToolCallDescriptionProviderPayload(payload: unknown): unknown | undefined {
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
  const inputSchema = asRecord(tool.input_schema);
  if (!inputSchema) {
    return undefined;
  }
  const patchedSchema = patchToolInputSchema(inputSchema);
  return patchedSchema ? { ...tool, input_schema: patchedSchema } : undefined;
}

function patchOpenAiChatTool(tool: JsonObject): JsonObject | undefined {
  const functionRecord = asRecord(tool.function);
  const parameters = asRecord(functionRecord?.parameters);
  if (!functionRecord || !parameters) {
    return undefined;
  }
  const patchedParameters = patchToolInputSchema(parameters);
  return patchedParameters
    ? { ...tool, function: { ...functionRecord, parameters: patchedParameters } }
    : undefined;
}

function patchOpenAiResponsesTool(tool: JsonObject): JsonObject | undefined {
  const parameters = asRecord(tool.parameters);
  if (!parameters) {
    return undefined;
  }
  const patchedParameters = patchToolInputSchema(parameters);
  return patchedParameters ? { ...tool, parameters: patchedParameters } : undefined;
}

function patchToolInputSchema(schema: JsonObject): JsonObject | undefined {
  if (schema.type !== undefined && schema.type !== "object") {
    return undefined;
  }

  let changed = false;
  const properties = asRecord(schema.properties) ?? {};
  let nextProperties = properties;
  if (!Object.prototype.hasOwnProperty.call(properties, "description")) {
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
